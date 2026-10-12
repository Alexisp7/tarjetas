'use strict';

// ------------------------------------------------------------ ajustes del repaso
const CLAVE = 'tarjetas-progreso-v1';   // dónde se guarda el progreso en el dispositivo
const MIN = 60 * 1000;
const DIA = 24 * 60 * MIN;
const PASOS = [1, 10];                  // minutos entre repeticiones de una tarjeta nueva
const PASOS_FALLO = [10];               // minutos tras fallar una tarjeta que ya sabías
const CAMBIO_DE_DIA = 4;                // el día empieza a las 4:00, como en Anki
const ADELANTAR = 20 * MIN;             // si no queda nada, adelanta las que se están aprendiendo
const NOMBRES = { 1: 'Otra vez', 2: 'Difícil', 3: 'Bien', 4: 'Fácil' };

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONO = {
  volver: svg('<path d="M15 18l-6-6 6-6"/>'),
  ajustes: svg('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'),
  deshacer: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>'),
  audio: svg('<path d="M11 5L6 9H3v6h3l5 4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13"/>'),
  compartir: svg('<path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11v9h12v-9"/>'),
  hecho: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
};

const $app = document.getElementById('app');
let datos = null;      // mazos.json
let estado = null;     // progreso guardado
let pantalla = null;   // 'inicio' | 'tarjeta' | 'fin' | 'ajustes'
let estudio = null;    // { mazo, tarjeta, dorso, deshacer }

// ------------------------------------------------------------ utilidades

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function textoPlano(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.textContent.replace(/\s+/g, ' ').trim();
}

function hoy(t = Date.now()) {
  const local = t - new Date(t).getTimezoneOffset() * MIN;
  return Math.floor((local - CAMBIO_DE_DIA * 60 * MIN) / DIA);
}

