// Lectura de comprobantes bancarios: monto, fecha y beneficiario a partir del texto del OCR,
// y memoria local "beneficiario → qué gasto es" (solo en este dispositivo; el nombre no va al movimiento).

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

const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre', 'setiembre'];
// "oct" | "octubre" | "sept" | "set" → 10/9…; null si la palabra no es un mes
function mesNumero(w) {
  w = String(w || '').toLowerCase().replace(/\.$/, '');
  if (w.length < 3 || !MESES[w.slice(0, 3)]) return null;
  return MESES_LARGOS.some((m) => m.startsWith(w)) ? MESES[w.slice(0, 3)] : null;
}

const hoyIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

function fechaValida(d, m, y) {
  y = Number(y); if (y < 100) y += 2000;
  d = Number(d); m = Number(m);
  if (!d || !m) return null;
  const f = new Date(y, m - 1, d);
  if (y < 2000 || y > 2099 || f.getMonth() !== m - 1 || f.getDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

// Limpieza previa: sin tildes, sin horas, errores típicos del OCR en cifras y separadores con espacios.
export function limpiarTextoFecha(texto) {
  return sinTildes(texto).toLowerCase()
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?\s*m\.?)?(?![\d])/g, ' ')
    .replace(/(?<=\d)o(?![a-z])|(?<![a-z])o(?=\d)/g, '0').replace(/(?<=\d)[il|](?=\d)/g, '1')
    .replace(/(?<=\d)\s*([/.\-])\s*(?=[\da-z])/g, '$1').replace(/(?<=[a-z])\s*([/\-])\s*(?=\d)/g, '$1')
    .replace(/[ \t]+/g, ' ');
}

// Todas las fechas válidas encontradas: [posición, 'YYYY-MM-DD']
function candidatosFecha(t) {
  const out = [];
  const add = (i, f) => { if (f) out.push([i, f]); };
  // 1) numérico DD/MM/YYYY (si no es válido, se prueba MM/DD/YYYY)
  for (const m of t.matchAll(/(?<!\d)(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})(?!\d)/g)) add(m.index, fechaValida(m[1], m[2], m[3]) || fechaValida(m[2], m[1], m[3]));
  // 2) YYYY-MM-DD
  for (const m of t.matchAll(/(?<!\d)(20\d{2})[/.\-](\d{1,2})[/.\-](\d{1,2})(?!\d)/g)) add(m.index, fechaValida(m[3], m[2], m[1]));
  // 3) textual: 27 de octubre de 2026 | 27-oct-26 | 27/OCT/2026 | 27 oct. 2026
  for (const m of t.matchAll(/(?<!\d)(\d{1,2})\s*(?:de|\/|-|\.)?\s*([a-z]{3,10})\.?\s*(?:del?|\/|-|,)?\s*(\d{4}|\d{2})(?!\d)/g)) add(m.index, fechaValida(m[1], mesNumero(m[2]), m[3]));
  // 4) textual con el mes primero: oct 27, 2026 | octubre 27 de 2026
  for (const m of t.matchAll(/\b([a-z]{3,10})\.?\s*(\d{1,2}),?\s*(?:de\s+)?(\d{4})(?!\d)/g)) add(m.index, fechaValida(m[2], mesNumero(m[1]), m[3]));
  return out;
}

// Fecha del comprobante en YYYY-MM-DD; si no se encuentra una válida, la de hoy.
export function extraerFecha(texto) {
  const t = limpiarTextoFecha(texto);
  const manana = new Date(Date.now() + 864e5);
  const limite = `${manana.getFullYear()}-${pad(manana.getMonth() + 1)}-${pad(manana.getDate())}`;
  const cand = candidatosFecha(t).filter(([, f]) => f <= limite); // un comprobante no es del futuro
  if (!cand.length) return hoyIso();
  // Preferir la que sigue a la palabra "fecha"; si no, la primera del texto.
  const etq = [...t.matchAll(/fecha/g)].map((m) => m.index);
  const cerca = cand.filter(([i]) => etq.some((e) => i > e && i - e < 40));
  return (cerca.length ? cerca : cand).sort((a, b) => a[0] - b[0])[0][1];
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

/* ---------- Memoria: beneficiario normalizado → { etiquetaId, proyectoId, cuentaId } ---------- */
// Solo en este dispositivo (localStorage). El nombre nunca va al movimiento ni a Firestore.
const CLAVE = 'cc_beneficiarios_map';

// "Sr. JUAN-CARLOS Mamani Q. Ref: 123456" → "JUAN CARLOS MAMANI Q"
export function normalizarBeneficiario(nombre) {
  return sinTildes(nombre).toUpperCase()
    .replace(/(?:\bN°|\b(?:NRO|REF|REFERENCIA|TRANSACCION|TRANS|COMPROBANTE|OPERACION|CODIGO|COD|CTA|CUENTA)\b).*$/, ' ')
    .replace(/\d+/g, ' ')
    .replace(/[^A-ZÑ ]/g, ' ')
    .replace(/\b(?:SR|SRA|SRTA|DON|DONA|LIC|ING|DR|DRA)\b/g, ' ')
    .replace(/\s+/g, ' ').trim()
    .replace(/\b([A-ZÑ]) (?=[A-ZÑ]\b)/g, '$1'); // "S R L" → "SRL"
}

// Claves del beneficiario: nombre base y/o número de cuenta destino.
export function clavesBeneficiario({ nombre, cuenta } = {}) {
  const out = [];
  const n = nombre ? normalizarBeneficiario(nombre) : '';
  if (n.replace(/ /g, '').length >= 3) out.push(n);
  const c = String(cuenta || '').replace(/\D/g, '');
  if (c.length >= 4) out.push(c);
  return out;
}

const leer = () => { try { return JSON.parse(localStorage.getItem(CLAVE)) || {}; } catch { return {}; } };

export function buscarGasto(claves) {
  const mem = leer();
  for (const k of claves || []) if (mem[k]) return mem[k];
  return null;
}

export function recordarGasto(claves, { etiqueta, cuentaId, proyectoId }) {
  if (!claves?.length || !etiqueta) return;
  const mem = leer();
  for (const k of claves) mem[k] = { etiquetaId: etiqueta, proyectoId: proyectoId || null, cuentaId: cuentaId || null };
  try { localStorage.setItem(CLAVE, JSON.stringify(mem)); localStorage.removeItem('cc_benef'); } catch {}
}
