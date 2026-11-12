/* CAT Prep – topic-wise past-paper practice.
   Plain JS, no build step. Data comes from data/questions.json and the page
   images in img/pages/. Progress lives in localStorage (export/import in Settings). */
'use strict';

const DATA_URL = 'data/questions.json';
const PAGE_IMG = p => typeof p === 'number' ? `img/pages/p-${String(p).padStart(3, '0')}.webp` : `img/pages/${p}.webp`;
const pageSize = p => (typeof p !== 'number' && S.data.pageSizes && S.data.pageSizes[String(p).split('-')[0]]) || S.data.pageSize;
const STORE_KEY = 'catprep.progress.v1';
const SETTINGS_KEY = 'catprep.settings.v1';
const MARKS = { correct: 3, wrongMCQ: -1, wrongTITA: 0 };
const LETTERS = ['a', 'b', 'c', 'd', 'e'];

const S = {
  data: null, byId: new Map(), chapterQs: new Map(), units: new Map(), unitOf: new Map(),
  progress: load(STORE_KEY, { attempts: {}, bookmarks: {}, sets: {}, last: null }),
  settings: load(SETTINGS_KEY, { apiKey: '', model: 'claude-opus-5-5', panelW: 400, panelOpen: false, textMode: true, examDate: '2026-11-29' }),
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
  if (S.data.chapters.some(c => c.section === 'PAPERS')) S.data.sections.PAPERS = 'Full papers';
  const secOf = {}; S.data.chapters.forEach(c => { secOf[c.id] = c.section; });
  for (const q of S.data.questions) {
    if (!q.sec) q.sec = secOf[q.ch];
    S.byId.set(q.id, q);
    if (!S.chapterQs.has(q.ch)) S.chapterQs.set(q.ch, []);
    S.chapterQs.get(q.ch).push(q);
  }
  // units: a set of questions sharing one directions block, or a single question
  for (const [ch, qs] of S.chapterQs) {
    const list = [];
    for (const q of qs) {
      const last = list[list.length - 1];
      const shared = q.dir && isContentDir(S.data.directions[q.dir]);
      if (shared && last && last.dir === q.dir) last.qs.push(q);
      else list.push({ id: shared ? q.dir : q.id, dir: shared ? q.dir : null, note: !shared && q.dir ? q.dir : null, qs: [q], ch });
    }
    list.forEach((u, i) => { u.i = i; u.list = list; for (const q of u.qs) S.unitOf.set(q.id, u); });
    S.units.set(ch, list);
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', flushUnit);
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', () => { if (document.hidden && S.t && S.t.running) pause(true); });
  document.querySelectorAll('#nav a[data-ic]').forEach(a => a.insertAdjacentHTML('afterbegin', icon(a.dataset.ic)));
  initDock(); initStrategy(); initPanel();
  route();
}

const chapter = id => S.data.chapters.find(c => c.id === id);
// A directions block is shared content (passage, data set, option definitions) rather than a
// one-line instruction when it is long, holds a table, or is a tall image region.
function isContentDir(d) {
  if (!d) return false;
  if (d.tx && d.tx.some(b => b.t === 'table')) return true;
  if ((d.text || '').length >= 300) return true;
  const h = d.rects.reduce((t, r) => t + (r[4] - r[2]), 0);
  return !d.tx && h >= 90;
}
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
// Approximate 99th-percentile targets per section for a 40-minute section,
// from coaching-institute estimates for recent CAT papers (not official).
const TARGETS = {
  QA:   { attempts: '15 of 22', accuracy: 85, perAttempt: 2.4, time: 160 },
  DILR: { attempts: '13 of 22', accuracy: 85, perAttempt: 2.4, time: 180 },
  VARC: { attempts: '18 of 24', accuracy: 85, perAttempt: 2.4, time: 130 },
};
const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
const accuracy = st => st.correct + st.wrong ? pct(st.correct, st.correct + st.wrong) + '%' : null;

/* ---------- icons (inline SVG, 24px grid, stroke = currentColor) ---------- */
const ICON_PATHS = {
  overview: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.8"/>',
  QA: '<path d="M18 5H7l6 7-6 7h11"/>',
  DILR: '<path d="M4 20h16"/><path d="M7 16v-5M12 16V6M17 16v-8"/>',
  VARC: '<path d="M3.5 5.5c2.8-1.3 5.7-1.3 8.5 0v13.5c-2.8-1.3-5.7-1.3-8.5 0z"/><path d="M20.5 5.5c-2.8-1.3-5.7-1.3-8.5 0v13.5c2.8-1.3 5.7-1.3 8.5 0z"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  chev: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  play: '<path d="M9 6.5v11l9-5.5z" fill="currentColor" stroke="none"/>',
  attempted: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.3l2.4 2.4 4.6-4.9"/>',
  accuracy: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  score: '<path d="M4 16.5l5-5 3.5 3.5L20 7.5"/><path d="M15 7.5h5v5"/>',
  time: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  flag: '<path d="M6 21V4"/><path d="M6 4.5h11l-2 4 2 4H6"/>',
  PAPERS: '<path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/><path d="M14 3.5v4h4"/><path d="M9 12h6M9 16h6"/>',
  notes: '<path d="M6.5 3.5h8l3.5 3.5v13.5h-11.5z"/><path d="M14.5 3.5v3.5h3.5"/><path d="M9.5 11.5h5.5M9.5 15h5.5"/>',
  reading: '<path d="M4.5 5.5h6a2 2 0 0 1 2 2v12a1.5 1.5 0 0 0-1.5-1.5h-6.5z"/><path d="M19.5 5.5h-6a2 2 0 0 0-2 2v12a1.5 1.5 0 0 1 1.5-1.5h6.5z"/>',
  link: '<path d="M10 14L20 4"/><path d="M15 4h5v5"/><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/>',
  tick: '<path d="M7 12.5l3.2 3.2L17 9"/>',
};
const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
function ring(st) {
  const r = 9, c = 2 * Math.PI * r;
  const f = st.total ? st.attempted / st.total : 0;
  const len = f ? Math.max(f, 0.035) * c : 0;
  return `<svg class="ring" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="${r}" class="ring-bg"/>${len ? `<circle cx="12" cy="12" r="${r}" class="ring-fg" stroke-dasharray="${len.toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 12 12)"/>` : ''}</svg>`;
}

/* ---------- routing ---------- */
function route() {
  flushUnit();
  S.unit = null; S.picks = {};
  closeStrategy(true);
  const h = location.hash || '#/';
  const m = h.match(/^#\/(ch|q|sec)\/([^/?]+)/);
  S.routeSec = (h.match(/[?&]sec=(QA|DILR|VARC)/) || [])[1] || null;
  if (m && m[1] === 'q' && !S.byId.has(m[2])) { location.hash = '#/'; return; }
  const isQ = !!(m && m[1] === 'q');
  const navKey = h.startsWith('#/settings') ? 'settings' : h.startsWith('#/reading') || h.startsWith('#/read/') ? 'reading' : h.startsWith('#/notes') ? 'notes' : m && m[1] === 'sec' ? m[2] : m ? chapter(m[1] === 'q' ? S.byId.get(m[2]).ch : m[2]).section : 'home';
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.nav === navKey));
  const onTab = $('#nav a.on'); if (onTab) { const n = $('#nav'); n.scrollLeft = Math.max(0, onTab.offsetLeft - (n.clientWidth - onTab.offsetWidth) / 2); }
  document.body.classList.toggle('wide', isQ);
  document.body.classList.toggle('has-dock', isQ);
  $('#dock').hidden = !isQ; $('#dock-meta').hidden = !isQ;
  $('#ai-toggle').hidden = !isQ;
  if (!isQ) closePanel(true);
  if (h.startsWith('#/settings')) renderSettings();
  else if (h.startsWith('#/notes')) renderNotes();
  else if (h.startsWith('#/read/')) renderReader(decodeURIComponent(h.slice(7)));
  else if (h.startsWith('#/reading')) renderReading();
  else if (m && m[1] === 'ch') renderChapter(m[2]);
  else if (m && m[1] === 'sec') renderSection(m[2]);
  else if (isQ) renderUnit(m[2]);
  else renderDashboard();
  window.scrollTo(0, 0);
}

