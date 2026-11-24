# Rutas del Equipo 2

La web muestra 25 establecimientos en 15 días. Los filtros de provincia y día, «Ver detalle» y «Cómo llegar» se pueden usar sin iniciar sesión. El acceso de los integrantes habilita la captura, el avance, las imágenes privadas y la descarga de las fichas.

La ficha organiza sus siete secciones en el mismo orden que el Excel. En **II. Validación de equipamiento informático**, cada sede parte con los 16 ambientes de la plantilla. Puedes quitar los que no existan y agregar otros con su nombre real. Al agregar un ambiente, se abre su formulario con los mismos campos de equipamiento. El Excel incluye los ambientes que siguen en la ficha.

## Ejecutar en la PC

Con Node.js 22.13 o superior, ejecuta desde la raíz del repositorio:

```powershell
npm.cmd ci
npm.cmd run mysql:xampp
```

El comando usa MariaDB de XAMPP en el puerto 3310 y guarda su instancia en `source/.campo-local/mysql-xampp/`. Si XAMPP está en otra ubicación, define `XAMPP_HOME`. En `.env.local` configura `MYSQL_PORT=3310`; para usar una instancia de XAMPP que ya esté activa, indica su puerto y, si hace falta, `MYSQL_HOST`, `MYSQL_USER` y `MYSQL_PASSWORD`. La base del proyecto se llama `eess_equipo2` por defecto.

Con MySQL abierto, ejecuta en otra terminal:

```powershell
npm.cmd run dev
```

Abre `http://127.0.0.1:3000`. Los adjuntos locales se guardan en `source/.campo-local/adjuntos`. Si tienes una instalación anterior con SQLite, detén el servidor anterior y ejecuta `npm.cmd run migrar:mysql` con MySQL iniciado. La migración conserva las cuentas, sus claves y los registros existentes. Luego vuelve a iniciar sesión.

Si es una instalación nueva, crea los tres usuarios con el siguiente comando. Define primero `EQUIPO2_CLAVE_INICIAL` con la clave inicial en tu terminal. Repetir el comando cambia la clave e invalida las sesiones locales de esas cuentas.

```powershell
node --env-file-if-exists=.env.local scripts/crear-usuarios-locales.mjs
Remove-Item Env:EQUIPO2_CLAVE_INICIAL
```

Para compartir los levantamientos entre dispositivos, configura Supabase y crea `.env.local` con estos valores:

```dotenv
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Reinicia `npm run dev` al cambiar las variables. La web usa la llave publicable de Supabase y el token de cada integrante. Las claves administrativas quedan en Supabase.

### Abrirlo desde un celular

Conecta la PC y el celular a la misma red privada. En PowerShell, detén el servidor anterior con `Ctrl+C` y arráncalo así:

```powershell
$env:PORT = "3100"
$env:EESS_LAN = "1"
npm.cmd run dev
```

En el navegador del celular, abre la URL que la terminal muestra para **Wi-Fi**. Si la PC se conecta por cable al mismo router, usa la URL de **Ethernet**. Si Windows solicita permiso para Node.js, permite el acceso en redes privadas. Mantén el servidor abierto mientras uses el sistema.

Para volver al modo de solo PC, detén el servidor, ejecuta `Remove-Item Env:EESS_LAN` y vuelve a iniciarlo.

## Preparar Supabase

1. En un proyecto Supabase nuevo, ejecuta [supabase/schema.sql](supabase/schema.sql) y luego [supabase/inventario.sql](supabase/inventario.sql) desde **SQL Editor**. Si el esquema base ya está instalado, aplica solo `inventario.sql` una vez.
2. En **Authentication → Users**, crea y confirma las cuentas `frank_ramos@equipo2.com`, `miguel_martinez@equipo2.com` y `nelson_barrios@equipo2.com`. La pantalla de ingreso usa solo la parte anterior a `@`. Asigna una contraseña distinta y robusta para cada cuenta publicada. Deshabilita el alta abierta si el proyecto está dedicado al equipo.
3. Copia el UUID de cada cuenta y asígnale el nombre que se verá en el avance. Ejecuta en **SQL Editor**, reemplazando los valores:

   ```sql
   insert into public.equipo2_integrantes (usuario, nombre) values
     ('UUID_PRIMER_INTEGRANTE', 'Nombre del primer integrante'),
     ('UUID_SEGUNDO_INTEGRANTE', 'Nombre del segundo integrante'),
     ('UUID_TERCER_INTEGRANTE', 'Nombre del tercer integrante');
   ```

4. Genera el índice privado con Python 3:

   ```powershell
   python scripts/preparar_referencias.py
   ```

5. En **Storage**, carga `source/referencias.json` en la raíz del bucket privado **equipo2-plantillas**. Carga allí el contenido de `source/Fichas_Validacion_Equipo_2`, manteniendo el árbol `Provincia/Dia_XX/archivo.xlsx`. Por ejemplo, la clave del primer archivo es `Sanchez_Carrion/Dia_01/01_00005349_HOSPITAL_DE_APOYO_LEONCIO_PRADO.xlsx`. El bucket **equipo2-adjuntos** se llena al capturar planos o fotografías.

El índice toma los antecedentes de `CRUCE` en `source/BRECHAS TICS ZONA SIERRA_UPDATE - EQUIPO 2.xlsx`, los vincula por RENIPRESS y conserva los grupos administrativos y asistenciales. La programación proviene de `Cronograma 15 días` y ya está en `datos.js`. La exportación conserva el nombre de la ficha y su provincia y día de origen en el almacenamiento.

La migración desde SQLite recupera los ambientes que ya se habían guardado. Los nombres de la plantilla que solo se mostraban como ejemplo quedan disponibles como sugerencias. El autor de la captura se toma de la sesión y se guarda por separado de la asignación.

## Comprobar el flujo

- Desde la ruta, cambia provincia y día, abre «Ver detalle» y revisa el destino de «Cómo llegar».
- Abre dos perfiles de navegador con cuentas distintas y entra a la misma ficha. Registra Farmacia con una cuenta y Red con la otra. Verifica que cada guardado modifica su propio bloque y que el responsable coincide con la cuenta activa.
- Abre el mismo ambiente en ambos perfiles. Después de que uno guarde, el segundo debe ver la versión guardada y decidir si abre esa versión o confirma una nueva edición. Revisa el autor inicial y el último editor en «Ver registro».
- Agrega ambientes distintos en dos fichas y genera un Excel de cada sede. Revisa que se exporten sus nombres confirmados, que un ambiente retirado quede fuera y que el cero confirmado siga siendo distinto de una celda vacía.

## Vercel

Importa el repositorio con el preset **Other**. `vercel.json` compila los archivos públicos a `dist/` y Vercel sirve `api/campo.js` como función. Configura las mismas dos variables de Supabase en el entorno elegido. `source/` y `.env.local` quedan fuera de Git, de las subidas con Vercel CLI y de la salida pública.

La página de rutas incluye los nombres de responsables que ya mostraba la web. Si la página completa debe limitarse al equipo, protege también el acceso al sitio en Vercel.
