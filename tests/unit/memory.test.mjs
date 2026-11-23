import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore, parseMemoryCommand } from '../../web/js/memory.js';

function fakeStorage() { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; }

test('guarda, persiste y borra recuerdos', () => {
  const st = fakeStorage();
  const a = new MemoryStore(st);
  const f = a.addFact('  Mi color favorito es el azul. ');
  assert.equal(f.text, 'Mi color favorito es el azul');
  assert.equal(a.addFact('mi color favorito es el azul').id, f.id, 'sin duplicados');
  const b = new MemoryStore(st);
  assert.equal(b.facts.length, 1, 'persiste entre instancias');
  assert.equal(b.forgetMatching('color'), 1);
  assert.equal(new MemoryStore(st).facts.length, 0);
});

test('respeta los controles de privacidad', () => {
  const st = fakeStorage();
  const m = new MemoryStore(st);
  m.addFact('Vive en Madrid');
  m.updateSettings({ shareWithAI: false });
  assert.deepEqual(m.contextFacts(), [], 'no comparte con la IA');
  m.updateSettings({ shareWithAI: true });
  assert.deepEqual(m.contextFacts(), ['Vive en Madrid']);
  m.updateSettings({ enabled: false });
  assert.equal(m.addFact('otro'), null, 'memoria desactivada no guarda');
  assert.deepEqual(m.contextFacts(), []);
});

test('historial: límite, opción de no guardar y borrado total', () => {
  const st = fakeStorage();
  const m = new MemoryStore(st);
  for (let i = 0; i < 40; i++) m.pushHistory('user', 'm' + i);
  assert.equal(m.history.length, 30);
  m.updateSettings({ saveHistory: false });
  assert.equal(JSON.parse(st.getItem('jarvis4.memory.v1')).history.length, 0, 'no escribe historial en disco');
  m.wipeAll();
  assert.equal(st.getItem('jarvis4.memory.v1'), null);
  assert.equal(new MemoryStore(st).facts.length, 0);
});

test('tolera almacenamiento corrupto o inaccesible', () => {
  const st = fakeStorage(); st.setItem('jarvis4.memory.v1', '{no json');
  assert.equal(new MemoryStore(st).facts.length, 0);
  const broken = { getItem() { throw new Error('SecurityError'); } };
  const m = new MemoryStore(broken);
  assert.ok(m.addFact('funciona en memoria'));
});

test('exporta JSON legible', () => {
  const m = new MemoryStore(fakeStorage()); m.addFact('Dato');
  const j = JSON.parse(m.exportJSON());
  assert.equal(j.app, 'JARVIS 4.0'); assert.equal(j.facts[0].text, 'Dato');
});

test('parseMemoryCommand entiende órdenes en español', () => {
  assert.deepEqual(parseMemoryCommand('Recuerda que mi perro se llama Rex'), { type: 'remember', text: 'mi perro se llama Rex' });
  assert.deepEqual(parseMemoryCommand('JARVIS, olvida mi perro'), { type: 'forget', text: 'mi perro' });
  assert.deepEqual(parseMemoryCommand('¿Qué recuerdas?'.replace('¿', '')), { type: 'list' });
  assert.deepEqual(parseMemoryCommand('olvida todo'), { type: 'forget-all' });
  assert.equal(parseMemoryCommand('¿Recuerdas la película Iron Man?'), null);
  assert.equal(parseMemoryCommand('qué tiempo hace'), null);
});
