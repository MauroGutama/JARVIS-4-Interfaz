import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMemoryTags, toSpeakable, chunkSentences, pickVoice, scaledSize } from '../../web/js/text.js';

test('extractMemoryTags separa recuerdos del texto visible', () => {
  const r = extractMemoryTags('Encantado, Mauro.\n<memoria>Se llama Mauro</memoria>');
  assert.equal(r.clean, 'Encantado, Mauro.');
  assert.deepEqual(r.memories, ['Se llama Mauro']);
  assert.deepEqual(extractMemoryTags('Sin etiquetas').memories, []);
});

test('toSpeakable limpia markdown y emojis', () => {
  assert.equal(toSpeakable('**Hola** _mundo_ 🚀 [enlace](http://x)'), 'Hola mundo enlace');
  assert.match(toSpeakable('Mira:\n```js\nx=1\n```'), /bloque de código omitido/);
});

test('chunkSentences respeta el máximo y no pierde texto', () => {
  const t = 'Primera frase. Segunda frase bastante más larga, con comas, y más palabras. ¿Tercera? Sí.';
  const parts = chunkSentences(t, 40);
  assert.ok(parts.every(p => p.length <= 41), parts.join('|'));
  assert.equal(parts.join(' ').replace(/\s+/g, ' '), t);
  assert.deepEqual(chunkSentences(''), []);
});

test('pickVoice prefiere voces españolas mejoradas y evita voces de broma', () => {
  const voices = [
    { name: 'Samantha', lang: 'en-US', voiceURI: 'sam' },
    { name: 'Eddy', lang: 'es-ES', voiceURI: 'eddy' },
    { name: 'Jorge (mejorada)', lang: 'es-ES', voiceURI: 'jorge' },
    { name: 'Bad News', lang: 'es-ES', voiceURI: 'bad' },
  ];
  assert.equal(pickVoice(voices).voiceURI, 'jorge');
  assert.equal(pickVoice(voices, { preferredURI: 'eddy' }).voiceURI, 'eddy');
  assert.equal(pickVoice([{ name: 'Samantha', lang: 'en-US' }]), null);
  assert.equal(pickVoice([{ name: 'Paulina', lang: 'es_MX', voiceURI: 'p' }]).voiceURI, 'p');
});

test('scaledSize reduce manteniendo proporción y no amplía', () => {
  assert.deepEqual(scaledSize(4032, 3024, 1024), { width: 1024, height: 768 });
  assert.deepEqual(scaledSize(800, 600, 1024), { width: 800, height: 600 });
  assert.deepEqual(scaledSize(0, 0), { width: 0, height: 0 });
});
