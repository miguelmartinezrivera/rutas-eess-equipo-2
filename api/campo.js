import { randomUUID } from 'node:crypto';
import { visitas } from '../datos.js';
import { areas, definirBloque, esAmbiente, normalizarNombreAmbiente } from '../campos.js';
import { generarExcel } from '../lib/xlsx.mjs';
import { correoDeUsuario } from '../lib/acceso.mjs';

const codigos = new Set(visitas.map(visita => visita.codigo));
const ordenAmbientes = new Map(areas.map((nombre, indice) => [nombre.toLowerCase(), indice]));
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const plantilla = /^[-A-Za-z0-9_]+\/Dia_\d{2}\/\d{2}_\d{8}_[A-Z_0-9]+\.xlsx$/;

class ErrorCampo extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(res, status, datos) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(datos));
}

async function cuerpo(req) {
  const partes = [];
  let bytes = 0;
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  for await (const parte of typeof req.body === 'string' || Buffer.isBuffer(req.body) ? [req.body] : req) {
    bytes += Buffer.byteLength(parte);
    if (bytes > 1_500_000) throw new ErrorCampo(413, 'El archivo supera el tamaño permitido.');
    partes.push(Buffer.from(parte));
  }
  try {
    return JSON.parse(Buffer.concat(partes).toString('utf8'));
  } catch {
    throw new ErrorCampo(400, 'La solicitud debe contener JSON válido.');
  }
}

function rutaAdjunto(valor, codigo) {
  return typeof valor === 'string' && valor.startsWith(codigo + '/') &&
    valor.endsWith('.jpg') && uuid.test(valor.slice(9, -4));
}

function validarRegistro(codigo, solicitud) {
  const { bloque, datos, version } = solicitud ?? {};
  const definicion = typeof bloque === 'string' && definirBloque(bloque);
  if (!definicion || !Number.isInteger(version) || version < 0 || version > 2147483647 ||
      !datos || typeof datos !== 'object' || Array.isArray(datos)) {
    throw new ErrorCampo(400, 'El registro no es válido.');
  }
  const campos = new Map(definicion.campos.map(campo => [campo.id, campo]));
  for (const [id, valor] of Object.entries(datos)) {
    if (bloque === 'generales' && id === 'confirmado' && valor === true) continue;
    const campo = campos.get(id);
    const valido = campo && (
      campo.tipo === 'number' ? Number.isSafeInteger(valor) && valor >= 0 && valor <= 2147483647 :
        campo.tipo === 'image' ? rutaAdjunto(valor, codigo) :
          typeof valor === 'string' && valor.length <= 4000 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(valor)
    );
    if (!valido) throw new ErrorCampo(400, 'Revisa el campo «' + (campo?.etiqueta ?? id) + '».');
  }
  return { p_renipress: codigo, p_bloque: bloque, p_datos: datos, p_version: version };
}

function prepararConfirmacion(codigo, datos) {
  const nombre = typeof datos?.nombre === 'string' ? normalizarNombreAmbiente(datos.nombre) : '';
  if (!nombre || nombre.length > 120 || /[\x00-\x1f]/.test(nombre)) {
    throw new ErrorCampo(400, 'Escribe un nombre de ambiente de hasta 120 caracteres.');
  }
  return {
    p_renipress: codigo, p_omitir_existentes: false,
    p_ambientes: [{ bloque: 'extra-' + randomUUID(), nombre }]
  };
}

function prepararOrganizacion(codigo, datos) {
  const { bloque, version, retirar = false, asignado = null } = datos ?? {};
  if (typeof bloque !== 'string' || !definirBloque(bloque) ||
      !Number.isInteger(version) || version < 0 || version > 2147483647 || typeof retirar !== 'boolean' ||
      (retirar && (!esAmbiente(bloque) || version === 0 || asignado !== null)) ||
      (asignado !== null && (typeof asignado !== 'string' || !uuid.test(asignado)))) {
    throw new ErrorCampo(400, 'Revisa la acción y el integrante seleccionado.');
  }
  return { p_renipress: codigo, p_bloque: bloque, p_version: version, p_retirar: retirar, p_asignado: asignado };
}

