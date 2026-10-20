# Magnet Poems

Fridge poetry from public domain books on the [Internet Archive](https://archive.org).

## ▶ Try it

**Live demo: https://iisa.github.io/magnet-poems/**

Jump straight to a fridge:

| Shelf | Try |
|---|---|
| 📖 Project Gutenberg | [Emily Dickinson's *Poems*](https://iisa.github.io/magnet-poems/?book=poemsbyemilydick02678gut) · [*Moby-Dick*](https://iisa.github.io/magnet-poems/?book=mobydickorthewha02701gut) · [*Alice in Wonderland*](https://iisa.github.io/magnet-poems/?book=alicesadventures00011gut) |
| 🌱 Seed catalogs | [Alneer Brothers, 1896](https://iisa.github.io/magnet-poems/?book=alneerbrothersil00alne) · [Thorburn's seeds, 1908](https://iisa.github.io/magnet-poems/?book=CAT31289649) |
| 🧒 Children's books | [*The Wind in the Willows*](https://iisa.github.io/magnet-poems/?book=windinwillowsgrah) · [*The Real Mother Goose*](https://iisa.github.io/magnet-poems/?book=realmothergoosewrig) |
| 📚 Duke University Libraries | [*Across the Zodiac*, 1880](https://iisa.github.io/magnet-poems/?book=acrosszodiacstor01greg) · [*The Smoky God*](https://iisa.github.io/magnet-poems/?book=smokygodorvoyage00emer) |

Source: https://github.com/iisa/magnet-poems

## What you can do

- **Pick a book** from a shelf. Each shelf is an archive.org collection and links to it; **More from this collection** pulls more books live from IA. Project Gutenberg also has a search box.
- **Arrange words.** Tiles start in a tray at the bottom of the fridge; anything above the line is your poem. Drag them, or use the keyboard: Enter on a tray word sends it up, arrow keys move it (Shift for bigger steps), Delete sends it back.
- **Write me a poem** for a starter (every fridge starts with one).
- **Shape poem**: pour the book's words into a heart, star, smiley, flower, moon, circle, spiral, infinity, wave, lightning bolt, diamond, tree, house or hourglass. Pick one, or **surprise me**.
- **Shake up** the fridge and see what falls into place. **New words** deals a fresh set from the same book.
- **Classic shape poems**: Lewis Carroll's *The Mouse's Tale*, laid out in its original printed tail shape.
- **Copy poem** copies it with a credit line linking back to the book.

## How it works

- Everything runs in the browser against archive.org: `/metadata/<id>` to find the text file, `/download/<id>/<file>` to fetch it, `/advancedsearch.php` for shelves and search, `/services/img/<id>` for covers. All of these send `access-control-allow-origin: *`.
- Shelves (`SHELVES` in `app.js`):

  | Shelf | Collection |
  |---|---|
  | 📖 Project Gutenberg | [`gutenberg`](https://archive.org/details/gutenberg) |
  | 🌱 Seed catalogs | [`usda-nurseryandseedcatalog`](https://archive.org/details/usda-nurseryandseedcatalog), USDA National Agricultural Library |
  | 🧒 Children's books | [`juvenilehistoricalcollection`](https://archive.org/details/juvenilehistoricalcollection), UNC Chapel Hill |
  | 📚 Duke University Libraries | [`duke_libraries`](https://archive.org/details/duke_libraries) |

  "More from this collection" asks only for texts with OCR dated 1930 or earlier, so it stays public domain in the US.
- Gutenberg items on IA only have a generic icon, so their covers come from early editions scanned by libraries. Scanned books use their own cover and OCR text.
- Project Gutenberg license boilerplate is stripped, and words that appear only once are dropped (three times for scans), which filters most OCR junk.
- Each fridge mixes glue words (`the`, `my`, `-ing`…), some of the book's signature words, and a pile of its rarer ones. `?book=<id>&seed=<n>` reproduces a fridge.

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

## Deploy

GitHub Pages serves `main` from the repo root, so pushing to `main` updates the demo in about a minute.
