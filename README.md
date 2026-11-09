# Modoc County Data Hub

`Modoc County Data Hub.html` is a single-file, offline web page that puts Modoc County's
**CA School Dashboard** indicators, **CAASPP** results (Smarter Balanced ELA & Math, and CAST Science),
and **Summative ELPAC** results in one place.

Download the file and double-click it to open it in Chrome, Edge, Firefox, or Safari. No install, no server, and no internet connection needed.

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

## Where the data comes from

The page opens with the data **already built in**. Nothing needs to be loaded by hand.

`tools/build_data.py` downloads the official public files, keeps only Modoc County (county code 25) and
statewide rows, and writes them into `Modoc County Data Hub.html`:

- **CA School Dashboard:** CDE's indicator data files (the data shown on caschooldashboard.org), for the latest 3 years.
- **CAASPP and ELPAC:** ETS research files for Smarter Balanced, CAST and Summative ELPAC (the same results
  DataQuest reports), for the latest 4 years. These are the Modoc "All Student Groups" files plus the statewide
  "All Students" files for the state comparison.

The page can't fetch these files live, because CDE and ETS don't allow web pages to download from their servers.
That's why the data is built in ahead of time.

### Keeping it current

- **Automatically:** the `Refresh built-in data` GitHub Action runs on the 3rd of each month. It commits a new
  version of the page only when CDE or ETS has published something new. Scheduled runs happen on the repository's
  default branch, and you can also start one from the **Actions** tab ("Run workflow").
- **By hand:** run `python3 tools/build_data.py` (Python 3.9+, no packages needed). It takes about 8 minutes,
  mostly downloading the statewide Dashboard files. Options: `--dash-years 3 --test-years 4`.

After a refresh, download the new copy of the page. Anyone using an older copy keeps seeing the data it was built with.

### Adding a file yourself (optional)

If a file comes out before the next refresh, open **Data sources** in the page and drop it in. It's kept in that
browser on top of the built-in data. **Clear** goes back to the built-in data.
