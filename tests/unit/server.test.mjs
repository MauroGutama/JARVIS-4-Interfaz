import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../../server/server.js';
import { config, sanitizeMessages, systemPrompt, availableProviders, resolveProvider } from '../../server/ai.js';
import { createDailyCap } from '../../server/server.js';

const IMG = 'A'.repeat(400);

function mockFetch(handler) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); return handler(url, init); };
  fn.calls = calls; return fn;
}
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

async function withServer(env, fetchImpl, fn) {
  const srv = http.createServer(createApp({ env, fetchImpl, logger: { error() {} } }));
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { await fn(base); } finally { srv.close(); }
}
const post = (base, path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body) });

test('config elige proveedor según las claves', () => {
  assert.equal(config({}).provider, 'offline');
  assert.equal(config({ OPENAI_API_KEY: 'k' }).provider, 'offline', 'sin FREE_ONLY=0 nunca usa proveedores de pago');
  assert.equal(config({ OPENAI_API_KEY: 'k' }).features.tts, false);
  assert.equal(config({ OPENAI_API_KEY: 'k', FREE_ONLY: '0' }).provider, 'openai');
  assert.equal(config({ ANTHROPIC_API_KEY: 'k', FREE_ONLY: '0' }).provider, 'anthropic');
  assert.equal(config({ AI_PROVIDER: 'anthropic', OPENAI_API_KEY: 'a', ANTHROPIC_API_KEY: 'b', FREE_ONLY: '0' }).provider, 'anthropic');
  assert.equal(config({ ANTHROPIC_API_KEY: 'k', FREE_ONLY: '0' }).features.tts, false, 'TTS requiere OpenAI');
});

test('sanitizeMessages fusiona, recorta y valida', () => {
  const out = sanitizeMessages([{ role: 'assistant', content: 'hola' }, { role: 'user', content: 'a' }, { role: 'user', content: 'b' }, { role: 'system', content: 'x' }]);
  assert.deepEqual(out, [{ role: 'user', content: 'a\nb' }]);
  assert.throws(() => sanitizeMessages([{ role: 'assistant', content: 'x' }]), /usuario/);
});

test('systemPrompt incluye recuerdos y la orden de memoria solo si se permite', () => {
  const p = systemPrompt({ memories: ['Le gusta el café'] });
  assert.match(p, /Le gusta el café/); assert.doesNotMatch(p, /<memoria>/);
  assert.match(systemPrompt({ allowMemoryTags: true }), /<memoria>/);
});

test('health no expone claves', async () => {
  await withServer({ OPENAI_API_KEY: 'sk-secreta-123', FREE_ONLY: '0' }, mockFetch(() => json({})), async base => {
    const r = await fetch(base + '/api/health'); const txt = await r.text();
    assert.equal(r.status, 200);
    assert.doesNotMatch(txt, /sk-secreta/);
    const j = JSON.parse(txt);
    assert.equal(j.provider, 'openai'); assert.equal(j.features.tts, true); assert.equal(j.requiresCode, false);
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  });
});

test('chat OpenAI con imagen y recuerdos', async () => {
  const f = mockFetch(() => json({ choices: [{ message: { content: 'Veo una taza azul.' } }] }));
  await withServer({ OPENAI_API_KEY: 'sk-x', OPENAI_BASE_URL: 'http://ia.test', FREE_ONLY: '0' }, f, async base => {
    const r = await post(base, '/api/chat', { messages: [{ role: 'user', content: '¿Qué ves?' }], image: { mediaType: 'image/jpeg', data: IMG }, memories: ['Se llama Mauro'] });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).text, 'Veo una taza azul.');
    assert.equal(f.calls[0].url, 'http://ia.test/v1/chat/completions');
    assert.equal(f.calls[0].init.headers.authorization, 'Bearer sk-x');
    const sent = JSON.parse(f.calls[0].init.body);
    assert.match(sent.messages[0].content, /Se llama Mauro/);
    assert.equal(sent.messages.at(-1).content[1].type, 'image_url');
    assert.match(sent.messages.at(-1).content[1].image_url.url, /^data:image\/jpeg;base64,AAAA/);
  });
});

