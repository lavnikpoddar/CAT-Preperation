#!/usr/bin/env python3
"""
Extract questions, directions, solutions and answer keys from the
"Face 2 Face CAT" PDF into data/questions.json, plus crop rectangles
(in PDF points) so the web app can show each question as an image
cropped from the rendered page.

Usage:
  pdftotext -bbox-layout -f 90 -l 721 book.pdf chapters.xml
  python3 -I tools/extract.py chapters.xml data/questions.json [--pages img/pages]

The --pages directory (rendered page PNGs named p-NNN.png at PAGE_DPI) is
optional; when given, crop rectangles are tightened to the ink inside them.
"""
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import transcribe as TX  # noqa: E402

NS = {"x": "http://www.w3.org/1999/xhtml"}
FIRST_PAGE = 90           # PDF page number of the first page in chapters.xml
PAGE_W, PAGE_H = 648.0, 828.0
CENTER = 324.0            # gutter between the two text columns
BODY_TOP = 88.0           # below the running header
BODY_BOTTOM = 744.0       # above the footer line (page number | chapter)
X_LEFT, X_RIGHT = 48.0, 600.0
CROSS_MARGIN = 20.0       # a text block spanning the gutter +/- this is "full width"
PAGE_DPI = 150

# (chapter number, title, section, first PDF page). Last chapter ends at 721.
CHAPTERS = [
    (1, "Number System", "QA", 90),
    (2, "Percentage", "QA", 114),
    (3, "Profit, Loss and Ratio, Proportion", "QA", 119),
    (4, "Time, Speed and Distance", "QA", 129),
    (5, "Interest and Average", "QA", 148),
    (6, "Mensuration", "QA", 152),
    (7, "Geometry", "QA", 170),
    (8, "Algebra", "QA", 190),
    (9, "Permutations, Combinations and Probability", "QA", 212),
    (10, "Functions", "QA", 220),
    (11, "Miscellaneous", "QA", 234),
    (12, "Data Sufficiency", "DILR", 244),
    (13, "Analytical Reasoning", "DILR", 265),
    (14, "Logical Reasoning", "DILR", 320),
    (15, "Data Interpretation", "DILR", 332),
    (16, "English Usage", "VARC", 452),
    (17, "Para Jumbles", "VARC", 509),
    (18, "Reading Comprehension", "VARC", 547),
]
LAST_PAGE = 721
SECTIONS = {
    "QA": "Quantitative Aptitude",
    "DILR": "Data Interpretation & Logical Reasoning",
    "VARC": "Verbal Ability & Reading Comprehension",
}
# Sub-topic headings used inside the English Usage chapter.
SUBTOPICS = [
    "Odd One Out", "Summarising", "Paragraph Conclusion/Completion",
    "Word Usage", "Sentence Correction/Improvement", "Fillers",
    "Error Detection", "Decision Making, One Word Substitution", "Analogy",
]

YEAR_RE = re.compile(r"\(\s*[^\w(]*\s*((?:199\d|20[01]\d))\s*\)")
QNUM_RE = re.compile(r"^(\d{1,3})\)$")
RANGE_RE = re.compile(r"Q\.?\s*Nos?\.?\s*(\d+)\s*(?:[-–to]+\s*(\d+))?", re.I)
ANS_RE = re.compile(r"^\s*\d{1,3}\)\s*\(([a-d]|\d{1,2})\)")


def load_pages(xml_path):
    root = ET.parse(xml_path).getroot()
    pages = {}
    for i, pg in enumerate(root.findall(".//x:page", NS)):
        pno = FIRST_PAGE + i
        blocks = []
        for blk in pg.findall(".//x:block", NS):
            lines = []
            for ln in blk.findall("x:line", NS):
                words = []
                for w in ln.findall("x:word", NS):
                    words.append((float(w.get("xMin")), float(w.get("yMin")),
                                  float(w.get("xMax")), float(w.get("yMax")),
                                  (w.text or "").strip()))
                if words:
                    lines.append(words)
            if lines:
                blocks.append(lines)
        pages[pno] = blocks
    return pages


