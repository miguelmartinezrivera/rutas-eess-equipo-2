import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { areas, definirBloque, esAmbiente, fotosPanel } from '../campos.js';

const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const pkg = 'http://schemas.openxmlformats.org/package/2006/relationships';
const content = 'http://schemas.openxmlformats.org/package/2006/content-types';
const serializador = new XMLSerializer();
const elementos = (node, ns, nombre) => Array.from(node.getElementsByTagNameNS(ns, nombre));

async function leerXml(zip, ruta) {
  const archivo = zip.file(ruta);
  if (!archivo) throw new Error('La plantilla no contiene ' + ruta);
  return new DOMParser().parseFromString(await archivo.async('string'), 'application/xml');
}

function guardarXml(zip, ruta, documento) {
  zip.file(ruta, serializador.serializeToString(documento));
}

function plantillaHoja(doc, textos) {
  const filas = elementos(doc, main, 'row');
  const celdas = new Map(elementos(doc, main, 'c').map(celda => [celda.getAttribute('r'), celda]));
  return {
    filas,
    texto(ref) {
      const celda = celdas.get(ref);
      if (!celda) return '';
      if (celda.getAttribute('t') === 's') {
        const indice = elementos(celda, main, 'v')[0]?.textContent;
        return textos[Number(indice)] ?? '';
      }
      return elementos(celda, main, 't').map(t => t.textContent).join('');
    },
    escribir(ref, valor) {
      const celda = celdas.get(ref);
      if (!celda) throw new Error('La plantilla no contiene la celda ' + ref);
      while (celda.firstChild) celda.removeChild(celda.firstChild);
      if (valor === null) {
        celda.removeAttribute('t');
        return;
      }
      if (typeof valor === 'number') {
        celda.removeAttribute('t');
        const nodo = doc.createElementNS(main, 'v');
        nodo.textContent = String(valor);
        celda.appendChild(nodo);
      } else {
        celda.setAttribute('t', 'inlineStr');
        const inline = doc.createElementNS(main, 'is');
        const texto = doc.createElementNS(main, 't');
        texto.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
        texto.textContent = String(valor);
        inline.appendChild(texto);
        celda.appendChild(inline);
      }
    }
  };
}

function desplazar(ref, cantidad) {
  return ref.replace(/([A-Z]+)(\d+)/g, (_, columna, fila) =>
    columna + (Number(fila) >= 28 ? Number(fila) + cantidad : fila));
}

function insertarAmbientes(doc, cantidad) {
  if (!cantidad) return;
  const filas = elementos(doc, main, 'row');
  const base = filas.find(fila => fila.getAttribute('r') === '26');
  const nota = filas.find(fila => fila.getAttribute('r') === '28');
  if (!base || !nota || elementos(doc, main, 'f').length) {
    throw new Error('La estructura de equipamiento de la plantilla cambió.');
  }
  for (const fila of filas) {
    const numero = Number(fila.getAttribute('r'));
    if (numero < 28) continue;
    fila.setAttribute('r', String(numero + cantidad));
    for (const celda of elementos(fila, main, 'c')) {
      celda.setAttribute('r', desplazar(celda.getAttribute('r'), cantidad));
    }
  }
  for (const etiqueta of ['dimension', 'mergeCell', 'ignoredError', 'selection']) {
    for (const nodo of elementos(doc, main, etiqueta)) {
      for (const atributo of ['ref', 'sqref', 'activeCell']) {
        if (nodo.hasAttribute(atributo)) nodo.setAttribute(atributo, desplazar(nodo.getAttribute(atributo), cantidad));
      }
    }
  }
  for (let i = 0; i < cantidad; i += 1) {
    const fila = base.cloneNode(true);
    fila.setAttribute('r', String(28 + i));
    for (const celda of elementos(fila, main, 'c')) {
      celda.setAttribute('r', celda.getAttribute('r').replace(/\d+$/, String(28 + i)));
      while (celda.firstChild) celda.removeChild(celda.firstChild);
      celda.removeAttribute('t');
    }
    nota.parentNode.insertBefore(fila, nota);
  }
}

function agregarRelacion(doc, id, tipo, destino) {
  const nodo = doc.createElementNS(pkg, 'Relationship');
  nodo.setAttribute('Id', id);
  nodo.setAttribute('Type', rel + '/' + tipo);
  nodo.setAttribute('Target', destino);
  doc.documentElement.appendChild(nodo);
}

function ancla({ desde, hasta }, id) {
  const posicion = ([col, row]) =>
    '<xdr:col>' + col + '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + row +
    '</xdr:row><xdr:rowOff>0</xdr:rowOff>';
  return '<xdr:twoCellAnchor editAs="oneCell"><xdr:from>' + posicion(desde) +
    '</xdr:from><xdr:to>' + posicion(hasta) + '</xdr:to><xdr:pic><xdr:nvPicPr>' +
    '<xdr:cNvPr id="' + id + '" name="Imagen ' + id + '"/><xdr:cNvPicPr/></xdr:nvPicPr>' +
    '<xdr:blipFill><a:blip r:embed="rId' + id + '"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
    '<xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>' +
    '</xdr:pic><xdr:clientData/></xdr:twoCellAnchor>';
}

