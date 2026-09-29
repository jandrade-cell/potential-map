# LCAP Tracker

`LCAP Tracker.html` (in this folder) is a standalone, single-file, offline web app that turns a district's adopted LCAP into a living progress monitor. It replaces the one-time "All State and Local Indicators" spreadsheet: new results can be added at any time, and statuses, insights, and the next-cycle summary update immediately.

Open the file in Chrome, Edge, Firefox, or Safari. No installation, no server, and no internet connection are needed, except for the optional AI features.

## What a district does

1. **Import the LCAP (PDF).** The tracker finds every goal's *Measuring and Reporting Results* table (Metric #, Metric, Baseline, Year 1 Outcome, Year 2 Outcome, Target for Year 3 Outcome), maps each metric to the 28 required LCFF metrics (1A–8A), and shows a review screen with the number it parsed from each cell. Staff correct anything before importing.
2. **Add data whenever it arrives** (*+ Add Data*):
   | Source | What happens |
   |---|---|
   | CSV template | Download a template listing your metrics, fill in `period` and `value`, upload. |
   | CA School Dashboard download files (`eladownload`, `mathdownload`, `chronicdownload`, `suspdownload`, `graddownload`, `elpidownload`, `ccidownload`) | District rows are recorded for every student group, with Dashboard colors. Groups in Red are flagged. |
   | NWEA MAP export (AssessmentResults / Combined Data File) | Percent of students at/above a percentile (default read from the LCAP metric, e.g. "80th percentile"), per term and subject. |
   | mCLASS / DIBELS 8 benchmark export | Percent At or Above Benchmark per benchmark period, optionally per school and grade. |
   | Any other spreadsheet (DataQuest downloads, local reports) | Choose the metric, value column, period column, student-group column, and an optional row filter. DataQuest reporting-category codes (TA, SE, SD, RH…) are recognized. |
   | Manual entry | Open any metric and add a single result. |
   Student-level rows (NWEA, mCLASS) are summarized in the browser. Only percentages are stored.
3. **Use the views.** *Dashboard* (status of every metric), *Next-Cycle Summary* (per-priority synthesis plus team notes), *Required Metrics* (which of the 28 required metrics the LCAP covers), *Data Log*, *Settings & AI*.
4. **Save File** writes a district `.json` file holding every result, note, and insight. Share it by email or a shared drive; *Open File* loads it on another computer. Data is also kept in the browser between visits. Several districts can be tracked side by side (useful for a county office).

## How statuses are scored

Every result is a dated point on the metric's timeline. The *primary group* (All students unless changed) is scored against the baseline and the target each time data changes:

| Status | Rule |
|---|---|
| **Sustain** | At or beyond the target, or at least 90% of the way there, without a notable drop. |
| **Watch** | Target met/nearly met but more than half of the peak gain was lost, or results dipped below baseline along the way; *or* improved and at least 50% of the way to target; *or* 25–50% of the way and still improving. |
| **Priority** | No improvement over baseline; *or* under 50% of the way and the latest result declined; *or* under 25% of the way. All students in Red on the Dashboard also makes a metric a Priority. |
| **Review** | No numeric data or target yet, or the metric is not applicable. |

A student group in Red moves a Sustain metric to Watch and is named in the reasons. Direction (higher/lower is better, or maintain) is inferred from the baseline and target and can be changed per metric. On the example district, 23 of 27 metrics match the statuses in the hand-built LCAPGPT workbook. The differences are judgment calls that weighed subgroup results the LCAP text does not report numerically.

Insights are written from templates when no AI is used. Imported or AI-written narrative is shown until that metric's data changes, then the tracker falls back to the rules-based text and says so.

## Optional AI (Claude)

In *Settings & AI*, a district can paste an Anthropic API key to:

- **Read with AI:** read LCAPs that are scanned or use a non-standard layout (the PDF is sent to the API).
- **Write AI insights:** narrative insights for every metric plus a next-cycle synthesis per priority.

Calls go directly from the browser to `api.anthropic.com` (model `claude-opus-5-5`, with automatic fallback if a request is declined). Only district-level LCAP data and aggregate results are sent. The key is kept in memory unless "remember on this device" is checked.

## Developing

```
lcap-tracker/
  src/tracker.html     page shell and styles
  src/engine.js        parsing, metric inference, status rules, insights (no DOM; testable in Node)
  src/pdf-extract.js   LCAP table extraction from pdf.js text positions
  src/importers.js     CSV template, Dashboard, NWEA, mCLASS, generic importers
  src/ai.js            optional Claude API calls
  src/ui.js            rendering and interactions
  vendor/              pdf.js 3.11 (Apache-2.0), SheetJS 0.18 (Apache-2.0)
  samples/             example district (TBJUSD 2024–27 LCAP metrics)
  tests/engine.test.js
  build.py             inlines everything into LCAP Tracker.html
```

After editing anything in `src/` or `samples/`, rebuild and test:

```
python3 lcap-tracker/build.py
node lcap-tracker/tests/engine.test.js
```

Known limits: PDF extraction expects the state LCAP template's metrics table (text-based PDF). Other layouts or scans need the AI option or manual rows on the review screen. Metrics that combine several values in one cell (for example Math and ELA, or several sites) are scored on the first or district-labeled number. Split them into separate metrics or record components as groups for finer tracking.
