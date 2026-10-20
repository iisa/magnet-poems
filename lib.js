// Pure logic for magnet poems: picking a text file, cleaning it, sampling
// words, and reading magnets back as a poem. No DOM here so it runs under
// `node --test` as well as in the browser (as a classic script global).
(function (root) {
  'use strict';

  // Small glue words + suffixes, like the classic fridge-magnet kits.
  const GLUE = [
    'the', 'the', 'a', 'a', 'of', 'and', 'and', 'in', 'to', 'is', 'my',
    'you', 'i', 'me', 'we', 'it', 'not', 'like', 'was', 'with', 'all',
    '-s', '-s', '-ed', '-ing', '-ly',
  ];

  const STOPWORDS = new Set((
    'the a an of and in to is my you i me we it not like was with all ' +
    'that this these those for on at by from as but or if so be been are ' +
    'were am do does did have has had he she they them him her his hers ' +
    'their its our your yours who whom what which when where why how than ' +
    'then there here into upon out up down over under any some no nor own ' +
    'such very can could will would shall should may might must one also ' +
    'just only too more most other each about after before again'
  ).split(' '));

  // Pick the main plain-text file from an item's /metadata files list.
  // Prefers a publisher .txt (largest wins, so Moby Dick's full text beats
  // its 130 chapter files) and falls back to the OCR _djvu.txt.
  function pickTextFile(files) {
    const txt = (files || []).filter((f) => /\.txt$/i.test(f.name) &&
      !/_meta\.txt$/i.test(f.name) &&
      !/readme/i.test(f.name));
    const bySize = (a, b) => Number(b.size || 0) - Number(a.size || 0);
    const plain = txt.filter((f) => !/_djvu\.txt$/i.test(f.name)).sort(bySize);
    if (plain.length) return plain[0].name;
    const djvu = txt.filter((f) => /_djvu\.txt$/i.test(f.name)).sort(bySize);
    return djvu.length ? djvu[0].name : null;
  }

  // Strip Project Gutenberg license boilerplate (modern *** START/END ***
  // markers and the older *END*THE SMALL PRINT! header). Texts without
  // markers come back unchanged.
  function stripBoilerplate(text) {
    let body = text;
    const start = body.match(/\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*\n|\*END\*THE SMALL PRINT[^\n]*\n/i);
    if (start) body = body.slice(start.index + start[0].length);
    const end = body.search(/\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG|End of (?:the )?Project Gutenberg/i);
    if (end !== -1) body = body.slice(0, end);
    return body;
  }

  // Lowercased word counts. Letters only (plus inner apostrophes), so OCR
  // fragments like "duke'of" or "css" still need the count filter below.
  function countWords(text) {
    const counts = new Map();
    const re = /[a-z]+(?:['’][a-z]+)?/gi;
    let m;
    while ((m = re.exec(text))) {
      const w = m[0].toLowerCase().replace('’', "'");
      counts.set(w, (counts.get(w) || 0) + 1);
    }
    return counts;
  }

  // Deterministic PRNG so ?seed= reproduces the same fridge.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function sampleFrom(arr, n, rand) {
    const copy = arr.slice();
    const out = [];
    while (out.length < n && copy.length) {
      out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
    }
    return out;
  }

  // Build a magnet set: glue words, a handful of the book's signature
  // (frequent) words, and a larger pile of its rarer, stranger words.
  // minCount drops one-off tokens, which is where OCR junk lives.
  function buildMagnets(text, opts) {
    const o = Object.assign({ seed: 1, common: 15, rare: 55, minCount: 2 }, opts);
    const rand = mulberry32(o.seed);
    const counts = countWords(stripBoilerplate(text));
    const candidates = [...counts.entries()]
      .filter(([w, c]) => c >= o.minCount && w.length >= 3 && w.length <= 12 &&
        !STOPWORDS.has(w) &&
        !/^[ivxlc]+$/.test(w)) // poem/chapter numerals like "xxix"
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));

    const topN = candidates.slice(0, 200).map(([w]) => w);
    const common = sampleFrom(topN, o.common, rand);
    const taken = new Set(common);
    const rest = candidates.slice(200).map(([w]) => w);
    const rare = sampleFrom(rest, o.rare, rand);
    // Short texts may not have 200+ words; top up from unused frequent ones.
    if (rare.length < o.rare) {
      const leftover = topN.filter((w) => !taken.has(w));
      rare.push(...sampleFrom(leftover, o.rare - rare.length, rand));
    }

    return [...GLUE, ...common, ...rare];
  }

  // Read placed magnets in visual order: group into lines by vertical
  // center, then left to right. Suffix magnets ("-ed") glue onto the
  // previous word, the way you'd read them on a fridge.
  function readPoem(placed, lineTolerance) {
    const tol = lineTolerance || 20;
    const sorted = placed.slice().sort((a, b) => a.y - b.y);
    const lines = [];
    for (const m of sorted) {
      const line = lines.find((l) => Math.abs(l.y - m.y) <= tol);
      if (line) line.items.push(m);
      else lines.push({ y: m.y, items: [m] });
    }
    return lines.map((l) => l.items
      .sort((a, b) => a.x - b.x)
      .reduce((acc, m) => (m.word.startsWith('-') && acc
        ? acc + m.word.slice(1)
        : (acc ? acc + ' ' : '') + m.word), ''))
      .join('\n');
  }

  // ---- poets -------------------------------------------------------------
  // A poet turns the available tiles into lines of words. Every poet's
  // output goes through fitToTiles, so it can only ever use real tiles.
  // That's the contract an AI poet would plug into later.

  // Rough part-of-speech guess from the word ending. No dictionary; good
  // enough for fridge poetry. Unknown words count as nouns.
  function guessKind(word) {
    if (word.startsWith('-')) return 'suffix';
    if (/ly$/.test(word) && word.length > 4) return 'adv';
    if (/ing$/.test(word) && word.length > 5) return 'ing';
    if (/ed$/.test(word) && word.length > 4) return 'ed';
    if (/(ful|ous|ive|less|ic|able|ible|ish|ent|ant|ary|y)$/.test(word) && word.length > 4) return 'adj';
    return 'noun';
  }

  // Slots in caps are filled from that kind of word; lowercase are glue
  // tiles used as-is.
  const TEMPLATES = [
    ['the', 'ADJ', 'NOUN'],
    ['NOUN', 'ING', 'in', 'the', 'NOUN'],
    ['i', 'ED', 'like', 'a', 'NOUN'],
    ['my', 'NOUN', 'is', 'ADJ'],
    ['ADV', 'we', 'ING'],
    ['and', 'all', 'the', 'NOUN', '-s', 'ED'],
    ['not', 'NOUN', 'not', 'NOUN'],
    ['you', 'ED', 'with', 'my', 'NOUN'],
    ['ADJ', 'ADJ', 'NOUN'],
    ['it', 'was', 'ADJ', 'and', 'ADJ'],
    ['of', 'NOUN', 'and', 'NOUN'],
    ['me', 'ADV', 'ING'],
  ];

  function templatePoem(tiles, seed, lineCount) {
    const rand = mulberry32(seed);
    const pools = { adv: [], ing: [], ed: [], adj: [], noun: [] };
    for (const w of new Set(tiles)) {
      const k = guessKind(w);
      if (pools[k] && !GLUE.includes(w)) pools[k].push(w);
    }
    const take = (kind) => {
      // Empty pool? Borrow from nouns, then from anything left.
      const pool = [pools[kind], pools.noun, ...Object.values(pools)].find((p) => p.length);
      return pool ? pool.splice(Math.floor(rand() * pool.length), 1)[0] : null;
    };
    const chosen = sampleFrom(TEMPLATES, lineCount || 3, rand);
    return chosen.map((t) => t
      .map((slot) => (/^[A-Z]+$/.test(slot) ? take(slot.toLowerCase()) : slot))
      .filter(Boolean));
  }

  // Clamp a poet's lines to the tiles actually available: each tile used at
  // most as many times as it exists, unknown words dropped (an AI might
  // invent some). Returns the kept lines and what got dropped.
  function fitToTiles(lines, tiles) {
    const left = new Map();
    for (const t of tiles) left.set(t, (left.get(t) || 0) + 1);
    const dropped = [];
    const kept = lines.map((line) => line.filter((raw) => {
      const w = String(raw).toLowerCase().trim();
      if (left.get(w) > 0) { left.set(w, left.get(w) - 1); return true; }
      dropped.push(raw);
      return false;
    }).map((w) => String(w).toLowerCase().trim())).filter((l) => l.length);
    return { lines: kept, dropped };
  }

  const api = {
    GLUE, pickTextFile, stripBoilerplate, countWords, mulberry32, buildMagnets, readPoem,
    guessKind, templatePoem, fitToTiles,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MagnetLib = api;
})(this);
