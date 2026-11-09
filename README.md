# Modoc County Data Hub

`Modoc County Data Hub.html` is a single-file, offline web page that puts Modoc County's
**CA School Dashboard** indicators, **CAASPP** results (Smarter Balanced ELA & Math, and CAST Science),
and **Summative ELPAC** results in one place.

Open the file in Chrome, Edge, Firefox, or Safari. No install, no server, and no internet needed after you download the data.

## What it shows

- **Landing page: Modoc County.**
  - **Dashboard:** a county-wide summary, and every LEA (optionally every school) side by side with Dashboard colors.
  - **CAASPP and ELPAC:** achievement levels for the county vs. the state, results by grade and student group,
    an LEA/school comparison table, and trends when you load more than one year.
- **District and school pages.** Pick one from the **View** menu or click a row. Each page has the same sections,
  plus links to the official Dashboard, Smarter Balanced, CAST, and ELPAC reports.

Notes:
- The CA School Dashboard does not publish county-wide results. On the county page, Dashboard figures are
  calculated (weighted by student count) from the Modoc LEA records. They are labeled "calculated" and have
  no performance color. CAASPP and ELPAC county results are the official county rows.
- In 2026 CAASPP renamed its achievement levels: Advanced (was Standard Exceeded), Proficient (Met),
  Developing (Nearly Met), Minimal (Not Met). The meanings did not change. The hub reads both file layouts,
  so 2025 and 2026 results line up in the trend charts.
- ELPAC results show the four overall performance levels. Level 4 (Well developed) is the reclassification criterion.

## Loading data (once per year)

Click **Load data**, then drop in the files (.zip, .txt, or .csv all work):

1. **CA School Dashboard:** from CDE's [Accountability Downloadable Files](https://www.cde.ca.gov/ds/ad/accdf.asp),
   open each indicator (ELA, Math, Science, Chronic Absenteeism, Suspension, Graduation, ELPI, CCI) and download
   the year's `.txt` file (for example, `eladownload2026.txt`).
2. **CAASPP and ELPAC research files:** on each research-file page
   ([Smarter Balanced](https://caaspp-elpac.ets.org/caaspp/ResearchFileListSB),
   [CAST](https://caaspp-elpac.ets.org/caaspp/ResearchFileListCAST),
   [Summative ELPAC](https://caaspp-elpac.ets.org/elpac/ResearchFilesSA)):
   - Choose the year, set County to **Modoc**, and download the caret-delimited ("csv") **All Student Groups** file.
   - For a statewide comparison, also download the statewide **All Students** file (2–8 MB).
   - School and district names and student group names are built in or come with these files, so nothing else is needed.

Only Modoc County rows (county code 25) and statewide rows are kept. They are saved in the browser
(IndexedDB) on that computer, so the data is still there the next time the page is opened. **Clear all data** removes it.
Loading a file again replaces its rows instead of adding duplicates.
