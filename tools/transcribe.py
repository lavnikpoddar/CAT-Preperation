"""Deterministic transcription of prose regions from the PDF word layout.

A region is transcribed to text only when it looks like plain prose: no
maths symbols, no superscripts/subscripts, no displayed equations, no
figures. Anything else keeps the image crop. Tables are rebuilt from the
book's horizontal rules plus word positions.
"""
import re
import statistics

MATH_CHARS = re.compile(r"[-∀-⋿←-⇿²³¹⁰-₟√∫∑∏∈∉≤≥≠±÷×]")
MARKER = re.compile(r"^(\d{1,3}[.)]|\([a-e]\)|Ê)$")
LIST_START = re.compile(r"^([A-Z]|[ivx]+|\d{1,2})[.)]$")
PUNCT = re.compile(r"^[\W_]+$")
YEAR_TAG = re.compile(r"\s*\(\s*(?:19|20)\d\d\s*\)")


def _lines(words):
    """Group words into lines by vertical centre; each line sorted by x."""
    ws = sorted(words, key=lambda w: ((w[1] + w[3]) / 2, w[0]))
    lines = []
    for w in ws:
        yc = (w[1] + w[3]) / 2
        if lines and abs(yc - lines[-1]["yc"]) <= 3.5:
            ln = lines[-1]
            ln["words"].append(w)
            ln["yc"] = (ln["yc"] * (len(ln["words"]) - 1) + yc) / len(ln["words"])
        else:
            lines.append({"yc": yc, "words": [w]})
    for ln in lines:
        ln["words"].sort(key=lambda w: w[0])
        ln["x0"] = ln["words"][0][0]
        ln["h"] = statistics.median(w[3] - w[1] for w in ln["words"])
        ln["text"] = " ".join(w[4] for w in ln["words"])
    return lines


def words_in(words, rect):
    p, x0, y0, x1, y1 = rect
    return [w for w in words
            if (w[0] + w[2]) / 2 >= x0 and (w[0] + w[2]) / 2 < x1
            and (w[1] + w[3]) / 2 >= y0 and (w[1] + w[3]) / 2 < y1]


def region_lines(words_by_page, rects):
    out = []
    for ri, r in enumerate(rects):
        for ln in _lines(words_in(words_by_page[r[0]], r)):
            ln["ri"] = ri
            out.append(ln)
    return out


def looks_prose(lines, why=None):
    """Reject regions with maths layout or symbols."""
    def fail(reason):
        if why is not None:
            why.append(reason)
        return False
    if not lines:
        return fail("no lines")
    if any(MATH_CHARS.search(w[4]) for ln in lines for w in ln["words"]):
        return fail("maths symbol: " + next(w[4] for ln in lines for w in ln["words"] if MATH_CHARS.search(w[4])))
    body = [w for ln in lines for w in ln["words"] if not PUNCT.match(w[4])]
    if not body:
        return fail("no body words")
    hmed = statistics.median(w[3] - w[1] for w in body)
    for w in body:
        h = w[3] - w[1]
        if re.fullmatch(r"\d{1,2}[.)]|\([a-e]\)|[A-E]\.", w[4]):
            continue                                  # list markers set in a smaller face
        if h < 0.76 * hmed and len(w[4]) <= 6:      # super/subscript-sized token
            return fail(f"small token {w[4]!r} h={h:.1f} med={hmed:.1f}")
    flat = " ".join(w[4] for ln in lines for w in ln["words"])
    if re.search(r"(?<![\w.])[a-zA-Z] \d(?![\d.,:%])", flat) or re.search(r"\d \d{1,2}(?= [a-zA-Z(+\-−×=])", flat):
        return fail("likely superscript: " + flat[:60])   # e.g. "a 2 + b 2", "x 4000"
    left = min(ln["x0"] for ln in lines)
    for i, ln in enumerate(lines):
        toks = [w[4] for w in ln["words"]]
        short = all(len(t) <= 7 for t in toks)
        mathy = all(re.fullmatch(r"[\d+\-−=×/().,%:]+", t) or re.fullmatch(r"[A-Za-z]{1,2}[\d+\-−=×/().,]*", t) for t in toks) and any(re.search(r"[\d=+\-−×/]", t) for t in toks)
        indented = ln["x0"] > left + 18
        if len(toks) <= 3 and short and mathy and indented and 0 < i < len(lines) - 1:
            return fail("displayed maths line: " + ln["text"])
    return True


