import { DatabaseSync } from 'node:sqlite';
import { definirBloque, esAmbiente } from '../campos.js';
import { abrirCampoLocal } from '../lib/campo-local.mjs';

const sqlite = new DatabaseSync('source/.campo-local/equipo.sqlite', { readOnly: true });
let integrantes;
let registros;
try {
  integrantes = sqlite.prepare('SELECT usuario, correo, nombre, sal, clave FROM integrantes').all();
  registros = sqlite.prepare('SELECT * FROM registros ORDER BY creado_en, rowid').all().map(fila => {
    if (Object.hasOwn(fila, 'ambiente')) return fila;
    const datos = JSON.parse(fila.datos);
    const ambiente = esAmbiente(fila.bloque) ? datos.nombre || definirBloque(fila.bloque).nombre : null;
    if (ambiente) delete datos.nombre;
    const conDatos = Object.keys(datos).length > 0;
    return {
      ...fila, datos: JSON.stringify(datos), ambiente, retirado: 0,
      asignado_a: fila.responsable !== fila.actualizado_por ? fila.responsable : null,
      registrado_por: conDatos ? fila.creado_por : null, registrado_en: conDatos ? fila.creado_en : null
    };
  });
} finally {
  sqlite.close();
}
const mysql = await abrirCampoLocal();
try {
  await mysql.importar(integrantes, registros);
  console.log(`Migración verificada en ${mysql.base}: ${integrantes.length} cuentas y ${registros.length} registros de origen.`);
} finally {
  await mysql.cerrar();
}
