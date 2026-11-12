# CAT Prep

A static web app for practising the questions in *Face 2 Face CAT – Sectionwise & Topicwise Solved Papers 1993–2019* (Arihant), chapter by chapter, with a timer, progress tracking and an AI tutor.

## What it does

- **Dashboard** – attempts, accuracy, net score (+3 / −1 for MCQ, +3 / 0 for TITA), time spent, and per-chapter progress bars grouped by section (QA, DILR, VARC).
- **Chapter view** – every question in the chapter with its year, type and your result; filter by year, status, bookmark, or sub-topic (English Usage).
- **Question view** – two columns: the directions / data set / passage on the left (sticky), the questions on the right. Each question shows its stem and its options as separate crops from the book, so nothing is repeated; TITA questions get a text box. A set (a passage with several questions) is answered in one go: the set clock runs from the moment you open it, and each question's own clock runs while that question is selected, so reading time is kept apart from answering time. A bottom dock holds the timer (pause / resume), Show answer, Submit, and previous / next. The book's solution appears under a question once it is submitted. The AI tutor (hint / explain / why-wrong / free chat) lives in a floating side panel.
- **Text or image** – prose questions, options, passages, data tables and solutions are rebuilt as real text from the PDF's word layout (tools/transcribe.py), so they reflow on phones and can be selected; anything with maths, superscripts, figures or charts keeps the book's image. Settings can switch to images only, and every transcribed question has an "original" link.
- **Notes** – a Pinterest-style grid of things to remember. Related tools are stacked on one card (all the prime tests together, all the series sums together), each formula large with what it is for beneath it; tap a card for the why, examples and traps. Graphics: primes 1–100, squares 1–30, odd numbers forming a square. The content is the `NOTES` list in `app.js`: one object per card (`hero` or `stack`, `title`, `body`, optional `tone`, `hs` hero size, `fig`, `wp` full width on phones).

**Reading** – a 25-day list: each day pairs a classic essay or paper with a modern one that answers or extends it, across fields and in rising difficulty. Every title opens a reader page with a short brief (the argument, how it is built, where to push back). Five pieces that are free to copy (Woolf chapter 1, the Bitcoin paper, Ioannidis, and excerpts from two Supreme Court judgments) carry their full text; for the rest the original is one tap away. `tools/extract_readings.py` rebuilds `data/readings_full.json`; `tools/briefs.py` holds the briefs.
- **Settings** – Anthropic API key and model for the tutor, text/image preference, export / import / reset progress, theme.

Progress is stored in the browser's `localStorage`. Export it from Settings to move between devices.

## Running it

It is plain HTML/CSS/JS – serve the folder with any static server, for example:

```bash
python3 -m http.server 8000
```

then open <http://localhost:8000/>. It also works on GitHub Pages (Settings → Pages → deploy from the `main` branch, root).

The AI tutor calls the Anthropic Messages API directly from the browser with the key you enter in Settings; nothing else is sent anywhere.

## Layout

```
index.html, style.css, app.js   the app
data/questions.json             2,826 questions: chapter, number, year, MCQ/TITA, answer key,
                                crop rectangles (PDF points) for the whole question, its stem
                                and each option, text extraction, solution crops
img/pages/p-NNN.webp            book pages 90–721 rendered at 150 DPI (grayscale)
tools/extract.py                rebuilds data/questions.json from the PDF
```

### Rebuilding the data

```bash
pdftotext -bbox-layout -f 90 -l 721 "Face to Face CAT Topicwise Solved Papers.pdf" chapters.xml
pdftoppm -r 150 -gray -f 90 -l 721 -png "Face to Face CAT Topicwise Solved Papers.pdf" pages/p
python3 tools/drawings.py "Face to Face CAT Topicwise Solved Papers.pdf" drawings.json   # needs pdfplumber
python3 tools/extract.py chapters.xml data/questions.json --pages pages --drawings drawings.json
```

Answer keys come from the "Hints & Solutions" entries that start with an option letter; TITA questions and a few MCQs whose solution does not start with the letter have no key, and the app asks you to mark those yourself against the solution.

CAT 2024 and 2025 (all three slots each) come from AglaSem's "Question Paper with Answer Key" PDFs (docs.aglasem.com), extracted by `tools/aglasem.py` into chapters `a2024s1` … `a2025s3`. They carry the official answer keys but no worked solutions; use the tutor for those. Maths is drawn as vector glyphs in those PDFs, so such questions keep their page image.

```bash
# put cat<year>s<slot>.pdf files in a folder, render them, then:
pdftoppm -r 150 -gray -png cat2025s1.pdf pages/cat2025s1      # one per file
python3 tools/aglasem.py data/questions.json --pdf-dir PDFS --pages pages --img-out img/pages
```

The three full solved papers at the front of the book (CAT 2017, 2018, 2019) are extracted by `tools/papers.py` into chapters `p2017`–`p2019` (section PAPERS); their questions carry an exam section (VARC / DILR / QA) and count towards those sections' figures. Not covered: the three practice sets at the back of the book, and CAT 2020–2023 (AglaSem only has candidate response sheets without keys for those years, and its 2021 files are missing).

```bash
pdftotext -bbox-layout -f 16 -l 88 "Face to Face CAT Topicwise Solved Papers.pdf" papers.xml
pdftoppm -r 150 -gray -f 16 -l 88 -png "Face to Face CAT Topicwise Solved Papers.pdf" pages/p
python3 tools/drawings.py "Face to Face CAT Topicwise Solved Papers.pdf" drawings_papers.json 16 88
python3 tools/papers.py papers.xml data/questions.json --pages pages --drawings drawings_papers.json
```

## Private use: password and your own reading texts

- **Password (not active yet).** `tools/gate/worker.js` is written but switched off. To turn it on, move it to the root as `worker.js`, add `worker.js` to `.assetsignore` (keep the lines already there: they stop `.git` and the PDF from being uploaded), and in `wrangler.jsonc` add `"main": "worker.js"` plus `"binding": "ASSETS"` and `"run_worker_first": true` under `assets`.
- **Reading texts.** Put texts you have in a folder named by reading key (`1.txt`, `8b.pdf`, `13b.html`; the key is in the reader URL, `#/read/8b`) and run `python3 tools/build_private.py FOLDER`. That writes `private/readings_text.json`, which the reader shows in full. The Worker refuses `/private/` until `SITE_PASSWORD` is set, so these never go out openly.
- **Keep the repo private** before you commit anything in `private/`.
