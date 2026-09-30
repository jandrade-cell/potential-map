# LCAP Tracker

**Provided by the Modoc County Office of Education**

`LCAP Tracker.html` is a standalone, single-file web app that helps district superintendents and LCAP teams monitor their Local Control and Accountability Plan all year and draft the next one. It turns the adopted LCAP into a living data set: new results can be added at any time, and every metric's status, insight, the priority-level summary, and the next-cycle draft update immediately.

## Sharing it with districts

Send `LCAP Tracker.html` as an email attachment or put it on a shared drive (about 2.5 MB). Recipients double-click it to open it in Chrome, Edge, Firefox, or Safari.

- No installation, account, or internet connection is needed.
- Each district's work is kept in that computer's browser. **Save File** creates a district file (`.json`) the LCAP team can pass around; **Open File** loads it anywhere.
- To distribute an update, send the new `LCAP Tracker.html`. Saved district files open in any version.
- Nothing leaves the computer unless a district turns on the optional AI features and enters its own API key.

## What districts do with it

The built-in **Guide** walks through this sequence:

1. **Import the current LCAP (PDF).** The tracker reads each goal's *Measuring and Reporting Results* table, maps each metric to the 28 required LCFF metrics (1A–8A), and shows a review screen with the number it parsed from every cell.
2. **Add data whenever it arrives** (*+ Add Data*):
   | Source | What happens |
   |---|---|
   | CA School Dashboard download files (ELA, Math, ELPI, Chronic Absenteeism, Suspension, Graduation, CCI) | District results for every student group, with Dashboard colors. Groups in Red are flagged. |
   | NWEA MAP export | Percent of students at/above a percentile (read from the LCAP metric, e.g. "80th percentile"), per term and subject. |
   | mCLASS / DIBELS 8 benchmark export | Percent At or Above Benchmark per benchmark period, optionally per school and grade. |
   | CSV template | Generated from the district's own metrics. Fill in period and value. |
   | Any other spreadsheet (DataQuest downloads, local reports) | Choose the metric, value, period, and student-group columns, with an optional row filter. DataQuest reporting-category codes are recognized. |
   | Manual entry | Open a metric and add a single result. |
   Student-level files (NWEA, mCLASS) are summarized into percentages in the browser; student rows are never saved or sent.
3. **Monitor.** *Dashboard* shows every metric as Priority, Watch, Sustain, or Review, with reasons. *Required Metrics* checks coverage of all 28 required metrics.
4. **Needs assessment and engagement.** *Next-Cycle Summary* gives one card per LCFF priority (pattern, strongest progress, most important need, equity question, planning direction) with team notes. **Summary Report** prints a one-page overview for boards, advisory committees, and staff.
5. **Draft the next plan.** *Next-Cycle Draft* lists every metric in the state template's column order, with the latest result as the new baseline, a suggested Year 3 target, and planning flags (Red student groups, combined measures, stale data, missing required metrics). Edit targets, then **Copy table** into the LCAP template in Word or **Download for Excel**.

## How statuses are scored

Every result is a dated point on the metric's timeline. The primary group (All students unless changed) is compared with the baseline and the target each time data changes:

| Status | Rule |
|---|---|
| **Sustain** | At or beyond the target, or at least 90% of the way there, without a notable drop. |
| **Watch** | Target met/nearly met but more than half of the peak gain was lost or results dipped below baseline; *or* at least 50% of the way to target; *or* 25–50% of the way and still improving. |
| **Priority** | No improvement over baseline; *or* under 50% of the way and the latest result declined; *or* under 25% of the way; *or* All students in Red on the Dashboard. |
| **Review** | No numeric data or target yet, or not applicable. |

A student group in Red moves a Sustain metric to Watch. Direction (higher/lower is better, or maintain) is inferred from the baseline and target and can be changed per metric.

**Suggested next-cycle targets** close a chosen share of the gap (default 30%, adjustable) between the latest result and the ideal: 100% (or 0% for measures like chronic absenteeism), at standard for distance-from-standard, or one level higher on 5-point implementation ratings. Maintenance measures stay at their current target. When a current-cycle target was not reached, the planning notes name it as the more ambitious option. Suggestions are for discussion, not recommendations.

## Optional AI

In *Settings & AI*, a district can enter its own Anthropic API key to have Claude read scanned or non-standard LCAP PDFs and write narrative insights and priority summaries. Requests go directly from the browser to `api.anthropic.com` (model `claude-opus-5-5`). Only district-level LCAP data and aggregate results are sent. AI text is marked out of date when a metric's data changes.

## Example district

*Load example district* opens Tulelake Basin Joint USD's 2024–27 LCAP metrics (public data) with the narrative from the original LCAPGPT workbook, so new users can try every feature.

## Developing

```
LCAP Tracker.html    built app (share this file)
src/tracker.html     page shell and styles
src/engine.js        parsing, metric inference, status rules, insights, next-cycle draft (no DOM; testable in Node)
src/pdf-extract.js   LCAP table extraction from pdf.js text positions
src/importers.js     Dashboard, NWEA, mCLASS, CSV template, generic importers
src/ai.js            optional Claude API calls
src/ui.js            rendering and interactions
assets/              Modoc COE logo (embedded into the page at build time)
vendor/              pdf.js 3.11 (Apache-2.0), SheetJS 0.18 (Apache-2.0)
samples/             example district
tests/engine.test.js
build.py             inlines everything into LCAP Tracker.html
```

After changing anything in `src/` or `samples/`:

```
python3 build.py
node tests/engine.test.js
```

**Known limits.** PDF extraction expects the state LCAP template's metrics table in a text-based PDF. Scans and other layouts need the AI option or rows added on the review screen. Cells that combine several values (sites or subjects) are scored on the district-labeled or first number and flagged in the draft.
