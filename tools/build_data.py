#!/usr/bin/env python3
"""Build the Modoc County Data Hub's built-in data.

Downloads the official public files behind the CA School Dashboard (CDE) and the
CAASPP / ELPAC results that DataQuest reports (ETS research files), keeps only
Modoc County (county code 25) and statewide rows, and writes them into
"Modoc County Data Hub.html" so the page opens with the data already loaded.

Usage:
    python3 tools/build_data.py                 # latest 3 Dashboard years, latest 4 test years
    python3 tools/build_data.py --dash-years 3 --test-years 4 --html "Modoc County Data Hub.html"

Public data only: the script will only contact the three public sites in
ALLOWED_HOSTS, over HTTPS, without credentials or cookies. Any other address,
including a redirect to one, stops the build. Standard library only.
"""
import argparse
import datetime as dt
import io
import json
import re
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

# The only sites this script may contact: CDE's public pages and data files, and ETS's public research files.
ALLOWED_HOSTS = frozenset({'www.cde.ca.gov', 'www3.cde.ca.gov', 'caaspp-elpac.ets.org'})


class NotPublicSource(Exception):
    pass


def check_url(url):
    """Refuse anything but HTTPS to an allowed public host."""
    u = urllib.parse.urlsplit(url)
    if u.scheme != 'https' or (u.hostname or '').lower() not in ALLOWED_HOSTS or u.username or u.password:
        raise NotPublicSource(f'Refusing {url!r}: only public CDE/ETS sites are allowed ({", ".join(sorted(ALLOWED_HOSTS))}).')
    return url


class _CheckedRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_url(urllib.parse.urljoin(req.full_url, newurl))
        return super().redirect_request(req, fp, code, msg, headers, newurl)


# No cookie handler, no auth handler, no proxy credentials: plain anonymous HTTPS GETs only.
_OPENER = urllib.request.build_opener(_CheckedRedirects)


def _get(url, headers=None, timeout=180):
    req = urllib.request.Request(check_url(url), headers={'User-Agent': 'modoc-data-hub-builder', **(headers or {})})
    return _OPENER.open(req, timeout=timeout)

COUNTY = '25'
STATE = '0' * 14
ETS = 'https://caaspp-elpac.ets.org'
CDE_PAGE = 'https://www.cde.ca.gov/ta/ac/cm/{page}datafiles.asp'
CDE_FILE = 'https://www3.cde.ca.gov/researchfiles/cadashboard/{name}'

# Dashboard indicator key (as used by the page) -> CDE data-file page and file prefix
DASH = {
    'ela': ('ela', 'eladownload'), 'math': ('math', 'mathdownload'), 'sci': ('science', 'sciencedownload'),
    'chronic': ('chronic', 'chronicdownload'), 'susp': ('susp', 'suspdownload'), 'grad': ('grad', 'graddownload'),
    'elpi': ('elpi', 'elpidownload'), 'cci': ('cci', 'ccidownload'),
}
IND_NAME = {'ela': 'English Language Arts', 'math': 'Mathematics', 'sci': 'Science', 'chronic': 'Chronic Absenteeism',
            'susp': 'Suspension Rate', 'grad': 'Graduation Rate', 'elpi': 'English Learner Progress', 'cci': 'College/Career'}
# ETS research-file pages: (family, list page, test type, file prefix)
ASSESS = [
    ('caaspp', 'caaspp/ResearchFileListSB', 'B', 'sb_ca'),
    ('caaspp', 'caaspp/ResearchFileListCAST', 'X', 'cast_ca'),
    ('elpac', 'elpac/ResearchFilesSA', 'SA', 'sa_elpac'),
]
CAASPP_TEST_IDS = {1: 'ela', 2: 'math', 17: 'sci'}
ELPAC_TEST_IDS = {2: 'elpac', 21: 'elpac'}
TEST_NAME = {'ela': 'ELA', 'math': 'Math', 'sci': 'Science', 'elpac': 'ELPAC'}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def fetch(url, tries=5, timeout=180):
    """GET a URL with retries (CDE sometimes refuses or times out briefly)."""
    last = None
    for i in range(tries):
        try:
            return _get(url, timeout=timeout)
        except NotPublicSource:
            raise
        except Exception as e:  # noqa: BLE001
            last = e
            if getattr(e, 'code', None) == 404:
                raise
            time.sleep(2 ** i)
    raise last


