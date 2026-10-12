"""
Genera mazos de Anki (.apkg) a partir de los CSV de cada bloque,
y los datos de la web app (docs/mazos.json).

Uso:
    python generar.py                    -> genera todos los bloques
    python generar.py ingles/01_modals   -> genera solo el .apkg de ese bloque

Cada bloque es una carpeta con:
    mazo.txt  -> nombre, idioma, voz y descripcion del mazo
    *.csv     -> un archivo por tipo de tarjeta (ver TIPOS). Separador: punto y coma.
El resultado se guarda en salida/<carpeta>.apkg
La web app (docs/) siempre recibe todos los bloques.
"""
import csv
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

import genanki

RAIZ = Path(__file__).resolve().parent
SALIDA = RAIZ / "salida"
APP = RAIZ / "docs"
CSS = (RAIZ / "estilo.css").read_text(encoding="utf-8")

# archivo CSV -> (tipo de nota, instrucción que aparece en la tarjeta)
TIPOS = {
    "vocabulario.csv": ("concepto", None),
    "palabras.csv": ("palabra", None),
    "completar.csv": ("completar", None),
    "elegir.csv": ("pregunta", "Elige la opción correcta"),
    "traducir.csv": ("pregunta", "Tradúcelo al {idioma}"),
    "transformar.csv": ("pregunta", "Reescríbelo usando la palabra indicada"),
    "ordenar.csv": ("pregunta", "Ordena las palabras"),
    "errores.csv": ("pregunta", "Encuentra y corrige el error"),
}

# Columnas de cada tipo. "etiquetas" es opcional en todos.
COLUMNAS = {
    "concepto": ["termino", "uso", "significado", "ejemplo", "traduccion", "nota"],
    "palabra": ["palabra", "tipo", "significado", "ejemplo", "traduccion", "nota"],
    "completar": ["oracion", "pista", "traduccion", "explicacion"],
    "pregunta": ["pregunta", "pista", "respuesta", "explicacion"],
}
# Columnas que identifican cada nota: si las cambias, Anki la importará como nota nueva.
CLAVE = {
    "concepto": ["termino", "uso"],
    "palabra": ["palabra", "tipo"],
    "completar": ["oracion"],
    "pregunta": ["pregunta"],
}
OBLIGATORIAS = {
    "concepto": {"termino", "ejemplo"},
    "palabra": {"palabra", "significado"},
    "completar": {"oracion"},
    "pregunta": {"pregunta", "respuesta"},
}


# ---------------------------------------------------------------- plantillas
# VOZ se sustituye por el idioma de la voz (en_US, fr_FR...) del mazo.

CONCEPTO_RECONOCER_FRENTE = """<div class="wrap">
<div class="tipo">¿Qué expresa?</div>
<div class="en">{{Ejemplo}}</div>
</div>"""

CONCEPTO_RECONOCER_DORSO = """<div class="wrap">
<div class="tipo">¿Qué expresa?</div>
<div class="en">{{Ejemplo}}</div>
<hr id="answer">
<div class="termino">{{Termino}}</div>
{{#Uso}}<div class="uso">{{Uso}}</div>{{/Uso}}
{{#Significado}}<div class="es">{{Significado}}</div>{{/Significado}}
{{#Traduccion}}<div class="trad">{{Traduccion}}</div>{{/Traduccion}}
{{#Nota}}<div class="nota">{{Nota}}</div>{{/Nota}}
{{tts VOZ:Ejemplo}}
</div>"""

CONCEPTO_PRODUCIR_FRENTE = """<div class="wrap">
<div class="tipo">¿Cómo se dice?</div>
{{#Uso}}<div class="uso">{{Uso}}</div>{{/Uso}}
{{#Significado}}<div class="es">{{Significado}}</div>{{/Significado}}
{{#Traduccion}}<div class="trad">{{Traduccion}}</div>{{/Traduccion}}
</div>"""

CONCEPTO_PRODUCIR_DORSO = """<div class="wrap">
<div class="tipo">¿Cómo se dice?</div>
{{#Uso}}<div class="uso">{{Uso}}</div>{{/Uso}}
{{#Significado}}<div class="es">{{Significado}}</div>{{/Significado}}
{{#Traduccion}}<div class="trad">{{Traduccion}}</div>{{/Traduccion}}
<hr id="answer">
<div class="termino">{{Termino}}</div>
<div class="en">{{Ejemplo}}</div>
{{#Nota}}<div class="nota">{{Nota}}</div>{{/Nota}}
{{tts VOZ:Ejemplo}}
</div>"""

