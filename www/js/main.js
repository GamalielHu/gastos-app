// Cuentas Claras — registro de gastos e ingresos por cuenta y por proyecto.
import { PALETA, esc, money, num, signed, parseMonto, today, isoDate, mesNombre, diaLargo, fechaCorta, norm, setMoneda, getMoneda, uuid, saldosPosteriores, parseFechaHora, parseCsv } from './util.js';
import { pieChart } from './pie.js';
import { I, iconCuenta } from './icons.js';
import { createLocalBackend } from './local-backend.js';
import { analizarComprobante, clavesBeneficiario, clavesV111, buscarGasto, recordarGasto } from './ocr-comprobantes.js';

/* ---------- Valores por defecto ---------- */
const ETIQUETAS_DEF = {
  gasto: ['Comida', 'Transporte', 'Servicios', 'Salud', 'Hogar', 'Educación', 'Ropa', 'Entretenimiento', 'Otros'],
  ingreso: ['Sueldo', 'Cobro de obra', 'Ventas', 'Otros'],
  proyecto: ['Materiales', 'Transporte', 'Comida', 'Pago a trabajadores', 'Herramientas', 'Alquiler de maquinaria', 'Otros'],
};
const TIPOS_CUENTA = [['efectivo', 'Efectivo'], ['banco', 'Banco'], ['billetera', 'Billetera móvil'], ['otra', 'Otra']];
const UNIDADES = ['bolsa', 'm³', 'm²', 'm', 'kg', 'qq', 'pieza', 'unidad', 'barra', 'viaje', 'global'];

/* ---------- Estado ---------- */
const now = new Date();
const S = {
  backend: null,
  user: undefined,
  status: 'synced',
  cuentas: [], proyectos: [], movs: [], ajustes: null,
  loaded: { cuentas: false, proyectos: false, movs: false },
  periodo: { modo: 'mes', y: now.getFullYear(), m: now.getMonth() },
  inicioTipo: 'gasto',
  filtro: { q: '', tipo: 'todos', cuenta: '', proyecto: '', etiqueta: '' },
  proyFiltro: 'activos',
};
let unsubs = [];

const ajustes = () => {
  const a = S.ajustes || {};
  const e = a.etiquetas || {};
  return {
    moneda: a.moneda || 'Bs',
    etiquetas: { gasto: e.gasto || ETIQUETAS_DEF.gasto, ingreso: e.ingreso || ETIQUETAS_DEF.ingreso, proyecto: e.proyecto || ETIQUETAS_DEF.proyecto },
  };
};
const cuentaById = (id) => S.cuentas.find((c) => c.id === id);
const proyById = (id) => S.proyectos.find((p) => p.id === id);
const cuentasOrden = () => [...S.cuentas].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.nombre.localeCompare(b.nombre));
const proyOrden = () => [...S.proyectos].sort((a, b) => (a.estado === 'cerrado') - (b.estado === 'cerrado') || (b.creado || 0) - (a.creado || 0));
const movOrden = (list) => [...list].sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.creado || 0) - (a.creado || 0) || String(b.id).localeCompare(String(a.id)));

function saldo(c) {
  let s = Number(c.saldoInicial) || 0;
  for (const m of S.movs) {
    if (m.tipo === 'ingreso' && m.cuentaId === c.id) s += m.monto;
    else if (m.tipo === 'gasto' && m.cuentaId === c.id) s -= m.monto;
    else if (m.tipo === 'transferencia') {
      if (m.cuentaId === c.id) s -= m.monto;
      if (m.cuentaDestinoId === c.id) s += m.monto;
    }
  }
  return Math.round(s * 100) / 100;
}

// Saldo de la cuenta después de un movimiento (se recalcula solo cuando cambian los datos).
let saldoMemo = { movs: null, cuentas: null, map: new Map() };
function saldoTras(m) {
  if (saldoMemo.movs !== S.movs || saldoMemo.cuentas !== S.cuentas) saldoMemo = { movs: S.movs, cuentas: S.cuentas, map: saldosPosteriores(S.movs, S.cuentas) };
  const d = saldoMemo.map.get(m.id);
  if (!d) return null;
  // En una transferencia se muestra la cuenta de origen, salvo que se esté filtrando por la de destino.
  const id = m.tipo === 'transferencia' && route()[0] === 'movimientos' && S.filtro.cuenta === m.cuentaDestinoId ? m.cuentaDestinoId : m.cuentaId;
  return d[id] ?? null;
}

function enPeriodo(fecha) {
  const p = S.periodo;
  if (p.modo === 'todo') return true;
  const y = +fecha.slice(0, 4), m = +fecha.slice(5, 7) - 1;
  return p.modo === 'anio' ? y === p.y : y === p.y && m === p.m;
}
const periodoTexto = () => {
  const p = S.periodo;
  if (p.modo === 'todo') return 'Todo el tiempo';
  if (p.modo === 'anio') return `Año ${p.y}`;
  const t = mesNombre(p.m);
  return `${t.charAt(0).toUpperCase() + t.slice(1)} ${p.y}`;
};
const sum = (list) => Math.round(list.reduce((s, m) => s + (Number(m.monto) || 0), 0) * 100) / 100;

/* ---------- Arranque ---------- */
async function boot() {
  let cfg = null;
  try { cfg = (await import('./firebase-config.js')).firebaseConfig; } catch {}
  if (cfg && cfg.apiKey) {
    try {
      const mod = await import('./firebase-backend.js');
      S.backend = mod.createFirebaseBackend(cfg);
    } catch (e) {
      console.error('No se pudo cargar Firebase', e);
      S.backend = createLocalBackend();
      S.firebaseError = true;
    }
  } else {
    S.backend = createLocalBackend();
  }
  S.backend.onStatus((st) => { S.status = st; paintStatus(); });
  const inp = document.getElementById('input-importar-excel');
  inp?.addEventListener('change', () => { const f = inp.files[0]; inp.value = ''; if (f) importarArchivo(f); });
  const res = document.getElementById('input-restaurar');
  res?.addEventListener('change', () => { const f = res.files[0]; res.value = ''; if (f) restaurarCopia(f); });
  const comp = document.getElementById('input-comprobante');
  comp?.addEventListener('change', () => { const f = comp.files[0]; comp.value = ''; if (f) leerComprobante(f); });
  S.backend.onAuth((u) => {
    S.user = u;
    unsubs.forEach((f) => f()); unsubs = [];
    if (u) { subscribe(); renderShell(); if (S.comprobantePendiente) { const b = S.comprobantePendiente; S.comprobantePendiente = null; leerComprobante(b); } } else { renderLogin(); }
  });
  revisarCompartido();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(revisarCompartido, 300); });
  if ('serviceWorker' in navigator && location.protocol === 'https:' && location.hostname !== 'localhost') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function subscribe() {
  const b = S.backend;
  S.loaded = { cuentas: false, proyectos: false, movs: false };
  unsubs.push(b.watch('cuentas', (l) => { S.cuentas = l; S.loaded.cuentas = true; schedule(); }));
  unsubs.push(b.watch('proyectos', (l) => { S.proyectos = l; S.loaded.proyectos = true; schedule(); }));
  unsubs.push(b.watch('movimientos', (l) => { S.movs = l.filter((m) => m.fecha && Number.isFinite(m.monto)); S.loaded.movs = true; schedule(); }));
  unsubs.push(b.watchAjustes((data, fromCache) => {
    if (!data && !fromCache) {
      // Primera vez con esta cuenta: etiquetas por defecto y una cuenta de efectivo.
      b.saveAjustes({ moneda: 'Bs', etiquetas: ETIQUETAS_DEF, creado: Date.now() });
      b.set('cuentas', 'efectivo', { nombre: 'Efectivo', tipo: 'efectivo', saldoInicial: 0, orden: 0, creado: Date.now() });
    }
    S.ajustes = data;
    setMoneda(ajustes().moneda);
    schedule();
  }));
}

let raf = 0;
function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderView(); }); }

/* ---------- Pantalla de acceso ---------- */
function renderLogin(modo = 'entrar', msg = '') {
  const app = document.getElementById('app');
  app.innerHTML = `
  <div class="login">
    <div class="login-card">
      <div class="brand big"><span class="mark"></span><span>Cuentas Claras</span></div>
      <p class="login-lead">Tus gastos, ingresos y obras, iguales en el celular y en el iPad.</p>
      <form id="login-form" novalidate>
        <label class="field"><span>Correo</span><input id="lg-email" type="email" autocomplete="email" inputmode="email" required></label>
        <label class="field"><span>Contraseña</span><input id="lg-pass" type="password" autocomplete="${modo === 'crear' ? 'new-password' : 'current-password'}" minlength="6" required></label>
        ${msg ? `<p class="form-msg ${msg.ok ? 'ok' : ''}">${esc(msg.text || msg)}</p>` : ''}
        <button class="btn primary block" type="submit">${modo === 'crear' ? 'Crear cuenta' : 'Entrar'}</button>
      </form>
      <div class="login-alt">
        ${modo === 'crear'
          ? '<button class="link" data-modo="entrar">Ya tengo cuenta, entrar</button>'
          : '<button class="link" data-modo="crear">Crear cuenta nueva</button><button class="link" id="lg-reset">Olvidé mi contraseña</button>'}
      </div>
      <p class="hint">Usa el mismo correo y contraseña en el Android y en el iPad para ver la misma información.</p>
    </div>
  </div>`;
  app.querySelectorAll('[data-modo]').forEach((b) => b.onclick = () => renderLogin(b.dataset.modo));
  const email = app.querySelector('#lg-email');
  app.querySelector('#lg-reset')?.addEventListener('click', async () => {
    if (!email.value) return renderLogin('entrar', 'Escribe tu correo arriba y vuelve a tocar "Olvidé mi contraseña".');
    try { await S.backend.resetPassword(email.value.trim()); renderLogin('entrar', { ok: true, text: 'Te enviamos un correo para cambiar la contraseña.' }); }
    catch (e) { renderLogin('entrar', authError(e)); }
  });
  app.querySelector('#login-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const e = email.value.trim(), p = app.querySelector('#lg-pass').value;
    if (!e || p.length < 6) return renderLogin(modo, 'Escribe tu correo y una contraseña de al menos 6 caracteres.');
    const btn = ev.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Un momento…';
    try { modo === 'crear' ? await S.backend.signUp(e, p) : await S.backend.signIn(e, p); }
    catch (err) { renderLogin(modo, authError(err)); }
  };
}
function authError(e) {
  const c = e?.code || '';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) return 'Correo o contraseña incorrectos.';
  if (c.includes('email-already-in-use')) return 'Ese correo ya tiene cuenta. Toca "Ya tengo cuenta, entrar".';
  if (c.includes('invalid-email')) return 'El correo no es válido.';
  if (c.includes('weak-password')) return 'La contraseña debe tener al menos 6 caracteres.';
  if (c.includes('network')) return 'Sin conexión a internet. Conéctate para entrar la primera vez.';
  if (c.includes('operation-not-allowed')) return 'Falta activar "Correo electrónico/contraseña" en Firebase → Authentication.';
  return 'No se pudo completar. ' + (e?.message || '');
}