function clienteSupabase(token) {
  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new ErrorCampo(503, 'El acceso del equipo requiere configurar Supabase.');
  }
  return async (ruta, { method = 'GET', body, tipo = 'application/json' } = {}) => {
    const headers = { apikey: SUPABASE_PUBLISHABLE_KEY };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = tipo;
    const respuesta = await fetch(SUPABASE_URL.replace(/\/$/, '') + ruta, {
      method, headers, body: tipo === 'application/json' && body !== undefined ? JSON.stringify(body) : body,
      signal: AbortSignal.timeout(20000)
    });
    if (!respuesta.ok) {
      const permisos = respuesta.status === 401 || respuesta.status === 403;
      const detalle = await respuesta.json().catch(() => ({}));
      if (!permisos && !ruta.startsWith('/auth/')) console.error('Supabase:', respuesta.status, detalle.code ?? '');
      if (ruta.startsWith('/auth/v1/token?') && [400, 401, 403].includes(respuesta.status)) {
        throw new ErrorCampo(401, 'Revisa tus credenciales o vuelve a iniciar sesión.');
      }
      if (permisos) throw new ErrorCampo(respuesta.status, 'Sesión inválida o acceso denegado.');
      if (respuesta.status === 429) throw new ErrorCampo(429, 'Espera antes de volver a intentarlo.');
      if ([400, 404].includes(respuesta.status) && (respuesta.status === 404 || String(detalle.statusCode) === '404')) {
        throw new ErrorCampo(404, 'El archivo o recurso todavía no está disponible.');
      }
      throw new ErrorCampo(502, 'Supabase no pudo completar la solicitud.');
    }
    return respuesta;
  };
}

async function autorizado(supabase) {
  const permitido = await supabase('/rest/v1/rpc/es_integrante_equipo2', { method: 'POST', body: {} });
  if (!(await permitido.json())) throw new ErrorCampo(403, 'Tu cuenta aún no pertenece al Equipo 2.');
}

function privado(supabase, bucket, ruta) {
  return supabase('/storage/v1/object/authenticated/' + bucket + '/' +
    ruta.split('/').map(encodeURIComponent).join('/'));
}

async function precargarAmbientes(supabase, codigo) {
  const respuesta = await supabase('/rest/v1/rpc/equipo2_confirmar_ambientes', {
    method: 'POST',
    body: {
      p_renipress: codigo, p_omitir_existentes: true,
      p_ambientes: areas.map((nombre, indice) => ({
        bloque: 'area-' + String(indice + 1).padStart(2, '0'), nombre
      }))
    }
  });
  await respuesta.json();
}

async function ficha(supabase, codigo) {
  await precargarAmbientes(supabase, codigo);
  const respuesta = await supabase('/rest/v1/rpc/equipo2_ficha', { method: 'POST', body: { p_renipress: codigo } });
  const registros = await respuesta.json();
  const posicion = ({ ambiente }) => ambiente
    ? ordenAmbientes.get(normalizarNombreAmbiente(ambiente).toLowerCase()) ?? areas.length
    : areas.length + 1;
  return registros.sort((a, b) => posicion(a) - posicion(b));
}

