import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import mysql from 'mysql2/promise';
import { correoDeUsuario } from './acceso.mjs';
import { esAmbiente, normalizarNombreAmbiente } from '../campos.js';

const sesionSegundos = 8 * 60 * 60;
const hash = valor => createHash('sha256').update(valor).digest('hex');
const derivar = (clave, sal) => scryptSync(clave, sal, 32);
const error = (status, message) => Object.assign(new Error(message), { status });
const ahora = () => new Date().toISOString();
const normalizar = nombre => normalizarNombreAmbiente(nombre).toLowerCase();
const registroJson = fila => fila ? { ...fila, datos: JSON.parse(fila.datos) } : null;

const tablas = [
  `CREATE TABLE IF NOT EXISTS integrantes (
    usuario CHAR(36) PRIMARY KEY, correo VARCHAR(191) NOT NULL UNIQUE, nombre VARCHAR(191) NOT NULL,
    sal CHAR(32) NOT NULL, clave VARBINARY(32) NOT NULL
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS sesiones (
    token CHAR(64) PRIMARY KEY, renovacion CHAR(64) NOT NULL UNIQUE, usuario CHAR(36) NOT NULL,
    vence BIGINT NOT NULL, FOREIGN KEY (usuario) REFERENCES integrantes(usuario)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS registros (
    renipress CHAR(8) NOT NULL, bloque VARCHAR(48) NOT NULL, datos LONGTEXT NOT NULL,
    responsable CHAR(36) NOT NULL, creado_por CHAR(36) NOT NULL, creado_en VARCHAR(30) NOT NULL,
    actualizado_por CHAR(36) NOT NULL, actualizado_en VARCHAR(30) NOT NULL,
    version INT NOT NULL DEFAULT 1, ambiente VARCHAR(120), retirado TINYINT NOT NULL DEFAULT 0,
    asignado_a CHAR(36), registrado_por CHAR(36), registrado_en VARCHAR(30),
    orden BIGINT NOT NULL AUTO_INCREMENT UNIQUE,
    PRIMARY KEY (renipress, bloque), CHECK (JSON_VALID(datos)),
    FOREIGN KEY (responsable) REFERENCES integrantes(usuario),
    FOREIGN KEY (creado_por) REFERENCES integrantes(usuario),
    FOREIGN KEY (actualizado_por) REFERENCES integrantes(usuario),
    FOREIGN KEY (asignado_a) REFERENCES integrantes(usuario),
    FOREIGN KEY (registrado_por) REFERENCES integrantes(usuario)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS inventarios (
    renipress CHAR(8) PRIMARY KEY, precargado TINYINT NOT NULL DEFAULT 0
  ) ENGINE=InnoDB`
];