def paragraphs(lines, strip_marker=False):
    """Join lines into paragraphs."""
    if not lines:
        return []
    gaps = [b["yc"] - a["yc"] for a, b in zip(lines, lines[1:]) if b["ri"] == a["ri"] and b["yc"] > a["yc"]]
    lead = statistics.median(gaps) if gaps else 12
    left = min(ln["x0"] for ln in lines)
    paras, cur = [], []
    for i, ln in enumerate(lines):
        words = [w[4] for w in ln["words"]]
        if i == 0 and strip_marker and words:
            if re.fullmatch(r"\([a-e]\)", words[0]):
                words = words[1:]                         # option label "(a)"
            else:
                for _ in range(2):                        # "Ê", "12.", "12)" – keep a following "(c)" (the answer)
                    if words and re.fullmatch(r"Ê|\d{1,3}[.)]", words[0]):
                        words = words[1:]
                    else:
                        break
        text = " ".join(words).strip()
        if not text:
            continue
        new_para = False
        heading = len(ln["words"]) <= 4 and ln["x0"] > left + 30 and i + 1 < len(lines) and lines[i + 1]["x0"] < ln["x0"] - 20
        prev_heading = i > 0 and len(lines[i - 1]["words"]) <= 4 and lines[i - 1]["x0"] > left + 30 and ln["x0"] < lines[i - 1]["x0"] - 20
        if cur and (heading or prev_heading):
            new_para = True
        if cur and not new_para:
            prev = lines[i - 1]
            gap = ln["yc"] - prev["yc"] if ln["ri"] == prev["ri"] else lead
            first_tok = ln["words"][0][4]
            prev_tok = prev["words"][0][4]
            hanging = LIST_START.match(prev_tok) or MARKER.match(prev_tok)
            if (gap > 1.45 * lead or LIST_START.match(first_tok) or MARKER.match(first_tok)
                    or first_tok in ("Statement", "Statements", "PASSAGE")
                    or (ln["x0"] > prev["x0"] + 6 and ln["x0"] > left + 6 and not hanging)):
                new_para = True
        if new_para:
            paras.append(cur)
            cur = []
        if cur and cur[-1].endswith("-") and text[:1].islower():
            cur[-1] = cur[-1][:-1] + text
        else:
            cur.append(text)
    if cur:
        paras.append(cur)
    out = []
    for p in paras:
        t = " ".join(p)
        t = re.sub(r"\s+([,.;:!?)])", r"\1", t)
        t = re.sub(r"\(\s+", "(", t)
        t = re.sub(r"\s+", " ", t).strip()
        t = t.replace("` ", "₹").replace("`", "₹")
        t = re.sub(r"(^|\s)©(?=\s)", r"\1(c)", t)
        t = YEAR_TAG.sub("", t).strip()
        if t:
            out.append(t)
    return out


def transcribe(words_by_page, rects, figs_by_page, strip_marker=False, why=None):
    """Return list of paragraphs, or None if the region is not plain prose."""
    for r in rects:
        for f in figs_by_page.get(r[0], []):
            if f[0] < r[3] and f[2] > r[1] and f[1] < r[4] and f[3] > r[2]:
                if why is not None:
                    why.append(f"figure {f} on page {r[0]}")
                return None
    lines = region_lines(words_by_page, rects)
    if not looks_prose(lines, why):
        return None
    paras = paragraphs(lines, strip_marker)
    return paras or None


def find_tables(rects, rules_by_page):
    """Table regions: runs of >= 3 evenly spaced horizontal rules inside a rect.
    Returns list of (rect index, page, y_top, y_bottom, x0, x1)."""
    out = []
    for ri, r in enumerate(rects):
        rules = sorted([u for u in rules_by_page.get(r[0], [])
                        if r[2] - 2 <= u[1] <= r[4] + 2 and u[0] >= r[1] - 10 and u[2] <= r[3] + 10],
                       key=lambda u: u[1])
        run = []
        for u in rules:
            if run and 0 < u[1] - run[-1][1] <= 42:
                run.append(u)
            else:
                if len(run) >= 3:
                    out.append((ri, r[0], run[0][1], run[-1][1], min(v[0] for v in run), max(v[2] for v in run)))
                run = [u]
        if len(run) >= 3:
            out.append((ri, r[0], run[0][1], run[-1][1], min(v[0] for v in run), max(v[2] for v in run)))
    return out


def table_cells(words):
    """Rows x columns from word positions: rows by y, columns by x gaps."""
    lines = _lines(words)
    if len(lines) < 2:
        return None
    counts = sorted(len(ln["words"]) for ln in lines)
    full = counts[len(counts) // 2]                      # typical row width
    data_lines = [ln for ln in lines if len(ln["words"]) >= full] or lines
    centres = sorted((w[0] + w[2]) / 2 for ln in data_lines for w in ln["words"])
    cols = []
    for xc in centres:
        if cols and xc - cols[-1][-1] <= 14:
            cols[-1].append(xc)
        else:
            cols.append([xc])
    mids = [sum(c) / len(c) for c in cols]
    if len(mids) < 2:
        return None
    rows = []
    for ln in lines:
        cells = [""] * len(mids)
        for w in ln["words"]:
            xc = (w[0] + w[2]) / 2
            j = min(range(len(mids)), key=lambda k: abs(xc - mids[k]))
            cells[j] = (cells[j] + " " + w[4]).strip()
        rows.append(cells)
    return rows


def transcribe_with_tables(words_by_page, rects, figs_by_page, rules_by_page):
    """Blocks: [{t:'p', text}] and [{t:'table', rows}], or None."""
    tables = find_tables(rects, rules_by_page)
    if not tables:
        paras = transcribe(words_by_page, rects, figs_by_page)
        return [{"t": "p", "text": p} for p in paras] if paras else None
    blocks = []
    for ri, r in enumerate(rects):
        tbs = sorted([t for t in tables if t[0] == ri], key=lambda t: t[2])
        cur_y = r[2]
        pieces = []
        for _, p, ty0, ty1, tx0, tx1 in tbs:
            pieces.append(("text", [p, r[1], cur_y, r[3], ty0 - 1]))
            pieces.append(("table", [p, r[1], ty0 - 1, r[3], ty1 + 1]))
            cur_y = ty1 + 1
        pieces.append(("text", [r[0], r[1], cur_y, r[3], r[4]]))
        for kind, rr in pieces:
            if rr[4] - rr[2] < 4:
                continue
            if kind == "text":
                ws = words_in(words_by_page[rr[0]], rr)
                if not ws:
                    continue
                paras = transcribe(words_by_page, [rr], figs_by_page)
                if paras is None:
                    return None
                blocks += [{"t": "p", "text": x} for x in paras]
            else:
                rows = table_cells(words_in(words_by_page[rr[0]], rr))
                if not rows:
                    return None
                blocks.append({"t": "table", "rows": rows})
    return blocks or None
