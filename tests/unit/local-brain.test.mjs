import test from 'node:test';
import assert from 'node:assert/strict';
import { localReply } from '../../web/js/local-brain.js';

test('respuestas locales básicas', () => {
  const now = new Date(2026, 10, 23, 9, 5);
  assert.match(localReply('Hola JARVIS'), /JARVIS 4\.0 operativo/);
  assert.match(localReply('¿qué hora es?', { now }), /^Son las 9:05/);
  assert.match(localReply('qué fecha es hoy', { now }), /2026/);
  assert.match(localReply('háblame de VIERNES'), /VIERNES/);
  assert.match(localReply('qué recuerdas', { memories: [{ text: 'Le gusta el café' }] }), /café/);
  assert.match(localReply('explícame la física cuántica'), /modo local/);
});
