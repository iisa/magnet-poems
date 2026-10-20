// UI for magnet poems. Pure logic lives in lib.js (window.MagnetLib).
//
// Layout: every tile lives on the fridge. The bottom of the fridge is the
// tray, where tiles start in a jumble; anything above the tray line is the
// poem.
(function () {
  'use strict';
  const L = window.MagnetLib;
  const $ = (id) => document.getElementById(id);
  const fridge = $('fridge');

  const POEM_DEFAULT = 320; // height of the writing area above the tray
  const SHAPE_H = 440; // shapes get a taller writing area
  let POEM_H = POEM_DEFAULT; // grows for tall shapes; see setPoemH
  const PAD = 12;
  const GAP = 6;
  const ROW = 38;
  const LINE = 52; // line spacing when a poet places a poem

  // Poets turn the tiles into lines of words: (tiles, seed) => string[][],
  // sync or async. Output is always clamped by MagnetLib.fitToTiles, so a
  // poet can only use tiles that exist. To add an AI poet later, give it
  // the same signature, e.g.
  //   ai: async (tiles) => (await fetch('/api/poem', {
  //     method: 'POST', body: JSON.stringify({ tiles }) })).json(),
  // and point POET at it. The key stays on that server, never in the page.
  const POETS = {
    template: (tiles, seed) => L.templatePoem(tiles, seed),
  };
  const POET = 'template';

  const state = {
    id: null, title: '', creator: '', text: '', isOcr: false, seed: 1,
    magnets: [], // { word, el, x, y, classic? }
    classic: null, // name of the classic shape poem on the fridge, if any
  };
  let cursor = { x: PAD, y: PAD }; // next keyboard placement slot

  function announce(msg) {
    const a = $('announce');
    a.textContent = '';
    // Re-set after a tick so repeated messages are still read out.
    setTimeout(() => { a.textContent = msg; }, 30);
  }

  // Run fn with slide-in transitions on, for moves the page makes itself
  // (poems, shakes, returns). Drags and arrow keys stay instant.
  function animated(fn) {
    fridge.classList.add('animate');
    fn();
    setTimeout(() => fridge.classList.remove('animate'), 600);
  }

  function rnd() { return Math.floor(Math.random() * 1e9); }

  // Bring the top of the fridge into view (the action bar is sticky, so
  // you can press a button from far down the tray).
  function showFridgeTop() {
    const top = fridge.getBoundingClientRect().top;
    if (top < 0 || top > innerHeight / 2) {
      const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
      fridge.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
    }
  }

  // ---- loading ---------------------------------------------------------

  async function loadBook(id, seed) {
    $('source').textContent = 'Loading…';
    document.querySelectorAll('.book').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.id === id));
    });
    // Collapse the picker and show this book's cover in its summary
    // (search results have no real cover, so none is shown).
    $('picker').open = false;
    const card = document.querySelector(`.book[data-id="${CSS.escape(id)}"][data-cover]`);
    const thumb = $('current-cover');
    thumb.hidden = !card;
    if (card) thumb.src = `https://archive.org/services/img/${encodeURIComponent(card.dataset.cover)}`;
    try {
      const meta = await (await fetch(`https://archive.org/metadata/${encodeURIComponent(id)}`)).json();
      const file = L.pickTextFile(meta.files);
      if (!file) throw new Error('This item has no plain text to make magnets from.');
      const res = await fetch(`https://archive.org/download/${encodeURIComponent(id)}/${file.split('/').map(encodeURIComponent).join('/')}`);
      if (!res.ok) throw new Error(`Text download failed (${res.status}).`);
      const m = meta.metadata || {};
      Object.assign(state, {
        id,
        title: [].concat(m.title || id)[0],
        creator: [].concat(m.creator || '')[0],
        text: await res.text(),
        isOcr: /_djvu\.txt$/i.test(file),
      });
      dealWords(seed);
    } catch (err) {
      $('source').textContent = `Couldn't load that book: ${err.message}`;
    }
  }

  function dealWords(seed) {
    leaveClassic();
    state.seed = seed || Math.floor(Math.random() * 1e9);
    // Scanned books have OCR junk; require words to recur more often.
    const words = L.buildMagnets(state.text, { seed: state.seed, minCount: state.isOcr ? 3 : 2 });
    const rand = L.mulberry32(state.seed);
    fridge.querySelectorAll('.magnet').forEach((el) => el.remove());
    state.magnets = words.map((word) => makeMagnet(word, rand));
    cursor = { x: PAD, y: PAD };
    packTray(state.magnets);
    renderSource();
    renderPoem();
    const url = new URL(location.href);
    url.searchParams.set('book', state.id);
    url.searchParams.set('seed', state.seed);
    history.replaceState(null, '', url);
    // Start with a poem on the fridge so there's something to play with.
    writePoem(`${state.magnets.length} words from ${state.title}. Starter poem`);
  }

  function renderSource() {
    const src = $('source');
    src.textContent = '';
    const a = document.createElement('a');
    a.href = `https://archive.org/details/${encodeURIComponent(state.id)}`;
    a.textContent = state.title;
    src.append(a, state.creator ? ` by ${state.creator}` : '', state.isOcr ? ' (scanned; expect a few odd words)' : '');
  }

  // ---- magnets ---------------------------------------------------------

  function makeMagnet(word, rand) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'magnet' + (word.startsWith('-') ? ' suffix' : '');
    el.textContent = word;
    el.style.setProperty('--tilt', `${((rand() - 0.5) * 5).toFixed(1)}deg`);
    fridge.append(el);
    const m = { word, el, x: 0, y: POEM_H + PAD };
    el.addEventListener('click', () => {
      if (el.dataset.dragged) { delete el.dataset.dragged; return; }
      if (!inPoem(m)) placeAtCursor(m); // click or Enter on a tray tile sends it up
    });
    el.addEventListener('keydown', (e) => onMagnetKey(e, m));
    el.addEventListener('pointerdown', (e) => startDrag(e, m));
    return m;
  }

  // Move the tray line. Tiles in the tray stay in the tray (repacked).
  function setPoemH(h) {
    const tray = trayTiles();
    POEM_H = h;
    fridge.style.setProperty('--poem-h', `${h}px`);
    packTray(tray);
  }

  const inPoem = (m) => m.y + m.el.offsetHeight / 2 < POEM_H;
  const trayTiles = () => state.magnets.filter((m) => !inPoem(m));

  function setPos(m, x, y) {
    const maxX = fridge.clientWidth - m.el.offsetWidth;
    const maxY = fridge.clientHeight - m.el.offsetHeight;
    m.x = Math.round(Math.max(0, Math.min(x, maxX)));
    m.y = Math.round(Math.max(0, Math.min(y, maxY)));
    m.el.style.left = `${m.x}px`;
    m.el.style.top = `${m.y}px`;
  }

  // Lay tray tiles out in rows below the tray line (in their original
  // order) and grow the fridge to fit them.
  function packTray(tiles) {
    const width = fridge.clientWidth;
    let x = PAD;
    let y = POEM_H + PAD;
    const spots = tiles.map((m) => {
      const w = m.el.offsetWidth;
      if (x + w > width - PAD && x > PAD) { x = PAD; y += ROW; }
      const spot = [x, y];
      x += w + GAP;
      return spot;
    });
    fridge.style.height = `${y + ROW + PAD}px`;
    tiles.forEach((m, i) => setPos(m, spots[i][0], spots[i][1]));
  }

  function placeAtCursor(m) {
    const w = m.el.offsetWidth;
    if (cursor.x + w > fridge.clientWidth - PAD) cursor = { x: PAD, y: cursor.y + 48 };
    if (cursor.y > POEM_H - 48) cursor = { x: PAD, y: PAD };
    animated(() => {
      setPos(m, cursor.x, cursor.y);
      packTray(trayTiles());
    });
    cursor.x += w + 8;
    m.el.focus();
    renderPoem();
    announce(`Placed "${m.word}" in the poem. Use arrow keys to move it.`);
  }

  function returnToTray(m) {
    m.y = POEM_H + PAD; // anywhere below the line; packTray tidies it
    animated(() => packTray(trayTiles()));
    m.el.focus();
    renderPoem();
    announce(`Put "${m.word}" back in the tray.`);
  }

  function onMagnetKey(e, m) {
    const step = e.shiftKey ? 32 : 8;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key] && inPoem(m)) {
      e.preventDefault();
      setPos(m, m.x + moves[e.key][0], m.y + moves[e.key][1]);
      renderPoem();
      if (!inPoem(m)) announce(`"${m.word}" moved into the tray.`);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && inPoem(m)) {
      e.preventDefault();
      returnToTray(m);
    }
  }

  // ---- dragging (pointer events: mouse, touch, pen) --------------------

  function startDrag(e, m) {
    if (e.button !== 0) return;
    const el = m.el;
    const start = { x: e.clientX, y: e.clientY };
    let grab = null; // pointer offset inside the magnet once dragging

    const onMove = (ev) => {
      if (!grab) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return;
        const r = el.getBoundingClientRect();
        grab = { x: start.x - r.left, y: start.y - r.top };
        el.classList.add('dragging');
        el.dataset.dragged = '1';
        document.body.classList.add('is-dragging');
      }
      ev.preventDefault();
      const f = fridge.getBoundingClientRect();
      setPos(m, ev.clientX - f.left - grab.x, ev.clientY - f.top - grab.y);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (!grab) return;
      el.classList.remove('dragging');
      document.body.classList.remove('is-dragging');
      renderPoem();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  // ---- poem ------------------------------------------------------------

  function poemText() {
    const placed = state.magnets.filter(inPoem).map((m) => ({
      word: m.word, x: m.x, y: m.y + m.el.offsetHeight / 2,
    }));
    // Classic tiles shrink, so their rows sit closer together.
    return L.readPoem(placed, state.classic ? 6 : 18);
  }

  function renderPoem() {
    $('poem').textContent = poemText() || '(nothing above the tray yet)';
  }

  function clearPoem(silent) {
    leaveClassic();
    cursor = { x: PAD, y: PAD };
    animated(() => packTray(state.magnets));
    renderPoem();
    if (!silent) announce('All words are back in the tray.');
  }

  // Ask the poet for lines, keep only real tiles, and slide them up.
  async function writePoem(intro) {
    const btn = $('write');
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    try {
      leaveClassic();
      setPoemH(POEM_DEFAULT);
      const tiles = state.magnets.map((m) => m.word);
      const raw = await POETS[POET](tiles, rnd());
      const { lines } = L.fitToTiles(raw, tiles);
      const free = new Set(state.magnets);
      const take = (w) => {
        const m = state.magnets.find((t) => t.word === w && free.has(t));
        free.delete(m);
        return m;
      };
      let y = PAD + 8;
      animated(() => {
        // Everything not in the new poem goes back to the tray.
        state.magnets.forEach((m) => { m.y = POEM_H + PAD; });
        lines.forEach((line, i) => {
          let x = PAD + 8 + (i % 2) * 24; // a little stagger, fridge-style
          for (const w of line) {
            const m = take(w);
            if (x + m.el.offsetWidth > fridge.clientWidth - PAD) { x = PAD + 8; y += LINE; }
            setPos(m, x, y);
            x += m.el.offsetWidth + 8;
          }
          y += LINE;
        });
        packTray(trayTiles());
      });
      cursor = { x: PAD, y: Math.min(y, POEM_H - 48) }; // keyboard adds go below it
      renderPoem();
      announce(`${intro || 'New poem'}: ${poemText().replace(/\n/g, ' / ')}`);
    } finally {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    }
  }

  // ---- shapes ----------------------------------------------------------

  const SHAPE_ORDER = Object.keys(L.SHAPES);
  let shapeIndex = 0;
  for (const name of SHAPE_ORDER) {
    $('shape-pick').append(new Option(L.SHAPES[name].label, name));
  }

  // Pour tiles into the next shape: the poet's words first so it reads a
  // little, then the rest of the tray in random order.
  async function shapePoem() {
    leaveClassic();
    setPoemH(SHAPE_H);
    // A picked shape, or "surprise me" walks through them all in turn.
    const name = $('shape-pick').value || SHAPE_ORDER[shapeIndex++ % SHAPE_ORDER.length];
    const tiles = state.magnets.map((m) => m.word);
    const { lines } = L.fitToTiles(await POETS[POET](tiles, rnd()), tiles);
    const free = state.magnets.filter((m) => !m.word.startsWith('-'));
    const ordered = [];
    for (const w of lines.flat()) {
      const i = free.findIndex((m) => m.word === w);
      if (i !== -1) ordered.push(...free.splice(i, 1));
    }
    free.sort(() => Math.random() - 0.5);
    ordered.push(...free);

    const sizes = ordered.map((m) => ({ w: m.el.offsetWidth, h: m.el.offsetHeight }));
    const spots = L.layoutShape(name, sizes, fridge.clientWidth - 2 * PAD, POEM_H - 2 * PAD);
    animated(() => {
      state.magnets.forEach((m) => { m.y = POEM_H + PAD; });
      spots.forEach((p, i) => setPos(ordered[i], PAD + p.x, PAD + p.y));
      packTray(trayTiles());
    });
    cursor = { x: PAD, y: PAD };
    renderPoem();
    showFridgeTop();
    announce(`Shape poem: a ${name} of ${spots.length} words.`);
  }

  // ---- classics --------------------------------------------------------

  // Lay out a public domain shape poem with its own tiles, following the
  // indents from the printed text. The book's tiles wait in the tray.
  function showClassic(name) {
    leaveClassic();
    const c = L.CLASSICS[name];
    const tiles = L.classicTiles(name);
    state.magnets.forEach((m) => { m.y = POEM_H + PAD; });
    const made = tiles.map((t) => {
      const m = makeMagnet(t.word, () => 0.5); // 0.5 → no tilt, easier to read
      m.classic = true;
      m.el.classList.add('classic');
      m.el.style.fontSize = `${t.scale}rem`;
      state.magnets.push(m);
      return { m, t };
    });
    state.classic = name;

    // Indent (in characters) → px, so the widest line still fits.
    const indents = c.lines.map(([i]) => i);
    const minI = Math.min(...indents);
    const maxI = Math.max(...indents);
    const lineW = new Map();
    for (const { m, t } of made) lineW.set(t.line, (lineW.get(t.line) || 0) + m.el.offsetWidth + 4);
    const room = fridge.clientWidth - 2 * PAD - Math.max(...lineW.values());
    const perChar = Math.max(2, Math.min(14, room / (maxI - minI)));

    const spots = [];
    let y = PAD;
    let x = 0;
    let rowH = 0;
    made.forEach(({ m, t }, i) => {
      if (t.first) {
        if (i) y += rowH + 2;
        x = PAD + (t.indent - minI) * perChar;
        rowH = m.el.offsetHeight;
      }
      spots.push([x, y]);
      x += m.el.offsetWidth + 4 * t.scale;
    });
    setPoemH(y + rowH + 2 * PAD);
    animated(() => {
      made.forEach(({ m }, i) => setPos(m, spots[i][0], spots[i][1]));
      packTray(trayTiles());
    });

    const credit = $('poem-credit');
    credit.textContent = '';
    const a = document.createElement('a');
    a.href = `https://archive.org/details/${c.source}`;
    a.textContent = c.title;
    credit.append(a, ` — ${c.credit}`);
    credit.hidden = false;
    renderPoem();
    showFridgeTop();
    announce(`${c.title} by ${c.credit} is on the fridge.`);
  }

  function leaveClassic() {
    if (!state.classic) return;
    state.magnets = state.magnets.filter((m) => {
      if (m.classic) m.el.remove();
      return !m.classic;
    });
    state.classic = null;
    $('poem-credit').hidden = true;
    setPoemH(POEM_DEFAULT);
  }

  // Scatter every tile across the whole fridge, poem area and tray alike.
  function shakeUp() {
    fridge.classList.remove('shaking');
    void fridge.offsetWidth; // restart the wobble animation
    fridge.classList.add('shaking');
    animated(() => {
      for (const m of state.magnets) {
        setPos(m, Math.random() * fridge.clientWidth, Math.random() * fridge.clientHeight);
      }
    });
    cursor = { x: PAD, y: PAD };
    renderPoem();
    const text = poemText();
    announce(text ? `Shook up the fridge. It now reads: ${text.replace(/\n/g, ' / ')}` : 'Shook up the fridge.');
  }

  // ---- search ----------------------------------------------------------

  async function search(q) {
    const results = $('results');
    results.innerHTML = '<li>Searching…</li>';
    const params = new URLSearchParams({
      q: `collection:gutenberg AND (${q})`, rows: '10', output: 'json',
    });
    ['identifier', 'title', 'creator'].forEach((f) => params.append('fl[]', f));
    try {
      const data = await (await fetch(`https://archive.org/advancedsearch.php?${params}`)).json();
      const docs = data.response.docs;
      results.innerHTML = docs.length ? '' : '<li>No matches.</li>';
      for (const d of docs) {
        const li = document.createElement('li');
        li.append(bookCard(d.identifier, [].concat(d.title)[0], [].concat(d.creator || '')[0]));
        results.append(li);
      }
      announce(`${docs.length} results.`);
    } catch (err) {
      results.innerHTML = '<li>Search failed.</li>';
    }
  }

  // Gutenberg items on IA only have a generic icon, so search results get
  // a typeset cover instead, tinted per book so the grid isn't uniform.
  function bookCard(id, title, creator) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'book';
    b.dataset.id = id;
    b.setAttribute('aria-pressed', String(id === state.id));
    const cover = document.createElement('span');
    cover.className = 'typeset-cover';
    cover.setAttribute('aria-hidden', 'true');
    cover.style.setProperty('--hue', [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));
    cover.textContent = title;
    const t = document.createElement('span');
    t.className = 'book-title';
    t.textContent = title;
    const by = document.createElement('span');
    by.className = 'book-by';
    by.textContent = creator || '';
    b.append(cover, t, ' ', by);
    return b;
  }

  // ---- wiring ----------------------------------------------------------

  // One listener for preset and search-result cards alike.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.book');
    if (b) loadBook(b.dataset.id);
  });
  $('new-words').addEventListener('click', () => { if (state.text) dealWords(); });
  $('write').addEventListener('click', () => { if (state.magnets.length) writePoem(); });
  $('shape').addEventListener('click', () => { if (state.magnets.length) shapePoem(); });
  $('shape-pick').addEventListener('change', () => {
    if (state.magnets.length && $('shape-pick').value) shapePoem();
  });
  document.querySelectorAll('.classic-btn').forEach((b) => {
    b.addEventListener('click', () => { if (state.magnets.length) showClassic(b.dataset.classic); });
  });
  $('shake').addEventListener('click', () => { if (state.magnets.length) shakeUp(); });
  $('clear').addEventListener('click', () => clearPoem(false));
  $('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('q').value.trim();
    if (q) search(q);
  });
  $('copy').addEventListener('click', async () => {
    const c = state.classic && L.CLASSICS[state.classic];
    const credit = c
      ? `\n\n— ${c.title}, ${c.credit}\nhttps://archive.org/details/${c.source}`
      : `\n\n— words from ${state.title}${state.creator ? ` by ${state.creator}` : ''}\nhttps://archive.org/details/${state.id}`;
    try {
      await navigator.clipboard.writeText(poemText() + credit);
      announce('Poem copied.');
    } catch (err) {
      announce('Copy failed; select the poem text instead.');
    }
  });
  window.addEventListener('resize', () => {
    packTray(trayTiles());
    for (const m of state.magnets) if (inPoem(m)) setPos(m, m.x, m.y);
    renderPoem();
  });

  const params = new URLSearchParams(location.search);
  const startId = params.get('book') || document.querySelector('.book').dataset.id;
  loadBook(startId, Number(params.get('seed')) || undefined);
})();
