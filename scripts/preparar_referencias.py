"""Prepara el índice privado de las fichas y los antecedentes del Equipo 2."""
import argparse
from decimal import Decimal, InvalidOperation
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
from zipfile import ZipFile

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
LIBRO_EQUIPO = Path("source/BRECHAS TICS ZONA SIERRA_UPDATE - EQUIPO 2.xlsx")
EQUIPOS_ASISTENCIALES = {
    "pc": ("AY", "CU", "PC (CPU + MONITOR)"),
    "laptop": ("AZ", "CV", "LAPTOP"),
    "impresora": ("BA", "CW", "IMPRESORAS"),
    "dnie": ("BB", "CX", "LECTOR DE DNIE"),
}


def numero_columna(letras):
    numero = 0
    for letra in letras:
        numero = numero * 26 + ord(letra) - ord("A") + 1
    return numero


def hoja(archivo, nombre, expandir_cabeceras=False):
    with ZipFile(archivo) as libro:
        def xml(ruta):
            return ET.fromstring(libro.read(ruta))

        hojas = xml("xl/workbook.xml").findall("m:sheets/m:sheet", NS)
        ficha = next(h for h in hojas if h.get("name") == nombre)
        relaciones = xml("xl/_rels/workbook.xml.rels")
        destino = next(r.get("Target") for r in relaciones if r.get("Id") == ficha.get(REL + "id"))
        destino = destino.lstrip("/") if destino.startswith("/") else "xl/" + destino
        textos = []
        if "xl/sharedStrings.xml" in libro.namelist():
            textos = [
                "".join(t.text or "" for t in si.findall(".//m:t", NS))
                for si in xml("xl/sharedStrings.xml").findall("m:si", NS)
            ]
        celdas = {}
        documento = xml(destino)
        for celda in documento.findall(".//m:c", NS):
            valor = celda.findtext("m:v", namespaces=NS)
            tipo = celda.get("t")
            if tipo == "s":
                valor = textos[int(valor)]
            elif tipo == "inlineStr":
                valor = "".join(t.text or "" for t in celda.findall(".//m:t", NS))
            if valor is not None and valor.strip():
                celdas[celda.get("r")] = valor
        if expandir_cabeceras:
            columnas = [celda[:-1] for celda in celdas if re.fullmatch(r"[A-Z]+2", celda)]
            for combinacion in documento.findall("m:mergeCells/m:mergeCell", NS):
                rango = re.fullmatch(r"([A-Z]+)1:([A-Z]+)1", combinacion.get("ref", ""))
                if not rango or rango[1] + "1" not in celdas:
                    continue
                inicio, fin = map(numero_columna, rango.groups())
                for columna in columnas:
                    if inicio <= numero_columna(columna) <= fin:
                        celdas.setdefault(columna + "1", celdas[rango[1] + "1"])
        return celdas


def codigo(valor):
    return valor.zfill(8) if valor.isdigit() else ""


def cantidad(cruce, celda):
    valor = cruce.get(celda)
    if valor is None:
        return None
    try:
        numero = Decimal(valor)
    except InvalidOperation as error:
        raise ValueError(f"Cantidad asistencial inválida en {celda}: {valor}") from error
    if not numero.is_finite() or numero < 0 or numero != numero.to_integral_value():
        raise ValueError(f"Cantidad asistencial inválida en {celda}: {valor}")
    return int(numero)


def antecedentes(cruce):
    cabeceras = {}
    columnas = sorted((celda[:-1] for celda in cruce if re.fullmatch(r"[A-Z]+2", celda)),
                      key=numero_columna)
    for columna in columnas:
        titulo = cruce.get(columna + "1", "")
        partes = titulo.split(" · ")
        if len(partes) < 3 or partes[1] not in {"ACTUAL", "FALTANTE (BRECHA)"}:
            continue
        grupo = partes[2].split(" (", 1)[0].strip().lower()
        if grupo in {"oficinas administrativas", "asistencial"}:
            cabeceras.setdefault(partes[1].capitalize() + " · " + grupo, []).append(columna)
    for actual, faltante, encabezado in EQUIPOS_ASISTENCIALES.values():
        for columna in (actual, faltante):
            if " ".join(cruce.get(columna + "2", "").upper().split()) != encabezado:
                raise ValueError(f"Revisa el encabezado asistencial en {columna}2. Se esperaba {encabezado}.")

    historico = {}
    for celda, valor in cruce.items():
        if not re.fullmatch(r"F[0-9]+", celda):
            continue
        fila = celda[1:]
        renipress = codigo(valor)
        if not renipress:
            continue
        grupos = []
        asistencial = None
        if cruce.get("S" + fila) == "SÍ" and codigo(cruce.get("AG" + fila, "")) == renipress:
            asistencial = {
                equipo: {"actual": cantidad(cruce, actual + fila), "faltante": cantidad(cruce, faltante + fila)}
                for equipo, (actual, faltante, _) in EQUIPOS_ASISTENCIALES.items()
            }
            for nombre, columnas in cabeceras.items():
                campos = [[cruce[col + "2"], cruce[col + fila]] for col in columnas if col + fila in cruce]
                if campos:
                    grupos.append({"nombre": nombre, "campos": campos})
        if renipress in historico:
            raise ValueError("Código duplicado en CRUCE: " + renipress)
        historico[renipress] = {
            "his": cruce.get("K" + fila) == "SÍ",
            "grupos": grupos,
            "equipamiento_asistencial": asistencial,
        }
    return historico


def preparar(libro, carpeta):
    historico = antecedentes(hoja(libro, "CRUCE", expandir_cabeceras=True))
    resultado = {}
    for archivo in sorted(carpeta.glob("*/Dia_*/*.xlsx")):
        nombre = re.fullmatch(r"[0-9]{2}_([0-9]{8})_[A-Z0-9_]+\.xlsx", archivo.name)
        if not nombre:
            raise ValueError("Nombre de ficha inválido: " + archivo.name)
        renipress = nombre[1]
        ficha = hoja(archivo, "FICHA_VALIDACION_1")
        if codigo(ficha["B4"]) != renipress or renipress in resultado:
            raise ValueError("Código de ficha inválido o duplicado: " + renipress)
        if renipress not in historico:
            raise ValueError("El establecimiento no aparece en CRUCE: " + renipress)
        resultado[renipress] = {
            "plantilla": archivo.relative_to(carpeta).as_posix(),
            "fuente": libro.name,
            **historico[renipress],
        }
    if len(resultado) != 25:
        raise ValueError(f"Se esperaban 25 fichas y se encontraron {len(resultado)}.")
    return resultado


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("libro", type=Path, nargs="?", default=LIBRO_EQUIPO)
    parser.add_argument("--fichas", type=Path, default=Path("source/Fichas_Validacion_Equipo_2"))
    parser.add_argument("--salida", type=Path, default=Path("source/referencias.json"))
    args = parser.parse_args()
    indice = preparar(args.libro, args.fichas)
    args.salida.write_text(json.dumps(indice, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(indice)} fichas, {sum(bool(v['grupos']) for v in indice.values())} con antecedentes.")
