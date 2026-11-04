/* CAT Prep – topic-wise past-paper practice.
   Plain JS, no build step. Data comes from data/questions.json and the page
   images in img/pages/. Progress lives in localStorage (export/import in Settings). */
'use strict';

const DATA_URL = 'data/questions.json';
const PAGE_IMG = p => `img/pages/p-${String(p).padStart(3, '0')}.webp`;
const STORE_KEY = 'catprep.progress.v1';
const SETTINGS_KEY = 'catprep.settings.v1';
const MARKS = { correct: 3, wrongMCQ: -1, wrongTITA: 0 };

const S = {
  data: null, byId: new Map(), chapterQs: new Map(),
  progress: load(STORE_KEY, { attempts: {}, bookmarks: {}, last: null }),
  settings: load(SETTINGS_KEY, { apiKey: '', model: 'claude-opus-5-5', panelW: 400, panelOpen: false }),
  filters: {}, timer: null, chats: {}, q: null,
};

function load(k, d) { try { return Object.assign(d, JSON.parse(localStorage.getItem(k) || '{}')); } catch (e) { return d; } }
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(S.progress)); }
function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S.settings)); }
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = s => { s = Math.round(s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const $ = sel => document.querySelector(sel);
const app = () => $('#app');

/* ---------- data ---------- */
async function init() {
  S.data = await (await fetch(DATA_URL)).json();
  for (const q of S.data.questions) {
    S.byId.set(q.id, q);
    if (!S.chapterQs.has(q.ch)) S.chapterQs.set(q.ch, []);
    S.chapterQs.get(q.ch).push(q);
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', () => { if (document.hidden && S.timer && S.timer.running) pauseTimer(true); });
  initPanel();
  route();
}

const chapter = id => S.data.chapters.find(c => c.id === id);
const attempt = qid => S.progress.attempts[qid];
const negMark = q => q.type === 'MCQ';

function stats(qs) {
  const st = { total: qs.length, attempted: 0, correct: 0, wrong: 0, unmarked: 0, time: 0, score: 0 };
  for (const q of qs) {
    const a = attempt(q.id); if (!a) continue;
    st.attempted++; st.time += a.time || 0;
    if (a.result === 'correct') { st.correct++; st.score += MARKS.correct; }
    else if (a.result === 'wrong') { st.wrong++; st.score += negMark(q) ? MARKS.wrongMCQ : MARKS.wrongTITA; }
    else st.unmarked++;
  }
  return st;
}
const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
const accuracy = st => st.correct + st.wrong ? pct(st.correct, st.correct + st.wrong) + '%' : null;

/* ---------- routing ---------- */
function route() {
  stopTimer();
  S.q = null;
  const h = location.hash || '#/';
  const m = h.match(/^#\/(ch|q)\/([^/?]+)/);
  document.body.classList.toggle('route-q', !!(m && m[1] === 'q'));
  $('#ai-toggle').hidden = !(m && m[1] === 'q');
  if (!(m && m[1] === 'q')) closePanel(true);
  if (h.startsWith('#/settings')) renderSettings();
  else if (m && m[1] === 'ch') renderChapter(m[2]);
  else if (m && m[1] === 'q') renderQuestion(m[2]);
  else renderDashboard();
  window.scrollTo(0, 0);
}

/* ---------- dashboard ---------- */
function renderDashboard() {
  const all = stats(S.data.questions);
  const last = S.progress.last && S.byId.get(S.progress.last);
  let html = `<div class="hero">
    <h1>CAT Prep</h1>
    <p class="lead">Face 2 Face CAT · 1993–2019 · ${all.total.toLocaleString()} questions</p>
    <div class="stats">
      <div class="stat"><b>${all.attempted}</b><span>attempted</span></div>
      <div class="stat"><b>${accuracy(all) || '–'}</b><span>accuracy</span></div>
      <div class="stat"><b>${all.score > 0 ? '+' : ''}${all.score}</b><span>net score</span></div>
      <div class="stat"><b>${fmtTime(all.time)}</b><span>time</span></div>
    </div>
    ${last ? `<a class="resume" href="#/q/${last.id}">Resume · ${esc(chapter(last.ch).title)} Q${last.n}</a>` : ''}
  </div>`;
  for (const [sec, name] of Object.entries(S.data.sections)) {
    const chs = S.data.chapters.filter(c => c.section === sec);
    const ss = stats(chs.flatMap(c => S.chapterQs.get(c.id) || []));
    html += `<div class="sec-head"><h2>${esc(name)}</h2><span>${ss.attempted} / ${ss.total}${accuracy(ss) ? ' · ' + accuracy(ss) : ''}</span></div><div class="rows">`;
    for (const c of chs) {
      const cs = stats(S.chapterQs.get(c.id) || []);
      html += `<a class="row" href="#/ch/${c.id}"><span class="n">${c.num}</span><span class="t">${esc(c.title)}${bar(cs)}</span><span class="r">${cs.attempted} / ${cs.total}</span></a>`;
    }
    html += `</div>`;
  }
  app().innerHTML = html;
}
function bar(st) {
  const p = n => st.total ? (100 * n / st.total) + '%' : '0%';
  return `<span class="bar"><i class="c" style="width:${p(st.correct)}"></i><i class="w" style="width:${p(st.wrong)}"></i><i class="u" style="width:${p(st.unmarked)}"></i></span>`;
}

/* ---------- chapter ---------- */
function renderChapter(chId) {
  const c = chapter(chId); if (!c) return renderDashboard();
  const qs = S.chapterQs.get(chId) || [];
  const f = S.filters[chId] || (S.filters[chId] = { year: 'all', status: 'all', sub: 'all' });
  const years = [...new Set(qs.map(q => q.year).filter(Boolean))].sort((a, b) => b - a);
  const list = qs.filter(q => (f.year === 'all' || String(q.year) === f.year)
    && (f.sub === 'all' || q.sub === f.sub) && matchStatus(q, f.status));
  const cs = stats(qs);
  const first = list.find(q => !attempt(q.id)) || list[0];
  let html = `<a class="back" href="#/">Dashboard</a>
  <h1>${esc(c.title)}</h1>
  <p class="lead">${cs.total} questions · ${cs.attempted} attempted${accuracy(cs) ? ' · ' + accuracy(cs) : ''}${cs.time ? ' · ' + fmtTime(cs.time) : ''}</p>
  <div class="years"><a class="${f.year === 'all' ? 'on' : ''}" data-year="all">All years</a>${years.map(y => `<a class="${f.year === String(y) ? 'on' : ''}" data-year="${y}">${y}</a>`).join('')}</div>
  <div class="tools">
    <span>
      <select class="quiet" data-status><option value="all">All questions</option><option value="new">Not attempted</option><option value="correct">Correct</option><option value="wrong">Wrong</option><option value="unmarked">Unmarked</option><option value="bookmarked">Bookmarked</option></select>
      ${c.subtopics.length ? ` <select class="quiet" data-sub><option value="all">All topics</option>${c.subtopics.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select>` : ''}
    </span>
    ${first ? `<a class="btn primary" href="#/q/${first.id}">Start</a>` : ''}
  </div><div class="rows">`;
  for (const q of list) {
    const a = attempt(q.id);
    html += `<a class="row qrow" href="#/q/${q.id}">
      <span class="n">${q.n}</span>
      <span class="t"><span class="dot ${a ? a.result : ''}"></span>${q.year ? 'CAT ' + q.year : '<span class="muted">year not stated</span>'}${q.sub ? ' · ' + esc(q.sub) : ''}${S.progress.bookmarks[q.id] ? ' ★' : ''}</span>
      <span class="meta">${q.type}</span>
      <span class="r">${a ? fmtTime(a.time) : ''}</span></a>`;
  }
  html += `</div>${list.length ? '' : '<p class="muted small">Nothing matches these filters.</p>'}`;
  app().innerHTML = html;
  $('[data-status]').value = f.status;
  if ($('[data-sub]')) $('[data-sub]').value = f.sub;
  app().querySelectorAll('[data-year]').forEach(el => el.onclick = () => { f.year = el.dataset.year; renderChapter(chId); });
  $('[data-status]').onchange = e => { f.status = e.target.value; renderChapter(chId); };
  if ($('[data-sub]')) $('[data-sub]').onchange = e => { f.sub = e.target.value; renderChapter(chId); };
}
function matchStatus(q, st) {
  if (st === 'all') return true;
  if (st === 'bookmarked') return !!S.progress.bookmarks[q.id];
  const a = attempt(q.id);
  return st === 'new' ? !a : (a && a.result === st);
}

/* ---------- question ---------- */
function cropSVG(r) {
  const [p, x0, y0, x1, y1] = r; const w = x1 - x0, h = y1 - y0;
  const [PW, PH] = S.data.pageSize;
  const width = `clamp(${Math.round(w)}px, 100%, ${Math.round(w * 2.1)}px)`;
  return `<svg class="crop" viewBox="${x0} ${y0} ${w} ${h}" style="aspect-ratio:${w}/${h};width:${width}" preserveAspectRatio="xMinYMin meet"><image href="${PAGE_IMG(p)}" x="0" y="0" width="${PW}" height="${PH}"/></svg>`;
}
const crops = rects => `<div class="crops">${rects.map(cropSVG).join('')}</div>`;
function siblings(q) {
  const qs = S.chapterQs.get(q.ch); const i = qs.indexOf(q);
  return { prev: qs[i - 1], next: qs[i + 1], i, n: qs.length };
}

function renderQuestion(qid) {
  const q = S.byId.get(qid); if (!q) return renderDashboard();
  S.q = q;
  const c = chapter(q.ch), a = attempt(qid);
  const d = q.dir && S.data.directions[q.dir];
  const { prev, next } = siblings(q);
  S.progress.last = qid; save();
  app().innerHTML = `<a class="back" href="#/ch/${c.id}">${esc(c.title)}</a>
  <div class="qtop">
    <div>
      <h1>Q${q.n}</h1>
      <div class="qmeta"><b>${q.year ? 'CAT ' + q.year : 'Year not stated'}</b> · ${q.type === 'MCQ' ? 'MCQ' : 'TITA, type the answer'} · <span class="${negMark(q) ? 'neg' : 'noneg'}">${negMark(q) ? '+3 / −1' : '+3 / no negative'}</span>${q.sub ? ' · ' + esc(q.sub) : ''} · <a data-bm>${S.progress.bookmarks[qid] ? '★ bookmarked' : '☆ bookmark'}</a></div>
    </div>
    <div class="timer" id="timer"><span id="clock">0:00</span><button class="btn quiet" data-pause>Pause</button></div>
  </div>
  ${d ? `<div class="card" id="dir"><div class="label"><span>${d.range ? `Directions · Q${d.range[0]}–${d.range[1]}` : 'Directions'}</span><button class="icon small" data-toggle="dir">Hide</button></div>${crops(d.rects)}</div>` : ''}
  <div class="card">${crops(q.rects)}</div>
  <div class="answer" id="answer">${answerHTML(q, a)}</div>
  <div id="after">${a ? afterHTML(q, a) : ''}</div>
  <div class="pager">
    <span>${prev ? `<a href="#/q/${prev.id}">← Q${prev.n}</a>` : ''}</span>
    <span>${next ? `<a href="#/q/${next.id}">Q${next.n} →</a>` : `<a href="#/ch/${c.id}">Back to chapter</a>`}</span>
  </div>`;
  $('[data-bm]').onclick = () => { S.progress.bookmarks[qid] = !S.progress.bookmarks[qid]; save(); $('[data-bm]').textContent = S.progress.bookmarks[qid] ? '★ bookmarked' : '☆ bookmark'; };
  $('[data-pause]').onclick = () => S.timer.running ? pauseTimer() : resumeTimer();
  const tg = $('[data-toggle="dir"]');
  if (tg) tg.onclick = () => { const el = $('#dir'); el.classList.toggle('collapsed'); tg.textContent = el.classList.contains('collapsed') ? 'Show' : 'Hide'; };
  bindAnswer(q);
  if (a) finishTimerDisplay(a); else startTimer();
  panelForQuestion(q);
  if (S.settings.panelOpen && window.innerWidth > 760) openPanel();
}

function answerHTML(q, a) {
  const letters = ['a', 'b', 'c', 'd'];
  if (a) {
    if (q.type === 'MCQ' && q.opts) return `<div class="opts">${letters.map(o => `<button class="opt ${o === q.ans ? 'ok' : o === a.ans ? (a.result === 'wrong' ? 'bad' : 'sel') : ''}" disabled>${o}</button>`).join('')}</div>`;
    return `<p class="small muted">Your answer: <b>${esc(a.ans) || '—'}</b>${q.ans ? ` · key: <b>${esc(q.ans)}</b>` : ''}</p>`;
  }
  const actions = `<div class="actions"><button class="btn primary" data-submit disabled>Submit</button><button class="btn quiet" data-skip>Skip, show solution</button></div>`;
  if (q.type === 'MCQ' && q.opts) return `<div class="opts">${letters.map(o => `<button class="opt" data-opt="${o}">${o}</button>`).join('')}</div>${actions}`;
  return `<div class="tita"><input type="text" data-tita placeholder="${q.type === 'MCQ' ? 'Option letter a–d (options are in the directions)' : 'Your answer'}" autocomplete="off"></div>${actions}`;
}

function bindAnswer(q) {
  const sub = $('[data-submit]'); S._pick = S._submit = null;
  if (!sub) return;
  let picked = null;
  app().querySelectorAll('[data-opt]').forEach(b => b.onclick = () => {
    picked = b.dataset.opt;
    app().querySelectorAll('[data-opt]').forEach(x => x.classList.toggle('sel', x === b));
    sub.disabled = false;
  });
  const inp = $('[data-tita]');
  if (inp) { inp.focus(); inp.oninput = () => { picked = inp.value.trim(); sub.disabled = !picked; }; }
  sub.onclick = () => submit(q, picked);
  $('[data-skip]').onclick = () => submit(q, null);
  S._pick = o => { const b = app().querySelector(`[data-opt="${o}"]`); if (b) b.click(); };
  S._submit = () => { if (!sub.disabled) sub.click(); };
}

function grade(q, ans) {
  if (ans === null || ans === undefined || ans === '') return 'wrong';
  if (!q.ans) return 'unmarked';
  const norm = s => String(s).trim().toLowerCase().replace(/^\(|\)$/g, '').replace(/,/g, '');
  return norm(ans) === norm(q.ans) ? 'correct' : 'wrong';
}

function submit(q, ans) {
  const t = stopTimer();
  const prevA = attempt(q.id);
  const a = { ans: ans || '', result: ans === null ? 'wrong' : grade(q, ans), time: t, at: Date.now(), n: (prevA ? prevA.n : 0) + 1, skipped: ans === null };
  S.progress.attempts[q.id] = a; save();
  $('#answer').innerHTML = answerHTML(q, a);
  $('#after').innerHTML = afterHTML(q, a);
  bindAfter(q, a);
  finishTimerDisplay(a);
  S._pick = S._submit = null;
  panelForQuestion(q);
}

function finishTimerDisplay(a) {
  $('#timer').classList.add('paused'); $('#clock').textContent = fmtTime(a.time); $('[data-pause]').style.display = 'none';
}

function afterHTML(q, a) {
  const g = q.solgrp && S.data.solgroups[q.solgrp];
  const r = a.result;
  const label = a.skipped ? 'Skipped' : r === 'correct' ? 'Correct' : r === 'wrong' ? 'Wrong' : 'Check the solution';
  const marks = r === 'correct' ? '+3' : negMark(q) && !a.skipped ? '−1' : '0';
  const right = r === 'unmarked'
    ? `<span><button class="btn" data-mark="correct">I was right</button> <button class="btn" data-mark="wrong">I was wrong</button></span>`
    : `<span class="m">${fmtTime(a.time)} · ${marks}${q.ans ? ' · key ' + esc(q.ans).toUpperCase() : ''} · <a data-retry>retry</a></span>`;
  return `<div class="verdict ${r}"><b>${label}</b>${right}</div>
  ${r === 'unmarked' ? '<p class="small muted">No answer key could be read for this question, so mark it yourself.</p>' : ''}
  <div class="card"><div class="label"><span>Solution</span></div>${g ? crops(g.rects) : ''}${q.sol ? crops(q.sol.rects) : '<p class="muted small">The book has no solution for this question.</p>'}</div>`;
}
function bindAfter(q, a) {
  app().querySelectorAll('[data-mark]').forEach(b => b.onclick = () => {
    a.result = b.dataset.mark; save();
    $('#after').innerHTML = afterHTML(q, a); bindAfter(q, a);
    $('#answer').innerHTML = answerHTML(q, a);
  });
  const retry = $('[data-retry]');
  if (retry) retry.onclick = () => { delete S.progress.attempts[q.id]; save(); renderQuestion(q.id); };
}

/* ---------- timer ---------- */
function startTimer() { S.timer = { acc: 0, start: Date.now(), running: true, iv: setInterval(tick, 500) }; tick(); }
function elapsed() { return S.timer ? S.timer.acc + (S.timer.running ? (Date.now() - S.timer.start) / 1000 : 0) : 0; }
function tick() { const c = $('#clock'); if (c) c.textContent = fmtTime(elapsed()); }
function pauseTimer(auto) {
  if (!S.timer || !S.timer.running) return;
  S.timer.acc += (Date.now() - S.timer.start) / 1000; S.timer.running = false;
  $('#timer').classList.add('paused'); $('[data-pause]').textContent = auto ? 'Resume (auto-paused)' : 'Resume';
}
function resumeTimer() {
  if (!S.timer || S.timer.running) return;
  S.timer.start = Date.now(); S.timer.running = true;
  $('#timer').classList.remove('paused'); $('[data-pause]').textContent = 'Pause';
}
function stopTimer() { if (!S.timer) return 0; const t = elapsed(); clearInterval(S.timer.iv); S.timer = null; return t; }

/* ---------- keyboard ---------- */
function onKey(e) {
  if (e.target.matches('input, textarea, select')) return;
  if (!S.q) return;
  const k = e.key.toLowerCase();
  if (/^[a-d]$/.test(k) && S._pick) return S._pick(k);
  if (/^[1-4]$/.test(k) && S._pick) return S._pick('abcd'[+k - 1]);
  if (k === 'enter' && S._submit) return S._submit();
  const { prev, next } = siblings(S.q);
  if (k === 'n' && next) location.hash = '#/q/' + next.id;
  if (k === 'p' && prev) location.hash = '#/q/' + prev.id;
  if (k === 't') togglePanel();
}

/* ---------- AI tutor panel ---------- */
const TUTOR_SYSTEM = `You are a tutor for the CAT (Common Admission Test, India). The student is practising a past-paper question from a solved-papers book. You get the question as an image cropped from the book (plus the directions/data set when there is one), a rough text extraction that may garble maths, and, when known, the answer key.
Rules: use plain text with simple inline maths (no LaTeX, no markdown headings). Be concise and concrete. For a "hint" give one nudge that unlocks the next step and never state the final answer. For "explain" give a clean step-by-step solution and end with the final answer. For "why wrong" first find the student's likely error, then correct it. If the extraction and the image disagree, trust the image. Mention exam strategy (time, elimination, when to skip) only when it is genuinely useful.`;

function initPanel() {
  document.documentElement.style.setProperty('--panel-w', (S.settings.panelW || 400) + 'px');
  $('#ai-toggle').onclick = openPanel;
  $('#ai-close').onclick = () => closePanel();
  $('#ai-form').onsubmit = e => { e.preventDefault(); if (S.q) askAI(S.q, 'ask'); };
  $('#ai-input').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (S.q) askAI(S.q, 'ask'); } };
  const handle = $('.ai-resize');
  handle.onpointerdown = e => {
    e.preventDefault(); handle.setPointerCapture(e.pointerId);
    const move = ev => { const w = Math.min(680, Math.max(300, window.innerWidth - ev.clientX)); document.documentElement.style.setProperty('--panel-w', w + 'px'); S.settings.panelW = w; };
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); saveSettings(); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
  };
}
function openPanel() { $('#ai-panel').hidden = false; document.body.classList.add('ai-open'); S.settings.panelOpen = true; saveSettings(); setTimeout(() => $('#ai-input').focus(), 250); }
function closePanel(silent) { document.body.classList.remove('ai-open'); if (!silent) { S.settings.panelOpen = false; saveSettings(); } }
function togglePanel() { document.body.classList.contains('ai-open') ? closePanel() : openPanel(); }

function panelForQuestion(q) {
  const a = attempt(q.id);
  $('#ai-sub').textContent = `${chapter(q.ch).title} · Q${q.n}` + (S.settings.apiKey ? ` · ${S.settings.model}` : '');
  $('#ai-quick').innerHTML = `<button class="btn" data-ai="hint">Hint</button><button class="btn" data-ai="explain">Explain</button>${a && a.result !== 'correct' ? '<button class="btn" data-ai="why">Why was I wrong?</button>' : ''}`;
  $('#ai-quick').querySelectorAll('[data-ai]').forEach(b => b.onclick = () => askAI(q, b.dataset.ai));
  const chat = $('#chat');
  chat.innerHTML = '';
  if (!S.settings.apiKey) chat.innerHTML = `<div class="msg hint">Add your Anthropic API key in <a href="#/settings"><u>Settings</u></a> to use the tutor.</div>`;
  const c = S.chats[q.id];
  if (c) for (const m of c.shown) chat.insertAdjacentHTML('beforeend', `<div class="msg ${m.role}">${esc(m.text)}</div>`);
}

async function questionImage(q) {
  const rects = [];
  const d = q.dir && S.data.directions[q.dir];
  if (d) rects.push(...d.rects);
  rects.push(...q.rects);
  const [PW] = S.data.pageSize;
  const imgs = new Map();
  for (const r of rects) if (!imgs.has(r[0])) imgs.set(r[0], loadImg(PAGE_IMG(r[0])));
  for (const [p, pr] of imgs) imgs.set(p, await pr);
  const sc = imgs.values().next().value.naturalWidth / PW;
  const W = Math.round(Math.max(...rects.map(r => r[3] - r[1])) * sc);
  const H = Math.round(rects.reduce((s, r) => s + (r[4] - r[2]) * sc + 12, 0));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  let y = 0;
  for (const [p, x0, y0, x1, y1] of rects) {
    const w = (x1 - x0) * sc, h = (y1 - y0) * sc;
    ctx.drawImage(imgs.get(p), x0 * sc, y0 * sc, w, h, 0, y, w, h); y += h + 12;
  }
  return cv.toDataURL('image/jpeg', 0.85).split(',')[1];
}
const loadImg = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });

async function askAI(q, mode) {
  const chat = $('#chat'), ta = $('#ai-input');
  if (!S.settings.apiKey) { openPanel(); return; }
  const a = attempt(q.id);
  let userText;
  if (mode === 'hint') userText = 'Give me a hint for this question. Do not reveal the answer.';
  else if (mode === 'explain') userText = 'Explain how to solve this question step by step, then give the final answer.';
  else if (mode === 'why') userText = `I answered "${(a && a.ans) || '(skipped)'}"${q.ans ? ` and the key says "${q.ans}"` : ''}. Why is my answer wrong, and what is the right approach?`;
  else { userText = (ta.value || '').trim(); if (!userText) return; ta.value = ''; }

  let c = S.chats[q.id];
  if (!c) {
    const img = await questionImage(q).catch(() => null);
    const ctxText = `Chapter: ${chapter(q.ch).title}. ${q.year ? 'CAT ' + q.year + '. ' : ''}Type: ${q.type}. ${q.ans ? 'Answer key: ' + q.ans + '.' : 'Answer key not available.'}\nDirections (text extraction): ${q.dir ? S.data.directions[q.dir].text : '(none)'}\nQuestion (text extraction): ${q.text}`;
    const content = [];
    if (img) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } });
    content.push({ type: 'text', text: ctxText });
    c = S.chats[q.id] = { messages: [{ role: 'user', content }, { role: 'assistant', content: 'Understood. I have the question. What do you need?' }], shown: [] };
  }
  c.messages.push({ role: 'user', content: userText });
  c.shown.push({ role: 'user', text: userText });
  chat.insertAdjacentHTML('beforeend', `<div class="msg user">${esc(userText)}</div><div class="msg ai">…</div>`);
  const out = chat.lastElementChild; chat.scrollTop = chat.scrollHeight;
  $('#ai-quick').querySelectorAll('button').forEach(b => b.disabled = true);
  try {
    const text = await streamClaude(c.messages, t => { out.textContent = t; chat.scrollTop = chat.scrollHeight; });
    c.messages.push({ role: 'assistant', content: text });
    c.shown.push({ role: 'ai', text });
  } catch (err) {
    c.messages.pop(); c.shown.pop();
    out.className = 'msg err'; out.textContent = 'Request failed: ' + err.message;
  } finally {
    $('#ai-quick').querySelectorAll('button').forEach(b => b.disabled = false);
  }
}

