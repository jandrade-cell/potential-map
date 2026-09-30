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

A district keeps **two plans** in the tracker, switched with the plan menu under the district name:

- the **previous LCAP**, which it reflects on, and
- the **new three-year LCAP** (for example 2026–27 through 2028–29), which it monitors each year.

The built-in **Guide** walks through the sequence:

**Part 1: Reflect on the previous LCAP**

1. **Import the previous LCAP (PDF)** and choose *"The previous LCAP"* on the review screen. The tracker reads each goal's description, its *Measuring and Reporting Results* table, and its *Actions* table (title, description, total funds, contributing). It maps each metric to the 28 required LCFF metrics (1A–8A) and shows the number it parsed from every cell.
2. **Add the newest results** (*+ Add Data*). Each upload asks which LCAP year it *counts toward*:
   | Source | What happens |
   |---|---|
   | CA School Dashboard download files (ELA, Math, ELPI, Chronic Absenteeism, Suspension, Graduation, CCI) | District results for every student group, with Dashboard colors. Groups in Red are flagged. |
   | NWEA MAP export | Percent of students at/above a percentile (read from the LCAP metric, e.g. "80th percentile"), per term and subject. |
   | mCLASS / DIBELS 8 benchmark export | Percent At or Above Benchmark per benchmark period, optionally per school and grade. |
   | CSV template | Generated from the district's own metrics. Fill in period and value. |
   | Any other spreadsheet (DataQuest downloads, local reports) | Choose the metric, value, period, and student-group columns, with an optional row filter. DataQuest reporting-category codes are recognized. |
   | Manual entry | Open a metric and add a single result. |
   Student-level files (NWEA, mCLASS) are summarized into percentages in the browser; student rows are never saved or sent.
3. **Reflection tab.** For each goal: the metrics table in the template's columns with a status for each metric, the goal's actions with an effectiveness rating (effective, somewhat, not effective, unclear) and evidence, and drafted text for *how effective the actions were* and *changes resulting from reflection*. The Plan Summary's *successes* and *identified needs* (lowest performance, student groups in Red, unmet and missing metrics) are drafted too. Drafts refresh from the data until edited; **Copy reflections** pastes everything into the template in Word. *Next-Cycle Summary*, *Summary Report*, and *Required Metrics* support educational-partner engagement.

**Part 2: Build the new plan**

4. **Next-Cycle Draft** lists every metric with its latest result as the new baseline and a suggested Year 3 target, plus planning flags. **Create the new LCAP** copies the goals, metrics, and actions into the new three-year plan with those baselines and targets. After board adoption, the adopted LCAP PDF can be imported as *"The current three-year LCAP"* to replace the draft.

**Part 3: Every year of the new plan**

5. Add each year's results and choose the LCAP year (Year 1 2026–27, Year 2 2027–28, Year 3 2028–29). They fill the template's *Year 1 Outcome* and *Year 2 Outcome* columns and the *Current Difference from Baseline*. On the Reflection tab, pick the year, rate the actions for that year, and edit the drafted annual update. **Copy metrics table** and **Copy reflections** paste straight into Word.

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

In *Settings & AI*, a district can enter its own Anthropic API key to have Claude read scanned or non-standard LCAP PDFs (metrics, goals, and actions), write narrative insights and priority summaries, and draft the reflection sections. Requests go directly from the browser to `api.anthropic.com` (model `claude-opus-5-5`). Only district-level LCAP data and aggregate results are sent. AI text is marked out of date when a metric's data changes.

## Example district

*Load example district* opens Tulelake Basin Joint USD's 2024–27 LCAP metrics (public data) with the narrative from the original LCAPGPT workbook, so new users can try every feature.

## Developing

```
LCAP Tracker.html    built app (share this file)
src/tracker.html     page shell and styles
src/engine.js        parsing, metric inference, status rules, insights, reflections, plans and LCAP years, next-cycle draft (no DOM; testable in Node)
src/pdf-extract.js   LCAP metrics, goals, and actions tables from pdf.js text positions
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
