import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const xampp = process.env.XAMPP_HOME || 'C:/xampp';
const base = resolve(xampp, 'mysql');
const datos = resolve('source/.campo-local/mysql-xampp');
const puerto = process.env.MYSQL_PORT || '3310';
const exe = nombre => join(base, 'bin', nombre + '.exe');

async function ejecutar(nombre, argumentos) {
  const proceso = spawn(exe(nombre), argumentos, { stdio: 'inherit', windowsHide: true });
  const [codigo] = await once(proceso, 'exit');
  if (codigo) throw new Error(nombre + ' terminó con código ' + codigo + '.');
}

mkdirSync(datos, { recursive: true });
if (!existsSync(join(datos, 'mysql', 'global_priv.frm'))) {
  await ejecutar('mysql_install_db', ['--datadir=' + datos, '--port=' + puerto]);
}
await ejecutar('mysqld', ['--no-defaults', '--basedir=' + base, '--datadir=' + datos,
  '--bind-address=127.0.0.1', '--port=' + puerto, '--innodb-buffer-pool-size=32M', '--console']);
