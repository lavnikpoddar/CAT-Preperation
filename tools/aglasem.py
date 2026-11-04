#!/usr/bin/env python3
"""
Extract the CAT 2024 / 2025 slot papers published by AglaSem (typeset
"Question Paper with Answer Key" PDFs) and merge them into
data/questions.json as chapters a2025s1, a2025s2, ... (section PAPERS).

Layout facts (same for 2024 and 2025 files):
  - A4 pages; body between y=40 and y=805; header/footer outside.
  - "Section I — …", "Section II — …", "Section III — …" headings.
  - Questions: "N." at x≈34 (Georgia 10.8); options "1."–"4." indented
    (x≈65, second column x≈322); TITA questions carry "(TITA — type in
    your answer)".
  - Reading passages and DI/LR set data sit in shaded boxes (light
    blue-grey filled rectangles); DI/LR sets are also introduced by a
    "QUESTION NUMBERS a TO b" line.
  - Maths is drawn as vector glyphs, so text has gaps where formulas are:
    such regions keep the page image.
  - Answer key on the last page: "Q.No …" / "Ans …" rows per section.

Usage:
  python3 tools/aglasem.py data/questions.json --pdf-dir DIR --pages DIR [--img-out img/pages]
DIR must hold cat<year>s<slot>.pdf and the 150-DPI page renders
pages/cat<year>s<slot>-NN.png (pdftoppm -r 150 -gray -png).
"""
import json
import os
import re
import sys

import pdfplumber

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extract as E  # noqa: E402
import transcribe as TX  # noqa: E402

BODY_TOP, BODY_BOTTOM = 40.0, 805.0
PAGE_W, PAGE_H = 595.0, 842.0
QX_MAX = 45.0            # question numbers sit at x≈34
OPT_X_MIN = 55.0         # option markers at x≈65 / 322
SHADE = (0.80, 0.95)     # fill colour range of the shaded boxes
SEC_RE = re.compile(r"^Section\s+(I|II|III)\b")
SEC_MAP = {"I": "VARC", "II": "DILR", "III": "QA"}
QN_RE = re.compile(r"^(\d{1,3})\.$")
SET_RE = re.compile(r"QUESTION NUMBERS\s+(\d+)\s+TO\s+(\d+)", re.I)
VA_RE = re.compile(r"^(The four sentences|The given sentence is missing|There is a sentence that is missing|Five sentences|The passage given below is followed|The four sentences \(labelled)", re.I)


def page_key(name, pno, npages):
    width = len(str(npages))
    return f"{name}-{str(pno).zfill(max(2, width))}"


def clean(pg):
    """The diagonal 'aglasem.com' watermark is rotated text: drop it."""
    return pg.filter(lambda o: o.get("object_type") != "char" or (abs(o["matrix"][1]) < 0.01 and abs(o["matrix"][2]) < 0.01))


def load_words(pdf, name):
    """words_by_page: key -> [(x0, top, x1, bottom, text)], lines grouped."""
    words_by_page, boxes_by_page, labels_by_page = {}, {}, {}
    n = len(pdf.pages)
    for i, pg in enumerate(pdf.pages, start=1):
        key = page_key(name, i, n)
        ws, labels = [], []
        for w in clean(pg).extract_words(extra_attrs=["size"], keep_blank_chars=False):
            if w["top"] < BODY_TOP or w["bottom"] > BODY_BOTTOM:
                continue
            tup = (float(w["x0"]), float(w["top"]), float(w["x1"]), float(w["bottom"]), w["text"])
            (labels if w["size"] <= 8.4 else ws).append(tup)   # small caps: "QUESTION NUMBERS 1 TO 5", "READ THE PASSAGE …"
        words_by_page[key] = ws
        labels_by_page[key] = labels
        boxes = []
        for r in pg.rects:
            c = r.get("non_stroking_color")
            if not r.get("fill") or not isinstance(c, (tuple, list)) or len(c) < 3:
                continue
            if all(SHADE[0] <= v <= SHADE[1] for v in c[:3]) and (r["x1"] - r["x0"]) > 300 and (r["bottom"] - r["top"]) > 30:
                b = (round(r["x0"], 1), round(r["top"], 1), round(r["x1"], 1), round(r["bottom"], 1))
                if b not in boxes:
                    boxes.append(b)
        boxes_by_page[key] = sorted(boxes, key=lambda b: b[1])
    return words_by_page, boxes_by_page, labels_by_page


