#!/usr/bin/env python3
"""Extract the openly licensed / public-domain reading texts into data/readings_full.json.
Usage: extract_readings.py SRC_DIR   (SRC_DIR holds the raw downloads, see FILES below)
Only texts that are free to reproduce are handled here: public-domain, CC-licensed, MIT-licensed,
and Indian court judgments."""
import re, sys, json, html, subprocess, os
src = sys.argv[1]
def rd(f): return open(os.path.join(src, f), encoding='utf-8', errors='replace').read()
def clean(t): return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', t))).strip()
out = {}

# 13: Woolf, A Room of One's Own, chapter 1 (public domain)
h = rd('woolf.html'); a = h.index('name="ch1"'); b = h.index('name="ch2"')
paras = [clean(x) for x in re.findall(r'<p[^>]*>(.*?)</p>', h[a:b], flags=re.S)]
out['13'] = dict(src='Project Gutenberg Australia', lic='Public domain', blocks=[['h', 'Chapter 1']] + [['p', p] for p in paras if p])

# 9b: Nakamoto, Bitcoin whitepaper (MIT licence). Figures and equations do not survive text extraction and are left out.
txt = subprocess.run(['pdftotext', os.path.join(src, 'bitcoin.pdf'), '-'], capture_output=True, text=True).stdout
txt = txt.rsplit('\nReferences\n', 1)[0]
raw = [re.sub(r'\s*\n\s*', ' ', c).strip() for c in re.split(r'\n\s*\n', txt)]
raw = [c for c in raw if c]
blocks = []; i = 0
while i < len(raw):
    c = raw[i]
    if re.fullmatch(r'\d+\.', c) and i + 1 < len(raw) and len(raw[i + 1]) < 60:
        blocks.append(['h', c + ' ' + raw[i + 1]]); i += 2; continue
    if c.startswith('Abstract.'):
        blocks += [['h', 'Abstract'], ['p', c[len('Abstract.'):].strip()]]
    elif re.match(r'^(10\. Privacy|11\. Calculations) ', c):
        h_, rest = re.match(r'^(\d+\. \w+) (.*)$', c).groups(); blocks += [['h', h_], ['p', rest]]
    elif c.startswith('Bitcoin: A Peer'):
        pass
    elif c.startswith('12. Conclusion'):
        blocks += [['h', '12. Conclusion'], ['p', c[len('12. Conclusion'):].strip()]]
    elif len(c) >= 90 and sum(ch.isalpha() or ch == ' ' for ch in c) / len(c) > 0.85:
        blocks.append(['p', c.replace('proofof-work', 'proof-of-work')])
    i += 1
blocks.append(['n', 'Figures and equations are left out of this copy. Sections 1 to 12 follow the original; the PDF has the diagrams.'])
out['9b'] = dict(src='bitcoin.org', lic='MIT licence', blocks=blocks)

# 23b: Ioannidis, Why Most Published Research Findings Are False (PLOS Medicine, open access, CC0)
x = rd('ioannidis.xml'); body = x[x.index('<body>'):x.index('</body>')]
body = re.sub(r'<(table-wrap|fig|disp-formula)\b.*?</\1>', '', body, flags=re.S)
blocks = []
ab = re.search(r'<abstract>(.*?)</abstract>', x, flags=re.S)
if ab: blocks += [['h', 'Summary'], ['p', re.sub(r'^Summary\s+', '', clean(ab.group(1)))]]
for m in re.finditer(r'<(sec|title|p)\b[^>]*>(.*?)</\1>' , body, flags=re.S):
    pass
def walk(sec_html):
    for m in re.finditer(r'<title>(.*?)</title>|<p>(.*?)</p>', sec_html, flags=re.S):
        if m.group(1) is not None:
            t = clean(m.group(1))
            if t: blocks.append(['h', t])
        else:
            t = clean(m.group(2))
            if t: blocks.append(['p', t])
walk(body)
blocks.append(['n', 'The original’s tables and figures are left out of this copy.'])
out['23b'] = dict(src='PLOS Medicine', lic='Open access, public domain (CC0)', blocks=blocks)

# Indian Kanoon judgments (court judgments are not subject to copyright in India)
def judgment(f):
    h = rd(f); h = h[h.index('class="judgments"'):]
    out_ = []
    for tag, x in re.findall(r'<(p|blockquote)\b[^>]*>(.*?)</\1>', h, flags=re.S):
        t = clean(x)
        if t: out_.append((tag == 'blockquote', t))
    return out_

# 7b: Shreya Singhal v. Union of India (2015): opening, then the Article 19(1)(a) discussion, then the summary of the holding
J = judgment('singhal.html')
def jblocks(rows):
    res = []
    for q, t in rows:
        if q: res.append(['q', t])
        elif len(t) < 60 and not re.match(r'^\d', t):
            if len(t) > 12 and not t.startswith('(') and t[-1] not in ').': res.append(['h', t.rstrip(' -:')])
        else: res.append(['p', t])
    return res
i0 = next(i for i, (q, t) in enumerate(J) if t.startswith('A. Article 19(1)(a)'))
i1 = next(i for i, (q, t) in enumerate(J) if t == 'Vagueness')
i2 = next(i for i, (q, t) in enumerate(J) if t.startswith('119. In conclusion'))
rows = J[0:1] + J[1:2] + J[i0:i1] + J[i2:i2 + 6]
rows = [r for r in rows if not r[1].startswith('R.F. NARIMAN')]
b = jblocks(rows)
b.insert(0, ['n', 'Excerpt: the opening paragraph, the discussion of Article 19(1)(a) and its limits, and the final summary. The sections on vagueness, overbreadth and intermediaries are left out.'])
out['7b'] = dict(src='Indian Kanoon, Supreme Court of India, 24 March 2015', lic='Court judgment', blocks=b)

# 13b: Puttaswamy v. Union of India (2017): Justice Chandrachud's "Our Conclusions"
P = judgment('puttaswamy.html')
k = next(i for i, (q, t) in enumerate(P) if t.startswith('T Our Conclusions'))
t = ' '.join(x for _, x in P[k:k + 10]).replace('T Our Conclusions ', '', 1)
t = re.sub(r'\b\d{1,3}\s+PART\s+[A-Z]\b', '', t); t = re.sub(r'\s+', ' ', t)
parts = re.split(r'\s(?=\([A-L]\)\s)|\s(?=[1-9]\s[A-Z(])', t)
merged = []
for x in parts:
    if merged and re.fullmatch(r'\d', merged[-1]): merged[-1] += ' ' + x
    else: merged.append(x)
cut = next(i for i, x in enumerate(merged) if x.startswith('6 The reference'))
b = [['h', 'Our Conclusions']] + [['p', x] for x in merged[:cut + 1]]
b.insert(0, ['n', 'Excerpt: the closing section of Justice Chandrachud’s opinion. The full judgment runs to hundreds of pages.'])
out['13b'] = dict(src='Indian Kanoon, Supreme Court of India, 24 August 2017', lic='Court judgment', blocks=b)

dest = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'readings_full.json')
json.dump(out, open(dest, 'w'), ensure_ascii=False, separators=(',', ':'))
for k_, v in sorted(out.items()): print(k_, len(v['blocks']), 'blocks', sum(len(x[1].split()) for x in v['blocks']), 'words')
