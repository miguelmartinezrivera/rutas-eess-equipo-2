import { areas, bloquesBase, camposEquipamiento, definirBloque, esAmbiente, normalizarNombreAmbiente, ordenFicha, secciones } from './campos.js';

const dialogo = document.querySelector('#dialogo-campo');
const titulo = document.querySelector('#titulo-campo');
const contenido = document.querySelector('#contenido-campo');
const acceso = document.querySelector('#acceso-equipo');
const fechaHora = new Intl.DateTimeFormat('es-PE', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Lima'
});
const sesionClave = 'eess-equipo2-sesion';
let sesion = JSON.parse(sessionStorage.getItem(sesionClave) || 'null');
let renovacion;
let personas = [];
let avance = {};
let vista = 0;
let desmontarFicha;
const seccionesAbiertas = new Map();
const filtrosPendientes = new Map();
const svgNS = 'http://www.w3.org/2000/svg';
const iconosEquipamiento = {
  pc: 'M4 4h16a1 1 0 0 1 1 1v11H3V5a1 1 0 0 1 1-1ZM12 16v4m-4 0h8',
  laptop: 'M5 5h14v11H5zM5 16l-3 3v1h20v-1l-3-3',
  impresora: 'M6 9V3h12v6M6 17H3V9h18v8h-3M6 14h12v7H6zM17 11.5h1',
  huella: 'M4 11a8 8 0 0 1 16 0v2M7 11a5 5 0 0 1 10 0v3a14 14 0 0 1-1 5M10 11a2 2 0 1 1 4 0v3a13 13 0 0 1-2.2 7M7 14v1a8 8 0 0 1-1 4m4-5v1a10 10 0 0 1-1.6 6M20 16l-.5 2',
  dnie: 'M3 5h18v14H3zM7 10a2 2 0 1 0 4 0 2 2 0 0 0-4 0Zm-1 6a3 3 0 0 1 6 0m3-6h3m-3 4h3',
  observaciones: 'M5 3h10l4 4v14H5zM15 3v5h4M8 12h8m-8 4h8'
};

function nodo(etiqueta, texto = '', clase = '') {
  const elemento = document.createElement(etiqueta);
  elemento.textContent = texto;
  elemento.className = clase;
  return elemento;
}

function boton(texto, accion, clase = 'secundario') {
  const elemento = nodo('button', texto, clase);
  elemento.type = 'button';
  elemento.addEventListener('click', accion);
  return elemento;
}

function aviso(texto = '') {
  const elemento = nodo('p', texto, 'aviso-campo');
  elemento.setAttribute('role', 'status');
  return elemento;
}

function mostrar(etiqueta, ...elementos) {
  vista += 1;
  desmontarFicha?.();
  desmontarFicha = undefined;
  titulo.textContent = etiqueta;
  contenido.replaceChildren(...elementos);
  if (!dialogo.open) dialogo.showModal();
  dialogo.scrollTop = 0;
  return vista;
}

dialogo.addEventListener('close', () => {
  if (dialogo.open) return;
  desmontarFicha?.();
  desmontarFicha = undefined;
});

function asignarSesion(datos) {
  sesion = datos && { ...datos, vence: Date.now() + datos.expires_in * 1000 };
  if (sesion) sessionStorage.setItem(sesionClave, JSON.stringify(sesion));
  else sessionStorage.removeItem(sesionClave);
}

