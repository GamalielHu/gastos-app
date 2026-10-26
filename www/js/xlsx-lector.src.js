// Lee la primera hoja de un Excel (.xlsx) como filas de celdas.
// Se empaqueta con esbuild (npm run build) y genera xlsx-lector.js.
// Las fechas llegan como número de serie de Excel; util.parseFechaHora las convierte.
import { read, utils } from 'xlsx';

export function leerXlsx(buf) {
  const wb = read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
}
