// JARVIS 4.0 · Orquestador de la interfaz.
import { createApi } from './js/api.js';
import { MemoryStore, parseMemoryCommand } from './js/memory.js';
import { localReply } from './js/local-brain.js';
import { extractMemoryTags } from './js/text.js';
import { createSpeaker } from './js/speech-out.js';
import { createListener, detectCapabilities } from './js/speech-in.js';
import { createCamera, fileToJpeg } from './js/camera.js';

const $ = s => document.querySelector(s);
const els = {
  msgs: $('#messages'), core: $('#core'), holo: $('#holo'), state: $('#state'), stateText: $('#stateText'), hint: $('#hint'),
  query: $('#query'), form: $('#form'), mic: $('#mic'), aiBadge: $('#aiBadge'),
  attach: $('#attach'), attachImg: $('#attachImg'),
};

// ---------- Preferencias (solo en el dispositivo) ----------
const PREFS_KEY = 'jarvis4.prefs.v1';
const DEFAULT_PREFS = { provider: '', voiceIn: 'auto', voiceOut: 'device', voiceURI: '', rate: 1, pitch: 0.9, primeVoice: true, lowFx: false, code: '' };
function loadPrefs() {
  let p; try { p = { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { p = { ...DEFAULT_PREFS }; }
  if (p.voiceOut === 'auto') p.voiceOut = 'device'; // v4.2: la voz de Safari es la predeterminada (sin coste)
  return p;
}
let prefs = loadPrefs();
function savePrefs(patch) { prefs = { ...prefs, ...patch }; try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* modo privado */ } }

const memory = new MemoryStore();
const api = createApi({ getCode: () => prefs.code });
let server = null;           // respuesta de /api/health o null si no hay conexión
let pendingImage = null;     // imagen adjunta lista para enviar
let busy = false;
const session = [];          // historial si el usuario no quiere guardarlo

// ---------- Estado visual ----------
const STATE_LABEL = { idle: 'EN LÍNEA', listening: 'ESCUCHANDO', preparing: 'PREPARANDO', thinking: 'PROCESANDO', speaking: 'HABLANDO', offline: 'MODO LOCAL' };
let voiceState = 'idle', listenState = 'idle';
function render() {
  const s = listenState !== 'idle' ? listenState : busy ? 'thinking' : voiceState !== 'idle' ? voiceState : (activeProvider() ? 'idle' : 'offline');
  els.stateText.textContent = STATE_LABEL[s] || 'EN LÍNEA';
  els.state.className = 'status' + (s === 'offline' ? ' warn' : '') + (['thinking', 'preparing', 'listening'].includes(s) ? ' busy' : '');
  els.core.classList.toggle('talking', s === 'speaking');
  els.core.classList.toggle('listening', s === 'listening' || s === 'preparing');
  els.core.classList.toggle('thinking', s === 'thinking');
  els.holo.classList.toggle('talking', s === 'speaking');
  els.mic.classList.toggle('on', listenState !== 'idle');
  els.mic.textContent = listenState === 'idle' ? '🎙 HABLAR' : listenState === 'thinking' ? '… TRANSCRIBIENDO' : '■ DETENER';
  document.body.dataset.state = s;
}
const hint = t => { els.hint.textContent = t; };

function add(text, cls, image) {
  const e = document.createElement('div');
  e.className = 'msg ' + cls;
  if (image) { const i = document.createElement('img'); i.src = image; i.alt = 'Imagen enviada'; e.append(i); }
  e.append(document.createTextNode(text));
  els.msgs.append(e);
  els.msgs.scrollTop = els.msgs.scrollHeight;
  return e;
}
function typing() {
  const e = document.createElement('div'); e.className = 'msg ai'; e.setAttribute('aria-label', 'JARVIS está pensando');
  e.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  els.msgs.append(e); els.msgs.scrollTop = els.msgs.scrollHeight; return e;
}

// ---------- Voz ----------
const speaker = createSpeaker({ api, getPrefs: () => prefs, onState: s => { voiceState = s === 'thinking' ? 'idle' : s; render(); }, onNotice: hint });
const say = text => speaker.speak(text, { serverAvailable: Boolean(server?.features?.tts) });

const listener = createListener({
  api, getPrefs: () => prefs, getServerStt: () => Boolean(server?.features?.stt),
  speakPrime: done => {
    if (!('speechSynthesis' in window)) return done();
    let started = false; const go = () => { if (!started) { started = true; done(); } };
    const u = new SpeechSynthesisUtterance('Te escucho.'); u.lang = 'es-ES'; u.rate = 1.15; u.volume = 0.65;
    u.onend = go; u.onerror = go; speechSynthesis.speak(u); setTimeout(go, 2500);
  },
  onState: s => { listenState = s; render(); },
  onInterim: t => { els.query.value = t; },
  onFinal: t => { els.query.value = ''; submit(t); },
  onNotice: hint,
});

// ---------- Proveedor de IA ----------
/** Proveedor efectivo: el elegido en Ajustes si el servidor lo ofrece; null = modo básico local. */
function activeProvider() {
  if (!server || prefs.provider === 'offline') return null;
  const list = (server.providers || []).filter(p => p.id !== 'offline');
  return list.find(p => p.id === prefs.provider) || list.find(p => p.id === server.provider) || null;
}

// ---------- Conversación ----------
function history() { return memory.settings.saveHistory ? memory.history : session.slice(-30); }
function remember(role, content) { if (memory.settings.saveHistory) memory.pushHistory(role, content); else { session.push({ role, content }); session.splice(0, Math.max(0, session.length - 30)); } }

function handleMemoryCommand(cmd) {
  const s = memory.settings;
  if (!s.enabled) return 'La memoria está desactivada. Puedes activarla en el panel Memoria.';
  if (cmd.type === 'remember') { const f = memory.addFact(cmd.text, 'user'); renderMemory(); return f ? `Entendido. Recordaré que ${f.text}.` : 'No pude guardar ese recuerdo.'; }
  if (cmd.type === 'forget') { const n = memory.forgetMatching(cmd.text); renderMemory(); return n ? `Hecho. He olvidado ${n === 1 ? 'ese recuerdo' : n + ' recuerdos'}.` : 'No encontré ningún recuerdo con eso.'; }
  if (cmd.type === 'forget-all') { memory.clearFacts(); renderMemory(); return 'He borrado todos mis recuerdos sobre ti.'; }
  if (cmd.type === 'list') { const f = memory.facts; return f.length ? 'Esto es lo que recuerdo: ' + f.map(x => x.text).join('; ') + '.' : 'Todavía no tengo recuerdos guardados.'; }
  return null;
}

async function submit(raw) {
  const q = String(raw || '').trim();
  const image = pendingImage;
  if ((!q && !image) || busy) return;
  const text = q || '¿Qué ves en esta imagen?';
  speaker.unlock();
  speaker.stop();
  clearAttachment();
  add(text, 'human', image?.dataUrl);

  const cmd = !image && parseMemoryCommand(text);
  if (cmd) {
    const r = handleMemoryCommand(cmd);
    add(r, 'ai'); remember('user', text); remember('assistant', r); say(r); return;
  }

  const prov = activeProvider();
  if (!prov) {
    const r = image ? 'Estoy en modo básico, sin inteligencia artificial: para analizar imágenes elige un proveedor de IA en Ajustes.' : localReply(text, { memories: memory.settings.enabled ? memory.facts : [] });
    add(r, 'ai'); remember('user', text); remember('assistant', r); say(r); return;
  }

  busy = true; render();
  const t = typing();
  const messages = [...history(), { role: 'user', content: text }];
  try {
    const out = await api.chat({
      provider: prov.id, messages, image: image ? { mediaType: image.mediaType, data: image.data } : undefined,
      memories: memory.contextFacts(), autoLearn: memory.settings.enabled && memory.settings.autoLearn,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    const { clean, memories } = extractMemoryTags(out.text);
    t.remove();
    add(clean, 'ai');
    remember('user', image ? `[Imagen adjunta] ${text}` : text);
    remember('assistant', clean);
    if (memories.length && memory.settings.enabled && memory.settings.autoLearn) {
      const saved = memories.map(m => memory.addFact(m, 'auto')).filter(Boolean);
      if (saved.length) { add('🧠 Recuerdo guardado: ' + saved.map(f => f.text).join('; ') + ' (puedes borrarlo en Memoria)', 'sys'); renderMemory(); }
    }
    busy = false; render();
    say(clean);
  } catch (e) {
    t.remove();
    busy = false;
    add('⚠ ' + e.message, 'sys err');
    if (e.status === 0) { server = null; updateServerUi(); }
    if (e.status === 401) openSheet('setSheet');
    if (e.status === 402 || e.status === 429) add('Consejo: en ⚙ AJUSTES › Cerebro de IA puedes cambiar a otro proveedor gratuito o al modo básico.', 'sys');
    const r = image ? 'No pude analizar la imagen en este momento.' : localReply(text, { memories: memory.settings.enabled ? memory.facts : [] });
    add(r, 'ai');
    render(); say(r);
  }
}

// ---------- Cámara ----------
const camera = createCamera($('#video'));
const camMsg = t => { $('#camMsg').textContent = t || ''; };
async function openCamera() {
  openSheet('camSheet'); camMsg('Iniciando cámara…');
  try { await camera.open(); camMsg(''); }
  catch (e) { camMsg(e.message); }
}
function setAttachment(img) { pendingImage = img; els.attachImg.src = img.dataUrl; els.attach.hidden = false; }
function clearAttachment() { pendingImage = null; els.attach.hidden = true; els.attachImg.removeAttribute('src'); }
function analyze(img) {
  const question = $('#camQuestion').value.trim() || '¿Qué ves en esta imagen?';
  closeSheet('camSheet');
  setAttachment(img);
  submit(question);
}
$('#cam').addEventListener('click', () => { speaker.unlock(); openCamera(); });
$('#shoot').addEventListener('click', () => { try { analyze(camera.capture()); } catch (e) { camMsg(e.message); } });
$('#flip').addEventListener('click', async () => { try { await camera.flip(); camMsg(''); } catch (e) { camMsg(e.message); } });
$('#photo').addEventListener('change', async e => {
  const f = e.target.files?.[0]; e.target.value = '';
  if (!f) return;
  try { analyze(await fileToJpeg(f)); } catch (err) { camMsg(err.message); }
});
$('#attachClear').addEventListener('click', clearAttachment);

// ---------- Hojas ----------
function openSheet(id) { document.getElementById(id).hidden = false; if (id === 'memSheet') renderMemory(); if (id === 'setSheet') renderSettings(); }
function closeSheet(id) { document.getElementById(id).hidden = true; if (id === 'camSheet') camera.close(); }
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeSheet(b.dataset.close)));
document.querySelectorAll('.sheet').forEach(s => s.addEventListener('click', e => { if (e.target === s) closeSheet(s.id); }));
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.sheet:not([hidden])').forEach(s => closeSheet(s.id)); });
$('#memBtn').addEventListener('click', () => openSheet('memSheet'));
$('#setBtn').addEventListener('click', () => openSheet('setSheet'));
els.state.addEventListener('click', () => openSheet('setSheet'));

// ---------- Memoria (UI) ----------
function renderMemory() {
  const s = memory.settings;
  $('#mEnabled').checked = s.enabled; $('#mShare').checked = s.shareWithAI; $('#mAuto').checked = s.autoLearn; $('#mHistory').checked = s.saveHistory;
  const list = $('#mList'); list.textContent = '';
  const facts = memory.facts;
  $('#mCount').textContent = `(${facts.length})`;
  if (!facts.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Sin recuerdos guardados'; list.append(li); }
  for (const f of facts) {
    const li = document.createElement('li');
    const sp = document.createElement('span'); sp.textContent = f.text;
    const sm = document.createElement('small'); sm.textContent = f.source === 'auto' ? 'IA' : 'tú';
    const b = document.createElement('button'); b.type = 'button'; b.textContent = '✕'; b.setAttribute('aria-label', 'Borrar recuerdo: ' + f.text);
    b.addEventListener('click', () => { memory.removeFact(f.id); renderMemory(); });
    li.append(sp, sm, b); list.append(li);
  }
}
for (const [id, key] of [['mEnabled', 'enabled'], ['mShare', 'shareWithAI'], ['mAuto', 'autoLearn'], ['mHistory', 'saveHistory']]) {
  $('#' + id).addEventListener('change', e => {
    memory.updateSettings({ [key]: e.target.checked });
    if (key === 'saveHistory' && !e.target.checked) { memory.clearHistory(); hint('Historial borrado: la conversación ya no se guardará en el dispositivo.'); }
  });
}
$('#mForm').addEventListener('submit', e => { e.preventDefault(); const v = $('#mInput').value; $('#mInput').value = ''; if (!memory.addFact(v)) hint('No se pudo guardar (¿memoria desactivada?).'); renderMemory(); });
$('#mExport').addEventListener('click', () => {
  const blob = new Blob([memory.exportJSON()], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'jarvis-memoria.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});
$('#mClearHist').addEventListener('click', () => { memory.clearHistory(); session.length = 0; els.msgs.textContent = ''; greet(); hint('Historial de conversación borrado.'); });
$('#mWipe').addEventListener('click', () => {
  if (!confirm('¿Borrar todos los recuerdos, el historial y los ajustes de memoria de este dispositivo?')) return;
  memory.wipeAll(); session.length = 0; els.msgs.textContent = ''; greet(); renderMemory(); hint('Memoria borrada por completo.');
});

// ---------- Ajustes y diagnóstico ----------
function renderSettings() {
  const provSel = $('#sProvider'); provSel.length = 0;
  for (const p of server?.providers || [{ id: 'offline', label: 'Básico (sin API)', free: true }]) {
    provSel.append(new Option(`${p.label}${p.id === 'offline' ? '' : p.free ? ' · gratis' : ' · de pago'}${p.id !== 'offline' && !p.vision ? ' · sin cámara' : ''}`, p.id));
  }
  const cur = activeProvider();
  provSel.value = cur ? cur.id : 'offline';
  $('#sProviderNote').textContent = cur
    ? `Modelo: ${cur.model}. ${cur.free ? 'Nivel gratuito con límites diarios; sin cargos mientras no añadas un método de pago en el proveedor.' : 'Proveedor de pago: consume créditos de tu cuenta.'} Edad mínima según sus términos: ${cur.minAge}+.`
    : 'Modo básico: hora, fecha, memoria y comandos locales. No usa ninguna API ni internet para responder.';
  $('#sCode').value = prefs.code; $('#sVoiceIn').value = prefs.voiceIn; $('#sVoiceOut').value = prefs.voiceOut;
  $('#sRate').value = prefs.rate; $('#sPrime').checked = prefs.primeVoice; $('#sLowFx').checked = prefs.lowFx;
  const sel = $('#sVoice'); sel.length = 1;
  for (const v of speaker.voices) { const o = new Option(`${v.name} (${v.lang})`, v.voiceURI); sel.append(o); }
  sel.value = prefs.voiceURI;
  const caps = detectCapabilities(window);
  const yes = b => b ? '<span class="ok">sí</span>' : '<span class="no">no</span>';
  const f = server?.features || {};
  $('#diag').innerHTML = [
    `<b>Servidor:</b> ${server ? '<span class="ok">conectado</span>' : '<span class="no">sin conexión (modo básico)</span>'}`,
    server ? `<b>IA activa:</b> ${cur ? esc(cur.label) + ' · ' + esc(cur.model) : 'modo básico'}` : '',
    server ? `<b>Solo proveedores gratuitos:</b> ${yes(server.freeOnly)}${server.dailyRemaining != null ? ` · <b>Peticiones restantes hoy:</b> ${esc(server.dailyRemaining)}` : ''}` : '',
    `<b>Contexto seguro (HTTPS):</b> ${yes(window.isSecureContext)}`,
    `<b>Reconocimiento Safari:</b> ${yes(caps.native)} · <b>Grabación:</b> ${yes(caps.recorder)} · <b>Transcripción servidor:</b> ${yes(f.stt)}`,
    `<b>Voz natural servidor:</b> ${yes(f.tts)} · <b>Voces del iPhone en español:</b> ${speaker.voices.length}`,
    `<b>Cámara:</b> ${yes(Boolean(navigator.mediaDevices?.getUserMedia))} · <b>Visión IA:</b> ${yes(f.vision)}`,
    `<b>App instalada (pantalla de inicio):</b> ${yes(caps.standalone)}`,
  ].filter(Boolean).join('<br>');
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
$('#sCode').addEventListener('change', e => { savePrefs({ code: e.target.value.trim() }); checkServer(); });
$('#sProvider').addEventListener('change', e => { savePrefs({ provider: e.target.value }); updateServerUi(); renderSettings(); hint(e.target.value === 'offline' ? 'Modo básico activado: sin API, sin coste.' : 'Proveedor de IA cambiado.'); });
$('#sVoiceIn').addEventListener('change', e => savePrefs({ voiceIn: e.target.value }));
$('#sVoiceOut').addEventListener('change', e => savePrefs({ voiceOut: e.target.value }));
$('#sVoice').addEventListener('change', e => savePrefs({ voiceURI: e.target.value }));
$('#sRate').addEventListener('change', e => savePrefs({ rate: Number(e.target.value) }));
$('#sPrime').addEventListener('change', e => savePrefs({ primeVoice: e.target.checked }));
$('#sLowFx').addEventListener('change', e => { savePrefs({ lowFx: e.target.checked }); applyFx(); });
$('#sRecheck').addEventListener('click', async () => { await checkServer(); renderSettings(); });

// ---------- Controles principales ----------
els.form.addEventListener('submit', e => { e.preventDefault(); const q = els.query.value; els.query.value = ''; submit(q); });
els.mic.addEventListener('click', () => { speaker.unlock(); if (!listener.active) speaker.stop(); listener.toggle(); });
$('#test').addEventListener('click', () => { speaker.unlock(); say('Hola. Soy JARVIS 4 punto cero. Todos mis sistemas están operativos.'); });
$('#stop').addEventListener('click', () => { speaker.stop(); listener.stop(); hint('Silencio.'); });
document.addEventListener('pointerdown', () => speaker.unlock(), { once: true, capture: true });

// ---------- Servidor ----------
function updateServerUi() {
  const p = activeProvider();
  els.aiBadge.textContent = p ? `IA · ${p.label}` : 'MODO BÁSICO';
  render();
}
async function checkServer() {
  try { server = await api.health(); }
  catch { server = null; }
  updateServerUi();
  if (!server) hint('Sin conexión con el servidor: modo básico. Abre JARVIS desde la dirección de tu servidor para activar la IA.');
  else if (!activeProvider()) hint('Modo básico (sin API): prueba la interfaz, la voz, la memoria y los comandos locales. Elige un cerebro de IA en Ajustes.');
  else hint('Toca HABLAR, escribe o usa la CÁMARA.');
  return server;
}

// ---------- Rendimiento ----------
function applyFx() {
  const weak = (navigator.deviceMemory && navigator.deviceMemory <= 2) || matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.body.classList.toggle('lowfx', prefs.lowFx || weak);
}
document.addEventListener('visibilitychange', () => {
  document.body.classList.toggle('paused', document.hidden);
  if (document.hidden) { listener.stop(); if (!$('#camSheet').hidden) closeSheet('camSheet'); }
});

// ---------- Arranque ----------
function greet() { add('Saludos. Soy JARVIS 4.0. Voz, visión y memoria listas. ¿En qué puedo ayudarte?', 'ai'); }
function restore() {
  const h = memory.settings.saveHistory ? memory.history : [];
  if (h.length) { add('— conversación anterior —', 'sys'); for (const m of h.slice(-12)) add(m.content, m.role === 'user' ? 'human' : 'ai'); }
  greet();
}
applyFx(); restore(); render(); checkServer();
navigator.storage?.persist?.().catch(() => {});
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
window.__jarvis = { memory, get server() { return server; }, submit };