def word_meta(blocks):
    """Map a word tuple to (line top, block top)."""
    m = {}
    for blk in blocks:
        bt = min(w[1] for ln in blk for w in ln)
        for ln in blk:
            lt = min(w[1] for w in ln)
            lb = max(w[3] for w in ln)
            for w in ln:
                m[w] = (lt, bt, lb)
    return m


OPT_MARKS = ("(a)", "(b)", "(c)", "(d)", "(e)")


def words_in_rect(words, rect):
    p, x0, y0, x1, y1 = rect
    ws = [w for w in words
          if (w[0] + w[2]) / 2 >= x0 and (w[0] + w[2]) / 2 < x1
          and (w[1] + w[3]) / 2 >= y0 and (w[1] + w[3]) / 2 < y1]
    ws.sort(key=lambda w: (round(w[1] / 4), w[0]))
    return ws


def split_options(rects, words_by_page, meta_by_page, ink_by_page):
    """Split a question region into a stem and four option crops.
    Returns (stem_rects, [opt_rects x4]) or None when the options cannot be
    located (TITA questions, options given in the directions, odd layouts)."""
    marks = []
    for ri, rect in enumerate(rects):
        for w in words_in_rect(words_by_page[rect[0]], rect):
            if w[4] in OPT_MARKS:
                marks.append((ri, w))
    found = {}
    for ri, w in marks:
        if w[4] not in found:
            found[w[4]] = (ri, w)
    if any(m not in found for m in OPT_MARKS[:4]):
        return None
    order = [found[m] for m in OPT_MARKS if m in found]
    for (r1, w1), (r2, w2) in zip(order, order[1:]):
        later = r2 > r1 or (r2 == r1 and (w2[1] > w1[1] + 4 or (abs(w2[1] - w1[1]) <= 4 and w2[0] > w1[0])))
        if not later:
            return None
    nopt = len(order)
    # top of each marker's row (block top catches a fraction numerator)
    metas = [meta_by_page[rects[ri][0]].get(w, (w[1], w[1], w[3])) for ri, w in order]
    tops = []
    for lt, bt, lb in metas:
        top = lt - 1
        # extend to the block top for a numerator, but not onto another option row
        if 0 < lt - bt <= 10 and not any(abs(lt2 - bt) < 2 for lt2, _, _ in metas if lt2 != lt):
            top = bt - 1
        tops.append(top)
    rows = []  # [ri, top, [idx, ...]]
    for i, ((ri, w), top) in enumerate(zip(order, tops)):
        if rows and rows[-1][0] == ri and abs(top - rows[-1][1]) <= 4:
            rows[-1][2].append(i)
        else:
            rows.append([ri, top, [i]])
    # between stacked rows, cut halfway between the previous row's baseline
    # line and this row's line, so fraction numerators/denominators stay whole
    for k in range(1, len(rows)):
        if rows[k][0] != rows[k - 1][0]:
            continue
        rect = rects[rows[k][0]]
        prev_top = rows[k - 1][1]
        this_top = min(metas[i][0] for i in rows[k][2])
        # last ink line of the previous option: its words (wrapped lines,
        # denominators) but not a small numerator hugging the next row
        ws = [w for w in words_in_rect(words_by_page[rect[0]], rect)
              if prev_top <= (w[1] + w[3]) / 2 < this_top
              and not (w[2] - w[0] < 25 and w[1] > this_top - 10 and w[1] > prev_top + 6)]
        prev_bottom = max([w[3] for w in ws] + [max(metas[i][2] for i in rows[k - 1][2])])
        if this_top > prev_bottom:
            rows[k][1] = prev_bottom + min(1.5, (this_top - prev_bottom) / 2)
        else:
            rows[k][1] = prev_bottom + 0.5
    opt_rects = [None] * nopt
    for k, (ri, top, idxs) in enumerate(rows):
        p, rx0, ry0, rx1, ry1 = rects[ri]
        if k + 1 < len(rows) and rows[k + 1][0] == ri:
            bottom = rows[k + 1][1]
        else:
            bottom = ry1
        band = [p, rx0, top, rx1, bottom]
        year_x = [w[0] for w in words_in_rect(words_by_page[p], band) if YEAR_RE.fullmatch(w[4])]
        for j, i in enumerate(idxs):
            w = order[i][1]
            xs = w[0] - 2
            xe = order[idxs[j + 1]][1][0] - 3 if j + 1 < len(idxs) else rx1
            if year_x and j == len(idxs) - 1:
                xe = min(xe, min(year_x) - 2)
            opt_rects[i] = [[p, xs, top, xe, bottom]]
    if any(o is None for o in opt_rects):
        return None
    first_ri, first_top = rows[0][0], rows[0][1]
    stem = []
    for ri, rect in enumerate(rects[:first_ri + 1]):
        r = list(rect)
        if ri == first_ri:
            r[4] = first_top - 1
        if r[4] - r[2] > 3:
            stem.append(r)
    if ink_by_page:
        stem = tighten(stem, ink_by_page)
        opt_rects = [tighten(o, ink_by_page, pad=2.0, trim_x=True) for o in opt_rects]
    if not stem or any(not o for o in opt_rects):
        return None
    return stem, opt_rects