PALABRA_RECONOCER_FRENTE = """<div class="wrap">
<div class="tipo">¿Qué significa?</div>
<div class="termino">{{Palabra}}</div>
{{#Tipo}}<div class="pista">{{Tipo}}</div>{{/Tipo}}
{{#Ejemplo}}<div class="ejemplo">{{Ejemplo}}</div>{{/Ejemplo}}
</div>"""

PALABRA_RECONOCER_DORSO = """<div class="wrap">
<div class="tipo">¿Qué significa?</div>
<div class="termino">{{Palabra}}</div>
{{#Tipo}}<div class="pista">{{Tipo}}</div>{{/Tipo}}
{{#Ejemplo}}<div class="ejemplo">{{Ejemplo}}</div>{{/Ejemplo}}
<hr id="answer">
<div class="uso">{{Significado}}</div>
{{#Traduccion}}<div class="trad">{{Traduccion}}</div>{{/Traduccion}}
{{#Nota}}<div class="nota">{{Nota}}</div>{{/Nota}}
{{tts VOZ:Palabra}} {{#Ejemplo}}{{tts VOZ:Ejemplo}}{{/Ejemplo}}
</div>"""

PALABRA_PRODUCIR_FRENTE = """<div class="wrap">
<div class="tipo">¿Cómo se dice?</div>
<div class="uso">{{Significado}}</div>
{{#Tipo}}<div class="pista">{{Tipo}}</div>{{/Tipo}}
{{#Traduccion}}<div class="trad">{{Traduccion}}</div>{{/Traduccion}}
</div>"""

PALABRA_PRODUCIR_DORSO = """<div class="wrap">
<div class="tipo">¿Cómo se dice?</div>
<div class="uso">{{Significado}}</div>
{{#Tipo}}<div class="pista">{{Tipo}}</div>{{/Tipo}}
{{#Traduccion}}<div class="trad">{{Traduccion}}</div>{{/Traduccion}}
<hr id="answer">
<div class="termino">{{Palabra}}</div>
{{#Ejemplo}}<div class="ejemplo">{{Ejemplo}}</div>{{/Ejemplo}}
{{#Nota}}<div class="nota">{{Nota}}</div>{{/Nota}}
{{tts VOZ:Palabra}} {{#Ejemplo}}{{tts VOZ:Ejemplo}}{{/Ejemplo}}
</div>"""

COMPLETAR_FRENTE = """<div class="wrap">
<div class="tipo">Completa</div>
<div class="en">{{cloze:Texto}}</div>
{{#Pista}}<div class="pista">{{Pista}}</div>{{/Pista}}
</div>"""

COMPLETAR_DORSO = """<div class="wrap">
<div class="tipo">Completa</div>
<div class="en">{{cloze:Texto}}</div>
{{#Pista}}<div class="pista">{{Pista}}</div>{{/Pista}}
<hr id="answer">
{{#Traduccion}}<div class="trad">{{Traduccion}}</div>{{/Traduccion}}
{{#Explicacion}}<div class="nota">{{Explicacion}}</div>{{/Explicacion}}
{{tts VOZ:cloze:Texto}}
</div>"""

PREGUNTA_FRENTE = """<div class="wrap">
<div class="tipo">{{Instruccion}}</div>
<div class="pregunta">{{Pregunta}}</div>
{{#Pista}}<div class="chips">{{Pista}}</div>{{/Pista}}
</div>"""

PREGUNTA_DORSO = """<div class="wrap">
<div class="tipo">{{Instruccion}}</div>
<div class="pregunta">{{Pregunta}}</div>
{{#Pista}}<div class="chips">{{Pista}}</div>{{/Pista}}
<hr id="answer">
<div class="en">{{Respuesta}}</div>
{{#Explicacion}}<div class="nota">{{Explicacion}}</div>{{/Explicacion}}
{{tts VOZ:Respuesta}}
</div>"""