def lines_of(words):
    return TX._lines(words)


MARK_RE = re.compile(r"^(\d{1,3}\.|[A-D]\.|[IVX]+\.)$")


def gappy(words_by_page, rects, gap=26.0):
    """True when a line inside the region has a wide gap between words
    (a vector-drawn formula sat there) — the text would be incomplete.
    The hanging indent after a question/option number is not a gap."""
    for r in rects:
        for ln in lines_of(TX.words_in(words_by_page[r[0]], r)):
            ws = ln["words"]
            for a, b in zip(ws, ws[1:]):
                if b[0] - a[2] > gap and not MARK_RE.match(a[4]) and not MARK_RE.match(b[4]):
                    return True
    return False


INK = {}   # page key -> ink mask, set by extract_paper


def drawn_content(words_by_page, rects, min_px=60):
    """Ink in the region that no text word covers: vector-drawn maths,
    charts or tables. Such regions keep the page image."""
    s = E.PAGE_DPI / 72.0
    for p, x0, y0, x1, y1 in rects:
        ink = INK.get(p)
        if ink is None:
            continue
        sub = ink[int(y0 * s):int(y1 * s), int(x0 * s):int(x1 * s)].copy()
        for w in TX.words_in(words_by_page[p], [p, x0, y0, x1, y1]):
            wx0, wy0, wx1, wy1 = (max(0, int((w[0] - x0 - 1.5) * s)), max(0, int((w[1] - y0 - 2) * s)),
                                  int((w[2] - x0 + 1.5) * s), int((w[3] - y0 + 2) * s))
            sub[wy0:wy1, wx0:wx1] = False
        if int(sub.sum()) > min_px:
            return True
    return False


def transcribe(words_by_page, rects, strip_marker=False):
    if gappy(words_by_page, rects) or drawn_content(words_by_page, rects):
        return None
    paras = TX.transcribe(words_by_page, rects, {}, strip_marker=strip_marker)
    if paras:
        paras = [re.sub(r"^(\d{1,3}|[A-D])\.\s*", "", p) if strip_marker and i == 0 else p for i, p in enumerate(paras)]
        paras = [p.replace("(TITA — type in your answer)", "").strip() for p in paras]
        paras = [p for p in paras if p]
    return paras or None


def parse_key(pdf):
    """Answer key from the last pages: {(sec, n): answer}. Rows come as
    "Q.No n n n …" followed by "Ans v v v …" under a Section heading;
    the table may span two pages."""
    key = {}
    sec = None
    started = False
    pending_q = None
    for pg in pdf.pages[-3:]:
        text = clean(pg).extract_text() or ""
        for line in text.splitlines():
            st = line.strip()
            if st.startswith("Answer Key"):
                started = True
                sec = None
                continue
            m = SEC_RE.match(st)
            if m:
                sec = SEC_MAP[m.group(1)]
                continue
            toks = st.split()
            if not toks:
                continue
            if toks[0] == "Q.No":
                started = True
                pending_q = [int(t) for t in toks[1:] if t.isdigit()]
            elif toks[0] == "Ans" and pending_q is not None and sec and started:
                for n, v in zip(pending_q, toks[1:]):
                    key[(sec, n)] = v
                pending_q = None
    return key