def in_body(w):
    return BODY_TOP <= w[1] and w[3] <= BODY_BOTTOM + 4


def page_lines(blocks):
    return [ln for blk in blocks for ln in blk if in_body(ln[0])]


def page_words(blocks):
    return [w for blk in blocks for ln in blk for w in ln if in_body(w)]


def block_box(blk):
    ws = [w for ln in blk for w in ln]
    return (min(w[0] for w in ws), min(w[1] for w in ws),
            max(w[2] for w in ws), max(w[3] for w in ws))


def compute_layout(blocks):
    """Return (gutter_x, zones). Zones split the page body vertically into
    alternating full-width and two-column zones: list of {top, bot, full}."""
    words = page_words(blocks)
    if not words:
        return CENTER, []
    boxes = [block_box(b) for b in blocks if in_body(b[0][0])]
    # per-page gutter: between the widest left-column block and the
    # leftmost right-column block
    lefts = [b[2] for b in boxes if b[0] < 300 and b[2] < 345]
    rights = [b[0] for b in boxes if 300 < b[0] < 360]
    gutter = CENTER
    if lefts and rights:
        g = (max(lefts) + min(rights)) / 2
        if 305 < g < 345:
            gutter = g
    top = min(w[1] for w in words) - 2
    bot = max(w[3] for w in words) + 2
    crossing = [b for b in boxes if b[0] < gutter - CROSS_MARGIN and b[2] > gutter + CROSS_MARGIN]
    n_lines = sum(len(b) for b in blocks if in_body(b[0][0]))
    n_cross_lines = sum(len(b) for b in blocks if in_body(b[0][0])
                        and block_box(b) in crossing)
    if n_cross_lines >= 3 and n_cross_lines >= 0.25 * n_lines:
        # single-column (full-width) page layout
        return gutter, [{"top": top, "bot": bot, "full": True}]
    ivs = sorted((b[1], b[3]) for b in crossing)
    merged = []
    for a, b in ivs:
        if merged and a <= merged[-1][1] + 3:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    zones = []
    cur = top
    for a, b in merged:
        a = max(a - 1.5, cur)
        if a > cur + 1:
            zones.append({"top": cur, "bot": a, "full": False})
        zones.append({"top": a, "bot": min(b + 1.5, bot), "full": True})
        cur = min(b + 1.5, bot)
    if cur < bot - 1:
        zones.append({"top": cur, "bot": bot, "full": False})
    return gutter, zones


def locate(zones, gutter, y, x):
    """Return (zone index, column, y) for a word at (x, y)."""
    for zi, z in enumerate(zones):
        if y < z["bot"] or zi == len(zones) - 1:
            col = 0 if (z["full"] or x < gutter - 6) else 1
            return (zi, col, y)
    return (len(zones) - 1, 0, y)