/* ---------- dashboard ---------- */
function renderDashboard() {
  const last = S.progress.last && S.byId.get(S.progress.last);
  const exam = new Date((S.settings.examDate || '2026-11-29') + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((exam - today) / 86400000);
  const when = exam.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  let html = `<div class="hero">
    <h1>${days > 1 ? days + ' days to CAT' : days === 1 ? 'CAT is tomorrow' : days === 0 ? 'CAT is today' : 'CAT was ' + (-days) + ' days ago'}</h1>
    <p class="lead">${when}</p>
    ${last ? `<a class="resume" href="#/q/${last.id}"><span class="play">${icon('play')}</span><span class="rt"><small>Resume</small>${esc(chapter(last.ch).title)} · Q${last.n}</span></a>` : ''}
  </div>`;
  for (const [sec, name] of Object.entries(S.data.sections)) {
    if (sec === 'PAPERS') continue;
    const st = stats(S.data.questions.filter(q => q.sec === sec));
    html += `<a class="secbox" href="#/sec/${sec}" title="Open ${esc(name)}">
      <div class="secbox-head"><span class="sh"><span class="badge-ic">${icon(sec)}</span><span class="full">${esc(name)}</span><span class="short">${{ QA: 'Quant', DILR: 'DILR', VARC: 'VARC' }[sec]}</span></span><span class="go">${icon('arrow')}</span></div>
      ${metricsHTML(st, TARGETS[sec])}
    </a>`;
  }
  app().innerHTML = html;
}
const backBtn = (href, label) => `<a class="backbtn" href="${href}" title="Back to ${esc(label)}"><span class="bb">${icon('chev')}</span><span>${esc(label)}</span></a>`;
function metricsHTML(st, t) {
  const graded = st.correct + st.wrong;
  const acc = graded ? Math.round(100 * st.correct / graded) : null;
  const per = st.attempted ? st.score / st.attempted : null;
  const avg = st.attempted ? st.time / st.attempted : null;
  const grade = (v, ok) => v === null ? '' : ok ? 'good' : 'low';
  const cell = (ic, label, val, cls = '') => `<div class="m ${cls}"><span class="ml">${icon(ic)}${label}</span><b>${val}</b></div>`;
  const tcell = val => `<div class="m"><b>${val}</b></div>`;
  return `<div class="mgrid">
    ${cell('attempted', 'Attempted', st.attempted)}
    ${cell('accuracy', 'Accuracy', acc === null ? '–' : acc + '%', grade(acc, acc >= t.accuracy))}
    ${cell('score', 'Net score', (st.score > 0 ? '+' : '') + st.score + (per === null ? '' : `<small> ${per.toFixed(1)}/q</small>`), grade(per, per >= t.perAttempt))}
    ${cell('time', 'Avg time', avg === null ? '–' : fmtTime(avg), grade(avg, avg <= t.time))}
  </div>
  <div class="mgrid targets" title="Rough 99th-percentile targets for a 40-minute section (coaching-institute estimates, not official)">
    ${tcell(t.attempts.replace(' of ', ' / '))}
    ${tcell('≥ ' + t.accuracy + '%')}
    ${tcell('+' + t.perAttempt + '/q')}
    ${tcell('≤ ' + fmtTime(t.time))}
  </div>`;
}
function renderSection(sec) {
  const name = S.data.sections[sec]; if (!name) return renderDashboard();
  const chs = S.data.chapters.filter(c => c.section === sec);
  const papers = S.data.chapters.filter(c => c.section === 'PAPERS');
  const paperIds = new Set(papers.map(c => c.id));
  const ss = stats(sec === 'PAPERS' ? S.data.questions.filter(q => paperIds.has(q.ch)) : S.data.questions.filter(q => q.sec === sec));
  let html = `<div><h1 class="with-ic"><span class="badge-ic lg">${icon(sec)}</span>${esc(name)}</h1>`;
  const row = (c, label, qs, href) => { const cs = stats(qs); return `<a class="row crow" href="${href}"><span class="n">${label}</span><span class="t">${esc(c.title)}</span><span class="prog">${ring(cs)}<span>${cs.attempted}<i> / ${cs.total}</i></span></span></a>`; };
  const resumeIn = (c, filter) => { const qs = (S.chapterQs.get(c.id) || []).filter(filter || (() => true)); const q = qs.find(x => !attempt(x.id)) || qs[0]; return q ? `#/q/${q.id}` : `#/ch/${c.id}`; };
  if (sec === 'PAPERS') {
    html += `<div class="rows" style="margin-top:22px">`;
    for (const c of papers) html += row(c, '', S.chapterQs.get(c.id) || [], resumeIn(c));
    html += '</div>';
  } else {
    html += `<div class="rows" style="margin-top:22px">`;
    for (const c of chs) html += row(c, c.num, S.chapterQs.get(c.id) || [], `#/ch/${c.id}`);
    html += '</div>';
    if (papers.length) {
      html += `<h2>From full papers</h2><div class="rows">`;
      for (const c of papers) html += row(c, '', (S.chapterQs.get(c.id) || []).filter(q => q.sec === sec), resumeIn(c, q => q.sec === sec));
      html += '</div>';
    }
  }
  app().innerHTML = html + '</div>';
}

/* ---------- chapter ---------- */
const ERAS = [['r:2010-2016', '2010–2016'], ['r:2000-2009', '2000–2009'], ['r:1993-1999', '1993–1999']];
function yearMatch(q, v) {
  if (v === 'all') return true;
  if (v.startsWith('r:')) { const [a, b] = v.slice(2).split('-').map(Number); return q.year >= a && q.year <= b; }
  return String(q.year) === v;
}
function pill(attr, value, def, options) {
  return `<label class="pill ${value !== def ? 'on' : ''}"><select ${attr}>${options}</select></label>`;
}
function renderChapter(chId) {
  const c = chapter(chId); if (!c) return renderDashboard();
  const qs = S.chapterQs.get(chId) || [];
  const f = S.filters[chId] || (S.filters[chId] = { year: 'all', status: 'all', sub: 'all', sort: 'book', sec: 'all' });
  const count = {}; qs.forEach(q => { if (q.year) count[q.year] = (count[q.year] || 0) + 1; });
  const years = Object.keys(count).map(Number).sort((a, b) => b - a);
  const match = q => yearMatch(q, f.year) && (f.sub === 'all' || q.sub === f.sub) && matchStatus(q, f.status);
  const isPaper = c.section === 'PAPERS';
  if (isPaper && S.routeSec) f.sec = S.routeSec; else if (!isPaper) f.sec = 'all';
  let units = S.units.get(chId).map(u => ({ u, qs: u.qs.filter(q => match(q) && (!isPaper || !f.sec || f.sec === 'all' || q.sec === f.sec)) })).filter(x => x.qs.length);
  if (f.sort !== 'book') units = units.slice().sort((a, b) => ((b.qs[0].year || 0) - (a.qs[0].year || 0)) * (f.sort === 'new' ? 1 : -1));
  const cs = stats(qs);
  const firstU = units.find(x => x.qs.some(q => !attempt(q.id))) || units[0];
  const eraCount = v => qs.filter(q => yearMatch(q, v)).length;
  const yearOpts = isPaper ? '' : `<option value="all">All years</option>
    <optgroup label="Periods">${ERAS.map(([v, l]) => eraCount(v) ? `<option value="${v}">${l} · ${eraCount(v)}</option>` : '').join('')}</optgroup>
    <optgroup label="Year">${years.map(y => `<option value="${y}">${y} · ${count[y]}</option>`).join('')}</optgroup>`;
  let html = `<div>${backBtn('#/sec/' + c.section, S.data.sections[c.section])}
  <h1 class="with-ic"><span class="badge-ic lg">${icon(c.section)}</span>${esc(c.title)}</h1>
  <div class="filterbar">
    <div class="pills">
      ${isPaper ? '' : pill('data-year', f.year, 'all', yearOpts)}
      ${pill('data-status', f.status, 'all', '<option value="all">Any status</option><option value="new">Not attempted</option><option value="correct">Correct</option><option value="wrong">Wrong</option><option value="unmarked">Unmarked</option><option value="bookmarked">Bookmarked</option>')}
      ${c.subtopics.length ? pill('data-sub', f.sub, 'all', `<option value="all">All topics</option>${c.subtopics.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('')}`) : ''}
      ${isPaper ? pill('data-sec', f.sec || 'all', 'all', '<option value="all">All sections</option><option value="VARC">VARC</option><option value="DILR">DILR</option><option value="QA">Quant</option>') : pill('data-sort', f.sort, 'book', '<option value="book">Book order</option><option value="new">Newest first</option><option value="old">Oldest first</option>')}
      ${f.year !== 'all' || f.status !== 'all' || f.sub !== 'all' || f.sort !== 'book' || (f.sec && f.sec !== 'all') ? '<a class="clear" data-clear>Clear</a>' : ''}
    </div>
    <div class="fb-right">${firstU ? `<a class="btn primary" href="#/q/${(firstU.qs.find(q => !attempt(q.id)) || firstU.qs[0]).id}">Start</a>` : ''}</div>
  </div><div class="rows">`;
  let lastSec = null;
  for (const { u, qs: uq } of units) {
    const first = uq[0], lastQ = uq[uq.length - 1];
    if (isPaper && first.sec !== lastSec) { lastSec = first.sec; html += `<div class="rowhead">${esc(S.data.sections[first.sec] || first.sec)}</div>`; }
    const label = uq.length > 1 ? `${first.n}–${lastQ.n}` : `${first.n}`;
    const st = stats(uq);
    const types = [...new Set(uq.map(q => q.type))].join(' + ');
    html += `<a class="row" href="#/q/${(uq.find(q => !attempt(q.id)) || first).id}">
      <span class="n">${label}</span>
      <span class="t">${isPaper ? esc(unitLabel(u, uq)) : (first.year ? 'CAT ' + first.year : '<span class="muted">year not stated</span>') + (first.sub ? ' · ' + esc(first.sub) : '') + (uq.length > 1 ? ` · ${uq.length} questions` : '')}${uq.some(q => S.progress.bookmarks[q.id]) ? ' ★' : ''}<span class="dots">${uq.map(q => `<span class="dot ${attempt(q.id) ? attempt(q.id).result : ''}"></span>`).join('')}</span></span>
      <span class="r">${types}${st.time ? ' · ' + fmtTime(st.time) : ''}</span></a>`;
  }
  html += `</div>${units.length ? '' : '<p class="muted small" style="margin-top:14px">Nothing matches these filters.</p>'}</div>`;
  app().innerHTML = html;
  const bind = (attr, key) => { const el = $(`[${attr}]`); if (!el) return; el.value = f[key]; el.onchange = e => { f[key] = e.target.value; renderChapter(chId); }; };
  bind('data-year', 'year'); bind('data-status', 'status'); bind('data-sub', 'sub'); bind('data-sort', 'sort');
  const sb = $('[data-sec]'); if (sb) { sb.value = f.sec || 'all'; sb.onchange = e => { S.routeSec = null; f.sec = e.target.value; renderChapter(chId); }; }
  const clr = $('[data-clear]'); if (clr) clr.onclick = () => { S.routeSec = null; Object.assign(f, { year: 'all', status: 'all', sub: 'all', sort: 'book', sec: 'all' }); renderChapter(chId); };
}
function unitLabel(u, uq) {
  const clip = (t, n) => { t = (t || '').replace(/^Directions?\s*\(Q\.?\s*Nos?\.?[^)]*\)\s*/i, '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t; };
  if (uq.length > 1) {
    const d = u.dir && S.data.directions[u.dir];
    let t = '';
    if (d && d.tx) { const b = d.tx.find(x => x.t === 'p' && x.text.length > 40 && !/^(Directions?|PASSAGE|Passage)\b/i.test(x.text)); t = b ? b.text : d.tx.map(x => x.text || '').join(' '); }
    else if (d) t = d.text;
    return `${uq.length} questions · ${clip(t, 70)}`;
  }
  const q = uq[0];
  return clip(q.tx ? q.tx.stem.join(' ') : q.text.replace(/^\d{1,3}[.)]\s*/, ''), 90);
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
  const [PW, PH] = pageSize(p);
  const width = `clamp(${Math.round(w)}px, 100%, ${Math.round(w * (scale || 2))}px)`;
  return `<svg class="crop" viewBox="${x0} ${y0} ${w} ${h}" style="aspect-ratio:${w}/${h};width:${width}" preserveAspectRatio="xMinYMin meet"><image href="${PAGE_IMG(p)}" x="0" y="0" width="${PW}" height="${PH}"/></svg>`;
}
const crops = (rects, scale) => `<div class="crops">${rects.map(r => cropSVG(r, scale)).join('')}</div>`;
const useText = () => S.settings.textMode !== false;
const parasHTML = paras => `<div class="tx">${paras.map(p => `<p>${esc(p)}</p>`).join('')}</div>`;
function blocksHTML(blocks) {
  return `<div class="tx">${blocks.map(b => b.t === 'table'
    ? `<table class="dt">${b.rows.map((r, i) => `<tr>${r.map(c => `<${i === 0 ? 'th' : 'td'}>${esc(c)}</${i === 0 ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</table>`
    : `<p>${esc(b.text)}</p>`).join('')}</div>`;
}

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

  const isPaper = c.section === 'PAPERS';
  const note = u.note && S.data.directions[u.note];
  const pos = isPaper ? ` · ${u.list.slice(0, u.i).reduce((n, x) => n + x.qs.length, 0) + 1}${u.qs.length > 1 ? '–' + (u.list.slice(0, u.i + 1).reduce((n, x) => n + x.qs.length, 0)) : ''} of ${S.chapterQs.get(c.id).length}` : '';
  $('#dock-meta').innerHTML = `<b>${isPaper ? ({ QA: 'Quant', DILR: 'DILR', VARC: 'VARC' }[first.sec] || first.sec) : (first.year ? 'CAT ' + first.year : 'year not stated')}</b>${pos} · ${types.map(t => t === 'MCQ' ? 'MCQ' : 'TITA').join(' + ')} · <span class="${neg ? 'neg' : 'noneg'}">${neg ? '+3 / −1' : '+3 / no negative'}</span>`;
  app().innerHTML = `<div class="umeta ${d ? '' : 'single'}">${backBtn(isPaper ? '#/sec/PAPERS' : '#/ch/' + c.id, c.title)}</div>
  ${note ? `<div class="note-dir">${useText() && note.tx ? esc(note.tx.map(b => b.text || '').join(' ')) : crops(note.rects, 1.4)}</div>` : ''}
  <div class="unit ${d ? 'has-ctx' : ''}">
    ${d ? `<div class="context">${useText() && d.tx ? blocksHTML(d.tx) : crops(d.rects, 1.6)}</div>` : ''}
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
  const tx = useText() && q.tx;
  return `<div class="qblock ${a ? 'done' : ''}" id="qb-${q.id}" data-q="${q.id}">
    <div class="qhead"><span>Q${q.n}${tx ? ' <a class="orig" data-orig="' + q.id + '">original</a>' : ''}</span><span><span class="qt" id="qt-${q.id}">${a ? fmtTime(a.time) : ''}</span> <a class="bm" data-bm="${q.id}">${S.progress.bookmarks[q.id] ? '★' : '☆'}</a></span></div>
    <div class="stem">${tx ? parasHTML(tx.stem) : crops(stemRects, 1.6)}</div>
    ${q.fix ? `<p class="erratum">${esc(q.fix)}</p>` : ''}
    <div class="answer" id="ans-${q.id}">${answerHTML(q, a)}</div>
    <div id="after-${q.id}">${a ? afterHTML(q, a) : ''}</div>
  </div>`;
}

function answerHTML(q, a) {
  const cls = (o) => !a ? '' : o === q.ans ? 'ok' : o === a.ans ? (a.result === 'wrong' ? 'bad' : 'sel') : '';
  const dis = a ? 'disabled' : '';
  if (q.optRects) {
    const tx = useText() && q.tx && q.tx.opts;
    return `<div class="opts">${q.optRects.map((r, i) => `<button class="opt ${cls(LETTERS[i])}" data-opt="${LETTERS[i]}" ${dis}><span class="l">${LETTERS[i].toUpperCase()}</span>${tx ? `<span class="ot">${esc(tx[i])}</span>` : crops(r, 1.6)}</button>`).join('')}</div>`;
  }
  if (q.type === 'MCQ') {
    // options defined once in the directions (Data Sufficiency sets etc.)
    const so = sharedOptions(q);
    if (so) return `<div class="opts">${so.map((t, i) => `<button class="opt ${cls(LETTERS[i])}" data-opt="${LETTERS[i]}" ${dis}><span class="l">${LETTERS[i].toUpperCase()}</span><span class="ot">${esc(t)}</span></button>`).join('')}</div>`;
    // options are in the question image but could not be split out
    return `<div class="letters">${LETTERS.slice(0, 4).map(o => `<button class="opt ${cls(o)}" data-opt="${o}" ${dis}>${o}</button>`).join('')}</div>`;
  }
  if (a) return `<p class="small muted">Your answer: <b>${esc(a.ans) || '—'}</b>${q.ans ? ` · key: <b>${esc(q.ans)}</b>` : ''}</p>`;
  return `<div class="tita"><input type="text" data-tita placeholder="Your answer" autocomplete="off"></div>`;
}
const SHARED_CACHE = new Map();
function sharedOptions(q) {
  const d = q.dir && S.data.directions[q.dir];
  if (!d) return null;
  if (SHARED_CACHE.has(d.id)) return SHARED_CACHE.get(d.id);
  let out = null;
  const t = d.text.replace(/\(\s*(?:19|20)\d\d\s*\)/g, ' ');
  // greedy prefix so the LAST "(a)" is used (directions often say "from (a) to (d)" earlier)
  const m = t.match(/[\s\S]*\(a\)\s*([\s\S]*?)\s*\(b\)\s*([\s\S]*?)\s*\(c\)\s*([\s\S]*?)\s*\(d\)\s*([\s\S]*?)(?:\s*\(e\)\s*([\s\S]*?))?$/);
  if (m) {
    out = m.slice(1).filter(Boolean).map(x => x.replace(/\s+/g, ' ').trim());
    if (out.some(x => !x || x.length > 260)) out = null;
  }
  SHARED_CACHE.set(d.id, out);
  return out;
}

function bindQblock(q) {
  const el = $(`#qb-${q.id}`);
  const orig = el.querySelector('[data-orig]');
  if (orig) orig.onclick = e => { e.stopPropagation(); showOriginal(q); };
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
  <div class="sol"><div class="lbl">Solution</div>${g ? crops(g.rects, 1.6) : ''}${q.sol ? (useText() && q.sol.tx ? parasHTML(q.sol.tx) : crops(q.sol.rects, 1.6)) : '<p class="muted small">The book has no solution for this question.</p>'}</div>`;
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

function showOriginal(q) {
  const d = q.dir && S.data.directions[q.dir];
  openZoom(`${d ? crops(d.rects, 2.2) : ''}${crops(q.rects, 2.2)}`);
}
function openZoom(inner) {
  let z = $('#zoom');
  if (!z) { z = document.createElement('div'); z.id = 'zoom'; document.body.appendChild(z); z.onclick = e => { if (e.target === z) z.remove(); }; }
  z.innerHTML = `<div class="zoom-in">${inner}</div>`;
}
document.addEventListener('click', e => {
  const svg = e.target.closest('.crop');
  if (!svg || e.target.closest('.opt') || e.target.closest('#zoom')) return;
  if (window.innerWidth > 860) return;            // tap to zoom on small screens
  openZoom(svg.outerHTML.replace(/style="[^"]*"/, 'style="width:200%"'));
});

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
  if (i >= list.length) { location.hash = chapter(S.unit.ch).section === 'PAPERS' ? '#/sec/PAPERS' : '#/ch/' + S.unit.ch; return; }
  location.hash = '#/q/' + list[i].qs[0].id;
}
function updateDock() {
  if (!S.unit) return;
  const q = activeQ();
  const todo = S.unit.qs.filter(x => !attempt(x.id));
  const pick = q && S.picks[q.id];
  $('#submit').disabled = !(q && pick !== undefined && pick !== '');
  $('#reveal').disabled = !todo.length;
  const sq = strategyQ(), hasStrat = !!(sq && strategyKey(sq));
  $('#strat').hidden = !hasStrat;
  if (!hasStrat) closeStrategy(true);
  $('#pause').textContent = S.t && S.t.running ? '❚❚' : '▶';
  $('#pause').classList.toggle('off', !todo.length);
  $('.dock-time').classList.toggle('paused', !(S.t && S.t.running));
  $('#prev').classList.toggle('off', S.unit.i === 0);
  $('#next').textContent = S.unit.i + 1 < S.unit.list.length ? '→' : '✓';
  $('#next').title = S.unit.i + 1 < S.unit.list.length ? 'Next' : 'Back to chapter';
  tick();
}

/* ---------- reading list ---------- */
const READINGS = [
  ['Week 1 · clear writers, big ideas', [
    ['George Orwell', 'Politics and the English Language', 1946, 'Language', 'https://www.orwell.ru/library/essays/politics/english/e_polit', ['Nicholas Carr', 'Is Google Making Us Stupid?', 2008, 'Technology / reading', 'https://www.theatlantic.com/magazine/archive/2008/07/is-google-making-us-stupid/306868/']],
    ['Vannevar Bush', 'As We May Think', 1945, 'Technology', 'https://www.theatlantic.com/magazine/archive/1945/07/as-we-may-think/303881/', ['Lawrence Lessig', 'Code Is Law', 2000, 'Law / tech', 'https://www.harvardmagazine.com/2000/01/code-is-law-html']],
    ['Garrett Hardin', 'The Tragedy of the Commons', 1968, 'Ecology / economics', 'https://math.uchicago.edu/~shmuel/Modeling/Hardin,%20Tragedy%20of%20the%20Commons.pdf', ['Paul Crutzen', 'Geology of Mankind', 2002, 'Earth science', 'https://www.nature.com/articles/415023a', 'one page']],
    ['Bertrand Russell', 'In Praise of Idleness', 1932, 'Work and society', 'https://harpers.org/archive/1932/10/in-praise-of-idleness/', ['Daniel Kahneman & Angus Deaton', 'High Income Improves Evaluation of Life but Not Emotional Well-Being', 2010, 'Psychology / economics', 'https://www.pnas.org/doi/10.1073/pnas.1011492107']],
    ['Richard Feynman', 'There’s Plenty of Room at the Bottom', 1959, 'Physics', 'https://calteches.library.caltech.edu/1976/1/1960Bottom.pdf', ['Abhijit Banerjee & Esther Duflo', 'The Economic Lives of the Poor', 2007, 'Development economics', 'https://www.aeaweb.org/articles?id=10.1257/jep.21.1.141']],
    ['Stanley Milgram', 'Behavioral Study of Obedience', 1963, 'Psychology', 'https://doi.org/10.1037/h0040525', ['Cass Sunstein', 'Nudging: A Very Short Guide', 2014, 'Law / behaviour', 'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2499658']],
    ['Martin Luther King Jr.', 'Letter from Birmingham Jail', 1963, 'Rhetoric / ethics', 'https://www.africa.upenn.edu/Articles_Gen/Letter_Birmingham.html', ['Supreme Court of India', 'Shreya Singhal v. Union of India', 2015, 'Indian constitutional law', 'https://indiankanoon.org/doc/110813550/', 'the free-speech sections']],
  ]],
  ['Week 2 · denser arguments', [
    ['Alan Turing', 'Computing Machinery and Intelligence', 1950, 'AI / philosophy', 'https://academic.oup.com/mind/article/LIX/236/433/986238', 'sections 1–6', ['Emily Bender, Timnit Gebru et al.', 'On the Dangers of Stochastic Parrots', 2021, 'AI ethics', 'https://dl.acm.org/doi/10.1145/3442188.3445922']],
    ['F. A. Hayek', 'The Use of Knowledge in Society', 1945, 'Economics', 'https://www.econlib.org/library/Essays/hykKnw.html', ['Satoshi Nakamoto', 'Bitcoin: A Peer-to-Peer Electronic Cash System', 2008, 'Technology / finance', 'https://bitcoin.org/bitcoin.pdf']],
    ['Peter Singer', 'Famine, Affluence, and Morality', 1972, 'Ethics', 'https://rintintin.colorado.edu/~vancecd/phil308/Singer2.pdf', ['Jonathan Haidt', 'The Emotional Dog and Its Rational Tail', 2001, 'Moral psychology', 'https://doi.org/10.1037/0033-295X.108.4.814']],
    ['J. C. R. Licklider', 'Man-Computer Symbiosis', 1960, 'Human–computer interaction', 'https://groups.csail.mit.edu/medg/people/psz/Licklider.html', ['Shoshana Zuboff', 'Big Other: Surveillance Capitalism', 2015, 'Technology / society', 'https://doi.org/10.1057/jit.2015.5']],
    ['Mark Granovetter', 'The Strength of Weak Ties', 1973, 'Sociology', 'https://snap.stanford.edu/class/cs224w-readings/granovetter73weakties.pdf', 'skim past any maths', ['Thomas Piketty & Emmanuel Saez', 'Inequality in the Long Run', 2014, 'Economics', 'https://www.science.org/doi/10.1126/science.1251936']],
    ['Virginia Woolf', 'A Room of One’s Own', 1929, 'Literature', 'https://gutenberg.net.au/ebooks02/0200791h.html', 'chapter 1', ['Supreme Court of India', 'K. S. Puttaswamy v. Union of India', 2017, 'Indian law (privacy)', 'https://indiankanoon.org/doc/91938676/', 'Justice Chandrachud’s conclusions']],
    ['Aldo Leopold', 'The Land Ethic', 1949, 'Environment', 'https://www.aldoleopold.org/about/the-land-ethic/', ['Elinor Ostrom', 'Beyond Markets and States', 2010, 'Economics / governance', 'https://www.nobelprize.org/prizes/economic-sciences/2009/ostrom/lecture/', 'her Nobel lecture']],
  ]],
  ['Week 3 · the hardest stretch', [
    ['Thomas Nagel', 'What Is It Like to Be a Bat?', 1974, 'Philosophy of mind', 'https://www.sas.upenn.edu/~cavitch/pdf-library/Nagel_Bat.pdf', ['Joseph Henrich, Steven Heine & Ara Norenzayan', 'The Weirdest People in the World?', 2010, 'Psychology / anthropology', 'https://doi.org/10.1017/S0140525X0999152X', 'first sections and conclusion']],
    ['George Akerlof', 'The Market for “Lemons”', 1970, 'Economics', 'https://doi.org/10.2307/1879431', 'sections I–II', ['Lina Khan', 'Amazon’s Antitrust Paradox', 2017, 'Competition law', 'https://www.yalelawjournal.org/note/amazons-antitrust-paradox', 'introduction and conclusion']],
    ['Eugene Wigner', 'The Unreasonable Effectiveness of Mathematics in the Natural Sciences', 1960, 'Philosophy of science', 'https://www.maths.ed.ac.uk/~v1ranick/papers/wigner.pdf', ['Ashish Vaswani et al.', 'Attention Is All You Need', 2017, 'AI', 'https://arxiv.org/abs/1706.03762', 'introduction and conclusion only']],
    ['Amos Tversky & Daniel Kahneman', 'Judgment under Uncertainty: Heuristics and Biases', 1974, 'Decision-making', 'https://www.science.org/doi/10.1126/science.185.4157.1124', ['Daniel Kahneman & Gary Klein', 'Conditions for Intuitive Expertise: A Failure to Disagree', 2009, 'Psychology', 'https://doi.org/10.1037/a0016755']],
    ['Walter Benjamin', 'The Work of Art in the Age of Mechanical Reproduction', 1935, 'Art theory', 'https://www.marxists.org/reference/subject/philosophy/works/ge/benjamin.htm', ['Danielle Citron & Robert Chesney', 'Deep Fakes: A Looming Challenge for Privacy, Democracy, and National Security', 2019, 'Law / technology', 'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3213954', 'parts I–II']],
    ['Stephen Jay Gould & Richard Lewontin', 'The Spandrels of San Marco', 1979, 'Biology', 'https://royalsocietypublishing.org/doi/10.1098/rspb.1979.0086', ['Joseph Simmons, Leif Nelson & Uri Simonsohn', 'False-Positive Psychology', 2011, 'Psychology / research methods', 'https://doi.org/10.1177/0956797611417632']],
    ['Herbert Simon', 'The Architecture of Complexity', 1962, 'Systems thinking', 'https://www2.econ.iastate.edu/tesfatsi/ArchitectureOfComplexity.HSimon1962.pdf', ['Johan Rockström et al.', 'A Safe Operating Space for Humanity', 2009, 'Earth system science', 'https://www.nature.com/articles/461472a']],
  ]],
  ['Final days · lighter, to stay sharp', [
    ['Ronald Coase', 'The Nature of the Firm', 1937, 'Economics', 'https://onlinelibrary.wiley.com/doi/10.1111/j.1468-0335.1937.tb00002.x', ['Daniel Solove', '“I’ve Got Nothing to Hide” and Other Misunderstandings of Privacy', 2007, 'Privacy law', 'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=998565']],
    ['Karl Popper', 'Science: Conjectures and Refutations', 1963, 'Philosophy of science', 'https://www.stephenjaygould.org/ctrl/popper_falsification.html', ['John Ioannidis', 'Why Most Published Research Findings Are False', 2005, 'Science / statistics', 'https://journals.plos.org/plosmedicine/article?id=10.1371/journal.pmed.0020124']],
    ['Philip Anderson', 'More Is Different', 1972, 'Physics', 'https://cse-robotics.engr.tamu.edu/dshell/cs689/papers/anderson72more_is_different.pdf', 'a few pages', ['Nick Bostrom', 'Are You Living in a Computer Simulation?', 2003, 'Philosophy', 'https://www.simulation-argument.com/simulation.html']],
    ['Edmund Gettier', 'Is Justified True Belief Knowledge?', 1963, 'Epistemology', 'https://fitelson.org/proseminar/gettier.pdf', 'three pages', ['Rich Sutton', 'The Bitter Lesson', 2019, 'AI', 'http://www.incompleteideas.net/IncIdeas/BitterLesson.html', 'a two-page essay']],
  ]],
];
function renderReading() {
  const reads = S.progress.reads || (S.progress.reads = {});
  let day = 0;
  const rowHTML = (key, n, [author, title, year, field, url, note], second) => {
    if (Array.isArray(note)) note = null;
    const done = !!reads[key];
    return `<div class="row rrow ${done ? 'done' : ''} ${second ? 'second' : 'first'}">
      <button class="tickbtn" type="button" data-tick="${key}" aria-label="${done ? 'Mark unread' : 'Mark read'}" aria-pressed="${done}">${icon('tick')}</button>
      <span class="n">${second ? '' : n}</span>
      <span class="t"><span class="rtl"><a class="rtitle" href="#/read/${key}">${esc(title)}</a><a class="ext" href="${url}" target="_blank" rel="noopener" title="Open the original" aria-label="Open the original">${icon('link', 'lk')}</a></span>
        <span class="meta">${esc(author)} · ${year}${note ? ' · ' + esc(note) : ''}${RD.full && RD.full[key] ? ' · full text here' : ''}</span></span>
      <span class="r">${esc(field)}</span>
    </div>`;
  };
  const groups = READINGS.map(([head, items]) => `<div class="rowhead">${esc(head)}</div>` + items.map(item => {
    const n = ++day;
    const pair = Array.isArray(item[item.length - 1]) ? item[item.length - 1] : null;
    return rowHTML(String(n), n, item, false) + (pair ? rowHTML(n + 'b', n, pair, true) : '');
  }).join('')).join('');
  app().innerHTML = `<h1 class="with-ic"><span class="badge-ic lg">${icon('reading')}</span>Reading</h1>
  <p class="lead rlead">Improve your reading muscle. Two pieces a day for 25 days: a classic and a modern one that answers or extends it, rising in difficulty and jumping between fields, the way CAT passages do. Read for the argument, not the facts: what is being claimed, how it is built, and where you would push back. Open any title for a short brief, and for the pieces that are free to copy, the full text, so you can read it here.</p>
  <div class="rows">${groups}</div>`;
  document.querySelectorAll('[data-tick]').forEach(b => b.onclick = () => {
    const n = b.dataset.tick; if (reads[n]) delete reads[n]; else reads[n] = Date.now(); save(); renderReading();
  });
  if (!RD.full) loadReadingData().then(() => { if (location.hash.startsWith('#/reading')) renderReading(); });
}

/* ---------- strategy (popover above the dock; bottom sheet on phones) ---------- */
const PJ_SIGNALS = [
  ['Noun, then pointer', '“need access to banks” → “Such access…”'],
  ['Full name, then short name', '“Michael Hofman, a poet” → “Hofman feels…”'],
  ['Twin phrases', '“It’s not enough that…” → “Or that…” · “Some…” → “Others…”'],
  ['Claim, then denial', '“It is often said…” → “That is not true.”'],
  ['Question, then answer', '“But do people applaud…?” → “No, …”'],
  ['General, then example', 'a problem → “An accident… is such a case”'],
  ['Time or steps', 'lump → diagnosis → “Then… it had come back”'],
];
const PJ_STEPS = q => [
  '<b>Mark the pointer words:</b> this, these, such, it, they, he, but, also, then, thus. Each points at the sentence just before it.',
  '<b>Lock one pair.</b> Find the sentence that pointer needs. Do not guess the full order.',
  q.opts ? '<b>Strike every option</b> that does not contain your pair. If two survive, lock a second pair.'
    : '<b>Lock a second pair</b> (there are no options to lean on), then place the sentence that is left.',
  '<b>Read the order once.</b> Every pointer must land on the previous sentence.',
];
const STRATEGY = {
  pj: { title: 'Para jumble: pair first', steps: PJ_STEPS,
    lede: 'In this question bank one sure pair alone picks the right option 9 times in 10; the opening sentence alone does it only 1 time in 3.' },
  'pj-fixed': { title: 'Para jumble: fixed ends', steps: PJ_STEPS,
    lede: 'The first and last sentences are given, so work from both ends.',
    tip: 'Find what must <b>follow the first sentence</b> and what must <b>lead into the last</b>. The middle usually falls out.' },
  'pj-parts': { title: 'Sentence jumble: join by grammar', steps: PJ_STEPS,
    lede: 'These are parts of one sentence, so grammar gives you the pairs.',
    tip: 'A part ending in <b>if, that, of, when, than, and</b> is unfinished: find the part that completes it.' },
  'pj-odd': { title: 'Odd sentence out', signals: 'Signals that chain the four',
    lede: 'All five share the topic. Four form a chain; one only looks related.',
    steps: () => [
      '<b>Find the anchor:</b> the sentence the others lean on, with no pointer word looking backwards.',
      '<b>Chain four</b> using the signals below. Each should point at the one before it.',
      '<b>The odd one changes the angle:</b> the method, a background definition, a recommendation, or a pointer with nothing to point at.',
      '<b>Check:</b> without it, the four still read as one paragraph.',
    ] },
};
function strategyKey(q) {
  const inPJ = q.ch === 'c17';
  if (!inPJ && !(chapter(q.ch).section === 'PAPERS' && q.sec === 'VARC')) return null;
  const d = q.dir && S.data.directions[q.dir];
  const t = (q.text || '') + ' ' + ((d && d.text) || '');
  if (/odd sentence/i.test(t)) return 'pj-odd';
  const order = /properly sequenced|proper sequenc|proper order for the sentences/i.test(t);
  if (!inPJ) return order ? 'pj' : null;
  if (/parts of a sentence/i.test(t)) return 'pj-parts';
  if (/between sentences?\s*(numbered\s*)?1|1 (and|to) 6|is in its correct place/i.test(t)) return 'pj-fixed';
  return 'pj';
}
const strategyQ = () => activeQ() || (S.unit && (S.unit.qs.find(x => !attempt(x.id)) || S.unit.qs[0])) || null;
let stratTimer = 0;
function placeStrategy() {
  const pop = $('#strat-pop'); if (pop.hidden) return;
  if (window.matchMedia('(max-width: 860px)').matches) { pop.style.bottom = ''; pop.style.removeProperty('--ax'); return; }
  const d = $('#dock').getBoundingClientRect(), b = $('#strat').getBoundingClientRect();
  pop.style.bottom = Math.round(window.innerHeight - d.top + 14) + 'px';
  pop.style.setProperty('--ax', Math.round(b.left + b.width / 2 - (d.left + d.width / 2)) + 'px');
}
function openStrategy() {
  const q = strategyQ(), s = q && STRATEGY[strategyKey(q)]; if (!s) return;
  const pop = $('#strat-pop'), back = $('#strat-back');
  $('#strat-title').textContent = s.title;
  $('#strat-body').innerHTML = `<p class="strat-lede">${s.lede}</p>${s.tip ? `<p class="strat-tip">${s.tip}</p>` : ''}
    <ol class="strat-steps">${s.steps(q).map(x => `<li>${x}</li>`).join('')}</ol>
    <div class="strat-lbl">${s.signals || 'Pair signals to look for'}</div>
    <ul class="strat-sig">${PJ_SIGNALS.map(([a, b]) => `<li><b>${a}</b><span>${b}</span></li>`).join('')}</ul>`;
  $('#strat-body').scrollTop = 0;
  clearTimeout(stratTimer);
  pop.hidden = false; back.hidden = false; placeStrategy();
  void pop.offsetWidth;
  pop.classList.add('open'); back.classList.add('open'); document.body.classList.add('strat-open');
  $('#strat').setAttribute('aria-expanded', 'true');
  pop.focus({ preventScroll: true });
}
function closeStrategy(now) {
  const pop = $('#strat-pop'), back = $('#strat-back'); if (!pop || pop.hidden) return;
  pop.classList.remove('open'); back.classList.remove('open'); document.body.classList.remove('strat-open');
  $('#strat').setAttribute('aria-expanded', 'false');
  clearTimeout(stratTimer);
  const hide = () => { pop.hidden = true; back.hidden = true; };
  if (now) hide(); else stratTimer = setTimeout(hide, 280);
}
const strategyOpen = () => $('#strat-pop').classList.contains('open');
function toggleStrategy() { strategyOpen() ? closeStrategy() : openStrategy(); }
function initStrategy() {
  const btn = $('#strat'), pop = $('#strat-pop'), head = $('.strat-head');
  btn.onclick = toggleStrategy;
  $('#strat-close').onclick = () => closeStrategy();
  document.addEventListener('pointerdown', e => { if (strategyOpen() && !pop.contains(e.target) && !btn.contains(e.target)) closeStrategy(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && strategyOpen()) closeStrategy(); });
  window.addEventListener('resize', placeStrategy);
  let y0 = null; // drag the sheet's header down to dismiss it
  head.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; pop.style.transition = 'none'; }, { passive: true });
  head.addEventListener('touchmove', e => { if (y0 !== null) pop.style.transform = `translateY(${Math.max(0, e.touches[0].clientY - y0)}px)`; }, { passive: true });
  const end = e => {
    if (y0 === null) return;
    const dy = e.changedTouches[0].clientY - y0; y0 = null;
    pop.style.transition = ''; pop.style.transform = '';
    if (dy > 70) closeStrategy();
  };
  head.addEventListener('touchend', end); head.addEventListener('touchcancel', end);
}

/* ---------- notes: things to remember, written up from lesson screenshots ---------- */
const NOTES = [
  ['Number system', [
    ['Recurring decimals as fractions', `
      <p>Every recurring decimal is <b>rational</b>: it can be written as p/q. Put the repeating block over as many 9s as it has digits.</p>
      <table class="ntab nform">
        <tr><th>0.aaa…</th><td>a / 9, e.g. 0.777… = 7/9</td></tr>
        <tr><th>0.abab…</th><td>ab / 99, e.g. 0.2323… = 23/99</td></tr>
        <tr><th>0.abcabc…</th><td>abc / 999</td></tr>
        <tr><th>0.abcdabcd…</th><td>abcd / 9999</td></tr>
      </table>
      <p class="nwhy">Why: x = 0.abcabc…, so 1000x = abc.abcabc…. Subtract: 999x = abc, so x = abc/999.</p>
      <p><b>When the repeat starts later</b> (mixed recurring), multiply so that the repeating parts line up, then subtract.</p>
      <p class="nex"><span>Example</span>x = 0.2565656… (2, then 56 repeats). 10x = 2.565656… and 1000x = 256.5656…. Subtract: 990x = 254, so x = 254/990 = 127/495.</p>
      <p>Shortcut for mixed recurring: numerator = (digits up to the end of the first repeat) − (digits before the repeat) = 256 − 2 = 254. Denominator = a 9 for each repeating digit, then a 0 for each non-repeating digit after the point = 990.</p>
      <p class="ntrap"><span>Watch out</span>Reduce the fraction at the end: answer choices give 127/495, not 254/990.</p>`],
    ['Prime and composite numbers: the basics', `
      <ul>
        <li>A prime has exactly <b>two distinct factors</b>: 1 and itself. 7 has 1, 7. 10 has 1, 2, 5, 10, so it is not prime.</li>
        <li>A <b>composite</b> number is a natural number with <b>3 or more factors</b>. 9 has 1, 3, 9. The smallest composite is 4.</li>
        <li><b>1</b> is neither prime nor composite: it has only one factor. Every natural number above 1 is one or the other.</li>
        <li><b>2</b> is the only even prime.</li>
        <li>How many primes: up to 50 there are <b>15</b>, up to 100 there are <b>25</b>, up to 200 there are <b>46</b>.</li>
      </ul>
      <table class="ntab"><caption>Primes under 100, by tens</caption>
        <tr><th>1–9</th><td>2, 3, 5, 7</td></tr>
        <tr><th>10s</th><td>11, 13, 17, 19</td></tr>
        <tr><th>20s</th><td>23, 29</td></tr>
        <tr><th>30s</th><td>31, 37</td></tr>
        <tr><th>40s</th><td>41, 43, 47</td></tr>
        <tr><th>50s</th><td>53, 59</td></tr>
        <tr><th>60s</th><td>61, 67</td></tr>
        <tr><th>70s</th><td>71, 73, 79</td></tr>
        <tr><th>80s</th><td>83, 89</td></tr>
        <tr><th>90s</th><td>97</td></tr>
      </table>`],
    ['Is N prime? Test only up to √N', `
      <p>Divide N by the primes <b>up to √N</b>. If none of them divides it, N is prime. A factor bigger than √N would need a partner smaller than √N, which you have already tried.</p>
      <p class="nex"><span>Example</span>143: √143 is about 11.96, so try 2, 3, 5, 7, 11. 143 = 11 × 13, not prime.</p>
      <p class="nex"><span>Example</span>731: √731 is about 27.04, so try the primes up to 23. 731 = 17 × 43, not prime.</p>
      <p class="ntrap"><span>Watch out</span>It is primes ≤ √N, not &lt; √N. For 121, √121 = 11, and 11 is the factor.</p>`],
    ['Prime or not? A four-step check', `
      <ol>
        <li>Is it of the form <b>6k ± 1</b>? (Leaves remainder 1 or 5 when divided by 6.)</li>
        <li>Is its <b>digital sum</b> anything but 3, 6 or 9?</li>
        <li>Is <b>p² − 1 a multiple of 24</b> (p² − 1 = 24k)?</li>
        <li>Does <b>no prime up to √N</b> divide it?</li>
      </ol>
      <p>Steps 1 to 3 are quick filters: a “no” at any of them means not prime. Only step 4 proves a number is prime. In practice step 3 is the slowest, so the first two filters and then step 4 are usually enough.</p>
      <p class="nex"><span>Example</span>91 = 6 × 15 + 1, its digital sum is 1, and 91² − 1 = 8280 = 24 × 345. It passes all three filters, yet 91 = 7 × 13. Only step 4 catches it.</p>
      <p class="ntrap"><span>Watch out</span>For numbers above 3 only: 2 and 3 fail steps 1 and 3 and are still prime.</p>`],
    ['Shortcuts about primes', `
      <ul>
        <li>Every prime <b>greater than 3</b> has the form <b>6k ± 1</b>: divided by 6 it leaves remainder 1 or 5. “6k + 1” just means remainder 1 when divided by 6, since dividend = divisor × quotient + remainder.</li>
        <li>The reverse is false: 25 = 6 × 4 + 1, but 25 = 5 × 5. Use 6k ± 1 to rule a number out, never to prove it prime.</li>
        <li>For every prime p <b>greater than 3</b>, <b>p² − 1 is divisible by 24</b>. 5² − 1 = 24, 7² − 1 = 48, 11² − 1 = 120.<br><span class="nwhy">Why: p² − 1 = (p − 1)(p + 1), two consecutive even numbers, so one is a multiple of 4 and the product is a multiple of 8. One of p − 1, p, p + 1 is a multiple of 3, and it is not p.</span></li>
        <li>The <b>digital sum</b> of a prime is never 3, 6 or 9, because such a number is divisible by 3. The one exception is 3 itself.</li>
        <li>Digital sum: add the digits, and keep adding until one digit is left. 949876 → 9+4+9+8+7+6 = 43 → 4+3 = <b>7</b>.</li>
      </ul>
      <p class="ntrap"><span>Watch out</span>The 6k ± 1 and p² − 1 rules fail for 2 and 3: 3² − 1 = 8 is not divisible by 24.</p>`],
    ['Sums of the first n numbers', `
      <table class="ntab nform">
        <tr><th>1 + 2 + 3 + … + n</th><td>n(n + 1) / 2</td></tr>
        <tr><th>1² + 2² + … + n²</th><td>n(n + 1)(2n + 1) / 6</td></tr>
        <tr><th>1³ + 2³ + … + n³</th><td>[n(n + 1) / 2]², the square of the first sum</td></tr>
        <tr><th>1 + 3 + 5 + … + (2n − 1)</th><td>n², the first n odd numbers</td></tr>
        <tr><th>2 + 4 + 6 + … + 2n</th><td>n(n + 1) = n² + n, twice the first sum</td></tr>
      </table>
      <p>Count the terms first. The n-th odd number is 2n − 1 and the n-th even number is 2n.</p>
      <p class="nex"><span>Example</span>1 + 3 + 5 + … + 91: 2k − 1 = 91 gives k = 46 terms, so the sum is 46² = 2116.</p>`],
    ['Consecutive odd numbers', `
      <p>Five consecutive odd numbers: (2k+1) + (2k+3) + (2k+5) + (2k+7) + (2k+9) = 10k + 25 = 5(2k + 5). Their sum is <b>always an odd multiple of 5</b>.</p>
      <p>Faster: for an odd count of evenly spaced numbers, sum = count × middle term. 33 + 35 + 37 + 39 + 41 = 5 × 37 = 185.</p>
      <p class="ntrap"><span>Watch out</span>“Five consecutive odd numbers add up to 197” is an invalid question: 197 is not a multiple of 5. Check the form before you start solving.</p>`],
  ]],
];
function renderNotes() {
  app().innerHTML = `<h1 class="with-ic"><span class="badge-ic lg">${icon('notes')}</span>Notes</h1>
  <p class="lead">Things to remember, topic by topic.</p>
  ${NOTES.map(([topic, cards]) => `<div class="ntopic">${esc(topic)}</div>` +
    cards.map(([title, body]) => `<section class="ncard"><h2>${esc(title)}</h2>${body}</section>`).join('')).join('')}`;
}

/* ---------- reader ---------- */
const RD = { full: null, briefs: null, p: null };
function loadReadingData() {
  if (!RD.p) RD.p = Promise.all([
    fetch('data/readings_full.json').then(r => r.json()),
    fetch('data/readings_briefs.json').then(r => r.json()),
    // Private copies you add yourself (see tools/build_private.py). Served only through the password gate.
    fetch('private/readings_text.json').then(r => r.ok ? r.json() : {}).catch(() => ({})),
  ]).then(([f, b, p]) => { RD.full = Object.assign({}, f, p); RD.briefs = b; })
    .catch(() => { RD.p = null; RD.full = RD.full || {}; RD.briefs = RD.briefs || {}; });
  return RD.p;
}
function readingByKey(key) {
  let day = 0;
  for (const [, items] of READINGS) for (const item of items) {
    day++;
    const last = item[item.length - 1], pair = Array.isArray(last) ? last : null;
    if (String(day) === key) return { day, second: false, item };
    if (pair && day + 'b' === key) return { day, second: true, item: pair };
  }
  return null;
}
function renderReader(key) {
  const r = readingByKey(key);
  if (!r) { location.hash = '#/reading'; return; }
  const reads = S.progress.reads || (S.progress.reads = {});
  let [author, title, year, field, url, note] = r.item;
  if (Array.isArray(note)) note = null;
  const draw = () => {
    const full = RD.full && RD.full[key], br = RD.briefs && RD.briefs[key];
    const text = full ? full.blocks.map(([t, x]) =>
      t === 'h' ? `<h2>${esc(x)}</h2>` : t === 'q' ? `<blockquote>${esc(x)}</blockquote>` : t === 'n' ? `<p class="rnote">${esc(x)}</p>` : `<p>${esc(x)}</p>`).join('') : '';
    const labels = ['The argument', 'How it is built', 'Where to push back'];
    app().innerHTML = `<div class="rmeta">${backBtn('#/reading', 'Reading')}</div>
    <article class="reader">
      <header>
        <div class="rday">Day ${r.day} · ${r.second ? 'modern' : 'classic'}</div>
        <h1>${esc(title)}</h1>
        <p class="rby">${esc(author)} · ${year} · ${esc(field)}${note ? ' · ' + esc(note) : ''}</p>
      </header>
      ${br ? `<section class="brief">${br.map((x, i) => `<div><span class="bl">${labels[i]}</span><p>${esc(x)}</p></div>`).join('')}</section>` : ''}
      ${full ? `<div class="rtext">${text}</div><p class="rsrc">${esc(full.src)} · ${esc(full.lic)}</p>`
             : `<p class="rnofull">The full text is not in this copy. The brief above is a summary, not the piece; the original is linked below.</p>`}
      <div class="rfoot">
        <button class="rdone ${reads[key] ? 'on' : ''}" type="button">${icon('tick')}<span>${reads[key] ? 'Read' : 'Mark as read'}</span></button>
        <a class="rorig" href="${url}" target="_blank" rel="noopener">Open the original${icon('link', 'lk')}</a>
      </div>
    </article>`;
    const btn = $('.rdone');
    btn.onclick = () => {
      if (reads[key]) delete reads[key]; else reads[key] = Date.now();
      save(); btn.classList.toggle('on', !!reads[key]); btn.querySelector('span').textContent = reads[key] ? 'Read' : 'Mark as read';
    };
  };
  draw();
  if (!RD.full) loadReadingData().then(() => { if (decodeURIComponent(location.hash.slice(7)) === key) { const y = window.scrollY; draw(); window.scrollTo(0, y); } });
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
  if (k === 's') toggleStrategy();
  if (k === ' ') { e.preventDefault(); $('#pause').click(); }
}

/* ---------- AI tutor panel ---------- */
const TUTOR_SYSTEM = `You are a tutor for the CAT (Common Admission Test, India). The student is practising a past-paper question from a solved-papers book. You get the question as an image cropped from the book (plus the directions, data set or passage when there is one), a rough text extraction that may garble maths, and, when known, the answer key.
Write for a phone-sized panel: short paragraphs, light Markdown (bold, numbered steps, bullet lists) and simple inline maths such as x^2 or (a+b)/2. Never use LaTeX, tables or headings. Be concise and concrete.
For a hint, give one nudge that unlocks the next step and never state the final answer. For an explanation, give a clean step-by-step solution and end with the final answer in bold. When asked why an answer was wrong, first find the likely error, then correct it. If the extraction and the image disagree, trust the image. Mention exam strategy (time, elimination, when to skip) only when it genuinely helps.`;
const MODEL_NAMES = { 'claude-opus-5-5': 'Opus 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-haiku-5-5': 'Haiku 5.5' };
const AI = { busy: false, ctrl: null, stick: true };

function initPanel() {
  document.documentElement.style.setProperty('--panel-w', (S.settings.panelW || 420) + 'px');
  const ta = $('#ai-input'), scroll = $('#ai-scroll');
  $('#ai-toggle').onclick = openPanel;
  $('#ai-close').onclick = () => closePanel();
  $('#ai-new').onclick = () => { const q = panelQ(); if (!q || AI.busy) return; delete S.chats[q.id]; panelFor(q); ta.focus(); };
  $('#ai-form').onsubmit = e => { e.preventDefault(); if (AI.busy) { AI.ctrl && AI.ctrl.abort(); return; } const q = panelQ(); if (q) askAI(q, 'ask'); };
  ta.oninput = () => { growInput(); syncSend(); };
  initMic(ta);
  ta.onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(hover: hover)').matches) { e.preventDefault(); $('#ai-form').requestSubmit(); }
    if (e.key === 'Escape') closePanel();
  };
  scroll.onscroll = () => { AI.stick = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 40; };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('ai-open') && !e.target.matches('textarea')) closePanel(); });
  const handle = $('.ai-resize');
  handle.onpointerdown = e => {
    e.preventDefault(); handle.setPointerCapture(e.pointerId);
    const move = ev => { const w = Math.min(720, Math.max(340, window.innerWidth - ev.clientX)); document.documentElement.style.setProperty('--panel-w', w + 'px'); S.settings.panelW = w; };
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); saveSettings(); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
  };
}
function initMic(ta) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = $('#ai-mic');
  if (!SR) return;
  btn.hidden = false;
  let rec = null, base = '';
  const stop = () => { if (rec) { rec.onend = null; rec.stop(); rec = null; } btn.classList.remove('on'); };
  btn.onclick = () => {
    if (rec) return stop();
    rec = new SR(); rec.lang = 'en-IN'; rec.interimResults = true; rec.continuous = true;
    base = ta.value.trim(); base = base ? base + ' ' : '';
    rec.onresult = e => {
      let done = '', interim = '';
      for (const r of e.results) (r.isFinal ? (done += r[0].transcript + ' ') : (interim += r[0].transcript));
      ta.value = base + done + interim; growInput(); syncSend();
      if (done) base += done;
    };
    rec.onerror = stop; rec.onend = stop;
    rec.start(); btn.classList.add('on'); ta.focus();
  };
}
function growInput() { const ta = $('#ai-input'); ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'; }
function syncSend() {
  const b = $('#ai-send');
  b.classList.toggle('stop', AI.busy);
  b.disabled = !AI.busy && !$('#ai-input').value.trim();
  b.setAttribute('aria-label', AI.busy ? 'Stop' : 'Send');
  b.innerHTML = AI.busy ? '<svg class="ic" viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/></svg>'
                        : '<svg class="ic" viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
}
const panelQ = () => S.panelQ || activeQ() || (S.unit && S.unit.qs[0]);
function openPanel() {
  $('#ai-panel').hidden = false; document.body.classList.add('ai-open');
  S.settings.panelOpen = true; saveSettings();
  if (window.matchMedia('(hover: hover)').matches) setTimeout(() => $('#ai-input').focus(), 260);
  scrollThread(true);
}
function closePanel(silent) { document.body.classList.remove('ai-open'); if (!silent) { S.settings.panelOpen = false; saveSettings(); } }
function togglePanel() { document.body.classList.contains('ai-open') ? closePanel() : openPanel(); }
function scrollThread(force) { const sc = $('#ai-scroll'); if (force || AI.stick) sc.scrollTop = sc.scrollHeight; }

/* minimal, safe Markdown: escape first, then paragraphs, lists, bold, italics, code */
function md(src) {
  const inline = t => esc(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/\^(\d+|\([^)]+\))/g, '<sup>$1</sup>');
  const out = []; let list = null, para = [], code = null;
  const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } if (list) { out.push(`<${list.t}>${list.items.map(x => `<li>${inline(x)}</li>`).join('')}</${list.t}>`); list = null; } };
  for (const line of String(src).split('\n')) {
    if (code !== null) { if (/^```/.test(line)) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null; } else code.push(line); continue; }
    if (/^```/.test(line)) { flush(); code = []; continue; }
    const ul = line.match(/^\s*[-*•]\s+(.*)/), ol = line.match(/^\s*\d+[.)]\s+(.*)/), h = line.match(/^#{1,6}\s+(.*)/);
    if (ul || ol) { const t = ul ? 'ul' : 'ol'; if (para.length) flush(); if (!list || list.t !== t) { flush(); list = { t, items: [] }; } list.items.push((ul || ol)[1]); continue; }
    if (!line.trim()) { flush(); continue; }
    if (h) { flush(); out.push(`<p><strong>${inline(h[1])}</strong></p>`); continue; }
    if (list) { if (/^\s{2,}/.test(line)) { list.items[list.items.length - 1] += ' ' + line.trim(); continue; } flush(); }
    para.push(line);
  }
  if (code !== null) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
  flush();
  return out.join('');
}

function msgHTML(m) {
  if (m.role === 'user') return `<div class="msg user">${esc(m.text)}</div>`;
  if (m.role === 'err') return `<div class="msg err">${esc(m.text)} <a data-retry-ai>Try again</a></div>`;
  return `<div class="msg ai"><div class="md">${md(m.text)}</div><div class="msg-actions"><button class="icon" data-copy title="Copy" aria-label="Copy"><svg class="ic" viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/></svg></button></div></div>`;
}

function panelFor(q) {
  if (!q) return;
  S.panelQ = q;
  const a = attempt(q.id);
  const c = S.chats[q.id];
  $('#ai-sub').textContent = `${chapter(q.ch).title} · Q${q.n}`;
  $('#ai-model').textContent = S.settings.apiKey ? (MODEL_NAMES[S.settings.model] || S.settings.model) : '';
  const chips = [['hint', 'Give me a hint'], ['explain', 'Explain step by step']];
  if (a && a.result !== 'correct') chips.push(['why', 'Why was I wrong?']);
  $('#ai-quick').innerHTML = chips.map(([k, l]) => `<button type="button" class="chip-btn" data-ai="${k}">${l}</button>`).join('');
  $('#ai-quick').querySelectorAll('[data-ai]').forEach(b => b.onclick = () => askAI(q, b.dataset.ai));
  const chat = $('#chat');
  if (!c || !c.shown.length) {
    chat.innerHTML = S.settings.apiKey
      ? `<div class="ai-empty"><div class="ai-mark"><svg class="ic" viewBox="0 0 24 24"><path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/></svg></div><p class="ai-hello">How can I help with Q${q.n}?</p><p class="muted small">I can see the question${q.dir ? ' and its passage or data' : ''}${q.ans ? ' and the answer key' : ''}.</p></div>`
      : `<div class="ai-empty"><div class="ai-mark"><svg class="ic" viewBox="0 0 24 24"><path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/></svg></div><p class="ai-hello">Add your API key to start</p><p class="muted small">The tutor uses your Anthropic API key, kept in this browser. <a href="#/settings"><u>Open Settings</u></a></p></div>`;
  } else chat.innerHTML = c.shown.map(msgHTML).join('');
  $('#ai-panel').classList.toggle('has-thread', !!(c && c.shown.length));
  bindThread(q);
  syncSend();
  scrollThread(true);
}
function bindThread(q) {
  const chat = $('#chat');
  chat.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => {
    const text = b.closest('.msg').querySelector('.md').innerText;
    navigator.clipboard && navigator.clipboard.writeText(text).then(() => { b.classList.add('done'); setTimeout(() => b.classList.remove('done'), 1200); });
  });
  const r = chat.querySelector('[data-retry-ai]');
  if (r) r.onclick = () => { const c = S.chats[q.id]; const last = c && c.shown.filter(m => m.role === 'user').pop(); if (!last) return; c.shown = c.shown.filter(m => m.role !== 'err'); c.shown.pop(); c.messages.pop(); panelFor(q); askAI(q, 'ask', last.text); };
}
async function questionImage(q) {
  const rects = [];
  const d = q.dir && S.data.directions[q.dir];
  if (d) rects.push(...d.rects);
  rects.push(...q.rects);
  const [PW] = pageSize(rects[0][0]);
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

async function askAI(q, mode, retryText) {
  if (AI.busy) return;
  const ta = $('#ai-input');
  if (!S.settings.apiKey) { openPanel(); return; }
  const a = attempt(q.id);
  let userText;
  if (retryText) userText = retryText;
  else if (mode === 'hint') userText = 'Give me a hint.';
  else if (mode === 'explain') userText = 'Explain this step by step.';
  else if (mode === 'why') userText = `I answered ${(a && a.ans) ? '“' + a.ans.toUpperCase() + '”' : 'nothing (I skipped it)'}${q.ans ? ` and the key says “${q.ans.toUpperCase()}”` : ''}. Why was I wrong?`;
  else { userText = (ta.value || '').trim(); if (!userText) return; ta.value = ''; growInput(); }
  if (!document.body.classList.contains('ai-open')) openPanel();

  let c = S.chats[q.id];
  if (!c) c = S.chats[q.id] = { messages: [], shown: [] };
  if (!c.messages.length) {
    // first turn carries the question image and context
    const img = await questionImage(q).catch(() => null);
    const ctxText = `Chapter: ${chapter(q.ch).title}. ${q.year ? 'CAT ' + q.year + '. ' : ''}Type: ${q.type}. ${q.ans ? 'Answer key: ' + q.ans + '.' : 'Answer key not available.'}\nDirections (text extraction): ${q.dir ? S.data.directions[q.dir].text : '(none)'}\nQuestion (text extraction): ${q.text}`;
    const content = [];
    if (img) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } });
    content.push({ type: 'text', text: ctxText }, { type: 'text', text: userText });
    c.messages.push({ role: 'user', content });
  } else c.messages.push({ role: 'user', content: userText });
  c.shown.push({ role: 'user', text: userText });

  const chat = $('#chat');
  if (c.shown.length === 1) chat.innerHTML = '';
  $('#ai-panel').classList.add('has-thread');
  chat.insertAdjacentHTML('beforeend', msgHTML({ role: 'user', text: userText }) + '<div class="msg ai streaming"><div class="md"><span class="typing"><i></i><i></i><i></i></span></div></div>');
  const out = chat.lastElementChild.querySelector('.md');
  AI.busy = true; AI.stick = true; AI.ctrl = new AbortController(); syncSend(); scrollThread(true);
  let text = '';
  try {
    text = await streamClaude(c.messages, t => { text = t; out.innerHTML = md(t); scrollThread(); }, AI.ctrl.signal);
    c.messages.push({ role: 'assistant', content: text });
    c.shown.push({ role: 'ai', text });
  } catch (err) {
    if (err.name === 'AbortError' && text) {
      c.messages.push({ role: 'assistant', content: text }); c.shown.push({ role: 'ai', text });
    } else {
      c.messages.pop();
      c.shown.push({ role: 'err', text: err.name === 'AbortError' ? 'Stopped.' : 'Something went wrong: ' + err.message });
    }
  } finally {
    AI.busy = false; AI.ctrl = null;
    if (S.panelQ === q) panelFor(q); else syncSend();
  }
}

async function streamClaude(messages, onText, signal) {
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
  const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body), signal });
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
    <label>Exam date</label>
    <input type="date" data-exam value="${esc(S.settings.examDate || '2026-11-29')}">
    <p class="note">Used for the countdown on the overview. CAT 2026 is on 29 November 2026.</p>
    <label>Questions</label>
    <select data-textmode><option value="1">Text where it can be read from the book reliably, images otherwise</option><option value="0">Always the book's own images</option></select>
    <p class="note">Prototype: plain-prose questions, options, passages, data tables and solutions are rebuilt as text; anything with maths, figures or charts stays an image. Each transcribed question has an “original” link.</p>
    <label>Theme</label>
    <select data-theme><option value="">System</option><option value="light">Light</option><option value="dark">Dark</option></select>
    <hr>
    <label>Keyboard</label>
    <p class="keys"><kbd>A</kbd>–<kbd>E</kbd> pick an option · <kbd>Enter</kbd> submit · <kbd>Space</kbd> pause · <kbd>N</kbd> next · <kbd>P</kbd> previous · <kbd>T</kbd> tutor · <kbd>S</kbd> strategy</p>
  </div>`;
  $('[data-model]').value = S.settings.model;
  $('[data-theme]').value = document.documentElement.dataset.theme || '';
  $('[data-exam]').onchange = e => { if (e.target.value) { S.settings.examDate = e.target.value; saveSettings(); } };
  $('[data-textmode]').value = useText() ? '1' : '0';
  $('[data-textmode]').onchange = e => { S.settings.textMode = e.target.value === '1'; saveSettings(); };
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
