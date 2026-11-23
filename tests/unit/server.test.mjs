import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../../server/server.js';
import { config, sanitizeMessages, systemPrompt } from '../../server/ai.js';

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
  assert.equal(config({ OPENAI_API_KEY: 'k' }).provider, 'openai');
  assert.equal(config({ ANTHROPIC_API_KEY: 'k' }).provider, 'anthropic');
  assert.equal(config({ AI_PROVIDER: 'anthropic', OPENAI_API_KEY: 'a', ANTHROPIC_API_KEY: 'b' }).provider, 'anthropic');
  assert.equal(config({ ANTHROPIC_API_KEY: 'k' }).features.tts, false, 'TTS requiere OpenAI');
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
  await withServer({ OPENAI_API_KEY: 'sk-secreta-123' }, mockFetch(() => json({})), async base => {
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
  await withServer({ OPENAI_API_KEY: 'sk-x', OPENAI_BASE_URL: 'http://ia.test' }, f, async base => {
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
  await withServer({ ANTHROPIC_API_KEY: 'ak', ANTHROPIC_BASE_URL: 'http://claude.test' }, f, async base => {
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
  await withServer({ OPENAI_API_KEY: 'sk-x' }, f, async base => {
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
  await withServer({ OPENAI_API_KEY: 'k', JARVIS_ACCESS_CODE: 'stark', RATE_LIMIT_PER_MIN: '3' }, f, async base => {
    const body = { messages: [{ role: 'user', content: 'x' }] };
    assert.equal((await post(base, '/api/chat', body)).status, 401);
    assert.equal((await post(base, '/api/chat', body, { 'x-jarvis-code': 'nope' })).status, 401);
    for (let i = 0; i < 3; i++) assert.equal((await post(base, '/api/chat', body, { 'x-jarvis-code': 'stark' })).status, 200);
    assert.equal((await post(base, '/api/chat', body, { 'x-jarvis-code': 'stark' })).status, 429);
  });
});

test('TTS devuelve MP3 y transcripción usa multipart', async () => {
  const f = mockFetch(url => url.endsWith('/audio/speech') ? new Response(new Uint8Array([0xff, 0xf3, 1, 2]), { status: 200 }) : json({ text: 'hola jarvis' }));
  await withServer({ OPENAI_API_KEY: 'k' }, f, async base => {
    const t = await post(base, '/api/tts', { text: '**Hola**' });
    assert.equal(t.status, 200); assert.equal(t.headers.get('content-type'), 'audio/mpeg');
    assert.equal((await t.arrayBuffer()).byteLength, 4);
    const speech = JSON.parse(f.calls[0].init.body);
    assert.equal(speech.voice, 'onyx'); assert.ok(speech.instructions);

    const s = await post(base, '/api/transcribe', new Uint8Array(2000), { 'content-type': 'audio/mp4;codecs=mp4a' });
    assert.deepEqual(await s.json(), { text: 'hola jarvis' });
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