class Pos:
    __slots__ = ("page", "zi", "col", "y")

    def __init__(self, page, zi, col, y):
        self.page, self.zi, self.col, self.y = page, zi, col, y

    def key(self):
        return (self.page, self.zi, self.col, self.y)


def col_x(col, full, gutter):
    if full:
        return X_LEFT, X_RIGHT
    return (X_LEFT, gutter) if col == 0 else (gutter, X_RIGHT)


def rects_on_page(layout, start, end):
    """Rectangles covering reading order from `start` to `end` on one page.
    start/end are (zi, col, y) or None (page start / page end)."""
    gutter, zones, words = layout
    out = []
    if not zones:
        return out
    s = start or (0, 0, zones[0]["top"])
    e = end or (len(zones) - 1, 1 if not zones[-1]["full"] else 0, zones[-1]["bot"])
    szi, scol, sy = s
    ezi, ecol, ey = e
    for zi in range(szi, ezi + 1):
        z = zones[zi]
        full = z["full"]
        y0 = sy if zi == szi else z["top"]
        y1 = ey if zi == ezi else z["bot"]
        c0 = scol if zi == szi else 0
        c1 = ecol if zi == ezi else (0 if full else 1)
        if full or c0 == c1:
            x0, x1 = col_x(c0, full, gutter)
            out.append([x0, y0, x1, y1])
        else:  # left column tail then right column head
            whole_left = not any(w[0] < gutter and z["top"] <= w[1] and w[3] < y0 - 1
                                 for w in words)
            whole_right = not any(w[0] >= gutter and w[1] > y1 + 1 and w[3] <= z["bot"]
                                  for w in words)
            if whole_left and whole_right:
                out.append([X_LEFT, z["top"], X_RIGHT, z["bot"]])
            else:
                out.append([X_LEFT, y0, gutter, z["bot"]])
                out.append([gutter, z["top"], X_RIGHT, y1])
    # merge vertically adjacent full-width rects
    merged = []
    for r in out:
        if (merged and abs(merged[-1][0] - r[0]) < 0.1 and abs(merged[-1][2] - r[2]) < 0.1
                and abs(merged[-1][3] - r[1]) < 2.5):
            merged[-1][3] = r[3]
        else:
            merged.append(list(r))
    return [r for r in merged if r[3] - r[1] > 4]


def region_rects(layouts, a, b, last_page):
    """Rectangles (page, x0, y0, x1, y1) from Pos a up to Pos b (exclusive)."""
    rects = []
    if b is None or b.page > a.page:
        for r in rects_on_page(layouts[a.page], (a.zi, a.col, a.y), None):
            rects.append([a.page] + r)
        endp = (b.page - 1) if b else last_page
        for p in range(a.page + 1, endp + 1):
            for r in rects_on_page(layouts[p], None, None):
                rects.append([p] + r)
        if b:
            for r in rects_on_page(layouts[b.page], None, (b.zi, b.col, b.y)):
                rects.append([b.page] + r)
    else:
        for r in rects_on_page(layouts[a.page], (a.zi, a.col, a.y), (b.zi, b.col, b.y)):
            rects.append([a.page] + r)
    return rects


def rect_text(words_by_page, rects):
    parts = []
    for p, x0, y0, x1, y1 in rects:
        ws = [w for w in words_by_page[p]
              if (w[0] + w[2]) / 2 >= x0 and (w[0] + w[2]) / 2 < x1
              and (w[1] + w[3]) / 2 >= y0 and (w[1] + w[3]) / 2 < y1]
        ws.sort(key=lambda w: (round(w[1] / 4), w[0]))
        parts.append(" ".join(w[4] for w in ws))
    return re.sub(r"\s+", " ", " ".join(parts)).strip()


def find_anchors(pno, blocks, layout, subtopic_names):
    """Anchors on one page: list of (Pos, kind, payload)."""
    gutter, zones, _ = layout
    out = []
    for blk in blocks:
        if not in_body(blk[0][0]):
            continue
        blk_top = min(w[1] for ln in blk for w in ln)
        for ln in blk:
            out += line_anchors(pno, ln, blk_top, gutter, zones, subtopic_names)
    return out