def fetch_text(url):
    with fetch(url) as r:
        return decode(r.read())


def exists(url):
    try:
        with _get(url, headers={'Range': 'bytes=0-0'}, timeout=60) as r:
            return r.status in (200, 206)
    except NotPublicSource:
        raise
    except Exception:  # noqa: BLE001
        return False


def decode(b):
    try:
        return b.decode('utf-8-sig')
    except UnicodeDecodeError:
        return b.decode('cp1252')


def norm(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())


def num(v):
    if v is None:
        return None
    s = str(v).strip().replace(',', '')
    if s in ('', '*', '--') or s.upper() == 'N/A':
        return None
    try:
        n = float(s)
    except ValueError:
        return None
    return int(n) if n.is_integer() and '.' not in s else n


def pad(s, n):
    return str(s or '').strip().rjust(n, '0')


def level_of(cds):
    if cds == STATE:
        return 'state'
    if cds[2:] == '0' * 12:
        return 'county'
    if cds[7:] == '0' * 7:
        return 'district'
    return 'school'


def rows_of(lines, delim):
    """Yield dicts keyed by normalized header from an iterable of text lines."""
    it = iter(lines)
    header = None
    for line in it:
        line = line.rstrip('\r\n')
        if not line:
            continue
        if header is None:
            header = [norm(h.strip().strip('"')) for h in line.lstrip('﻿').split(delim)]
            continue
        vals = line.split(delim)
        yield dict(zip(header, (v.strip().strip('"') for v in vals)))


def stream_lines(url):
    """Stream a large text file line by line (Dashboard files are 15-30 MB)."""
    with fetch(url, timeout=600) as r:
        for raw in r:
            try:
                yield raw.decode('utf-8-sig')
            except UnicodeDecodeError:
                yield raw.decode('cp1252')