def extract_paper(name, year, slot, pdf_path, pages_dir, img_out):
    import numpy as np
    from PIL import Image
    pdf = pdfplumber.open(pdf_path)
    npages = len(pdf.pages)
    words_by_page, boxes_by_page, labels_by_page = load_words(pdf, name)
    key = parse_key(pdf)
    ink = {}
    for i in range(1, npages + 1):
        k = page_key(name, i, npages)
        fn = os.path.join(pages_dir, f"{k}.png")
        if os.path.exists(fn):
            ink[k] = np.asarray(Image.open(fn).convert("L")) < 180
            INK[k] = ink[k]
            if img_out:
                out = os.path.join(img_out, f"{k}.webp")
                if not os.path.exists(out):
                    Image.open(fn).convert("L").save(out, quality=72, method=6)
    ch_id = name.replace("cat", "a")
    keys = [page_key(name, i, npages) for i in range(1, npages + 1)]

    # ---- anchors in reading order (single column, so page then y) ----
    anchors = []   # (page index, y, kind, payload)
    for pi, k in enumerate(keys):
        for ln in lines_of(words_by_page[k]):
            w0 = ln["words"][0]
            text = ln["text"]
            if text.startswith("Answer Key"):
                anchors.append((pi, w0[1], "end", None))
                break
            m = SEC_RE.match(text)
            if m and "—" in text:
                anchors.append((pi, w0[1], "sec", SEC_MAP[m.group(1)]))
                continue
            m = SET_RE.search(text)
            if m and w0[0] < 60:
                anchors.append((pi, w0[1], "set", [int(m.group(1)), int(m.group(2))]))
                continue
            m = QN_RE.match(w0[4])
            if m and w0[0] < QX_MAX:
                anchors.append((pi, w0[1], "q", int(m.group(1))))
        for ln in lines_of(labels_by_page[k]):
            m = SET_RE.search(ln["text"])
            if m:
                anchors.append((pi, ln["words"][0][1], "set", [int(m.group(1)), int(m.group(2))]))
        for b in boxes_by_page[k]:
            anchors.append((pi, b[1], "box", b))
    anchors.sort(key=lambda a: (a[0], a[1], 0 if a[2] == "set" else 1))

    def region(pi, y0, pj, y1):
        """Rects from (page pi, y0) to (page pj, y1), full body width."""
        out = []
        if pj is None:
            pj, y1 = pi, BODY_BOTTOM
        for p in range(pi, pj + 1):
            top = y0 if p == pi else BODY_TOP
            bot = y1 if p == pj else BODY_BOTTOM
            if bot - top > 3:
                out.append([keys[p], 30.0, round(top, 1), 565.0, round(bot, 1)])
        return out

    questions, directions, qmap = [], {}, {}
    sec, cur_dir, cur_range, set_range = None, None, None, None
    open_box = None   # [rects] of a shaded box possibly continuing on the next page
    for i, (pi, y, kind, payload) in enumerate(anchors):
        if kind == "end":
            break
        nxt = anchors[i + 1] if i + 1 < len(anchors) else None
        if kind == "sec":
            sec, cur_dir, cur_range, set_range = payload, None, None, None
            continue
        if kind == "set":
            last = directions.get(cur_dir) if cur_dir else None
            inside = last and last["range"] is None and any(r[0] == keys[pi] and r[2] - 2 <= y <= r[4] + 2 for r in last["rects"])
            if inside:
                last["range"] = payload
                cur_range = payload
            else:
                set_range = payload
            continue
        if kind == "box":
            x0, top, x1, bot = payload
            rects = [[keys[pi], x0 - 2, top - 2, x1 + 2, bot + 2]]
            if open_box and top <= BODY_TOP + 2 and open_box["last_bottom"] >= BODY_BOTTOM - 12 and open_box["page"] == pi - 1:
                directions[open_box["id"]]["rects"] += rects          # continuation of the previous page's box
                open_box.update(page=pi, last_bottom=bot)
                continue
            did = f"{ch_id}{sec}d{len(directions) + 1}"
            directions[did] = {"id": did, "ch": ch_id, "rects": rects, "text": "", "range": set_range, "year": year, "tx": None}
            cur_dir, cur_range, set_range = did, set_range, None
            open_box = {"id": did, "page": pi, "last_bottom": bot}
            continue
        if kind == "q":
            n = payload
            y0 = y - 3
            if nxt and nxt[2] != "end":
                rects = region(pi, y0, nxt[0], nxt[1] - 3)
            else:
                rects = region(pi, y0, None, None)
            rects = E.tighten(rects, ink)
            text = E.rect_text(words_by_page, rects)
            tita = "TITA" in text
            d = None
            if cur_dir:
                if cur_range:
                    d = cur_dir if cur_range[0] <= n <= cur_range[1] else None
                elif not VA_RE.match(re.sub(r"^\d{1,3}\.\s*", "", text)):
                    d = cur_dir
            if d is None and cur_range and n > cur_range[1]:
                cur_dir = cur_range = None
            ans = key.get((sec, n))
            if ans is not None and not tita:
                if ans in ("1", "2", "3", "4"):
                    ans = "abcd"[int(ans) - 1]
                elif ans.upper() in ("A", "B", "C", "D"):
                    ans = ans.lower()
            q = {"id": f"{ch_id}{sec}{n}", "ch": ch_id, "sec": sec, "n": n, "sub": None, "year": year,
                 "type": "TITA" if tita else "MCQ", "opts": not tita, "dir": d, "rects": rects,
                 "text": text[:2500], "stem": None, "optRects": None, "ans": ans, "sol": None, "solgrp": None, "tx": None}
            if not tita:
                so = split_numbered_options(rects, words_by_page, ink)
                if so:
                    q["stem"], q["optRects"] = so
            stem_tx = transcribe(words_by_page, q["stem"] or rects, strip_marker=True)
            opts_tx = None
            if q["optRects"]:
                opts_tx = [transcribe(words_by_page, o, strip_marker=True) for o in q["optRects"]]
                opts_tx = None if any(o is None for o in opts_tx) else [" ".join(o) for o in opts_tx]
            if stem_tx and (opts_tx or not q["optRects"]):
                q["tx"] = {"stem": stem_tx, "opts": opts_tx}
            questions.append(q)
            qmap[(sec, n)] = q
    # directions text / transcription
    for d in directions.values():
        d["text"] = E.rect_text(words_by_page, d["rects"])[:6000]
        paras = transcribe(words_by_page, d["rects"])
        if paras and not looks_tabular(words_by_page, d["rects"]):
            d["tx"] = [{"t": "p", "text": p} for p in paras]
    return questions, directions, key


