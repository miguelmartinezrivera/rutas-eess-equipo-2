import { abrirCampoLocal } from '../lib/campo-local.mjs';

const clave = process.env.EQUIPO2_CLAVE_INICIAL;
if (!clave) throw new Error('Define EQUIPO2_CLAVE_INICIAL para crear las cuentas.');

const campo = await abrirCampoLocal();
try {
  await campo.crearUsuario('frank_ramos', 'Frank Ramos', clave);
  await campo.crearUsuario('miguel_martinez', 'Miguel Martínez', clave);
  await campo.crearUsuario('nelson_barrios', 'Nelson Barrios', clave);
  console.log('Las tres cuentas locales están listas.');
} finally {
  await campo.cerrar();
}
