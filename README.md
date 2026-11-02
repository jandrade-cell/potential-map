# Modoc County Data Hub

`Modoc County Data Hub.html` is a single-file, offline web page that puts Modoc County's
**CA School Dashboard** indicators and **CAASPP** (Smarter Balanced ELA & Math) results in one place.

Open the file in Chrome, Edge, Firefox, or Safari. No install, no server, and no internet needed after you download the data.

## What it shows

- **Landing page: Modoc County.** County-wide Dashboard summary, every LEA (and optionally every
  school) side by side with Dashboard colors, CAASPP achievement levels for the county vs. the state,
  results by grade and student group, and trends when you load more than one year.
- **District and school pages.** Pick one from the **View** menu or click a row. Each page shows official
  Dashboard colors, status, and change, a student-group table, CAASPP by grade and student group, and links to the
  official Dashboard and CAASPP reports.

> The CA School Dashboard does not publish county-wide results. On the county page, Dashboard
> figures are calculated (weighted by student count) from the Modoc LEA records. They are labeled
> "calculated" and have no performance color. CAASPP county results are the official county rows.

## Loading data (once per year)

Click **Load data**, then drop in the files (.zip, .txt, or .csv all work):

1. **CA School Dashboard:** from the CDE [CA School Dashboard and System of Support](https://www.cde.ca.gov/ta/ac/cm/)
   page → *Downloadable Data Files*. Download the indicator files (ELA, Math, Chronic Absenteeism, Suspension,
   Graduation, ELPI, CCI). Keep CDE's file names (e.g. `eladownload2025.txt`); the name tells the hub which indicator it is.
2. **CAASPP:** from [CAASPP Research Files](https://caaspp-elpac.ets.org/caaspp/ResearchFileListSB), choose
   the year and **Modoc** county, and download the *All Student Groups* file plus the *Entities* file (for school names).

Only Modoc County rows (county code 25) and statewide rows are kept. They are saved in the browser
(IndexedDB) on that computer, so the data is still there the next time the page is opened. **Clear all data** removes it.
Loading the same file again replaces it.
