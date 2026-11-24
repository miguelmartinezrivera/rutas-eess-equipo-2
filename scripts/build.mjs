import { copyFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

const estaticos = ['index.html', 'estilos.css', 'datos.js', 'app.js', 'levantamiento.js', 'campos.js'];
export const publicFiles = [...estaticos, 'ficha-react.js'];

await mkdir('dist', { recursive: true });
await Promise.all([
  ...estaticos.map(file => copyFile(file, `dist/${file}`)),
  build({
    entryPoints: ['ficha-react.jsx'],
    outfile: 'dist/ficha-react.js',
    bundle: true,
    format: 'esm',
    jsx: 'automatic',
    minify: true
  })
]);
