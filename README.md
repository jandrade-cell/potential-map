# Modoc County Data Hub

`Modoc County Data Hub.html` is a single-file, offline web page that puts Modoc County's
**CA School Dashboard** indicators, **CAASPP** results (Smarter Balanced ELA & Math, and CAST Science),
and **Summative ELPAC** results in one place.

Download the file and double-click it to open it in Chrome, Edge, Firefox, or Safari. No install, no server, and no internet connection needed.

## What it shows

The hub has three levels of pages:

1. **Modoc County (the landing page).** Shows all county results, with a card for each district: Modoc Joint Unified,
   Surprise Valley Joint Unified and Tulelake Basin Joint Unified. Each card shows its headline numbers and opens
   that district's page.
2. **District pages.** Each shows the district's own Dashboard, CAASPP and ELPAC results, with a card for each of
   its schools.
3. **School pages.** Each shows that school's results, with links to the other schools in its district and back
   up to the district and county.

Every page has its own address that can be bookmarked or shared, for example
`Modoc County Data Hub.html#modoc-joint-unified` or `…#modoc-joint-unified/modoc-high`. The browser's Back button
works, and the **View** menu jumps to any page.

Each page has:
- **Dashboard:** indicator colors, status and change, by student group.
- **CAASPP and ELPAC:** achievement levels against the state, by grade and student group, and trends.
- **Comparison tables:** district and county pages compare their districts or schools side by side.
- **Links** to the official Dashboard, Smarter Balanced, CAST and ELPAC reports.

Notes:
- The CA School Dashboard does not publish county-wide results. On the county page, Dashboard figures are
  calculated (weighted by student count) from the Modoc LEA records. They are labeled "calculated" and have
  no performance color. CAASPP and ELPAC county results are the official county rows.
- In 2026 CAASPP renamed its achievement levels: Advanced (was Standard Exceeded), Proficient (Met),
  Developing (Nearly Met), Minimal (Not Met). The meanings did not change. The hub reads both file layouts,
  so 2025 and 2026 results line up in the trend charts.
- ELPAC results show the four overall performance levels. Level 4 (Well developed) is the reclassification criterion.

## Public data only

- **Only public sources.** `tools/build_data.py` will only contact three public sites, over HTTPS, with no
  login, password, key or cookies: `www.cde.ca.gov`, `www3.cde.ca.gov` and `caaspp-elpac.ets.org`. Any other
  address, including a redirect to one, stops the build with an error. The list is `ALLOWED_HOSTS` at the top of the script.
- **Only group-level results.** The files hold school, district, county and state results, never individual
  students. CDE and ETS suppress small groups before publishing.
- **The page can't send anything.** A Content-Security-Policy in the page blocks every network request, so it
  can't load or send data anywhere. Links to the official report pages still open normally. Files you add by hand
  are read on your computer and kept only in that browser.

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