test('chat Anthropic (Claude) con imagen', async () => {
  const f = mockFetch(() => json({ content: [{ type: 'text', text: 'Hola desde Claude' }] }));
  await withServer({ ANTHROPIC_API_KEY: 'ak', ANTHROPIC_BASE_URL: 'http://claude.test', FREE_ONLY: '0' }, f, async base => {
    const r = await post(base, '/api/chat', { messages: [{ role: 'user', content: 'hola' }], image: { mediaType: 'image/png', data: IMG } });
    assert.equal((await r.json()).text, 'Hola desde Claude');
    const c = f.calls[0];
    assert.equal(c.url, 'http://claude.test/v1/messages');
    assert.equal(c.init.headers['x-api-key'], 'ak');
    assert.equal(c.init.headers['anthropic-version'], '2023-06-01');
    const body = JSON.parse(c.init.body);
    assert.equal(body.messages[0].content[0].source.media_type, 'image/png');
    assert.equal(typeof body.system, 'string');
  });
});

test('modo offline responde con el cerebro local', async () => {
  await withServer({}, mockFetch(() => { throw new Error('no debe llamar'); }), async base => {
    const r = await post(base, '/api/chat', { messages: [{ role: 'user', content: 'hola' }] });
    const j = await r.json();
    assert.equal(j.provider, 'offline'); assert.match(j.text, /operativo/);
  });
});

test('valida entradas y errores del proveedor sin filtrar la clave', async () => {
  const f = mockFetch(() => json({ error: { message: 'Incorrect API key sk-x' } }, 401));
  await withServer({ OPENAI_API_KEY: 'sk-x', FREE_ONLY: '0' }, f, async base => {
    assert.equal((await post(base, '/api/chat', '{mal')).status, 400);
    assert.equal((await post(base, '/api/chat', { messages: [{ role: 'user', content: 'x' }], image: { mediaType: 'image/gif', data: IMG } })).status, 400);
    const r = await post(base, '/api/chat', { messages: [{ role: 'user', content: 'x' }] });
    assert.equal(r.status, 502);
    assert.doesNotMatch(await r.text(), /sk-x/);
    assert.equal((await fetch(base + '/api/chat')).status, 405);
  });
});

test('código de acceso y limitador de peticiones', async () => {
  const f = mockFetch(() => json({ choices: [{ message: { content: 'ok' } }] }));
  await withServer({ OPENAI_API_KEY: 'k', FREE_ONLY: '0', JARVIS_ACCESS_CODE: 'stark', RATE_LIMIT_PER_MIN: '3' }, f, async base => {
    const body = { messages: [{ role: 'user', content: 'x' }] };
    assert.equal((await post(base, '/api/chat', body)).status, 401);
    assert.equal((await post(base, '/api/chat', body, { 'x-jarvis-code': 'nope' })).status, 401);
    for (let i = 0; i < 3; i++) assert.equal((await post(base, '/api/chat', body, { 'x-jarvis-code': 'stark' })).status, 200);
    assert.equal((await post(base, '/api/chat', body, { 'x-jarvis-code': 'stark' })).status, 429);
  });
});

test('TTS devuelve MP3 y transcripción usa multipart', async () => {
  const f = mockFetch(url => url.endsWith('/audio/speech') ? new Response(new Uint8Array([0xff, 0xf3, 1, 2]), { status: 200 }) : json({ text: 'hola jarvis' }));
  await withServer({ OPENAI_API_KEY: 'k', FREE_ONLY: '0' }, f, async base => {
    const t = await post(base, '/api/tts', { text: '**Hola**' });
    assert.equal(t.status, 200); assert.equal(t.headers.get('content-type'), 'audio/mpeg');
    assert.equal((await t.arrayBuffer()).byteLength, 4);
    const speech = JSON.parse(f.calls[0].init.body);
    assert.equal(speech.voice, 'onyx'); assert.ok(speech.instructions);

    const s = await post(base, '/api/transcribe', new Uint8Array(2000), { 'content-type': 'audio/mp4;codecs=mp4a' });
    assert.deepEqual(await s.json(), { text: 'hola jarvis', provider: 'openai' });
    const form = f.calls[1].init.body;
    assert.ok(form instanceof FormData);
    assert.equal(form.get('file').name, 'voz.m4a'); assert.equal(form.get('language'), 'es');
    assert.equal((await post(base, '/api/transcribe', new Uint8Array(2000), { 'content-type': 'video/avi' })).status, 415);
  });
  await withServer({ ANTHROPIC_API_KEY: 'a' }, mockFetch(() => json({})), async base => {
    assert.equal((await post(base, '/api/tts', { text: 'x' })).status, 501, 'sin OpenAI no hay voz de servidor');
  });
});

