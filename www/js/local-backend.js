// Respaldo "solo este dispositivo": guarda todo en localStorage.
// Se usa cuando todavía no hay configuración de Firebase.
import { uid } from './util.js';

const KEY = 'cc-local-v1';
const COLS = ['cuentas', 'proyectos', 'movimientos'];

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || '{}');
    for (const c of COLS) d[c] = d[c] || {};
    return d;
  } catch { return { cuentas: {}, proyectos: {}, movimientos: {} }; }
}

export function createLocalBackend() {
  let db = load();
  const listeners = { cuentas: new Set(), proyectos: new Set(), movimientos: new Set(), ajustes: new Set() };

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  const list = (col) => Object.entries(db[col]).map(([id, v]) => ({ id, ...v }));
  const emit = (col) => {
    save();
    if (col === 'ajustes') listeners.ajustes.forEach((cb) => cb(db.ajustes || null, false));
    else listeners[col].forEach((cb) => cb(list(col)));
  };

  return {
    mode: 'local',
    onAuth(cb) { setTimeout(() => cb({ uid: 'local', email: 'Solo este dispositivo' }), 0); return () => {}; },
    async signIn() {}, async signUp() {}, async signOut() {}, async resetPassword() {},
    onStatus(cb) { cb('local'); return () => {}; },
    watch(col, cb) { listeners[col].add(cb); setTimeout(() => cb(list(col)), 0); return () => listeners[col].delete(cb); },
    watchAjustes(cb) { listeners.ajustes.add(cb); setTimeout(() => cb(db.ajustes || null, false), 0); return () => listeners.ajustes.delete(cb); },
    add(col, data) { const id = uid(); db[col][id] = data; emit(col); return id; },
    set(col, id, data) { db[col][id] = data; emit(col); },
    update(col, id, data) { db[col][id] = { ...db[col][id], ...data }; emit(col); },
    remove(col, id) { delete db[col][id]; emit(col); },
    saveAjustes(data) { db.ajustes = { ...(db.ajustes || {}), ...data }; emit('ajustes'); },
  };
}