export async function abrirCampoLocal() {
  const database = process.env.MYSQL_DATABASE || 'eess_equipo2';
  if (!/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(database)) throw new Error('MYSQL_DATABASE no es un nombre válido.');
  const config = {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    charset: 'utf8mb4_unicode_ci',
    connectTimeout: 5000
  };
  const db = mysql.createPool({ ...config, database, connectionLimit: 6 });
  try {
    try {
      await db.query('SELECT 1');
    } catch (causa) {
      if (causa.code !== 'ER_BAD_DB_ERROR') throw causa;
      const inicio = await mysql.createConnection(config);
      try {
        await inicio.query('CREATE DATABASE IF NOT EXISTS ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci', [database]);
      } finally {
        await inicio.end();
      }
    }
    for (const sql of tablas) await db.query(sql);
    const [columnas] = await db.query("SHOW COLUMNS FROM inventarios LIKE 'precargado'");
    if (!columnas.length) {
      try {
        await db.query('ALTER TABLE inventarios ADD COLUMN precargado TINYINT NOT NULL DEFAULT 0');
      } catch (causa) {
        if (causa.code !== 'ER_DUP_FIELDNAME') throw causa;
      }
    }
  } catch (causa) {
    await db.end();
    const mensaje = causa.code === 'ECONNREFUSED' ? 'Inicia MySQL en XAMPP y revisa MYSQL_PORT.' :
      'Revisa los datos de conexión y los permisos de MySQL (' + (causa.code || 'conexión') + ').';
    throw new Error(mensaje);
  }

  const consultar = async (conexion, sql, args = []) => (await conexion.execute(sql, args))[0];
  const primero = async (conexion, sql, args = []) => (await consultar(conexion, sql, args))[0];

  async function transaccion(operacion) {
    const conexion = await db.getConnection();
    try {
      await conexion.beginTransaction();
      const resultado = await operacion(conexion);
      await conexion.commit();
      return resultado;
    } catch (causa) {
      await conexion.rollback();
      throw causa;
    } finally {
      conexion.release();
    }
  }

  async function emitirSesion(conexion, usuario) {
    const access_token = randomBytes(32).toString('base64url');
    const refresh_token = randomBytes(32).toString('base64url');
    await consultar(conexion, 'INSERT INTO sesiones VALUES (?, ?, ?, ?)', [
      hash(access_token), hash(refresh_token), usuario, Date.now() + sesionSegundos * 1000
    ]);
    return { user: { id: usuario }, access_token, refresh_token, expires_in: sesionSegundos };
  }

  async function iniciar(body) {
    const usuario = await primero(db, 'SELECT * FROM integrantes WHERE correo = ?', [body.email]);
    const clave = derivar(body.password, usuario?.sal ?? 'equipo2');
    if (!usuario || !timingSafeEqual(clave, usuario.clave)) throw error(401, 'Usuario o contraseña incorrectos.');
    await consultar(db, 'DELETE FROM sesiones WHERE vence <= ?', [Date.now()]);
    return emitirSesion(db, usuario.usuario);
  }

  function renovar(token) {
    return transaccion(async conexion => {
      const clave = hash(token);
      const sesion = await primero(conexion, 'SELECT usuario FROM sesiones WHERE renovacion = ? AND vence > ? FOR UPDATE',
        [clave, Date.now()]);
      if (!sesion) throw error(401, 'Vuelve a iniciar sesión.');
      await consultar(conexion, 'DELETE FROM sesiones WHERE renovacion = ?', [clave]);
      return emitirSesion(conexion, sesion.usuario);
    });
  }

  async function insertar(conexion, codigo, bloque, usuario, {
    datos = '{}', ambiente = null, asignado = null, registrado = false
  } = {}) {
    const instante = ahora();
    try {
      await consultar(conexion, `
        INSERT INTO registros (renipress, bloque, datos, responsable, creado_por, creado_en, actualizado_por, actualizado_en,
          ambiente, asignado_a, registrado_por, registrado_en)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [codigo, bloque, datos, usuario, usuario, instante, usuario, instante, ambiente, asignado,
        registrado ? usuario : null, registrado ? instante : null]);
      return true;
    } catch (causa) {
      if (causa.code !== 'ER_DUP_ENTRY') throw causa;
      return false;
    }
  }

  async function cambiar(body, usuario, organizacion) {
    const { p_renipress: codigo, p_bloque: bloque, p_datos, p_version, p_asignado, p_retirar } = body;
    return transaccion(async conexion => {
      let aplicado = false;
      if (organizacion && p_asignado && !(await primero(conexion, 'SELECT usuario FROM integrantes WHERE usuario = ?', [p_asignado]))) {
        throw error(400, 'Selecciona un integrante del Equipo 2.');
      }
      if (p_version === 0) {
        if (!esAmbiente(bloque)) {
          aplicado = await insertar(conexion, codigo, bloque, usuario, organizacion ? { asignado: p_asignado } : {
            datos: JSON.stringify(p_datos), registrado: Object.keys(p_datos).length > 0
          });
        }
      } else {
        const filtro = ' WHERE renipress = ? AND bloque = ? AND version = ? AND retirado = 0';
        const instante = ahora();
        const conDatos = !organizacion && Object.keys(p_datos).length > 0;
        const cambios = organizacion
          ? ['asignado_a = ?, retirado = ?', [p_asignado, Number(p_retirar)]]
          : [`datos = ?, responsable = ?, actualizado_por = ?, actualizado_en = ?,
            registrado_por = coalesce(registrado_por, ?), registrado_en = coalesce(registrado_en, ?)`,
            [JSON.stringify(p_datos), usuario, usuario, instante, conDatos ? usuario : null, conDatos ? instante : null]];
        const actualizacion = await consultar(conexion, 'UPDATE registros SET ' + cambios[0] + ', version = version + 1' + filtro,
          [...cambios[1], codigo, bloque, p_version]);
        aplicado = actualizacion.affectedRows > 0;
      }
      const registro = registroJson(await primero(conexion,
        'SELECT * FROM registros WHERE renipress = ? AND bloque = ? FOR UPDATE', [codigo, bloque]));
      return aplicado ? { registro } : { conflicto: true, registro };
    });
  }

  function confirmarAmbientes({ p_renipress: codigo, p_ambientes, p_omitir_existentes }, usuario) {
    return transaccion(async conexion => {
      // El bloqueo de InnoDB se toma por sede, incluso si aún no tiene ambientes.
      if (p_omitir_existentes && (await primero(conexion, 'SELECT precargado FROM inventarios WHERE renipress = ?', [codigo]))?.precargado) {
        return { agregados: 0 };
      }
      await consultar(conexion, `INSERT INTO inventarios (renipress) VALUES (?)
        ON DUPLICATE KEY UPDATE renipress = renipress`, [codigo]);
      const inventario = await primero(conexion, 'SELECT precargado FROM inventarios WHERE renipress = ? FOR UPDATE', [codigo]);
      if (p_omitir_existentes && inventario.precargado) return { agregados: 0 };
      const existentes = await consultar(conexion, `SELECT ambiente FROM registros
        WHERE renipress = ? AND ambiente IS NOT NULL AND (? OR retirado = 0) FOR UPDATE`, [codigo, p_omitir_existentes]);
      const nombres = new Set(existentes.map(fila => normalizar(fila.ambiente)));
      let agregados = 0;
      for (const { bloque, nombre } of p_ambientes) {
        const clave = normalizar(nombre);
        if (nombres.has(clave)) {
          if (!p_omitir_existentes) return { duplicado: true };
          continue;
        }
        if (await insertar(conexion, codigo, bloque, usuario, { ambiente: nombre })) {
          nombres.add(clave);
          agregados += 1;
          if (!p_omitir_existentes) {
            const fila = await primero(conexion, 'SELECT * FROM registros WHERE renipress = ? AND bloque = ?', [codigo, bloque]);
            return { agregados, registro: registroJson(fila) };
          }
        }
      }
      if (p_omitir_existentes) await consultar(conexion, 'UPDATE inventarios SET precargado = 1 WHERE renipress = ?', [codigo]);
      return { agregados };
    });
  }

  function archivoAdjunto(clave) {
    if (!/^\d{8}\/[0-9a-f-]{36}\.jpg$/.test(clave)) throw error(404, 'La imagen local no existe.');
    return join('source/.campo-local/adjuntos', clave);
  }

  async function almacenamiento(path, body) {
    const lectura = /^\/storage\/v1\/object\/authenticated\/([^/]+)\/(.+)$/.exec(path);
    if (lectura) {
      const [, bucket, enc] = lectura;
      const clave = decodeURIComponent(enc);
      let archivo;
      if (bucket === 'equipo2-adjuntos') archivo = archivoAdjunto(clave);
      if (bucket === 'equipo2-plantillas') {
        if (clave === 'referencias.json') archivo = 'source/referencias.json';
        else if (/^[A-Za-z0-9_]+\/Dia_\d{2}\/\d{2}_\d{8}_[A-Z0-9_]+\.xlsx$/.test(clave)) {
          archivo = join('source/Fichas_Validacion_Equipo_2', clave);
        }
      }
      if (archivo) {
        try {
          return new Response(await readFile(archivo));
        } catch (causa) {
          if (causa.code !== 'ENOENT') throw causa;
        }
      }
    }
    const carga = /^\/storage\/v1\/object\/equipo2-adjuntos\/(.+)$/.exec(path);
    if (carga) {
      const destino = archivoAdjunto(carga[1]);
      await mkdir(dirname(destino), { recursive: true });
      await writeFile(destino, body, { flag: 'wx' });
      return Response.json({});
    }
    throw error(404, 'El archivo local todavía no está disponible.');
  }

  return {
    base: database,
    cerrar: () => db.end(),
    async crearUsuario(usuario, nombre, clave) {
      const correo = correoDeUsuario(usuario);
      if (!correo || clave.length < 6 || clave.length > 256) throw new Error('Usuario o contraseña inválidos.');
      const sal = randomBytes(16).toString('hex');
      await transaccion(async conexion => {
        await consultar(conexion, `
          INSERT INTO integrantes VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), sal = VALUES(sal), clave = VALUES(clave)
        `, [randomUUID(), correo, nombre, sal, derivar(clave, sal)]);
        await consultar(conexion, 'DELETE FROM sesiones WHERE usuario = (SELECT usuario FROM integrantes WHERE correo = ?)',
          [correo]);
      });
    },
    importar(integrantes, registros) {
      return transaccion(async conexion => {
        for (const fila of integrantes) {
          const existente = await primero(conexion, 'SELECT usuario FROM integrantes WHERE correo = ?', [fila.correo]);
          if (existente && existente.usuario !== fila.usuario) throw new Error('Una cuenta de MySQL ya usa un identificador distinto.');
          await consultar(conexion, `
            INSERT INTO integrantes VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE usuario = usuario
          `, [fila.usuario, fila.correo, fila.nombre, fila.sal, Buffer.from(fila.clave)]);
        }
        for (const r of registros) {
          await consultar(conexion, `
            INSERT INTO registros (renipress, bloque, datos, responsable, creado_por, creado_en, actualizado_por, actualizado_en,
              version, ambiente, retirado, asignado_a, registrado_por, registrado_en)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE renipress = renipress
          `, [r.renipress, r.bloque, r.datos, r.responsable, r.creado_por, r.creado_en, r.actualizado_por, r.actualizado_en,
            r.version, r.ambiente, r.retirado, r.asignado_a, r.registrado_por, r.registrado_en]);
        }
      });
    },
    cliente(token) {
      return async (ruta, { body } = {}) => {
        const path = new URL(ruta, 'http://localhost');
        if (path.pathname === '/auth/v1/token') {
          const renovarSesion = path.searchParams.get('grant_type') === 'refresh_token';
          return Response.json(await (renovarSesion ? renovar(body.refresh_token) : iniciar(body)));
        }
        const sesion = token && await primero(db, 'SELECT usuario FROM sesiones WHERE token = ? AND vence > ?',
          [hash(token), Date.now()]);
        if (!sesion) throw error(401, 'Vuelve a iniciar sesión.');
        const { usuario } = sesion;
        switch (path.pathname) {
          case '/auth/v1/logout':
            await consultar(db, 'DELETE FROM sesiones WHERE token = ?', [hash(token)]);
            return Response.json({});
          case '/rest/v1/rpc/es_integrante_equipo2':
            return Response.json(true);
          case '/rest/v1/equipo2_integrantes':
            return Response.json(await consultar(db, 'SELECT usuario, nombre FROM integrantes ORDER BY nombre'));
          case '/rest/v1/rpc/equipo2_avance': {
            const filas = await consultar(db, `SELECT renipress,
              sum(retirado = 0 AND datos <> '{}') AS registrados,
              sum(retirado = 0 AND ambiente IS NOT NULL) AS ambientes FROM registros GROUP BY renipress`);
            return Response.json(Object.fromEntries(filas.map(({ renipress, registrados, ambientes }) =>
              [renipress, { registrados: Number(registrados), ambientes: Number(ambientes) }])));
          }
          case '/rest/v1/rpc/equipo2_ficha':
            return Response.json((await consultar(db, `SELECT * FROM registros WHERE renipress = ? AND retirado = 0
              ORDER BY creado_en, orden`, [body.p_renipress])).map(registroJson));
          case '/rest/v1/rpc/equipo2_guardar':
            return Response.json(await cambiar(body, usuario, false));
          case '/rest/v1/rpc/equipo2_confirmar_ambientes':
            return Response.json(await confirmarAmbientes(body, usuario));
          case '/rest/v1/rpc/equipo2_organizar':
            return Response.json(await cambiar(body, usuario, true));
          default:
            return almacenamiento(path.pathname, body);
        }
      };
    }
  };
}
