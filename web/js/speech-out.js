// Salida de voz: voz natural del servidor (si existe) con respaldo en la voz del iPhone.
import { toSpeakable, chunkSentences, pickVoice } from './text.js';

const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

export function createSpeaker({ api, getPrefs, onState = () => {}, onNotice = () => {} }) {
  const synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
  const audio = typeof Audio !== 'undefined' ? new Audio() : null;
  if (audio) { audio.preload = 'auto'; audio.setAttribute('playsinline', ''); }
  let voices = [];
  let unlocked = false;
  let token = 0;
  let currentUrl = null;
  let serverTtsBroken = false;

  const loadVoices = () => { voices = synth ? synth.getVoices() : []; return voices; };
  if (synth) {
    loadVoices();
    synth.addEventListener?.('voiceschanged', loadVoices);
  }

  // iOS: el audio solo puede reproducirse tras un gesto del usuario. Se "desbloquea" en el primer toque.
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* iOS 17+ opcional */ }
    if (audio) { audio.src = SILENT_WAV; audio.play().catch(() => { unlocked = false; }); }
    if (synth) { try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; synth.speak(u); } catch { /* ignorar */ } }
  }

  function stop() {
    token++;
    if (synth) synth.cancel();
    if (audio) { audio.pause(); audio.removeAttribute('src'); try { audio.load(); } catch { /* ignorar */ } }
    if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
    onState('idle');
  }

  function speakDevice(text, my) {
    return new Promise(resolve => {
      if (!synth) { onNotice('Este navegador no permite síntesis de voz.'); return resolve(false); }
      const prefs = getPrefs();
      const voice = pickVoice(voices.length ? voices : loadVoices(), { preferredURI: prefs.voiceURI });
      const parts = chunkSentences(text);
      if (!parts.length) return resolve(true);
      let i = 0;
      const next = () => {
        if (my !== token) return resolve(false);
        if (i >= parts.length) { onState('idle'); return resolve(true); }
        const u = new SpeechSynthesisUtterance(parts[i++]);
        u.lang = voice?.lang || 'es-ES';
        if (voice) u.voice = voice;
        u.rate = Number(prefs.rate) || 1;
        u.pitch = Number(prefs.pitch) || 0.9;
        u.onstart = () => onState('speaking');
        u.onend = next;
        u.onerror = e => { if (e.error !== 'interrupted' && e.error !== 'canceled') onNotice('Voz del dispositivo: ' + e.error); next(); };
        synth.speak(u);
      };
      onState('speaking');
      next();
    });
  }

  async function speakServer(text, my) {
    const blob = await api.tts(text);
    if (my !== token) return false;
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = URL.createObjectURL(blob);
    audio.src = currentUrl;
    await new Promise((resolve, reject) => {
      audio.onplaying = () => onState('speaking');
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error('No se pudo reproducir el audio'));
      audio.play().catch(reject);
    });
    if (my === token) onState('idle');
    return true;
  }

  async function speak(raw, { serverAvailable = false } = {}) {
    stop();
    const my = token;
    const text = toSpeakable(raw);
    if (!text) return false;
    const prefs = getPrefs();
    if (prefs.voiceOut === 'off') return false;
    const wantServer = prefs.voiceOut === 'server' || (prefs.voiceOut === 'auto' && serverAvailable);
    if (wantServer && serverAvailable && audio && !serverTtsBroken) {
      onState('thinking');
      try { return await speakServer(text, my); }
      catch (e) {
        if (my !== token) return false;
        if (e?.name === 'NotAllowedError') onNotice('Safari bloqueó el audio: toca la pantalla una vez y repite.');
        else { onNotice('Voz natural no disponible (' + (e?.message || 'error') + '). Uso la voz del iPhone.'); if (e?.status === 501) serverTtsBroken = true; }
      }
    }
    return speakDevice(text, my);
  }

  return {
    speak, stop, unlock,
    get voices() { return (voices.length ? voices : loadVoices()).filter(v => /^es/i.test(v.lang)); },
    get supported() { return Boolean(synth) || Boolean(audio); },
  };
}