def looks_tabular(words_by_page, rects):
    rows = 0
    for r in rects:
        for ln in lines_of(TX.words_in(words_by_page[r[0]], r)):
            toks = [w[4] for w in ln["words"]]
            if len(toks) >= 4 and sum(1 for t in toks if re.fullmatch(r"[\d.,%-]+", t)) >= 3:
                rows += 1
    return rows >= 3


def split_numbered_options(rects, words_by_page, ink):
    """Options are '1.'..'4.' markers indented under the question. The last
    run of 1,2,3,4 in reading order is the option list (sentence lists in
    the stem also use 1., 2., …)."""
    marks = []
    for ri, r in enumerate(rects):
        for ln in lines_of(TX.words_in(words_by_page[r[0]], r)):
            for w in ln["words"]:
                if w[4] in ("1.", "2.", "3.", "4.", "A.", "B.", "C.", "D.") and w[0] >= OPT_X_MIN:
                    marks.append((ri, w, ln))
    lettered = any(w[4] in ("A.", "B.", "C.", "D.") for _, w, _ in marks)
    labels = ["A.", "B.", "C.", "D."] if lettered else ["1.", "2.", "3.", "4."]
    # find the last occurrence of the 4th marker, then walk back to the 3rd, 2nd, 1st
    chosen = {}
    want = 4
    for ri, w, ln in reversed(marks):
        if w[4] == labels[want - 1]:
            chosen[want] = (ri, w, ln)
            want -= 1
            if want == 0:
                break
    if len(chosen) < 4:
        return None
    order = [chosen[i] for i in (1, 2, 3, 4)]
    # rows: markers sharing a line top (two per row in QA, one per row in VARC)
    rows = []
    for idx, (ri, w, ln) in enumerate(order):
        top = min(x[1] for x in ln["words"]) - 1.5
        if rows and rows[-1][0] == ri and abs(top - rows[-1][1]) <= 3:
            rows[-1][2].append(idx)
        else:
            rows.append([ri, top, [idx]])
    opt_rects = [None] * 4
    for k, (ri, top, idxs) in enumerate(rows):
        p, rx0, ry0, rx1, ry1 = rects[ri]
        if k + 1 < len(rows) and rows[k + 1][0] == ri:
            bottom = rows[k + 1][1]
        else:
            bottom = ry1
        for j, idx in enumerate(idxs):
            w = order[idx][1]
            xs = w[2] + 1                      # start after the "1." / "A." label; the app shows its own letter
            xe = order[idxs[j + 1]][1][0] - 4 if j + 1 < len(idxs) else rx1
            opt_rects[idx] = [[p, xs, top, xe, bottom]]
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
    if ink:
        stem = E.tighten(stem, ink)
        opt_rects = [E.tighten(o, ink, pad=2.0, trim_x=True) for o in opt_rects]
    if not stem or any(not o for o in opt_rects):
        return None
    return stem, opt_rects


