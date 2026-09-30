#!/usr/bin/env python3
"""Build the single-file, offline LCAP Tracker.

Inlines the vendored libraries and the app source into one HTML file so it
can be opened from a shared drive or USB stick with no internet connection.

    python3 build.py
"""
import base64
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "LCAP Tracker.html"


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def script_safe(text):
    # Keep embedded JSON/JS from closing the surrounding <script> element.
    return re.sub(r"</(script)", r"<\\/\1", text, flags=re.I)


def main():
    html = read("src/tracker.html")

    # <script data-inline="vendor/x.js"></script>  ->  inline <script>
    def inline_script(m):
        return "<script>\n" + read(m.group(1)) + "\n</script>"

    html = re.sub(r'<script data-inline="([^"]+)"></script>', inline_script, html)

    # The pdf.js worker is loaded from a Blob URL built from this text block.
    html = html.replace(
        '<script type="text/plain" id="pdf-worker-src" data-inline-text="vendor/pdf.worker.min.js"></script>',
        '<script type="text/plain" id="pdf-worker-src">' + read("vendor/pdf.worker.min.js") + "</script>",
    )

    # Images referenced from the page are embedded as data URIs.
    def embed_img(m):
        data = base64.b64encode((ROOT / m.group(1)).read_bytes()).decode()
        return f'src="data:image/png;base64,{data}"'

    html = re.sub(r'src="(assets/[^"]+\.png)"', embed_img, html)

    example = json.loads(read("samples/tbjusd-2026-27.lcap.json"))
    html = html.replace("/*EXAMPLE_DISTRICT*/null", script_safe(json.dumps(example, ensure_ascii=False)))

    OUT.write_text(html, encoding="utf-8")
    print(f"Wrote {OUT} ({OUT.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
