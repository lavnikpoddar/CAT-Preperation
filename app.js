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
  settings: load(SETTINGS_KEY, { apiKey: '', model: 'claude-opus-5-5' }),
  filters: {},          // per chapter: { year, status, sub }
  timer: null, chat: null,
};

function load(k, d) { try { return Object.assign(d, JSON.parse(localStorage.getItem(k) || '{}')); } catch (e) { return d; } }
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(S.progress)); }
function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S.settings)); }
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = s => { s = Math.round(s || 0); const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`; };
const $ = sel => document.querySelector(sel);
const app = () => $('#app');

/* ---------- data ---------- */
async function init() {
  const res = await fetch(DATA_URL);
  S.data = await res.json();
  for (const q of S.data.questions) {
    S.byId.set(q.id, q);
    if (!S.chapterQs.has(q.ch)) S.chapterQs.set(q.ch, []);
    S.chapterQs.get(q.ch).push(q);
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', () => { if (document.hidden && S.timer && S.timer.running) pauseTimer(true); });
  route();
}

function chapter(id) { return S.data.chapters.find(c => c.id === id); }
function attempt(qid) { return S.progress.attempts[qid]; }
function negMark(q) { return q.type === 'MCQ'; }

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

/* ---------- routing ---------- */
function route() {
  stopTimer();
  S.chat = null;
  const h = location.hash || '#/';
  const m = h.match(/^#\/(ch|q)\/([^/?]+)/);
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active',
    (a.dataset.nav === 'home' && !h.startsWith('#/settings')) || (a.dataset.nav === 'settings' && h.startsWith('#/settings'))));
  if (h.startsWith('#/settings')) return renderSettings();
  if (m && m[1] === 'ch') return renderChapter(m[2]);
  if (m && m[1] === 'q') return renderQuestion(m[2]);
  renderDashboard();
  window.scrollTo(0, 0);
}

/* ---------- dashboard ---------- */
function renderDashboard() {
  const all = stats(S.data.questions);
  const acc = all.correct + all.wrong ? Math.round(100 * all.correct / (all.correct + all.wrong)) : null;
  const last = S.progress.last && S.byId.get(S.progress.last);
  let html = `<h1>Dashboard</h1><p class="muted small">${esc(S.data.book)}</p>
  <div class="cards">
    <div class="card"><div class="k">Attempted</div><div class="v">${all.attempted}<span class="muted small"> / ${all.total}</span></div><div class="s">${Math.round(100 * all.attempted / all.total)}% of the book</div></div>
    <div class="card"><div class="k">Accuracy</div><div class="v">${acc === null ? '–' : acc + '%'}</div><div class="s">${all.correct} right · ${all.wrong} wrong${all.unmarked ? ' · ' + all.unmarked + ' unmarked' : ''}</div></div>
    <div class="card"><div class="k">Net score</div><div class="v">${all.score}</div><div class="s">+3 right, −1 wrong MCQ, 0 wrong TITA</div></div>
    <div class="card"><div class="k">Time spent</div><div class="v">${fmtTime(all.time)}</div><div class="s">${all.attempted ? fmtTime(all.time / all.attempted) + ' avg per question' : 'no attempts yet'}</div></div>
  </div>`;
  if (last) html += `<p><a class="btn primary" href="#/q/${last.id}">Resume · ${esc(chapter(last.ch).title)} Q${last.n}</a></p>`;

  for (const [sec, name] of Object.entries(S.data.sections)) {
    const chs = S.data.chapters.filter(c => c.section === sec);
    const secQs = chs.flatMap(c => S.chapterQs.get(c.id) || []);
    const ss = stats(secQs);
    const sacc = ss.correct + ss.wrong ? Math.round(100 * ss.correct / (ss.correct + ss.wrong)) + '% accuracy' : '';
    html += `<div class="section-title"><h2>${esc(name)}</h2><span class="muted small">${ss.attempted}/${ss.total} attempted ${sacc ? '· ' + sacc : ''}</span></div><div class="chapters">`;
    for (const c of chs) {
      const cs = stats(S.chapterQs.get(c.id) || []);
      html += `<a class="chrow" href="#/ch/${c.id}">
        <span class="n">${c.num}</span><span class="t">${esc(c.title)}</span>
        ${bar(cs)}<span class="pct">${cs.attempted}/${cs.total}</span></a>`;
    }
    html += `</div>`;
  }
  app().innerHTML = html;
}

function bar(st) {
  const p = n => st.total ? (100 * n / st.total) + '%' : '0%';
  return `<div class="bar"><i class="c" style="width:${p(st.correct)}"></i><i class="w" style="width:${p(st.wrong)}"></i><i class="u" style="width:${p(st.unmarked)}"></i></div>`;
}

/* ---------- chapter ---------- */
function renderChapter(chId) {
  const c = chapter(chId); if (!c) return renderDashboard();
  const qs = S.chapterQs.get(chId) || [];
  const f = S.filters[chId] || (S.filters[chId] = { year: 'all', status: 'all', sub: 'all' });
  const years = [...new Set(qs.map(q => q.year).filter(Boolean))].sort((a, b) => b - a);
  const list = qs.filter(q => (f.year === 'all' || String(q.year) === f.year)
    && (f.sub === 'all' || q.sub === f.sub)
    && (f.status === 'all' || statusOf(q) === f.status));
  const cs = stats(qs);
  const acc = cs.correct + cs.wrong ? Math.round(100 * cs.correct / (cs.correct + cs.wrong)) + '% accuracy' : '';
  let html = `<div class="crumbs"><a href="#/">Dashboard</a> › ${esc(S.data.sections[c.section])}</div>
  <h1>${c.num}. ${esc(c.title)}</h1>
  <p class="muted small">${cs.total} questions · ${cs.attempted} attempted${acc ? ' · ' + acc : ''} · ${fmtTime(cs.time)} spent · book pages ${c.pages[0] - 89}–${c.pages[1] - 89}</p>
  <div class="chips"><span class="chip ${f.year === 'all' ? 'on' : ''}" data-year="all">All years</span>${years.map(y => `<span class="chip ${f.year === String(y) ? 'on' : ''}" data-year="${y}">${y}</span>`).join('')}</div>
  <div class="filters">
    <select data-status><option value="all">All questions</option><option value="new">Not attempted</option><option value="correct">Correct</option><option value="wrong">Wrong</option><option value="unmarked">Unmarked</option><option value="bookmarked">Bookmarked</option></select>
    ${c.subtopics.length ? `<select data-sub><option value="all">All topics</option>${c.subtopics.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select>` : ''}
    <span class="muted small">${list.length} shown</span>
    ${list.length ? `<a class="btn primary small" href="#/q/${(list.find(q => !attempt(q.id)) || list[0]).id}">Start</a>` : ''}
  </div>
  <table class="list"><thead><tr><th></th><th>Q</th><th>Year</th><th>Type</th><th>Set</th><th class="right">Time</th><th class="right">Attempt</th></tr></thead><tbody>`;
  for (const q of list) {
    const a = attempt(q.id); const st = statusOf(q);
    const d = q.dir && S.data.directions[q.dir];
    html += `<tr class="link" data-q="${q.id}">
      <td><span class="dot ${st === 'correct' ? 'ok' : st === 'wrong' ? 'bad' : st === 'unmarked' ? 'unmarked' : ''}"></span></td>
      <td class="num">${q.n}${S.progress.bookmarks[q.id] ? ' ★' : ''}</td>
      <td>${q.year || '<span class="muted">–</span>'}</td>
      <td><span class="badge">${q.type}</span></td>
      <td class="small muted">${d && d.range ? 'Q' + d.range[0] + '–' + d.range[1] : ''}${q.sub ? ' ' + esc(q.sub) : ''}</td>
      <td class="right num">${a ? fmtTime(a.time) : ''}</td>
      <td class="right small muted">${a ? (a.ans ? a.ans.toUpperCase() : '') : ''}</td></tr>`;
  }
  html += `</tbody></table>`;
  app().innerHTML = html;
  $('[data-status]').value = f.status;
  if ($('[data-sub]')) $('[data-sub]').value = f.sub;
  app().querySelectorAll('.chip').forEach(ch => ch.onclick = () => { f.year = ch.dataset.year; renderChapter(chId); });
  $('[data-status]').onchange = e => { f.status = e.target.value; renderChapter(chId); };
  if ($('[data-sub]')) $('[data-sub]').onchange = e => { f.sub = e.target.value; renderChapter(chId); };
  app().querySelectorAll('tr[data-q]').forEach(tr => tr.onclick = () => { location.hash = '#/q/' + tr.dataset.q; });
}

function statusOf(q) {
  if (S.filters.__bm) { /* unused */ }
  const a = attempt(q.id);
  const f = S.filters[q.ch];
  if (f && f.status === 'bookmarked') return S.progress.bookmarks[q.id] ? 'bookmarked' : 'x';
  return a ? a.result : 'new';
}

/* ---------- question ---------- */
function cropSVG(r) {
  const [p, x0, y0, x1, y1] = r; const w = x1 - x0, h = y1 - y0;
  const [PW, PH] = S.data.pageSize;
  const width = `clamp(${Math.round(w * 1.25)}px, 100%, ${Math.round(w * 2.1)}px)`;
  return `<svg class="crop" viewBox="${x0} ${y0} ${w} ${h}" style="aspect-ratio:${w}/${h};width:${width}" preserveAspectRatio="xMinYMin meet"><image href="${PAGE_IMG(p)}" x="0" y="0" width="${PW}" height="${PH}"/></svg>`;
}
const crops = rects => `<div class="crops">${rects.map(cropSVG).join('')}</div>`;

function siblings(q) {
  const qs = S.chapterQs.get(q.ch); const i = qs.indexOf(q);
  return { prev: qs[i - 1], next: qs[i + 1], i, n: qs.length };
}

function renderQuestion(qid) {
  const q = S.byId.get(qid); if (!q) return renderDashboard();
  const c = chapter(q.ch);
  const a = attempt(qid);
  const d = q.dir && S.data.directions[q.dir];
  const g = q.solgrp && S.data.solgroups[q.solgrp];
  const { prev, next, i, n } = siblings(q);
  S.progress.last = qid; save();

  const html = `<div class="crumbs"><a href="#/">Dashboard</a> › <a href="#/ch/${c.id}">${esc(c.title)}</a> › ${i + 1} of ${n}</div>
  <div class="qhead">
    <div>
      <h1>Question ${q.n}${q.sub ? ` <span class="muted" style="font-weight:400">· ${esc(q.sub)}</span>` : ''}</h1>
      <div class="row">
        <span class="badge">${q.year ? 'CAT ' + q.year : 'year not stated'}</span>
        <span class="badge">${q.type === 'MCQ' ? 'MCQ' : 'TITA · type the answer'}</span>
        <span class="badge ${negMark(q) ? 'bad' : 'ok'}">${negMark(q) ? '+3 / −1 negative marking' : '+3 / no negative marking'}</span>
        <button class="btn small" data-bm>${S.progress.bookmarks[qid] ? '★ Bookmarked' : '☆ Bookmark'}</button>
      </div>
    </div>
    <div class="timer" id="timer"><span id="clock">0:00</span><button class="btn small" data-pause>Pause</button></div>
  </div>
  ${d ? `<details class="panel" open><summary>${d.range ? `Directions for Q ${d.range[0]}–${d.range[1]}` : 'Directions'}</summary>${crops(d.rects)}</details>` : ''}
  <div class="panel qimg">${crops(q.rects)}</div>
  <div id="answer">${answerHTML(q, a)}</div>
  <div id="after">${a ? afterHTML(q, a, g) : ''}</div>
  <div class="navbar">
    <span>${prev ? `<a class="btn" href="#/q/${prev.id}">← Q${prev.n}</a>` : ''}</span>
    <span class="hint"><kbd>A</kbd>–<kbd>D</kbd> pick · <kbd>Enter</kbd> submit · <kbd>N</kbd> next · <kbd>P</kbd> previous</span>
    <span>${next ? `<a class="btn" href="#/q/${next.id}">Q${next.n} →</a>` : `<a class="btn" href="#/ch/${c.id}">Done with chapter</a>`}</span>
  </div>`;
  app().innerHTML = html;
  window.scrollTo(0, 0);
  $('[data-bm]').onclick = () => { S.progress.bookmarks[qid] = !S.progress.bookmarks[qid]; save(); $('[data-bm]').textContent = S.progress.bookmarks[qid] ? '★ Bookmarked' : '☆ Bookmark'; };
  $('[data-pause]').onclick = () => S.timer.running ? pauseTimer() : resumeTimer();
  bindAnswer(q);
  if (a) { bindAfter(q, a, g); $('#timer').classList.add('paused'); $('#clock').textContent = fmtTime(a.time); $('[data-pause]').style.display = 'none'; }
  else startTimer();
}

function answerHTML(q, a) {
  if (a) {
    if (q.type === 'MCQ' && q.opts) {
      return `<div class="options">${['a', 'b', 'c', 'd'].map(o => `<button class="opt ${o === q.ans ? 'ok' : o === a.ans ? (a.result === 'wrong' ? 'bad' : 'sel') : ''}" disabled>${o}</button>`).join('')}</div>`;
    }
    return `<p>Your answer: <b>${esc(a.ans) || '—'}</b>${q.ans ? ` · Key: <b>${esc(q.ans)}</b>` : ''}</p>`;
  }
  if (q.type === 'MCQ' && q.opts) {
    return `<div class="options">${['a', 'b', 'c', 'd'].map(o => `<button class="opt" data-opt="${o}">${o}</button>`).join('')}</div>
      <div class="row"><button class="btn primary" data-submit disabled>Submit</button><button class="btn" data-skip>Skip · show solution</button></div>`;
  }
  return `<div class="tita"><input type="text" data-tita placeholder="${q.type === 'MCQ' ? 'Option letter (a–d) – options are in the directions' : 'Type your answer'}" autocomplete="off"></div>
    <div class="row"><button class="btn primary" data-submit disabled>Submit</button><button class="btn" data-skip>Skip · show solution</button></div>`;
}

function bindAnswer(q) {
  const sub = $('[data-submit]'); if (!sub) return;
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
  const skipped = ans === null;
  const a = { ans: ans || '', result: skipped ? 'wrong' : grade(q, ans), time: t, at: Date.now(), n: (prevA ? prevA.n : 0) + 1, skipped };
  S.progress.attempts[q.id] = a; save();
  $('#answer').innerHTML = answerHTML(q, a);
  const g = q.solgrp && S.data.solgroups[q.solgrp];
  $('#after').innerHTML = afterHTML(q, a, g);
  bindAfter(q, a, g);
  $('#timer').classList.add('paused'); $('[data-pause]').style.display = 'none';
  S._pick = null; S._submit = null;
}

function afterHTML(q, a, g) {
  const r = a.result;
  const label = a.skipped ? 'Skipped · counted as wrong' : r === 'correct' ? 'Correct' : r === 'wrong' ? 'Wrong' : 'Check against the solution';
  const sub = r === 'unmarked'
    ? `<div class="small">No answer key could be read for this question. Mark it yourself: <button class="btn small" data-mark="correct">I was right</button> <button class="btn small" data-mark="wrong">I was wrong</button></div>`
    : `<span class="small">${fmtTime(a.time)} · ${r === 'correct' ? '+3' : negMark(q) && !a.skipped ? '−1' : '0'} marks${q.ans ? ' · key: ' + esc(q.ans).toUpperCase() : ''} · <button class="btn small" data-retry>Retry</button></span>`;
  return `<div class="result ${r}">${label} ${sub}</div>
  <details class="panel" open><summary>Solution</summary>${g ? crops(g.rects) : ''}${q.sol ? crops(q.sol.rects) : '<p class="muted">No solution was found for this question in the book.</p>'}</details>
  <details class="panel" id="ai" open><summary>AI tutor</summary>
    <div class="chat" id="chat"></div>
    <div class="row" style="margin-top:10px">
      <button class="btn small" data-ai="hint">Give me a hint</button>
      <button class="btn small" data-ai="explain">Explain the solution</button>
      <button class="btn small" data-ai="why">Why is my answer wrong?</button>
    </div>
    <div class="chat-input"><textarea data-ai-input placeholder="Ask anything about this question…"></textarea><button class="btn primary" data-ai="ask">Send</button></div>
    <p class="hint">${S.settings.apiKey ? `Uses ${esc(S.settings.model)} with your API key.` : 'Add your Anthropic API key in <a href="#/settings">Settings</a> to use the tutor.'}</p>
  </details>`;
}

function bindAfter(q, a, g) {
  app().querySelectorAll('[data-mark]').forEach(b => b.onclick = () => {
    a.result = b.dataset.mark; save();
    $('#after').innerHTML = afterHTML(q, a, g); bindAfter(q, a, g);
    $('#answer').innerHTML = answerHTML(q, a);
  });
  const retry = $('[data-retry]');
  if (retry) retry.onclick = () => { delete S.progress.attempts[q.id]; save(); renderQuestion(q.id); };
  app().querySelectorAll('[data-ai]').forEach(b => b.onclick = () => askAI(q, a, b.dataset.ai));
  const ta = $('[data-ai-input]');
  if (ta) ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askAI(q, a, 'ask'); } };
}

/* ---------- timer ---------- */
function startTimer() {
  S.timer = { acc: 0, start: Date.now(), running: true, iv: setInterval(tick, 500) };
  tick();
}
function elapsed() { if (!S.timer) return 0; return S.timer.acc + (S.timer.running ? (Date.now() - S.timer.start) / 1000 : 0); }
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
function stopTimer() {
  if (!S.timer) return 0;
  const t = elapsed(); clearInterval(S.timer.iv); S.timer = null; return t;
}

/* ---------- keyboard ---------- */
function onKey(e) {
  if (e.target.matches('input, textarea, select')) return;
  const k = e.key.toLowerCase();
  if (!location.hash.startsWith('#/q/')) return;
  if (/^[a-d]$/.test(k) && S._pick) return S._pick(k);
  if (/^[1-4]$/.test(k) && S._pick) return S._pick('abcd'[+k - 1]);
  if (k === 'enter' && S._submit) return S._submit();
  const q = S.byId.get(location.hash.slice(4)); if (!q) return;
  const { prev, next } = siblings(q);
  if (k === 'n' && next) location.hash = '#/q/' + next.id;
  if (k === 'p' && prev) location.hash = '#/q/' + prev.id;
}

/* ---------- AI tutor (Anthropic Messages API, called directly from the browser) ---------- */
const TUTOR_SYSTEM = `You are a tutor for the CAT (Common Admission Test, India). The student is practising a past-paper question from a solved-papers book. You get the question as an image cropped from the book (plus the directions/data set when there is one), a rough text extraction that may garble maths, and, when known, the answer key.
Rules: use plain text with simple inline maths (no LaTeX). Be concise and concrete. For a "hint" give one nudge that unlocks the next step and never state the final answer. For "explain" give a clean step-by-step solution and end with the final answer. For "why wrong" first find the student's likely error, then correct it. If the extraction and the image disagree, trust the image. Mention exam strategy (time, elimination, when to skip) only when it is genuinely useful.`;

async function questionImage(q) {
  // Compose the crops onto a canvas and return base64 JPEG.
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
function loadImg(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; }); }

