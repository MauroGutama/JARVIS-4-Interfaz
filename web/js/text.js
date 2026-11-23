// Utilidades de texto puras (sin DOM) para respuestas, memoria y voz.

const MEMORY_TAG = /<memoria>([\s\S]*?)<\/memoria>/gi;

/** Separa las etiquetas <memoria>…</memoria> que propone la IA del texto visible. */
export function extractMemoryTags(text) {
  const memories = [];
  const clean = String(text || '').replace(MEMORY_TAG, (_, m) => {
    const v = m.trim();
    if (v) memories.push(v);
    return '';
  }).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { clean, memories };
}

/** Limpia Markdown y símbolos que la síntesis de voz leería mal. */
export function toSpeakable(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' (bloque de código omitido) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~)(.+?)\1/g, '$2')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Divide el texto en fragmentos por frases para que la síntesis del iPhone
 * empiece antes y no corte locuciones largas.
 */
export function chunkSentences(text, max = 220) {
  const src = String(text || '').trim();
  if (!src) return [];
  const sentences = src.match(/[^.!?…]+[.!?…]+["»”)]*|[^.!?…]+$/g) || [src];
  const out = [];
  let cur = '';
  for (let s of sentences) {
    s = s.trim();
    if (!s) continue;
    while (s.length > max) {
      let cut = s.lastIndexOf(',', max);
      if (cut < max * 0.4) cut = s.lastIndexOf(' ', max);
      if (cut <= 0) cut = max;
      if (cur) { out.push(cur); cur = ''; }
      out.push(s.slice(0, cut + 1).trim());
      s = s.slice(cut + 1).trim();
    }
    if ((cur + ' ' + s).trim().length > max) { if (cur) out.push(cur); cur = s; }
    else cur = (cur + ' ' + s).trim();
  }
  if (cur) out.push(cur);
  return out;
}

/** Escoge la mejor voz española disponible en el dispositivo. */
export function pickVoice(voices, { preferredURI = '', lang = 'es-ES' } = {}) {
  const list = Array.from(voices || []);
  if (preferredURI) {
    const v = list.find(x => x.voiceURI === preferredURI);
    if (v) return v;
  }
  const es = list.filter(v => String(v.lang || '').toLowerCase().replace('_', '-').startsWith('es'));
  if (!es.length) return null;
  const score = v => {
    const name = String(v.name || '');
    const l = String(v.lang || '').replace('_', '-');
    let s = 0;
    if (/premium|enhanced|mejorada|neural|natural/i.test(name)) s += 50;
    if (/siri/i.test(name)) s += 30;
    if (/jorge|diego|juan|enrique|pablo|carlos|álvaro|alvaro/i.test(name)) s += 15;
    if (/mónica|monica|paulina|marisol|lucía|lucia|elvira/i.test(name)) s += 8;
    if (l === lang) s += 10; else if (/^es-(MX|US|419)/i.test(l)) s += 5;
    if (/eloquence|bells|bad news|good news|organ|zarvox|trinoids|whisper|wobble|jester|cellos|bubbles|boing|albert|fred|junior|ralph|grandma|grandpa|rocko|shelley|sandy|flo|reed/i.test(name)) s -= 40;
    if (v.localService) s += 2;
    return s;
  };
  return es.slice().sort((a, b) => score(b) - score(a))[0];
}

/** Tamaño reducido manteniendo proporción para enviar imágenes ligeras. */
export function scaledSize(w, h, maxSide = 1024) {
  if (!w || !h) return { width: 0, height: 0 };
  const k = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.round(w * k), height: Math.round(h * k) };
}