MODELOS = {
    "concepto": {
        "nombre": "Idiomas - Concepto",
        "campos": ["Termino", "Uso", "Significado", "Ejemplo", "Traduccion", "Nota"],
        "plantillas": [
            {"nombre": "Reconocer", "frente": CONCEPTO_RECONOCER_FRENTE, "dorso": CONCEPTO_RECONOCER_DORSO},
            {"nombre": "Producir", "frente": CONCEPTO_PRODUCIR_FRENTE, "dorso": CONCEPTO_PRODUCIR_DORSO},
        ],
        "cloze": False,
    },
    "palabra": {
        "nombre": "Idiomas - Palabra",
        "campos": ["Palabra", "Tipo", "Significado", "Ejemplo", "Traduccion", "Nota"],
        "plantillas": [
            {"nombre": "Reconocer", "frente": PALABRA_RECONOCER_FRENTE, "dorso": PALABRA_RECONOCER_DORSO},
            {"nombre": "Producir", "frente": PALABRA_PRODUCIR_FRENTE, "dorso": PALABRA_PRODUCIR_DORSO},
        ],
        "cloze": False,
    },
    "completar": {
        "nombre": "Idiomas - Completar",
        "campos": ["Texto", "Pista", "Traduccion", "Explicacion"],
        "plantillas": [{"nombre": "Completar", "frente": COMPLETAR_FRENTE, "dorso": COMPLETAR_DORSO}],
        "cloze": True,
    },
    "pregunta": {
        "nombre": "Idiomas - Pregunta",
        "campos": ["Instruccion", "Pregunta", "Pista", "Respuesta", "Explicacion"],
        "plantillas": [{"nombre": "Pregunta", "frente": PREGUNTA_FRENTE, "dorso": PREGUNTA_DORSO}],
        "cloze": False,
    },
}


def id_estable(texto):
    """Mismo texto -> mismo ID, para que Anki actualice en vez de duplicar al reimportar."""
    return (1 << 30) + int(hashlib.md5(texto.encode("utf-8")).hexdigest()[:7], 16)


def crear_modelos(voz):
    modelos = {}
    for clave, m in MODELOS.items():
        nombre = f"{m['nombre']} ({voz})"
        plantillas = [{"name": p["nombre"], "qfmt": p["frente"], "afmt": p["dorso"].replace("VOZ", voz)}
                      for p in m["plantillas"]]
        modelos[clave] = genanki.Model(
            id_estable(nombre), nombre, fields=[{"name": c} for c in m["campos"]], templates=plantillas,
            css=CSS, model_type=genanki.Model.CLOZE if m["cloze"] else genanki.Model.FRONT_BACK)
    return modelos


# ---------------------------------------------------------------- formato de texto

def markdown(texto):
    """**negrita** -> <b>negrita</b>   ~~tachado~~ -> <s>tachado</s>"""
    texto = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", texto)
    return re.sub(r"~~(.+?)~~", r"<s>\1</s>", texto)


def a_cloze(texto):
    """'You [must] go.' -> 'You {{c1::must}} go.'  (si ya usa {{c1::...}} se deja igual)"""
    if "{{c" in texto:
        return texto
    return re.sub(r"\[(.+?)\]", r"{{c1::\1}}", texto)


def chips(texto):
    """'mustn't / don't have to' -> una burbuja por opción"""
    return "".join(f'<span class="chip">{o.strip()}</span>' for o in texto.split("/") if o.strip())


def campos(tipo, fila, instruccion):
    c = {k: markdown(fila.get(k, "")) for k in COLUMNAS[tipo]}
    if tipo == "concepto":
        return [c["termino"], c["uso"], c["significado"], c["ejemplo"], c["traduccion"], c["nota"]]
    if tipo == "palabra":
        return [c["palabra"], c["tipo"], c["significado"], c["ejemplo"], c["traduccion"], c["nota"]]
    if tipo == "completar":
        return [a_cloze(c["oracion"]), c["pista"], c["traduccion"], c["explicacion"]]
    return [instruccion, c["pregunta"], chips(c["pista"]), c["respuesta"], c["explicacion"]]


# ---------------------------------------------------------------- generación

def leer_mazo(carpeta):
    datos = {}
    for linea in (carpeta / "mazo.txt").read_text(encoding="utf-8-sig").splitlines():
        if ":" in linea and not linea.lstrip().startswith("#"):
            clave, valor = linea.split(":", 1)
            datos[clave.strip().lower()] = valor.strip()
    if "nombre" not in datos:
        sys.exit(f"{carpeta / 'mazo.txt'}: falta la línea 'nombre: ...'")
    return datos


