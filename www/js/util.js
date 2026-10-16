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

export const norm = (s) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Paleta para la torta: tonos distinguibles en tema claro y oscuro.
export const PALETA = ['#E0A100', '#2D7DD2', '#D2553F', '#3C9D6B', '#8E5BC9', '#1BA3A3', '#C9447F', '#7A8B2E', '#E07B2D', '#5468B8', '#9A6B4A', '#6D7F8C'];