def line_anchors(pno, ln, blk_top, gutter, zones, subtopic_names):
    out = []
    if True:
        w0 = ln[0]
        x, t = w0[0], w0[4]
        y = min(w[1] for w in ln) - 1
        # a fraction numerator on the first line sits a few points above the
        # line's own words but inside the same block: start the region there
        if 0 < y + 1 - blk_top <= 10:
            y = blk_top - 1
        in_margin = x < 110 or 315 <= x < 365
        line_text = " ".join(w[4] for w in ln)
        m = QNUM_RE.match(t)
        if m and in_margin:
            out.append((Pos(pno, *locate(zones, gutter, y, x)), "q", int(m.group(1))))
            return out
        if t.startswith("Directi") and in_margin and "(Q" in line_text.replace(" ", "")[:16]:
            out.append((Pos(pno, *locate(zones, gutter, y, x)), "dir", line_text))
            return out
        if t in ("Solutions", "Solution") and len(ln) > 1 and ln[1][4].startswith("(Q") and in_margin:
            out.append((Pos(pno, *locate(zones, gutter, y, x)), "solgrp", line_text))
            return out
        if t == "HINTS" and "SOLUTIONS" in line_text:
            out.append((Pos(pno, *locate(zones, gutter, y, x)), "hints", None))
            return out
        if subtopic_names and line_text in subtopic_names and 120 < x < 520 and len(ln) <= 5:
            out.append((Pos(pno, *locate(zones, gutter, y, x)), "sub", line_text))
    return out


def snap_gap(ink_by_page, p, x0, x1, y, max_up=10.0, gap_px=3):
    """Move y upward over ink that belongs to the row below it (a fraction
    numerator) until a blank gap of gap_px rows is found."""
    ink = ink_by_page.get(p)
    if ink is None:
        return y
    s = PAGE_DPI / 72.0
    px0, px1 = int(x0 * s), int(x1 * s)
    py = int(y * s)
    if not ink[py - 1, px0:px1].any() and not ink[py - 2, px0:px1].any():
        return y  # boundary already sits in white space
    blank = 0
    yy = py - 1
    while yy > py - int(max_up * s):
        if ink[yy, px0:px1].any():
            blank = 0
        else:
            blank += 1
            if blank >= gap_px:
                return (yy + gap_px) / s
        yy -= 1
    return y


def tighten(rects, ink_by_page, pad=3.0, trim_x=False):
    """Shrink each rect to the ink it contains (using rendered pages)."""
    out = []
    s = PAGE_DPI / 72.0
    for p, x0, y0, x1, y1 in rects:
        ink = ink_by_page.get(p)
        if ink is None:
            out.append([p, x0, y0, x1, y1])
            continue
        px0, px1 = int(x0 * s), int(x1 * s)
        py0, py1 = int(y0 * s), int(y1 * s)
        sub = ink[py0:py1, px0:px1]
        rows = sub.any(axis=1).nonzero()[0]
        if len(rows) == 0:
            continue
        ny0 = max(y0, (py0 + rows[0]) / s - pad)
        ny1 = min(y1, (py0 + rows[-1] + 1) / s + pad)
        nx0, nx1 = x0, x1
        if trim_x:
            cols = sub.any(axis=0).nonzero()[0]
            nx0 = max(x0, (px0 + cols[0]) / s - pad)
            nx1 = min(x1, (px0 + cols[-1] + 1) / s + pad)
        out.append([p, round(nx0, 1), round(ny0, 1), round(nx1, 1), round(ny1, 1)])
    return out


