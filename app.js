import { visitas } from './datos.js';
import { abrirConsolidado, abrirLevantamiento, iconoEquipo, textoAvance } from './levantamiento.js';

const provincia = document.querySelector('#provincia');
const dia = document.querySelector('#dia');
const rutas = document.querySelector('#rutas');
const detalle = document.querySelector('#detalle');
const provincias = [...new Set(visitas.map(visita => visita.provincia))];
const formatoDia = numero => String(numero).padStart(2, '0');

function elemento(etiqueta, texto, clase) {
  const nodo = document.createElement(etiqueta);
  if (texto) nodo.textContent = texto;
  if (clase) nodo.className = clase;
  return nodo;
}

for (const nombre of provincias) provincia.add(new Option(nombre, nombre));

function actualizarDias() {
  const anterior = dia.value;
  dia.length = 1;
  const dias = new Set(visitas.filter(v => !provincia.value || v.provincia === provincia.value).map(v => v.dia));
  for (const numero of dias) dia.add(new Option('Día ' + formatoDia(numero), numero));
  if (dias.has(Number(anterior))) dia.value = anterior;
}

function mostrarDetalle(visita) {
  document.querySelector('#contexto').textContent = visita.provincia + ' · Día ' + formatoDia(visita.dia);
  document.querySelector('#titulo-detalle').textContent = visita.nombre;
  const campos = [
    ['RENIPRESS', visita.codigo], ['Categoría / nivel', visita.categoria],
    ['Departamento / DIRESA', visita.diresa], ['Distrito', visita.distrito],
    ['Red', visita.red], ['Microred', visita.microred],
    ['Dirección', visita.direccion], ['Director del establecimiento', visita.director],
    ['Responsable de TI', visita.ti], ['HIS / PAC', visita.his],
    ['Estado del levantamiento', textoAvance(visita.codigo) || visita.estado]
  ];
  const datos = document.querySelector('#datos');
  datos.replaceChildren();
  for (const [nombre, valor] of campos) {
    const campo = elemento('div', '', nombre === 'Dirección' ? 'wide' : '');
    campo.append(elemento('dt', nombre), elemento('dd', valor || 'Por confirmar'));
    datos.append(campo);
  }
  detalle.showModal();
}

function tarjeta(visita) {
  const card = elemento('article', '', 'card');
  const titulo = elemento('div', '', 'estacion');
  titulo.append(elemento('span', 'Día ' + formatoDia(visita.dia), 'dia'),
    elemento('h3', visita.nombre));
  const progreso = textoAvance(visita.codigo);
  if (progreso) titulo.append(elemento('small', progreso, 'avance'));
  const acciones = elemento('div', '', 'acciones');
  const ver = elemento('button', 'Ver detalle', 'secundario');
  ver.type = 'button';
  ver.addEventListener('click', () => mostrarDetalle(visita));
  const llegar = elemento('a', 'Cómo llegar', 'primario');
  const destino = visita.gps.split(',').map(parte => parte.trim()).join(',');
  const params = new URLSearchParams({api: '1', destination: destino, travelmode: 'driving', dir_action: 'navigate'});
  llegar.href = 'https://www.google.com/maps/dir/?' + params;
  llegar.target = '_blank';
  llegar.rel = 'noopener noreferrer';
  const registrar = elemento('button', 'Registrar levantamiento', 'secundario');
  registrar.type = 'button';
  registrar.addEventListener('click', () => abrirLevantamiento(visita));
  acciones.append(ver, llegar, registrar);
  const equipos = elemento('button', '', 'secundario boton-consolidado');
  equipos.type = 'button';
  equipos.append(iconoEquipo('pc_actual'), elemento('span', 'Validación de equipos informáticos'));
  equipos.addEventListener('click', () => abrirConsolidado(visita));
  const accionesEstablecimiento = elemento('div', '', 'acciones-establecimiento');
  accionesEstablecimiento.append(acciones, equipos);
  card.append(titulo, accionesEstablecimiento);
  return card;
}

function renderizar() {
  const visibles = visitas.filter(v => (!provincia.value || v.provincia === provincia.value) &&
    (!dia.value || v.dia === Number(dia.value)));
  document.querySelector('#resultado').textContent = visibles.length + (visibles.length === 1 ? ' establecimiento' : ' establecimientos');
  rutas.replaceChildren();
  for (const nombre of provincias) {
    const grupo = visibles.filter(v => v.provincia === nombre);
    if (!grupo.length) continue;
    const seccion = elemento('section', '', 'grupo');
    seccion.append(elemento('h2', nombre), ...grupo.map(tarjeta));
    rutas.append(seccion);
  }
}

provincia.addEventListener('change', () => { actualizarDias(); renderizar(); });
dia.addEventListener('change', renderizar);
document.addEventListener('avance-equipo', renderizar);
actualizarDias();
renderizar();
