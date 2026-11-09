#!/usr/bin/env python3
"""Make the shareable web-page version of the hub from "Modoc County Data Hub.html".

The shared page runs inside Claude's artifact viewer, which supplies its own <html>/<head>/<body>
and its own Content-Security-Policy, and does not allow printing. This writes a copy with:
  - no <!DOCTYPE>, <html>, <head> or <body> tags (the viewer adds them),
  - no meta CSP (the viewer's policy applies instead),
  - no Print button.
Everything else, including the built-in data, is unchanged.

Usage:  python3 tools/make_artifact.py OUTPUT.html [--html "Modoc County Data Hub.html"]
"""
import argparse
import re
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument('output')
ap.add_argument('--html', default=str(Path(__file__).resolve().parent.parent / 'Modoc County Data Hub.html'))
a = ap.parse_args()

s = Path(a.html).read_text(encoding='utf-8')
removals = [
    r'<!DOCTYPE html>\s*', r'<html[^>]*>\s*', r'<head>\s*', r'</head>\s*', r'<body>\s*', r'</body>\s*', r'</html>\s*',
    r'<meta charset="UTF-8">\s*', r'<meta name="viewport"[^>]*>\s*',
    r'<!-- Public data only, and nothing leaves this computer:.*?-->\s*', r'<meta http-equiv="Content-Security-Policy"[^>]*>\s*',
    r'\s*<button class="btn" id="printBtn"[^>]*>Print</button>',
]
for pat in removals:
    s, n = re.subn(pat, '', s, count=1, flags=re.S)
    if not n:
        raise SystemExit('Expected to find and remove: ' + pat)
if s.find('<title>') > 8000:
    raise SystemExit('<title> must be in the first 8KB')
Path(a.output).write_text(s, encoding='utf-8')
print(f'Wrote {a.output} ({len(s.encode()) / 1e6:.1f} MB)')
