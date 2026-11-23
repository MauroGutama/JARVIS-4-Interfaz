// Entrada de voz con tres estrategias, de mejor a peor:
//  1. "native": reconocimiento de Safari (webkitSpeechRecognition). Requiere Siri y Dictado activados.
//  2. "server": graba con MediaRecorder y transcribe en el servidor (Whisper/gpt-4o-transcribe).
//  3. "keyboard": se enfoca el campo de texto para usar el micrófono del teclado del iPhone.

export function detectCapabilities(w = globalThis) {
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition || null;
  const md = w.navigator?.mediaDevices;
  return {
    native: Boolean(SR),
    recorder: Boolean(md?.getUserMedia && w.MediaRecorder),
    secure: w.isSecureContext !== false,
    standalone: Boolean(w.navigator?.standalone || w.matchMedia?.('(display-mode: standalone)').matches),
  };
}

/** Decide qué estrategia usar. Pura, para poder probarla. */
export function chooseStrategy(pref, caps, { serverStt = false, nativeFailed = false } = {}) {
  const canServer = caps.recorder && caps.secure && serverStt;
  if (pref === 'keyboard') return 'keyboard';
  if (pref === 'native') return caps.native ? 'native' : canServer ? 'server' : 'keyboard';
  if (pref === 'server') return canServer ? 'server' : caps.native ? 'native' : 'keyboard';
  // auto
  if (caps.native && !nativeFailed) return 'native';
  if (canServer) return 'server';
  if (caps.native) return 'native';
  return 'keyboard';
}

export function pickRecorderMime(MR = globalThis.MediaRecorder) {
  if (!MR?.isTypeSupported) return '';
  for (const t of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
    if (MR.isTypeSupported(t)) return t;
  }
  return '';
}

export function createListener({ api, getPrefs, getServerStt, speakPrime, onState, onInterim, onFinal, onNotice }) {
  let active = null;      // { kind, stop() }
  let nativeFailed = false;

  function finish() { active = null; onState('idle'); }

  function startNative() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new SR();
    let heard = false, finalSent = false, draft = '';
    r.lang = 'es-ES'; r.continuous = false; r.interimResults = true; r.maxAlternatives = 1;
    r.onstart = () => { onState('listening'); onNotice('Te escucho. Habla con claridad y termina la frase.'); };
    r.onspeechstart = () => { heard = true; };
    r.onresult = e => {
      let t = '', isFinal = false;
      for (let i = 0; i < e.results.length; i++) { t += e.results[i][0].transcript; if (e.results[i].isFinal) isFinal = true; }
      if (t) { heard = true; draft = t; onInterim(t); }
      if (isFinal && t.trim() && !finalSent) { finalSent = true; onFinal(t.trim()); }
    };
    r.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        nativeFailed = true;
        onNotice(getServerStt() ? 'Safari no permite su reconocimiento de voz (revisa Ajustes › Siri y Dictado). La próxima vez grabaré y transcribiré en el servidor.' : 'Safari no permite su reconocimiento de voz. Activa Siri y Dictado en el iPhone, o usa el micrófono del teclado.');
      } else if (e.error === 'no-speech') onNotice('No detecté voz. Toca HABLAR e inténtalo otra vez.');
      else if (e.error !== 'aborted') { nativeFailed = e.error === 'network' || e.error === 'audio-capture'; onNotice('Reconocimiento de Safari: ' + e.error + '.'); }
    };
    r.onend = () => {
      if (!finalSent && heard && draft.trim()) { finalSent = true; onFinal(draft.trim()); }
      else if (!finalSent && !heard && getServerStt()) nativeFailed = true;
      finish();
    };
    // En iOS no se corta la sesión manualmente salvo que el usuario lo pida (stop explícito).
    active = { kind: 'native', stop: () => { try { r.stop(); } catch { /* ya terminó */ } } };
    r.start();
  }

  async function startServer() {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = AC ? new AC() : null; // creado dentro del gesto para que iOS lo permita
    onState('preparing');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      ctx?.close?.();
      finish();
      onNotice(e?.name === 'NotAllowedError' ? 'Permiso de micrófono denegado. Actívalo en Ajustes › Safari › Micrófono.' : 'No se pudo abrir el micrófono: ' + (e?.message || e));
      return;
    }
    const mime = pickRecorderMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    let stopped = false, raf = 0, maxTimer = 0;
    const cleanup = () => {
      cancelAnimationFrame(raf); clearTimeout(maxTimer);
      stream.getTracks().forEach(t => t.stop());
      ctx?.close?.().catch?.(() => {});
    };
    const stop = () => { if (stopped) return; stopped = true; try { rec.stop(); } catch { cleanup(); finish(); } };

    rec.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
    rec.onstop = async () => {
      cleanup();
      const blob = new Blob(chunks, { type: (rec.mimeType || mime || 'audio/mp4') });
      if (blob.size < 1500) { finish(); onNotice('No se grabó audio suficiente.'); return; }
      onState('thinking'); onNotice('Transcribiendo…');
      try {
        const { text } = await api.transcribe(blob);
        finish();
        if (text) { onInterim(text); onFinal(text); } else onNotice('No entendí el audio. Inténtalo de nuevo.');
      } catch (e) { finish(); onNotice('Transcripción fallida: ' + e.message); }
    };

    // Detección de silencio: termina sola ~1,4 s después de que dejes de hablar.
    if (ctx) {
      try {
        await ctx.resume?.();
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser(); an.fftSize = 1024; src.connect(an);
        const buf = new Float32Array(an.fftSize);
        let spoke = false, lastLoud = performance.now();
        const started = performance.now();
        const tick = () => {
          if (stopped) return;
          an.getFloatTimeDomainData(buf);
          let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const rms = Math.sqrt(sum / buf.length);
          const now = performance.now();
          if (rms > 0.02) { spoke = true; lastLoud = now; }
          if (spoke && now - lastLoud > 1400) return stop();
          if (!spoke && now - started > 8000) { onNotice('No detecté voz.'); return stop(); }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch { /* sin detección de silencio: el usuario toca de nuevo para terminar */ }
    }
    maxTimer = setTimeout(stop, 30_000);
    active = { kind: 'server', stop };
    rec.start(250);
    onState('listening');
    onNotice('Grabando… termina de hablar o toca de nuevo para enviar.');
  }

  function startKeyboard() {
    onNotice('Toca el campo de texto y usa el micrófono 🎙 del teclado del iPhone para dictar.');
    onState('idle');
    document.getElementById('query')?.focus();
  }

  /** Se llama directamente desde el toque del usuario (requisito de iOS). */
  function toggle() {
    if (active) { active.stop(); return 'stopping'; }
    const caps = detectCapabilities(window);
    const strategy = chooseStrategy(getPrefs().voiceIn, caps, { serverStt: getServerStt(), nativeFailed });
    if (strategy === 'keyboard') { startKeyboard(); return strategy; }
    if (strategy === 'server') { startServer(); return strategy; }
    // Nativo: un aviso hablado breve antes de escuchar mitiga fallos de algunas versiones de iOS.
    active = { kind: 'native-prime', stop: () => finish() };
    onState('preparing');
    const begin = () => {
      if (!active || active.kind !== 'native-prime') return;
      try { startNative(); } catch (e) { finish(); onNotice('No se pudo iniciar el reconocimiento: ' + e.message); }
    };
    if (getPrefs().primeVoice && speakPrime) speakPrime(begin); else begin();
    return strategy;
  }

  return { toggle, get active() { return Boolean(active); }, stop: () => active?.stop() };
}
