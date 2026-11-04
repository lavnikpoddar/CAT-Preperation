/* CAT Prep – topic-wise past-paper practice.
   Plain JS, no build step. Data comes from data/questions.json and the page
   images in img/pages/. Progress lives in localStorage (export/import in Settings). */
'use strict';

const DATA_URL = 'data/questions.json';
const PAGE_IMG = p => `img/pages/p-${String(p).padStart(3, '0')}.webp`;
const STORE_KEY = 'catprep.progress.v1';
const SETTINGS_KEY = 'catprep.settings.v1';
const MARKS = { correct: 3, wrongMCQ: -1, wrongTITA: 0 };
const LETTERS = ['a', 'b', 'c', 'd', 'e'];

const S = {
  data: null, byId: new Map(), chapterQs: new Map(), units: new Map(), unitOf: new Map(),
  progress: load(STORE_KEY, { attempts: {}, bookmarks: {}, sets: {}, last: null }),
  settings: load(SETTINGS_KEY, { apiKey: '', model: 'claude-opus-5-5', panelW: 400, panelOpen: false }),
  filters: {}, t: null, chats: {}, unit: null, picks: {},
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
  // units: a set of questions sharing one directions block, or a single question
  for (const [ch, qs] of S.chapterQs) {
    const list = [];
    for (const q of qs) {
      const last = list[list.length - 1];
      if (q.dir && last && last.dir === q.dir) last.qs.push(q);
      else list.push({ id: q.dir ? q.dir : q.id, dir: q.dir, qs: [q], ch });
    }
    list.forEach((u, i) => { u.i = i; u.list = list; for (const q of u.qs) S.unitOf.set(q.id, u); });
    S.units.set(ch, list);
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', flushUnit);
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', () => { if (document.hidden && S.t && S.t.running) pause(true); });
  initDock(); initPanel();
  route();
}

const chapter = id => S.data.chapters.find(c => c.id === id);
const attempt = qid => S.progress.attempts[qid];
const negMark = q => q.type === 'MCQ';

function stats(qs) {
  const st = { total: qs.length, attempted: 0, correct: 0, wrong: 0, unmarked: 0, time: 0, score: 0 };
  const seen = new Set();
  for (const q of qs) {
    const u = S.unitOf.get(q.id);
    if (u && u.dir && !seen.has(u.id)) { seen.add(u.id); st.time += (S.progress.sets[u.id] || {}).reading || 0; }
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
  flushUnit();
  S.unit = null; S.picks = {};
  const h = location.hash || '#/';
  const m = h.match(/^#\/(ch|q)\/([^/?]+)/);
  const isQ = !!(m && m[1] === 'q');
  document.body.classList.toggle('wide', isQ);
  document.body.classList.toggle('has-dock', isQ);
  $('#dock').hidden = !isQ;
  $('#ai-toggle').hidden = !isQ;
  if (!isQ) closePanel(true);
  if (h.startsWith('#/settings')) renderSettings();
  else if (m && m[1] === 'ch') renderChapter(m[2]);
  else if (isQ) renderUnit(m[2]);
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
  const match = q => (f.year === 'all' || String(q.year) === f.year) && (f.sub === 'all' || q.sub === f.sub) && matchStatus(q, f.status);
  const units = S.units.get(chId).map(u => ({ u, qs: u.qs.filter(match) })).filter(x => x.qs.length);
  const cs = stats(qs);
  const firstU = units.find(x => x.qs.some(q => !attempt(q.id))) || units[0];
  let html = `<a class="back" href="#/">Dashboard</a>
  <h1>${esc(c.title)}</h1>
  <p class="lead">${cs.total} questions · ${cs.attempted} attempted${accuracy(cs) ? ' · ' + accuracy(cs) : ''}${cs.time ? ' · ' + fmtTime(cs.time) : ''}</p>
  <div class="years"><a class="${f.year === 'all' ? 'on' : ''}" data-year="all">All years</a>${years.map(y => `<a class="${f.year === String(y) ? 'on' : ''}" data-year="${y}">${y}</a>`).join('')}</div>
  <div class="tools">
    <span>
      <select class="quiet" data-status><option value="all">All questions</option><option value="new">Not attempted</option><option value="correct">Correct</option><option value="wrong">Wrong</option><option value="unmarked">Unmarked</option><option value="bookmarked">Bookmarked</option></select>
      ${c.subtopics.length ? ` <select class="quiet" data-sub><option value="all">All topics</option>${c.subtopics.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select>` : ''}
    </span>
    ${firstU ? `<a class="btn primary" href="#/q/${(firstU.qs.find(q => !attempt(q.id)) || firstU.qs[0]).id}">Start</a>` : ''}
  </div><div class="rows">`;
  for (const { u, qs: uq } of units) {
    const first = uq[0], lastQ = uq[uq.length - 1];
    const label = uq.length > 1 ? `${first.n}–${lastQ.n}` : `${first.n}`;
    const st = stats(uq);
    const types = [...new Set(uq.map(q => q.type))].join(' + ');
    html += `<a class="row" href="#/q/${(uq.find(q => !attempt(q.id)) || first).id}">
      <span class="n">${label}</span>
      <span class="t">${first.year ? 'CAT ' + first.year : '<span class="muted">year not stated</span>'}${first.sub ? ' · ' + esc(first.sub) : ''}${uq.length > 1 ? ` · ${uq.length} questions` : ''}${uq.some(q => S.progress.bookmarks[q.id]) ? ' ★' : ''}<span class="dots">${uq.map(q => `<span class="dot ${attempt(q.id) ? attempt(q.id).result : ''}"></span>`).join('')}</span></span>
      <span class="r">${types}${st.time ? ' · ' + fmtTime(st.time) : ''}</span></a>`;
  }
  html += `</div>${units.length ? '' : '<p class="muted small">Nothing matches these filters.</p>'}`;
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

/* ---------- crops ---------- */
function cropSVG(r, scale) {
  const [p, x0, y0, x1, y1] = r; const w = x1 - x0, h = y1 - y0;
  const [PW, PH] = S.data.pageSize;
  const width = `clamp(${Math.round(w)}px, 100%, ${Math.round(w * (scale || 2))}px)`;
  return `<svg class="crop" viewBox="${x0} ${y0} ${w} ${h}" style="aspect-ratio:${w}/${h};width:${width}" preserveAspectRatio="xMinYMin meet"><image href="${PAGE_IMG(p)}" x="0" y="0" width="${PW}" height="${PH}"/></svg>`;
}
const crops = (rects, scale) => `<div class="crops">${rects.map(r => cropSVG(r, scale)).join('')}</div>`;

/* ---------- question unit (a set or a single question) ---------- */
function renderUnit(qid) {
  const q0 = S.byId.get(qid); if (!q0) return renderDashboard();
  const u = S.unitOf.get(q0.id);
  S.unit = u; S.picks = {};
  const c = chapter(u.ch);
  const d = u.dir && S.data.directions[u.dir];
  const first = u.qs[0];
  const types = [...new Set(u.qs.map(q => q.type))];
  const neg = types.includes('MCQ');
  S.progress.last = (u.qs.find(q => !attempt(q.id)) || q0).id; save();

  app().innerHTML = `<div class="umeta">
    <span><a class="back" href="#/ch/${c.id}" style="margin:0">${esc(c.title)}</a> · <b>${first.year ? 'CAT ' + first.year : 'year not stated'}</b> · ${u.qs.length > 1 ? `Q${first.n}–${u.qs[u.qs.length - 1].n}` : `Q${first.n}`} · ${types.map(t => t === 'MCQ' ? 'MCQ' : 'TITA').join(' + ')} · <span class="${neg ? 'neg' : 'noneg'}">${neg ? '+3 / −1' : '+3 / no negative'}</span>${first.sub ? ' · ' + esc(first.sub) : ''}</span>
    <span>${u.qs.length > 1 ? `${u.qs.length} questions · click a question to time it` : ''}</span>
  </div>
  <div class="unit ${d ? 'has-ctx' : ''}">
    ${d ? `<div class="context">${crops(d.rects, 1.6)}</div>` : ''}
    <div class="qs">${u.qs.map(q => qblockHTML(q)).join('')}</div>
  </div>`;
  u.qs.forEach(q => bindQblock(q));
  startUnit(u, q0);
  panelFor(activeQ() || q0);
  if (S.settings.panelOpen && window.innerWidth > 860) openPanel();
  updateDock();
}

function qblockHTML(q) {
  const a = attempt(q.id);
  const stemRects = q.optRects && q.stem ? q.stem : q.rects;
  return `<div class="qblock ${a ? 'done' : ''}" id="qb-${q.id}" data-q="${q.id}">
    <div class="qhead"><span>Q${q.n}${a ? '' : ''}</span><span><span class="qt" id="qt-${q.id}">${a ? fmtTime(a.time) : ''}</span> <a class="bm" data-bm="${q.id}">${S.progress.bookmarks[q.id] ? '★' : '☆'}</a></span></div>
    <div class="stem">${crops(stemRects, 1.6)}</div>
    <div class="answer" id="ans-${q.id}">${answerHTML(q, a)}</div>
    <div id="after-${q.id}">${a ? afterHTML(q, a) : ''}</div>
  </div>`;
}

function answerHTML(q, a) {
  const cls = (o) => !a ? '' : o === q.ans ? 'ok' : o === a.ans ? (a.result === 'wrong' ? 'bad' : 'sel') : '';
  const dis = a ? 'disabled' : '';
  if (q.optRects) {
    return `<div class="opts">${q.optRects.map((r, i) => `<button class="opt ${cls(LETTERS[i])}" data-opt="${LETTERS[i]}" ${dis}><span class="l">${LETTERS[i].toUpperCase()}</span>${crops(r, 1.6)}</button>`).join('')}</div>`;
  }
  if (q.type === 'MCQ' && q.opts) {
    return `<div class="letters">${LETTERS.slice(0, 4).map(o => `<button class="opt ${cls(o)}" data-opt="${o}" ${dis}>${o}</button>`).join('')}</div>`;
  }
  if (a) return `<p class="small muted">Your answer: <b>${esc(a.ans) || '—'}</b>${q.ans ? ` · key: <b>${esc(q.ans)}</b>` : ''}</p>`;
  return `<div class="tita"><input type="text" data-tita placeholder="${q.type === 'MCQ' ? 'Option letter a–d (see directions)' : 'Your answer'}" autocomplete="off"></div>`;
}

function bindQblock(q) {
  const el = $(`#qb-${q.id}`);
  el.querySelector('[data-bm]').onclick = e => { e.stopPropagation(); S.progress.bookmarks[q.id] = !S.progress.bookmarks[q.id]; save(); e.target.textContent = S.progress.bookmarks[q.id] ? '★' : '☆'; };
  if (attempt(q.id)) { bindAfter(q); return; }
  el.addEventListener('click', () => activate(q.id));
  el.querySelectorAll('[data-opt]').forEach(b => b.onclick = e => {
    e.stopPropagation(); activate(q.id);
    S.picks[q.id] = b.dataset.opt;
    el.querySelectorAll('[data-opt]').forEach(x => x.classList.toggle('sel', x === b));
    updateDock();
  });
  const inp = el.querySelector('[data-tita]');
  if (inp) { inp.onfocus = () => activate(q.id); inp.oninput = () => { S.picks[q.id] = inp.value.trim(); updateDock(); }; inp.onkeydown = e => { if (e.key === 'Enter') submitActive(); }; }
}

function grade(q, ans) {
  if (ans === null || ans === undefined || ans === '') return 'wrong';
  if (!q.ans) return 'unmarked';
  const norm = s => String(s).trim().toLowerCase().replace(/^\(|\)$/g, '').replace(/,/g, '');
  return norm(ans) === norm(q.ans) ? 'correct' : 'wrong';
}

function submitQ(q, ans) {
  const time = qElapsed(q.id);
  if (S.t && S.t.active === q.id) { S.t.qAcc[q.id] = time; S.t.active = null; }
  const prev = attempt(q.id);
  const a = { ans: ans || '', result: ans === null ? 'wrong' : grade(q, ans), time, at: Date.now(), n: (prev ? prev.n : 0) + 1, skipped: ans === null };
  S.progress.attempts[q.id] = a; save();
  delete S.picks[q.id];
  const el = $(`#qb-${q.id}`);
  el.classList.add('done'); el.classList.remove('active');
  $(`#ans-${q.id}`).innerHTML = answerHTML(q, a);
  $(`#after-${q.id}`).innerHTML = afterHTML(q, a);
  $(`#qt-${q.id}`).textContent = fmtTime(a.time);
  bindAfter(q);
  // move on to the next unanswered question in the set
  const nxt = S.unit.qs.find(x => !attempt(x.id));
  if (nxt) { activate(nxt.id); $(`#qb-${nxt.id}`).scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  else { if (S.t) { S.t.running = false; } }
  panelFor(activeQ() || q);
  updateDock();
}

function afterHTML(q, a) {
  const g = q.solgrp && S.data.solgroups[q.solgrp];
  const r = a.result;
  const label = a.skipped ? 'Answer shown' : r === 'correct' ? 'Correct' : r === 'wrong' ? 'Wrong' : 'Mark yourself';
  const marks = r === 'correct' ? '+3' : negMark(q) && !a.skipped ? '−1' : '0';
  const right = r === 'unmarked'
    ? `<span><a data-mark="correct">right</a> · <a data-mark="wrong">wrong</a> · <span class="muted">no key for this one</span></span>`
    : `<span>${marks}${q.ans ? ' · key ' + esc(q.ans).toUpperCase() : ''} · <a data-retry>retry</a></span>`;
  return `<div class="verdict ${r}"><b>${label}</b>${right}</div>
  <div class="sol"><div class="lbl">Solution</div>${g ? crops(g.rects, 1.6) : ''}${q.sol ? crops(q.sol.rects, 1.6) : '<p class="muted small">The book has no solution for this question.</p>'}</div>`;
}
function bindAfter(q) {
  const el = $(`#qb-${q.id}`);
  el.querySelectorAll('[data-mark]').forEach(b => b.onclick = () => {
    const a = attempt(q.id); a.result = b.dataset.mark; save();
    $(`#after-${q.id}`).innerHTML = afterHTML(q, a); $(`#ans-${q.id}`).innerHTML = answerHTML(q, a); bindAfter(q);
  });
  const retry = el.querySelector('[data-retry]');
  if (retry) retry.onclick = () => { delete S.progress.attempts[q.id]; save(); renderUnit(q.id); };
}

/* ---------- timing: one clock for the unit, one per question ---------- */
function startUnit(u, q0) {
  const todo = u.qs.filter(q => !attempt(q.id));
  S.t = { unit: u, running: todo.length > 0, setAcc: 0, setStart: Date.now(), active: null, qAcc: {}, qStart: 0, iv: setInterval(tick, 500) };
  if (!todo.length) return;
  if (u.qs.length === 1) activate(u.qs[0].id);
  else if (!attempt(q0.id) && q0 !== u.qs[0]) activate(q0.id);
  tick();
}
function activate(qid) {
  if (!S.t || attempt(qid)) return;
  const now = Date.now();
  if (S.t.active === qid) return;
  if (S.t.active && S.t.running) S.t.qAcc[S.t.active] = qElapsed(S.t.active);
  S.t.active = qid; S.t.qStart = now;
  if (!S.t.running) resume();
  document.querySelectorAll('.qblock').forEach(el => el.classList.toggle('active', el.dataset.q === qid));
  panelFor(S.byId.get(qid));
  updateDock();
}
const activeQ = () => S.t && S.t.active ? S.byId.get(S.t.active) : null;
function qElapsed(qid) {
  if (!S.t) return 0;
  const base = S.t.qAcc[qid] || 0;
  return base + (S.t.active === qid && S.t.running ? (Date.now() - S.t.qStart) / 1000 : 0);
}
function setElapsed() { return S.t ? S.t.setAcc + (S.t.running ? (Date.now() - S.t.setStart) / 1000 : 0) : 0; }
function pause(auto) {
  if (!S.t || !S.t.running) return;
  const now = Date.now();
  S.t.setAcc += (now - S.t.setStart) / 1000;
  if (S.t.active) S.t.qAcc[S.t.active] = qElapsed(S.t.active);
  S.t.running = false; S.t.autoPaused = !!auto;
  updateDock();
}
function resume() {
  if (!S.t || S.t.running) return;
  const now = Date.now();
  S.t.setStart = now; S.t.qStart = now; S.t.running = true; S.t.autoPaused = false;
  updateDock();
}
function tick() {
  if (!S.t) return;
  const a = S.t.active;
  const multi = S.t.unit.qs.length > 1;
  const clock = $('#clock'), clock2 = $('#clock2');
  if (a) { clock.textContent = fmtTime(qElapsed(a)); const qt = $(`#qt-${a}`); if (qt) qt.textContent = fmtTime(qElapsed(a)); }
  else clock.textContent = fmtTime(setElapsed());
  clock2.textContent = multi ? (a ? `set ${fmtTime(setElapsed())}` : 'reading') : '';
}
function flushUnit() {
  if (!S.t) return;
  const u = S.t.unit;
  if (u.dir) {
    const rec = S.progress.sets[u.id] || (S.progress.sets[u.id] = { time: 0, reading: 0 });
    const total = setElapsed();
    const attributed = u.qs.reduce((s, q) => s + (S.t.qAcc[q.id] || 0) + (S.t.active === q.id && S.t.running ? (Date.now() - S.t.qStart) / 1000 : 0), 0);
    rec.time += total; rec.reading += Math.max(0, total - attributed);
    save();
  }
  clearInterval(S.t.iv); S.t = null;
}

/* ---------- dock ---------- */
function initDock() {
  $('#pause').onclick = () => { if (!S.t) return; S.t.running ? pause() : resume(); };
  $('#submit').onclick = submitActive;
  $('#reveal').onclick = () => { const q = activeQ() || (S.unit && S.unit.qs.find(x => !attempt(x.id))); if (q) submitQ(q, null); };
  $('#prev').onclick = () => navUnit(-1);
  $('#next').onclick = () => navUnit(1);
}
function submitActive() {
  const q = activeQ(); if (!q) return;
  const pick = S.picks[q.id];
  if (pick === undefined || pick === '') return;
  submitQ(q, pick);
}
function navUnit(dir) {
  if (!S.unit) return;
  const list = S.unit.list; let i = S.unit.i + dir;
  if (i < 0) return;
  if (i >= list.length) { location.hash = '#/ch/' + S.unit.ch; return; }
  location.hash = '#/q/' + list[i].qs[0].id;
}
function updateDock() {
  if (!S.unit) return;
  const q = activeQ();
  const todo = S.unit.qs.filter(x => !attempt(x.id));
  const pick = q && S.picks[q.id];
  $('#submit').disabled = !(q && pick !== undefined && pick !== '');
  $('#reveal').disabled = !todo.length;
  $('#pause').textContent = S.t && S.t.running ? '❚❚' : '▶';
  $('#pause').classList.toggle('off', !todo.length);
  $('.dock-time').classList.toggle('paused', !(S.t && S.t.running));
  $('#prev').classList.toggle('off', S.unit.i === 0);
  $('#next').textContent = S.unit.i + 1 < S.unit.list.length ? '→' : '✓';
  $('#next').title = S.unit.i + 1 < S.unit.list.length ? 'Next' : 'Back to chapter';
  tick();
}

/* ---------- keyboard ---------- */
function onKey(e) {
  if (e.target.matches('input, textarea, select')) return;
  if (!S.unit) return;
  const k = e.key.toLowerCase();
  const q = activeQ();
  if (q && /^[a-e]$/.test(k)) { const b = $(`#qb-${q.id} [data-opt="${k}"]`); if (b) b.click(); return; }
  if (q && /^[1-5]$/.test(k)) { const b = $(`#qb-${q.id} [data-opt="${LETTERS[+k - 1]}"]`); if (b) b.click(); return; }
  if (k === 'enter') return submitActive();
  if (k === 'n') navUnit(1);
  if (k === 'p') navUnit(-1);
  if (k === 't') togglePanel();
  if (k === ' ') { e.preventDefault(); $('#pause').click(); }
}

/* ---------- AI tutor panel ---------- */
const TUTOR_SYSTEM = `You are a tutor for the CAT (Common Admission Test, India). The student is practising a past-paper question from a solved-papers book. You get the question as an image cropped from the book (plus the directions/data set when there is one), a rough text extraction that may garble maths, and, when known, the answer key.
Rules: use plain text with simple inline maths (no LaTeX, no markdown headings). Be concise and concrete. For a "hint" give one nudge that unlocks the next step and never state the final answer. For "explain" give a clean step-by-step solution and end with the final answer. For "why wrong" first find the student's likely error, then correct it. If the extraction and the image disagree, trust the image. Mention exam strategy (time, elimination, when to skip) only when it is genuinely useful.`;

function initPanel() {
  document.documentElement.style.setProperty('--panel-w', (S.settings.panelW || 400) + 'px');
  $('#ai-toggle').onclick = openPanel;
  $('#ai-close').onclick = () => closePanel();
  $('#ai-form').onsubmit = e => { e.preventDefault(); const q = panelQ(); if (q) askAI(q, 'ask'); };
  $('#ai-input').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const q = panelQ(); if (q) askAI(q, 'ask'); } };
  const handle = $('.ai-resize');
  handle.onpointerdown = e => {
    e.preventDefault(); handle.setPointerCapture(e.pointerId);
    const move = ev => { const w = Math.min(680, Math.max(300, window.innerWidth - ev.clientX)); document.documentElement.style.setProperty('--panel-w', w + 'px'); S.settings.panelW = w; };
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); saveSettings(); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
  };
}
const panelQ = () => S.panelQ || activeQ() || (S.unit && S.unit.qs[0]);
function openPanel() { $('#ai-panel').hidden = false; document.body.classList.add('ai-open'); S.settings.panelOpen = true; saveSettings(); setTimeout(() => $('#ai-input').focus(), 250); }
function closePanel(silent) { document.body.classList.remove('ai-open'); if (!silent) { S.settings.panelOpen = false; saveSettings(); } }
function togglePanel() { document.body.classList.contains('ai-open') ? closePanel() : openPanel(); }

function panelFor(q) {
  if (!q) return;
  S.panelQ = q;
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
    <p class="keys"><kbd>A</kbd>–<kbd>E</kbd> pick an option · <kbd>Enter</kbd> submit · <kbd>Space</kbd> pause · <kbd>N</kbd> next · <kbd>P</kbd> previous · <kbd>T</kbd> tutor</p>
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
      S.progress = { attempts: j.attempts, bookmarks: j.bookmarks || {}, sets: j.sets || {}, last: j.last || null }; save(); renderSettings(); }
    catch (err) { alert('Import failed: ' + err.message); }
  };
  $('[data-reset]').onclick = () => { if (confirm('Delete all attempts, times and bookmarks?')) { S.progress = { attempts: {}, bookmarks: {}, sets: {}, last: null }; save(); renderSettings(); } };
}

/* ---------- boot ---------- */
(function () {
  const t = localStorage.getItem('catprep.theme'); if (t) document.documentElement.dataset.theme = t;
  init().catch(err => { app().innerHTML = `<p class="muted center">Could not load data: ${esc(err.message)}</p>`; });
})();