def main():
    out_path = sys.argv[1]
    pdf_dir = sys.argv[sys.argv.index("--pdf-dir") + 1]
    pages_dir = sys.argv[sys.argv.index("--pages") + 1]
    img_out = sys.argv[sys.argv.index("--img-out") + 1] if "--img-out" in sys.argv else None
    with open(out_path) as f:
        data = json.load(f)
    data["chapters"] = [c for c in data["chapters"] if not c["id"].startswith("a")]
    data["questions"] = [q for q in data["questions"] if not q["ch"].startswith("a")]
    data["directions"] = {k: v for k, v in data["directions"].items() if not k.startswith("a")}
    data.setdefault("pageSizes", {})
    names = sorted([f[:-4] for f in os.listdir(pdf_dir) if re.fullmatch(r"cat\d{4}s\d\.pdf", f)], reverse=True)
    new_chapters = []
    for name in names:
        year, slot = int(name[3:7]), int(name[8])
        qs, ds, key = extract_paper(name, year, slot, os.path.join(pdf_dir, name + ".pdf"), pages_dir, img_out)
        data["pageSizes"][name] = [PAGE_W, PAGE_H]
        ch_id = name.replace("cat", "a")
        new_chapters.append({"id": ch_id, "num": year * 10 + slot, "title": f"CAT {year} · Slot {slot}", "section": "PAPERS",
                             "pages": [1, 0], "subtopics": [], "count": len(qs)})
        data["questions"] += qs
        data["directions"].update(ds)
        by_sec = {s: sum(1 for q in qs if q["sec"] == s) for s in ("VARC", "DILR", "QA")}
        print(f"{name}: {len(qs)} q {by_sec} ans={sum(1 for q in qs if q['ans'])} opt={sum(1 for q in qs if q['optRects'])} "
              f"tita={sum(1 for q in qs if q['type'] == 'TITA')} tx={sum(1 for q in qs if q['tx'])} dirs={len(ds)} "
              f"dir_tx={sum(1 for d in ds.values() if d['tx'])} key_entries={len(key)} with_dir={sum(1 for q in qs if q['dir'])}")
    # newest papers first, before the book's papers
    paper_chs = [c for c in data["chapters"] if c["section"] == "PAPERS"]
    others = [c for c in data["chapters"] if c["section"] != "PAPERS"]
    data["chapters"] = others + new_chapters + paper_chs
    with open(out_path, "w") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print("total questions", len(data["questions"]), "bytes", os.path.getsize(out_path))


if __name__ == "__main__":
    main()
