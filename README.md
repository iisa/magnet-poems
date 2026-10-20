# Magnet Poems

Fridge poetry from public domain books on the [Internet Archive](https://archive.org).

**Demo:** https://iisa.github.io/magnet-poems/

Pick a book (or search Project Gutenberg on archive.org) and its words turn into magnets in a tray at the bottom of the fridge. Drag them above the line to write a poem, hit **Write me a poem** for a starter, or **Shake up** the fridge and see what falls into place. Every poem links back to the book its words came from.

## How it works

- Text comes straight from archive.org in the browser: `/metadata/<id>` to find the text file, `/download/<id>/<file>` to fetch it (both send `access-control-allow-origin: *`).
- Project Gutenberg license boilerplate is stripped; words that appear only once are dropped, which filters most OCR junk from scanned books.
- Each fridge mixes glue words (`the`, `my`, `-ing`…), some of the book's signature words, and a pile of its rarer ones. `?book=<id>&seed=<n>` reproduces a fridge.
- Keyboard: Enter on a tray word sends it up, arrow keys move it (Shift for bigger steps), Delete sends it back.

## Poets

**Write me a poem** uses a template poet (`templatePoem` in `lib.js`). Whatever a poet returns goes through `fitToTiles`, which keeps only tiles that actually exist, so an AI poet can be added later as another entry in `POETS` in `app.js` (calling a small server that holds the API key, never the page).

## Run locally

No build step.

```bash
python3 -m http.server 8765
```

Then open http://127.0.0.1:8765/.

## Tests

```bash
node --test lib.test.js
```
