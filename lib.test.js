// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('./lib.js');

test('pickTextFile: full Gutenberg text beats chapter files and _meta noise', () => {
  // Shape of mobydick00015gut's file list (trimmed).
  const files = [
    { name: 'moby-000.txt', size: '4000' },
    { name: 'moby-001.txt', size: '12000' },
    { name: 'pg15.txt', size: '1276000' },
    { name: 'pg15.txt_meta.txt', size: '900' },
    { name: 'Moby-README.TXT_meta.txt', size: '300' },
  ];
  assert.equal(lib.pickTextFile(files), 'pg15.txt');
});

test('pickTextFile: prefers publisher text over OCR, falls back to _djvu.txt', () => {
  assert.equal(lib.pickTextFile([
    { name: 'alice30_djvu.txt', size: '900000' },
    { name: 'alice30.txt', size: '150000' },
  ]), 'alice30.txt');
  assert.equal(lib.pickTextFile([
    { name: 'curriesfarmgarde19curr_1_djvu.txt', size: '500000' },
    { name: 'curriesfarmgarde19curr_1.pdf', size: '9000000' },
  ]), 'curriesfarmgarde19curr_1_djvu.txt');
});

test('pickTextFile: items with only readmes (e.g. dracula06534gut) have no text', () => {
  assert.equal(lib.pickTextFile([
    { name: '6534-readme.txt' },
    { name: 'old/dracu3-readme.txt' },
  ]), null);
});

test('stripBoilerplate: modern START/END markers', () => {
  const t = 'license funding donations\n*** START OF THE PROJECT GUTENBERG EBOOK MOBY DICK ***\n' +
    'Call me Ishmael.\n*** END OF THE PROJECT GUTENBERG EBOOK MOBY DICK ***\nmore license';
  assert.equal(lib.stripBoilerplate(t).trim(), 'Call me Ishmael.');
});

test('stripBoilerplate: old 1990s SMALL PRINT header (Dickinson 1mlyd10.txt style)', () => {
  const t = 'Project Gutenberg legalese edition funding\n' +
    '*END*THE SMALL PRINT! FOR PUBLIC DOMAIN ETEXTS*Ver.04.29.93*END*\n' +
    'Because I could not stop for Death\nEnd of Project Gutenberg Etext';
  assert.equal(lib.stripBoilerplate(t).trim(), 'Because I could not stop for Death');
});

test('stripBoilerplate: unmarked text passes through', () => {
  assert.equal(lib.stripBoilerplate('just a seed catalog'), 'just a seed catalog');
});

test('buildMagnets: one-off OCR junk never becomes a magnet', () => {
  const real = 'hemlock leaden meadow bramble '.repeat(3);
  const junk = 'towmainlysnide sgitge gare ';
  const magnets = lib.buildMagnets(real + junk, { seed: 3, common: 2, rare: 10 });
  for (const w of ['towmainlysnide', 'sgitge', 'gare']) assert.ok(!magnets.includes(w), w);
  for (const w of ['hemlock', 'leaden', 'meadow', 'bramble']) assert.ok(magnets.includes(w), w);
});

test('buildMagnets: always includes glue and suffix tiles, never stopwords as content', () => {
  const text = 'the the the which which ocean ocean whale whale xxix xxix';
  const magnets = lib.buildMagnets(text, { seed: 1 });
  for (const g of ['the', 'and', '-ed', '-ing']) assert.ok(magnets.includes(g), g);
  const content = magnets.slice(lib.GLUE.length);
  assert.deepEqual(content.sort(), ['ocean', 'whale']);
});

test('buildMagnets: same seed, same fridge; different seed, different fridge', () => {
  const words = Array.from({ length: 400 }, (_, i) => `word${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`);
  const text = words.map((w) => `${w} ${w}`).join(' ');
  const a = lib.buildMagnets(text, { seed: 42 });
  assert.deepEqual(a, lib.buildMagnets(text, { seed: 42 }));
  assert.notDeepEqual(a, lib.buildMagnets(text, { seed: 43 }));
  assert.equal(new Set(a.slice(lib.GLUE.length)).size, a.length - lib.GLUE.length, 'no duplicate content words');
});