async function streamClaude(messages, onText) {
  const model = S.settings.model || 'claude-opus-5-5';
  const headers = {
    'content-type': 'application/json',
    'x-api-key': S.settings.apiKey,
    'anthropic-version': '2026-10-21',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  const body = { model, max_tokens: 4096, stream: true, system: TUTOR_SYSTEM, messages };
  if (!model.includes('haiku')) {
    // Route safety-classifier refusals to a fallback model instead of failing.
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    body.fallbacks = 'default';
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    let msg = res.status + ' ' + res.statusText;
    try { const j = await res.json(); msg = (j.error && j.error.message) || msg; } catch (e) { /* ignore */ }
    throw new Error(msg);
  }
  const reader = res.body.getReader(); const dec = new TextDecoder();
  let buf = '', text = '', stop = null;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n'); buf = parts.pop();
    for (const part of parts) {
      const line = part.split('\n').find(l => l.startsWith('data:')); if (!line) continue;
      let ev; try { ev = JSON.parse(line.slice(5)); } catch (e) { continue; }
      if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') { text += ev.delta.text; onText(text); }
      else if (ev.type === 'message_delta' && ev.delta) stop = ev.delta.stop_reason;
      else if (ev.type === 'error') throw new Error((ev.error && ev.error.message) || 'stream error');
    }
  }
  if (stop === 'refusal') throw new Error('The model declined this request.');
  if (!text) throw new Error('Empty response.');
  return text;
}