function modoNoche() {
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

function aviso(mensaje) {
  const el = document.createElement('div');
  el.className = 'aviso';
  el.textContent = mensaje;
  document.body.append(el);
  setTimeout(() => el.remove(), 2500);
}

// ------------------------------------------------------------ progreso guardado

function cargar() {
  try { estado = JSON.parse(localStorage.getItem(CLAVE)); } catch { estado = null; }
  if (!estado || typeof estado !== 'object') estado = {};
  estado.tarjetas ??= {};
  estado.ajustes = { nuevasPorDia: 20, audio: true, ...estado.ajustes };
  ponerAlDia();
}

function ponerAlDia() {
  if (estado.dia?.numero !== hoy()) {
    estado.dia = { numero: hoy(), nuevas: {}, extra: {}, notas: {}, repasadas: 0 };
  }
}

function guardar() {
  try { localStorage.setItem(CLAVE, JSON.stringify(estado)); } catch { aviso('No se pudo guardar el progreso'); }
}

// ------------------------------------------------------------ tarjetas

const cacheTarjetas = new Map();

/** Cada nota produce una o varias tarjetas, igual que en Anki. */
function tarjetasDe(mazo) {
  if (cacheTarjetas.has(mazo.id)) return cacheTarjetas.get(mazo.id);
  const lista = [];
  for (const nota of mazo.notas) {
    const modelo = datos.modelos[nota.modelo];
    if (modelo.cloze) {
      const huecos = new Set([...nota.campos[0].matchAll(/\{\{c(\d+)::/g)].map((m) => Number(m[1])));
      for (const n of [...huecos].sort((a, b) => a - b)) {
        lista.push({ id: `${nota.id}·${n}`, nota, modelo, plantilla: modelo.plantillas[0], ord: n, mazo });
      }
    } else {
      modelo.plantillas.forEach((plantilla, i) => {
        lista.push({ id: `${nota.id}·${i + 1}`, nota, modelo, plantilla, ord: i + 1, mazo });
      });
    }
  }
  cacheTarjetas.set(mazo.id, lista);
  return lista;
}

/** Reparte las tarjetas del mazo en nuevas / aprendiendo / para repasar. */
function clasificar(mazo) {
  ponerAlDia();
  const ahora = Date.now();
  const dia = hoy();
  const r = { nuevas: [], aprender: [], futuras: [], repasar: [] };
  for (const t of tarjetasDe(mazo)) {
    const p = estado.tarjetas[t.id];
    if (!p) r.nuevas.push(t);
    else if (p.fase === 'repaso') { if (p.dia <= dia) r.repasar.push(t); }
    else if (p.vence <= ahora) r.aprender.push(t);
    else r.futuras.push(t);
  }
  // Una sola tarjeta nueva por nota y día (como "enterrar hermanas" en Anki)
  const notas = new Set();
  r.nuevas = r.nuevas.filter((t) => {
    if (estado.dia.notas[t.nota.id] || notas.has(t.nota.id)) return false;
    notas.add(t.nota.id);
    return true;
  });
  r.nuevasSinLimite = r.nuevas.length;
  const limite = estado.ajustes.nuevasPorDia + (estado.dia.extra[mazo.id] ?? 0);
  r.nuevas = r.nuevas.slice(0, Math.max(0, limite - (estado.dia.nuevas[mazo.id] ?? 0)));

  const vence = (t) => estado.tarjetas[t.id].vence;
  r.aprender.sort((a, b) => vence(a) - vence(b));
  r.futuras.sort((a, b) => vence(a) - vence(b));
  r.repasar.sort((a, b) => estado.tarjetas[a.id].dia - estado.tarjetas[b.id].dia);
  return r;
}

function siguienteTarjeta(mazo) {
  const r = clasificar(mazo);
  if (r.aprender.length) return r.aprender[0];
  if (r.repasar.length) return r.repasar[0];
  if (r.nuevas.length) return r.nuevas[0];
  const pronto = r.futuras[0];
  if (pronto && estado.tarjetas[pronto.id].vence - Date.now() <= ADELANTAR) return pronto;
  return null;
}

// ------------------------------------------------------------ repetición espaciada (SM-2, como Anki)

function calcular(progreso, boton, ahora, azar = false) {
  const s = progreso ? { ...progreso } : { fase: 'nueva', facilidad: 2.5, ivl: 0, fallos: 0, repes: 0 };
  s.repes = (s.repes ?? 0) + 1;
  if (s.fase === 'nueva') Object.assign(s, { fase: 'aprender', paso: 0 });

  if (s.fase === 'repaso') {
    const retraso = Math.max(0, hoy(ahora) - s.dia);
    const dificil = Math.max(s.ivl + 1, Math.round(s.ivl * 1.2));
    const bien = Math.max(dificil + 1, Math.round((s.ivl + retraso / 2) * s.facilidad));
    const facil = Math.max(bien + 1, Math.round((s.ivl + retraso) * s.facilidad * 1.3));
    if (boton === 1) {
      s.fallos = (s.fallos ?? 0) + 1;
      s.facilidad = Math.max(1.3, s.facilidad - 0.2);
      s.ivl = 1;
      return pasoAprendizaje(s, 'reaprender', 0, ahora);
    }
    if (boton === 2) s.facilidad = Math.max(1.3, s.facilidad - 0.15);
    if (boton === 4) s.facilidad += 0.15;
    return graduar(s, { 2: dificil, 3: bien, 4: facil }[boton], ahora, azar);
  }

  // Aprendiendo (nueva) o reaprendiendo (tras un fallo)
  const pasos = s.fase === 'aprender' ? PASOS : PASOS_FALLO;
  const alTerminar = s.fase === 'aprender' ? 1 : Math.max(1, s.ivl);
  if (boton === 1) return pasoAprendizaje(s, s.fase, 0, ahora);
  if (boton === 2) {
    const actual = pasos[s.paso];
    const siguiente = pasos[s.paso + 1] ?? actual * 1.5;
    s.vence = ahora + Math.round((actual + siguiente) / 2) * MIN;
    return s;
  }
  if (boton === 3) {
    return s.paso + 1 < pasos.length
      ? pasoAprendizaje(s, s.fase, s.paso + 1, ahora)
      : graduar(s, alTerminar, ahora, azar);
  }
  return graduar(s, s.fase === 'aprender' ? 4 : alTerminar + 1, ahora, azar);
}

function pasoAprendizaje(s, fase, paso, ahora) {
  const pasos = fase === 'aprender' ? PASOS : PASOS_FALLO;
  Object.assign(s, { fase, paso, vence: ahora + pasos[paso] * MIN });
  delete s.dia;
  return s;
}

function graduar(s, ivl, ahora, azar) {
  if (azar && ivl >= 3) ivl = Math.round(ivl * (0.95 + Math.random() * 0.1));
  Object.assign(s, { fase: 'repaso', ivl: Math.min(ivl, 36500), dia: hoy(ahora) + Math.min(ivl, 36500) });
  delete s.vence;
  delete s.paso;
  return s;
}

function textoIntervalo(s, ahora) {
  if (s.fase !== 'repaso') {
    const min = Math.max(1, Math.round((s.vence - ahora) / MIN));
    return min < 60 ? `${min} min` : `${Math.round(min / 60)} h`;
  }
  const d = s.ivl;
  const num = (x) => x.toFixed(1).replace('.', ',').replace(',0', '');
  if (d < 30) return `${d} d`;
  if (d < 365) return `${num(d / 30)} ${d < 45 ? 'mes' : 'meses'}`;
  return `${num(d / 365)} ${d < 548 ? 'año' : 'años'}`;
}

// ------------------------------------------------------------ plantillas (las mismas que en Anki)

function pintar(t, dorso) {
  const { nota, modelo, plantilla, ord, mazo } = t;
  const campos = Object.fromEntries(modelo.campos.map((c, i) => [c, nota.campos[i] ?? '']));
  let html = (dorso ? plantilla.dorso : plantilla.frente).replaceAll('VOZ', mazo.voz);
  html = html.replace(/\{\{([#^])([^}]+)\}\}([\s\S]*?)\{\{\/\2\}\}/g, (_, signo, campo, dentro) =>
    (textoPlano(campos[campo.trim()] ?? '') !== '') === (signo === '#') ? dentro : '');
  return html.replace(/\{\{([^}]+)\}\}/g, (_, expresion) => {
    const filtros = expresion.split(':').map((x) => x.trim());
    let valor = campos[filtros.pop()] ?? '';
    for (const filtro of filtros.reverse()) {
      if (filtro === 'cloze') valor = cloze(valor, ord, dorso);
      else if (filtro.startsWith('tts ')) valor = botonAudio(textoPlano(valor), filtro.slice(4).trim());
    }
    return valor;
  });
}

function cloze(texto, ord, dorso) {
  return texto.replace(/\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g, (_, n, respuesta, pista) => {
    if (Number(n) !== ord) return respuesta;
    return dorso
      ? `<span class="cloze">${respuesta}</span>`
      : `<span class="cloze">[${pista ?? '...'}]</span>`;
  });
}

function botonAudio(frase, voz) {
  return `<button type="button" class="audio" data-accion="audio" data-frase="${esc(frase)}" data-voz="${esc(voz)}" aria-label="Escuchar">${ICONO.audio}</button>`;
}

function hablar(frase, voz) {
  if (!('speechSynthesis' in window) || !frase) return;
  const idioma = voz.replace('_', '-').toLowerCase();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(frase);
  u.lang = idioma;
  u.rate = 0.95;
  const voces = speechSynthesis.getVoices().filter((v) => v.lang.replace('_', '-').toLowerCase() === idioma);
  if (voces.length) u.voice = voces.find((v) => v.localService) ?? voces[0];
  speechSynthesis.speak(u);
}

// ------------------------------------------------------------ pantallas

function cuentas(r) {
  const n = (valor, clase) => `<span class="${clase}${valor ? '' : ' cero'}">${valor}</span>`;
  return `<span class="cuentas">${n(r.nuevas.length, 'n-nuevas')}${n(r.aprender.length + r.futuras.length, 'n-aprender')}${n(r.repasar.length, 'n-repasar')}</span>`;
}

function nombreCorto(mazo) {
  return mazo.nombre.split('::').pop();
}

function consejoInstalar() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const instalada = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (!ios || instalada) return '';
  return `<div class="consejo">Para instalarla en el iPhone: en Safari toca <b>Compartir</b> ${ICONO.compartir} y luego <b>Añadir a pantalla de inicio</b>.</div>`;
}

function pantallaInicio() {
  pantalla = 'inicio';
  estudio = null;
  const filas = datos.mazos.map((mazo, i) => {
    const partes = mazo.nombre.split('::');
    const nombre = partes.pop();
    return `<button class="mazo" data-accion="estudiar" data-mazo="${i}">
      <span class="mazo-texto">${partes.length ? `<span class="grupo">${esc(partes.join(' › '))}</span>` : ''}<span class="nombre">${esc(nombre)}</span></span>
      ${cuentas(clasificar(mazo))}
    </button>`;
  }).join('');
  const n = estado.dia.repasadas;
  $app.innerHTML = `
    <header class="barra">
      <h1>Tarjetas</h1>
      <button class="icono" data-accion="ajustes" aria-label="Ajustes">${ICONO.ajustes}</button>
    </header>
    <main class="contenido"><div class="lista">
      ${consejoInstalar()}
      ${filas || '<p class="vacio">No hay mazos.</p>'}
      <p class="leyenda"><span class="n-nuevas">Nuevas</span> · <span class="n-aprender">Aprendiendo</span> · <span class="n-repasar">Para repasar</span></p>
      <p class="resumen-dia">Hoy has respondido ${n} tarjeta${n === 1 ? '' : 's'}.</p>
    </div></main>`;
}

function empezar(indice) {
  estudio = { mazo: datos.mazos[indice], tarjeta: null, dorso: false, deshacer: null };
  mostrarSiguiente();
}

function mostrarSiguiente() {
  estudio.tarjeta = siguienteTarjeta(estudio.mazo);
  estudio.dorso = false;
  if (estudio.tarjeta) pantallaTarjeta();
  else pantallaFin();
}

function pantallaTarjeta() {
  pantalla = 'tarjeta';
  const { mazo, tarjeta, dorso } = estudio;
  const ahora = Date.now();
  const progreso = estado.tarjetas[tarjeta.id];
  const pie = dorso
    ? `<div class="respuestas">${[1, 2, 3, 4].map((b) => `
        <button class="r${b}" data-accion="responder" data-boton="${b}">
          <span>${NOMBRES[b]}</span><small>${textoIntervalo(calcular(progreso, b, ahora), ahora)}</small>
        </button>`).join('')}</div>`
    : '<div class="pie"><button class="mostrar" data-accion="mostrar">Mostrar respuesta</button></div>';
  $app.innerHTML = `
    <header class="barra">
      <button class="icono" data-accion="inicio" aria-label="Volver">${ICONO.volver}</button>
      <h1>${esc(nombreCorto(mazo))}</h1>
      ${cuentas(clasificar(mazo))}
      <button class="icono" data-accion="deshacer" aria-label="Deshacer"${estudio.deshacer ? '' : ' disabled'}>${ICONO.deshacer}</button>
    </header>
    <main class="contenido area-tarjeta"${dorso ? '' : ' data-accion="mostrar"'}>
      <div class="card${modoNoche() ? ' nightMode' : ''}">${pintar(tarjeta, dorso)}</div>
    </main>
    ${pie}`;
}

function mostrarRespuesta() {
  estudio.dorso = true;
  pantallaTarjeta();
  const audio = $app.querySelector('.audio');
  if (estado.ajustes.audio && audio) hablar(audio.dataset.frase, audio.dataset.voz);
}

function responder(boton) {
  const { mazo, tarjeta } = estudio;
  ponerAlDia();
  const antes = estado.tarjetas[tarjeta.id];
  estudio.deshacer = { tarjeta, progreso: antes, dia: JSON.parse(JSON.stringify(estado.dia)) };
  if (!antes) estado.dia.nuevas[mazo.id] = (estado.dia.nuevas[mazo.id] ?? 0) + 1;
  estado.dia.notas[tarjeta.nota.id] = true;
  estado.dia.repasadas++;
  estado.tarjetas[tarjeta.id] = calcular(antes, boton, Date.now(), true);
  guardar();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  mostrarSiguiente();
}

function deshacer() {
  const d = estudio?.deshacer;
  if (!d) return;
  if (d.progreso) estado.tarjetas[d.tarjeta.id] = d.progreso;
  else delete estado.tarjetas[d.tarjeta.id];
  estado.dia = d.dia;
  guardar();
  Object.assign(estudio, { tarjeta: d.tarjeta, dorso: false, deshacer: null });
  pantallaTarjeta();
}

function pantallaFin() {
  pantalla = 'fin';
  const r = clasificar(estudio.mazo);
  const proxima = r.futuras[0] && Math.ceil((estado.tarjetas[r.futuras[0].id].vence - Date.now()) / MIN);
  $app.innerHTML = `
    <header class="barra">
      <button class="icono" data-accion="inicio" aria-label="Volver">${ICONO.volver}</button>
      <h1>${esc(nombreCorto(estudio.mazo))}</h1>
      <button class="icono" data-accion="deshacer" aria-label="Deshacer"${estudio.deshacer ? '' : ' disabled'}>${ICONO.deshacer}</button>
    </header>
    <main class="contenido"><div class="fin">
      <span class="fin-icono">${ICONO.hecho}</span>
      <h2>¡Terminado por hoy!</h2>
      <p>${proxima ? `Quedan tarjetas aprendiéndose: vuelve en ${proxima} min.` : 'Vuelve mañana para seguir repasando.'}</p>
      ${r.nuevasSinLimite ? '<button class="boton" data-accion="mas-nuevas">Aprender 10 nuevas más</button>' : ''}
      <button class="boton secundario" data-accion="inicio">Volver a los mazos</button>
    </div></main>`;
}

function pantallaAjustes() {
  pantalla = 'ajustes';
  $app.innerHTML = `
    <header class="barra">
      <button class="icono" data-accion="inicio" aria-label="Volver">${ICONO.volver}</button>
      <h1>Ajustes</h1>
    </header>
    <main class="contenido"><div class="lista ajustes">
      <label class="fila">Tarjetas nuevas por día
        <input type="number" id="nuevas" min="0" max="999" inputmode="numeric" value="${estado.ajustes.nuevasPorDia}">
      </label>
      <label class="fila">Leer la respuesta en voz alta
        <input type="checkbox" id="audio"${estado.ajustes.audio ? ' checked' : ''}>
      </label>
      <h2>Copia de seguridad</h2>
      <p class="ayuda">Tu progreso se guarda solo en este dispositivo. Exporta una copia de vez en cuando
        (por ejemplo a Archivos o iCloud) para no perderlo si cambias de móvil.</p>
      <button class="boton" data-accion="exportar">Exportar progreso</button>
      <label class="boton secundario">Importar progreso
        <input type="file" id="importar" accept="application/json,.json" hidden>
      </label>
      <h2>Borrar</h2>
      <button class="boton peligro" data-accion="borrar">Borrar todo el progreso</button>
    </div></main>`;
}

function refrescar() {
  if (pantalla === 'inicio') pantallaInicio();
  else if (pantalla === 'tarjeta') pantallaTarjeta();
}

// ------------------------------------------------------------ copia de seguridad

async function exportar() {
  const nombre = `progreso-tarjetas-${new Date().toISOString().slice(0, 10)}.json`;
  const archivo = new File([JSON.stringify(estado)], nombre, { type: 'application/json' });
  if (navigator.canShare?.({ files: [archivo] })) {
    try { await navigator.share({ files: [archivo] }); } catch { /* cancelado */ }
    return;
  }
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(archivo);
  enlace.download = nombre;
  enlace.click();
  setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
}

async function importar(archivo) {
  let nuevo;
  try {
    nuevo = JSON.parse(await archivo.text());
    if (!nuevo || typeof nuevo.tarjetas !== 'object') throw new Error();
  } catch {
    aviso('Ese archivo no es una copia de seguridad válida');
    return;
  }
  if (!confirm('Esto reemplazará el progreso de este dispositivo. ¿Continuar?')) return;
  localStorage.setItem(CLAVE, JSON.stringify(nuevo));
  cargar();
  aviso('Progreso importado');
  pantallaInicio();
}

// ------------------------------------------------------------ eventos

$app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-accion]');
  if (!el || el.disabled) return;
  switch (el.dataset.accion) {
    case 'inicio': pantallaInicio(); break;
    case 'ajustes': pantallaAjustes(); break;
    case 'estudiar': empezar(Number(el.dataset.mazo)); break;
    case 'mostrar': mostrarRespuesta(); break;
    case 'responder': responder(Number(el.dataset.boton)); break;
    case 'deshacer': deshacer(); break;
    case 'audio': hablar(el.dataset.frase, el.dataset.voz); break;
    case 'mas-nuevas':
      estado.dia.extra[estudio.mazo.id] = (estado.dia.extra[estudio.mazo.id] ?? 0) + 10;
      guardar();
      mostrarSiguiente();
      break;
    case 'exportar': exportar(); break;
    case 'borrar':
      if (confirm('¿Seguro? Se borrará todo tu progreso de este dispositivo.')) {
        estado = { ajustes: estado.ajustes };
        guardar();
        cargar();
        aviso('Progreso borrado');
      }
      break;
  }
});

$app.addEventListener('change', (e) => {
  if (e.target.id === 'nuevas') {
    estado.ajustes.nuevasPorDia = Math.max(0, Math.min(999, Number(e.target.value) || 0));
    guardar();
  } else if (e.target.id === 'audio') {
    estado.ajustes.audio = e.target.checked;
    guardar();
  } else if (e.target.id === 'importar' && e.target.files[0]) {
    importar(e.target.files[0]);
  }
});

// Atajos de teclado (para el ordenador): espacio = mostrar / Bien, 1-4 = responder, Z = deshacer
document.addEventListener('keydown', (e) => {
  if (pantalla !== 'tarjeta' || e.target.matches('input')) return;
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    if (estudio.dorso) responder(3); else mostrarRespuesta();
  } else if (estudio.dorso && ['1', '2', '3', '4'].includes(e.key)) {
    responder(Number(e.key));
  } else if (e.key.toLowerCase() === 'z') {
    deshacer();
  } else if (e.key === 'Escape') {
    pantallaInicio();
  }
});

document.addEventListener('visibilitychange', () => { if (!document.hidden && pantalla === 'inicio') pantallaInicio(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', refrescar);

// ------------------------------------------------------------ arranque

async function iniciar() {
  cargar();
  try {
    const resp = await fetch('mazos.json', { cache: 'no-cache' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    datos = await resp.json();
  } catch (error) {
    $app.innerHTML = `<div class="fin"><h2>No se pudieron cargar los mazos</h2><p>${esc(error.message)}</p></div>`;
    return;
  }
  pantallaInicio();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.storage?.persist?.();
}

iniciar();
