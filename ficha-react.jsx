import { useState } from 'react';
import { createRoot } from 'react-dom/client';

const numerales = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

const trazos = {
  Editar: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L9 17l-4 1 1-4L16.5 3.5ZM15 5l4 4',
  Asignar: 'M12 20H4v-1a4 4 0 0 1 4-4h4M16 17h6m-3-3v6M14 8a4 4 0 1 1-8 0a4 4 0 0 1 8 0Z',
  Quitar: 'M3 6h18M9 6V4h6v2m4 0-1 14H6L5 6m5 4v6m4-6v6'
};

function AccionIcono({ accion, nombre, alPulsar }) {
  return (
    <button type="button" className={accion === 'Quitar' ? 'accion-icono quitar-ambiente' : 'accion-icono secundario'}
      aria-label={accion + ' ' + nombre} title={accion} onClick={alPulsar}>
      <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.7"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d={trazos[accion]} />
      </svg>
    </button>
  );
}

function BloqueFicha({ bloque, mostrarNombre }) {
  const { equipamiento } = bloque;
  const iniciado = equipamiento ? equipamiento.llenados > 0 : bloque.registrado;
  const faltan = equipamiento && equipamiento.total - equipamiento.llenados;
  return (
    <div className="bloque-ficha" data-registrado={iniciado} data-ambiente={Boolean(equipamiento)}>
      <div className="bloque-ficha-datos">
        {mostrarNombre && <h4>{bloque.nombre}</h4>}
        <p>{bloque.asignado ? 'Asignado a ' + bloque.asignado : 'Sin asignar'}</p>
        {bloque.auditoria && <small>{bloque.auditoria}</small>}
        {equipamiento && <span className="estado-ficha" data-registrado={iniciado}>
          {equipamiento.llenados} de {equipamiento.total} campos llenados
          {faltan > 0 && (faltan === 1 ? ' · Falta 1' : ' · Faltan ' + faltan)}
        </span>}
      </div>
      <div className="controles-campo acciones-bloque">
        {bloque.ver ? <>
          <button type="button" className="secundario" onClick={bloque.ver}>Ver registro</button>
          <AccionIcono accion="Editar" nombre={bloque.nombre} alPulsar={bloque.editar} />
        </> : <button type="button" className="primario" onClick={bloque.editar}>Registrar</button>}
        <AccionIcono accion="Asignar" nombre={bloque.nombre} alPulsar={bloque.asignar} />
        {bloque.quitar && <AccionIcono accion="Quitar" nombre={bloque.nombre} alPulsar={bloque.quitar} />}
      </div>
      {equipamiento && <div className="observaciones-ambiente">
        {equipamiento.observaciones ? <details>
          <summary>Ver observaciones</summary>
          <p>{equipamiento.observaciones}</p>
        </details> : <p>Sin observaciones</p>}
      </div>}
    </div>
  );
}

function SeccionFicha({ seccion, indice, abierta, alternar, agregarAmbiente, soloPendientes }) {
  const { clave, nombre, bloques } = seccion;
  const equipamiento = clave === 'equipamiento';
  const completos = bloques.filter(bloque => bloque.completo).length;
  const completa = bloques.length > 0 && completos === bloques.length;
  if (soloPendientes && completa) return null;
  const visibles = soloPendientes ? bloques.filter(bloque => !bloque.completo) : bloques;
  const cabecera = 'cabecera-ficha-' + clave;
  const contenido = 'panel-ficha-' + clave;
  return (
    <section className="seccion-ficha" data-registrado={completa}>
      <h3>
        <button type="button" className="cabecera-ficha" id={cabecera} aria-expanded={abierta} aria-controls={contenido} onClick={alternar}>
          <span className="numero-ficha">{numerales[indice]}</span>
          <span className="nombre-ficha">{nombre}</span>
          <span className="estado-ficha" data-registrado={completa}>
            {equipamiento ? bloques.length + ' confirmados · ' + completos + ' completos' : completa ? 'Registrado' : 'Pendiente'}
          </span>
          <span className="flecha-ficha" aria-hidden="true" />
        </button>
      </h3>
      <div className="panel-ficha" id={contenido} role="region" aria-labelledby={cabecera} hidden={!abierta}>
        {abierta && <>
          {equipamiento && <button type="button" className="secundario agregar-ambiente" onClick={agregarAmbiente}>Agregar ambiente</button>}
          {equipamiento && !bloques.length && <p className="contexto-ficha">Aún no hay ambientes confirmados para este establecimiento.</p>}
          {visibles.map(bloque => <BloqueFicha key={bloque.clave} bloque={bloque} mostrarNombre={equipamiento} />)}
        </>}
      </div>
    </section>
  );
}

function Ficha({ secciones, inicial, alCambiar, agregarAmbiente, filtroInicial, alFiltrar }) {
  const [abierta, setAbierta] = useState(inicial);
  const [soloPendientes, setSoloPendientes] = useState(filtroInicial);
  const bloques = secciones.flatMap(seccion => seccion.bloques);
  const registrados = bloques.filter(bloque => bloque.registrado).length;
  const todoRegistrado = secciones.every(seccion =>
    seccion.bloques.length && seccion.bloques.every(bloque => bloque.completo));

  function alternar(clave) {
    const siguiente = abierta === clave ? null : clave;
    setAbierta(siguiente);
    alCambiar(siguiente);
  }

  return (
    <>
      <div className="progreso-ficha">
        <label htmlFor="progreso-levantamiento">Avance del levantamiento</label>
        <span>{registrados} de {bloques.length} bloques registrados</span>
        <progress id="progreso-levantamiento" value={registrados} max={bloques.length} />
      </div>
      <label className="filtro-pendientes">
        <input type="checkbox" checked={soloPendientes} onChange={evento => {
          const activo = evento.target.checked;
          setSoloPendientes(activo);
          alFiltrar(activo);
        }} />
        Solo pendientes
      </label>
      {soloPendientes && todoRegistrado && <p className="contexto-ficha">No quedan bloques pendientes en esta ficha.</p>}
      <div className="secciones-ficha">
        {secciones.map((seccion, indice) => (
          <SeccionFicha key={seccion.clave} seccion={seccion} indice={indice}
            abierta={abierta === seccion.clave} alternar={() => alternar(seccion.clave)}
            agregarAmbiente={agregarAmbiente} soloPendientes={soloPendientes} />
        ))}
      </div>
    </>
  );
}

export function montarFicha(contenedor, props) {
  const raiz = createRoot(contenedor);
  raiz.render(<Ficha {...props} />);
  return () => raiz.unmount();
}
