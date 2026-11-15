#!/usr/bin/env python3
"""Re-read the text of questions whose crop spans both columns of a two-column page.

Usage: fix_columns.py BOOK.pdf [--write]
Without --write it only reports what would change. Only the text versions (`tx`, `text`) are
touched; the image crops already show the page correctly. Run after extract.py if that is ever
re-run with an old transcribe.py; with the current one the rebuild is already column-aware."""
import json, os, re, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import transcribe as TX

pdf = sys.argv[1]; write = '--write' in sys.argv
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'questions.json')
d = json.load(open(path, encoding='utf-8'))
_cache = {}
class Words(dict):
    def __missing__(self, p):
        h = subprocess.run(['pdftotext', '-f', str(p), '-l', str(p), '-bbox', pdf, '-'], capture_output=True, text=True).stdout
        import html
        self[p] = [(float(a), float(b), float(c), float(e), html.unescape(w)) for a, b, c, e, w in
                   re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>', h)]
        return self[p]
W = Words()
def split_here(rects):
    return any(TX.column_split(TX.words_in(W[r[0]], r), r) is not None for r in rects if r[3] - r[1] > 330)

changed = []
for q in d['questions']:
    if not re.fullmatch(r'c\d\d', q['ch']) or q['ch'] == 'c15':      # c15 (Data Interpretation) is laid out full width
        continue
    if not split_here(q['rects']):
        continue
    lines = TX.region_lines(W, q['rects'])
    text = ' '.join(ln['text'] for ln in lines)[:2500]
    tx = q.get('tx')
    if tx:                                                            # had a text version: rebuild it the way extract.py does
        stem = TX.transcribe(W, q['stem'] or q['rects'], {}, strip_marker=True)
        opts = None
        if q['optRects']:
            o = [TX.transcribe(W, r, {}, strip_marker=True) for r in q['optRects']]
            opts = None if any(x is None for x in o) else [' '.join(x) for x in o]
        tx = {'stem': stem, 'opts': opts} if stem and (opts or not q['optRects']) else None
    if text != q['text'] or tx != q.get('tx'):
        changed.append(q['id'])
        print('==', q['id'], '| text changed:', text != q['text'], '| tx changed:', tx != q.get('tx'))
        if tx and tx != q.get('tx'):
            print('   was:', ' / '.join(q['tx']['stem'])[:150]); print('   now:', ' / '.join(tx['stem'])[:150])
        if write:
            q['text'], q['tx'] = text, tx
print(len(changed), 'questions', 'rewritten' if write else 'would change')

# ---- one question that is really three (narrow left column beside a wide right one; see README) ----
# id -> list of (n, year, answer, question rect, solution rect); the first entry replaces the original.
SPLITS = {
    'c02q21': [(21, 1994, 'c', [116, 48.0, 106.0, 266.0, 260.8], [118, 328.7, 281.6, 600.0, 561.7]),
               (22, 1993, 'c', [116, 266.0, 106.0, 600.0, 193.0], [118, 328.7, 561.7, 600.0, 617.0]),
               (23, 1993, 'a', [116, 266.0, 194.0, 600.0, 260.8], [118, 328.7, 617.0, 600.0, 715.0])],
}
ids = [q['id'] for q in d['questions']]
for qid, parts in SPLITS.items():
    ch = qid.split('q')[0]
    if f'{ch}q{parts[1][0]}' in ids:
        print(qid, 'already split'); continue
    base = d['questions'][ids.index(qid)]; new = []
    for n, year, ans, qr, sr in parts:
        # checked by eye to be plain prose, so skip looks_prose (a last line of just "be (1993)" trips its maths test)
        full = ' '.join(TX.paragraphs(TX.region_lines(W, [qr]), strip_marker=True))
        m = re.search(r'\(a\)\s*(.*?)\s*\(b\)\s*(.*?)\s*\(c\)\s*(.*?)\s*\(d\)\s*(.*)$', full)
        assert m, (n, full)
        q = dict(base, id=f'{ch}q{n}', n=n, year=year, ans=ans, rects=[qr], stem=None, optRects=None, type='MCQ', opts=True,
                 text=' '.join(ln['text'] for ln in TX.region_lines(W, [qr]))[:2500],
                 tx={'stem': [full[:m.start()].strip()], 'opts': [g.strip() for g in m.groups()]},
                 sol={'rects': [sr], 'text': ' '.join(ln['text'] for ln in TX.region_lines(W, [sr])), 'tx': None})
        q.pop('fix', None); new.append(q)
        print('  ', q['id'], year, ans, '| opts', q['tx']['opts'], '| stem', len(q['tx']['stem'][0]), 'chars | sol starts', q['sol']['text'][:24])
    if write:
        i = ids.index(qid); d['questions'][i:i + 1] = new; ids = [q['id'] for q in d['questions']]

# ---- full-width strips that hold only the next section's heading, captured as the tail of a question ----
TRIM_HEADINGS = {'c16q287': 'Decision Making', 'c16q327': 'One Word Substitution'}
for qid, heading in TRIM_HEADINGS.items():
    q = d['questions'][ids.index(qid)]
    keep = [r for r in q['rects'] if ' '.join(w[4] for w in sorted(TX.words_in(W[r[0]], r), key=lambda w: w[0])).strip() != heading]
    if len(keep) != len(q['rects']):
        print(qid, 'heading strip removed:', heading)
        if write:
            q['rects'] = keep
            q['text'] = re.sub(r'\s*' + re.escape(heading) + r'\s*$', '', q['text'])
            if q.get('tx'): q['tx']['stem'] = [t for t in (re.sub(r'\s*' + re.escape(heading) + r'\s*$', '', x) for x in q['tx']['stem']) if t]

if write:
    json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