test('readPoem: lines by vertical position, words left to right, slight wobble tolerated', () => {
  const placed = [
    { word: 'leaden', x: 120, y: 12 },
    { word: 'the', x: 10, y: 8 },
    { word: 'hemlock', x: 60, y: 70 },
    { word: 'sky', x: 200, y: 4 },
  ];
  assert.equal(lib.readPoem(placed), 'the leaden sky\nhemlock');
});

test('readPoem: suffix tiles attach to the word before them', () => {
  const placed = [
    { word: 'whale', x: 0, y: 0 },
    { word: '-s', x: 50, y: 0 },
    { word: 'sing', x: 80, y: 0 },
    { word: '-ing', x: 0, y: 60 }, // stranded suffix at line start stays as-is
  ];
  assert.equal(lib.readPoem(placed), 'whales sing\n-ing');
});

test('guessKind: ending-based guesses', () => {
  assert.equal(lib.guessKind('slowly'), 'adv');
  assert.equal(lib.guessKind('dying'), 'noun'); // too short to be sure it's a verb
  assert.equal(lib.guessKind('blushing'), 'ing');
  assert.equal(lib.guessKind('soldered'), 'ed');
  assert.equal(lib.guessKind('immortal'), 'noun');
  assert.equal(lib.guessKind('glorious'), 'adj');
  assert.equal(lib.guessKind('-ing'), 'suffix');
  assert.equal(lib.guessKind('hemlock'), 'noun');
});

test('fitToTiles: an invented word is dropped, real tiles kept in order', () => {
  const { lines, dropped } = lib.fitToTiles([['the', 'Golden', 'hemlock']], ['the', 'hemlock']);
  assert.deepEqual(lines, [['the', 'hemlock']]);
  assert.deepEqual(dropped, ['Golden']);
});

test('fitToTiles: a tile can only be used as many times as it exists', () => {
  const { lines, dropped } = lib.fitToTiles([['the', 'sky'], ['the', 'sea', 'the']], ['the', 'the', 'sky', 'sea']);
  assert.deepEqual(lines, [['the', 'sky'], ['the', 'sea']]);
  assert.deepEqual(dropped, ['the']);
});

test('fitToTiles: lines left empty are removed', () => {
  assert.deepEqual(lib.fitToTiles([['ghost'], ['sky']], ['sky']).lines, [['sky']]);
});

test('templatePoem: a real fridge yields 3 lines made only of available tiles', () => {
  const tiles = [...lib.GLUE, 'hemlock', 'leaden', 'blushing', 'soldered', 'slowly', 'glorious', 'daisy', 'oriole', 'meadow', 'juggler'];
  for (let seed = 1; seed <= 50; seed++) {
    const raw = lib.templatePoem(tiles, seed);
    assert.equal(raw.length, 3);
    const { lines } = lib.fitToTiles(raw, tiles);
    assert.ok(lines.length >= 2, `seed ${seed}: ${JSON.stringify(raw)}`);
    // Content words are never repeated within one poem.
    const content = raw.flat().filter((w) => !lib.GLUE.includes(w));
    assert.equal(new Set(content).size, content.length, `seed ${seed}`);
  }
});

test('templatePoem: same seed, same poem', () => {
  const tiles = [...lib.GLUE, 'hemlock', 'leaden', 'blushing', 'daisy', 'oriole'];
  assert.deepEqual(lib.templatePoem(tiles, 9), lib.templatePoem(tiles, 9));
});

test('templatePoem: a fridge with only glue words still produces something sane', () => {
  const { lines } = lib.fitToTiles(lib.templatePoem(lib.GLUE, 4), lib.GLUE);
  for (const l of lines) for (const w of l) assert.ok(lib.GLUE.includes(w));
});
