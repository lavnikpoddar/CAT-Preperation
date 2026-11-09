#!/usr/bin/env python3
"""Turn texts you supply into private/readings_text.json, which the Reading page shows in the reader.

Usage: build_private.py SRC_DIR
SRC_DIR holds one file per reading, named by its key: 1.txt, 1b.html, 8b.pdf ... (key = day number, plus 'b'
for the modern piece; see the reader URL, e.g. #/read/8b). Accepted: .txt/.md, .html, .pdf (needs pdftotext).
In .txt/.md a line starting with '# ' is a heading and a line starting with '> ' is a quotation;
blank lines separate paragraphs. Existing entries for other keys are kept.

The output is for your own private use. Keep the repo private and set SITE_PASSWORD: the Worker refuses
/private/ until it is set."""
import sys, os, re, json, html, subprocess
from html.parser import HTMLParser

class Strip(HTMLParser):
    SKIP = {'script', 'style', 'nav', 'header', 'footer', 'aside', 'form', 'noscript'}
    BLOCK = {'p', 'div', 'br', 'li', 'tr', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'section', 'article'}
    def __init__(s): super().__init__(); s.out = []; s.skip = 0
    def handle_starttag(s, t, a):
        if t in s.SKIP: s.skip += 1
        if t in s.BLOCK: s.out.append('\n\n' if t != 'br' else '\n')
        if t in ('h1', 'h2', 'h3', 'h4'): s.out.append('# ')
        if t == 'blockquote': s.out.append('> ')
    def handle_endtag(s, t):
        if t in s.SKIP and s.skip: s.skip -= 1
        if t in s.BLOCK: s.out.append('\n\n')
    def handle_data(s, d):
        if not s.skip: s.out.append(d)

def to_text(path):
    ext = path.rsplit('.', 1)[-1].lower()
    if ext == 'pdf': return subprocess.run(['pdftotext', path, '-'], capture_output=True, text=True).stdout
    raw = open(path, encoding='utf-8', errors='replace').read()
    if ext in ('html', 'htm'):
        p = Strip(); p.feed(raw); return html.unescape(''.join(p.out))
    return raw

def blocks(text):
    res = []
    for chunk in re.split(r'\n\s*\n', text.replace('\r', '')):
        c = re.sub(r'\s*\n\s*', ' ', chunk).strip()
        if not c: continue
        if c.startswith('# '): res.append(['h', c[2:].strip()])
        elif c.startswith('> '): res.append(['q', c[2:].strip()])
        elif len(c) > 1: res.append(['p', re.sub(r'(\w)- (\w)', r'\1\2', c)])
    return res

if __name__ == '__main__':
    src = sys.argv[1]
    dest = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'private', 'readings_text.json')
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    out = json.load(open(dest)) if os.path.exists(dest) else {}
    for f in sorted(os.listdir(src)):
        key, ext = os.path.splitext(f)
        if not re.fullmatch(r'\d{1,2}b?', key) or ext.lower() not in ('.txt', '.md', '.html', '.htm', '.pdf'): continue
        b = blocks(to_text(os.path.join(src, f)))
        words = sum(len(x[1].split()) for x in b)
        out[key] = dict(src='Private copy', lic='Personal use', blocks=b)
        print(key, len(b), 'blocks', words, 'words')
    json.dump(out, open(dest, 'w'), ensure_ascii=False, separators=(',', ':'))
