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
    const o = Object.assign({ seed: 1, common: 25, rare: 110, minCount: 2 }, opts);
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

  // ---- shapes --------------------------------------------------------------
  // Shapes lay tiles out in a unit box (0..1 on both axes); the page scales
  // the result to the fridge. Two kinds:
  //   path: tiles follow a curve, spaced so neighbours don't overlap
  //   rows: centered rows whose widths follow a profile (reads as lines)

  const TAU = Math.PI * 2;

  // Path helpers. Each returns at(t) → {x, y} for t in 0..1.
  const ring = (cx, cy, r, from, to) => (t) => {
    const a = ((from || 0) + ((to == null ? 1 : to) - (from || 0)) * t) * TAU;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  };
  // Straight lines through the points in order, each edge an equal share of t.
  const poly = (pts) => (t) => {
    const n = pts.length - 1;
    const f = Math.min(t * n, n - 1e-9);
    const i = Math.floor(f);
    const u = f - i;
    return { x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u, y: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u };
  };
  // Several curves drawn one after another (pen lifts between them);
  // weight sets each part's share of t, roughly its length.
  const joined = (parts) => {
    const total = parts.reduce((sum, [w]) => sum + w, 0);
    return (t) => {
      let acc = 0;
      for (const [w, at] of parts) {
        const share = w / total;
        if (t <= acc + share) return at((t - acc) / share);
        acc += share;
      }
      return parts[parts.length - 1][1](1);
    };
  };

  // Order here is the order of the picker and of "Surprise me".
  const SHAPES = {
    heart: {
      label: '♥ heart',
      kind: 'path',
      square: true,
      // The classic heart curve, starting at the top dip.
      at: (t) => {
        const a = t * TAU;
        const x = 16 * Math.sin(a) ** 3;
        const y = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a);
        // /40 leaves a margin so edge tiles still fit inside the box.
        return { x: 0.5 + x / 40, y: 0.44 - y / 40 };
      },
    },
    star: {
      label: '★ star',
      kind: 'path',
      square: true,
      at: poly(Array.from({ length: 11 }, (_, k) => {
        const a = (-90 + k * 36) * Math.PI / 180;
        const r = k % 2 ? 0.19 : 0.46;
        return [0.5 + r * Math.cos(a), 0.53 + r * Math.sin(a)];
      })),
    },
    smiley: {
      label: '☺ smiley',
      kind: 'path',
      square: true,
      at: joined([
        [6, ring(0.5, 0.5, 0.44)],
        [0.6, ring(0.36, 0.38, 0.05)],
        [0.6, ring(0.64, 0.38, 0.05)],
        [2, ring(0.5, 0.5, 0.25, 0.1, 0.4)], // bottom arc: y grows downward
      ]),
    },
    flower: {
      label: '✿ flower',
      kind: 'path',
      square: true,
      // Five-petal rose curve.
      at: (t) => {
        const a = t * Math.PI;
        const r = 0.44 * Math.cos(5 * a);
        return { x: 0.5 + r * Math.cos(a), y: 0.5 + r * Math.sin(a) };
      },
    },
    moon: {
      label: '☾ moon',
      kind: 'path',
      square: true,
      // Outer arc round the left, then the inner arc back.
      at: joined([
        [3, ring(0.5, 0.5, 0.44, 0.2, 0.8)],
        [2, ring(0.68, 0.5, 0.34, 0.75, 0.25)],
      ]),
    },
    circle: { label: '○ circle', kind: 'path', square: true, at: ring(0.5, 0.5, 0.44, 0.75, 1.75) },
    spiral: {
      label: '@ spiral',
      kind: 'path',
      square: true,
      at: (t) => {
        const a = t * TAU * 2.1;
        const r = 0.06 + 0.36 * t;
        return { x: 0.5 + r * Math.cos(a), y: 0.5 + r * Math.sin(a) };
      },
    },
    infinity: {
      label: '∞ infinity',
      kind: 'path',
      // Lemniscate of Bernoulli.
      at: (t) => {
        const a = t * TAU;
        const d = 1 + Math.sin(a) ** 2;
        return { x: 0.5 + (0.46 * Math.cos(a)) / d, y: 0.5 + (0.8 * Math.sin(a) * Math.cos(a)) / d };
      },
    },
    wave: {
      label: '〰 wave',
      kind: 'path',
      // Two passes across, like a folded ribbon.
      at: (t) => {
        const second = t >= 0.5;
        const u = second ? 1 - (t - 0.5) * 2 : t * 2;
        return { x: 0.02 + u * 0.96, y: (second ? 0.72 : 0.28) + 0.16 * Math.sin(u * TAU * 1.5) };
      },
    },
    lightning: {
      label: 'ϟ lightning',
      kind: 'path',
      at: poly([[0.62, 0.02], [0.36, 0.5], [0.6, 0.5], [0.4, 0.98]]),
    },
    diamond: { label: '◆ diamond', kind: 'rows', profile: [0.12, 0.3, 0.5, 0.7, 0.5, 0.3, 0.12] },
    tree: { label: '🌲 tree', kind: 'rows', profile: [0.08, 0.22, 0.36, 0.5, 0.64, 0.78, 0.08, 0.08] },
    house: { label: '⌂ house', kind: 'rows', profile: [0.1, 0.28, 0.46, 0.64, 0.5, 0.5, 0.5] },
    hourglass: { label: '⌛ hourglass', kind: 'rows', profile: [0.7, 0.5, 0.3, 0.1, 0.3, 0.5, 0.7] },
  };

  // Place tiles (sizes in px) along shape.at, scaled to a w×h box. Walk the
  // curve and put the next tile down at the first spot where it fits inside
  // the box and clears every tile already placed. Returns top-left
  // positions for as many tiles as fit.
  function layoutPath(sizes, at, w, h, gap) {
    const g = gap == null ? 6 : gap;
    const placed = []; // boxes
    const steps = 4000;
    for (let s = 0; s <= steps && placed.length < sizes.length; s++) {
      const p = at(s / steps);
      const sz = sizes[placed.length];
      const box = { x: p.x * w - sz.w / 2, y: p.y * h - sz.h / 2, w: sz.w, h: sz.h };
      if (box.x < 0 || box.y < 0 || box.x + box.w > w || box.y + box.h > h) continue;
      const hits = placed.some((o) => box.x < o.x + o.w + g && o.x < box.x + box.w + g &&
        box.y < o.y + o.h + g && o.y < box.y + box.h + g);
      if (!hits) placed.push(box);
    }
    return placed.map(({ x, y }) => ({ x, y }));
  }

  // Centered rows: each row takes tiles until it reaches its share of the
  // width (always at least one). Returns top-left positions.
  function layoutRows(sizes, profile, w, h, gap) {
    const g = gap == null ? 6 : gap;
    const rowH = h / profile.length;
    const out = [];
    let i = 0;
    profile.forEach((share, r) => {
      const target = share * w;
      const row = [];
      let width = 0;
      while (i < sizes.length) {
        const next = width + (row.length ? g : 0) + sizes[i].w;
        if (row.length && next > target) break;
        row.push(sizes[i]);
        width = next;
        i++;
      }
      let x = (w - width) / 2;
      for (const sz of row) {
        out.push({ x, y: r * rowH + (rowH - sz.h) / 2 });
        x += sz.w + g;
      }
    });
    return out;
  }

  function layoutShape(name, sizes, w, h) {
    const shape = SHAPES[name];
    if (shape.kind === 'rows') return layoutRows(sizes, shape.profile, w, h);
    if (!shape.square) return layoutPath(sizes, shape.at, w, h);
    // Keep round shapes round: fit a square box, centered.
    const side = Math.min(w, h);
    const dx = (w - side) / 2;
    const dy = (h - side) / 2;
    return layoutPath(sizes, shape.at, side, side).map((p) => ({ x: p.x + dx, y: p.y + dy }));
  }

  // ---- classics ------------------------------------------------------------
  // Public domain shape poems that bring their own tiles. Each line is
  // [indent in characters, text], copied from the source text on IA so the
  // printed shape survives.

  const CLASSICS = {
    mouse: {
      title: "The Mouse's Tale",
      credit: "Lewis Carroll, Alice's Adventures in Wonderland (1865)",
      source: 'alicesadventures00011gut',
      shrink: true, // the original gets smaller as the tail tapers
      lines: [
        [20, '‘Fury said to a'], [19, 'mouse, That he'], [17, 'met in the'],
        [15, 'house,'], [12, '“Let us'], [14, 'both go to'], [16, 'law: I will'],
        [18, 'prosecute'], [20, 'YOU. —Come,'], [23, "I'll take no"],
        [24, 'denial; We'], [21, 'must have a'], [17, 'trial: For'],
        [14, 'really this'], [11, "morning I've"], [10, 'nothing'],
        [9, 'to do.”'], [11, 'Said the'], [13, 'mouse to the'],
        [15, 'cur, “Such'], [17, 'a trial,'], [19, 'dear Sir,'], [25, 'With'],
        [21, 'no jury'], [18, 'or judge,'], [16, 'would be'], [14, 'wasting'],
        [13, 'our'], [14, 'breath.”'], [15, '“I\'ll be'], [17, "judge, I'll"],
        [19, 'be jury,”'], [25, 'Said'], [20, 'cunning'], [22, 'old Fury:'],
        [21, '“I\'ll'], [22, 'try the'], [25, 'whole'], [26, 'cause,'],
        [29, 'and'], [24, 'condemn'], [23, 'you'], [22, 'to'], [23, 'death.”’'],
      ],
    },
  };

  // Lines → tiles with a line index, indent, and scale (1 → 0.55 when the
  // poem shrinks toward its end).
  function classicTiles(name) {
    const c = CLASSICS[name];
    const n = c.lines.length;
    const tiles = [];
    c.lines.forEach(([indent, text], line) => {
      const scale = c.shrink ? 1 - 0.45 * (line / (n - 1)) : 1;
      text.split(/\s+/).filter(Boolean).forEach((word, k) => {
        tiles.push({ word, line, indent, scale, first: k === 0 });
      });
    });
    return tiles;
  }

  const api = {
    GLUE, pickTextFile, stripBoilerplate, countWords, mulberry32, buildMagnets, readPoem,
    guessKind, templatePoem, fitToTiles,
    SHAPES, layoutPath, layoutRows, layoutShape, CLASSICS, classicTiles,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MagnetLib = api;
})(this);