/* ---------- Estructura principal ---------- */
const NAV = [['inicio', 'Inicio', I.inicio], ['movimientos', 'Movimientos', I.lista], ['proyectos', 'Proyectos', I.obra], ['ajustes', 'Ajustes', I.ajustes]];

function renderShell() {
  const app = document.getElementById('app');
  const item = ([k, t, ic]) => `<a href="#${k}" class="nav-item" data-nav="${k}">${ic}<span>${t}</span></a>`;
  app.innerHTML = `
  <div class="shell">
    <nav class="nav" aria-label="Secciones">
      <div class="brand"><span class="mark"></span><span>Cuentas Claras</span></div>
      ${NAV.slice(0, 2).map(item).join('')}
      <button class="fab" id="fab" aria-label="Nuevo movimiento">${I.mas}<span>Nuevo</span></button>
      ${NAV.slice(2).map(item).join('')}
      <div class="nav-foot" id="status-rail"></div>
    </nav>
    <div class="main">
      <header class="topbar">
        <div class="brand"><span class="mark"></span><span>Cuentas Claras</span></div>
        <div id="status-top"></div>
      </header>
      <main id="view"></main>
    </div>
  </div>`;
  app.querySelector('#fab').onclick = () => movSheet(null, presetDesdeRuta());
  paintStatus();
  renderView();
}

function presetDesdeRuta() {
  const [r, id] = route();
  if (r === 'proyecto' && id) return { proyectoId: id };
  return {};
}

function paintStatus() {
  const txt = { synced: 'Sincronizado', pending: 'Guardando…', offline: 'Sin conexión', local: 'Solo este dispositivo' }[S.status] || '';
  const html = `<span class="status ${S.status}" title="${S.status === 'offline' ? 'Los cambios se guardan y se enviarán al reconectar' : ''}"><i></i>${txt}</span>`;
  for (const id of ['status-top', 'status-rail']) { const el = document.getElementById(id); if (el) el.innerHTML = html; }
}

const route = () => (location.hash.slice(1) || 'inicio').split('/');

function renderView() {
  const view = document.getElementById('view');
  if (!view) return;
  const [r, id] = route();
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === r || (r === 'proyecto' && a.dataset.nav === 'proyectos')));

  // Conserva el foco y el cursor (por ejemplo, en el buscador) al redibujar.
  const act = document.activeElement;
  const focusId = act && view.contains(act) ? act.id : null;
  const sel = focusId && 'selectionStart' in act ? [act.selectionStart, act.selectionEnd] : null;
  const scrollY = window.scrollY;
  const sameRoute = view.dataset.route === location.hash;

  if (!S.loaded.movs || !S.loaded.cuentas) {
    view.innerHTML = '<div class="loading">Cargando tus datos…</div>';
  } else {
    const fn = { inicio: vInicio, movimientos: vMovimientos, proyectos: vProyectos, proyecto: vProyecto, ajustes: vAjustes }[r] || vInicio;
    view.innerHTML = fn(id);
    bindView(view);
  }
  view.dataset.route = location.hash;
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) { el.focus({ preventScroll: true }); if (sel) try { el.setSelectionRange(...sel); } catch {} }
  }
  if (sameRoute) window.scrollTo(0, scrollY);
}

/* ---------- Componentes ---------- */
function periodoCtl() {
  const p = S.periodo;
  return `<div class="periodo">
    <button class="icon-btn" data-per="-1" aria-label="Anterior" ${p.modo === 'todo' ? 'disabled' : ''}>${I.izq}</button>
    <strong>${periodoTexto()}</strong>
    <button class="icon-btn" data-per="1" aria-label="Siguiente" ${p.modo === 'todo' ? 'disabled' : ''}>${I.der}</button>
    <div class="seg small" role="group" aria-label="Periodo">
      ${[['mes', 'Mes'], ['anio', 'Año'], ['todo', 'Todo']].map(([k, t]) => `<button data-permodo="${k}" class="${p.modo === k ? 'on' : ''}">${t}</button>`).join('')}
    </div>
  </div>`;
}

function movRow(m, { showProy = true } = {}) {
  const c = cuentaById(m.cuentaId);
  const p = m.proyectoId ? proyById(m.proyectoId) : null;
  let titulo, sub = [];
  if (m.tipo === 'transferencia') {
    const d = cuentaById(m.cuentaDestinoId);
    titulo = 'Transferencia';
    sub.push(`${esc(c?.nombre || '¿?')} → ${esc(d?.nombre || '¿?')}`);
  } else {
    titulo = esc(m.etiqueta || 'Sin etiqueta');
    sub.push(esc(c?.nombre || 'Cuenta eliminada'));
  }
  if (m.cantidad) sub.push(`${num(m.cantidad).replace(/,00$/, '')} ${esc(m.unidad || '')}`);
  const desc = m.descripcion ? `<span class="mr-desc">${esc(m.descripcion)}</span>` : '';
  const chip = showProy && p ? `<span class="chip obra">${esc(p.nombre)}</span>` : '';
  const st = saldoTras(m);
  return `<button class="mov-row" data-mov="${m.id}">
    <span class="mr-ic ${m.tipo}" ${m.tipo === 'transferencia' ? '' : `style="--c:${colorEtiqueta(m.etiqueta)}"`}>${m.tipo === 'transferencia' ? I.transfer : esc([...(m.etiqueta || '?')][0].toUpperCase())}</span>
    <span class="mr-main col-info"><span class="mr-title">${titulo}</span>${chip}${desc}<span class="mr-sub">${sub.join(' · ')}</span></span>
    <span class="mr-amt-col col-monto"><span class="mr-amt ${m.tipo}">${signed(m.monto, m.tipo)}</span>${st != null ? `<small class="saldo-posterior">Saldo ${money(st)}</small>` : ''}</span>
  </button>`;
}

