# Tarjetas Anki

```
anki/
├── generar.py          ← convierte los CSV en .apkg y en datos para la web app
├── estilo.css          ← colores y tipografía de todas las tarjetas
├── ingles/
│   └── 01_modals/      ← un bloque = una carpeta = un mazo
│       ├── mazo.txt    ← nombre del mazo, idioma, voz y descripción
│       └── *.csv       ← las tarjetas (una fila = una nota)
├── docs/               ← la web app para el iPhone (GitHub Pages publica esta carpeta)
└── salida/             ← aquí aparecen los .apkg
```

## Web app (iPhone)

`python generar.py` también actualiza `docs/mazos.json`. Para publicar los cambios:

```
git add -A
git commit -m "Nuevas tarjetas"
git push
```

En un minuto la app del iPhone tendrá las tarjetas nuevas (ábrela con internet una vez).
El progreso se guarda **solo en ese dispositivo**: usa Ajustes → Exportar progreso de vez en cuando.

## Generar e importar

```
python generar.py                    # todos los bloques
python generar.py ingles/01_modals   # solo uno
```

Doble clic en `salida/ingles_01_modals.apkg` (o en Anki: Archivo → Importar).
Si cambias algo y vuelves a importar, Anki **actualiza** las notas existentes sin perder tu progreso.
Solo se crea una nota nueva si cambias la columna que la identifica (ver tabla).

## Formato de los CSV

Separador `;` (se abren en Excel). Una fila que empieza por `#` se ignora.
En cualquier campo: `**negrita**` y `~~tachado~~`. Columna opcional `etiquetas` (separadas por espacios).

| Archivo           | Columnas                                               | Identifica la nota | Tarjetas                     |
|-------------------|--------------------------------------------------------|--------------------|------------------------------|
| `vocabulario.csv` | termino; uso; significado; ejemplo; traduccion; nota   | termino + uso      | 2: reconocer y producir      |
| `completar.csv`   | oracion; pista; traduccion; explicacion                | oracion            | 1 por hueco                  |
| `elegir.csv`      | pregunta; pista; respuesta; explicacion                | pregunta           | 1                            |
| `traducir.csv`    | (igual que elegir)                                     | pregunta           | 1                            |
| `transformar.csv` | (igual que elegir)                                     | pregunta           | 1                            |
| `errores.csv`     | (igual que elegir)                                     | pregunta           | 1                            |
| `ordenar.csv`     | (igual que elegir)                                     | pregunta           | 1                            |
| `palabras.csv`    | palabra; tipo; significado; ejemplo; traduccion; nota  | palabra + tipo     | 2: reconocer y producir      |
| `ejercicios.csv`  | tema; consigna; frase; respuesta; porque; error; audio | consigna + frase   | 1                            |

- **completar**: el hueco va entre corchetes: `You [must] go.`  También vale la sintaxis de Anki `{{c1::must}}` y `{{c2::...}}` para varias tarjetas.
- **elegir / transformar**: en `pista` van las opciones separadas por `/` (salen como botones).
- El audio usa la voz del sistema (`voz: en_US` en `mazo.txt`), sin archivos de audio.

Para un bloque nuevo: copia la carpeta `01_modals`, cambia `mazo.txt` y los CSV.

## Importar un .tsv de Anki (frente / reverso / etiquetas)

```
python importar_tsv.py Ingles_100_Anki.tsv ingles/02_unidades_3_y_4 "Inglés::02 Unidades 3 y 4"
python generar.py
```

Crea la carpeta con `mazo.txt` y `ejercicios.csv`. Separa la consigna de la frase, resalta lo que
rellena cada `___` y pone `audio = no` en las preguntas que se responden en español.
