#!/usr/bin/env python3
"""Extract the goals and "Measuring and Reporting Results" metrics from LCAP PDFs.

Reads LCAPs written on CDE's 2024-27 LCAP template (2024-25, 2025-26 or 2026-27 year) and writes one
JSON file per LEA to data/lcap/, which tools/build_data.py builds into the hub.

Usage:
    python3 tools/extract_lcap.py data/lcap/*.pdf

Needs:  pip install pdfplumber
The PDFs are public documents that each district posts and files with the county office.
"""
import json
import re
import sys
from pathlib import Path

import pdfplumber

OUT = Path(__file__).resolve().parent.parent / 'data' / 'lcap'

# The three Modoc districts plus the county office. Matched against the LEA name on the LCAP's first page.
LEAS = {
    'modoc joint unified': '25735850000000',
    'surprise valley joint unified': '25658960000000',
    'tulelake basin joint unified': '25735930000000',
    'modoc county office of education': '25102560000000',
}

METRIC_HEAD = ['metric #', 'metric', 'baseline', 'year 1 outcome', 'year 2 outcome']
METRIC_ID = re.compile(r'^\d{1,2}\.\d{1,2}[a-z]?$')


def unspace_start(s):
    """Some LCAP PDFs letter-space the first characters of a cell ("1 8 %", "2 0 23:", "F o r").
    Rejoin only those leading characters; the rest of the cell is left as written."""
    toks = s.split(' ')
    n = 0
    while n < len(toks) and len(toks[n]) == 1:
        n += 1
    if n >= 2:
        head, rest = ''.join(toks[:n]), toks[n:]
        # "2 0 23:" -> "2023:" (two split digits followed by the rest of a year)
        if n == 2 and head.isdigit() and rest and re.match(r'\d{2}\b', rest[0]):
            head, rest = head + rest[0], rest[1:]
        return ' '.join([head] + rest)
    if n == 1 and len(toks) > 1:
        # "2 023-24" -> "2023-24", "T BES:" -> "TBES:" (a split number or acronym)
        a, b = toks[0], toks[1]
        if (a.isdigit() and re.match(r'\d{3}\b', b)) or (a.isupper() and re.match(r'[A-Z]{2,}\b', b)):
            return ' '.join([a + b] + toks[2:])
    return s


def clean(s):
    """Tidy cell text: join wrapped lines, fix the template's split 'P riority', squeeze spaces."""
    s = (s or '').replace(' ', ' ')
    s = re.sub(r'(\w)-\n(\w)', r'\1-\2', s)          # "standards-\naligned" -> "standards-aligned"
    s = s.replace('\n', ' ')
    s = re.sub(r'P riority', 'Priority', s)  # the template's checkboxes render as "XP riority"
    s = re.sub(r'\s+', ' ', s).strip()
    return unspace_start(s)


def header_of(row):
    return [clean(c).lower() for c in row]


def lea_of(pdf):
    first = pdf.pages[0].extract_text() or ''
    text = re.sub(r'\s+', ' ', first).lower()
    for name, cds in LEAS.items():
        if name in text:
            return name, cds
    raise SystemExit('Could not tell which LEA this LCAP is for (first page): ' + first[:200])


def lcap_year(pdf):
    for page in pdf.pages[:3]:
        m = re.search(r'(20\d\d)\s*[–-]\s*(\d\d)\s+Local Control and Accountability Plan', page.extract_text() or '')
        if m:
            return f'{m.group(1)}–{m.group(2)}'
    return ''


def extract(path):
    goals, goal, last = [], None, None
    with pdfplumber.open(path) as pdf:
        lea, cds = lea_of(pdf)
        year = lcap_year(pdf)
        for page in pdf.pages:
            text = page.extract_text() or ''
            if re.search(r'^\s*Instructions\s*$', text, re.M) and goals:
                break  # the template's instructions (with example tables) follow the plan itself
            for table in page.extract_tables():
                if not table or not table[0]:
                    continue
                head = header_of(table[0])
                if head[:2] == ['goal #', 'description'] and len(table) > 1 and clean(table[1][0]).isdigit():
                    row = table[1]
                    goal = {'num': clean(row[0]), 'description': clean(row[1]),
                            'type': clean(row[2]) if len(row) > 2 else '', 'priorities': [], 'metrics': []}
                    goals.append(goal)
                    last = None
                elif head[0].startswith('state priorities addressed') and goal is not None and len(table) > 1:
                    body = clean(' '.join(c or '' for c in table[1]))
                    goal['priorities'] = sorted({int(n) for n in re.findall(r'Priority\s*(\d{1,2})\s*:', body)})
                elif head[:5] == METRIC_HEAD and goal is not None:
                    for row in table[1:]:
                        cells = [clean(c) for c in row] + [''] * 7
                        if not any(cells[:7]):
                            continue
                        mid = cells[0]
                        if METRIC_ID.match(mid) and not any(cells[1:7]):
                            continue  # a blank row left in the LCAP's table
                        if METRIC_ID.match(mid):
                            last = {'id': mid, 'metric': cells[1], 'baseline': cells[2], 'y1': cells[3],
                                    'y2': cells[4], 'target': cells[5], 'diff': cells[6]}
                            goal['metrics'].append(last)
                        elif last is not None and not mid:
                            # Continuation of the previous metric's cells onto this page.
                            for key, val in zip(['metric', 'baseline', 'y1', 'y2', 'target', 'diff'], cells[1:7]):
                                if val:
                                    last[key] = (last[key] + ' ' + val).strip()
                elif head and head[0] in ('action #',):
                    last = None
    return {'cds': cds, 'lea': lea.title().replace('Of ', 'of '), 'lcapYear': year,
            'source': Path(path).name, 'goals': goals}


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    OUT.mkdir(parents=True, exist_ok=True)
    newest = {}
    for p in sys.argv[1:]:
        data = extract(p)
        n = sum(len(g['metrics']) for g in data['goals'])
        print(f"{Path(p).name}: {data['lea']} {data['lcapYear']} — {len(data['goals'])} goals, {n} metrics")
        if not n:
            print('  no metrics found; skipped (is this on the 2024-27 LCAP template?)')
            continue
        # With several LCAPs for one district in the folder, the newest LCAP year is used.
        if data['cds'] not in newest or data['lcapYear'] > newest[data['cds']]['lcapYear']:
            newest[data['cds']] = data
    for cds, data in newest.items():
        out = OUT / f"{cds}.json"
        out.write_text(json.dumps(data, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
        print(f"Wrote {out.name} from {data['source']} ({data['lcapYear']})")


if __name__ == '__main__':
    main()