/* ---------- settings ---------- */
function renderSettings() {
  const st = stats(S.data.questions);
  app().innerHTML = `<a class="back" href="#/">Dashboard</a><h1>Settings</h1>
  <div class="form">
    <label>Anthropic API key</label><input type="password" data-key value="${esc(S.settings.apiKey)}" placeholder="sk-ant-…">
    <p class="note">Kept only in this browser and sent straight to api.anthropic.com. Create one at console.anthropic.com.</p>
    <label>Tutor model</label>
    <select data-model>
      <option value="claude-opus-5-5">Claude Opus 5.5</option>
      <option value="claude-sonnet-5-5">Claude Sonnet 5.5</option>
      <option value="claude-haiku-5-5">Claude Haiku 5.5</option>
    </select>
    <p style="margin-top:14px"><button class="btn primary" data-save>Save</button> <span class="muted small" id="saved"></span></p>
    <hr>
    <label>Progress</label>
    <p class="note">${st.attempted} attempts, ${fmtTime(st.time)} recorded, ${Object.values(S.progress.bookmarks).filter(Boolean).length} bookmarks. Stored in this browser only.</p>
    <p class="actions"><button class="btn" data-export>Export</button><button class="btn" data-import>Import</button><input type="file" accept="application/json" data-file hidden><button class="btn quiet" data-reset>Reset everything</button></p>
    <hr>
    <label>Theme</label>
    <select data-theme><option value="">System</option><option value="light">Light</option><option value="dark">Dark</option></select>
    <hr>
    <label>Keyboard</label>
    <p class="keys"><kbd>A</kbd>–<kbd>D</kbd> pick an option · <kbd>Enter</kbd> submit · <kbd>N</kbd> next · <kbd>P</kbd> previous · <kbd>T</kbd> tutor</p>
  </div>`;
  $('[data-model]').value = S.settings.model;
  $('[data-theme]').value = document.documentElement.dataset.theme || '';
  $('[data-save]').onclick = () => { S.settings.apiKey = $('[data-key]').value.trim(); S.settings.model = $('[data-model]').value; saveSettings(); $('#saved').textContent = 'Saved.'; };
  $('[data-theme]').onchange = e => { const v = e.target.value; if (v) document.documentElement.dataset.theme = v; else delete document.documentElement.dataset.theme; localStorage.setItem('catprep.theme', v); };
  $('[data-export]').onclick = () => {
    const blob = new Blob([JSON.stringify(S.progress, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `catprep-progress-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  };
  $('[data-import]').onclick = () => $('[data-file]').click();
  $('[data-file]').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const j = JSON.parse(await f.text()); if (!j.attempts) throw new Error('not a progress file');
      S.progress = { attempts: j.attempts, bookmarks: j.bookmarks || {}, last: j.last || null }; save(); renderSettings(); }
    catch (err) { alert('Import failed: ' + err.message); }
  };
  $('[data-reset]').onclick = () => { if (confirm('Delete all attempts, times and bookmarks?')) { S.progress = { attempts: {}, bookmarks: {}, last: null }; save(); renderSettings(); } };
}

/* ---------- boot ---------- */
(function () {
  const t = localStorage.getItem('catprep.theme'); if (t) document.documentElement.dataset.theme = t;
  init().catch(err => { app().innerHTML = `<p class="muted center">Could not load data: ${esc(err.message)}</p>`; });
})();
