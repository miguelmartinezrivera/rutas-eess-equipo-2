import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { publicFiles } from './build.mjs';
import { atenderCampo } from '../api/campo.js';

const usarSupabase = process.env.SUPABASE_URL || process.env.SUPABASE_PUBLISHABLE_KEY;
const local = usarSupabase ? null : await (await import('../lib/campo-local.mjs')).abrirCampoLocal();

const tipos = { html: 'text/html', css: 'text/css', js: 'text/javascript' };
const puerto = Number(process.env.PORT || 3000);
const accesoRedLocal = process.env.EESS_LAN === '1';
const servidor = createServer(async (req, res) => {
  const ruta = new URL(req.url, 'http://localhost').pathname;
  if (ruta === '/api/campo') return atenderCampo(req, res, local?.cliente);
  const archivo = ruta === '/' ? 'index.html' : ruta.slice(1);
  if (!publicFiles.includes(archivo)) {
    res.writeHead(404);
    return res.end('Página no encontrada');
  }
  const contenido = await readFile('dist/' + archivo);
  res.writeHead(200, { 'Content-Type': tipos[archivo.split('.').at(-1)] + '; charset=utf-8' });
  res.end(contenido);
});

servidor.listen(puerto, accesoRedLocal ? '0.0.0.0' : '127.0.0.1', () => {
  const activo = servidor.address().port;
  if (local) console.log('MySQL local: ' + local.base);
  console.log('En esta PC: http://127.0.0.1:' + activo);
  if (!accesoRedLocal) return;
  for (const [nombre, interfaces] of Object.entries(networkInterfaces())) {
    for (const interfaz of interfaces ?? []) {
      if (!interfaz.internal && interfaz.family === 'IPv4') {
        console.log('En el celular (' + nombre + '): http://' + interfaz.address + ':' + activo);
      }
    }
  }
});
