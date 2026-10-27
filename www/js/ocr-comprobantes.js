// Lectura de comprobantes bancarios: monto, fecha y beneficiario a partir del texto del OCR,
// y memoria local "beneficiario → qué gasto es". El nombre del beneficiario nunca se guarda:
// solo un hash, y solo en este dispositivo (localStorage).

const MESES = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12 };
const pad = (n) => String(n).padStart(2, '0');
const sinTildes = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');

// "1.250,50" | "1,250.50" | "150,00" | "1.500" → número
export function normalizarImporte(s) {
  s = String(s ?? '').replace(/[^\d.,]/g, '').replace(/[.,]+$/, '');
  if (!s) return NaN;
  const ultimo = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  if (ultimo >= 0) {
    const dec = s.slice(ultimo + 1);
    const ent = s.slice(0, ultimo).replace(/[.,]/g, '');
    const soloUnSep = !/[.,]/.test(s.slice(0, ultimo));
    // un solo separador con 3 cifras después ("1.500") son miles
    s = soloUnSep && dec.length === 3 ? ent + dec : `${ent}.${dec}`;
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

const NUM = '(\\d[\\d.,]*\\d|\\d)';
const RE_MONTO_ETQ = new RegExp(`(?:monto|importe|total)(?:\\s+(?:transferido|debitado|pagado|enviado|total|de la transaccion))?\\s*[:.]?\\s*(?:bs\\.?|bob)?\\s*[:.]?\\s*${NUM}`, 'gi');
const RE_MONTO_MON = new RegExp(`(?:\\bbs(?![a-z])\\.?|\\bbob(?![a-z]))\\s*[:.]?\\s*${NUM}`, 'gi');

export function extraerMonto(texto) {
  const t = sinTildes(texto).toLowerCase();
  const cand = (re) => [...t.matchAll(re)]
    .filter((m) => !/comision|saldo|cargo|itf/.test(t.slice(Math.max(0, m.index - 25), m.index + 6)))
    .map((m) => normalizarImporte(m[1]))
    .filter((n) => n > 0 && n < 1e8);
  const etq = cand(RE_MONTO_ETQ);
  if (etq.length) return etq[0];
  const mon = cand(RE_MONTO_MON);
  return mon.length ? Math.max(...mon) : null;
}

function fechaValida(d, m, y) {
  y = Number(y); if (y < 100) y += 2000;
  d = Number(d); m = Number(m);
  const f = new Date(y, m - 1, d);
  if (y < 2000 || y > 2099 || f.getMonth() !== m - 1 || f.getDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function extraerFecha(texto) {
  const t = sinTildes(texto).toLowerCase();
  const encontradas = [];
  for (const m of t.matchAll(/\b(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{4}|\d{2})\b/g)) encontradas.push([m.index, fechaValida(m[1], m[2], m[3])]);
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) encontradas.push([m.index, fechaValida(m[3], m[2], m[1])]);
  for (const m of t.matchAll(/\b(\d{1,2})\s*(?:de\s+)?(ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)[a-z]*\.?\s*(?:de(?:l)?\s+)?(\d{4})\b/g)) {
    encontradas.push([m.index, fechaValida(m[1], MESES[m[2]], m[3])]);
  }
  const ok = encontradas.filter(([, f]) => f).sort((a, b) => a[0] - b[0]);
  return ok.length ? ok[0][1] : null;
}

const ETQ_BENEF = [
  'nombre del beneficiario', 'nombre del destinatario', 'titular de la cuenta destino', 'titular cuenta destino', 'titular destino',
  'beneficiario', 'destinatario', 'a nombre de', 'enviado a', 'pagado a', 'transferido a', 'abonado a', 'para:', 'nombre:',
];
const RE_CUENTA = /(?:cuenta|cta\.?|nro\.?\s*(?:de\s*)?cuenta)\s*(?:de\s*)?(?:destino|abono|beneficiario|destinatario)\s*[:\-]?\s*(?:nro\.?|n°)?\s*([\dxX*•][\d\-\sxX*•]{3,})/i;

export function extraerBeneficiario(texto) {
  const lineas = String(texto ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let nombre = null;
  for (let i = 0; i < lineas.length && !nombre; i++) {
    const l = sinTildes(lineas[i]).toLowerCase();
    const etq = ETQ_BENEF.find((e) => l.startsWith(e));
    if (!etq) continue;
    let resto = lineas[i].slice(etq.length).replace(/^[\s:.\-]+/, '');
    if ((resto.match(/[a-záéíóúñ]/gi) || []).length < 3) resto = lineas[i + 1] || '';
    if (RE_CUENTA.test(resto) || /^\W*\d[\d\s\-]+$/.test(resto)) continue;
    if ((resto.match(/[a-záéíóúñ]/gi) || []).length >= 3) nombre = resto;
  }
  const c = String(texto ?? '').match(RE_CUENTA);
  const cuenta = c ? c[1].replace(/\D/g, '') : '';
  return { nombre, cuenta: cuenta.length >= 4 ? cuenta : null };
}

export function analizarComprobante(texto) {
  return { monto: extraerMonto(texto), fecha: extraerFecha(texto), beneficiario: extraerBeneficiario(texto) };
}

/* ---------- Memoria: beneficiario (hash) → { etiqueta, cuentaId, proyectoId } ---------- */
const CLAVE = 'cc_benef';
const claveNombre = (n) => sinTildes(n).toLowerCase().replace(/[^a-zñ ]/g, ' ').replace(/\s+/g, ' ').trim();

async function sha256(s) {
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 0x811c9dc5; // FNV-1a si no hay crypto.subtle
  for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return 'f' + h.toString(16);
}

// Hashes del beneficiario (por nombre y por cuenta destino). El texto original se descarta.
export async function hashesBeneficiario({ nombre, cuenta } = {}) {
  const out = [];
  const n = nombre && claveNombre(nombre);
  if (n && n.replace(/ /g, '').length >= 3) out.push(await sha256('cc|n|' + n));
  if (cuenta) out.push(await sha256('cc|c|' + cuenta));
  return out;
}

const leer = () => { try { return JSON.parse(localStorage.getItem(CLAVE)) || {}; } catch { return {}; } };

export function buscarGasto(hashes) {
  const mem = leer();
  for (const h of hashes || []) if (mem[h]) return mem[h];
  return null;
}

export function recordarGasto(hashes, { etiqueta, cuentaId, proyectoId }) {
  if (!hashes?.length || !etiqueta) return;
  const mem = leer();
  for (const h of hashes) mem[h] = { etiqueta, cuentaId: cuentaId || null, proyectoId: proyectoId || null, usado: Date.now() };
  try { localStorage.setItem(CLAVE, JSON.stringify(mem)); } catch {}
}
