#!/usr/bin/env python3
"""Build the Modoc County Data Hub's built-in data.

Downloads the official public files behind the CA School Dashboard (CDE) and the
CAASPP / ELPAC results that DataQuest reports (ETS research files), keeps only
Modoc County (county code 25) and statewide rows, and writes them into
"Modoc County Data Hub.html" so the page opens with the data already loaded.

Usage:
    python3 tools/build_data.py                 # latest 3 Dashboard years, latest 4 test years
    python3 tools/build_data.py --dash-years 3 --test-years 4 --html "Modoc County Data Hub.html"

Public data only: the script will only contact the public CDE, ETS and NCES sites in
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
ALLOWED_HOSTS = frozenset({'www.cde.ca.gov', 'www3.cde.ca.gov', 'sd.cde.ca.gov', 'caaspp-elpac.ets.org', 'nces.ed.gov'})


class NotPublicSource(Exception):
    pass


class OffsiteRedirect(NotPublicSource):
    """A public site tried to send us elsewhere (for example CDE's bot check). Never followed; retried later."""


def check_url(url):
    """Refuse anything but HTTPS to an allowed public host."""
    u = urllib.parse.urlsplit(url)
    if u.scheme != 'https' or (u.hostname or '').lower() not in ALLOWED_HOSTS or u.username or u.password:
        raise NotPublicSource(f'Refusing {url!r}: only public CDE/ETS sites are allowed ({", ".join(sorted(ALLOWED_HOSTS))}).')
    return url


class _CheckedRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urllib.parse.urljoin(req.full_url, newurl)
        try:
            check_url(target)
        except NotPublicSource:
            host = urllib.parse.urlsplit(target).hostname
            raise OffsiteRedirect(f'{req.full_url} redirected to {host}; not followed') from None
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


CACHE_DIR = None   # set by --cache: keep downloaded files so a rerun doesn't fetch them again


def fetch_bytes(url, timeout=600):
    """Download a whole file, reusing the --cache copy when there is one."""
    import hashlib
    path = None
    if CACHE_DIR:
        path = Path(CACHE_DIR) / (hashlib.sha1(url.encode()).hexdigest()[:16] + '-' + re.sub(r'[^A-Za-z0-9._-]', '_', url.rsplit('/', 1)[-1])[:60])
        if path.exists():
            return path.read_bytes()
    time.sleep(3)  # be gentle with the servers between large downloads
    with fetch(url, timeout=timeout) as r:
        data = r.read()
    if path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return data


def fetch(url, tries=6, timeout=180):
    """GET a URL with retries (CDE sometimes refuses or times out briefly)."""
    last = None
    for i in range(tries):
        try:
            return _get(url, timeout=timeout)
        except OffsiteRedirect as e:
            # CDE sends busy or rapid visitors to a check page: wait politely and try again, never follow it.
            last = e
            if i < tries - 1:
                wait = (30, 60, 120, 240, 300)[min(i, 4)]
                log(f'  {e}; waiting {wait}s')
                time.sleep(wait)
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


_LISTINGS_BLOCKED = False


def fetch_listing(url):
    """Read a CDE page that lists data files. Every file can also be found by name, so a page behind CDE's
    bot check is tried briefly and, once one is blocked, the rest are skipped for this run."""
    global _LISTINGS_BLOCKED
    if _LISTINGS_BLOCKED:
        raise OffsiteRedirect('CDE listing pages are behind a bot check this run')
    try:
        with fetch(url, tries=2) as r:
            return decode(r.read())
    except OffsiteRedirect:
        _LISTINGS_BLOCKED = True
        raise


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
    """Read a large text file line by line (Dashboard files are 15-30 MB)."""
    for raw in fetch_bytes(url).splitlines(keepends=True):
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
    try:
        html = fetch_listing(CDE_PAGE.format(page=page))
    except Exception as e:  # noqa: BLE001
        log(f'  could not read the {page} data-files page ({e}); looking the files up by name')
        html = ''
    years = sorted({int(y) for y in re.findall(prefix + r'(20\d\d)\.txt', html)}, reverse=True)
    if not years:  # the files themselves sit on CDE's file server under predictable names
        this = dt.date.today().year
        years = [y for y in range(this + 1, this - 6, -1) if exists(CDE_FILE.format(name=f'{prefix}{y}.txt'))]
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


# ---- Local Indicators (CDE): one public file per LCAP priority per year ----
LOCAL_PAGE = 'https://www.cde.ca.gov/ta/ac/cm/localindidatafiles.asp'
LOCAL_PRIORITIES = (1, 2, 3, 6, 7)


def load_local(want_years=2):
    """Latest Local Indicator self-reflection for each Modoc LEA and priority (falls back one year if missing)."""
    import csv
    csv.field_size_limit(10 ** 9)
    try:
        html = fetch_listing(LOCAL_PAGE)
    except Exception as e:  # noqa: BLE001
        log(f'  could not read the Local Indicators page ({e}); looking the files up by name')
        html = ''
    out, files = {}, []
    this_year = dt.date.today().year
    for pr in LOCAL_PRIORITIES:
        names = {}
        for name, year in re.findall(rf'cadashboard/(pr{pr}(20\d\d)\.txt)', html, re.I):
            names[int(year)] = name
        if not names:  # CDE names these Pr12024.txt or pr12025.txt, so try both spellings
            for year in range(this_year + 1, this_year - 4, -1):
                for name in (f'Pr{pr}{year}.txt', f'pr{pr}{year}.txt'):
                    if exists(CDE_FILE.format(name=name)):
                        names[year] = name
                        break
                if len(names) >= want_years:
                    break
        for year in sorted(names, reverse=True)[:want_years]:
            url = CDE_FILE.format(name=names[year])
            with fetch(url, timeout=600) as r:
                text = decode(r.read())
            head = text.split('\n', 1)[0]
            delim = '\t' if head.count('\t') > head.count('|') else '|'
            n = 0
            for row in csv.DictReader(io.StringIO(text), delimiter=delim):
                cds = pad(row.get('cdsCode'), 14)
                if not cds.startswith(COUNTY):
                    continue
                rec = {k[0].lower() + k[1:]: v.strip() for k, v in row.items() if k and v and v.strip()
                       and k not in ('cdsCode', 'lea', 'priorityNumber', 'year', 'Year')}
                rec['year'] = year
                slot = out.setdefault(cds, {})
                if str(pr) not in slot or slot[str(pr)]['year'] < year:  # keep the most recent year
                    slot[str(pr)] = rec
                n += 1
            files.append({'name': names[year], 'kind': 'local', 'label': f'Local Indicators · Priority {pr}',
                          'rows': n, 'year': str(year), 'builtin': True, 'source': url,
                          'loaded': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')})
            log(f'  {names[year]}: {n} Modoc rows')
    return out, files


# ---- LCAP metrics: extracted from each district's LCAP by tools/extract_lcap.py ----
LCAP_DIR = Path(__file__).resolve().parent.parent / 'data' / 'lcap'


def load_lcap():
    """Most recent LCAP's goals and metrics, keeping only the Year 2 Outcome (the latest reported result)."""
    out = {}
    for f in sorted(LCAP_DIR.glob('*.json')):
        d = json.loads(f.read_text(encoding='utf-8'))
        out[d['cds']] = {
            'lea': d['lea'], 'lcapYear': d['lcapYear'], 'source': d['source'],
            'goals': [{'num': g['num'], 'description': g['description'], 'type': g['type'],
                       'priorities': g['priorities'],
                       'metrics': [{'id': m['id'], 'metric': m['metric'], 'y2': m['y2']} for m in g['metrics']]}
                      for g in d['goals']],
        }
        log(f'  {f.name}: {d["lea"]} {d["lcapYear"]}, {sum(len(g["metrics"]) for g in d["goals"])} metrics')
    return out


# ---- Sister schools and districts: like populations statewide, from public CDE and NCES files ----
DIRECTORY_URL = 'https://sd.cde.ca.gov/schooldirectory/report?rid=dl1&tp=txt'   # CDE public school directory
ENROLL_PAGE = 'https://www.cde.ca.gov/ds/ad/filesenrcensus.asp'
EDGE_PAGE = 'https://nces.ed.gov/programs/edge/Geographic/SchoolLocations'
# NCES locale codes -> rurality score (0 = large city ... 6 = rural remote)
RURALITY = {11: 0, 12: 0.5, 13: 1, 21: 1, 22: 1.5, 23: 2, 31: 3, 32: 3.5, 33: 4, 41: 4, 42: 5, 43: 6}
LOCALE_NAME = {11: 'City, large', 12: 'City, midsize', 13: 'City, small', 21: 'Suburb, large', 22: 'Suburb, midsize',
               23: 'Suburb, small', 31: 'Town, fringe', 32: 'Town, distant', 33: 'Town, remote', 41: 'Rural, fringe',
               42: 'Rural, distant', 43: 'Rural, remote'}
# Feature weights for "like population" (standardized within each kind of school)
WEIGHTS = {'rural': 1.5, 'size': 1.0, 'sed': 1.0, 'el': 1.0, 'swd': 0.7, 'fh': 0.5}
# Performance measures per kind of school; sign +1 = higher is better
PERF = {'elementary': {'ela': 1, 'math': 1, 'chronic': -1}, 'middle': {'ela': 1, 'math': 1, 'chronic': -1, 'susp': -1},
        'high': {'ela': 1, 'math': 1, 'grad': 1, 'cci': 1}, 'span': {'ela': 1, 'math': 1, 'chronic': -1, 'grad': 1},
        'alternative': {'grad': 1, 'susp': -1, 'cci': 1},
        'unified': {'ela': 1, 'math': 1, 'chronic': -1, 'grad': 1, 'cci': 1}, 'elemdist': {'ela': 1, 'math': 1, 'chronic': -1},
        'highdist': {'ela': 1, 'math': 1, 'grad': 1, 'cci': 1}}
GRADES = ['TK', 'KN', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']


def _tsv(text):
    import csv
    csv.field_size_limit(10 ** 9)
    head = text.split('\n', 1)[0]
    delim = '\t' if head.count('\t') >= head.count('|') else '|'
    return csv.DictReader(io.StringIO(text), delimiter=delim)


def load_sisters(peers=5):
    import math
    import statistics
    log('Sister schools:')
    # 1. CDE school directory: status, kind of school, NCES IDs
    dir_rows = {}
    for r in _tsv(decode(fetch_bytes(DIRECTORY_URL))):
        cds = (r.get('CDSCode') or '').strip()
        if len(cds) == 14:
            dir_rows[cds] = r
    log(f'  school directory: {len(dir_rows)} entries')

    # 2. NCES locale for every California school
    html = fetch_text(EDGE_PAGE)
    files = sorted(set(re.findall(r'EDGE_GEOCODE_PUBLICSCH_(\d{4})\.zip', html)))
    if not files:
        raise SystemExit('Could not find the NCES school locale file')
    z = None
    for yr in reversed(files):  # NCES sometimes links a year before posting it; use the newest that exists
        edge_url = f'https://nces.ed.gov/programs/edge/data/EDGE_GEOCODE_PUBLICSCH_{yr}.zip'
        try:
            z = zipfile.ZipFile(io.BytesIO(fetch_bytes(edge_url)))
            files = files[:files.index(yr) + 1]
            break
        except Exception as e:  # noqa: BLE001
            if isinstance(e, NotPublicSource) and not isinstance(e, OffsiteRedirect):
                raise
            log(f'  NCES locale file for {yr} not available ({e}); trying the year before')
    if z is None:
        raise SystemExit('Could not download an NCES school locale file')
    member = next(m for m in z.namelist() if m.upper().endswith('.TXT'))
    locale = {}
    for line in decode(z.read(member)).splitlines():
        f = line.split('|')
        if len(f) > 11 and f[6] == 'CA' and f[11].strip().isdigit():
            locale[f[0].strip()] = int(f[11])
    log(f'  NCES locale ({files[-1]}): {len(locale)} California schools')

    # 3. Census Day enrollment by student group (latest year)
    try:
        page = fetch_listing(ENROLL_PAGE)
    except Exception as e:  # noqa: BLE001
        log(f'  could not read the enrollment page ({e}); looking the file up by name')
        page = ''
    links = re.findall(r'https://www3\.cde\.ca\.gov/demo-downloads/census/(cdenroll(\d{4})[^"]*?\.txt)', page)
    if not links:  # CDE names these cdenroll2526.txt (school year 2025-26)
        y = dt.date.today().year
        for start in range(y, y - 4, -1):
            yy = f'{start % 100:02d}{(start + 1) % 100:02d}'
            if exists(f'https://www3.cde.ca.gov/demo-downloads/census/cdenroll{yy}.txt'):
                links = [(f'cdenroll{yy}.txt', yy)]
                break
    if not links:
        raise SystemExit('Could not find the census enrollment file')
    name, yy = max(links, key=lambda x: x[1])
    enr = {}
    for r in _tsv(decode(fetch_bytes('https://www3.cde.ca.gov/demo-downloads/census/' + name))):
        lvl = r.get('AggregateLevel')
        if lvl not in ('S', 'D'):
            continue
        if lvl == 'D' and (r.get('Charter') or '').strip().upper() != 'ALL':
            continue  # district rows come as charter (Y), non-charter (N) and ALL; use ALL
        if lvl == 'S' and pad(r['SchoolCode'], 7) in ('0000000', '0000001'):
            continue  # "District Office" and nonpublic-school rows would collide with the district's own total
        cds = pad(r['CountyCode'], 2) + pad(r['DistrictCode'], 5) + (pad(r['SchoolCode'], 7) if lvl == 'S' else '0000000')
        e = enr.setdefault(cds, {})
        v = (r.get('TOTAL_ENR') or '').strip()
        e[r['ReportingCategory']] = 5.0 if v == '*' else (num(v) or 0)  # '*' = 10 or fewer students
        if r['ReportingCategory'] == 'TA':
            e['grades'] = [g for g in GRADES if (num(r.get('GR_' + g)) or 0) > 0 or (r.get('GR_' + g) or '').strip() == '*']
    log(f'  census enrollment {name}: {len(enr)} schools and districts')

    # 4. Latest Dashboard results (All Students) for every school and district
    perf, dass, dyear = {}, set(), None
    for ind in ('ela', 'math', 'chronic', 'susp', 'grad', 'cci'):
        years = dashboard_years(ind, 1)
        if not years:
            continue
        year, url = years[0]
        dyear = max(dyear or 0, year)
        for r in rows_of(stream_lines(url), '\t'):
            if (r.get('studentgroup') or '').strip().upper() != 'ALL' or (r.get('rtype') or '').upper() not in ('S', 'D'):
                continue
            cds = pad(r.get('cds'), 14)
            st = num(r.get('currstatus'))
            if st is not None:
                perf.setdefault(cds, {})[ind] = st
                perf[cds][ind + '_n'] = num(r.get('currdenom'))
            if (r.get('dass_flag') or '').strip().upper() == 'Y':
                dass.add(cds)
        log(f'  {url.rsplit("/", 1)[-1]}: statewide All Students results read')

    # ---- Build a profile for each school and district ----
    def kind_of_school(cds, d, e):
        if cds in dass or (d.get('EdOpsCode') or 'TRAD') not in ('TRAD',):
            return 'alternative'
        idx = [GRADES.index(g) for g in e.get('grades', [])]
        if not idx:
            return None
        lo, hi = min(idx), max(idx)          # 0 = TK ... 13 = grade 12
        if hi >= 12 and lo >= 8:             # grades 7-12 or 9-12
            return 'high'
        if hi >= 10 and lo <= 7:
            return 'span'
        if lo >= 7 and hi <= 10:             # grades 6-8
            return 'middle'
        return 'elementary'

    def profile(cds, kind, e, rural, d):
        ta = e.get('TA') or 0
        if ta < 5:
            return None
        pct = lambda k: 100 * min(e.get(k, 0), ta) / ta
        return {'cds': cds, 'kind': kind, 'enr': int(ta), 'sed': pct('SG_SD'), 'el': pct('SG_EL'), 'swd': pct('SG_DS'),
                'fh': pct('SG_FS') + pct('SG_HM'), 'rural': rural,
                'name': (d.get('School') if cds[7:] != '0000000' else d.get('District')) or '',
                'district': d.get('District') or '', 'county': d.get('County') or '',
                'locale': None, 'perf': perf.get(cds, {})}

    schools, districts = {}, {}
    dist_rural = {}
    for cds, d in dir_rows.items():
        if d.get('StatusType') != 'Active' or cds[7:] == '0000000':
            continue
        if (d.get('Virtual') or '').strip().upper() == 'F':
            continue  # fully virtual schools are not comparable
        e = enr.get(cds)
        if not e:
            continue
        nces = (d.get('NCESDist') or '').strip() + (d.get('NCESSchool') or '').strip()
        loc = locale.get(nces)
        kind = kind_of_school(cds, d, e)
        if not kind:
            continue
        p = profile(cds, kind, e, RURALITY.get(loc), d)
        if p:
            p['locale'] = loc
            schools[cds] = p
            if loc in RURALITY:
                dist_rural.setdefault(cds[:7], []).append((p['enr'], RURALITY[loc], loc))
    for cds, d in dir_rows.items():
        if d.get('StatusType') != 'Active' or cds[7:] != '0000000':
            continue
        kind = {'54': 'unified', '52': 'elemdist', '56': 'highdist'}.get((d.get('DOC') or '').strip())
        e = enr.get(cds)
        if not kind or not e:
            continue
        rs = dist_rural.get(cds[:7], [])
        tot = sum(w for w, _, _ in rs)
        rural = sum(w * r for w, r, _ in rs) / tot if tot else None
        p = profile(cds, kind, e, rural, d)
        if p:
            if rs:  # the locale most of the district's students attend
                by = {}
                for w, _, l in rs:
                    by[l] = by.get(l, 0) + w
                p['locale'] = max(by, key=by.get)
            districts[cds] = p
    log(f'  profiles: {len(schools)} schools, {len(districts)} districts')

    def match(pool_all, target):
        pool = [p for p in pool_all.values() if p['kind'] == target['kind'] and not p['cds'].startswith(COUNTY)]
        if len(pool) < 10:
            return None
        feats = {'rural': lambda p: p['rural'], 'size': lambda p: math.log10(p['enr']), 'sed': lambda p: p['sed'],
                 'el': lambda p: p['el'], 'swd': lambda p: p['swd'], 'fh': lambda p: p['fh']}
        sd = {}
        for k, f in feats.items():
            vals = [f(p) for p in pool if f(p) is not None]
            sd[k] = statistics.pstdev(vals) or 1
        # performance z-scores within this kind of school
        measures = PERF[target['kind']]
        mstats = {}
        for m in measures:
            vals = [p['perf'][m] for p in pool if m in p['perf']]
            if len(vals) > 10:
                mstats[m] = (statistics.mean(vals), statistics.pstdev(vals) or 1)

        def composite(p):
            zs = [measures[m] * (p['perf'][m] - mu) / s for m, (mu, s) in mstats.items() if m in p['perf']]
            return sum(zs) / len(zs) if len(zs) >= 2 else None

        def dist(p):
            tot = 0
            for k, f in feats.items():
                a, b = f(target), f(p)
                if a is None or b is None:
                    tot += WEIGHTS[k] * 1.0  # unknown rurality counts as one standard deviation apart
                else:
                    tot += WEIGHTS[k] * ((a - b) / sd[k]) ** 2
            return math.sqrt(tot)

        tcomp = composite(target)
        ranked = sorted(pool, key=dist)[:60]
        for p in ranked:
            p['_d'], p['_c'] = dist(p), composite(p)
        reliable = lambda p: (p['perf'].get('ela_n') or p['perf'].get('grad_n') or 0) >= 15
        like, stronger = [], []
        if tcomp is not None:
            near = [p for p in ranked[:30] if p['_c'] is not None and reliable(p)]
            like = sorted(near, key=lambda p: abs(p['_c'] - tcomp) + 0.15 * p['_d'])[:peers]
            better = [p for p in ranked if p['_c'] is not None and reliable(p) and p['_c'] >= tcomp + 0.5]
            stronger = sorted(better, key=lambda p: p['_d'])[:peers]
        else:
            like = [p for p in ranked if reliable(p)][:peers]  # population match only; performance not comparable

        def out(p):
            o = {k: p[k] for k in ('cds', 'name', 'district', 'county', 'enr', 'locale')}
            o.update({k: round(p[k], 1) for k in ('sed', 'el', 'swd')})
            o['perf'] = {m: p['perf'][m] for m in ('ela', 'math', 'chronic', 'susp', 'grad', 'cci') if m in p['perf']}
            return o
        return {'kind': target['kind'], 'pool': len(pool), 'comparable': tcomp is not None,
                'self': out(target), 'like': [out(p) for p in like], 'stronger': [out(p) for p in stronger]}

    result = {'year': dyear, 'enrollYear': f'20{yy[:2]}–{yy[2:]}', 'localeYear': f'20{files[-1][:2]}–{files[-1][2:]}', 'units': {}}
    for cds, p in list(schools.items()) + list(districts.items()):
        if not cds.startswith(COUNTY) or p['kind'] in (None, 'alternative'):
            continue  # alternative campuses (continuation, community day) are left out
        m = match(districts if cds[7:] == '0000000' else schools, p)
        if m:
            result['units'][cds] = m
            log(f"  {p['name']}: {m['kind']}, pool {m['pool']}, {len(m['like'])} like / {len(m['stronger'])} stronger")
    return result


SECTIONS = ('dash', 'tests', 'local', 'lcap', 'sisters')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--html', default=str(Path(__file__).resolve().parent.parent / 'Modoc County Data Hub.html'))
    ap.add_argument('--dash-years', type=int, default=3, help='how many recent Dashboard years to include')
    ap.add_argument('--test-years', type=int, default=4, help='how many recent CAASPP/ELPAC years to include')
    ap.add_argument('--cache', help='folder to keep downloaded files in, so a rerun does not download them again')
    ap.add_argument('--only', default=','.join(SECTIONS),
                    help='rebuild only these parts and keep the rest from the page: ' + ', '.join(SECTIONS))
    a = ap.parse_args()
    global CACHE_DIR
    CACHE_DIR = a.cache
    only = {x.strip() for x in a.only.split(',') if x.strip()}
    if only - set(SECTIONS):
        sys.exit('Unknown --only part(s): ' + ', '.join(sorted(only - set(SECTIONS))))

    html_path = Path(a.html)
    html = html_path.read_text(encoding='utf-8')
    pat = re.compile(r'(<script id="hub-data" type="application/json">)(.*?)(</script>)', re.S)
    m = pat.search(html)
    if not m:
        sys.exit('Could not find the <script id="hub-data"> block in ' + str(html_path))
    try:
        old = json.loads(m.group(2).replace('<\\/', '</')) or {}
    except ValueError:
        old = {}

    dash_cols = ['y', 'ind', 'cds', 'rtype', 'group', 'denom', 'status', 'pdenom', 'pstatus', 'change', 'color', 'file']
    assess_cols = ['y', 'cds', 'test', 'grade', 'group', 'enr', 'tested', 'scored', 'mss', 'l1', 'l2', 'l3', 'l4', 'top', 'file']
    old_files = old.get('files', [])
    keep_kinds = set()
    payload = {'builtAt': None, 'names': dict(old.get('names', {}))}

    hub = Hub()
    if 'dash' in only:
        log('CA School Dashboard:')
        for ind in DASH:
            for year, url in sorted(dashboard_years(ind, a.dash_years)):
                hub.load_dash(ind, year, url)
        payload['dash'] = compact(hub.dash, dash_cols)
    else:
        payload['dash'] = old.get('dash', compact([], dash_cols))
        keep_kinds.add('dash')

    if 'tests' in only:
        latest = latest_test_year()
        years = list(range(latest - a.test_years + 1, latest + 1))
        log(f'CAASPP / ELPAC research files {years[0]}-{years[-1]}:')
        for year in years:
            for fam, page, ttype, prefix in ASSESS:
                urls = research_files(page, ttype, prefix, year)
                if not urls:
                    log(f'  no {prefix}{year} files found')
                for url in urls:  # county file first, then statewide (adds state rows / identical Modoc rows)
                    hub.load_assess(url, year)
        payload['assess'] = compact(list(hub.assess.values()), assess_cols)
    else:
        payload['assess'] = old.get('assess', compact([], assess_cols))
        keep_kinds |= {'caaspp', 'elpac'}

    local_files = []
    if 'local' in only:
        log('Local Indicators:')
        payload['local'], local_files = load_local()
    else:
        payload['local'] = old.get('local', {})
        keep_kinds.add('local')

    if 'lcap' in only:
        log('LCAP metrics (data/lcap):')
        payload['lcap'] = load_lcap()
    else:
        payload['lcap'] = old.get('lcap', {})

    if 'sisters' in only:
        payload['sisters'] = load_sisters()
    else:
        payload['sisters'] = old.get('sisters', {})

    if only & {'dash', 'tests'} and not hub.dash and not hub.assess:
        sys.exit('No data downloaded; leaving the page unchanged.')
    payload['names'].update(hub.names)
    payload['files'] = [f for f in old_files if f.get('kind') in keep_kinds] + hub.files + local_files

    # Leave the page untouched when the published data has not changed (only timestamps would differ).
    if old and same_data(old, payload):
        log('Published data unchanged since ' + old.get('builtAt', '?') + '; page not modified.')
        return
    payload['builtAt'] = dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
    blob = json.dumps(payload, separators=(',', ':'), ensure_ascii=False).replace('</', '<\\/')
    html = pat.sub(lambda mm: mm.group(1) + blob + mm.group(3), html, count=1)
    html_path.write_text(html, encoding='utf-8')
    log(f'Wrote {len(payload["dash"]["rows"])} Dashboard rows, {len(payload["assess"]["rows"])} test rows, '
        f'{len(payload["local"])} LEAs of Local Indicators and {len(payload["lcap"])} LCAPs '
        f'({len(blob) / 1e6:.1f} MB) into {html_path.name}; built {payload["builtAt"]}.')


if __name__ == '__main__':
    main()
