# CAT Prep

A static web app for practising the questions in *Face 2 Face CAT – Sectionwise & Topicwise Solved Papers 1993–2019* (Arihant), chapter by chapter, with a timer, progress tracking and an AI tutor.

## What it does

- **Dashboard** – attempts, accuracy, net score (+3 / −1 for MCQ, +3 / 0 for TITA), time spent, and per-chapter progress bars grouped by section (QA, DILR, VARC).
- **Chapter view** – every question in the chapter with its year, type and your result; filter by year, status, bookmark, or sub-topic (English Usage).
- **Question view** – two columns: the directions / data set / passage on the left (sticky), the questions on the right. Each question shows its stem and its options as separate crops from the book, so nothing is repeated; TITA questions get a text box. A set (a passage with several questions) is answered in one go: the set clock runs from the moment you open it, and each question's own clock runs while that question is selected, so reading time is kept apart from answering time. A bottom dock holds the timer (pause / resume), Show answer, Submit, and previous / next. The book's solution appears under a question once it is submitted. The AI tutor (hint / explain / why-wrong / free chat) lives in a floating side panel.
- **Text or image** – prose questions, options, passages, data tables and solutions are rebuilt as real text from the PDF's word layout (tools/transcribe.py), so they reflow on phones and can be selected; anything with maths, superscripts, figures or charts keeps the book's image. Settings can switch to images only, and every transcribed question has an "original" link.
- **Study music** – a YouTube video (default: a 4-hour ambient study mix) plays muted and heavily blurred behind the page, with frosted-glass cards on top. The round music button at the bottom left turns the sound on and shows a volume slider. The video, or the whole effect, can be changed or switched off in Settings.
- **Settings** – Anthropic API key and model for the tutor, study music, text/image preference, export / import / reset progress, theme.

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

Not yet covered: the three full solved papers (CAT 2017–2019) and the three practice sets at the front and back of the book.