async function escribirImagenes(zip, doc, imagenes, descargar) {
  if (!imagenes.length) return;
  const relacionesHoja = 'xl/worksheets/_rels/sheet2.xml.rels';
  const relaciones = await leerXml(zip, relacionesHoja);
  agregarRelacion(relaciones, 'rIdEquipo2', 'drawing', '../drawings/equipo2.xml');
  guardarXml(zip, relacionesHoja, relaciones);
  const dibujo = doc.createElementNS(main, 'drawing');
  dibujo.setAttributeNS(rel, 'r:id', 'rIdEquipo2');
  doc.documentElement.appendChild(dibujo);

  const tipos = await leerXml(zip, '[Content_Types].xml');
  const jpg = tipos.createElementNS(content, 'Default');
  jpg.setAttribute('Extension', 'jpeg');
  jpg.setAttribute('ContentType', 'image/jpeg');
  tipos.documentElement.appendChild(jpg);
  const declaracion = tipos.createElementNS(content, 'Override');
  declaracion.setAttribute('PartName', '/xl/drawings/equipo2.xml');
  declaracion.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.drawing+xml');
  tipos.documentElement.appendChild(declaracion);
  guardarXml(zip, '[Content_Types].xml', tipos);

  const relacionesImagenes = new DOMParser().parseFromString('<Relationships xmlns="' + pkg + '"/>', 'application/xml');
  let dibujoXml = '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"' +
    ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="' + rel + '">';
  for (const [i, imagen] of imagenes.entries()) {
    const id = i + 1;
    const nombre = 'campo-' + id + '.jpeg';
    zip.file('xl/media/' + nombre, await descargar(imagen.ruta));
    agregarRelacion(relacionesImagenes, 'rId' + id, 'image', '../media/' + nombre);
    dibujoXml += ancla(imagen, id);
  }
  zip.file('xl/drawings/equipo2.xml', dibujoXml + '</xdr:wsDr>');
  guardarXml(zip, 'xl/drawings/_rels/equipo2.xml.rels', relacionesImagenes);
}

export async function generarExcel(original, registros, descargar) {
  const zip = await JSZip.loadAsync(original);
  const [textosDoc, doc1, doc2] = await Promise.all([
    leerXml(zip, 'xl/sharedStrings.xml'), leerXml(zip, 'xl/worksheets/sheet1.xml'),
    leerXml(zip, 'xl/worksheets/sheet2.xml')
  ]);
  const textos = elementos(textosDoc, main, 'si').map(si => elementos(si, main, 't').map(t => t.textContent).join(''));
  const activos = registros.filter(registro => !registro.retirado);
  const ambientes = activos.filter(registro => esAmbiente(registro.bloque) && registro.ambiente);
  const adicionales = Math.max(0, ambientes.length - areas.length);
  insertarAmbientes(doc1, adicionales);
  const hoja1 = plantillaHoja(doc1, textos);
  const hoja2 = plantillaHoja(doc2, textos);
  const imagenes = [];
  const filasAmbientes = new Map(ambientes.map(({ bloque }, i) => [bloque, 12 + i]));

  for (let i = 0; i < Math.max(areas.length, ambientes.length); i += 1) {
    const fila = 12 + i;
    hoja1.escribir('A' + fila, ambientes[i]?.ambiente ?? null);
    for (const columna of 'BCDEFGH') hoja1.escribir(columna + fila, null);
  }
  hoja1.escribir(desplazar('A28', adicionales), null);

  for (const { bloque, datos } of activos) {
    const definicion = definirBloque(bloque);
    if (!definicion) continue;
    const filaArea = filasAmbientes.get(bloque);
    if (esAmbiente(bloque) && !filaArea) continue;
    if (bloque === 'plano' && datos.plano) imagenes.push({ ruta: datos.plano, desde: [0, 3], hasta: [8, 9] });
    if (bloque === 'fotos') {
      for (const [i, { ambiente, foto, requerida }] of fotosPanel.entries()) {
        const fila = 10 + Math.floor(i / 2) * 9;
        const col = (i % 2) * 6;
        const ruta = datos[foto.id];
        const titulo = datos[ambiente.id] || (ruta && requerida ? foto.etiqueta : '');
        if (titulo) hoja2.escribir((col ? 'G' : 'A') + (fila + 9), titulo);
        if (ruta) imagenes.push({ ruta, desde: [col, fila], hasta: [col ? 8 : 6, fila + 8] });
      }
    }
    for (const { id, celda } of definicion.campos) {
      if (!celda || datos[id] === undefined || datos[id] === null) continue;
      const ref = filaArea ? celda + filaArea : desplazar(celda, adicionales);
      const conservarTexto = (bloque === 'red' && id.startsWith('observaciones')) ||
        (bloque === 'conformidad' && ['observaciones', 'equipo', 'jefe', 'responsable_ti'].includes(id));
      const original = conservarTexto ? hoja1.texto(ref).trim() : '';
      const valor = original ? original + '\n' + datos[id] : datos[id];
      hoja1.escribir(ref, valor);
    }
    if (bloque === 'conformidad' && (datos.inicio || datos.fin)) {
      hoja1.escribir(desplazar('F51', adicionales), (datos.inicio || '___:___') + ' - ' + (datos.fin || '___:___'));
    }
  }
  guardarXml(zip, 'xl/worksheets/sheet1.xml', doc1);
  if (imagenes.length || activos.some(r => r.bloque === 'fotos' && Object.keys(r.datos).length)) {
    await escribirImagenes(zip, doc2, imagenes, descargar);
    guardarXml(zip, 'xl/worksheets/sheet2.xml', doc2);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
