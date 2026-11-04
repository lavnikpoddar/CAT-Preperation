# CAT Prep

A static web app for practising the questions in *Face 2 Face CAT – Sectionwise & Topicwise Solved Papers 1993–2019* (Arihant), chapter by chapter, with a timer, progress tracking and an AI tutor.

## What it does

- **Dashboard** – attempts, accuracy, net score (+3 / −1 for MCQ, +3 / 0 for TITA), time spent, and per-chapter progress bars grouped by section (QA, DILR, VARC).
- **Chapter view** – every question in the chapter with its year, type and your result; filter by year, status, bookmark, or sub-topic (English Usage).
- **Question view** – the question (and its directions / data set / passage) cropped straight from the book, a timer that starts when you open it, the negative-marking rule for that question, answer entry (option buttons for MCQ, a text box for TITA), the book's solution after you submit, and an AI tutor (hint / explain / why-wrong / free chat).
- **Settings** – Anthropic API key and model for the tutor, export / import / reset progress, theme.

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
                                crop rectangles (PDF points), text extraction, solution crops
img/pages/p-NNN.webp            book pages 90–721 rendered at 150 DPI (grayscale)
tools/extract.py                rebuilds data/questions.json from the PDF
```

### Rebuilding the data

```bash
pdftotext -bbox-layout -f 90 -l 721 "Face to Face CAT Topicwise Solved Papers.pdf" chapters.xml
pdftoppm -r 150 -gray -f 90 -l 721 -png "Face to Face CAT Topicwise Solved Papers.pdf" pages/p
python3 tools/extract.py chapters.xml data/questions.json --pages pages
```

Answer keys come from the "Hints & Solutions" entries that start with an option letter; TITA questions and a few MCQs whose solution does not start with the letter have no key, and the app asks you to mark those yourself against the solution.

Not yet covered: the three full solved papers (CAT 2017–2019) and the three practice sets at the front and back of the book.