test('sirve la interfaz y bloquea rutas fuera de web/', async () => {
  await withServer({}, mockFetch(() => json({})), async base => {
    const r = await fetch(base + '/');
    assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/html/);
    assert.match(await r.text(), /JARVIS 4\.0/);
    assert.equal((await fetch(base + '/js/memory.js')).headers.get('content-type'), 'text/javascript; charset=utf-8');
    const raw = await new Promise(res => http.get(base + '/..%2f..%2fserver%2fai.js', r => { r.resume(); res(r.statusCode); }));
    assert.equal(raw, 403);
    assert.equal((await fetch(base + '/nada.txt')).status, 404);
  });
});

// ---------- Proveedores gratuitos y protección contra cargos ----------
const ok = text => json({ choices: [{ message: { content: text } }] });

test('registro: prioriza proveedores gratuitos y FREE_ONLY oculta los de pago', () => {
  const env = { OPENAI_API_KEY: 'o', GITHUB_MODELS_TOKEN: 'g', GROQ_API_KEY: 'q', FREE_ONLY: '0' };
  assert.deepEqual(availableProviders(env), ['github', 'groq', 'openai']);
  assert.equal(config(env).provider, 'github', 'por defecto el primero gratuito');
  assert.equal(config({ ...env, AI_PROVIDER: 'openai' }).provider, 'openai', 'AI_PROVIDER respeta la elección');
  const fo = config({ ...env, FREE_ONLY: '1', AI_PROVIDER: 'openai' });
  assert.equal(fo.provider, 'github', 'con FREE_ONLY nunca usa un proveedor de pago');
  assert.deepEqual(fo.providers.map(p => p.id), ['github', 'groq', 'offline']);
  assert.equal(fo.features.tts, false, 'voz de pago desactivada');
  assert.equal(fo.features.stt, true, 'transcripción gratuita con Groq');
  assert.ok(config({}).providers.some(p => p.id === 'offline'), 'modo básico siempre disponible');
});

test('resolveProvider valida la elección del usuario', () => {
  const env = { GEMINI_API_KEY: 'k', OPENAI_API_KEY: 'o', FREE_ONLY: '1' };
  assert.equal(resolveProvider(env, 'gemini'), 'gemini');
  assert.equal(resolveProvider(env, 'offline'), 'offline');
  assert.equal(resolveProvider(env, ''), 'gemini');
  assert.throws(() => resolveProvider(env, 'openai'), /no está configurado o no está permitido/);
  assert.equal(resolveProvider(env, 'inventado'), 'gemini');
});

for (const [id, env, url, model] of [
  ['github', { GITHUB_MODELS_TOKEN: 'ghp_x', GITHUB_MODELS_BASE_URL: 'http://gh.test/inference' }, 'http://gh.test/inference/chat/completions', 'openai/gpt-4.1-mini'],
  ['gemini', { GEMINI_API_KEY: 'gk', GEMINI_BASE_URL: 'http://gm.test/v1beta/openai' }, 'http://gm.test/v1beta/openai/chat/completions', 'gemini-flash-latest'],
  ['groq', { GROQ_API_KEY: 'qk', GROQ_BASE_URL: 'http://gq.test/openai/v1' }, 'http://gq.test/openai/v1/chat/completions', 'llama-3.3-70b-versatile'],
  ['openrouter', { OPENROUTER_API_KEY: 'ok', OPENROUTER_BASE_URL: 'http://or.test/api/v1' }, 'http://or.test/api/v1/chat/completions', 'meta-llama/llama-3.3-70b-instruct:free'],
]) {
  test(`chat con ${id} (compatible OpenAI) elegido desde Ajustes`, async () => {
    const f = mockFetch(() => ok(`hola desde ${id}`));
    await withServer({ ...env, OPENAI_API_KEY: 'sk-o', OPENAI_BASE_URL: 'http://openai.test', FREE_ONLY: '0' }, f, async base => {
      const r = await post(base, '/api/chat', { provider: id, messages: [{ role: 'user', content: 'hola' }] });
      const j = await r.json();
      assert.equal(r.status, 200, JSON.stringify(j));
      assert.equal(j.provider, id); assert.equal(j.text, `hola desde ${id}`);
      assert.equal(f.calls[0].url, url);
      assert.match(f.calls[0].init.headers.authorization, /^Bearer /);
      const b = JSON.parse(f.calls[0].init.body);
      assert.equal(b.model, model); assert.equal(b.max_tokens, 700);
      assert.equal(b.messages[0].role, 'system');
    });
  });
}

