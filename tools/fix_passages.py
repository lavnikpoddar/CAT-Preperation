#!/usr/bin/env python3
"""Un-glue passages that extract.py attached to the end of the previous question.

In the book a new passage often starts with only a "PASSAGE n" heading (no "Directions" line).
extract.py did not treat that as a boundary, so the passage became the tail of the previous
question and the questions after it stayed attached to the passage before. This script cuts each
such question at the heading, makes the rest a directions block, and re-attaches the questions.

Usage: fix_passages.py BOOK.pdf [--write]     (safe to run twice; without --write it only reports)"""
import collections, html, json, os, re, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import transcribe as TX

pdf = sys.argv[1]; write = '--write' in sys.argv
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'questions.json')
d = json.load(open(path, encoding='utf-8'))
GUTTER = 324.0

class Words(dict):
    def load(self, p0, p1):
        h = subprocess.run(['pdftotext', '-f', str(p0), '-l', str(p1), '-bbox', pdf, '-'], capture_output=True, text=True).stdout
        for i, pg in enumerate(re.findall(r'<page [^>]*>(.*?)</page>', h, flags=re.S)):
            self[p0 + i] = [(float(a), float(b), float(c), float(e), html.unescape(w)) for a, b, c, e, w in
                            re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>', pg)]
W = Words()

def pieces(rects):
    """Rects in reading order, with full-width ones split into left and right column."""
    out = []
    for p, x0, y0, x1, y1 in rects:
        if x0 < GUTTER - 30 and x1 > GUTTER + 30:
            out += [[p, x0, y0, GUTTER, y1], [p, GUTTER, y0, x1, y1]]
        else:
            out.append([p, x0, y0, x1, y1])
    return out
def clip(rects, region):
    out = []
    for p, x0, y0, x1, y1 in rects:
        for q, a0, b0, a1, b1 in region:
            if p == q and min(x1, a1) - max(x0, a0) > 4 and min(y1, b1) - max(y0, b0) > 3:
                out.append([p, max(x0, a0), max(y0, b0), min(x1, a1), min(y1, b1)])
    return out
def has_words(r):
    return bool(TX.words_in(W[r[0]], r))
def plain(rects, n):
    return ' '.join(ln['text'] for ln in TX.region_lines(W, rects))[:n]

report = collections.Counter(); samples = []
for ch in sorted({q['ch'] for q in d['questions'] if re.fullmatch(r'c\d\d', q['ch'])}):
    qs = [q for q in d['questions'] if q['ch'] == ch]
    pages = sorted({r[0] for q in qs for r in q['rects']})
    W.load(pages[0], pages[-1])
    heads = []
    for p in range(pages[0], pages[-1] + 1):
        ws = sorted(W.get(p, []), key=lambda w: (round(w[1]), w[0]))
        for i, w in enumerate(ws[:-1]):
            if w[4] == 'PASSAGE' and re.fullmatch(r'\d{1,3}', ws[i + 1][4]) and abs(ws[i + 1][1] - w[1]) < 3:
                heads.append((p, w[0], w[1], int(ws[i + 1][4])))
    start_dir = {}                                    # question id -> id of the passage that starts after it
    for p, x, y, n in heads:
        for q in qs:
            ps = pieces(q['rects'])
            i = next((k for k, r in enumerate(ps) if r[0] == p and r[1] - 2 <= x < r[3] and r[2] - 2 <= y < r[4]), None)
            if i is None:
                continue
            cut = y - 3
            before = ps[:i] + ([[p, ps[i][1], ps[i][2], ps[i][3], cut]] if cut - ps[i][2] > 4 else [])
            after = [[p, ps[i][1], cut, ps[i][3], ps[i][4]]] + ps[i + 1:]
            before = [r for r in before if has_words(r)]; after = [r for r in after if has_words(r)]
            if not before or not after:
                report['skipped (nothing to split)'] += 1; break
            did = f'{ch}dp{n}'
            # only the heading is glued on (a real Directions block follows): trim it, make no passage
            heading_only = sum(len(TX.words_in(W[r[0]], r)) for r in after) < 6
            had_tx = bool(q.get('tx'))
            q['rects'] = before
            if q.get('stem'): q['stem'] = clip(q['stem'], before) or None
            if q.get('optRects'):
                o = [clip(r, before) for r in q['optRects']]
                q['optRects'] = o if all(o) else None
                if not q['optRects']: q['stem'] = None
            q['text'] = plain(before, 2500)
            if had_tx:
                stem = TX.transcribe(W, q['stem'] or before, {}, strip_marker=True)
                opts = None
                if q['optRects']:
                    o = [TX.transcribe(W, r, {}, strip_marker=True) for r in q['optRects']]
                    opts = None if any(x is None for x in o) else [' '.join(x) for x in o]
                q['tx'] = {'stem': stem, 'opts': opts} if stem and (opts or not q['optRects']) else None
            if heading_only:
                report['heading trimmed'] += 1; break
            paras = TX.transcribe(W, after, {})
            d['directions'][did] = {'id': did, 'ch': ch, 'rects': after, 'text': plain(after, 4000), 'range': None, 'year': None,
                                    'tx': [{'t': 'p', 'text': t} for t in paras] if paras else None}
            start_dir[q['id']] = did
            report[ch] += 1
            if len(samples) < 3: samples.append((q['id'], did, before, after[:2], (q.get('tx') or {}).get('stem')))
            break
    if not start_dir:
        continue
    cur, prev_orig = None, object()                   # walk the chapter, carrying the current passage forward
    for q in qs:
        if q['dir'] != prev_orig:
            cur, prev_orig = q['dir'], q['dir']
        q['dir'] = cur
        if q['id'] in start_dir:
            cur = start_dir[q['id']]
    members = collections.defaultdict(list)
    for q in qs:
        if q['dir']: members[q['dir']].append(q)
    for did, ms in members.items():
        dd = d['directions'][did]
        dd['range'] = [ms[0]['n'], ms[-1]['n']]
        if not dd.get('year'):
            ys = [m['year'] for m in ms if m['year']]
            dd['year'] = collections.Counter(ys).most_common(1)[0][0] if ys else None
    for did in [k for k, v in d['directions'].items() if v['ch'] == ch and k not in members]:
        report['directions left without questions: ' + did] += 1

print(dict(report))
for s in samples: print(s)
if write:
    json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('written')