// Color estable por etiqueta (el mismo en la lista y en cualquier dispositivo).
function colorEtiqueta(e) {
  let h = 0;
  for (const ch of norm(e || '?')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return PALETA[h % PALETA.length];
}

function movList(list, opts = {}) {
  if (!list.length) return `<div class="empty">${opts.empty || 'No hay movimientos.'}</div>`;
  const groups = new Map();
  for (const m of movOrden(list)) { if (!groups.has(m.fecha)) groups.set(m.fecha, []); groups.get(m.fecha).push(m); }
  let html = '';
  for (const [f, ms] of groups) {
    const g = sum(ms.filter((m) => m.tipo === 'gasto'));
    const i = sum(ms.filter((m) => m.tipo === 'ingreso'));
    html += `<section class="day"><button type="button" class="day-head" data-fecha="${f}" aria-label="Nuevo movimiento el ${fechaCorta(f)}"><span class="day-lbl">${diaLargo(f)}<i class="day-add" aria-hidden="true">${I.mas}</i></span><span class="day-tot">${i ? `<b class="ingreso">+${num(i)}</b>` : ''}${g ? `<b class="gasto">−${num(g)}</b>` : ''}</span></button>
      <div class="rows">${ms.map((m) => movRow(m, opts)).join('')}</div></section>`;
  }
  return html;
}

function cuentaCard(c) {
  const s = saldo(c);
  return `<button class="acct" data-cuenta="${c.id}">
    <span class="acct-ic">${iconCuenta(c.tipo)}</span>
    <span class="acct-name">${esc(c.nombre)}</span>
    <span class="acct-bal ${s < 0 ? 'neg' : ''}">${money(s)}</span>
  </button>`;
}

function proyStats(p) {
  const ms = S.movs.filter((m) => m.proyectoId === p.id);
  const gastado = sum(ms.filter((m) => m.tipo === 'gasto'));
  const cobrado = sum(ms.filter((m) => m.tipo === 'ingreso'));
  const pres = Number(p.presupuesto) || 0;
  return { ms, gastado, cobrado, pres, pct: pres ? gastado / pres : 0 };
}

function barra(pct) {
  const w = Math.min(pct, 1) * 100;
  const cls = pct > 1 ? 'over' : pct > 0.85 ? 'warn' : '';
  return `<div class="bar ${cls}"><i style="width:${w.toFixed(1)}%"></i></div>`;
}

function proyCard(p) {
  const st = proyStats(p);
  return `<a class="proy-card" href="#proyecto/${p.id}">
    <div class="pc-head"><strong>${esc(p.nombre)}</strong>${p.estado === 'cerrado' ? '<span class="chip">Terminado</span>' : '<span class="chip live">En curso</span>'}</div>
    ${p.descripcion ? `<p class="pc-desc">${esc(p.descripcion)}</p>` : ''}
    <div class="pc-nums"><span><small>Gastado</small><b>${money(st.gastado)}</b></span>
      ${st.pres ? `<span><small>Presupuesto</small><b>${money(st.pres)}</b></span>` : ''}
      ${st.cobrado ? `<span><small>Cobrado</small><b class="ingreso">${money(st.cobrado)}</b></span>` : ''}</div>
    ${st.pres ? barra(st.pct) + `<small class="pc-pct">${(st.pct * 100).toFixed(0)}% del presupuesto</small>` : ''}
  </a>`;
}

/* ---------- Vistas ---------- */
function vInicio() {
  const per = S.movs.filter((m) => enPeriodo(m.fecha));
  const gastos = per.filter((m) => m.tipo === 'gasto');
  const ingresos = per.filter((m) => m.tipo === 'ingreso');
  const tg = sum(gastos), ti = sum(ingresos);
  const total = S.cuentas.reduce((s, c) => s + saldo(c), 0);

  // Torta: los gastos generales por etiqueta y cada proyecto como una porción.
  const base = S.inicioTipo === 'gasto' ? gastos : ingresos;
  const grupos = new Map();
  for (const m of base) {
    const p = m.proyectoId ? proyById(m.proyectoId) : null;
    const key = p ? 'p:' + p.id : 'e:' + (m.etiqueta || 'Sin etiqueta');
    const label = p ? `Obra · ${p.nombre}` : (m.etiqueta || 'Sin etiqueta');
    const g = grupos.get(key) || { key, label, value: 0 };
    g.value += m.monto; grupos.set(key, g);
  }
  const activos = proyOrden().filter((p) => p.estado !== 'cerrado').slice(0, 4);

  return `
  <div class="page">
    ${periodoCtl()}
    <section class="hero">
      <div class="hazard" aria-hidden="true"></div>
      <div class="hero-body">
        <small>Saldo total en tus cuentas</small>
        <strong class="hero-total ${total < 0 ? 'neg' : ''}">${money(total)}</strong>
        <div class="hero-row">
          <span><small>Ingresos</small><b class="ingreso">+${num(ti)}</b></span>
          <span><small>Gastos</small><b class="gasto">−${num(tg)}</b></span>
          <span><small>Balance</small><b class="${ti - tg < 0 ? 'gasto' : 'ingreso'}">${ti - tg < 0 ? '−' : '+'}${num(Math.abs(ti - tg))}</b></span>
        </div>
      </div>
    </section>

    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h2>${S.inicioTipo === 'gasto' ? '¿En qué se gasta?' : '¿De dónde entra?'}</h2>
          <div class="seg small" role="group" aria-label="Tipo">
            <button data-itipo="gasto" class="${S.inicioTipo === 'gasto' ? 'on' : ''}">Gastos</button>
            <button data-itipo="ingreso" class="${S.inicioTipo === 'ingreso' ? 'on' : ''}">Ingresos</button>
          </div>
        </div>
        ${pieChart([...grupos.values()], { centerLabel: `${S.inicioTipo === 'gasto' ? 'Gastado' : 'Ingresado'} ${getMoneda()}`, onClickAttr: 'data-grupo' })}
      </section>

      <div class="stack">
        <section class="card">
          <div class="card-head"><h2>Cuentas</h2><span class="muted">Total <b class="tnum">${money(total)}</b></span></div>
          <div class="accts">${cuentasOrden().map(cuentaCard).join('')}<button class="acct add" id="add-cuenta">${I.mas}<span>Agregar cuenta</span></button></div>
        </section>
        ${activos.length ? `<section class="card">
          <div class="card-head"><h2>Obras en curso</h2><a class="link" href="#proyectos">Ver todas</a></div>
          <div class="mini-proys">${activos.map((p) => { const st = proyStats(p); return `<a href="#proyecto/${p.id}" class="mini-proy"><span>${esc(p.nombre)}</span><b>${money(st.gastado)}</b>${st.pres ? barra(st.pct) : ''}</a>`; }).join('')}</div>
        </section>` : ''}
      </div>
    </div>

    <section class="card">
      <div class="card-head"><h2>Últimos movimientos</h2><a class="link" href="#movimientos">Ver todos</a></div>
      ${S.movs.length ? movList(movOrden(S.movs).slice(0, 8)) : `<div class="empty">Todavía no registraste nada. Toca <b>Nuevo</b> para anotar tu primer gasto o ingreso.</div>`}
    </section>
  </div>`;
}

function filtrar() {
  const f = S.filtro, q = norm(f.q);
  return S.movs.filter((m) => {
    if (!enPeriodo(m.fecha)) return false;
    if (f.tipo !== 'todos' && m.tipo !== f.tipo) return false;
    if (f.cuenta && m.cuentaId !== f.cuenta && m.cuentaDestinoId !== f.cuenta) return false;
    if (f.proyecto === '-' && m.proyectoId) return false;
    if (f.proyecto && f.proyecto !== '-' && m.proyectoId !== f.proyecto) return false;
    if (f.etiqueta && m.etiqueta !== f.etiqueta) return false;
    if (q) {
      const p = m.proyectoId ? proyById(m.proyectoId)?.nombre : '';
      const hay = norm([m.descripcion, m.etiqueta, p, cuentaById(m.cuentaId)?.nombre, m.monto].join(' '));
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function vMovimientos() {
  const f = S.filtro;
  const list = filtrar();
  const g = sum(list.filter((m) => m.tipo === 'gasto')), i = sum(list.filter((m) => m.tipo === 'ingreso'));
  const etqs = [...new Set(S.movs.map((m) => m.etiqueta).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const activo = f.cuenta || f.proyecto || f.etiqueta || f.tipo !== 'todos' || f.q;
  return `
  <div class="page">
    ${periodoCtl()}
    <div class="filters">
      <label class="search">${I.buscar}<input id="f-q" type="search" placeholder="Buscar descripción, etiqueta, obra…" value="${esc(f.q)}"></label>
      <div class="seg" role="group" aria-label="Tipo">
        ${[['todos', 'Todos'], ['gasto', 'Gastos'], ['ingreso', 'Ingresos'], ['transferencia', 'Transf.']].map(([k, t]) => `<button data-ftipo="${k}" class="${f.tipo === k ? 'on' : ''}">${t}</button>`).join('')}
      </div>
      <div class="selects">
        <select id="f-cuenta" aria-label="Cuenta"><option value="">Todas las cuentas</option>${cuentasOrden().map((c) => `<option value="${c.id}" ${f.cuenta === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select>
        <select id="f-proy" aria-label="Proyecto"><option value="">General + obras</option><option value="-" ${f.proyecto === '-' ? 'selected' : ''}>Solo general (sin obra)</option>${proyOrden().map((p) => `<option value="${p.id}" ${f.proyecto === p.id ? 'selected' : ''}>Obra: ${esc(p.nombre)}</option>`).join('')}</select>
        <select id="f-etq" aria-label="Etiqueta"><option value="">Todas las etiquetas</option>${etqs.map((e) => `<option ${f.etiqueta === e ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select>
      </div>
      ${activo ? '<button class="link" id="f-clear">Quitar filtros</button>' : ''}
    </div>
    <div class="list-sum"><span>${list.length} movimiento${list.length === 1 ? '' : 's'}</span><span>${i ? `<b class="ingreso">+${money(i)}</b>` : ''} ${g ? `<b class="gasto">−${money(g)}</b>` : ''}</span></div>
    <div class="card flush">${movList(list, { empty: activo ? 'Nada coincide con estos filtros.' : 'No hay movimientos en este periodo.' })}</div>
  </div>`;
}

function vProyectos() {
  const all = proyOrden();
  const list = all.filter((p) => S.proyFiltro === 'todos' || (S.proyFiltro === 'activos' ? p.estado !== 'cerrado' : p.estado === 'cerrado'));
  return `
  <div class="page">
    <div class="page-head"><h1>Proyectos de obra</h1><button class="btn primary" id="new-proy">${I.mas}Nuevo proyecto</button></div>
    <p class="muted lead">Los gastos de cada obra también cuentan en tu total general. Registrar una obra es opcional.</p>
    <div class="seg" role="group" aria-label="Estado">
      ${[['activos', 'En curso'], ['cerrados', 'Terminados'], ['todos', 'Todos']].map(([k, t]) => `<button data-pfil="${k}" class="${S.proyFiltro === k ? 'on' : ''}">${t}</button>`).join('')}
    </div>
    ${list.length ? `<div class="proy-grid">${list.map(proyCard).join('')}</div>`
      : `<div class="empty card">${all.length ? 'No hay proyectos en esta lista.' : 'Crea un proyecto para saber cuánto gastas en una obra: materiales, transporte, comida y pago a trabajadores.'}</div>`}
  </div>`;
}

function tablaAgrupada(ms, { cantidad = false, titulo, colDesc }) {
  if (!ms.length) return '';
  const g = new Map();
  for (const m of ms) {
    const key = norm(m.descripcion || '(sin descripción)') + '|' + (cantidad ? (m.unidad || '') : '');
    const r = g.get(key) || { desc: m.descripcion || '(sin descripción)', unidad: m.unidad || '', cant: 0, monto: 0, n: 0 };
    r.cant += Number(m.cantidad) || 0; r.monto += m.monto; r.n++;
    g.set(key, r);
  }
  const rows = [...g.values()].sort((a, b) => b.monto - a.monto);
  return `<section class="card">
    <div class="card-head"><h2>${titulo}</h2><span class="muted tnum">${money(sum(ms))}</span></div>
    <div class="table-wrap"><table class="tabla">
      <thead><tr><th>${colDesc}</th>${cantidad ? '<th class="r">Cantidad</th>' : '<th class="r">Veces</th>'}<th class="r">Total</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(r.desc)}</td><td class="r">${cantidad ? (r.cant ? `${num(r.cant).replace(/,00$/, '')} ${esc(r.unidad)}` : '—') : r.n}</td><td class="r">${money(r.monto)}</td></tr>`).join('')}</tbody>
    </table></div>
  </section>`;
}

function vProyecto(id) {
  const p = proyById(id);
  if (!p) return `<div class="page"><a class="back" href="#proyectos">${I.atras}Proyectos</a><div class="empty card">Este proyecto ya no existe.</div></div>`;
  const st = proyStats(p);
  const gastos = st.ms.filter((m) => m.tipo === 'gasto');
  const grupos = new Map();
  for (const m of gastos) { const k = m.etiqueta || 'Sin etiqueta'; grupos.set(k, (grupos.get(k) || 0) + m.monto); }
  const mats = gastos.filter((m) => norm(m.etiqueta) === 'materiales');
  const trab = gastos.filter((m) => norm(m.etiqueta) === 'pago a trabajadores');
  const restante = st.pres - st.gastado;

  return `
  <div class="page">
    <a class="back" href="#proyectos">${I.atras}Proyectos</a>
    <header class="proy-head">
      <div class="hazard" aria-hidden="true"></div>
      <div class="ph-row">
        <div><h1>${esc(p.nombre)}</h1>${p.descripcion ? `<p class="muted">${esc(p.descripcion)}</p>` : ''}
          <p class="muted small">${p.estado === 'cerrado' ? 'Terminado' : 'En curso'}${p.inicio ? ` · desde ${fechaCorta(p.inicio)}` : ''}</p></div>
        <div class="ph-actions">
          <button class="btn" id="edit-proy">${I.editar}Editar</button>
          <button class="btn primary" id="gasto-proy">${I.mas}Gasto de obra</button>
        </div>
      </div>
    </header>
    <section class="summary">
      <div class="sum-cell"><small>Gastado</small><strong class="gasto">${money(st.gastado)}</strong></div>
      ${st.pres ? `<div class="sum-cell"><small>Presupuesto</small><strong>${money(st.pres)}</strong></div>
      <div class="sum-cell"><small>${restante < 0 ? 'Excedido' : 'Disponible'}</small><strong class="${restante < 0 ? 'gasto' : 'ingreso'}">${money(Math.abs(restante))}</strong></div>` : ''}
      ${st.cobrado ? `<div class="sum-cell"><small>Cobrado</small><strong class="ingreso">${money(st.cobrado)}</strong></div>
      <div class="sum-cell"><small>Ganancia</small><strong class="${st.cobrado - st.gastado < 0 ? 'gasto' : 'ingreso'}">${money(st.cobrado - st.gastado)}</strong></div>` : ''}
    </section>
    ${st.pres ? `<div class="pres-bar">${barra(st.pct)}<small>${(st.pct * 100).toFixed(0)}% del presupuesto usado</small></div>` : ''}
    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h2>¿En qué se gasta en esta obra?</h2></div>
        ${pieChart([...grupos].map(([label, value]) => ({ label, value, key: label })), { centerLabel: `Gastado ${getMoneda()}`, emptyText: 'Aún no hay gastos en esta obra', onClickAttr: 'data-petq' })}
      </section>
      <div class="stack">
        ${tablaAgrupada(mats, { cantidad: true, titulo: 'Materiales', colDesc: 'Material' })}
        ${tablaAgrupada(trab, { titulo: 'Pago a trabajadores', colDesc: 'Trabajador' })}
        ${!mats.length && !trab.length ? '<section class="card"><p class="muted">Cuando registres gastos con la etiqueta <b>Materiales</b> o <b>Pago a trabajadores</b>, aquí verás el resumen por material y por trabajador.</p></section>' : ''}
      </div>
    </div>
    <section class="card">
      <div class="card-head"><h2>Movimientos de la obra</h2><span class="muted">${st.ms.length}</span></div>
      ${movList(st.ms, { showProy: false, empty: 'Toca <b>Gasto de obra</b> para registrar el primero.' })}
    </section>
  </div>`;
}

function vAjustes() {
  const a = ajustes();
  const imp = importados();
  const grupo = (k, t, desc) => `
    <div class="etq-group"><h3>${t}</h3><p class="muted small">${desc}</p>
      <div class="chips">${a.etiquetas[k].map((e, i) => `<span class="chip etq">${esc(e)}<button aria-label="Quitar ${esc(e)}" data-deletq="${k}:${i}">${I.cerrar}</button></span>`).join('')}</div>
      <form class="inline-add" data-addetq="${k}"><input id="etq-${k}" placeholder="Nueva etiqueta" maxlength="40"><button class="btn small" type="submit">Agregar</button></form>
    </div>`;
  return `
  <div class="page narrow">
    <h1>Ajustes</h1>
    <section class="card">
      <div class="card-head"><h2>Cuentas</h2><button class="btn small" id="add-cuenta">${I.mas}Agregar</button></div>
      <p class="muted small">De dónde sale o a dónde entra el dinero: efectivo, bancos, billeteras móviles.</p>
      <div class="acct-list">${cuentasOrden().map((c) => `<button class="acct-line" data-cuenta="${c.id}"><span class="acct-ic">${iconCuenta(c.tipo)}</span><span>${esc(c.nombre)}<small>${TIPOS_CUENTA.find((t) => t[0] === c.tipo)?.[1] || ''}</small></span><b class="${saldo(c) < 0 ? 'gasto' : ''}">${money(saldo(c))}</b></button>`).join('') || '<p class="muted">Sin cuentas.</p>'}</div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Etiquetas</h2></div>
      ${grupo('gasto', 'Gastos generales', 'Para gastos del día a día que no son de una obra.')}
      ${grupo('proyecto', 'Gastos de obra', 'Aparecen cuando el gasto pertenece a un proyecto.')}
      ${grupo('ingreso', 'Ingresos', 'Para el dinero que entra.')}
      <p class="muted small">Quitar una etiqueta no borra los movimientos que ya la usan.</p>
    </section>
    <section class="card">
      <div class="card-head"><h2>Importar histórico</h2><button class="btn small" id="importar">Elegir archivo</button></div>
      <p class="muted small">Excel (.xlsx) o CSV de la app del iPad, con fecha, cuenta, categoría, nota, importe y tipo. Las cuentas que no existan se crean con saldo inicial 0. Importar dos veces el mismo archivo no duplica movimientos.</p>
      ${imp.movs.length ? `<div class="sheet-actions"><button class="btn danger" id="deshacer-imp">Deshacer importación</button></div>
      <p class="muted small">Borra los ${imp.movs.length} movimientos que vinieron del archivo${imp.cuentas.length ? ` y ${imp.cuentas.length === 1 ? 'la cuenta que se creó' : `las ${imp.cuentas.length} cuentas que se crearon`} con él` : ''}. Lo que anotaste en la app se queda.</p>` : ''}
    </section>
    <section class="card">
      <div class="card-head"><h2>Copia de seguridad</h2></div>
      <p class="muted small">Guarda todos tus datos (cuentas, obras, movimientos y etiquetas) en un archivo. Con <b>Restaurar copia</b> vuelven a la app; no borra lo que anotaste después.</p>
      <div class="sheet-actions"><button class="btn" id="copia-bajar">Descargar copia</button><button class="btn" id="copia-subir">Restaurar copia</button></div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Moneda</h2></div>
      <form class="inline-add" id="moneda-form"><input id="moneda" value="${esc(a.moneda)}" maxlength="5" aria-label="Símbolo de moneda"><button class="btn small" type="submit">Guardar</button></form>
    </section>
    <section class="card">
      <div class="card-head"><h2>Sesión y sincronización</h2></div>
      ${S.backend.mode === 'cloud'
        ? `<p>Conectado como <b>${esc(S.user?.email)}</b>. Entra con este mismo correo en tu otro dispositivo para ver la misma información.</p>
           <button class="btn" id="logout">Cerrar sesión</button>`
        : `<p>Los datos se guardan <b>solo en este dispositivo</b>${S.firebaseError ? ' (no se pudo conectar con Firebase)' : ''}. Cuando la app esté conectada a Firebase, entrarás con tu correo y se sincronizará entre el Android y el iPad.</p>`}
    </section>
    <section class="card">
      <div class="card-head"><h2>Instalar en el iPad</h2></div>
      <p class="muted">Abre esta página en Safari, toca el botón Compartir y elige <b>Añadir a pantalla de inicio</b>. Quedará como una app con su propio ícono.</p>
    </section>
  </div>`;
}

/* ---------- Eventos de las vistas ---------- */
function bindView(v) {
  v.querySelectorAll('[data-per]').forEach((b) => b.onclick = () => {
    const p = S.periodo, d = +b.dataset.per;
    if (p.modo === 'anio') p.y += d;
    else { p.m += d; if (p.m < 0) { p.m = 11; p.y--; } if (p.m > 11) { p.m = 0; p.y++; } }
    renderView();
  });
  v.querySelectorAll('[data-permodo]').forEach((b) => b.onclick = () => { S.periodo.modo = b.dataset.permodo; renderView(); });
  v.querySelectorAll('[data-itipo]').forEach((b) => b.onclick = () => { S.inicioTipo = b.dataset.itipo; renderView(); });
  v.querySelectorAll('[data-mov]').forEach((b) => b.onclick = () => { const m = S.movs.find((x) => x.id === b.dataset.mov); if (m) movSheet(m); });
  // Tocar la fecha de un día abre "Nuevo movimiento" con esa fecha.
  v.querySelectorAll('[data-fecha]').forEach((b) => b.onclick = () => movSheet(null, { ...presetDesdeRuta(), fecha: b.dataset.fecha }));
  v.querySelectorAll('[data-cuenta]').forEach((b) => b.onclick = () => cuentaSheet(cuentaById(b.dataset.cuenta)));
  v.querySelector('#add-cuenta')?.addEventListener('click', () => cuentaSheet(null));
  v.querySelectorAll('[data-grupo]').forEach((li) => {
    const go = () => {
      const k = li.dataset.grupo;
      S.filtro = { q: '', tipo: S.inicioTipo, cuenta: '', proyecto: k.startsWith('p:') ? k.slice(2) : '-', etiqueta: k.startsWith('e:') ? k.slice(2) : '' };
      location.hash = 'movimientos';
    };
    li.onclick = go; li.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  });
  v.querySelectorAll('[data-petq]').forEach((li) => {
    const go = () => { S.filtro = { q: '', tipo: 'gasto', cuenta: '', proyecto: route()[1], etiqueta: li.dataset.petq }; S.periodo.modo = 'todo'; location.hash = 'movimientos'; };
    li.onclick = go; li.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  });

  // Movimientos
  const q = v.querySelector('#f-q');
  if (q) q.oninput = () => { S.filtro.q = q.value; renderView(); };
  v.querySelectorAll('[data-ftipo]').forEach((b) => b.onclick = () => { S.filtro.tipo = b.dataset.ftipo; renderView(); });
  const sel = (id, k) => { const el = v.querySelector(id); if (el) el.onchange = () => { S.filtro[k] = el.value; renderView(); }; };
  sel('#f-cuenta', 'cuenta'); sel('#f-proy', 'proyecto'); sel('#f-etq', 'etiqueta');
  v.querySelector('#f-clear')?.addEventListener('click', () => { S.filtro = { q: '', tipo: 'todos', cuenta: '', proyecto: '', etiqueta: '' }; renderView(); });

  // Proyectos
  v.querySelector('#new-proy')?.addEventListener('click', () => proyectoSheet(null));
  v.querySelectorAll('[data-pfil]').forEach((b) => b.onclick = () => { S.proyFiltro = b.dataset.pfil; renderView(); });
  v.querySelector('#edit-proy')?.addEventListener('click', () => proyectoSheet(proyById(route()[1])));
  v.querySelector('#gasto-proy')?.addEventListener('click', () => movSheet(null, { tipo: 'gasto', proyectoId: route()[1] }));

  // Ajustes
  v.querySelectorAll('[data-deletq]').forEach((b) => b.onclick = () => {
    const [k, i] = b.dataset.deletq.split(':');
    const e = structuredClone(ajustes().etiquetas);
    const [quitada] = e[k].splice(+i, 1);
    S.backend.saveAjustes({ etiquetas: e });
    toast(`Etiqueta "${quitada}" quitada`);
  });
  v.querySelectorAll('[data-addetq]').forEach((f) => f.onsubmit = (ev) => {
    ev.preventDefault();
    const k = f.dataset.addetq, inp = f.querySelector('input'), val = inp.value.trim();
    if (!val) return;
    const e = structuredClone(ajustes().etiquetas);
    if (e[k].some((x) => norm(x) === norm(val))) return toast('Esa etiqueta ya existe');
    e[k].push(val);
    S.backend.saveAjustes({ etiquetas: e });
    inp.value = '';
  });
  v.querySelector('#moneda-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const m = v.querySelector('#moneda').value.trim() || 'Bs';
    S.backend.saveAjustes({ moneda: m }); setMoneda(m); toast('Moneda guardada');
  });
  v.querySelector('#logout')?.addEventListener('click', () => S.backend.signOut());
  v.querySelector('#importar')?.addEventListener('click', () => document.getElementById('input-importar-excel').click());
  v.querySelector('#copia-bajar')?.addEventListener('click', descargarCopia);
  v.querySelector('#copia-subir')?.addEventListener('click', () => document.getElementById('input-restaurar').click());
  const dz = v.querySelector('#deshacer-imp');
  if (dz) armConfirm(dz, '¿Borrar lo importado? Toca otra vez', deshacerImportacion);
}

/* ---------- Hojas (formularios) ---------- */
let sheetOpen = false;
function openSheet(title, body, onMount) {
  const root = document.getElementById('sheet-root');
  root.innerHTML = `<div class="backdrop" data-close></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div class="sheet-head"><h2 id="sheet-title">${title}</h2><button class="icon-btn" data-close aria-label="Cerrar">${I.cerrar}</button></div>
      <div class="sheet-body">${body}</div>
    </div>`;
  document.body.classList.add('sheet-on');
  root.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => closeSheet());
  if (!sheetOpen) history.pushState({ sheet: 1 }, '');
  sheetOpen = true;
  onMount?.(root.querySelector('.sheet'));
}
function hideSheet() {
  sheetOpen = false;
  document.getElementById('sheet-root').innerHTML = '';
  document.body.classList.remove('sheet-on');
}
let afterClose = null;
function closeSheet(after) {
  if (!sheetOpen) return after?.();
  if (history.state?.sheet) { afterClose = after || null; history.back(); }
  else { hideSheet(); after?.(); }
}
window.addEventListener('popstate', () => {
  if (sheetOpen && !history.state?.sheet) hideSheet();
  const f = afterClose; afterClose = null; f?.();
});
window.addEventListener('hashchange', () => { if (sheetOpen) hideSheet(); renderView(); window.scrollTo(0, 0); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetOpen) closeSheet(); });

function armConfirm(btn, label, action) {
  btn.onclick = () => {
    if (btn.dataset.armed) return action();
    btn.dataset.armed = '1'; const old = btn.innerHTML; btn.textContent = label; btn.classList.add('armed');
    setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.innerHTML = old; btn.classList.remove('armed'); } }, 3500);
  };
}

/* Movimiento: gasto, ingreso o transferencia */
function movSheet(mov, preset = {}) {
  if (!S.cuentas.length) { toast('Primero crea una cuenta'); return cuentaSheet(null); }  const editing = !!mov;
  const m = mov ? { ...mov } : {
    tipo: preset.tipo || 'gasto', monto: '', fecha: preset.fecha || today(),
    cuentaId: localGet('ultimaCuenta') && cuentaById(localGet('ultimaCuenta')) ? localGet('ultimaCuenta') : cuentasOrden()[0].id,
    proyectoId: preset.proyectoId || null, etiqueta: '', descripcion: '',
  };
  if (!mov && preset.comprobante) {
    // Datos leídos del comprobante (y lo que se memorizó para ese beneficiario)
    if (preset.monto > 0) m.monto = preset.monto;
    if (preset.etiqueta) m.etiqueta = preset.etiqueta;
    if (preset.cuentaId && cuentaById(preset.cuentaId)) m.cuentaId = preset.cuentaId;
    if (preset.proyectoId && !proyById(preset.proyectoId)) m.proyectoId = null;
  }
  const cp = !mov && preset.comprobante;
  const proys = proyOrden().filter((p) => p.estado !== 'cerrado' || p.id === m.proyectoId);
  const body = `
  <form id="mov-form" novalidate>
    ${cp ? `<p class="ocr-aviso ${m.etiqueta ? 'ok' : ''}">${m.etiqueta ? `Comprobante leído. Beneficiario conocido: <b>${esc(m.etiqueta)}</b>.` : 'Comprobante leído. Elige <b>qué gasto es</b>; la próxima vez se completará solo.'}${preset.monto > 0 ? '' : ' No se encontró el monto.'}</p>` : ''}
    ${!editing && !cp ? `<button type="button" class="btn small ocr-btn" id="mv-ocr">${I.recibo} Leer comprobante</button>` : ''}
    <div class="seg tipo" role="radiogroup" aria-label="Tipo de movimiento">
      ${[['gasto', 'Gasto'], ['ingreso', 'Ingreso'], ['transferencia', 'Transferencia']].map(([k, t]) => `<label class="${k}"><input type="radio" name="tipo" value="${k}" ${m.tipo === k ? 'checked' : ''}><span>${t}</span></label>`).join('')}
    </div>
    <label class="field monto"><span>Monto (${esc(getMoneda())})</span><input id="mv-monto" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${m.monto !== '' ? num(m.monto) : ''}"></label>
    <div class="row-2">
      <label class="field"><span>Fecha</span><input id="mv-fecha" type="date" value="${m.fecha}" max="2099-12-31"></label>
      <label class="field"><span id="mv-cuenta-lbl">Cuenta</span><select id="mv-cuenta">${cuentasOrden().map((c) => `<option value="${c.id}" ${m.cuentaId === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select></label>
    </div>
    <label class="field" id="mv-destino-wrap"><span>Hacia la cuenta</span><select id="mv-destino">${cuentasOrden().map((c) => `<option value="${c.id}" ${m.cuentaDestinoId === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select></label>
    <label class="field" id="mv-proy-wrap"><span>¿Es de una obra?</span>
      <select id="mv-proy"><option value="">No, es general</option>${proys.map((p) => `<option value="${p.id}" ${m.proyectoId === p.id ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select>
    </label>
    <div class="field" id="mv-etq-wrap"><span>Etiqueta</span><div class="chips pick" id="mv-etqs"></div></div>
    <div class="row-2" id="mv-cant-wrap">
      <label class="field"><span>Cantidad</span><input id="mv-cant" inputmode="decimal" placeholder="Ej.: 20" value="${m.cantidad ? String(m.cantidad).replace('.', ',') : ''}"></label>
      <label class="field"><span>Unidad</span><input id="mv-unidad" list="unidades" placeholder="bolsa, m³…" value="${esc(m.unidad || '')}"></label>
    </div>
    <datalist id="unidades">${UNIDADES.map((u) => `<option value="${u}">`).join('')}</datalist>
    <label class="field"><span>Descripción</span><input id="mv-desc" list="mv-desc-list" maxlength="120" value="${esc(m.descripcion || '')}" autocomplete="off"></label>
    <datalist id="mv-desc-list"></datalist>
    <p class="form-msg" id="mv-msg" hidden></p>
    <div class="sheet-actions">
      ${editing ? `<button type="button" class="btn danger" id="mv-del">Eliminar</button>` : `<button type="button" class="btn" id="mv-otro">Guardar y otro</button>`}
      <button type="submit" class="btn primary">${editing ? 'Guardar cambios' : 'Guardar'}</button>
    </div>
    ${editing && mov.creado ? `<p class="muted small center">Anotado el ${fechaCorta(isoDate(new Date(mov.creado)))}</p>` : ''}
  </form>`;

  openSheet(editing ? 'Editar movimiento' : 'Nuevo movimiento', body, (sh) => {
    const $ = (s) => sh.querySelector(s);
    let etiqueta = m.etiqueta || '';
    const tipo = () => sh.querySelector('input[name=tipo]:checked').value;

    function listaEtq() {
      const a = ajustes().etiquetas, t = tipo(), pr = $('#mv-proy').value;
      if (t === 'ingreso') return a.ingreso;
      return pr ? a.proyecto : a.gasto;
    }
    function paintEtqs() {
      const lst = [...listaEtq()];
      if (etiqueta && !lst.includes(etiqueta)) lst.push(etiqueta);
      $('#mv-etqs').innerHTML = lst.map((e) => `<button type="button" class="chip pickable ${e === etiqueta ? 'on' : ''}" data-e="${esc(e)}">${esc(e)}</button>`).join('')
        + `<button type="button" class="chip pickable add" id="mv-new-etq">+ Nueva</button>`;
      $('#mv-etqs').querySelectorAll('[data-e]').forEach((b) => b.onclick = () => { etiqueta = b.dataset.e; dyn(); });
      $('#mv-new-etq').onclick = () => {
        const wrap = $('#mv-etqs');
        wrap.insertAdjacentHTML('beforeend', `<span class="new-etq"><input id="mv-etq-new" placeholder="Nombre" maxlength="40"><button type="button" class="btn small" id="mv-etq-ok">Agregar</button></span>`);
        $('#mv-new-etq').remove();
        const inp = $('#mv-etq-new'); inp.focus();
        const ok = () => {
          const val = inp.value.trim(); if (!val) return;
          const t = tipo(), k = t === 'ingreso' ? 'ingreso' : ($('#mv-proy').value ? 'proyecto' : 'gasto');
          const e = structuredClone(ajustes().etiquetas);
          if (!e[k].some((x) => norm(x) === norm(val))) { e[k].push(val); S.ajustes = { ...(S.ajustes || {}), etiquetas: e }; S.backend.saveAjustes({ etiquetas: e }); }
          etiqueta = e[k].find((x) => norm(x) === norm(val)); dyn();
        };
        $('#mv-etq-ok').onclick = ok;
        inp.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ok(); } };
      };
    }
    function dyn() {
      const t = tipo();
      const isT = t === 'transferencia';
      $('#mv-destino-wrap').hidden = !isT;
      $('#mv-proy-wrap').hidden = isT;
      $('#mv-etq-wrap').hidden = isT;
      $('#mv-cuenta-lbl').textContent = t === 'gasto' ? 'Pagado desde' : t === 'ingreso' ? 'Entra a' : 'Desde la cuenta';
      if (!isT && etiqueta && !listaEtq().includes(etiqueta) && !(mov && mov.etiqueta === etiqueta)) etiqueta = '';
      paintEtqs();
      const e = norm(etiqueta);
      $('#mv-cant-wrap').hidden = isT || e !== 'materiales';
      $('#mv-desc').placeholder = isT ? 'Ej.: Retiro del cajero' : e === 'materiales' ? 'Ej.: Cemento, fierro de 3/8, arena' : e === 'pago a trabajadores' ? 'Nombre del trabajador' : e === 'transporte' ? 'Ej.: Flete de arena, pasaje' : e === 'comida' ? 'Ej.: Almuerzo de la cuadrilla' : '¿En qué fue? (opcional)';
      // Sugerencias de descripciones usadas antes con esta etiqueta
      const prev = [...new Set(S.movs.filter((x) => x.etiqueta === etiqueta && x.descripcion).map((x) => x.descripcion))].slice(0, 30);
      $('#mv-desc-list').innerHTML = prev.map((d) => `<option value="${esc(d)}">`).join('');
      const pr = $('#mv-proy').value;
      if (pr && t === 'gasto') {
        const nm = norm(etiqueta);
        if (nm === 'pago a trabajadores') {
          const trab = [...new Set(S.movs.filter((x) => x.proyectoId === pr && norm(x.etiqueta) === nm && x.descripcion).map((x) => x.descripcion))];
          if (trab.length) $('#mv-desc-list').innerHTML = trab.map((d) => `<option value="${esc(d)}">`).join('');
        }
      }
    }
    sh.querySelectorAll('input[name=tipo]').forEach((r) => r.onchange = dyn);
    $('#mv-proy').onchange = dyn;
    dyn();
    if (cp && !etiqueta) setTimeout(() => { $('#mv-etq-wrap').scrollIntoView({ block: 'center' }); $('#mv-etqs .chip')?.focus(); }, 80);
    else if (!editing && !(cp && m.monto > 0)) setTimeout(() => $('#mv-monto').focus(), 60);
    $('#mv-ocr')?.addEventListener('click', () => document.getElementById('input-comprobante').click());

    const msg = (t) => { const el = $('#mv-msg'); el.textContent = t; el.hidden = !t; };
    function collect() {
      const t = tipo();
      const monto = parseMonto($('#mv-monto').value);
      if (!(monto > 0)) { msg('Escribe un monto mayor a cero.'); $('#mv-monto').focus(); return null; }
      const fecha = $('#mv-fecha').value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { msg('Elige una fecha.'); return null; }
      const d = { tipo: t, monto, fecha, cuentaId: $('#mv-cuenta').value, descripcion: $('#mv-desc').value.trim(), creado: mov?.creado || Date.now(), editado: Date.now() };
      if (mov?.importKey) d.importKey = mov.importKey; // sigue contando como importado (para "Deshacer importación")
      if (mov?.origen) d.origen = mov.origen;
      if (t === 'transferencia') {
        d.cuentaDestinoId = $('#mv-destino').value;
        if (d.cuentaDestinoId === d.cuentaId) { msg('La cuenta de origen y la de destino deben ser distintas.'); return null; }
        d.proyectoId = null; d.etiqueta = null;
      } else {
        if (!etiqueta) { msg('Elige una etiqueta.'); return null; }
        d.etiqueta = etiqueta;
        d.proyectoId = $('#mv-proy').value || null;
        if (norm(etiqueta) === 'materiales') {
          const c = parseMonto($('#mv-cant').value);
          if (c > 0) { d.cantidad = c; d.unidad = $('#mv-unidad').value.trim(); }
        }
      }
      return d;
    }
    function save(otro) {
      const d = collect(); if (!d) return;
      if (editing) S.backend.set('movimientos', mov.id, d); else S.backend.add('movimientos', d);
      localSet('ultimaCuenta', d.cuentaId);
      // La memoria del beneficiario queda solo en este dispositivo; el nombre no se guarda en el movimiento.
      if (cp && d.tipo === 'gasto') { recordarGasto(preset.benef, d); preset.benef = null; }
      toast(editing ? 'Cambios guardados' : `${d.tipo === 'gasto' ? 'Gasto' : d.tipo === 'ingreso' ? 'Ingreso' : 'Transferencia'} de ${money(d.monto)} guardado`);
      if (otro) {
        $('#mv-monto').value = ''; $('#mv-desc').value = ''; $('#mv-cant').value = ''; msg(''); $('#mv-monto').focus();
      } else closeSheet();
    }
    $('#mov-form').onsubmit = (ev) => { ev.preventDefault(); save(false); };
    $('#mv-otro')?.addEventListener('click', () => save(true));
    if (editing) armConfirm($('#mv-del'), '¿Eliminar? Toca otra vez', () => { S.backend.remove('movimientos', mov.id); toast('Movimiento eliminado'); closeSheet(); });
  });
}

function cuentaSheet(c) {
  const editing = !!c;
  const usada = editing && S.movs.some((m) => m.cuentaId === c.id || m.cuentaDestinoId === c.id);
  const body = `
  <form id="cta-form" novalidate>
    <label class="field"><span>Nombre</span><input id="ct-nombre" maxlength="40" placeholder="Ej.: Banco Unión, Tigo Money" value="${esc(c?.nombre || '')}"></label>
    <div class="field"><span>Tipo</span><div class="chips pick">${TIPOS_CUENTA.map(([k, t]) => `<label class="chip pickable radio"><input type="radio" name="ct-tipo" value="${k}" ${(c?.tipo || 'banco') === k ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div></div>
    <label class="field"><span>Saldo inicial (${esc(getMoneda())})</span><input id="ct-saldo" inputmode="decimal" placeholder="0,00" value="${c ? num(c.saldoInicial || 0) : ''}"></label>
    <p class="muted small">El dinero que había en esta cuenta antes de empezar a registrar.${editing ? ` Saldo actual: <b>${money(saldo(c))}</b>.` : ''}</p>
    <p class="form-msg" id="ct-msg" hidden></p>
    <div class="sheet-actions">
      ${editing ? `<button type="button" class="btn danger" id="ct-del" ${usada ? 'disabled title="Tiene movimientos"' : ''}>Eliminar</button>` : '<span></span>'}
      <button class="btn primary" type="submit">${editing ? 'Guardar cambios' : 'Crear cuenta'}</button>
    </div>
    ${usada ? '<p class="muted small">Esta cuenta tiene movimientos, por eso no se puede eliminar.</p>' : ''}
  </form>`;
  openSheet(editing ? 'Editar cuenta' : 'Nueva cuenta', body, (sh) => {
    const $ = (s) => sh.querySelector(s);
    if (!editing) setTimeout(() => $('#ct-nombre').focus(), 60);
    $('#cta-form').onsubmit = (ev) => {
      ev.preventDefault();
      const nombre = $('#ct-nombre').value.trim();
      const sal = $('#ct-saldo').value.trim() ? parseMonto($('#ct-saldo').value) : 0;
      const msg = $('#ct-msg');
      if (!nombre) { msg.textContent = 'Escribe un nombre.'; msg.hidden = false; return; }
      if (!Number.isFinite(sal)) { msg.textContent = 'El saldo inicial no es un número válido.'; msg.hidden = false; return; }
      const d = { nombre, tipo: sh.querySelector('input[name=ct-tipo]:checked').value, saldoInicial: sal, orden: c?.orden ?? S.cuentas.length, creado: c?.creado || Date.now() };
      if (editing) S.backend.set('cuentas', c.id, d); else S.backend.add('cuentas', d);
      toast(editing ? 'Cuenta guardada' : `Cuenta "${nombre}" creada`);
      closeSheet();
    };
    if (editing && !usada) armConfirm($('#ct-del'), '¿Eliminar? Toca otra vez', () => { S.backend.remove('cuentas', c.id); toast('Cuenta eliminada'); closeSheet(); });
  });
}

function proyectoSheet(p) {
  const editing = !!p;
  const n = editing ? S.movs.filter((m) => m.proyectoId === p.id).length : 0;
  const body = `
  <form id="pr-form" novalidate>
    <label class="field"><span>Nombre de la obra</span><input id="pr-nombre" maxlength="60" placeholder="Ej.: Casa familia Quispe" value="${esc(p?.nombre || '')}"></label>
    <label class="field"><span>Descripción o ubicación (opcional)</span><input id="pr-desc" maxlength="120" placeholder="Ej.: Construcción de 2 plantas, zona Sur" value="${esc(p?.descripcion || '')}"></label>
    <div class="row-2">
      <label class="field"><span>Presupuesto (opcional)</span><input id="pr-pres" inputmode="decimal" placeholder="0,00" value="${p?.presupuesto ? num(p.presupuesto) : ''}"></label>
      <label class="field"><span>Inicio</span><input id="pr-inicio" type="date" value="${p?.inicio || today()}"></label>
    </div>
    ${editing ? `<div class="field"><span>Estado</span><div class="seg"><label><input type="radio" name="pr-estado" value="activo" ${p.estado !== 'cerrado' ? 'checked' : ''}><span>En curso</span></label><label><input type="radio" name="pr-estado" value="cerrado" ${p.estado === 'cerrado' ? 'checked' : ''}><span>Terminado</span></label></div></div>` : ''}
    <p class="form-msg" id="pr-msg" hidden></p>
    <div class="sheet-actions">
      ${editing ? `<button type="button" class="btn danger" id="pr-del">Eliminar</button>` : '<span></span>'}
      <button class="btn primary" type="submit">${editing ? 'Guardar cambios' : 'Crear proyecto'}</button>
    </div>
    ${editing && n ? `<p class="muted small">Si eliminas el proyecto, sus ${n} movimientos se conservan como gastos generales.</p>` : ''}
  </form>`;
  openSheet(editing ? 'Editar proyecto' : 'Nuevo proyecto', body, (sh) => {
    const $ = (s) => sh.querySelector(s);
    if (!editing) setTimeout(() => $('#pr-nombre').focus(), 60);
    $('#pr-form').onsubmit = (ev) => {
      ev.preventDefault();
      const nombre = $('#pr-nombre').value.trim();
      const msg = $('#pr-msg');
      if (!nombre) { msg.textContent = 'Escribe el nombre de la obra.'; msg.hidden = false; return; }
      const pres = $('#pr-pres').value.trim() ? parseMonto($('#pr-pres').value) : 0;
      if (!Number.isFinite(pres)) { msg.textContent = 'El presupuesto no es un número válido.'; msg.hidden = false; return; }
      const d = { nombre, descripcion: $('#pr-desc').value.trim(), presupuesto: pres, inicio: $('#pr-inicio').value || today(),
        estado: editing ? sh.querySelector('input[name=pr-estado]:checked').value : 'activo', creado: p?.creado || Date.now() };
      if (editing) { S.backend.set('proyectos', p.id, d); toast('Proyecto guardado'); closeSheet(); }
      else { const id = S.backend.add('proyectos', d); toast(`Proyecto "${nombre}" creado`); closeSheet(() => { location.hash = 'proyecto/' + id; }); }
    };
    if (editing) armConfirm($('#pr-del'), '¿Eliminar? Toca otra vez', () => {
      for (const m of S.movs.filter((x) => x.proyectoId === p.id)) {
        const etqGeneral = ajustes().etiquetas.gasto;
        S.backend.update('movimientos', m.id, { proyectoId: null, etiqueta: m.etiqueta && (m.tipo !== 'gasto' || etqGeneral.includes(m.etiqueta)) ? m.etiqueta : (m.etiqueta || 'Otros') });
      }
      S.backend.remove('proyectos', p.id);
      toast('Proyecto eliminado'); closeSheet(() => { location.hash = 'proyectos'; });
    });
  });
}

/* ---------- Importar histórico (Excel/CSV de la app del iPad) ---------- */
const COLS_IMPORT = {
  fecha: ['fecha', 'segun un periodo', 'date'],
  cuenta: ['cuenta', 'cuentas', 'account'],
  categoria: ['categoria', 'etiqueta', 'category'],
  subcategoria: ['subcategoria', 'subcategorias'],
  nota: ['nota', 'note'],
  descripcion: ['descripcion', 'description'],
  monto: ['importe', 'monto', 'amount', 'bob'],
  tipo: ['ingreso/gasto', 'tipo', 'type'],
};
const r2 = (n) => Math.round(n * 100) / 100;

// "Dinero gastado"/"Dinero ingresado" son las dos mitades de una transferencia
// (la categoría es la otra cuenta); "Saldo de Receitas"/"Modificar saldo" fija el saldo inicial.
function tipoImport(t, monto) {
  const s = norm(t);
  if (s.includes('dinero gastado') || s.includes('transfer')) return 'transf';
  if (s.includes('dinero ingresado')) return 'transf-par';
  if (s.includes('saldo')) return 'ajuste';
  if (s.startsWith('gasto') || s.startsWith('expense')) return 'gasto';
  if (s.startsWith('ingreso') || s.startsWith('income')) return 'ingreso';
  return monto < 0 ? 'gasto' : 'ingreso';
}

// Lee las filas del archivo y las deja listas para importar, sin escribir nada todavía.
function analizarFilas(rows) {
  const hi = rows.findIndex((r) => r && r.some((x) => COLS_IMPORT.monto.includes(norm(x))));
  if (hi < 0) throw new Error('no encontré la columna de importe o monto');
  const h = rows[hi].map((x) => norm(x));
  const ix = {};
  for (const [k, alias] of Object.entries(COLS_IMPORT)) { const a = alias.find((x) => h.includes(x)); if (a) ix[k] = h.indexOf(a); }
  if (ix.fecha == null || ix.cuenta == null) throw new Error('faltan las columnas de fecha o cuenta');

  const txt = (v) => (v == null ? '' : String(v).trim());
  const cel = (r, k) => (ix[k] == null ? null : r[ix[k]]);
  const nombres = new Map(); // nombre normalizado -> { nombre, n }
  const cuentaDe = (nombre) => {
    const k = norm(nombre);
    const e = nombres.get(k) || { nombre: txt(nombre), n: 0 };
    e.n++; nombres.set(k, e);
    return k;
  };
  const ya = new Set(S.movs.map((m) => m.importKey).filter(Boolean));
  const enArchivo = new Map(); // filas idénticas dentro del archivo: se numeran para no confundirlas
  const regs = [];
  let omitidos = 0, repetidos = 0;

  // Filas del mismo segundo: se separan unos milisegundos para conservar el orden del archivo
  // (la app del iPad exporta del más nuevo al más antiguo).
  const datos = rows.slice(hi + 1);
  const fechas = datos.map((r) => (r ? parseFechaHora(cel(r, 'fecha')) : null)).filter(Boolean);
  const nuevoPrimero = fechas.length > 1 && fechas[0].ts > fechas[fechas.length - 1].ts;
  const n = datos.length || 1;

  for (const [i, r] of datos.entries()) {
    if (!r || !r.some((x) => txt(x))) continue;
    const f = parseFechaHora(cel(r, 'fecha'));
    const mv = cel(r, 'monto');
    const montoNum = typeof mv === 'number' ? mv : parseMonto(txt(mv).replace(/^[−-]/, '')) * (/^[−-]/.test(txt(mv)) ? -1 : 1);
    if (!f || !Number.isFinite(montoNum) || !montoNum || !txt(cel(r, 'cuenta'))) { omitidos++; continue; }
    const t = tipoImport(cel(r, 'tipo'), montoNum);
    if (t === 'transf-par') continue; // su otra mitad ("Dinero gastado") trae origen y destino
    const monto = r2(Math.abs(montoNum));
    const cat = txt(cel(r, 'categoria')), sub = txt(cel(r, 'subcategoria'));
    const descripcion = [txt(cel(r, 'nota')), txt(cel(r, 'descripcion'))].filter(Boolean).join(' · ').slice(0, 120);
    const clave = [f.ts, norm(cel(r, 'cuenta')), monto, t, norm(cat), norm(descripcion)].join('|');
    enArchivo.set(clave, (enArchivo.get(clave) || 0) + 1);
    const importKey = `${clave}#${enArchivo.get(clave)}`;
    if (ya.has(importKey)) { repetidos++; continue; }
    if (t === 'transf' && (!cat || norm(cat) === norm(cel(r, 'cuenta')))) { omitidos++; continue; }

    const reg = { t, monto, montoNum, fecha: f.fecha, creado: f.ts + Math.round((999 * (nuevoPrimero ? n - i : i)) / n), descripcion, importKey, cuenta: cuentaDe(cel(r, 'cuenta')) };
    if (t === 'transf') reg.destino = cuentaDe(cat);
    else if (t !== 'ajuste') reg.etiqueta = (sub ? `${cat} · ${sub}` : cat).slice(0, 40) || 'Otros';
    regs.push(reg);
  }
  return { regs, nombres, omitidos, repetidos };
}

// Cuenta propuesta para un nombre del archivo: el alias guardado, una cuenta con el mismo nombre
// o, para "Cuenta 1"/"Cuentas bancarias" de la app del iPad, la primera cuenta de banco.
function cuentaSugerida(k) {
  const a = (S.ajustes?.aliasCuentas || {})[k];
  if (a && cuentaById(a)) return a;
  const igual = S.cuentas.find((c) => norm(c.nombre) === k);
  if (igual) return igual.id;
  if (/^cuenta 1$|^cuentas? bancarias?$/.test(k)) return cuentasOrden().find((c) => c.tipo === 'banco')?.id || '';
  return '';
}

// Obra propuesta para una categoría del archivo: el alias guardado o una obra en curso
// que comparta una palabra larga con la categoría ("Mant. Reintegración social…" -> obra "Reintegración…").
const obrasActivas = () => proyOrden().filter((p) => p.estado !== 'cerrado');
function obraSugerida(k) {
  const a = (S.ajustes?.aliasProyectos || {})[k];
  if (a && proyById(a)) return a;
  const palabras = (t) => norm(t).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 5);
  const pk = new Set(palabras(k));
  return obrasActivas().find((p) => palabras(p.nombre).some((w) => pk.has(w)))?.id || '';
}

// Etiqueta de obra para una categoría del archivo (los gastos de obra usan sus propias etiquetas).
function etiquetaObra(cat) {
  const n = norm(cat);
  if (n.includes('material')) return 'Materiales';
  if (n.includes('trabajador') || n.includes('jornal') || n.includes('sueldo')) return 'Pago a trabajadores';
  if (n.includes('transporte') || n.includes('flete') || n.includes('gasolina')) return 'Transporte';
  if (n.includes('comida') || n.includes('almuerzo')) return 'Comida';
  if (n.includes('herramient')) return 'Herramientas';
  if (n.includes('maquinaria')) return 'Alquiler de maquinaria';
  return 'Otros';
}

// Hoja para elegir a qué cuenta va cada cuenta del archivo antes de importar.
function importarSheet(an) {
  if (!an.regs.length) return toast(`Nada nuevo para importar${an.repetidos ? ` · ${an.repetidos} ya estaban` : ''}`);
  const nombres = [...an.nombres].sort((a, b) => b[1].n - a[1].n);
  const fechas = an.regs.map((r) => r.fecha).sort();
  const opts = (sel) => '<option value="">Crear cuenta nueva</option>'
    + cuentasOrden().map((c) => `<option value="${c.id}" ${sel === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('');
  const obras = obrasActivas();
  const cats = new Map(); // categoría normalizada -> { nombre, n }
  for (const r of an.regs) if (r.etiqueta) { const k = norm(r.etiqueta); const e = cats.get(k) || { nombre: r.etiqueta, n: 0 }; e.n++; cats.set(k, e); }
  const categorias = obras.length ? [...cats].sort((a, b) => !!obraSugerida(b[0]) - !!obraSugerida(a[0]) || b[1].n - a[1].n) : [];
  const optsObra = (sel) => '<option value="">General (sin obra)</option>'
    + obras.map((p) => `<option value="${p.id}" ${sel === p.id ? 'selected' : ''}>Obra: ${esc(p.nombre)}</option>`).join('');
  const body = `
  <form id="imp-form" novalidate>
    <p class="muted small">${an.regs.length} movimientos del ${fechaCorta(fechas[0])} al ${fechaCorta(fechas[fechas.length - 1])}${an.repetidos ? ` · ${an.repetidos} ya estaban` : ''}. Elige a qué cuenta va cada una del archivo.</p>
    ${nombres.map(([k, v], i) => `<label class="field"><span>${esc(v.nombre)} <small class="muted">· ${v.n} mov.</small></span><select data-imp="${i}">${opts(cuentaSugerida(k))}</select></label>`).join('')}
    ${categorias.length ? `<p class="muted small">¿Alguna categoría es de una obra? Sus movimientos se suman a esa obra.</p>
    ${categorias.map(([k, v], i) => `<label class="field"><span>${esc(v.nombre)} <small class="muted">· ${v.n} mov.</small></span><select data-obra="${i}">${optsObra(obraSugerida(k))}</select></label>`).join('')}` : ''}
    <label class="check"><input type="checkbox" id="imp-saldo" checked><span>Mantener el saldo de hoy en las cuentas que ya tengo (se ajusta su saldo inicial)</span></label>
    <div class="sheet-actions"><button type="button" class="btn" data-close>Cancelar</button><button type="submit" class="btn primary">Importar</button></div>
  </form>`;
  openSheet('Importar histórico', body, (sh) => {
    sh.querySelector('#imp-form').onsubmit = (ev) => {
      ev.preventDefault();
      const mapa = new Map(nombres.map(([k], i) => [k, sh.querySelector(`[data-imp="${i}"]`).value]));
      const mapaObra = new Map(categorias.map(([k], i) => [k, sh.querySelector(`[data-obra="${i}"]`).value]));
      const r = aplicarImport(an, mapa, mapaObra, sh.querySelector('#imp-saldo').checked);
      closeSheet();
      toast(`${r.n} movimientos importados`
        + (r.cuentas ? ` · ${r.cuentas} cuenta${r.cuentas === 1 ? '' : 's'} nueva${r.cuentas === 1 ? '' : 's'}` : '')
        + (r.deObra ? ` · ${r.deObra} de obra` : '')
        + (r.ajustadas ? ` · saldo de hoy sin cambios en ${r.ajustadas} cuenta${r.ajustadas === 1 ? '' : 's'}` : '')
        + (r.omitidos ? ` · ${r.omitidos} filas sin datos válidos` : ''));
    };
  });
}

function aplicarImport(an, mapa, mapaObra, mantenerSaldo) {
  const ahora = Date.now();
  const nuevas = new Map(); // nombre normalizado -> { id, data }
  const idDe = (k) => {
    if (mapa.get(k)) return mapa.get(k);
    if (!nuevas.has(k)) {
      const nombre = an.nombres.get(k).nombre;
      nuevas.set(k, { id: uuid(), data: { nombre: nombre.slice(0, 40), tipo: k.includes('efectivo') ? 'efectivo' : k.includes('banc') ? 'banco' : 'otra', saldoInicial: 0, orden: S.cuentas.length + nuevas.size, creado: ahora, importado: ahora } });
    }
    return nuevas.get(k).id;
  };
  const etq = structuredClone(ajustes().etiquetas);
  let etqCambio = false, omitidos = an.omitidos, deObra = 0;
  const delta = new Map(); // cuentaId -> efecto neto de lo importado (ingresos − gastos ± transferencias)
  const suma = (id, v) => delta.set(id, r2((delta.get(id) || 0) + v));
  const movs = [];

  for (const r of an.regs) {
    const cid = idDe(r.cuenta);
    if (r.t === 'ajuste') {
      // Solo fija el saldo inicial de una cuenta nueva; en una existente se respeta su saldo.
      const nv = [...nuevas.values()].find((x) => x.id === cid);
      if (nv) nv.data.saldoInicial = r2(nv.data.saldoInicial + r.montoNum);
      continue;
    }
    const base = { monto: r.monto, fecha: r.fecha, cuentaId: cid, descripcion: r.descripcion, creado: r.creado, editado: ahora, importKey: r.importKey, origen: 'import_ipad' };
    if (r.t === 'transf') {
      const dest = idDe(r.destino);
      if (dest === cid) { omitidos++; continue; }
      movs.push({ id: uuid(), data: { tipo: 'transferencia', ...base, cuentaDestinoId: dest, proyectoId: null, etiqueta: null } });
      suma(cid, -r.monto); suma(dest, r.monto);
    } else {
      const proyectoId = mapaObra.get(norm(r.etiqueta)) || null;
      const lista = proyectoId && r.t === 'gasto' ? 'proyecto' : r.t; // gastos de obra: etiquetas de obra
      const etiqueta = lista === 'proyecto' ? etiquetaObra(r.etiqueta) : r.etiqueta;
      if (!etq[lista].some((x) => norm(x) === norm(etiqueta))) { etq[lista].push(etiqueta); etqCambio = true; }
      movs.push({ id: uuid(), data: { tipo: r.t, ...base, etiqueta: etq[lista].find((x) => norm(x) === norm(etiqueta)), proyectoId } });
      if (proyectoId) deObra++;
      suma(cid, r.t === 'ingreso' ? r.monto : -r.monto);
    }
  }

  // Escrituras sin esperar: aparecen al instante y Firestore sincroniza después.
  if (nuevas.size) S.backend.bulk('cuentas', [...nuevas.values()]);
  if (movs.length) S.backend.bulk('movimientos', movs);

  // Saldo de hoy intacto: saldoInicial −= Δ. ajusteImport guarda Δ para "Deshacer importación".
  let ajustadas = 0;
  if (mantenerSaldo) {
    const creadas = new Set([...nuevas.values()].map((x) => x.id));
    for (const [id, d] of delta) {
      const c = cuentaById(id);
      if (!c || !d || creadas.has(id)) continue;
      S.backend.update('cuentas', id, { saldoInicial: r2((Number(c.saldoInicial) || 0) - d), ajusteImport: r2((Number(c.ajusteImport) || 0) + d) });
      ajustadas++;
    }
  }

  // Recuerda la asociación para la próxima importación ("Cuenta 1" -> cuenta del banco).
  const alias = { ...(S.ajustes?.aliasCuentas || {}) };
  let aliasCambio = false;
  for (const [k, id] of mapa) if (id && alias[k] !== id) { alias[k] = id; aliasCambio = true; }
  const aliasObra = { ...(S.ajustes?.aliasProyectos || {}) };
  let obraCambio = false;
  for (const [k, id] of mapaObra) if (id && aliasObra[k] !== id) { aliasObra[k] = id; obraCambio = true; }
  if (etqCambio || aliasCambio || obraCambio) {
    S.backend.saveAjustes({ ...(etqCambio ? { etiquetas: etq } : {}), ...(aliasCambio ? { aliasCuentas: alias } : {}), ...(obraCambio ? { aliasProyectos: aliasObra } : {}) });
  }
  return { n: movs.length, cuentas: nuevas.size, ajustadas, omitidos, deObra };
}

async function importarArchivo(file) {
  try {
    let rows;
    if (/\.csv$/i.test(file.name) || file.type === 'text/csv') rows = parseCsv(await file.text());
    else { const { leerXlsx } = await import('./xlsx-lector.js'); rows = leerXlsx(await file.arrayBuffer()); }
    importarSheet(analizarFilas(rows));
  } catch (e) {
    console.error(e);
    toast('No se pudo importar: ' + (e.message || e));
  }
}

// Lo que vino de una importación: movimientos importados y las cuentas que se crearon
// en esa importación (si nada anotado a mano las usa).
function importados() {
  const movs = S.movs.filter((m) => m.importKey || m.origen === 'import_ipad');
  const tandas = new Set(movs.map((m) => m.editado));
  const usadas = new Set(S.movs.filter((m) => !m.importKey && m.origen !== 'import_ipad').flatMap((m) => [m.cuentaId, m.cuentaDestinoId]));
  const cuentas = S.cuentas.filter((c) => (c.importado || tandas.has(c.creado)) && !usadas.has(c.id));
  return { movs, cuentas };
}

function deshacerImportacion() {
  const { movs, cuentas } = importados();
  const borrar = new Set(cuentas.map((c) => c.id));
  S.backend.bulkRemove('movimientos', movs.map((m) => m.id));
  if (cuentas.length) S.backend.bulkRemove('cuentas', [...borrar]);
  // Devuelve el saldo inicial que se ajustó al importar.
  for (const c of S.cuentas) {
    if (c.ajusteImport && !borrar.has(c.id)) S.backend.update('cuentas', c.id, { saldoInicial: r2((Number(c.saldoInicial) || 0) + c.ajusteImport), ajusteImport: 0 });
  }
  toast(`Importación deshecha: ${movs.length} movimientos borrados`);
}

/* ---------- Copia de seguridad ---------- */
async function descargarCopia() {
  const nombre = `cuentas-claras-${today()}.json`;
  const texto = JSON.stringify({ app: 'cuentas-claras', version: 1, exportado: new Date().toISOString(),
    ajustes: S.ajustes || null, cuentas: S.cuentas, proyectos: S.proyectos, movimientos: S.movs });
  try {
    if (window.Capacitor?.isNativePlatform?.()) {
      // Android: el WebView no descarga archivos, se guarda y se abre "Compartir".
      const { compartirArchivo } = await import('./nativo.js');
      await compartirArchivo(nombre, texto);
      return;
    }
    const file = new File([texto], nombre, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: nombre }); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = nombre;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (e) {
    if (e?.name === 'AbortError' || /cancel/i.test(e?.message || '')) return;
    console.error(e);
    toast('No se pudo guardar la copia: ' + (e?.message || e));
  }
}

async function restaurarCopia(file) {
  try {
    const d = JSON.parse(await file.text());
    if (d?.app !== 'cuentas-claras' || !Array.isArray(d.movimientos)) throw new Error('el archivo no es una copia de Cuentas Claras');
    const items = (l) => (Array.isArray(l) ? l : []).filter((x) => x && x.id).map(({ id, ...data }) => ({ id: String(id), data }));
    for (const col of ['cuentas', 'proyectos', 'movimientos']) { const l = items(d[col]); if (l.length) S.backend.bulk(col, l); }
    if (d.ajustes) S.backend.saveAjustes(d.ajustes);
    toast(`Copia restaurada: ${d.movimientos.length} movimientos`);
  } catch (e) {
    console.error(e);
    toast('No se pudo restaurar: ' + (e.message || e));
  }
}

/* ---------- Varios ---------- */
let toastT;
/* ---------- Comprobantes bancarios (imagen → OCR → movimiento) ---------- */
// Android: "Compartir → Cuentas Claras" desde la galería o la app del banco.
async function revisarCompartido() {
  if (!window.Capacitor?.isNativePlatform?.()) return;
  try {
    const { imagenCompartida } = await import('./nativo.js');
    const img = await imagenCompartida();
    if (!img) return;
    if (S.user) leerComprobante(img); else { S.comprobantePendiente = img; toast('Entra a tu cuenta para registrar el comprobante'); }
  } catch (e) { console.error('Compartir', e); }
}

let ocrWorker = null;
async function ocrTexto(img, avance) {
  if (!ocrWorker) {
    const base = new URL('./vendor/tesseract/', location.href).href;
    const { default: Tesseract } = await import('../vendor/tesseract/tesseract.esm.min.js');
    ocrWorker = Tesseract.createWorker('spa', 1, {
      workerPath: base + 'worker.min.js', corePath: base, langPath: base + 'lang', gzip: false,
      logger: (l) => { if (l.status === 'recognizing text') avance(l.progress); },
    }).catch((e) => { ocrWorker = null; throw e; });
  }
  const w = await ocrWorker;
  const { data } = await w.recognize(img);
  return data.text || '';
}

async function leerComprobante(img) {
  if (!S.user) { S.comprobantePendiente = img; return; }
  for (let i = 0; i < 50 && !S.loaded?.cuentas; i++) await new Promise((r) => setTimeout(r, 200));
  openSheet('Leyendo comprobante', `<div class="ocr-leyendo"><p>Buscando monto, fecha y beneficiario…</p><progress id="ocr-prog" max="1"></progress><p class="muted small">Se procesa en el celular, sin internet.</p></div>`);
  const prog = () => document.getElementById('ocr-prog');
  let texto = '';
  try { texto = await ocrTexto(img, (p) => { if (prog()) prog().value = p; }); }
  catch (e) { console.error('OCR', e); }
  if (!sheetOpen) return; // el usuario cerró la hoja
  if (!texto.trim()) toast('No se pudo leer el comprobante');
  const r = analizarComprobante(texto);
  // Claves actuales + las de la v1.11, para reconocer también lo aprendido antes
  const benef = [...clavesBeneficiario(r.beneficiario), ...await clavesV111(r.beneficiario)];
  r.beneficiario = null; texto = '';
  const prev = buscarGasto(benef) || {};
  movSheet(null, {
    comprobante: true, tipo: 'gasto', benef,
    fecha: r.fecha, monto: r.monto,
    etiqueta: prev.etiquetaId || '', cuentaId: prev.cuentaId || null, proyectoId: prev.proyectoId || null,
  });
}

function toast(t) {
  const el = document.getElementById('toast');
  el.textContent = t; el.hidden = false; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => { el.classList.remove('show'); setTimeout(() => { el.hidden = true; }, 250); }, 2400);
}
function localGet(k) { try { return localStorage.getItem('cc-' + k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem('cc-' + k, v); } catch {} }

boot();