def main():
    xml_path, out_path = sys.argv[1], sys.argv[2]
    pages_dir = None
    if "--pages" in sys.argv:
        pages_dir = sys.argv[sys.argv.index("--pages") + 1]
    rules_by_page, figs_by_page = {}, {}
    if "--drawings" in sys.argv:
        with open(sys.argv[sys.argv.index("--drawings") + 1]) as f:
            for k, v in json.load(f).items():
                rules_by_page[int(k)] = v["rules"]
                figs_by_page[int(k)] = v["figs"]
    do_tx = "--drawings" in sys.argv
    pages = load_pages(xml_path)
    words_by_page = {p: page_words(b) for p, b in pages.items()}
    meta_by_page = {p: word_meta(b) for p, b in pages.items()}
    layouts = {}
    for p, b in pages.items():
        gutter, zones = compute_layout(b)
        layouts[p] = (gutter, zones, words_by_page[p])

    ink_by_page = {}
    if pages_dir:
        import numpy as np
        from PIL import Image
        for p in pages:
            fn = os.path.join(pages_dir, f"p-{p:03d}.png")
            if os.path.exists(fn):
                ink_by_page[p] = np.asarray(Image.open(fn).convert("L")) < 180

    chapters, questions, directions, solgroups = [], [], {}, {}
    report = []
    for idx, (num, title, sec, start) in enumerate(CHAPTERS):
        end = CHAPTERS[idx + 1][3] - 1 if idx + 1 < len(CHAPTERS) else LAST_PAGE
        sub_names = SUBTOPICS if title == "English Usage" else []
        anchors = []
        for p in range(start, end + 1):
            anchors += find_anchors(p, pages[p], layouts[p], sub_names)
        anchors.sort(key=lambda a: a[0].key())
        if ink_by_page:
            # a fraction numerator on an anchor's first line sits above the
            # line's words: pull the boundary up to the nearest blank gap
            for pos, kind, _ in anchors:
                if kind not in ("q", "dir", "solgrp"):
                    continue
                gutter, zones, _w = layouts[pos.page]
                if not zones:
                    continue
                z = zones[min(pos.zi, len(zones) - 1)]
                x0, x1 = col_x(pos.col, z["full"], gutter)
                pos.y = snap_gap(ink_by_page, pos.page, x0, x1, pos.y)

        # walk anchors in reading order
        mode = "q"
        cur_dir = None          # current directions id
        cur_dir_range = None
        cur_sub = None
        sol_sub = None
        cur_solgrp = None
        qmap = {}               # (sub, n) -> question dict
        expected = 1
        seq_issues = []
        ch_id = f"c{num:02d}"
        subtopics = []
        sol_expected = 1
        for i, (pos, kind, payload) in enumerate(anchors):
            nxt = anchors[i + 1][0] if i + 1 < len(anchors) else None
            rects = region_rects(layouts, pos, nxt, end)
            if ink_by_page:
                rects = tighten(rects, ink_by_page)
            text = rect_text(words_by_page, rects)
            if kind == "hints":
                mode = "s"
                sol_sub = subtopics[0] if subtopics else None
                sol_expected = 1
                continue
            if kind == "sub":
                if mode == "q":
                    cur_sub = payload
                    if payload not in subtopics:
                        subtopics.append(payload)
                    expected = expected  # numbering is continuous in this book
                else:
                    sol_sub = payload
                continue
            if kind == "dir":
                if mode != "q":
                    continue
                did = f"{ch_id}d{len(directions) + 1}"
                m = RANGE_RE.search(text)
                rng = None
                if m:
                    a = int(m.group(1))
                    b = int(m.group(2)) if m.group(2) else a
                    rng = [a, b]
                ym = YEAR_RE.search(text)
                directions[did] = {"id": did, "ch": ch_id, "rects": rects,
                                   "text": text[:4000], "range": rng,
                                   "year": int(ym.group(1)) if ym else None,
                                   "tx": TX.transcribe_with_tables(words_by_page, rects, figs_by_page, rules_by_page) if do_tx else None}
                cur_dir, cur_dir_range = did, rng
                continue
            if kind == "solgrp":
                gid = f"{ch_id}g{len(solgroups) + 1}"
                m = RANGE_RE.search(text)
                rng = [int(m.group(1)), int(m.group(2) or m.group(1))] if m else None
                solgroups[gid] = {"id": gid, "ch": ch_id, "rects": rects,
                                  "text": text[:4000], "range": rng}
                cur_solgrp = (gid, rng)
                continue
            # kind == "q"
            n = payload
            if mode == "q":
                if n != expected:
                    seq_issues.append((pos.page, n, expected))
                    if n < expected - 1 or n > expected + 3:
                        # out of sequence: treat as noise unless it continues
                        continue
                expected = n + 1
                ym = YEAR_RE.search(text)
                year = int(ym.group(1)) if ym else None
                d = None
                if cur_dir and (cur_dir_range is None or cur_dir_range[0] <= n <= cur_dir_range[1]):
                    d = cur_dir
                if d and year is None:
                    year = directions[d]["year"]
                has_opts = bool(re.search(r"\(a\)", text)) and bool(re.search(r"\(b\)", text))
                qtype = "MCQ" if has_opts or (year or 0) < 2015 else "TITA"
                q = {"id": f"{ch_id}q{n}", "ch": ch_id, "n": n, "sub": cur_sub,
                     "year": year, "type": qtype, "opts": has_opts,
                     "dir": d, "rects": rects, "text": text[:2500],
                     "stem": None, "optRects": None,
                     "ans": None, "sol": None, "solgrp": None}
                if has_opts:
                    so = split_options(rects, words_by_page, meta_by_page, ink_by_page)
                    if so:
                        q["stem"], q["optRects"] = so
                q["tx"] = None
                if do_tx:
                    stem_tx = TX.transcribe(words_by_page, q["stem"] or rects, figs_by_page, strip_marker=True)
                    opts_tx = None
                    if q["optRects"]:
                        opts_tx = [TX.transcribe(words_by_page, o, figs_by_page, strip_marker=True) for o in q["optRects"]]
                        if any(o is None for o in opts_tx):
                            opts_tx = None
                        else:
                            opts_tx = [" ".join(o) for o in opts_tx]
                    if stem_tx and (opts_tx or not q["optRects"]):
                        q["tx"] = {"stem": stem_tx, "opts": opts_tx}
                questions.append(q)
                qmap[n] = q
            else:
                q = qmap.get(n)
                if q is None:
                    continue
                if q["sol"] is not None and n != sol_expected:
                    continue  # duplicate/noise number inside solutions text
                sol_expected = n + 1
                m = ANS_RE.match(text)
                q["sol"] = {"rects": rects, "text": text[:3000],
                            "tx": TX.transcribe(words_by_page, rects, figs_by_page, strip_marker=True) if do_tx else None}
                if m:
                    q["ans"] = m.group(1)
                if cur_solgrp and cur_solgrp[1] and cur_solgrp[1][0] <= n <= cur_solgrp[1][1]:
                    q["solgrp"] = cur_solgrp[0]
        qs = [q for q in questions if q["ch"] == ch_id]
        chapters.append({"id": ch_id, "num": num, "title": title, "section": sec,
                         "pages": [start, end], "subtopics": subtopics,
                         "count": len(qs)})
        nsol = sum(1 for q in qs if q["sol"])
        nans = sum(1 for q in qs if q["ans"])
        nyear = sum(1 for q in qs if q["year"])
        nopt = sum(1 for q in qs if q["optRects"])
        ntx = sum(1 for q in qs if q.get("tx"))
        report.append(f"ch{num:02d} {title[:28]:28s} pages {start}-{end} "
                      f"q={len(qs):4d} sol={nsol:4d} ans={nans:4d} year={nyear:4d} opt={nopt:4d} tx={ntx:4d} "
                      f"seq_issues={len(seq_issues)} {seq_issues[:6]}")

    data = {"book": "Face 2 Face CAT – Sectionwise & Topicwise Solved Papers 1993-2019 (Arihant)",
            "pageDpi": PAGE_DPI, "pageSize": [PAGE_W, PAGE_H],
            "sections": SECTIONS, "chapters": chapters,
            "directions": directions, "solgroups": solgroups, "questions": questions}
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print("\n".join(report))
    print("total questions", len(questions), "json bytes", os.path.getsize(out_path))


if __name__ == "__main__":
    main()