export async function atenderCampo(req, res, proveedor = clienteSupabase) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const query = new URL(req.url, 'http://localhost').searchParams;
    const accion = query.get('accion');
    const metodo = { sesion: 'POST', salir: 'POST', equipo: 'GET', ficha: 'GET', guardar: 'POST',
      'confirmar-ambientes': 'POST', organizar: 'POST',
      adjunto: 'POST', imagen: 'GET', excel: 'GET' }[accion];
    if (!metodo) throw new ErrorCampo(404, 'Acción no encontrada.');
    if (req.method !== metodo) throw new ErrorCampo(405, 'Método no permitido.');

    if (accion === 'sesion') {
      const datos = await cuerpo(req);
      const renovar = typeof datos?.refresh_token === 'string';
      const email = correoDeUsuario(datos?.usuario, proveedor === clienteSupabase ? 'equipo2.com' : undefined);
      if (renovar && (!datos.refresh_token || datos.refresh_token.length > 4096)) {
        throw new ErrorCampo(401, 'Vuelve a iniciar sesión.');
      }
      if (!renovar && (!email || typeof datos?.password !== 'string' || datos.password.length > 256)) {
        throw new ErrorCampo(400, 'Completa el usuario y la contraseña.');
      }
      const respuesta = await proveedor()('/auth/v1/token?grant_type=' + (renovar ? 'refresh_token' : 'password'), {
        method: 'POST',
        body: renovar ? { refresh_token: datos.refresh_token } : { email, password: datos.password }
      });
      const { access_token, refresh_token, expires_in, user } = await respuesta.json();
      await autorizado(proveedor(access_token));
      return json(res, 200, { access_token, refresh_token, expires_in, usuario: user.id });
    }

    const token = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
    if (!token) throw new ErrorCampo(401, 'Inicia sesión para continuar.');
    const supabase = proveedor(token);
    await autorizado(supabase);
    if (accion === 'salir') {
      await supabase('/auth/v1/logout?scope=local', { method: 'POST' });
      return json(res, 200, {});
    }
    if (accion === 'equipo') {
      const [personas, avance] = await Promise.all([
        supabase('/rest/v1/equipo2_integrantes?select=usuario,nombre&order=nombre.asc'),
        supabase('/rest/v1/rpc/equipo2_avance', { method: 'POST', body: {} })
      ]);
      return json(res, 200, { personas: await personas.json(), avance: await avance.json() });
    }

    const codigo = query.get('codigo');
    if (!codigos.has(codigo)) throw new ErrorCampo(404, 'Establecimiento no encontrado.');
    if (accion === 'guardar') {
      const body = validarRegistro(codigo, await cuerpo(req));
      const respuesta = await supabase('/rest/v1/rpc/equipo2_guardar', { method: 'POST', body });
      const resultado = await respuesta.json();
      return json(res, resultado.conflicto ? 409 : 200, resultado);
    }
    if (accion === 'confirmar-ambientes' || accion === 'organizar') {
      const confirmar = accion === 'confirmar-ambientes';
      const datos = await cuerpo(req);
      const operacion = confirmar ? 'equipo2_confirmar_ambientes' : 'equipo2_organizar';
      const body = confirmar ? prepararConfirmacion(codigo, datos) : prepararOrganizacion(codigo, datos);
      if (confirmar) await precargarAmbientes(supabase, codigo);
      const respuesta = await supabase('/rest/v1/rpc/' + operacion, { method: 'POST', body });
      const resultado = await respuesta.json();
      return json(res, resultado.conflicto || resultado.duplicado ? 409 : 200, resultado);
    }
    if (accion === 'adjunto') {
      const { imagen } = (await cuerpo(req)) ?? {};
      if (typeof imagen !== 'string' || imagen.length > 500000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(imagen)) {
        throw new ErrorCampo(400, 'Selecciona una imagen JPEG de hasta 375 KB.');
      }
      const bytes = Buffer.from(imagen, 'base64');
      if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) {
        throw new ErrorCampo(400, 'La imagen no tiene formato JPEG.');
      }
      const ruta = codigo + '/' + randomUUID() + '.jpg';
      await supabase('/storage/v1/object/equipo2-adjuntos/' + ruta, { method: 'POST', tipo: 'image/jpeg', body: bytes });
      return json(res, 201, { ruta });
    }
    if (accion === 'imagen') {
      const ruta = query.get('ruta');
      if (!rutaAdjunto(ruta, codigo)) throw new ErrorCampo(400, 'La ruta de la imagen no es válida.');
      const respuesta = await privado(supabase, 'equipo2-adjuntos', ruta);
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      return res.end(Buffer.from(await respuesta.arrayBuffer()));
    }

    if (accion === 'ficha') {
      const [registros, respuestas] = await Promise.all([
        ficha(supabase, codigo),
        privado(supabase, 'equipo2-plantillas', 'referencias.json')
          .then(respuesta => respuesta.json()).catch(error => {
            if (error.status === 404) return null;
            throw error;
          })
      ]);
      return json(res, 200, { registros, referencia: respuestas?.[codigo] ?? null });
    }
    const [registros, referencias] = await Promise.all([
      ficha(supabase, codigo),
      privado(supabase, 'equipo2-plantillas', 'referencias.json').then(respuesta => respuesta.json())
    ]);
    const ruta = referencias[codigo]?.plantilla;
    if (!ruta || !plantilla.test(ruta) || !ruta.includes('_' + codigo + '_')) {
      throw new ErrorCampo(404, 'Carga la ficha original de este establecimiento en el almacenamiento privado.');
    }
    const original = await privado(supabase, 'equipo2-plantillas', ruta);
    const archivo = await generarExcel(await original.arrayBuffer(), registros, async imagen => {
      if (!rutaAdjunto(imagen, codigo)) throw new ErrorCampo(400, 'La ficha contiene una ruta de imagen inválida.');
      return (await privado(supabase, 'equipo2-adjuntos', imagen)).arrayBuffer();
    });
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="' + ruta.split('/').at(-1) + '"'
    });
    return res.end(archivo);
  } catch (error) {
    if (!error.status || error.status >= 500 && !(error instanceof ErrorCampo)) console.error(error);
    return json(res, error.status ?? 500, { error: error.status ? error.message : 'La solicitud no pudo completarse.' });
  }
}

export default function handler(req, res) {
  return atenderCampo(req, res);
}
