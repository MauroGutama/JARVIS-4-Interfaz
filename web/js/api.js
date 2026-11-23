// Cliente del servidor de JARVIS. Nunca contiene claves: solo un código de acceso opcional.

export class ApiError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

export function createApi({ base = '', getCode = () => '', fetchImpl = (...a) => fetch(...a) } = {}) {
  async function call(path, { method = 'GET', body, headers = {}, timeout = 50_000, as = 'json' } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    const h = { ...headers };
    const code = getCode();
    if (code) h['x-jarvis-code'] = code;
    let res;
    try {
      res = await fetchImpl(base + path, { method, body, headers: h, signal: ctrl.signal });
    } catch (e) {
      throw new ApiError(e?.name === 'AbortError' ? 'El servidor tardó demasiado en responder.' : 'No hay conexión con el servidor de JARVIS.', 0);
    } finally { clearTimeout(timer); }
    if (!res.ok) {
      let msg = `Error ${res.status}`;
      try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* sin JSON */ }
      throw new ApiError(msg, res.status);
    }
    return as === 'blob' ? res.blob() : res.json();
  }

  return {
    health: () => call('/api/health', { timeout: 6000 }),
    chat: payload => call('/api/chat', { method: 'POST', body: JSON.stringify(payload), headers: { 'content-type': 'application/json' } }),
    tts: text => call('/api/tts', { method: 'POST', body: JSON.stringify({ text }), headers: { 'content-type': 'application/json' }, as: 'blob', timeout: 30_000 }),
    transcribe: blob => call('/api/transcribe', { method: 'POST', body: blob, headers: { 'content-type': blob.type || 'audio/mp4' } }),
  };
}
