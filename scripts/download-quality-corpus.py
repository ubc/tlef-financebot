#!/usr/bin/env python3
"""Fetch complete public teaching PDFs for local multi-source acceptance.

Only metadata is suitable for repository publication. The teaching PDFs have no
established open redistribution license and remain in ignored audit-results.
No authenticated/password-only resources or model providers are used.
"""
import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path
import re
import subprocess
from datetime import datetime, timezone

CATALOG = "https://pages.stern.nyu.edu/adamodar/New_Home_Page/ACF4E/appldCF4E.htm"
BASE = "https://pages.stern.nyu.edu/~adamodar/pdfiles/acf4E/presentations/"
CHAPTERS = [
    (1, "The Foundations", "cfintro.pdf"),
    (2, "The Objective", "mgtobj.pdf"),
    (3, "The Basics of Risk", "risk%26ret.pdf"),
    (4, "Risk Measurement and Hurdle Rates", "hurdlerate.pdf"),
    (5, "Measuring Returns on Investments", "invretA.pdf"),
    (6, "Estimating Side Costs and Benefits", "invretB.pdf"),
    (7, "Capital Structure: An Overview of the Financing Decisions", "capstruchoices.pdf"),
    (8, "Capital Structure: Model and Applications", "capstr.pdf"),
    (9, "Capital Structure: The Financing Details", "debtdesign.pdf"),
    (10, "The Determinants of Dividend Policy", "divintro.pdf"),
    (11, "A Framework for Analyzing Dividend Policy", "divassessment.pdf"),
    (12, "Basics of Valuation", "valuation.pdf"),
    (13, "Supplement: Basics of Statistics", "statisticsbasics.pdf"),
]


def fetch_chapter(chapter, destination):
    number, title, filename = chapter
    url = BASE + filename
    target = destination / f"chapter-{number:02d}.pdf"
    if not target.exists():
        # System curl uses the host's verified certificate store; do not disable
        # certificate checks to accommodate a Python environment's missing CAs.
        subprocess.run(["curl", "-fL", "--silent", "--show-error", "--max-time", "60", "--max-filesize", str(50 * 1024 * 1024), url, "-o", str(target)], check=True)
        data = target.read_bytes()
        if len(data) > 50 * 1024 * 1024 or not data.startswith(b"%PDF-"):
            raise ValueError(f"Unexpected or oversized PDF for chapter {number}")
    data = target.read_bytes()
    info = subprocess.run(["pdfinfo", str(target)], capture_output=True, text=True, check=True).stdout
    pages = int(re.search(r"^Pages:\s+(\d+)", info, re.MULTILINE).group(1))
    text_file = target.with_suffix(".txt")
    subprocess.run(["pdftotext", "-layout", str(target), str(text_file)], check=True, capture_output=True)
    text = text_file.read_text(errors="replace")
    return {"chapter": number, "title": title, "author": "Aswath Damodaran", "institution": "NYU Stern School of Business",
            "catalogUrl": CATALOG, "url": url, "file": str(target.resolve()), "sha256": hashlib.sha256(data).hexdigest(),
            "bytes": len(data), "pages": pages, "extractedCharacters": len(text), "wholeDocument": True,
            "license": "Publicly downloadable author teaching slides; no open redistribution license established. Local testing only."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="audit-results/generation-quality-corpus")
    args = parser.parse_args()
    destination = Path(args.output)
    destination.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        chapters = list(pool.map(lambda chapter: fetch_chapter(chapter, destination), CHAPTERS))
    long_chapters = [chapter for chapter in chapters if chapter["pages"] >= 15]
    if len(long_chapters) < 11:
        raise ValueError("Need at least eleven complete PDFs of fifteen or more pages.")
    manifest = {"version": 1, "downloadedAt": datetime.now(timezone.utc).isoformat(), "sourceCatalog": CATALOG,
                "fixtureKind": "Public real teaching material, not synthetic notes or instructor-calibrated labels",
                "chapters": chapters, "coldBatch": [chapter["chapter"] for chapter in long_chapters[:10]],
                "addition": long_chapters[10]["chapter"],
                "replacement": {"chapter": 4, "replacementChapter": 1, "wholeDocument": True,
                                "method": "The complete public Foundations PDF replaces Chapter 4 by explicit test selection; neither PDF is modified and this is not an author revision."},
                "totalPages": sum(chapter["pages"] for chapter in chapters)}
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"manifest": str((destination / "manifest.json").resolve()), "chapters": len(chapters), "longChapters": len(long_chapters),
                      "totalPages": manifest["totalPages"], "coldBatch": manifest["coldBatch"], "addition": manifest["addition"]}))


if __name__ == "__main__":
    main()
