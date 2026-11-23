// Verifica la conexión REAL con la IA usando tu archivo .env (hace 1-3 peticiones pequeñas y de bajo coste).
// Uso: npm run check
import path from 'node:path';
import { loadDotEnv } from '../server/server.js';
import * as ai from '../server/ai.js';

loadDotEnv(path.resolve('.env'));
const env = process.env;
const cfg = ai.config(env);
const mark = ok => (ok ? '✅' : '❌');
console.log(`Proveedor: ${cfg.provider} · modelo: ${cfg.model}`);
if (cfg.provider === 'offline') { console.log('❌ No hay OPENAI_API_KEY ni ANTHROPIC_API_KEY en .env'); process.exit(1); }
let failed = false;
try {
  const r = await ai.chat({ messages: [{ role: 'user', content: 'Responde solo: sistemas en línea.' }], env });
  console.log(mark(true), 'Chat:', r.text);
} catch (e) { failed = true; console.log(mark(false), 'Chat:', e.message); }
if (cfg.features.tts) {
  try { const b = await ai.tts({ text: 'Prueba de voz.', env }); console.log(mark(b.byteLength > 1000), `Voz natural: ${b.byteLength} bytes de audio`); }
  catch (e) { failed = true; console.log(mark(false), 'Voz natural:', e.message); }
} else console.log('➖ Voz natural del servidor: no configurada (requiere OPENAI_API_KEY)');
console.log(cfg.features.stt ? '➖ Transcripción: configurada (se prueba desde el iPhone)' : '➖ Transcripción del servidor: no configurada');
process.exit(failed ? 1 : 0);
