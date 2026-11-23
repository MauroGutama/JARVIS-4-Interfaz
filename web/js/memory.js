// Memoria persistente de JARVIS, guardada SOLO en el dispositivo (localStorage).
// Nada se envía al servidor salvo los recuerdos que el usuario permite usar como contexto.

const KEY = 'jarvis4.memory.v1';
const MAX_FACTS = 100;
const MAX_FACT_LEN = 300;
const MAX_HISTORY = 30;

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,        // usar y guardar recuerdos
  autoLearn: false,     // permitir que la IA proponga recuerdos automáticamente
  saveHistory: true,    // conservar la conversación entre sesiones
  shareWithAI: true,    // enviar los recuerdos como contexto a la IA
});

function memoryStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function normalizeFact(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().replace(/[.。]+$/, '').slice(0, MAX_FACT_LEN);
}

export class MemoryStore {
  constructor(storage) {
    try { this.storage = storage || globalThis.localStorage || memoryStorage(); this.storage.getItem('__t'); }
    catch { this.storage = memoryStorage(); }
    this.state = this._load();
  }

  _load() {
    let raw = null;
    try { raw = JSON.parse(this.storage.getItem(KEY) || 'null'); } catch { raw = null; }
    const s = raw && typeof raw === 'object' ? raw : {};
    return {
      settings: { ...DEFAULT_SETTINGS, ...(s.settings || {}) },
      facts: Array.isArray(s.facts) ? s.facts.filter(f => f && typeof f.text === 'string').slice(0, MAX_FACTS) : [],
      history: Array.isArray(s.history) ? s.history.filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string').slice(-MAX_HISTORY) : [],
    };
  }

  _save() {
    const data = { ...this.state, history: this.state.settings.saveHistory ? this.state.history : [] };
    try { this.storage.setItem(KEY, JSON.stringify(data)); return true; } catch { return false; }
  }

  get settings() { return { ...this.state.settings }; }
  get facts() { return this.state.facts.slice(); }
  get history() { return this.state.history.slice(); }

  updateSettings(patch) {
    this.state.settings = { ...this.state.settings, ...patch };
    if (!this.state.settings.saveHistory) this.state.history = this.state.history.slice(-MAX_HISTORY);
    this._save();
    return this.settings;
  }

  addFact(text, source = 'user') {
    if (!this.state.settings.enabled) return null;
    const t = normalizeFact(text);
    if (t.length < 2) return null;
    const dup = this.state.facts.find(f => f.text.toLocaleLowerCase('es') === t.toLocaleLowerCase('es'));
    if (dup) return dup;
    const fact = { id: uid(), text: t, source, createdAt: new Date().toISOString() };
    this.state.facts.push(fact);
    if (this.state.facts.length > MAX_FACTS) this.state.facts.shift();
    this._save();
    return fact;
  }

  removeFact(id) {
    const n = this.state.facts.length;
    this.state.facts = this.state.facts.filter(f => f.id !== id);
    this._save();
    return this.state.facts.length !== n;
  }

  /** Olvida los recuerdos que contienen el texto indicado. Devuelve cuántos borró. */
  forgetMatching(text) {
    const q = normalizeFact(text).toLocaleLowerCase('es');
    if (!q) return 0;
    const n = this.state.facts.length;
    this.state.facts = this.state.facts.filter(f => !f.text.toLocaleLowerCase('es').includes(q));
    this._save();
    return n - this.state.facts.length;
  }

  pushHistory(role, content) {
    this.state.history.push({ role, content: String(content).slice(0, 4000) });
    this.state.history = this.state.history.slice(-MAX_HISTORY);
    this._save();
  }

  clearHistory() { this.state.history = []; this._save(); }
  clearFacts() { this.state.facts = []; this._save(); }

  wipeAll() {
    this.state = { settings: { ...DEFAULT_SETTINGS }, facts: [], history: [] };
    try { this.storage.removeItem(KEY); } catch { /* sin acceso */ }
  }

  exportJSON() {
    return JSON.stringify({ app: 'JARVIS 4.0', exportedAt: new Date().toISOString(), ...this.state }, null, 2);
  }

  /** Recuerdos que se pueden enviar como contexto a la IA (según privacidad). */
  contextFacts() {
    const s = this.state.settings;
    return s.enabled && s.shareWithAI ? this.state.facts.map(f => f.text) : [];
  }
}

/**
 * Detecta órdenes de memoria en lenguaje natural.
 * Devuelve {type:'remember'|'forget'|'list'|'forget-all', text} o null.
 */
export function parseMemoryCommand(input) {
  const t = String(input || '').trim();
  let m;
  if (/^(jarvis[,\s]+)?(olvida|borra)\s+(todo|todos tus recuerdos|toda tu memoria|lo que sabes de mí|lo que sabes de mi)\s*[.!]*$/i.test(t)) return { type: 'forget-all' };
  if ((m = t.match(/^(?:jarvis[,\s]+)?(?:recuerda|memoriza|apunta|guarda)\s+(?:que\s+)?(.{2,})$/i))) return { type: 'remember', text: m[1] };
  if ((m = t.match(/^(?:jarvis[,\s]+)?(?:olvida|borra(?: el recuerdo)?)\s+(?:que\s+)?(.{2,})$/i))) return { type: 'forget', text: m[1] };
  if (/^(jarvis[,\s]+)?(qué|que)\s+(recuerdas|sabes de m[ií]|tienes en (tu )?memoria)\s*\??$/i.test(t)) return { type: 'list' };
  return null;
}
