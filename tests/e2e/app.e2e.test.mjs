// Prueba de extremo a extremo: navegador real (Chromium, tamaño iPhone), servidor real
// y un proveedor de IA simulado. Ejecuta: npm run test:e2e
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { createApp } from '../../server/server.js';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { chromium = null; }
const skip = chromium ? false : 'Playwright no está instalado (npm i -D playwright)';

function listen(handler) {
  return new Promise(r => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => r(s)); });
}

// IA simulada compatible con OpenAI
function mockUpstream() {
  const calls = [];
  return listen(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const call = { path: req.url, body: req.headers['content-type']?.includes('json') ? JSON.parse(raw) : raw.length };
    calls.push(call);
    if (req.url === '/v1/chat/completions') {
      const last = call.body.messages.at(-1);
      const hasImage = Array.isArray(last.content);
      const text = hasImage ? 'Veo un patrón de prueba de colores. <memoria>nunca debe guardarse sin permiso</memoria>' : `Respuesta IA a: ${last.content}`;
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ message: { content: text } }] }));
    }
    if (req.url === '/v1/audio/speech') { res.writeHead(200, { 'content-type': 'audio/mpeg' }); return res.end(Buffer.alloc(64)); }
    if (req.url === '/v1/audio/transcriptions') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ text: 'qué hora es' })); }
    res.writeHead(404); res.end();
  }).then(s => ({ server: s, calls, url: `http://127.0.0.1:${s.address().port}` }));
}

async function setup(env) {
  const app = await listen(createApp({ env, logger: { error() {} } }));
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, permissions: ['camera', 'microphone'], baseURL: `http://localhost:${app.address().port}` });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|NotSupportedError|no supported source/i.test(m.text())) errors.push(m.text()); });
  return { app, browser, context, page, errors, close: async () => { await browser.close(); app.close(); } };
}

const lastAi = page => page.locator('.msg.ai').last();

