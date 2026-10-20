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

  const POEM_H = 320; // height of the writing area above the tray
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
    magnets: [], // { word, el, x, y }
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

  // ---- loading ---------------------------------------------------------

  async function loadBook(id, seed) {
    $('source').textContent = 'Loading…';
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
    announce(`${state.magnets.length} words from ${state.title} are in the tray at the bottom of the fridge.`);
  }

  function renderSource() {
    const src = $('source');
    src.textContent = 'Words from ';
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
    return L.readPoem(placed, 18);
  }

  function renderPoem() {
    $('poem').textContent = poemText() || '(nothing above the tray yet)';
  }

  function clearPoem(silent) {
    cursor = { x: PAD, y: PAD };
    animated(() => packTray(state.magnets));
    renderPoem();
    if (!silent) announce('All words are back in the tray.');
  }

  // Ask the poet for lines, keep only real tiles, and slide them up.
  async function writePoem() {
    const btn = $('write');
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    try {
      const tiles = state.magnets.map((m) => m.word);
      const raw = await POETS[POET](tiles, Math.floor(Math.random() * 1e9));
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
      announce(`New poem: ${poemText().replace(/\n/g, ' / ')}`);
    } finally {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    }
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
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = [].concat(d.title)[0] + (d.creator ? ` (${[].concat(d.creator)[0]})` : '');
        b.addEventListener('click', () => { results.innerHTML = ''; loadBook(d.identifier); });
        li.append(b);
        results.append(li);
      }
      announce(`${docs.length} results.`);
    } catch (err) {
      results.innerHTML = '<li>Search failed.</li>';
    }
  }

  // ---- wiring ----------------------------------------------------------

  $('book-form').addEventListener('submit', (e) => { e.preventDefault(); loadBook($('book').value); });
  $('new-words').addEventListener('click', () => { if (state.text) dealWords(); });
  $('write').addEventListener('click', () => { if (state.magnets.length) writePoem(); });
  $('shake').addEventListener('click', () => { if (state.magnets.length) shakeUp(); });
  $('clear').addEventListener('click', () => clearPoem(false));
  $('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('q').value.trim();
    if (q) search(q);
  });
  $('copy').addEventListener('click', async () => {
    const credit = `\n\n— words from ${state.title}${state.creator ? ` by ${state.creator}` : ''}\nhttps://archive.org/details/${state.id}`;
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
  const startId = params.get('book') || $('book').value;
  if ([...$('book').options].some((o) => o.value === startId)) $('book').value = startId;
  loadBook(startId, Number(params.get('seed')) || undefined);
})();
