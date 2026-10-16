// Gráfico de torta (dona) en SVG con leyenda.
import { esc, money, num, PALETA } from './util.js';

// items: [{ label, value, key? }]  — se ordenan de mayor a menor.
export function pieChart(items, { centerLabel = 'Total', emptyText = 'Sin datos en este periodo', onClickAttr = '' } = {}) {
  const data = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const total = data.reduce((s, i) => s + i.value, 0);
  if (!total) {
    return `<div class="pie-empty"><svg viewBox="0 0 120 120" class="pie-svg" aria-hidden="true"><circle cx="60" cy="60" r="44" fill="none" stroke="var(--line)" stroke-width="20"/></svg><p>${esc(emptyText)}</p></div>`;
  }
  const R = 44, C = 2 * Math.PI * R;
  let off = 0;
  const arcs = data.map((d, i) => {
    const color = d.color || PALETA[i % PALETA.length];
    d._color = color;
    const len = (d.value / total) * C;
    const gap = data.length > 1 ? Math.min(1.2, len * 0.15) : 0;
    const s = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${color}" stroke-width="20"
      stroke-dasharray="${Math.max(len - gap, 0.01)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)"><title>${esc(d.label)}: ${money(d.value)}</title></circle>`;
    off += len;
    return s;
  }).join('');

  const legend = data.map((d) => {
    const pct = (d.value / total) * 100;
    const attr = onClickAttr && d.key != null ? `${onClickAttr}="${esc(d.key)}" role="button" tabindex="0"` : '';
    return `<li ${attr}>
      <span class="dot" style="background:${d._color}"></span>
      <span class="lg-label">${esc(d.label)}</span>
      <span class="lg-pct">${pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%</span>
      <span class="lg-val">${money(d.value)}</span>
    </li>`;
  }).join('');

  return `<div class="pie">
    <div class="pie-figure">
      <svg viewBox="0 0 120 120" class="pie-svg" role="img" aria-label="Gráfico de torta">${arcs}</svg>
      <div class="pie-center"><span>${esc(centerLabel)}</span><strong>${num(total)}</strong></div>
    </div>
    <ul class="legend">${legend}</ul>
  </div>`;
}