def leer_bloque(carpeta):
    """Lee mazo.txt y los CSV de un bloque."""
    info = leer_mazo(carpeta)
    relativa = carpeta.relative_to(RAIZ).as_posix()
    etiqueta_bloque = re.sub(r"\s+", "_", relativa.replace("/", "::"))

    notas = []
    vistas = {}
    resumen = []
    for archivo, (tipo, instruccion) in TIPOS.items():
        ruta = carpeta / archivo
        if not ruta.exists():
            continue
        if instruccion:
            instruccion = instruccion.format(idioma=info.get("idioma", "inglés"))
        n = 0
        with ruta.open(encoding="utf-8-sig", newline="") as f:
            lector = csv.DictReader(f, delimiter=";")
            lector.fieldnames = [(h or "").strip().lower() for h in lector.fieldnames or []]
            faltan = OBLIGATORIAS[tipo] - set(lector.fieldnames)
            if faltan:
                sys.exit(f"{ruta}: faltan las columnas {', '.join(sorted(faltan))}")
            for linea, fila in enumerate(lector, start=2):
                fila = {k: (v or "").strip() for k, v in fila.items() if isinstance(k, str)}
                primera = fila.get(COLUMNAS[tipo][0], "")
                if not primera or primera.startswith("#"):
                    continue
                valores = campos(tipo, fila, instruccion)
                if tipo == "completar" and "{{c" not in valores[0]:
                    sys.exit(f"{ruta}, línea {linea}: la oración no tiene ningún [hueco]")
                guid = genanki.guid_for(relativa, archivo, *(fila.get(k, "") for k in CLAVE[tipo]))
                if guid in vistas:
                    sys.exit(f"{ruta}, línea {linea}: repetida (igual que la línea {vistas[guid]})")
                vistas[guid] = linea
                etiquetas = [etiqueta_bloque, f"tipo::{ruta.stem}"] + fila.get("etiquetas", "").split()
                notas.append({"id": guid, "modelo": tipo, "campos": valores, "etiquetas": etiquetas})
                n += 1
        resumen.append(f"  {archivo:<18} {n:>3} notas")
    # Baraja las notas para no estudiar seguidas las del mismo tipo o tema.
    # El orden depende solo del ID: las notas nuevas se intercalan sin mover las demás.
    notas.sort(key=lambda nota: hashlib.md5(nota["id"].encode("utf-8")).hexdigest())
    return {"id": relativa, "info": info, "notas": notas, "resumen": resumen}


def escribir_apkg(bloque):
    info = bloque["info"]
    modelos = crear_modelos(info.get("voz", "en_US"))
    mazo = genanki.Deck(id_estable(info["nombre"]), info["nombre"], info.get("descripcion", ""))
    for orden, nota in enumerate(bloque["notas"]):
        mazo.add_note(genanki.Note(model=modelos[nota["modelo"]], fields=nota["campos"],
                                   tags=nota["etiquetas"], guid=nota["id"], due=orden))
    SALIDA.mkdir(exist_ok=True)
    destino = SALIDA / f"{bloque['id'].replace('/', '_')}.apkg"
    genanki.Package(mazo).write_to_file(destino)
    print(f"{info['nombre']}  ->  {destino.relative_to(RAIZ)}")
    print("\n".join(bloque["resumen"]))


def escribir_app(bloques):
    """Plantillas y notas de todos los mazos para la web app de docs/."""
    datos = {
        "modelos": MODELOS,
        "mazos": [{
            "id": b["id"],
            "nombre": b["info"]["nombre"],
            "descripcion": b["info"].get("descripcion", ""),
            "voz": b["info"].get("voz", "en_US"),
            "notas": b["notas"],
        } for b in bloques],
    }
    APP.mkdir(exist_ok=True)
    (APP / "mazos.json").write_text(json.dumps(datos, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    shutil.copyfile(RAIZ / "estilo.css", APP / "estilo.css")
    print(f"Web app: {len(bloques)} mazo(s)  ->  docs/mazos.json")


def main():
    todas = sorted(p.parent for p in RAIZ.rglob("mazo.txt") if not {SALIDA, APP} & set(p.parents))
    if not todas:
        sys.exit("No hay ningún bloque (carpeta con mazo.txt).")
    elegidas = {(RAIZ / a).resolve() for a in sys.argv[1:]}
    if elegidas - set(todas):
        sys.exit(f"No es un bloque: {', '.join(str(c) for c in elegidas - set(todas))}")
    bloques = [leer_bloque(c) for c in todas]
    for carpeta, bloque in zip(todas, bloques):
        if not elegidas or carpeta in elegidas:
            escribir_apkg(bloque)
    escribir_app(bloques)


if __name__ == "__main__":
    main()
