#!/usr/bin/env python3
"""
Extract the full solved papers (CAT 2017, 2018, 2019) printed at the front
of the book and merge them into data/questions.json as chapters p2019,
p2018, p2017 (section "PAPERS"). Each question carries `sec` (VARC, DILR,
QA) and its number restarts per section, as in the book.

Layout differs from the topic chapters: questions are "N." and each
solution starts with the "Ê" glyph right after its question ("Ê (b) …"),
or a grouped "Ê Sol. (Q. Nos. a-b)" followed by per-question items.

Usage:
  pdftotext -bbox-layout -f 16 -l 88 book.pdf papers.xml
  python3 tools/papers.py papers.xml data/questions.json --pages pages --drawings drawings_papers.json
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extract as E  # noqa: E402
import transcribe as TX  # noqa: E402

PAPERS = [(2019, 16, 40), (2018, 42, 65), (2017, 66, 88)]
FIRST_PAGE = 16
QNUM = re.compile(r"^(\d{1,3})\.$")
SEC_WORDS = {"Verbal": "VARC", "Data": "DILR", "Quantitative": "QA"}


def anchors_on_page(pno, blocks, layout):
    gutter, zones, _ = layout
    out = []
    for blk in blocks:
        if not E.in_body(blk[0][0]):
            continue
        blk_top = min(w[1] for ln in blk for w in ln)
        for ln in blk:
            w0 = ln[0]
            x, t = w0[0], w0[4]
            y = min(w[1] for w in ln) - 1
            if 0 < y + 1 - blk_top <= 10:
                y = blk_top - 1
            in_margin = x < 110 or 315 <= x < 365
            text = " ".join(w[4] for w in ln)
            toks = [w[4] for w in ln]
            pos = E.Pos(pno, *E.locate(zones, gutter, y, x))
            if re.match(r"^(SECTION|Section)$", t) and len(toks) > 2 and toks[1] in ("I", "II", "III") and "and Section" not in text:
                sec = next((v for k, v in SEC_WORDS.items() if k in text), None)
                if sec:
                    out.append((pos, "sec", sec))
                continue
            if t.startswith("Directi") and in_margin and "(Q" in text.replace(" ", "")[:16]:
                out.append((pos, "dir", text))
                continue
            if t == "Ê" and in_margin:
                if len(toks) > 1 and toks[1].startswith("Sol") and "(Q" in text.replace(" ", ""):
                    out.append((pos, "solgrp", text))
                else:
                    out.append((pos, "sol", text))
                continue
            if t.startswith("Solution") and in_margin and "(Q" in text.replace(" ", "")[:16]:
                out.append((pos, "solgrp", text))
                continue
            m = QNUM.match(t)
            if m and in_margin and (len(toks) == 1 or (ln[1][0] - w0[2]) < 14):
                out.append((pos, "q", int(m.group(1))))
    return out


def extract_paper(year, start, end, pages, words_by_page, meta_by_page, layouts, ink, figs, rules):
    ch_id = f"p{year}"
    anchors = []
    for p in range(start, end + 1):
        anchors += anchors_on_page(p, pages[p], layouts[p])
    anchors.sort(key=lambda a: a[0].key())
    if ink:
        for pos, kind, _ in anchors:
            if kind in ("q", "dir", "sol", "solgrp"):
                gutter, zones, _w = layouts[pos.page]
                if zones:
                    z = zones[min(pos.zi, len(zones) - 1)]
                    x0, x1 = E.col_x(pos.col, z["full"], gutter)
                    pos.y = E.snap_gap(ink, pos.page, x0, x1, pos.y)

    # pass 1: decide what each anchor is. Questions are confirmed by the
    # solution marker that closes their block: a plain "Ê" closes one
    # question, "Ê Sol. (Q. Nos. a-b)" closes a set. Numbered lists inside
    # directions or para-jumble questions are dropped that way.
    sec, expected = None, 1
    accepted, issues, pending = [], [], []
    grp_rng = None                      # range of the solution group being listed
    sec_fresh = False                   # numbering may restart at 1 in a new section (2019) or continue (2018)
    def close_block(boundary, rng=None):
        """Turn the pending numbered anchors of a block into questions.
        boundary: 'sol' (one question, closed by its Ê), 'solgrp' (a set,
        closed by "Ê Sol. (Q. Nos. a-b)") or 'other' (dir/sec/end)."""
        nonlocal expected, sec_fresh
        nums_present = [a[2] for a in pending]
        start = expected
        if sec_fresh and expected not in nums_present and 1 in nums_present:
            start = 1
        if boundary == "solgrp" and rng:
            nums = list(range(rng[0], rng[1] + 1))
            pick_last = True
        elif boundary == "sol":
            # one question, but if a run of consecutive numbers is waiting
            # (a solution marker was missed) take the whole run
            nums = []
            n = start
            while n in nums_present:
                nums.append(n)
                n += 1
            nums = nums or [start]
            pick_last = False
        else:
            nums = []
            n = start
            while n in nums_present:
                nums.append(n)
                n += 1
            pick_last = False
        chosen = []
        for n in nums:
            occ = [a for a in pending if a[2] == n]
            if occ:
                chosen.append(occ[-1] if pick_last else occ[0])
                sec_fresh = False
            elif n >= expected:
                issues.append(("missing", sec, n))
        chosen.sort(key=lambda a: a[0].key())
        chosen_ids = {id(a) for a in chosen}
        chosen_nums = {a[2] for a in chosen}
        last_q_pos = chosen[-1][0].key() if chosen else None
        # a repeat of a chosen number after the questions is that question's solution (2017 layout)
        items = [a for a in pending if id(a) not in chosen_ids and a[2] in chosen_nums
                 and last_q_pos and a[0].key() > last_q_pos and boundary != "solgrp"]
        merged = sorted([(a[0], "q", a[2]) for a in chosen] + [(a[0], "solitem", a[2]) for a in items], key=lambda t: t[0].key())
        accepted.extend(merged)
        if chosen:
            expected = max(chosen_nums) + 1
        pending.clear()
        return [a[2] for a in chosen]
    for pos, kind, payload in anchors + [(None, "end", None)]:
        if kind == "end":
            if pending:
                close_block("other")
            break
        if kind == "sec":
            if pending:
                close_block("other")
            sec, grp_rng, sec_fresh = payload, None, True
            accepted.append((pos, kind, payload))
        elif not sec:
            continue
        elif kind == "dir":
            if pending:
                close_block("other")
            grp_rng = None
            accepted.append((pos, kind, payload))
        elif kind == "solgrp":
            m = E.RANGE_RE.search(payload)
            rng = [int(m.group(1)), int(m.group(2) or m.group(1))] if m else None
            if rng and rng[0] < expected and not any(a[2] == rng[0] for a in pending):
                close_block("other")        # the set's questions were accepted earlier; this just lists solutions
            elif rng and rng[0] >= expected and not any(a[2] == rng[1] for a in pending):
                pass                        # solutions printed before the questions (2017): keep waiting
            else:
                close_block("solgrp", rng)
            grp_rng = rng
            accepted.append((pos, kind, rng))
        elif kind == "sol":
            got = close_block("sol")
            grp_rng = None
            if got:
                accepted.append((pos, kind, got[-1]))
        elif kind == "q":
            n = payload
            if grp_rng and grp_rng[0] <= n <= grp_rng[1] and n < expected:
                accepted.append((pos, "solitem", n))
            else:
                if grp_rng and not (grp_rng[0] <= n <= grp_rng[1]):
                    grp_rng = None
                pending.append((pos, kind, n))

    # pass 2: regions between consecutive accepted anchors
    questions, directions, solgroups = [], {}, {}
    qmap, cur_dir, cur_dir_rng, cur_grp = {}, None, None, None
    sec = None
    for i, (pos, kind, payload) in enumerate(accepted):
        nxt = accepted[i + 1][0] if i + 1 < len(accepted) else None
        if kind == "sec":
            sec = payload
            cur_dir = cur_dir_rng = cur_grp = None
            continue
        rects = E.region_rects(layouts, pos, nxt, end)
        if ink:
            rects = E.tighten(rects, ink)
        text = E.rect_text(words_by_page, rects)
        if kind == "dir":
            did = f"{ch_id}{sec}d{len(directions) + 1}"
            m = E.RANGE_RE.search(text)
            rng = [int(m.group(1)), int(m.group(2) or m.group(1))] if m else None
            directions[did] = {"id": did, "ch": ch_id, "rects": rects, "text": text[:6000], "range": rng, "year": year,
                               "tx": TX.transcribe_with_tables(words_by_page, rects, figs, rules)}
            cur_dir, cur_dir_rng = did, rng
        elif kind == "q":
            n = payload
            d = cur_dir if cur_dir and (cur_dir_rng is None or cur_dir_rng[0] <= n <= cur_dir_rng[1]) else None
            has_opts = bool(re.search(r"\(a\)", text)) and bool(re.search(r"\(b\)", text))
            q = {"id": f"{ch_id}{sec}{n}", "ch": ch_id, "sec": sec, "n": n, "sub": None, "year": year,
                 "type": "MCQ" if has_opts else "TITA", "opts": has_opts, "dir": d, "rects": rects,
                 "text": text[:2500], "stem": None, "optRects": None, "ans": None, "sol": None, "solgrp": None, "tx": None}
            if has_opts:
                so = E.split_options(rects, words_by_page, meta_by_page, ink)
                if so:
                    q["stem"], q["optRects"] = so
            stem_tx = TX.transcribe(words_by_page, q["stem"] or rects, figs, strip_marker=True)
            opts_tx = None
            if q["optRects"]:
                opts_tx = [TX.transcribe(words_by_page, o, figs, strip_marker=True) for o in q["optRects"]]
                opts_tx = None if any(o is None for o in opts_tx) else [" ".join(o) for o in opts_tx]
            if stem_tx and (opts_tx or not q["optRects"]):
                q["tx"] = {"stem": stem_tx, "opts": opts_tx}
            if cur_grp and cur_grp[0] and cur_grp[0][0] <= n <= cur_grp[0][1]:
                q["solgrp"] = cur_grp[1]
            questions.append(q)
            qmap[n] = q
        elif kind == "solgrp":
            gid = f"{ch_id}{sec}g{len(solgroups) + 1}"
            solgroups[gid] = {"id": gid, "ch": ch_id, "rects": rects, "text": text[:4000], "range": payload}
            cur_grp = (payload, gid)
            if payload:
                for n in range(payload[0], payload[1] + 1):
                    if n in qmap:
                        qmap[n]["solgrp"] = gid
        elif kind in ("sol", "solitem"):
            q = qmap.get(payload)
            if not q:
                continue
            m = re.match(r"^\s*(?:Ê\s*)?(?:\d{1,3}\.\s*)?\(([a-e])\)", text)
            if q["sol"] is None:
                q["sol"] = {"rects": rects, "text": text[:3000],
                            "tx": TX.transcribe(words_by_page, rects, figs, strip_marker=True)}
            else:
                q["sol"]["rects"] += rects
                q["sol"]["text"] = (q["sol"]["text"] + " " + text)[:3000]
                q["sol"]["tx"] = None
            if m and not q["ans"]:
                q["ans"] = m.group(1)
    return questions, directions, solgroups, issues


def main():
    xml_path, out_path = sys.argv[1], sys.argv[2]
    pages_dir = sys.argv[sys.argv.index("--pages") + 1] if "--pages" in sys.argv else None
    rules, figs = {}, {}
    if "--drawings" in sys.argv:
        with open(sys.argv[sys.argv.index("--drawings") + 1]) as f:
            for k, v in json.load(f).items():
                rules[int(k)] = v["rules"]
                figs[int(k)] = v["figs"]
    E.FIRST_PAGE = FIRST_PAGE
    pages = E.load_pages(xml_path)
    words_by_page = {p: E.page_words(b) for p, b in pages.items()}
    meta_by_page = {p: E.word_meta(b) for p, b in pages.items()}
    layouts = {}
    for p, b in pages.items():
        gutter, zones = E.compute_layout(b, page_full_rule=False)
        layouts[p] = (gutter, zones, words_by_page[p])
    ink = {}
    if pages_dir:
        import numpy as np
        from PIL import Image
        for p in pages:
            fn = os.path.join(pages_dir, f"p-{p:03d}.png")
            if os.path.exists(fn):
                ink[p] = np.asarray(Image.open(fn).convert("L")) < 180

    with open(out_path) as f:
        data = json.load(f)
    data["chapters"] = [c for c in data["chapters"] if c["section"] != "PAPERS"]
    data["questions"] = [q for q in data["questions"] if not q["ch"].startswith("p")]
    data["directions"] = {k: v for k, v in data["directions"].items() if not k.startswith("p")}
    data["solgroups"] = {k: v for k, v in data["solgroups"].items() if not k.startswith("p")}
    data["papers"] = []
    for year, start, end in PAPERS:
        qs, ds, gs, issues = extract_paper(year, start, end, pages, words_by_page, meta_by_page, layouts, ink, figs, rules)
        data["chapters"].append({"id": f"p{year}", "num": year, "title": f"CAT {year}", "section": "PAPERS",
                                 "pages": [start, end], "subtopics": [], "count": len(qs)})
        data["questions"] += qs
        data["directions"].update(ds)
        data["solgroups"].update(gs)
        by_sec = {s: sum(1 for q in qs if q["sec"] == s) for s in ("VARC", "DILR", "QA")}
        nsol = sum(1 for q in qs if q["sol"]); nans = sum(1 for q in qs if q["ans"]); nopt = sum(1 for q in qs if q["optRects"])
        ntx = sum(1 for q in qs if q["tx"]); ntita = sum(1 for q in qs if q["type"] == "TITA")
        print(f"CAT {year}: {len(qs)} q {by_sec} sol={nsol} ans={nans} opt={nopt} tita={ntita} tx={ntx} dirs={len(ds)} issues={len(issues)} {issues[:8]}")
    with open(out_path, "w") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print("total questions", len(data["questions"]), "bytes", os.path.getsize(out_path))


if __name__ == "__main__":
    main()