class Hub:
    def __init__(self):
        self.dash, self.assess, self.names, self.files = [], {}, {}, []

    def name(self, cds, dn, sn):
        lvl = level_of(cds)
        dn, sn = (dn or '').strip(), (sn or '').strip()
        if lvl == 'district' and dn:
            self.names[cds] = {'name': dn, 'type': 'district'}
        if lvl == 'school' and sn:
            self.names[cds] = {'name': sn, 'type': 'school'}
        dk = cds[:7] + '0' * 7
        if lvl == 'school' and dn and dk not in self.names:
            self.names[dk] = {'name': dn, 'type': 'district'}

    def record(self, name, kind, label, rows, year, url):
        self.files.append({'name': name, 'kind': kind, 'label': label, 'rows': rows, 'year': str(year),
                           'loaded': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'), 'builtin': True,
                           'source': url})

    # ---- CA School Dashboard ----
    def load_dash(self, ind, year, url):
        name = url.rsplit('/', 1)[-1]
        n = 0
        for r in rows_of(stream_lines(url), '\t'):
            cds = pad(r.get('cds'), 14)
            rtype = (r.get('rtype') or '').strip().upper()
            if not (cds.startswith(COUNTY) or 'modoc' in (r.get('countyname') or '').lower() or rtype == 'X'):
                continue
            key = STATE if rtype == 'X' else cds
            self.dash.append({
                'y': num(r.get('reportingyear')) or year, 'ind': ind, 'cds': key, 'rtype': rtype,
                'group': (r.get('studentgroup') or '').strip().upper(),
                'denom': num(r.get('currdenom')), 'status': num(r.get('currstatus')),
                'pdenom': num(r.get('priordenom')), 'pstatus': num(r.get('priorstatus')),
                'change': num(r.get('change')), 'color': num(r.get('color')) or 0, 'file': name,
            })
            n += 1
            if rtype != 'X':
                self.name(cds, r.get('districtname'), r.get('schoolname'))
        self.record(name, 'dash', 'Dashboard · ' + IND_NAME[ind], n, year, url)
        log(f'  {name}: {n} rows')

    # ---- CAASPP / ELPAC research files ----
    def load_assess(self, url, year):
        with fetch(url) as r:
            data = r.read()
        z = zipfile.ZipFile(io.BytesIO(data))
        member = next(m for m in z.namelist() if m.lower().endswith('.txt') and 'entities' not in m.lower())
        text = decode(z.read(member))
        lines = text.splitlines()
        keys = [norm(h) for h in lines[0].lstrip('﻿').split('^')]
        fam = 'elpac' if 'overallperflvl1pcnt' in keys else 'caaspp'
        ids = ELPAC_TEST_IDS if fam == 'elpac' else CAASPP_TEST_IDS

        def pick(r, ks):
            for k in ks:
                if k in r:
                    return num(r[k])
            return None

        n, tests, has_state, has_modoc = 0, set(), False, False
        for r in rows_of(lines, '^'):
            cc, dc, sc = pad(r.get('countycode'), 2), pad(r.get('districtcode'), 5), pad(r.get('schoolcode'), 7)
            cds = cc + dc + sc
            if not (cc == COUNTY or cds == STATE):
                continue
            test = ids.get(num(r.get('testid', r.get('assessmenttype'))))  # 2023 ELPAC: AssessmentType
            if not test:
                continue
            gs = (r.get('grade') or '').strip().upper()
            grade = 0 if gs in ('KN', 'K') else num(gs)
            if grade is None or grade == 99:
                continue
            group = num(r.get('studentgroupid', r.get('subgroupid', r.get('demographicid'))))
            row = {'y': num(r.get('testyear')) or year, 'cds': cds, 'test': test, 'grade': grade, 'group': group,
                   'enr': pick(r, ['totalstudentsenrolled', 'studentsenrolled', 'totalenrolled']),
                   'tested': pick(r, ['totalstudentstested', 'studentstested', 'totaltested']),
                   'scored': pick(r, ['totalstudentstestedwithscores', 'studentswithscores', 'totaltestedwithscores']),
                   'file': member.rsplit('/', 1)[-1]}
            if fam == 'elpac':
                row['mss'] = pick(r, ['overallmeansclscr'])
                for i in range(1, 5):
                    row[f'l{i}'] = pick(r, [f'overallperflvl{i}pcnt'])
                row['top'] = row['l4']
            else:
                row['mss'] = pick(r, ['meanscalescore'])
                row['l4'] = pick(r, ['percentagestandardexceeded', 'percentageadvanced'])
                row['l3'] = pick(r, ['percentagestandardmet', 'percentageproficient'])
                row['l2'] = pick(r, ['percentagestandardnearlymet', 'percentagedeveloping'])
                row['l1'] = pick(r, ['percentagestandardnotmet', 'percentageminimal'])
                row['top'] = pick(r, ['percentagestandardmetandabove', 'percentageproficientandabove'])
                if row['top'] is None and row['l3'] is not None and row['l4'] is not None:
                    row['top'] = round(row['l3'] + row['l4'], 2)
            # Same key as the page: a later file replaces an earlier row for the same thing.
            self.assess[(row['y'], test, cds, group, grade)] = row
            n += 1
            tests.add(test)
            has_state |= cds == STATE
            has_modoc |= cc == COUNTY
            if cc == COUNTY:
                self.name(cds, r.get('districtname'), r.get('schoolname'))
        if not n:
            log(f'  {member}: no Modoc or statewide rows recognized; skipped')
            return
        label = 'Summative ELPAC' if fam == 'elpac' else 'CAASPP · ' + ', '.join(
            TEST_NAME[t] for t in ('ela', 'math', 'sci') if t in tests)
        scope = 'Modoc + state' if has_state and has_modoc else 'state' if has_state else 'Modoc'
        self.record(member.rsplit('/', 1)[-1], fam, f'{label} ({scope})', n, year, url)
        log(f'  {member}: {n} rows ({scope})')


def dashboard_years(ind, want):
    page, prefix = DASH[ind]
    html = fetch_text(CDE_PAGE.format(page=page))
    years = sorted({int(y) for y in re.findall(prefix + r'(20\d\d)\.txt', html)}, reverse=True)
    return [(y, CDE_FILE.format(name=f'{prefix}{y}.txt')) for y in years[:want]]


def latest_test_year():
    with fetch(f'{ETS}/caaspp/ResearchFileListSB') as r:  # redirects to the newest year
        m = re.search(r'lstTestYear=(\d{4})', r.geturl())
    return int(m.group(1)) if m else dt.date.today().year


