// Servidor de JARVIS 4.0: sirve la interfaz web y hace de puente seguro con la IA.
// Sin dependencias externas (Node 20+). Las claves nunca llegan al navegador.
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as ai from './ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const WEB_ROOT = path.resolve(__dirname, '..', 'web');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(self), microphone=(self), geolocation=()',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body) || body instanceof Uint8Array;
  const payload = isBuf ? body : typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': isBuf ? 'application/octet-stream' : typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    ...headers,
  });
  res.end(payload);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) { reject(new ai.UpstreamError('Petición demasiado grande', 413)); req.resume(); return; }
    const chunks = []; let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new ai.UpstreamError('Petición demasiado grande', 413)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJSON(req, limit) {
  const buf = await readBody(req, limit);
  try { return JSON.parse(buf.toString('utf8') || '{}'); }
  catch { throw new ai.UpstreamError('JSON no válido', 400); }
}

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

/** Limitador simple por IP: ventana deslizante de 1 minuto. */
export function createRateLimiter(perMinute = 30) {
  const hits = new Map();
  return ip => {
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter(t => now - t < 60_000);
    if (arr.length >= perMinute) { hits.set(ip, arr); return false; }
    arr.push(now); hits.set(ip, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => now - t < 60_000)) hits.delete(k);
    return true;
  };
}

function serveStatic(req, res, root) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return send(res, 400, 'Ruta no válida'); }
  if (pathname === '/') pathname = '/index.html';
  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep)) return send(res, 403, 'Prohibido');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'No encontrado');
    const ext = path.extname(file).toLowerCase();
    const noCache = ext === '.html' || pathname === '/sw.js' || ext === '.webmanifest';
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': noCache ? 'no-cache' : 'public, max-age=3600',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

/** Tope diario global (hora UTC): protege las cuotas gratuitas y evita sorpresas de facturación. */
export function createDailyCap(limit = 300, now = () => Date.now()) {
  let day = '', count = 0;
  const today = () => new Date(now()).toISOString().slice(0, 10);
  return {
    take() { const d = today(); if (d !== day) { day = d; count = 0; } if (limit > 0 && count >= limit) return false; count++; return true; },
    get remaining() { const d = today(); return limit > 0 ? Math.max(0, limit - (d === day ? count : 0)) : null; },
  };
}

export function createApp({ env = process.env, fetchImpl = globalThis.fetch, webRoot = WEB_ROOT, logger = console } = {}) {
  const limiter = createRateLimiter(Number(env.RATE_LIMIT_PER_MIN || 30));
  const daily = createDailyCap(Number(env.DAILY_REQUEST_LIMIT ?? 300));
  const accessCode = env.JARVIS_ACCESS_CODE || '';
  const trustProxy = env.TRUST_PROXY === '1';

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (!p.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método no permitido');
      return serveStatic(req, res, webRoot);
    }

    const cfg = ai.config(env);
    res.setHeader('cache-control', 'no-store');

    if (p === '/api/health' && req.method === 'GET') {
      return send(res, 200, { ok: true, name: 'JARVIS 4.0', version: '4.2.0', provider: cfg.provider, model: cfg.model, providers: cfg.providers, freeOnly: cfg.freeOnly, features: cfg.features, requiresCode: Boolean(accessCode), dailyRemaining: daily.remaining });
    }

    if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido' });

    if (accessCode && !safeEqual(req.headers['x-jarvis-code'] || '', accessCode)) {
      return send(res, 401, { error: 'Código de acceso incorrecto. Introdúcelo en Ajustes.' });
    }
    const ip = (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';
    if (!limiter(ip)) return send(res, 429, { error: 'Demasiadas peticiones. Espera un minuto.' });
    if (!daily.take()) return send(res, 429, { error: 'Se alcanzó el límite diario de seguridad del servidor. Usa el modo básico hasta mañana.' });

    try {
      if (p === '/api/chat') {
        const body = await readJSON(req, 8 * 1024 * 1024);
        const memories = Array.isArray(body.memories) ? body.memories.map(String).slice(0, 100) : [];
        const tz = typeof body.timeZone === 'string' && body.timeZone.length < 64 ? body.timeZone : undefined;
        const provider = typeof body.provider === 'string' ? body.provider.slice(0, 32) : undefined;
        const out = await ai.chat({ messages: body.messages, image: body.image, memories, allowMemoryTags: body.autoLearn === true, tz, provider, env, fetchImpl });
        return send(res, 200, out);
      }
      if (p === '/api/tts') {
        const body = await readJSON(req, 16 * 1024);
        const audio = await ai.tts({ text: body.text, env, fetchImpl });
        return send(res, 200, Buffer.from(audio), { 'content-type': 'audio/mpeg' });
      }
      if (p === '/api/transcribe') {
        const audio = await readBody(req, 12 * 1024 * 1024);
        const out = await ai.transcribe({ audio, contentType: req.headers['content-type'], env, fetchImpl });
        return send(res, 200, out);
      }
      return send(res, 404, { error: 'Ruta no encontrada' });
    } catch (e) {
      const status = e instanceof ai.UpstreamError ? e.status : (e?.name === 'TimeoutError' ? 504 : 500);
      if (status >= 500) logger.error?.(`[jarvis] ${p}: ${e?.message || e}`);
      const msg = e instanceof ai.UpstreamError ? e.message : status === 504 ? 'La IA tardó demasiado en responder.' : 'Error interno del servidor.';
      return send(res, status, { error: msg });
    }
  };
}

export function startServer({ env = process.env, port = Number(env.PORT || 8787), host = env.HOST || '0.0.0.0' } = {}) {
  const handler = createApp({ env });
  let server; let scheme = 'http';
  if (env.HTTPS_KEY && env.HTTPS_CERT) {
    server = https.createServer({ key: fs.readFileSync(env.HTTPS_KEY), cert: fs.readFileSync(env.HTTPS_CERT) }, handler);
    scheme = 'https';
  } else server = http.createServer(handler);
  server.listen(port, host, () => {
    const cfg = ai.config(env);
    console.log(`JARVIS 4.0 escuchando en ${scheme}://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    console.log(`Proveedor por defecto: ${cfg.provider} (${cfg.model}) · disponibles: ${cfg.providers.map(p => p.id).join(', ')}`);
    console.log(`Solo gratuitos: ${cfg.freeOnly ? 'sí' : 'no'} · voz servidor: ${cfg.features.tts ? 'sí' : 'no'} · transcripción: ${cfg.features.stt ? 'sí' : 'no'} · código de acceso: ${env.JARVIS_ACCESS_CODE ? 'sí' : 'no'}`);
    if (cfg.provider === 'offline') console.log('Aviso: ninguna clave de IA configurada → modo básico sin IA.');
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadDotEnv(path.resolve(__dirname, '..', '.env'));
  startServer();
}

/** Carga mínima de un archivo .env local (no sobrescribe variables existentes). */
export function loadDotEnv(file) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