async function askAI(q, a, mode) {
  const chat = $('#chat'); if (!chat) return;
  if (!S.settings.apiKey) { chat.insertAdjacentHTML('beforeend', `<div class="msg err">Add your Anthropic API key in Settings first.</div>`); return; }
  const ta = $('[data-ai-input]');
  let userText;
  if (mode === 'hint') userText = 'Give me a hint for this question. Do not reveal the answer.';
  else if (mode === 'explain') userText = 'Explain how to solve this question step by step, then give the final answer.';
  else if (mode === 'why') userText = `I answered "${a.ans || '(skipped)'}"${q.ans ? ` and the key says "${q.ans}"` : ''}. Why is my answer wrong, and what is the right approach?`;
  else { userText = (ta.value || '').trim(); if (!userText) return; ta.value = ''; }

  if (!S.chat) {
    const img = await questionImage(q).catch(() => null);
    const ctxText = `Chapter: ${chapter(q.ch).title}. ${q.year ? 'CAT ' + q.year + '. ' : ''}Type: ${q.type}. ${q.ans ? 'Answer key: ' + q.ans + '.' : 'Answer key not available.'}\nDirections (text extraction): ${q.dir ? S.data.directions[q.dir].text : '(none)'}\nQuestion (text extraction): ${q.text}`;
    const content = [];
    if (img) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } });
    content.push({ type: 'text', text: ctxText });
    S.chat = { messages: [{ role: 'user', content }, { role: 'assistant', content: 'Understood. I have the question. What do you need?' }] };
  }
  S.chat.messages.push({ role: 'user', content: userText });
  chat.insertAdjacentHTML('beforeend', `<div class="msg user">${esc(userText)}</div><div class="msg ai">…</div>`);
  const out = chat.lastElementChild;
  app().querySelectorAll('[data-ai]').forEach(b => b.disabled = true);
  try {
    const text = await streamClaude(S.chat.messages, t => { out.textContent = t; });
    S.chat.messages.push({ role: 'assistant', content: text });
  } catch (err) {
    S.chat.messages.pop();
    out.className = 'msg err'; out.textContent = 'Request failed: ' + err.message;
  } finally {
    app().querySelectorAll('[data-ai]').forEach(b => b.disabled = false);
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
  app().innerHTML = `<h1>Settings</h1>
  <div class="form">
    <h2>AI tutor</h2>
    <label>Anthropic API key</label><input type="password" data-key value="${esc(S.settings.apiKey)}" placeholder="sk-ant-…">
    <p class="notice">Stored only in this browser (localStorage) and sent straight to api.anthropic.com from your browser. Create one at console.anthropic.com.</p>
    <label>Model</label>
    <select data-model>
      <option value="claude-opus-5-5">Claude Opus 5.5 (recommended)</option>
      <option value="claude-sonnet-5-5">Claude Sonnet 5.5 (cheaper)</option>
      <option value="claude-haiku-5-5">Claude Haiku 5.5 (cheapest)</option>
    </select>
    <p><button class="btn primary" data-save>Save</button> <span class="muted small" id="saved"></span></p>

    <h2>Progress</h2>
    <p class="muted small">${st.attempted} attempts, ${Object.keys(S.progress.bookmarks).filter(k => S.progress.bookmarks[k]).length} bookmarks, ${fmtTime(st.time)} recorded. Progress is kept in this browser only; export it to move between devices.</p>
    <p class="row"><button class="btn" data-export>Export JSON</button><button class="btn" data-import>Import JSON</button><input type="file" accept="application/json" data-file hidden><button class="btn danger" data-reset>Reset all progress</button></p>

    <h2>Appearance</h2>
    <select data-theme><option value="">System</option><option value="light">Light</option><option value="dark">Dark</option></select>
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
  init().catch(err => { app().innerHTML = `<p class="muted">Could not load data: ${esc(err.message)}</p>`; });
})();
