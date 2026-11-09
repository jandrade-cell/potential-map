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
`Modoc County Data Hub.html#modoc-joint-unified` or `…#modoc-joint-unified--modoc-high`. The browser's Back button
works, and the **View** menu jumps to any page.

Each district page also has an **LCAP data** button (for example `…#modoc-joint-unified--lcap`). It opens a page
with the district's most recent results for LCAP planning:

- **State Indicators:** the latest Dashboard results for each indicator, with its LCAP priority and the student
  groups in Red and Orange.
- **Local Indicators:** Priorities 1, 2, 3, 6 and 7 from CDE's public Local Indicator files. Shows Met / Not Met,
  the date presented to the board, the self-reflection ratings and the district's narratives.
- **LCAP metrics:** each goal's metrics with the **Year 2 Outcome** from the district's adopted LCAP.

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

## Shared web page

The hub is also published as a web page on Claude: https://claude.ai/artifact/A66WLSimqAHJYDqGDvLzPC
It starts private. Share it from the page's **Share** menu.

After the data or LCAPs are updated, the shared page needs republishing: run
`python3 tools/make_artifact.py shared.html` and publish `shared.html` to the same address, or ask Claude to republish it.
That copy leaves out the Print button and the page's own security policy, because the viewer doesn't allow printing
and applies its own policy.

Page addresses use only letters, digits and hyphens, so they survive being shared:
`#modoc-joint-unified`, `#modoc-joint-unified--modoc-high`, `#modoc-joint-unified--lcap`.

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
- **Local Indicators:** CDE's Local Indicator data files (Priorities 1, 2, 3, 6 and 7), the latest year each LEA reported.
- **LCAP metrics:** read from the districts' adopted LCAPs in `data/lcap/`. These are public documents.
- **CAASPP and ELPAC:** ETS research files for Smarter Balanced, CAST and Summative ELPAC (the same results
  DataQuest reports), for the latest 4 years. These are the Modoc "All Student Groups" files plus the statewide
  "All Students" files for the state comparison.

The page can't fetch these files live, because CDE and ETS don't allow web pages to download from their servers.
That's why the data is built in ahead of time.

### Updating once a year

The results come out once a year: CAASPP and ELPAC in the fall, the Dashboard in December. After both are out,
rebuild the page one of these ways:

- **From GitHub:** go to the **Actions** tab, choose **Refresh built-in data**, and click **Run workflow**. It
  downloads the new files and commits an updated page. Nothing runs on a schedule.
- **On a computer:** run `python3 tools/build_data.py` (Python 3.9+, no packages needed). It takes about 8 minutes,
  mostly downloading the statewide Dashboard files. Options: `--dash-years 3 --test-years 4`.

Then upload the new `Modoc County Data Hub.html` wherever the page is hosted. Copies people downloaded earlier keep
showing the data they were built with.

### Adding a new LCAP

The LCAP metrics come from the districts' adopted LCAP PDFs in `data/lcap/`. When new LCAPs are adopted:

1. Upload the new PDFs to the `data/lcap/` folder on GitHub. Older PDFs can stay; for each district the newest
   LCAP year is used.
2. Run **Refresh built-in data** from the Actions tab. It reads the LCAPs (`tools/extract_lcap.py`) and rebuilds the page.

On a computer instead: `pip install pdfplumber`, then `python3 tools/extract_lcap.py data/lcap/*.pdf` and
`python3 tools/build_data.py --only lcap`. With `--only`, the build rebuilds just the named parts (`dash`, `tests`,
`local`, `lcap`) and keeps the rest of the page's data as it is.

The reader works with CDE's 2024–27 LCAP template. Check the LCAP page after adding a new LCAP.

### Adding a file yourself (optional)

If you want to preview a new file before rebuilding, open **Data sources** in the page and drop it in. It's kept only in that
browser, on top of the built-in data, so it doesn't change the page for anyone else. **Clear** goes back to the
built-in data.