test('JARVIS completo con IA simulada', { skip, timeout: 90_000 }, async t => {
  const up = await mockUpstream();
  const s = await setup({ OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: up.url, RATE_LIMIT_PER_MIN: '200' });
  const { page } = s;
  try {
    await page.goto('/');
    await t.test('carga sin errores y detecta el servidor', async () => {
      await page.locator('#aiBadge', { hasText: 'gpt-4o-mini' }).waitFor();
      assert.match(await page.locator('#stateText').textContent(), /EN LÍNEA|HABLANDO/);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.equal(overflow, false, 'sin desplazamiento horizontal en iPhone');
      assert.equal(await page.locator('#attach').isVisible(), false, 'sin adjunto fantasma');
      const micBox = await page.locator('#mic').boundingBox();
      assert.ok(micBox.y + micBox.height <= 844, 'botón HABLAR visible sin desplazar');
      await page.screenshot({ path: 'test-results/iphone-inicio.png' });
    });

    await t.test('chat por texto con la IA', async () => {
      await page.fill('#query', 'Hola, ¿quién eres?');
      await page.click('#send');
      await page.locator('.msg.ai', { hasText: 'Respuesta IA a: Hola, ¿quién eres?' }).waitFor();
      assert.ok(up.calls.some(c => c.path === '/v1/chat/completions'));
    });

    await t.test('voz natural del servidor solicitada tras responder', async () => {
      await page.waitForFunction(() => true);
      for (let i = 0; i < 50 && !up.calls.some(c => c.path === '/v1/audio/speech'); i++) await page.waitForTimeout(100);
      const tts = up.calls.find(c => c.path === '/v1/audio/speech');
      assert.ok(tts, 'se pidió la voz natural');
      assert.equal(tts.body.input, 'Respuesta IA a: Hola, ¿quién eres?');
    });

    await t.test('memoria: guardar por voz/texto, usar como contexto, persistir y borrar', async () => {
      await page.fill('#query', 'Recuerda que mi color favorito es el azul');
      await page.click('#send');
      await lastAi(page).filter({ hasText: 'Recordaré que mi color favorito es el azul' }).waitFor();
      await page.fill('#query', '¿Cuál es mi color?');
      await page.click('#send');
      await page.locator('.msg.ai', { hasText: 'Respuesta IA a: ¿Cuál es mi color?' }).waitFor();
      const sys = up.calls.filter(c => c.path === '/v1/chat/completions').at(-1).body.messages[0].content;
      assert.match(sys, /mi color favorito es el azul/);
      await page.reload();
      await page.locator('.msg', { hasText: '¿Cuál es mi color?' }).first().waitFor(); // historial restaurado
      await page.click('#memBtn');
      await page.locator('#mList li', { hasText: 'mi color favorito es el azul' }).waitFor();
      await page.click('#mList li button');
      await page.locator('#mList li.empty').waitFor();
      await page.click('[data-close="memSheet"]');
    });

    await t.test('cámara: vista previa, captura y análisis', async () => {
      await page.click('#cam');
      await page.waitForFunction(() => document.querySelector('#video').videoWidth > 0, null, { timeout: 10_000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: 'test-results/iphone-camara.png' });
      await page.click('#shoot');
      await page.locator('.msg.ai', { hasText: 'Veo un patrón de prueba' }).waitFor();
      assert.equal(await page.locator('#camSheet').isHidden(), true);
      const call = up.calls.filter(c => c.path === '/v1/chat/completions').at(-1);
      const img = call.body.messages.at(-1).content.find(p => p.type === 'image_url');
      assert.match(img.image_url.url, /^data:image\/jpeg;base64,/);
      assert.ok(await page.locator('.msg.human img').count() >= 1, 'miniatura en la conversación');
      const facts = await page.evaluate(() => window.__jarvis.memory.facts.length);
      assert.equal(facts, 0, 'la IA no guarda recuerdos si el aprendizaje automático está desactivado');
      assert.equal(await page.locator('.msg.ai', { hasText: '<memoria>' }).count(), 0, 'etiquetas ocultas');
    });

    await t.test('micrófono: grabar y transcribir en el servidor', async () => {
      await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('jarvis4.prefs.v1') || '{}'); localStorage.setItem('jarvis4.prefs.v1', JSON.stringify({ ...p, voiceIn: 'server' })); });
      await page.reload();
      await page.locator('#aiBadge', { hasText: 'gpt-4o-mini' }).waitFor();
      await page.click('#mic');
      await page.locator('#stateText', { hasText: 'ESCUCHANDO' }).waitFor();
      await page.waitForTimeout(1500);
      await page.click('#mic');
      await page.locator('.msg.human', { hasText: 'qué hora es' }).waitFor({ timeout: 15_000 });
      await page.locator('.msg.ai', { hasText: 'Respuesta IA a: qué hora es' }).waitFor();
      assert.ok(up.calls.some(c => c.path === '/v1/audio/transcriptions'));
    });

    await t.test('ajustes muestran el diagnóstico', async () => {
      await page.click('#setBtn');
      await page.locator('#diag', { hasText: 'conectado' }).waitFor();
      await page.waitForTimeout(400);
      await page.screenshot({ path: 'test-results/iphone-ajustes.png' });
      await page.click('[data-close="setSheet"]');
    });

    assert.deepEqual(s.errors, [], 'sin errores de JavaScript');
  } finally { await s.close(); up.server.close(); }
});

test('modo local sin claves de IA', { skip, timeout: 60_000 }, async () => {
  const s = await setup({});
  try {
    await s.page.goto('/');
    await s.page.locator('#stateText', { hasText: 'MODO LOCAL' }).waitFor();
    await s.page.fill('#query', '¿Qué hora es?');
    await s.page.click('#send');
    await lastAi(s.page).filter({ hasText: 'Son las' }).waitFor();
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});

test('código de acceso obligatorio', { skip, timeout: 60_000 }, async () => {
  const up = await mockUpstream();
  const s = await setup({ OPENAI_API_KEY: 'k', OPENAI_BASE_URL: up.url, JARVIS_ACCESS_CODE: 'stark' });
  try {
    await s.page.goto('/');
    await s.page.locator('#aiBadge', { hasText: 'gpt-4o-mini' }).waitFor();
    await s.page.fill('#query', 'hola');
    await s.page.click('#send');
    await s.page.locator('.msg.sys', { hasText: 'Código de acceso' }).waitFor();
    assert.equal(await s.page.locator('#setSheet').isVisible(), true, 'abre ajustes para introducir el código');
    await s.page.fill('#sCode', 'stark');
    await s.page.locator('#sCode').dispatchEvent('change');
    await s.page.click('[data-close="setSheet"]');
    await s.page.fill('#query', 'hola de nuevo');
    await s.page.click('#send');
    await s.page.locator('.msg.ai', { hasText: 'Respuesta IA a: hola de nuevo' }).waitFor();
  } finally { await s.close(); up.server.close(); }
});
