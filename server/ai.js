// Conectores de IA. Las claves se leen SOLO de variables de entorno del servidor.
// Registro de proveedores: el usuario elige uno en Ajustes entre los que el servidor tenga configurados.
import { localReply } from '../web/js/local-brain.js';

export const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const AUDIO_EXT = { 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3' };

export class UpstreamError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

/**
 * Proveedores compatibles. `free`: tiene nivel gratuito sin tarjeta. `minAge`: edad mínima según sus términos.
 * Los nombres de modelo cambian con el tiempo: todos se pueden sustituir con variables de entorno.
 */
export const REGISTRY = {
  github: {
    label: 'GitHub Models', free: true, minAge: 13, kind: 'openai-compatible',
    keyEnv: 'GITHUB_MODELS_TOKEN', modelEnv: 'GITHUB_MODELS_MODEL', defaultModel: 'openai/gpt-4.1-mini',
    baseEnv: 'GITHUB_MODELS_BASE_URL', defaultBase: 'https://models.github.ai/inference', vision: true,
  },
  gemini: {
    label: 'Google Gemini', free: true, minAge: 18, kind: 'openai-compatible',
    keyEnv: 'GEMINI_API_KEY', modelEnv: 'GEMINI_MODEL', defaultModel: 'gemini-flash-latest',
    baseEnv: 'GEMINI_BASE_URL', defaultBase: 'https://generativelanguage.googleapis.com/v1beta/openai', vision: true,
  },
  groq: {
    label: 'Groq', free: true, minAge: 18, kind: 'openai-compatible',
    keyEnv: 'GROQ_API_KEY', modelEnv: 'GROQ_MODEL', defaultModel: 'llama-3.3-70b-versatile',
    visionModelEnv: 'GROQ_VISION_MODEL', defaultVisionModel: 'meta-llama/llama-4-scout-17b-16e-instruct',
    baseEnv: 'GROQ_BASE_URL', defaultBase: 'https://api.groq.com/openai/v1', vision: true,
  },
  openrouter: {
    label: 'OpenRouter (modelos :free)', free: true, minAge: 18, kind: 'openai-compatible',
    keyEnv: 'OPENROUTER_API_KEY', modelEnv: 'OPENROUTER_MODEL', defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    baseEnv: 'OPENROUTER_BASE_URL', defaultBase: 'https://openrouter.ai/api/v1', vision: false,
  },
  openai: {
    label: 'OpenAI', free: false, minAge: 13, kind: 'openai-compatible',
    keyEnv: 'OPENAI_API_KEY', modelEnv: 'OPENAI_MODEL', defaultModel: 'gpt-4o-mini',
    baseEnv: 'OPENAI_BASE_URL', defaultBase: 'https://api.openai.com', basePath: '/v1', vision: true, tokenParam: 'max_completion_tokens',
  },
  anthropic: {
    label: 'Anthropic Claude', free: false, minAge: 18, kind: 'anthropic',
    keyEnv: 'ANTHROPIC_API_KEY', modelEnv: 'ANTHROPIC_MODEL', defaultModel: 'claude-sonnet-5-5',
    baseEnv: 'ANTHROPIC_BASE_URL', defaultBase: 'https://api.anthropic.com', vision: true,
  },
};
export const FREE_ORDER = ['github', 'gemini', 'groq', 'openrouter', 'openai', 'anthropic'];
export const OFFLINE = { id: 'offline', label: 'Básico (sin API)', model: 'local', free: true, vision: false, minAge: 0 };

const base = (p, env) => (env[p.baseEnv] || p.defaultBase).replace(/\/+$/, '') + (p.basePath || '');
const modelOf = (p, env) => env[p.modelEnv] || p.defaultModel;

/** Protección contra cargos ACTIVADA por defecto: solo se desactiva con FREE_ONLY=0 explícito. */
export function freeOnly(env) { return !(env.FREE_ONLY === '0' || env.FREE_ONLY === 'false'); }

/** Proveedores con clave configurada (y permitidos por FREE_ONLY). */
export function availableProviders(env) {
  return FREE_ORDER.filter(id => env[REGISTRY[id].keyEnv] && (REGISTRY[id].free || !freeOnly(env)));
}

export function detectProvider(env) {
  const avail = availableProviders(env);
  const wanted = String(env.AI_PROVIDER || '').toLowerCase();
  if (wanted === 'offline') return 'offline';
  if (avail.includes(wanted)) return wanted;
  return avail[0] || 'offline';
}

export function sttProvider(env) {
  if (env.DISABLE_SERVER_STT === '1') return null;
  if (env.GROQ_API_KEY) return 'groq';                 // Whisper gratuito en Groq
  if (env.OPENAI_API_KEY && !freeOnly(env)) return 'openai';
  return null;
}

export function config(env) {
  const provider = detectProvider(env);
  const avail = availableProviders(env);
  const p = REGISTRY[provider];
  const providers = [
    ...avail.map(id => ({ id, label: REGISTRY[id].label, model: modelOf(REGISTRY[id], env), free: REGISTRY[id].free, vision: REGISTRY[id].vision, minAge: REGISTRY[id].minAge })),
    OFFLINE,
  ];
  return {
    provider, model: p ? modelOf(p, env) : 'local', providers, freeOnly: freeOnly(env),
    openaiBase: base(REGISTRY.openai, env).replace(/\/v1$/, ''),
    features: {
      chat: provider !== 'offline',
      vision: Boolean(p?.vision),
      tts: Boolean(env.OPENAI_API_KEY) && !freeOnly(env) && env.DISABLE_SERVER_TTS !== '1',
      stt: Boolean(sttProvider(env)),
    },
  };
}

/** Proveedor efectivo para una petición: el pedido por el usuario si está disponible. */
export function resolveProvider(env, requested) {
  const r = String(requested || '').toLowerCase();
  if (r === 'offline') return 'offline';
  if (r && availableProviders(env).includes(r)) return r;
  if (r && REGISTRY[r]) throw new UpstreamError(`El proveedor «${REGISTRY[r].label}» no está configurado o no está permitido en este servidor.`, 400);
  return detectProvider(env);
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

async function readUpstreamError(res, label = 'IA') {
  let detail = '';
  try { const j = await res.json(); detail = j?.error?.message || j?.error?.type || j?.message || ''; } catch { /* sin cuerpo */ }
  const s = res.status;
  if (s === 401 || s === 403) return new UpstreamError(`${label} rechazó la clave del servidor (revisa la configuración en Render).`, 502);
  if (s === 402) return new UpstreamError(`${label} indica que no hay créditos disponibles. Elige un proveedor gratuito en Ajustes.`, 402);
  if (s === 429) return new UpstreamError(`${label}: límite gratuito o de velocidad alcanzado. Espera un poco o elige otro proveedor en Ajustes.`, 429);
  if (s === 404) return new UpstreamError(`${label}: modelo no encontrado. Revisa el nombre del modelo en las variables de entorno.`, 502);
  return new UpstreamError(`Error de ${label} (${s}).${detail ? ' ' + String(detail).slice(0, 200) : ''}`, 502);
}

async function chatOpenAICompatible({ id, p, env, fetchImpl, system, msgs, img }) {
  let model = modelOf(p, env);
  if (img && p.visionModelEnv) model = env[p.visionModelEnv] || p.defaultVisionModel;
  if (img && !p.vision) throw new UpstreamError(`${p.label} no admite imágenes con la configuración actual. Elige otro proveedor en Ajustes para usar la cámara.`, 400);
  if (id === 'openrouter' && !/:free$/.test(model) && env.OPENROUTER_ALLOW_PAID !== '1') {
    throw new UpstreamError('Por seguridad, con OpenRouter solo se permiten modelos gratuitos (terminados en «:free»).', 400);
  }
  const last = msgs[msgs.length - 1].content;
  const apiMsgs = [{ role: 'system', content: system }, ...msgs.map(m => ({ role: m.role, content: m.content }))];
  if (img) {
    apiMsgs[apiMsgs.length - 1] = {
      role: 'user',
      content: [
        { type: 'text', text: last },
        { type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.data}` } },
      ],
    };
  }
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${env[p.keyEnv]}` };
  if (id === 'openrouter') headers['x-title'] = 'JARVIS 4';
  const body = { model, messages: apiMsgs, [p.tokenParam || 'max_tokens']: 700 };
  const res = await fetchImpl(`${base(p, env)}/chat/completions`, {
    method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw await readUpstreamError(res, p.label);
  const j = await res.json();
  let text = j?.choices?.[0]?.message?.content;
  if (Array.isArray(text)) text = text.map(x => x?.text || '').join('');
  if (!text) throw new UpstreamError(`Respuesta vacía de ${p.label}`);
  return { text: String(text).trim(), provider: id, model };
}

async function chatAnthropic({ p, env, fetchImpl, system, msgs, img }) {
  const model = modelOf(p, env);
  const last = msgs[msgs.length - 1].content;
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
  const res = await fetchImpl(`${base(p, env)}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env[p.keyEnv], 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 700, system, messages: apiMsgs }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw await readUpstreamError(res, p.label);
  const j = await res.json();
  const text = (j?.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  if (!text) throw new UpstreamError(`Respuesta vacía de ${p.label}`);
  return { text, provider: 'anthropic', model };
}

export async function chat({ messages, image, memories = [], allowMemoryTags = false, tz, provider: requested, env, fetchImpl = fetch, now = new Date() }) {
  const id = resolveProvider(env, requested);
  const msgs = sanitizeMessages(messages);
  const img = validateImage(image);
  const last = msgs[msgs.length - 1].content;

  if (id === 'offline') {
    const text = img ? 'Estoy en modo básico, sin inteligencia artificial, así que no puedo analizar imágenes. Elige un proveedor de IA en Ajustes.' : localReply(last, { now, memories: memories.map(text => ({ text })) });
    return { text, provider: 'offline', model: 'local' };
  }
  const p = REGISTRY[id];
  const system = systemPrompt({ memories, now, allowMemoryTags, tz });
  if (p.kind === 'anthropic') return chatAnthropic({ p, env, fetchImpl, system, msgs, img });
  return chatOpenAICompatible({ id, p, env, fetchImpl, system, msgs, img });
}

/** Voz natural del servidor (OpenAI TTS, de pago). Devuelve un ArrayBuffer MP3. */
export async function tts({ text, env, fetchImpl = fetch }) {
  const cfg = config(env);
  if (!cfg.features.tts) throw new UpstreamError('La voz natural del servidor no está activada (usa la voz de Safari).', 501);
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
  if (!res.ok) throw await readUpstreamError(res, 'OpenAI');
  return await res.arrayBuffer();
}

/** Transcripción de audio grabado (alternativa cuando Safari no reconoce voz). Groq (gratis) u OpenAI. */
export async function transcribe({ audio, contentType, env, fetchImpl = fetch }) {
  const which = sttProvider(env);
  if (!which) throw new UpstreamError('La transcripción del servidor no está configurada. Usa el reconocimiento de Safari o el dictado del teclado.', 501);
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  const ext = AUDIO_EXT[type];
  if (!ext) throw new UpstreamError('Formato de audio no admitido', 415);
  if (!audio || audio.length < 500) throw new UpstreamError('Audio vacío o demasiado corto', 400);
  const p = REGISTRY[which];
  const form = new FormData();
  form.append('file', new Blob([audio], { type }), `voz.${ext}`);
  form.append('model', which === 'groq' ? (env.GROQ_STT_MODEL || 'whisper-large-v3-turbo') : (env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe'));
  form.append('language', 'es');
  const res = await fetchImpl(`${base(p, env)}/audio/transcriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env[p.keyEnv]}` },
    body: form,
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw await readUpstreamError(res, p.label);
  const j = await res.json();
  return { text: String(j?.text || '').trim(), provider: which };
}