async function respuesta(accion, { codigo, body, token, ruta } = {}) {
  const parametros = new URLSearchParams({ accion });
  if (codigo) parametros.set('codigo', codigo);
  if (ruta) parametros.set('ruta', ruta);
  const headers = new Headers();
  if (token) headers.set('Authorization', 'Bearer ' + token);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const res = await fetch('/api/campo?' + parametros, {
    headers, method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (res.ok || res.status === 409) return res;
  const datos = await res.json().catch(() => ({}));
  throw Object.assign(new Error(datos.error || 'No se pudo conectar con el sistema de campo.'), { status: res.status });
}

async function renovarSesion() {
  if (renovacion) return renovacion;
  const actual = sesion;
  renovacion = (async () => {
    try {
      const res = await respuesta('sesion', { body: { refresh_token: actual.refresh_token } });
      const datos = await res.json();
      if (sesion === actual) asignarSesion(datos);
    } catch (error) {
      if ([401, 403].includes(error.status) && sesion === actual) limpiarSesion();
      throw error;
    } finally {
      renovacion = null;
    }
  })();
  return renovacion;
}

async function api(accion, opciones = {}) {
  if (!sesion) throw new Error('Inicia sesión para continuar.');
  if (sesion.vence < Date.now() + 30000) await renovarSesion();
  const token = sesion?.access_token;
  try {
    return await respuesta(accion, { ...opciones, token });
  } catch (error) {
    if (error.status !== 401 || !sesion) throw error;
    if (sesion.access_token === token) await renovarSesion();
    return respuesta(accion, { ...opciones, token: sesion.access_token });
  }
}

function limpiarSesion() {
  asignarSesion(null);
  personas = [];
  avance = {};
  acceso.textContent = 'Ingresar como integrante';
  document.dispatchEvent(new Event('avance-equipo'));
}

function nombrePersona(id) {
  return personas.find(persona => persona.usuario === id)?.nombre || 'Integrante del equipo';
}

async function cargarEquipo() {
  const res = await api('equipo');
  const datos = await res.json();
  if (!sesion) return;
  personas = datos.personas;
  avance = datos.avance;
  acceso.textContent = nombrePersona(sesion.usuario);
  document.dispatchEvent(new Event('avance-equipo'));
}

export function textoAvance(codigo) {
  if (!sesion) return '';
  const { registrados = 0, ambientes = areas.length } = avance[codigo] || {};
  return registrados + ' de ' + (bloquesBase.length + ambientes) + ' bloques registrados';
}

function inicioSesion(alIngresar) {
  const form = nodo('form', '', 'form-campo');
  const usuario = entrada({ etiqueta: 'Usuario', tipo: 'text' });
  const clave = entrada({ etiqueta: 'Contraseña', tipo: 'password' });
  usuario.input.autocomplete = 'username';
  usuario.input.autocapitalize = 'none';
  usuario.input.spellcheck = false;
  clave.input.autocomplete = 'current-password';
  usuario.input.required = clave.input.required = true;
  const estado = aviso();
  const enviar = nodo('button', 'Ingresar', 'primario');
  form.append(usuario.label, clave.label, enviar, estado);
  const idVista = mostrar('Acceso del Equipo 2', form);
  form.addEventListener('submit', async evento => {
    evento.preventDefault();
    enviar.disabled = true;
    estado.textContent = 'Ingresando…';
    try {
      const res = await respuesta('sesion', { body: { usuario: usuario.input.value, password: clave.input.value } });
      asignarSesion(await res.json());
      await cargarEquipo();
      if (idVista !== vista || !dialogo.open) return;
      if (alIngresar) await alIngresar();
      else dialogo.close();
    } catch (error) {
      estado.textContent = error.message;
    } finally {
      enviar.disabled = false;
    }
  });
}

acceso.addEventListener('click', () => {
  if (!sesion) return inicioSesion();
  const estado = aviso();
  mostrar('Cuenta del Equipo 2', boton('Cerrar sesión', async () => {
    try {
      await api('salir', { body: {} });
    } catch (error) {
      estado.textContent = error.message;
    } finally {
      limpiarSesion();
      dialogo.close();
    }
  }), estado);
});
if (sesion) cargarEquipo().catch(() => {});
window.addEventListener('focus', () => {
  if (sesion) cargarEquipo().catch(() => {});
});

function datosCapturados(registro) {
  return Boolean(registro && Object.keys(registro.datos).length);
}

function auditoria(registro) {
  if (!registro?.registrado_en) return '';
  const inicio = 'Registró ' + nombrePersona(registro.registrado_por) + ' · ' + fechaHora.format(new Date(registro.registrado_en));
  const actualizado = registro.actualizado_en !== registro.registrado_en || registro.actualizado_por !== registro.registrado_por;
  return !actualizado ? inicio : inicio + '. Última actualización de ' +
    nombrePersona(registro.actualizado_por) + ' · ' + fechaHora.format(new Date(registro.actualizado_en));
}

function antecedentes(referencia) {
  const bloque = nodo('details', '', 'antecedentes');
  bloque.append(nodo('summary', 'Brechas históricas y prioridad HIS'));
  if (!referencia) {
    bloque.append(nodo('p', 'La referencia histórica aún no está disponible.'));
    return bloque;
  }
  if (referencia.his) bloque.append(nodo('p', 'Nodo HIS priorizado según el cronograma.'));
  if (!referencia.grupos.length) bloque.append(nodo('p', 'Sin antecedente en el Excel de brechas.'));
  for (const grupo of referencia.grupos) {
    bloque.append(nodo('h4', grupo.nombre), valoresReferencia(grupo.campos));
  }
  return bloque;
}

function valoresReferencia(campos) {
  const lista = nodo('dl');
  for (const [nombre, valor] of campos) {
    if (/^tablets?\d*$/i.test(nombre.trim())) continue;
    const item = nodo('div');
    item.append(nodo('dt', nombre), nodo('dd', String(valor)));
    lista.append(item);
  }
  return lista;
}

async function descargarExcel(visita, estado) {
  estado.textContent = 'Generando ficha…';
  try {
    const res = await api('excel', { codigo: visita.codigo });
    const nombre = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition'))?.[1] || visita.codigo + '.xlsx';
    guardarArchivo(await res.blob(), nombre);
    estado.textContent = 'Ficha generada.';
  } catch (error) {
    estado.textContent = error.message;
  }
}

function guardarArchivo(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const enlace = nodo('a');
  enlace.href = url;
  enlace.download = nombre;
  enlace.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function abrirConsolidado(visita) {
  if (!sesion) return inicioSesion(() => abrirConsolidado(visita));
  const estado = aviso('Cargando equipamiento…');
  const encabezado = 'Validación de equipos informáticos';
  const idVista = mostrar(encabezado, estado);
  try {
    const res = await api('ficha', { codigo: visita.codigo });
    const { registros, referencia } = await res.json();
    if (idVista !== vista || !dialogo.open) return;
    const ambientes = registros.filter(registro => registro.ambiente && !registro.retirado);
    mostrarConsolidado(visita, encabezado, ambientes, referencia);
  } catch (error) {
    if (idVista !== vista || !dialogo.open) return;
    estado.textContent = error.message;
    contenido.append(boton(sesion ? 'Reintentar' : 'Ingresar', () => abrirConsolidado(visita)));
  }
}

function mostrarConsolidado(visita, encabezado, ambientes, referencia) {
  const tarjetas = nodo('div', '', 'consolidado-equipos');
  for (const campo of camposEquipamiento.filter(campo => campo.tipo === 'number' && campo.id !== 'pc_brecha')) {
    const pc = campo.id === 'pc_actual';
    const etiqueta = { id: campo.id, etiqueta: campo.etiqueta.split(' · ')[0] };
    const asistencial = referencia?.equipamiento_asistencial?.[pc ? 'pc' : campo.id];
    const actual = inventarioDeCampo(ambientes, campo.id);
    const brecha = pc ? inventarioDeCampo(ambientes, 'pc_brecha') : null;
    const equipo = { etiqueta, asistencial, actual, brecha };
    const tarjeta = boton('', () => mostrarDistribucion(visita, equipo,
      () => mostrarConsolidado(visita, encabezado, ambientes, referencia)), 'tarjeta-consolidado');
    tarjeta.append(etiquetarCampo(nodo('span'), etiqueta, true));
    if (campo.id === 'huella') {
      tarjeta.append(nodo('strong', String(actual.total ?? 'Sin datos'), 'cantidad-consolidado'),
        nodo('span', 'Registrado en campo', 'contexto-ficha'));
    } else {
      tarjeta.append(cifrasAsistenciales(asistencial),
        nodo('span', avanceEquipos(actual.total, asistencial?.actual), 'contexto-ficha'));
    }
    tarjeta.append(nodo('span', 'Detalle por áreas', 'enlace-consolidado'));
    tarjetas.append(tarjeta);
  }
  const origen = referencia?.equipamiento_asistencial
    ? 'Actual y faltante asistencial del Excel · ' + referencia.fuente
    : 'Sin referencia asistencial del Excel para este establecimiento.';
  mostrar(encabezado, nodo('p', visita.nombre, 'consolidado-sede'),
    nodo('h3', 'Equipamiento asistencial y avance en campo', 'titulo-consolidado'),
    nodo('p', origen, 'contexto-ficha'), tarjetas);
}

function inventarioDeCampo(ambientes, id) {
  const cantidades = ambientes.map(({ ambiente, datos }) => ({ ambiente, cantidad: datos[id] }))
    .filter(({ cantidad }) => Number.isInteger(cantidad) && cantidad >= 0);
  return {
    cantidades,
    total: cantidades.length ? cantidades.reduce((suma, { cantidad }) => suma + cantidad, 0) : null,
    cobertura: cantidades.length + ' de ' + ambientes.length + ' áreas con datos'
  };
}

function cifrasAsistenciales(referencia) {
  const par = nodo('span', '', 'cifras-asistenciales');
  for (const [etiqueta, valor] of [['Actual', referencia?.actual], ['Faltante', referencia?.faltante]]) {
    const cifra = nodo('span', '', 'cifra-asistencial');
    cifra.append(nodo('span', etiqueta), nodo('strong', String(valor ?? '—'), 'cantidad-consolidado'));
    par.append(cifra);
  }
  return par;
}

function avanceEquipos(total, actualExcel) {
  if (total === null) return 'Sin datos en campo';
  if (actualExcel == null) return total + ' registrados en campo';
  return total + ' de ' + actualExcel + ' registrados en campo';
}

function mostrarDistribucion(visita, equipo, volver, mostrarBrecha = false) {
  const { etiqueta, asistencial, actual, brecha } = equipo;
  const { cantidades, total, cobertura } = mostrarBrecha ? brecha : actual;
  const distribucion = cantidades.filter(({ cantidad }) => cantidad > 0);
  const cero = cantidades.length - distribucion.length;
  const lista = nodo('dl', '', 'distribucion-equipos');
  for (const { ambiente, cantidad } of distribucion) {
    const fila = nodo('div');
    fila.append(nodo('dt', ambiente), nodo('dd', String(cantidad)));
    lista.append(fila);
  }
  const elementos = [nodo('p', visita.nombre, 'consolidado-sede')];
  if (brecha) {
    const modos = nodo('div', '', 'controles-campo');
    for (const [nombre, esBrecha] of [['Ver actual', false], ['Ver brecha', true]]) {
      const activo = mostrarBrecha === esBrecha;
      const opcion = boton(nombre, () => mostrarDistribucion(visita, equipo, volver, esBrecha), activo ? 'primario' : 'secundario');
      opcion.setAttribute('aria-pressed', String(activo));
      modos.append(opcion);
    }
    elementos.push(modos);
  }
  elementos.push(nodo('p', avanceEquipos(total, mostrarBrecha ? asistencial?.faltante : asistencial?.actual), 'avance'),
    nodo('p', cobertura, 'contexto-ficha'));
  if (distribucion.length) elementos.push(lista);
  if (cero) elementos.push(nodo('p', cero === 1 ? '1 área con cero confirmado' : cero + ' áreas con cero confirmado', 'contexto-ficha'));
  const acciones = nodo('div', '', 'controles-campo acciones-consolidado');
  acciones.append(boton('Actualizar en campo', () => {
    seccionesAbiertas.set(visita.codigo, 'equipamiento');
    filtrosPendientes.set(visita.codigo, false);
    abrirLevantamiento(visita);
  }, 'primario'), boton('Volver al consolidado', volver));
  elementos.push(acciones);
  mostrar(etiqueta.etiqueta, ...elementos);
}

export async function abrirLevantamiento(visita) {
  if (!sesion) return inicioSesion(() => abrirLevantamiento(visita));
  const estado = aviso('Cargando ficha…');
  const idVista = mostrar(visita.nombre, estado);
  try {
    if (!personas.length) await cargarEquipo();
    const [res, { montarFicha }] = await Promise.all([
      api('ficha', { codigo: visita.codigo }),
      import('./ficha-react.js')
    ]);
    const ficha = await res.json();
    if (idVista !== vista || !dialogo.open) return;
    mostrarFicha(visita, ficha, montarFicha);
  } catch (error) {
    if (idVista !== vista || !dialogo.open) return;
    estado.textContent = error.message;
    contenido.append(boton(sesion ? 'Reintentar' : 'Ingresar', () => abrirLevantamiento(visita)));
  }
}

function mostrarFicha(visita, { registros, referencia }, montarFicha) {
  const porBloque = new Map(registros.map(registro => [registro.bloque, registro]));
  const ambientes = registros.filter(registro => registro.ambiente);
  avance[visita.codigo] = { registrados: registros.filter(datosCapturados).length, ambientes: ambientes.length };
  document.dispatchEvent(new Event('avance-equipo'));
  const estado = aviso();
  const cabecera = nodo('p', 'RENIPRESS ' + visita.codigo + ' · ' + visita.provincia + ' · Día ' + visita.dia, 'contexto-ficha');
  const controles = nodo('div', '', 'controles-campo');
  controles.append(boton('Actualizar avance', () => abrirLevantamiento(visita)),
    boton('Generar Excel', async evento => {
      evento.currentTarget.disabled = true;
      await descargarExcel(visita, estado);
      const control = controles.querySelector('.primario');
      if (control) control.disabled = false;
    }, 'primario'));
  function prepararBloque(clave) {
    const registro = porBloque.get(clave);
    const definicion = definirBloque(clave);
    if (!definicion) return null;
    const registrado = datosCapturados(registro);
    const datos = registro?.datos ?? {};
    let equipamiento = null;
    if (esAmbiente(clave)) {
      const cantidades = definicion.campos.filter(campo => campo.tipo === 'number');
      const llenados = cantidades.filter(({ id }) => Number.isInteger(datos[id])).length;
      equipamiento = { llenados, total: cantidades.length, observaciones: datos.observaciones?.trim() || '' };
    }
    return {
      clave,
      nombre: registro?.ambiente ?? definicion.nombre,
      registrado,
      completo: equipamiento ? equipamiento.llenados === equipamiento.total : registrado,
      equipamiento,
      asignado: registro?.asignado_a ? nombrePersona(registro.asignado_a) : '',
      auditoria: auditoria(registro),
      ver: registrado ? () => verRegistro(visita, clave, registro) : null,
      editar: () => editar(visita, clave, registro),
      asignar: () => organizarBloque(visita, clave, registro),
      quitar: registro?.ambiente ? () => organizarBloque(visita, clave, registro, true) : null
    };
  }
  const panel = nodo('div', '', 'navegacion-ficha');
  mostrar(visita.nombre, cabecera, controles, estado, panel, antecedentes(referencia));
  desmontarFicha = montarFicha(panel, {
    secciones: ordenFicha.map(clave => ({
      clave,
      nombre: clave === 'equipamiento' ? 'Validación de equipamiento informático' : secciones[clave].nombre,
      bloques: (clave === 'equipamiento' ? ambientes.map(registro => registro.bloque) : [clave]).map(prepararBloque).filter(Boolean)
    })),
    inicial: seccionesAbiertas.has(visita.codigo) ? seccionesAbiertas.get(visita.codigo) : 'equipamiento',
    alCambiar: clave => seccionesAbiertas.set(visita.codigo, clave),
    filtroInicial: filtrosPendientes.get(visita.codigo) ?? false,
    alFiltrar: activo => filtrosPendientes.set(visita.codigo, activo),
    agregarAmbiente: () => agregarAmbiente(visita, ambientes)
  });
}

async function volverConAvance(visita, idVista) {
  await cargarEquipo().catch(() => {});
  if (idVista === vista && dialogo.open) await abrirLevantamiento(visita);
}

function agregarAmbiente(visita, ambientes) {
  const form = nodo('form', '', 'form-campo');
  const { label, input } = entrada({ etiqueta: 'Nombre del ambiente', tipo: 'text' });
  input.required = true;
  input.maxLength = 120;
  input.placeholder = 'Ej. Consultorio 1';
  const existentes = new Set(ambientes.map(r => normalizarNombreAmbiente(r.ambiente).toLowerCase()));
  const sugerencias = areas.filter(nombre => !existentes.has(normalizarNombreAmbiente(nombre).toLowerCase()));
  if (sugerencias.length) {
    const sugerencia = nodo('label', 'Elegir una sugerencia');
    const selector = nodo('select');
    selector.add(new Option('Selecciona un ambiente', ''));
    for (const nombre of sugerencias) selector.add(new Option(nombre, nombre));
    selector.addEventListener('change', () => {
      if (selector.value) input.value = selector.value;
    });
    sugerencia.append(selector);
    form.append(sugerencia);
  }
  const confirmar = nodo('button', 'Confirmar ambiente', 'primario');
  const estado = aviso();
  form.append(label, confirmar);
  form.append(estado);
  const idVista = mostrar('Agregar ambiente', form, boton('Volver a la ficha', () => abrirLevantamiento(visita)));
  form.addEventListener('submit', evento => {
    evento.preventDefault();
    guardar({ nombre: input.value });
  });

  async function guardar(body) {
    confirmar.disabled = true;
    estado.textContent = 'Agregando ambiente…';
    try {
      const res = await api('confirmar-ambientes', { codigo: visita.codigo, body });
      const resultado = await res.json();
      if (resultado.duplicado) {
        estado.textContent = 'Ya existe un ambiente con ese nombre en este establecimiento.';
        return;
      }
      if (!resultado.registro) throw new Error('No se pudo agregar el ambiente. Inténtalo de nuevo.');
      if (idVista === vista && dialogo.open) editar(visita, resultado.registro.bloque, resultado.registro);
    } catch (error) {
      estado.textContent = error.message;
    } finally {
      confirmar.disabled = false;
    }
  }
}

function organizarBloque(visita, clave, registro, retirar = false) {
  const nombre = registro?.ambiente ?? definirBloque(clave).nombre;
  const form = nodo('form', '', 'form-campo');
  const estado = aviso();
  const selector = nodo('select');
  if (retirar) {
    form.append(nodo('p', '«' + nombre + '» se quitará de la ficha y del Excel. Sus datos se conservarán en el historial interno.'));
  } else {
    const label = nodo('label', 'Integrante asignado');
    selector.add(new Option('Sin asignar', ''));
    for (const persona of personas) selector.add(new Option(persona.nombre, persona.usuario));
    selector.value = registro?.asignado_a ?? '';
    label.append(selector);
    form.append(label);
  }
  const guardar = nodo('button', retirar ? 'Quitar ambiente' : 'Guardar asignación', retirar ? 'peligro' : 'primario');
  form.append(guardar, estado);
  const idVista = mostrar(retirar ? 'Quitar ambiente' : 'Asignar · ' + nombre, form,
    boton('Volver a la ficha', () => abrirLevantamiento(visita)));
  form.addEventListener('submit', async evento => {
    evento.preventDefault();
    guardar.disabled = true;
    try {
      const res = await api('organizar', {
        codigo: visita.codigo,
        body: { bloque: clave, version: registro?.version ?? 0, retirar, asignado: selector.value || null }
      });
      const resultado = await res.json();
      if (resultado.conflicto) {
        estado.textContent = 'El registro cambió. Vuelve a la ficha y revisa su versión actual.';
        return;
      }
      await volverConAvance(visita, idVista);
    } catch (error) {
      estado.textContent = error.message;
      guardar.disabled = false;
    }
  });
}

export function iconoEquipo(id) {
  const trazo = iconosEquipamiento[id.startsWith('pc_') ? 'pc' : id];
  if (!trazo) return null;
  const insignia = nodo('span', '', 'icono-equipo');
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const ruta = document.createElementNS(svgNS, 'path');
  ruta.setAttribute('d', trazo);
  svg.append(ruta);
  insignia.append(svg);
  return insignia;
}

function etiquetarCampo(elemento, campo, conIcono) {
  const icono = conIcono && iconoEquipo(campo.id);
  if (!icono) {
    elemento.textContent = campo.etiqueta;
    return elemento;
  }
  const leyenda = nodo('span', '', 'leyenda-equipo');
  leyenda.append(icono, nodo('span', campo.etiqueta));
  elemento.append(leyenda);
  return elemento;
}

function entrada(campo, valor = '', conIcono = false) {
  const label = etiquetarCampo(nodo('label'), campo, conIcono);
  const input = nodo(campo.tipo === 'textarea' ? 'textarea' : 'input');
  if (campo.tipo !== 'textarea') input.type = campo.tipo === 'image' ? 'file' : campo.tipo;
  if (campo.tipo === 'number') {
    input.min = '0';
    input.max = '2147483647';
    input.step = '1';
    input.inputMode = 'numeric';
  } else if (campo.tipo === 'image') input.accept = 'image/*';
  else input.maxLength = 4000;
  if (campo.tipo !== 'image') input.value = valor ?? '';
  label.append(input);
  return { label, input };
}

async function abrirImagen(visita, ruta, estado) {
  try {
    const res = await api('imagen', { codigo: visita.codigo, ruta });
    guardarArchivo(await res.blob(), 'imagen-' + visita.codigo + '.jpg');
  } catch (error) {
    estado.textContent = error.message;
  }
}

function valores(visita, clave, registro, estado) {
  const lista = nodo('dl');
  const datos = clave === 'generales' ? { ...visita, ...registro.datos } : registro.datos;
  const inventario = esAmbiente(clave);
  for (const campo of definirBloque(clave).campos) {
    const dato = datos[campo.id];
    const item = nodo('div', '', inventario && campo.id === 'observaciones' ? 'wide' : '');
    item.append(etiquetarCampo(nodo('dt'), campo, inventario));
    const valor = nodo('dd');
    if (campo.tipo === 'image' && dato) valor.append(boton('Descargar imagen', () => abrirImagen(visita, dato, estado)));
    else valor.textContent = dato === undefined || dato === '' ? 'Sin registrar' : String(dato);
    item.append(valor);
    lista.append(item);
  }
  return lista;
}

function verRegistro(visita, clave, registro) {
  const estado = aviso();
  const acciones = nodo('div', '', 'controles-campo acciones-registro');
  acciones.append(boton('Editar', () => editar(visita, clave, registro)),
    boton('Volver a la ficha', () => abrirLevantamiento(visita)));
  mostrar(registro.ambiente ?? definirBloque(clave).nombre, nodo('p', auditoria(registro)), valores(visita, clave, registro, estado),
    estado, acciones);
}

async function prepararImagen(archivo) {
  const imagen = await createImageBitmap(archivo);
  try {
    const lienzo = nodo('canvas');
    const escala = Math.min(1, 1400 / Math.max(imagen.width, imagen.height));
    lienzo.width = Math.max(1, Math.round(imagen.width * escala));
    lienzo.height = Math.max(1, Math.round(imagen.height * escala));
    const dibujo = lienzo.getContext('2d', { alpha: false });
    dibujo.fillStyle = 'white';
    dibujo.fillRect(0, 0, lienzo.width, lienzo.height);
    dibujo.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
    for (const calidad of [0.8, 0.62, 0.45, 0.3]) {
      const imagenCodificada = lienzo.toDataURL('image/jpeg', calidad).split(',')[1];
      if (imagenCodificada.length < 500000) return imagenCodificada;
    }
    throw new Error('Usa una imagen más pequeña.');
  } finally {
    imagen.close();
  }
}

function editar(visita, clave, registro) {
  const definicion = definirBloque(clave);
  const inventario = esAmbiente(clave);
  const form = nodo('form', '', inventario ? 'form-campo form-equipamiento' : 'form-campo');
  const responsable = nodo('dl');
  const cuenta = nodo('div', '', 'wide');
  cuenta.append(nodo('dt', 'Responsable'), nodo('dd', nombrePersona(sesion.usuario)));
  responsable.append(cuenta);
  form.append(responsable);
  const estado = aviso();
  const base = clave === 'generales' ? visita : {};
  const inicial = { ...base, ...registro?.datos };
  const campos = definicion.campos.map(campo => {
    const control = entrada(campo, inicial[campo.id], inventario);
    if (inventario) {
      control.label.classList.add('campo-equipo');
      if (campo.tipo === 'textarea') control.label.classList.add('wide');
    }
    const actual = inicial[campo.id];
    if (campo.tipo === 'image') {
      control.ruta = actual;
      if (actual) {
        control.label.append(boton('Descargar imagen guardada', () => abrirImagen(visita, actual, estado)));
        const quitar = nodo('label', 'Quitar la imagen guardada');
        const check = nodo('input');
        check.type = 'checkbox';
        quitar.prepend(check);
        quitar.className = 'opcion-campo';
        control.quitar = check;
        form.append(control.label, quitar);
        return { campo, ...control };
      }
    }
    form.append(control.label);
    return { campo, ...control };
  });
  const confirmar = nodo('input');
  if (clave === 'generales') {
    const label = nodo('label', 'Confirmo los datos generales');
    label.className = 'opcion-campo';
    confirmar.type = 'checkbox';
    confirmar.checked = registro?.datos.confirmado === true;
    label.prepend(confirmar);
    form.append(label);
  }
  let version = registro?.version || 0;
  const guardar = nodo('button', 'Guardar', 'primario');
  const conflicto = nodo('section', '', 'conflicto-campo');
  conflicto.hidden = true;
  const volver = boton('Volver a la ficha', () => abrirLevantamiento(visita));
  if (inventario) {
    const acciones = nodo('div', '', 'controles-campo acciones-equipamiento');
    acciones.append(guardar, volver);
    form.append(acciones);
  } else {
    form.append(guardar);
  }
  form.append(estado, conflicto);
  const nombre = registro?.ambiente ?? definicion.nombre;
  const historial = auditoria(registro);
  const elementos = historial ? [nodo('p', historial), form] : [form];
  if (!inventario) elementos.push(volver);
  const idVista = mostrar(nombre, ...elementos);
  form.addEventListener('submit', async evento => {
    evento.preventDefault();
    guardar.disabled = true;
    estado.textContent = 'Guardando…';
    try {
      const datos = {};
      if (clave === 'generales' && confirmar.checked) datos.confirmado = true;
      for (const control of campos) {
        const { campo, input, quitar } = control;
        if (campo.tipo === 'image') {
          const archivo = input.files[0];
          if (archivo && archivo !== control.archivo) {
            const imagen = await prepararImagen(archivo);
            const res = await api('adjunto', { codigo: visita.codigo, body: { imagen } });
            control.ruta = (await res.json()).ruta;
            control.archivo = archivo;
          }
          if (control.ruta && (archivo || !quitar?.checked)) datos[campo.id] = control.ruta;
        } else {
          const valor = input.value.trim();
          const baseValor = String(base[campo.id] ?? '').trim();
          if (clave === 'generales' ? valor !== baseValor : valor !== '') {
            datos[campo.id] = campo.tipo === 'number' ? Number(valor) : valor;
          }
        }
      }
      const res = await api('guardar', { codigo: visita.codigo, body: { bloque: clave, version, datos } });
      const resultado = await res.json();
      if (idVista !== vista || !dialogo.open) return;
      if (resultado.conflicto) {
        const actual = resultado.registro;
        if (!actual || actual.retirado) {
          estado.textContent = 'Este ambiente se quitó de la ficha. Vuelve a la ficha para revisar los ambientes confirmados.';
          conflicto.hidden = false;
          return;
        }
        estado.textContent = 'Existe una versión más reciente. Revisa sus datos antes de guardar.';
        conflicto.hidden = false;
        conflicto.replaceChildren(nodo('h3', 'Versión guardada'), nodo('p', auditoria(actual)),
          valores(visita, clave, actual, estado),
          boton('Usar la versión guardada', () => editar(visita, clave, actual)),
          boton('Conservar mi edición después de revisar', () => {
            version = actual.version;
            conflicto.hidden = true;
            estado.textContent = 'Tu edición sigue abierta. Pulsa Guardar para aplicar tus cambios.';
            guardar.disabled = false;
          }));
        return;
      }
      estado.textContent = 'Guardado.';
      await volverConAvance(visita, idVista);
    } catch (error) {
      estado.textContent = error.message;
    } finally {
      guardar.disabled = !conflicto.hidden;
    }
  });
}
