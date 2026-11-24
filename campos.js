const campo = (id, etiqueta, tipo = 'text', celda) => ({ id, etiqueta, tipo, celda });

export const areas = [
  'Enfermeria 1', 'Obstetricia', 'Farmacia', 'Triaje', 'Enfermeria 2', 'Emergencia',
  'Adolescente', 'Desarrollo Infantil', 'Oficina Radiologo', 'Lab. Bioquimica',
  'Rayos X', 'Topico', 'Ampliacion', 'Archivo Historias Admision',
  'Consultorio De La Mujer', 'Consultorio Del Niño'
];

export const camposEquipamiento = [
  campo('pc_actual', 'PC (monitor + CPU) · Actual', 'number', 'B'),
  campo('pc_brecha', 'PC (monitor + CPU) · Brecha', 'number', 'C'),
  campo('laptop', 'Laptop · Actual', 'number', 'D'),
  campo('impresora', 'Impresora · Actual', 'number', 'E'),
  campo('huella', 'Lector de huella dactilar · Actual', 'number', 'F'),
  campo('dnie', 'Lector DNIe · Actual', 'number', 'G'),
  campo('observaciones', 'Observaciones', 'textarea', 'H')
];

function parametros(etiquetas, filaInicial) {
  return etiquetas.flatMap((etiqueta, indice) => {
    const fila = filaInicial + indice;
    return [
      campo('existente_' + fila, etiqueta, 'text', 'B' + fila),
      campo('observaciones_' + fila, 'Observaciones · ' + etiqueta, 'textarea', 'D' + fila)
    ];
  });
}

export const secciones = {
  generales: { nombre: 'Datos generales y logísticos', campos: [
    campo('nombre', 'Establecimiento', 'text', 'B5'),
    campo('categoria', 'Categoría / nivel', 'text', 'F4'),
    campo('his', 'HIS / PAC', 'text', 'H4'),
    campo('diresa', 'Departamento / DIRESA', 'text', 'B6'),
    campo('provincia', 'Provincia', 'text', 'F6'),
    campo('distrito', 'Distrito', 'text', 'H6'),
    campo('red', 'Red', 'text', 'F5'),
    campo('microred', 'Microred', 'text', 'H5'),
    campo('direccion', 'Dirección', 'textarea', 'B7'),
    campo('gps', 'Coordenadas GPS', 'text', 'F7'),
    campo('director', 'Director EESS', 'text', 'B8'),
    campo('ti', 'Responsable de TI', 'text', 'F8'),
    campo('estado', 'Estado del levantamiento', 'text', 'H8')
  ] },
  red: { nombre: 'Validación de infraestructura de red, conectividad e internet', campos: parametros([
    'Cableado estructurado (Cat 6 / Cat 5)', 'Puntos de red operativos',
    'Switches (administrable / no administrable)', 'Acceso a internet / operador / tipo',
    'Ancho de banda (actual / brecha requerida)', 'Medio de transmisión (fibra / satélite / cobre)',
    'Tipo de contrato / segmento de gestión / segundo operador'
  ], 31) },
  electricidad: { nombre: 'Validación de instalaciones eléctricas', campos: parametros([
    'Tablero general (espacio / D.U.)', 'Subtableros (espacio / D.U.)', 'Pozo a tierra',
    'Factibilidad eléctrica (demanda máxima / tensión) y recibos de energía',
    'Alimentadores / subalimentadores (sección del conductor)',
    'Tomacorrientes normales y estabilizados', 'Estabilizador / transformador de aislamiento / UPS'
  ], 40) },
  conformidad: { nombre: 'Observaciones generales y conformidad de visita', campos: [
    campo('observaciones', 'Observaciones de campo', 'textarea', 'A49'),
    campo('fecha', 'Fecha de verificación', 'date', 'B51'),
    campo('inicio', 'Hora de inicio', 'time'),
    campo('fin', 'Hora de fin', 'time'),
    campo('equipo', 'Nombre y DNI', 'text', 'A53'),
    campo('responsable_ti', 'Nombre y DNI del responsable de TI', 'text', 'C53'),
    campo('jefe', 'Nombre y DNI del director o jefe', 'text', 'F53')
  ] },
  plano: { nombre: 'Plano de distribución de red de datos', campos: [
    campo('plano', 'Imagen del plano', 'image')
  ] },
  fotos: { nombre: 'Panel fotográfico', campos: Array.from({ length: 8 }, (_, indice) => [
    campo('ambiente_' + indice, 'Área / ambiente de la foto ' + (indice + 1)),
    campo('foto_' + indice, 'Foto ' + (indice + 1), 'image')
  ]).flat() }
};

export const ordenFicha = ['generales', 'equipamiento', 'red', 'electricidad', 'conformidad', 'plano', 'fotos'];
export const bloquesBase = ordenFicha.filter(clave => clave !== 'equipamiento');

export function esAmbiente(clave) {
  return /^(?:area-(?:0[1-9]|1[0-6])|extra-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.test(clave);
}

export function normalizarNombreAmbiente(nombre) {
  return nombre.trim().replace(/\s+/g, ' ').normalize('NFC');
}

export function definirBloque(clave) {
  if (Object.hasOwn(secciones, clave)) return secciones[clave];
  if (esAmbiente(clave)) {
    return { nombre: areas[Number(clave.slice(5)) - 1] || 'Equipamiento informático', campos: camposEquipamiento };
  }
  return null;
}
