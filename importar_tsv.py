"""
Convierte un .tsv de Anki (frente / reverso / etiquetas) en un bloque nuevo.

Uso:
    python importar_tsv.py ARCHIVO.tsv CARPETA "Nombre::Del mazo"
Ejemplo:
    python importar_tsv.py Ingles_100_Anki.tsv ingles/02_unidades_3_y_4 "Inglés::02 Unidades 3 y 4"

Crea CARPETA/mazo.txt y CARPETA/ejercicios.csv. Después ejecuta generar.py.

Formato esperado de cada fila:
    frente:  "001. Consigna: «frase con ___»."
    reverso: "<b>Respuesta:</b> ...<br><br><b>Por qué:</b> ...<br><br><b>Error que debes evitar:</b> ..."
"""
import csv
import html
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent

# Etiqueta del TSV -> tema que se muestra arriba de la tarjeta
TEMAS = {
    "habilidad": "Habilidad",
    "obligacion_permiso": "Obligación y permiso",
    "futuro": "Futuro",
    "probabilidad": "Probabilidad",
    "retos_vocabulario": "Retos · vocabulario",
    "trabajo_vocabulario": "Trabajo · vocabulario",
    "adjetivos_compuestos": "Adjetivos compuestos",
    "naturaleza": "Naturaleza",
    "expresiones_lugares": "Expresiones",
    "comunicacion_escritura": "Comunicación",
}


def separar_frente(texto):
    """'001. Completa con can: «She ___ swim».' -> ('Completa con can', 'She ___ swim', True)"""
    texto = re.sub(r"^\s*\d+\.\s*", "", texto).strip()
    m = re.match(r"^([^«]+?):\s*(«.*»)(.*)$", texto)
    if not m:  # pregunta teórica, sin frase entre comillas
        return "", texto, False
    consigna, frase, resto = m.groups()
    resto = resto.strip().lstrip(".").strip()
    if resto:
        consigna = f"{consigna}. {resto}"
    if frase.count("«") == 1:
        frase = frase[1:-1]
    return consigna.strip(), frase, True


def separar_reverso(texto):
    partes = {}
    for trozo in re.split(r"(?:<br\s*/?>\s*){2}", texto):
        m = re.match(r"\s*<b>([^<]+?):</b>\s*(.*)", trozo, re.S)
        if m:
            partes[m.group(1).strip().lower()] = m.group(2).strip()
    if "respuesta" not in partes:
        return texto, "", ""
    return partes["respuesta"], partes.get("por qué", ""), partes.get("error que debes evitar", "")


def resaltar(frase, respuesta):
    """Pone en **negrita** lo que rellena cada ___ de la frase."""
    if "___" not in frase:
        return respuesta
    patron = "(.+?)".join(re.escape(p) for p in frase.split("___")) + r"[.!?]?"
    m = re.fullmatch(patron, respuesta)
    if not m:
        return respuesta
    salida, fin = [], 0
    for i in range(1, len(m.groups()) + 1):
        ini, fin_grupo = m.span(i)
        salida += [respuesta[fin:ini], f"**{respuesta[ini:fin_grupo]}**"]
        fin = fin_grupo
    return "".join(salida) + respuesta[fin:]


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    origen, carpeta, nombre = Path(sys.argv[1]), RAIZ / sys.argv[2], sys.argv[3]

    filas = []
    for linea in origen.read_text(encoding="utf-8-sig").splitlines():
        if not linea.strip() or linea.startswith("#"):
            continue
        frente, reverso, *resto = linea.split("\t")
        etiquetas = resto[0].split() if resto else []
        consigna, frase, con_frase = separar_frente(html.unescape(frente))
        respuesta, porque, error = (html.unescape(t) for t in separar_reverso(reverso))
        tema = next((TEMAS[e] for e in reversed(etiquetas) if e in TEMAS),
                    etiquetas[-1].replace("_", " ").capitalize() if etiquetas else "")
        filas.append({
            "tema": tema,
            "consigna": consigna,
            "frase": frase,
            "respuesta": resaltar(frase, respuesta),
            "porque": porque,
            "error": error,
            "audio": "" if con_frase else "no",  # las preguntas teóricas se responden en español
            "etiquetas": " ".join(etiquetas),
        })

    carpeta.mkdir(parents=True, exist_ok=True)
    (carpeta / "mazo.txt").write_text(
        f"# Configuración del mazo. Usa :: en el nombre para crear submazos.\n"
        f"nombre: {nombre}\nidioma: inglés\nvoz: en_US\n"
        f"descripcion: Importado de {origen.name}\n",
        encoding="utf-8")
    with (carpeta / "ejercicios.csv").open("w", encoding="utf-8-sig", newline="") as f:
        escritor = csv.DictWriter(f, fieldnames=list(filas[0]), delimiter=";")
        escritor.writeheader()
        escritor.writerows(filas)
    resaltadas = sum("**" in f["respuesta"] for f in filas)
    print(f"{len(filas)} tarjetas -> {carpeta.relative_to(RAIZ).as_posix()}/ejercicios.csv "
          f"({resaltadas} con la respuesta resaltada)")


if __name__ == "__main__":
    main()
