// Conectores de IA. Las claves se leen SOLO de variables de entorno del servidor.
import { localReply } from '../web/js/local-brain.js';

export const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const AUDIO_EXT = { 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3' };

export class UpstreamError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

export function detectProvider(env) {
  const p = String(env.AI_PROVIDER || '').toLowerCase();
  if (p === 'openai' && env.OPENAI_API_KEY) return 'openai';
  if (p === 'anthropic' && env.ANTHROPIC_API_KEY) return 'anthropic';
  if (p === 'offline') return 'offline';
  if (env.OPENAI_API_KEY) return 'openai';
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'offline';
}

export function config(env) {
  const provider = detectProvider(env);
  const openaiBase = (env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '');
  const anthropicBase = (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
  const model = provider === 'openai' ? (env.OPENAI_MODEL || 'gpt-4o-mini')
    : provider === 'anthropic' ? (env.ANTHROPIC_MODEL || 'claude-sonnet-5-5') : 'local';
  const hasOpenAI = Boolean(env.OPENAI_API_KEY);
  return {
    provider, model, openaiBase, anthropicBase,
    features: {
      chat: provider !== 'offline',
      vision: provider !== 'offline',
      tts: hasOpenAI && env.DISABLE_SERVER_TTS !== '1',
      stt: hasOpenAI && env.DISABLE_SERVER_STT !== '1',
    },
  };
}

export function systemPrompt({ memories = [], now = new Date(), allowMemoryTags = false, tz } = {}) {
  let fecha;
  try { fecha = now.toLocaleString('es', { dateStyle: 'full', timeStyle: 'short', timeZone: tz || undefined }); }
  catch { fecha = now.toLocaleString('es', { dateStyle: 'full', timeStyle: 'short' }); }
  const lines = [
    'Eres JARVIS 4.0, un asistente personal de inteligencia artificial con personalidad serena, elegante, leal y con un toque de humor seco británico.',
    'Respondes siempre en español, de forma clara y breve (normalmente 1-4 frases), porque tus respuestas se leen en voz alta en un iPhone.',
    'Evita tablas y Markdown complejo salvo que el usuario lo pida. No inventes datos: si no sabes algo o no tienes acceso a información en tiempo real, dilo.',
    'Cuando recibas una imagen de la cámara, descríbela con precisión y responde a la pregunta del usuario sobre ella. No identifiques a personas reales por su rostro.',
    'VIERNES y EL AYUDANTE son otros proyectos del usuario; no tienes acceso a ellos.',
    `Fecha y hora actual del usuario: ${fecha}.`,
  ];
  if (memories.length) {
    lines.push('Recuerdos que el usuario te ha permitido conservar (úsalos solo cuando sean relevantes):');
    for (const m of memories.slice(0, 100)) lines.push(`- ${String(m).slice(0, 300)}`);
  }
  if (allowMemoryTags) {
    lines.push('Si el usuario comparte un dato personal duradero y útil (preferencias, nombre, proyectos), puedes proponer guardarlo añadiendo al final <memoria>dato breve en tercera persona</memoria>. Nunca guardes contraseñas, datos de salud, financieros ni de terceros.');
  }
  return lines.join('\n');
}

/** Valida y normaliza el historial que envía el cliente. */
export function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) throw new UpstreamError('messages debe ser una lista', 400);
  const out = [];
  for (const m of messages.slice(-16)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const content = String(m.content ?? '').slice(0, 4000).trim();
    if (!content) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) prev.content += '\n' + content;
    else out.push({ role: m.role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  if (!out.length || out[out.length - 1].role !== 'user') throw new UpstreamError('El último mensaje debe ser del usuario', 400);
  return out;
}

export function validateImage(image) {
  if (!image) return null;
  const mediaType = String(image.mediaType || '');
  const data = String(image.data || '');
  if (!IMAGE_TYPES.has(mediaType)) throw new UpstreamError('Formato de imagen no admitido', 400);
  if (!/^[A-Za-z0-9+/=]+$/.test(data) || data.length < 100) throw new UpstreamError('Imagen no válida', 400);
  if (data.length > 7_000_000) throw new UpstreamError('Imagen demasiado grande', 413);
  return { mediaType, data };
}

async function readUpstreamError(res) {
  let detail = '';
  try { const j = await res.json(); detail = j?.error?.message || j?.error?.type || ''; } catch { /* sin cuerpo */ }
  const status = res.status === 429 ? 429 : res.status === 401 || res.status === 403 ? 502 : 502;
  const msg = res.status === 401 || res.status === 403 ? 'El proveedor de IA rechazó la clave del servidor (revisa la configuración).'
    : res.status === 429 ? 'El proveedor de IA está limitando las peticiones. Intenta de nuevo en unos segundos.'
      : `Error del proveedor de IA (${res.status}).`;
  return new UpstreamError(detail && res.status !== 401 ? `${msg} ${detail.slice(0, 200)}` : msg, status);
}

export async function chat({ messages, image, memories = [], allowMemoryTags = false, tz, env, fetchImpl = fetch, now = new Date() }) {
  const cfg = config(env);
  const msgs = sanitizeMessages(messages);
  const img = validateImage(image);
  const system = systemPrompt({ memories, now, allowMemoryTags, tz });
  const last = msgs[msgs.length - 1].content;

  if (cfg.provider === 'offline') {
    const text = img ? 'Puedo ver que me has enviado una imagen, pero para analizarla necesito que el servidor tenga configurada una clave de inteligencia artificial.' : localReply(last, { now, memories: memories.map(text => ({ text })) });
    return { text, provider: 'offline', model: 'local' };
  }

  if (cfg.provider === 'openai') {
    const apiMsgs = [{ role: 'system', content: system }, ...msgs.map(m => ({ role: m.role, content: m.content }))];
    if (img) {
      apiMsgs[apiMsgs.length - 1] = {
        role: 'user',
        content: [
          { type: 'text', text: last },
          { type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.data}`, detail: 'auto' } },
        ],
      };
    }
    const res = await fetchImpl(`${cfg.openaiBase}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: cfg.model, messages: apiMsgs, max_completion_tokens: 700 }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw await readUpstreamError(res);
    const j = await res.json();
    const text = j?.choices?.[0]?.message?.content;
    if (!text) throw new UpstreamError('Respuesta vacía del proveedor de IA');
    return { text: String(text).trim(), provider: 'openai', model: cfg.model };
  }

  // Anthropic (Claude)
  const apiMsgs = msgs.map(m => ({ role: m.role, content: m.content }));
  if (img) {
    apiMsgs[apiMsgs.length - 1] = {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } },
        { type: 'text', text: last },
      ],
    };
  }
  const res = await fetchImpl(`${cfg.anthropicBase}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: cfg.model, max_tokens: 700, system, messages: apiMsgs }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw await readUpstreamError(res);
  const j = await res.json();
  const text = (j?.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  if (!text) throw new UpstreamError('Respuesta vacía del proveedor de IA');
  return { text, provider: 'anthropic', model: cfg.model };
}

/** Voz natural del servidor (OpenAI TTS). Devuelve un ArrayBuffer MP3. */
export async function tts({ text, env, fetchImpl = fetch }) {
  const cfg = config(env);
  if (!cfg.features.tts) throw new UpstreamError('La voz del servidor no está configurada', 501);
  const input = String(text || '').trim().slice(0, 1500);
  if (!input) throw new UpstreamError('Texto vacío', 400);
  const model = env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
  const body = { model, voice: env.OPENAI_TTS_VOICE || 'onyx', input, response_format: 'mp3' };
  if (/gpt-4o/.test(model)) body.instructions = env.OPENAI_TTS_INSTRUCTIONS || 'Habla en español neutro con voz masculina serena, elegante y segura, como un mayordomo digital británico. Ritmo natural, ni rápido ni lento.';
  const res = await fetchImpl(`${cfg.openaiBase}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw await readUpstreamError(res);
  return await res.arrayBuffer();
}

/** Transcripción de audio grabado (alternativa cuando Safari no reconoce voz). */
export async function transcribe({ audio, contentType, env, fetchImpl = fetch }) {
  const cfg = config(env);
  if (!cfg.features.stt) throw new UpstreamError('La transcripción del servidor no está configurada', 501);
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  const ext = AUDIO_EXT[type];
  if (!ext) throw new UpstreamError('Formato de audio no admitido', 415);
  if (!audio || audio.length < 500) throw new UpstreamError('Audio vacío o demasiado corto', 400);
  const form = new FormData();
  form.append('file', new Blob([audio], { type }), `voz.${ext}`);
  form.append('model', env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe');
  form.append('language', 'es');
  const res = await fetchImpl(`${cfg.openaiBase}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw await readUpstreamError(res);
  const j = await res.json();
  return { text: String(j?.text || '').trim() };
}