test('Groq usa su modelo de visión con imágenes; OpenRouter sin visión lo rechaza', async () => {
  const f = mockFetch(() => ok('veo algo'));
  await withServer({ GROQ_API_KEY: 'q', GROQ_BASE_URL: 'http://gq.test', OPENROUTER_API_KEY: 'o' }, f, async base => {
    const r = await post(base, '/api/chat', { provider: 'groq', messages: [{ role: 'user', content: '¿qué ves?' }], image: { mediaType: 'image/jpeg', data: IMG } });
    assert.equal(r.status, 200);
    assert.match(JSON.parse(f.calls[0].init.body).model, /llama-4-scout/);
    const r2 = await post(base, '/api/chat', { provider: 'openrouter', messages: [{ role: 'user', content: 'x' }], image: { mediaType: 'image/jpeg', data: IMG } });
    assert.equal(r2.status, 400); assert.match((await r2.json()).error, /no admite imágenes/);
  });
});

test('OpenRouter bloquea modelos de pago salvo autorización explícita', async () => {
  const f = mockFetch(() => ok('x'));
  await withServer({ OPENROUTER_API_KEY: 'o', OPENROUTER_MODEL: 'openai/gpt-4o' }, f, async base => {
    const r = await post(base, '/api/chat', { messages: [{ role: 'user', content: 'x' }] });
    assert.equal(r.status, 400); assert.match((await r.json()).error, /:free/);
    assert.equal(f.calls.length, 0, 'no llega a llamar al proveedor');
  });
});

test('sin créditos (402) y cuota agotada (429) dan mensajes claros', async () => {
  for (const [status, re] of [[402, /créditos/], [429, /límite gratuito/]]) {
    const f = mockFetch(() => json({ error: { message: 'x' } }, status));
    await withServer({ OPENAI_API_KEY: 'k', FREE_ONLY: '0' }, f, async base => {
      const r = await post(base, '/api/chat', { messages: [{ role: 'user', content: 'x' }] });
      assert.equal(r.status, status); assert.match((await r.json()).error, re);
    });
  }
});

test('modo básico elegido explícitamente no llama a ninguna API', async () => {
  const f = mockFetch(() => { throw new Error('no debe llamar'); });
  await withServer({ GEMINI_API_KEY: 'k' }, f, async base => {
    const r = await post(base, '/api/chat', { provider: 'offline', messages: [{ role: 'user', content: 'qué hora es' }] });
    const j = await r.json();
    assert.equal(j.provider, 'offline'); assert.match(j.text, /^Son las/);
    assert.equal(f.calls.length, 0);
  });
});

test('transcripción gratuita con Groq Whisper', async () => {
  const f = mockFetch(() => json({ text: 'hola' }));
  await withServer({ GROQ_API_KEY: 'q', GROQ_BASE_URL: 'http://gq.test/openai/v1', OPENAI_API_KEY: 'o', FREE_ONLY: '1' }, f, async base => {
    const r = await post(base, '/api/transcribe', new Uint8Array(2000), { 'content-type': 'audio/mp4' });
    assert.deepEqual(await r.json(), { text: 'hola', provider: 'groq' });
    assert.equal(f.calls[0].url, 'http://gq.test/openai/v1/audio/transcriptions');
    assert.equal(f.calls[0].init.body.get('model'), 'whisper-large-v3-turbo');
    assert.equal((await post(base, '/api/tts', { text: 'x' })).status, 501, 'TTS de pago bloqueado con FREE_ONLY');
  });
});

test('tope diario global', async () => {
  let t = Date.UTC(2026, 10, 24, 10);
  const cap = createDailyCap(2, () => t);
  assert.ok(cap.take()); assert.ok(cap.take()); assert.equal(cap.take(), false);
  assert.equal(cap.remaining, 0);
  t += 24 * 3600e3;
  assert.equal(cap.remaining, 2); assert.ok(cap.take());
  const f = mockFetch(() => ok('x'));
  await withServer({ GEMINI_API_KEY: 'k', DAILY_REQUEST_LIMIT: '1' }, f, async base => {
    const body = { messages: [{ role: 'user', content: 'x' }] };
    assert.equal((await post(base, '/api/chat', body)).status, 200);
    const r = await post(base, '/api/chat', body);
    assert.equal(r.status, 429); assert.match((await r.json()).error, /límite diario/);
  });
});

test('protección contra cargos activa por defecto (sin variable FREE_ONLY)', () => {
  const c = config({ OPENAI_API_KEY: 'k', ANTHROPIC_API_KEY: 'a', GITHUB_MODELS_TOKEN: 'g' });
  assert.equal(c.freeOnly, true);
  assert.deepEqual(c.providers.map(p => p.id), ['github', 'offline']);
  assert.equal(c.features.tts, false); assert.equal(c.features.stt, false);
});
