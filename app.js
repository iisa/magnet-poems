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
    // Collapse the picker and show this book's cover in the banner.
    $('picker').open = false;
    const card = document.querySelector(`.book[data-id="${CSS.escape(id)}"][data-cover]`);
    showCover(card && card.dataset.cover);
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
        collection: shelfFor([].concat(m.collection || [])),
      });
      // A scan is its own cover (Gutenberg items only have a generic icon).
      if (!card && state.isOcr) showCover(id);
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
    renderStats();
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

    // Which IA collection it's from, linked, so the data leads back there.
    const col = $('collection');
    col.textContent = '';
    col.hidden = !state.collection;
    if (state.collection) {
      const c = document.createElement('a');
      c.href = `https://archive.org/details/${encodeURIComponent(state.collection.collection)}`;
      c.textContent = state.collection.fullTitle;
      col.append('in the ', c, state.collection.from ? ` · ${state.collection.from}` : '');
    }
  }

  // "212,483 words · 17,104 different · 161 magnets on this fridge"
  function renderStats() {
    const n = (x) => x.toLocaleString();
    const { total, unique } = L.bookStats(state.text);
    const tiles = state.magnets.filter((m) => !m.classic).length;
    $('stats').textContent = `${n(total)} words · ${n(unique)} different · ${n(tiles)} magnets on this fridge`;
  }

  function showCover(id) {
    const thumb = $('current-cover');
    thumb.hidden = !id;
    if (id) thumb.src = `https://archive.org/services/img/${encodeURIComponent(id)}`;
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
    setPoemTitle('');
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
      const tiles = state.magnets.map((m) => m.word);
      const raw = await POETS[POET](tiles, rnd());
      showPoem(L.fitToTiles(raw, tiles).lines, '', intro);
    } finally {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    }
  }

  // Put lines of words on the fridge as a fresh poem (everything else goes
  // back to the tray), or below the current poem when adding to it.
  function showPoem(lines, title, intro, { append = false } = {}) {
    if (!append) {
      leaveClassic();
      setPoemH(POEM_DEFAULT);
    }
    const kept = append ? state.magnets.filter(inPoem) : [];
    const free = new Set(state.magnets.filter((m) => !kept.includes(m) && !m.classic));
    const take = (w) => {
      const m = [...free].find((t) => t.word === w);
      free.delete(m);
      return m;
    };
    let y = kept.length ? Math.max(...kept.map((m) => m.y)) + LINE : PAD + 8;
    // Room for the new lines (wrapping can add a few): grow the poem area if needed.
    const need = y + (lines.length + 2) * LINE;
    if (need > POEM_H) setPoemH(need);
    animated(() => {
      if (!append) state.magnets.forEach((m) => { m.y = POEM_H + PAD; });
      lines.forEach((line, i) => {
        let x = PAD + 8 + (i % 2) * 24; // a little stagger, fridge-style
        for (const w of line) {
          const m = take(w);
          if (!m) continue;
          if (x + m.el.offsetWidth > fridge.clientWidth - PAD) { x = PAD + 8; y += LINE; }
          setPos(m, x, y);
          x += m.el.offsetWidth + 8;
        }
        y += LINE;
      });
      packTray(trayTiles());
    });
    cursor = { x: PAD, y: Math.min(y, POEM_H - 48) }; // keyboard adds go below it
    if (!append || title) setPoemTitle(title);
    renderPoem();
    announce(`${intro || 'New poem'}: ${poemText().replace(/\n/g, ' / ')}`);
  }

  function setPoemTitle(title) {
    state.poemTitle = title || '';
    $('poem-title').textContent = state.poemTitle;
    $('poem-title').hidden = !state.poemTitle;
  }

  // ---- AI poet: Chrome's built-in model (optional) -----------------------
  //
  // Progressive enhancement: the AI buttons only appear when the browser
  // has Chrome's Prompt API and the device can run it. The model answers
  // with tile numbers (JSON schema), so it can only use real tiles.

  const AI_OPTS = {
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
  };
  let aiState = 'unavailable'; // 'available' | 'downloadable' | 'downloading' | 'unavailable'

  async function setupAI() {
    if (!('LanguageModel' in self)) return;
    try {
      aiState = await LanguageModel.availability(AI_OPTS);
    } catch (err) {
      return;
    }
    if (aiState === 'unavailable') return;
    for (const [key, s] of Object.entries(L.POEM_STYLES)) $('ai-style').append(new Option(s.label, key));
    $('ai-tools').hidden = false;
    updateAiUi();
    if (aiState === 'downloading') {
      // Started earlier (another visit or tab). Showing % needs a click,
      // but checking whether it's done doesn't.
      setAiStatus('Chrome’s AI is still downloading. Click Get the AI poet ready to see progress.');
      watchDownload();
    }
  }

  function updateAiUi() {
    const ready = aiState === 'available';
    $('ai-ready').hidden = ready;
    if (ready) setAiStatus('');
    else if (aiState === 'downloadable') setAiStatus('✨ uses Chrome’s built-in AI: a one-time download of a few GB');
  }

  // Check every few seconds (a local browser call, no network) until the
  // model is ready.
  let watchTimer = null;
  function watchDownload() {
    if (watchTimer) return;
    watchTimer = setInterval(async () => {
      try {
        aiState = await LanguageModel.availability(AI_OPTS);
      } catch (err) {
        return;
      }
      if (aiState === 'available') {
        clearInterval(watchTimer);
        watchTimer = null;
        updateAiUi();
        setAiStatus('✨ AI poet ready');
        announce('Chrome’s AI poet is ready.');
      }
    }, 5000);
  }

  function aiMonitor(m) {
    m.addEventListener('downloadprogress', (e) => {
      setAiStatus(`Downloading Chrome’s AI… ${Math.round(e.loaded * 100)}%`);
    });
  }

  // Start (or resume watching) the one-time model download without
  // writing a poem, so it's ready by the time someone wants one.
  async function prepareAI() {
    const btn = $('ai-ready');
    btn.disabled = true;
    try {
      setAiStatus('Starting Chrome’s AI download…');
      aiState = 'downloading';
      watchDownload();
      const session = await LanguageModel.create({ ...AI_OPTS, monitor: aiMonitor });
      session.destroy();
      aiState = 'available';
      updateAiUi();
      setAiStatus('✨ AI poet ready');
      announce('Chrome’s AI poet is ready.');
    } catch (err) {
      console.warn('AI download:', err);
      setAiStatus('Chrome couldn’t download its AI just now. Check your connection and free disk space, then try again.');
    } finally {
      btn.disabled = false;
    }
  }

  // Chrome's model window can be small (1,000 tokens on some machines), so
  // offer as many tiles as fit: measure, and halve the gap until it does.
  // Leaves room for the JSON answer. Handles the older and newer names
  // for the window/measure API.
  const ANSWER_ROOM = 250;
  async function fitPrompt(session, words, poem) {
    const size = session.contextWindow ?? session.inputQuota;
    const used = session.contextUsage ?? session.inputUsage ?? 0;
    const measure = (session.measureContextUsage || session.measureInputUsage);
    const order = L.poetTileOrder(words, rnd());
    const build = (n) => {
      const tiles = order.slice(0, n).map((i) => words[i]);
      return { tiles, prompt: L.poetPrompt({ tiles, style: $('ai-style').value, book: state.title, poem }) };
    };
    if (!size || !measure) return build(words.length);
    // The JSON schema gets added to the input too, so measure with it.
    const fits = async (n) => used +
      await measure.call(session, build(n).prompt, { responseConstraint: L.POEM_SCHEMA }) + ANSWER_ROOM <= size;
    if (await fits(words.length)) return build(words.length);
    let lo = 0;
    let hi = words.length;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (await fits(mid)) lo = mid; else hi = mid;
    }
    if (lo < 12) throw new Error(`model window too small (${size} tokens)`);
    return build(lo);
  }

  function setAiStatus(text) { $('ai-status').textContent = text; }

  // Ask Chrome's model for a poem. finish: continue what's on the fridge
  // using only tray tiles.
  async function aiPoem(finish) {
    const buttons = [$('ai-write'), $('ai-finish')];
    buttons.forEach((b) => { b.disabled = true; b.setAttribute('aria-busy', 'true'); });
    let session;
    try {
      const poem = finish ? poemText() : '';
      if (finish && !poem) {
        announce('Put some words above the line first, then ask the AI to finish them.');
        return;
      }
      // create() first, inside the click, since a first download needs a user gesture.
      session = await LanguageModel.create({
        ...AI_OPTS,
        initialPrompts: [{ role: 'system', content: L.POET_SYSTEM }],
        monitor: aiMonitor,
      });
      aiState = 'available';
      updateAiUi();
      setAiStatus('Thinking…');
      const pool = finish ? trayTiles().filter((m) => !m.classic) : state.magnets.filter((m) => !m.classic);
      const { tiles, prompt } = await fitPrompt(session, pool.map((m) => m.word), poem);
      const reply = await session.prompt(prompt, { responseConstraint: L.POEM_SCHEMA });
      // Some Chromium builds ship the API without a model; it just echoes.
      if (/echoing back the input/.test(reply)) {
        setAiStatus('This browser has the AI API but no model. Try the AI poet in Google Chrome on a desktop.');
        return;
      }
      const { title, lines } = L.linesFromIndices(JSON.parse(reply), tiles);
      if (!lines.length) throw new Error('The AI didn’t use any tiles.');
      setAiStatus('');
      showPoem(lines, title, finish ? 'The AI added' : 'AI poem', { append: finish });
      if (!finish) showFridgeTop();
    } catch (err) {
      console.warn('AI poet:', err);
      setAiStatus('The AI poet got muddled on that one. Try again, or use Write me a poem.');
    } finally {
      if (session && session.destroy) session.destroy();
      buttons.forEach((b) => { b.disabled = false; b.removeAttribute('aria-busy'); });
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
    setPoemTitle('');
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
    setPoemTitle('');
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

  // ---- shelves: books grouped by IA collection ---------------------------
  //
  // Each shelf is an archive.org collection. Its favorites are hand-picked;
  // "More from this collection" pulls live from IA, limited to texts with
  // OCR dated 1930 or earlier (public domain in the US).

  const SHELVES = [
    {
      collection: 'gutenberg',
      title: '📖 Project Gutenberg',
      fullTitle: 'Project Gutenberg collection',
      blurb: 'Clean texts of the classics. Covers are early editions scanned by libraries.',
      // id: where the words come from; cover: a library scan of an early edition.
      books: [
        { id: 'poemsbyemilydick02678gut', cover: 'poemssucc00dickrich', title: 'Poems', by: 'Emily Dickinson' },
        { id: 'leavesofgrass01322gut', cover: 'leavesofgrass00inwhit', title: 'Leaves of Grass', by: 'Walt Whitman' },
        { id: 'mobydickorthewha02701gut', cover: 'mobydickorwhale01melv', title: 'Moby-Dick', by: 'Herman Melville' },
        { id: 'frankenstein00084gut', cover: 'cu31924105428902', title: 'Frankenstein', by: 'Mary Shelley' },
        { id: 'alicesadventures00011gut', cover: 'alicesadventures1901carr', title: "Alice's Adventures in Wonderland", by: 'Lewis Carroll' },
      ],
      search: true, // Gutenberg has no years on most items, so it gets search instead of "more"
    },
    {
      collection: 'usda-nurseryandseedcatalog',
      title: '🌱 Seed catalogs',
      fullTitle: 'Henry G. Gilbert Nursery and Seed Trade Catalog Collection',
      from: 'USDA National Agricultural Library',
      blurb: 'Garden catalogs full of strange plant names. Scanned, so expect a few odd words.',
      books: [
        { id: 'alneerbrothersil00alne', title: 'Alneer Brothers illustrated catalogue', by: '1896' },
        { id: 'gardengreenhouse18pete', title: 'Garden & greenhouse guide', by: 'Peter Henderson & Co., 1892' },
        { id: 'CAT31289649', title: "Thorburn's seeds", by: '1908' },
        { id: 'dreersgardencale1884henr', title: "Dreer's garden calendar", by: '1884' },
        { id: 'curriesfarmgarde19curr_1', title: "Currie's farm & garden annual", by: '1918' },
      ],
    },
    {
      collection: 'juvenilehistoricalcollection',
      title: "🧒 Children's books",
      fullTitle: 'Juvenile Historical Collection',
      from: 'UNC Chapel Hill',
      blurb: "Illustrated children's books from the 1800s and early 1900s.",
      books: [
        { id: 'storyofrobinhood00chic', title: 'The story of Robin Hood', by: '1890' },
        { id: 'realmothergoosewrig', title: 'The real Mother Goose', by: '1916' },
        { id: 'junglebookkipl', title: 'The jungle book', by: 'Rudyard Kipling, 1894' },
        { id: 'windinwillowsgrah', title: 'The wind in the willows', by: 'Kenneth Grahame, 1913' },
        { id: 'alicesadventures1901carr', title: "Alice's adventures in Wonderland", by: 'Lewis Carroll, 1901' },
      ],
    },
    {
      collection: 'duke_libraries',
      title: '📚 Duke University Libraries',
      fullTitle: 'Duke University Libraries collection',
      blurb: 'Poetry and fiction from Duke’s scanned collections.',
      books: [
        { id: 'smokygodorvoyage00emer', title: 'The smoky god', by: 'Willis George Emerson, 1908' },
        { id: 'whensleeperwakes00well', title: 'When the sleeper wakes', by: 'H. G. Wells, 1899' },
        { id: 'songspoemsofgrea00tull', title: 'Songs and poems of the great world war', by: '1915' },
        { id: 'acrosszodiacstor01greg', title: 'Across the zodiac', by: 'Percy Greg, 1880' },
      ],
      moreQuery: 'subject:(poetry OR fiction OR poems)', // keep the big shelf on-theme
    },
  ];

  // The shelf an item belongs to, from its metadata's collection list.
  function shelfFor(collections) {
    return SHELVES.find((sh) => collections.includes(sh.collection)) || null;
  }

  function renderShelves() {
    const root = $('shelves');
    for (const sh of SHELVES) {
      const sec = document.createElement('section');
      sec.className = 'shelf';
      const h = document.createElement('h3');
      h.textContent = sh.title + ' ';
      const link = document.createElement('a');
      link.href = `https://archive.org/details/${sh.collection}`;
      link.className = 'shelf-link';
      link.textContent = 'see the collection on archive.org';
      h.append(link);
      const p = document.createElement('p');
      p.className = 'help';
      p.textContent = sh.blurb;
      const ul = document.createElement('ul');
      ul.className = 'books';
      ul.setAttribute('aria-label', sh.fullTitle);
      for (const bk of sh.books) {
        const li = document.createElement('li');
        li.append(bookCard(bk.id, bk.title, bk.by, bk.cover || bk.id));
        ul.append(li);
      }
      sec.append(h, p, ul);
      if (sh.search) {
        sec.append($('search-form'), $('results'));
      } else {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'more';
        more.textContent = 'More from this collection';
        let page = 1;
        more.addEventListener('click', async () => {
          more.disabled = true;
          const added = await loadMore(sh, ul, ++page);
          more.disabled = false;
          if (!added) more.hidden = true;
        });
        sec.append(more);
      }
      root.append(sec);
    }
  }

  // Next page of the collection, most-downloaded first, skipping books
  // already on the shelf. Returns how many were added.
  async function loadMore(sh, ul, page) {
    const q = [
      `collection:${sh.collection}`, 'mediatype:texts', 'year:[1500 TO 1930]', 'format:"DjVuTXT"',
      sh.moreQuery,
    ].filter(Boolean).join(' AND ');
    const params = new URLSearchParams({ q, rows: '10', page: String(page - 1), output: 'json' });
    params.append('sort[]', 'downloads desc');
    ['identifier', 'title', 'creator', 'year'].forEach((f) => params.append('fl[]', f));
    try {
      const data = await (await fetch(`https://archive.org/advancedsearch.php?${params}`)).json();
      const shown = new Set([...ul.querySelectorAll('.book')].map((b) => b.dataset.id));
      const docs = data.response.docs.filter((d) => !shown.has(d.identifier));
      for (const d of docs) {
        const li = document.createElement('li');
        const by = [[].concat(d.creator || '')[0], d.year].filter(Boolean).join(', ');
        li.append(bookCard(d.identifier, [].concat(d.title)[0], by, d.identifier));
        ul.append(li);
      }
      announce(`${docs.length} more from ${sh.fullTitle}.`);
      return docs.length;
    } catch (err) {
      announce('Could not load more from that collection.');
      return 0;
    }
  }

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

  // A book card. With a cover id it shows that item's IA thumbnail;
  // without one (Gutenberg search results) a typeset cover, tinted per book.
  function bookCard(id, title, by, cover) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'book';
    b.dataset.id = id;
    b.setAttribute('aria-pressed', String(id === state.id));
    let art;
    if (cover) {
      b.dataset.cover = cover;
      art = document.createElement('img');
      art.src = `https://archive.org/services/img/${encodeURIComponent(cover)}`;
      art.alt = '';
      art.loading = 'lazy';
    } else {
      art = document.createElement('span');
      art.className = 'typeset-cover';
      art.setAttribute('aria-hidden', 'true');
      art.style.setProperty('--hue', [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));
      art.textContent = title;
    }
    const t = document.createElement('span');
    t.className = 'book-title';
    t.textContent = title;
    const byEl = document.createElement('span');
    byEl.className = 'book-by';
    byEl.textContent = by || '';
    b.append(art, t, ' ', byEl);
    return b;
  }

  // ---- wiring ----------------------------------------------------------

  renderShelves();
  setupAI();

  // One listener for every book card: favorites, "more", and search.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.book');
    if (b) loadBook(b.dataset.id);
  });
  $('new-words').addEventListener('click', () => { if (state.text) dealWords(); });
  $('write').addEventListener('click', () => { if (state.magnets.length) writePoem(); });
  $('ai-write').addEventListener('click', () => { if (state.magnets.length) aiPoem(false); });
  $('ai-ready').addEventListener('click', prepareAI);
  $('ai-finish').addEventListener('click', () => { if (state.magnets.length) aiPoem(true); });
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
    const head = state.poemTitle ? `${state.poemTitle}\n\n` : '';
    const c = state.classic && L.CLASSICS[state.classic];
    const credit = c
      ? `\n\n— ${c.title}, ${c.credit}\nhttps://archive.org/details/${c.source}`
      : `\n\n— words from ${state.title}${state.creator ? ` by ${state.creator}` : ''}\nhttps://archive.org/details/${state.id}`;
    try {
      await navigator.clipboard.writeText(head + poemText() + credit);
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
