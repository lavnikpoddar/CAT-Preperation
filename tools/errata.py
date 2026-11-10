#!/usr/bin/env python3
"""Corrections to misprints in the source book, applied to data/questions.json.
Run it last, after any rebuild of questions.json (extract, papers, aglasem, transcribe). Safe to run twice.
Each entry: question id -> (list of (old, new) text replacements for text/tx, note shown under the question)."""
import json, os

ERRATA = {
    # CAT 1995. The book prints option (d) as DACB, but its own solution (and the answer it marks, d)
    # walks through C, A, D, B. No printed option matches the explained order.
    'c17q130': ([('(d)DACB', '(d) CADB')],
                'Book misprint: option (d) is printed as DACB in the book. The book’s own solution gives the order C, A, D, B, so (d) is read here as CADB.'),
}

def fix(s, reps):
    for a, b in reps: s = s.replace(a, b)
    return s

path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'questions.json')
d = json.load(open(path, encoding='utf-8'))
by = {q['id']: q for q in d['questions']}
for qid, (reps, note) in ERRATA.items():
    q = by[qid]
    q['text'] = fix(q['text'] or '', reps)
    if q.get('tx'):
        q['tx']['stem'] = [fix(x, reps) for x in q['tx'].get('stem') or []]
        if isinstance(q['tx'].get('opts'), list): q['tx']['opts'] = [fix(x, reps) for x in q['tx']['opts']]
    q['fix'] = note
    print(qid, 'fixed')
json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