def research_files(list_page, test_type, prefix, year):
    """Find the current Modoc 'all student groups' file and the statewide 'all students' file for a year.
    ETS bumps the _vN suffix when it reissues a file, so read the list page for the newest version."""
    base = list_page.split('/')[0]
    found = []
    for county, stem in ((COUNTY, f'{prefix}{year}_all_{COUNTY}_csv_v'), ('00', f'{prefix}{year}_1_csv_v')):
        version = None
        try:
            html = fetch_text(f'{ETS}/{list_page}?ps=true&lstTestYear={year}&lstTestType={test_type}'
                              f'&lstCounty={county}&lstDistrict=00000')
            vers = [int(v) for v in re.findall(re.escape(stem) + r'(\d+)\.zip', html)]
            version = max(vers) if vers else None
        except Exception as e:  # noqa: BLE001
            log(f'  could not read {list_page} for {year}: {e}')
        url = f'{ETS}/{base}/researchfiles/{stem}{version or 1}.zip'
        if version or exists(url):
            found.append(url)
    return found


def same_data(old, new):
    strip = lambda d: {**{k: v for k, v in d.items() if k not in ('builtAt', 'files')},
                       'files': [{k: v for k, v in f.items() if k != 'loaded'} for f in d.get('files', [])]}
    return strip(old) == strip(new)


def compact(rows, cols):
    return {'cols': cols, 'rows': [[r.get(c) for c in cols] for r in rows]}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--html', default=str(Path(__file__).resolve().parent.parent / 'Modoc County Data Hub.html'))
    ap.add_argument('--dash-years', type=int, default=3, help='how many recent Dashboard years to include')
    ap.add_argument('--test-years', type=int, default=4, help='how many recent CAASPP/ELPAC years to include')
    a = ap.parse_args()

    hub = Hub()
    log('CA School Dashboard:')
    for ind in DASH:
        for year, url in sorted(dashboard_years(ind, a.dash_years)):
            hub.load_dash(ind, year, url)

    latest = latest_test_year()
    years = list(range(latest - a.test_years + 1, latest + 1))
    log(f'CAASPP / ELPAC research files {years[0]}-{years[-1]}:')
    for year in years:
        for fam, page, ttype, prefix in ASSESS:
            urls = research_files(page, ttype, prefix, year)
            if not urls:
                log(f'  no {prefix}{year} files found')
            for url in urls:  # county file first, then statewide (only adds state rows / identical Modoc rows)
                hub.load_assess(url, year)

    if not hub.dash and not hub.assess:
        sys.exit('No data downloaded; leaving the page unchanged.')

    built = dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
    dash_cols = ['y', 'ind', 'cds', 'rtype', 'group', 'denom', 'status', 'pdenom', 'pstatus', 'change', 'color', 'file']
    assess_cols = ['y', 'cds', 'test', 'grade', 'group', 'enr', 'tested', 'scored', 'mss', 'l1', 'l2', 'l3', 'l4', 'top', 'file']
    payload = {
        'builtAt': built,
        'dash': compact(hub.dash, dash_cols),
        'assess': compact(list(hub.assess.values()), assess_cols),
        'names': hub.names,
        'files': hub.files,
    }
    blob = json.dumps(payload, separators=(',', ':'), ensure_ascii=False).replace('</', '<\\/')

    html_path = Path(a.html)
    html = html_path.read_text(encoding='utf-8')
    pat = re.compile(r'(<script id="hub-data" type="application/json">)(.*?)(</script>)', re.S)
    m = pat.search(html)
    if not m:
        sys.exit('Could not find the <script id="hub-data"> block in ' + str(html_path))
    # Leave the page untouched when the published data has not changed (only timestamps would differ).
    try:
        old = json.loads(m.group(2).replace('<\\/', '</'))
    except ValueError:
        old = None
    if old and same_data(old, payload):
        log('Published data unchanged since ' + old.get('builtAt', '?') + '; page not modified.')
        return
    html = pat.sub(lambda m: m.group(1) + blob + m.group(3), html, count=1)
    html_path.write_text(html, encoding='utf-8')
    log(f'Wrote {len(hub.dash)} Dashboard rows and {len(hub.assess)} test rows '
        f'({len(blob) / 1e6:.1f} MB) into {html_path.name}; built {built}.')


if __name__ == '__main__':
    main()
