#!/usr/bin/env python3
"""Dump the vector drawing objects (ruled lines and curves) of the chapter
pages to JSON, for table and figure detection in extract.py.

Usage: python3 tools/drawings.py book.pdf drawings.json [first] [last]
"""
import json
import sys

import pdfplumber

PAGE_W, PAGE_H = 648.0, 828.0


def inpage(o):
    return (0 <= o["x0"] <= PAGE_W and 0 <= o["x1"] <= PAGE_W
            and 0 <= o["top"] <= PAGE_H and 0 <= o["bottom"] <= PAGE_H)


def main():
    pdf_path, out = sys.argv[1], sys.argv[2]
    first = int(sys.argv[3]) if len(sys.argv) > 3 else 90
    last = int(sys.argv[4]) if len(sys.argv) > 4 else 721
    res = {}
    with pdfplumber.open(pdf_path) as pdf:
        for pno in range(first, last + 1):
            pg = pdf.pages[pno - 1]
            rules, segs = [], []
            for o in pg.lines:
                if not inpage(o):
                    continue
                box = [round(o["x0"], 1), round(o["top"], 1), round(o["x1"], 1), round(o["bottom"], 1)]
                if abs(o["bottom"] - o["top"]) < 1.5 and o["x1"] - o["x0"] >= 120:
                    rules.append(box)      # long horizontal rule (table / separator)
                else:
                    segs.append(box)
            for o in pg.curves:
                if inpage(o):
                    segs.append([round(o["x0"], 1), round(o["top"], 1), round(o["x1"], 1), round(o["bottom"], 1)])
            for o in pg.rects:
                if inpage(o) and o["top"] > 90 and (o["x1"] - o["x0"]) * (o["bottom"] - o["top"]) > 400:
                    segs.append([round(o["x0"], 1), round(o["top"], 1), round(o["x1"], 1), round(o["bottom"], 1)])
            res[pno] = {"rules": rules, "figs": cluster(segs)}
            pg.flush_cache()
    with open(out, "w") as f:
        json.dump(res, f)
    print("pages", len(res), "figure boxes", sum(len(v["figs"]) for v in res.values()))


def cluster(segs, gap=14.0, min_size=30.0):
    """Union nearby drawing segments into figure bounding boxes."""
    boxes = [list(s) for s in segs if s[1] > 90]
    changed = True
    while changed:
        changed = False
        out = []
        for b in boxes:
            for o in out:
                if (b[0] - gap <= o[2] and b[2] + gap >= o[0] and b[1] - gap <= o[3] and b[3] + gap >= o[1]):
                    o[0], o[1], o[2], o[3] = min(o[0], b[0]), min(o[1], b[1]), max(o[2], b[2]), max(o[3], b[3])
                    changed = True
                    break
            else:
                out.append(b)
        boxes = out
    return [b for b in boxes if b[2] - b[0] >= min_size and b[3] - b[1] >= min_size]


if __name__ == "__main__":
    main()
