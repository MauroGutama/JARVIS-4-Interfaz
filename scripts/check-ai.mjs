// Verifica la conexión REAL con cada proveedor configurado en .env (una petición corta por proveedor).
// Uso: npm run check
import path from 'node:path';
import { loadDotEnv } from '../server/server.js';
import * as ai from '../server/ai.js';

loadDotEnv(path.resolve('.env'));
const env = process.env;
const cfg = ai.config(env);
console.log(`Solo gratuitos: ${cfg.freeOnly ? 'sí' : 'no'} · por defecto: ${cfg.provider}`);
const list = cfg.providers.filter(p => p.id !== 'offline');
if (!list.length) { console.log('➖ Ninguna clave de IA configurada: JARVIS funcionará en modo básico.'); process.exit(0); }
let failed = false;
for (const p of list) {
  try {
    const r = await ai.chat({ provider: p.id, messages: [{ role: 'user', content: 'Responde solo: sistemas en línea.' }], env });
    console.log(`✅ ${p.label} (${r.model}): ${r.text}`);
  } catch (e) { failed = true; console.log(`❌ ${p.label} (${p.model}): ${e.message}`); }
}
console.log(cfg.features.stt ? `➖ Transcripción: ${ai.sttProvider(env)} (se prueba desde el iPhone)` : '➖ Transcripción del servidor: no configurada (se usa Safari)');
console.log(cfg.features.tts ? '➖ Voz natural de pago (OpenAI) activada' : '➖ Voz del servidor desactivada: se usa la voz de Safari (gratis)');
process.exit(failed ? 1 : 0);
