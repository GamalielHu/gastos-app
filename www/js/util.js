// Utilidades compartidas: formato de dinero, fechas y HTML seguro.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let moneda = 'Bs';
export const setMoneda = (m) => { moneda = (m || 'Bs').trim() || 'Bs'; };
export const getMoneda = () => moneda;

const nf = new Intl.NumberFormat('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const num = (n) => nf.format(Number(n) || 0);
export const money = (n) => `${moneda}\u00a0${num(n)}`;
export const signed = (n, tipo) => (tipo === 'gasto' ? '−' : tipo === 'ingreso' ? '+' : '') + money(Math.abs(n));

// Convierte texto como "1.234,50" o "1234.5" a número.
export function parseMonto(txt) {
  let s = String(txt ?? '').trim().replace(/\s/g, '');
  if (!s) return NaN;
  if (s.includes(',') && s.includes('.')) {
    // el último separador es el decimal
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ''); // "85.000" son miles
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => isoDate(new Date());
export const parseIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const mesNombre = (m) => MESES[m];

const fDia = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' });
const fCorta = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' });
export function diaLargo(iso) {
  const t = today();
  const ayer = isoDate(new Date(Date.now() - 864e5));
  if (iso === t) return 'Hoy';
  if (iso === ayer) return 'Ayer';
  const s = fDia.format(parseIso(iso));
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export const fechaCorta = (iso) => fCorta.format(parseIso(iso));

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const uuid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : uid());

// Orden cronológico (más antiguo primero): fecha y, dentro del día, hora en que se anotó.
export const ordenCrono = (list) => [...list].sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.creado || 0) - (b.creado || 0) || String(a.id).localeCompare(String(b.id)));

// Saldo de cada cuenta justo después de cada movimiento: Map movId -> { cuentaId: saldo }.
export function saldosPosteriores(movs, cuentas) {
  const s = new Map(cuentas.map((c) => [c.id, Number(c.saldoInicial) || 0]));
  const out = new Map();
  const mover = (d, id, delta) => {
    if (!s.has(id)) return;
    const v = Math.round((s.get(id) + delta) * 100) / 100;
    s.set(id, v); d[id] = v;
  };
  for (const m of ordenCrono(movs)) {
    const d = {};
    if (m.tipo === 'ingreso') mover(d, m.cuentaId, m.monto);
    else if (m.tipo === 'gasto') mover(d, m.cuentaId, -m.monto);
    else if (m.tipo === 'transferencia') { mover(d, m.cuentaId, -m.monto); mover(d, m.cuentaDestinoId, m.monto); }
    out.set(m.id, d);
  }
  return out;
}

// Fecha de una celda (Date, número de serie de Excel o texto) -> { fecha: 'AAAA-MM-DD', ts }.
export function parseFechaHora(v) {
  const mk = (y, mo, d, h = 0, mi = 0, se = 0) => {
    const dt = new Date(y, mo - 1, d, h, mi, se);
    if (Number.isNaN(dt.getTime()) || dt.getMonth() !== mo - 1) return null;
    return { fecha: isoDate(dt), ts: dt.getTime() };
  };
  if (v instanceof Date) return mk(v.getFullYear(), v.getMonth() + 1, v.getDate(), v.getHours(), v.getMinutes(), v.getSeconds());
  if (typeof v === 'number' && v > 0) {
    const d = new Date(Math.round((v - 25569) * 864e5)); // el serial no tiene zona horaria: se lee en UTC
    return mk(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
  }
  const t = String(v ?? '').trim();
  let r = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (r) return mk(+r[1], +r[2], +r[3], +(r[4] || 0), +(r[5] || 0), +(r[6] || 0));
  r = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/); // día primero (es-BO)
  if (r) return mk(+r[3] < 100 ? 2000 + +r[3] : +r[3], +r[2], +r[1], +(r[4] || 0), +(r[5] || 0), +(r[6] || 0));
  return null;
}

// CSV a filas. Detecta el separador (, ; o tabulación) y respeta las comillas.
export function parseCsv(txt) {
  const s = String(txt).replace(/^﻿/, '');
  const first = s.slice(0, s.indexOf('\n') >>> 0);
  const sep = [';', '\t', ','].map((c) => [c, first.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

export const norm = (s) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Paleta para la torta: tonos distinguibles en tema claro y oscuro.
export const PALETA = ['#E0A100', '#2D7DD2', '#D2553F', '#3C9D6B', '#8E5BC9', '#1BA3A3', '#C9447F', '#7A8B2E', '#E07B2D', '#5468B8', '#9A6B4A', '#6D7F8C'];
