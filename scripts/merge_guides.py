#!/usr/bin/env python3
"""
Merge the per-site guides produced by `npm run grab` into one XMLTV file.

Several sites often carry the same channel. For every xmltv_id we keep only the
best source: the (site, lang) pair with the most programmes, preferring Arabic
on ties, so the final guide has exactly one schedule per channel.

Usage: merge_guides.py --out guide.xml [--gzip] [--report STATS.md] guides/*.xml
"""
import argparse
import gzip
import os
import shutil
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timezone


def prog_lang(el):
    t = el.find("title")
    return (t.get("lang") if t is not None else None) or ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--gzip", action="store_true")
    ap.add_argument("--report")
    ap.add_argument("files", nargs="+")
    args = ap.parse_args()

    channels = {}                         # xmltv_id -> first <channel> element seen
    progs = defaultdict(list)             # (xmltv_id, site, lang) -> [<programme>]

    for path in args.files:
        site = os.path.basename(path)
        for ext in (".xml.gz", ".xml"):
            if site.endswith(ext):
                site = site[: -len(ext)]
        try:
            opener = gzip.open if path.endswith(".gz") else open
            with opener(path, "rb") as f:
                root = ET.parse(f).getroot()
        except (ET.ParseError, OSError) as e:
            print(f"skip {path}: {e}", file=sys.stderr)
            continue
        for ch in root.findall("channel"):
            cid = ch.get("id")
            if cid and cid not in channels:
                channels[cid] = ch
        for p in root.findall("programme"):
            cid = p.get("channel")
            if cid:
                progs[(cid, site, prog_lang(p))].append(p)

    best = {}  # xmltv_id -> (site, lang, count)
    for (cid, site, lang), items in progs.items():
        cand = (len(items), lang.startswith("ar"))
        cur = best.get(cid)
        if cur is None or cand > (cur[2], cur[1].startswith("ar")):
            best[cid] = (site, lang, len(items))

    out_root = ET.Element("tv", {
        "date": datetime.now(timezone.utc).strftime("%Y%m%d"),
        "generator-info-name": "arabic-epg",
        "generator-info-url": "https://github.com/iimnm/arabic-epg",
    })
    ids = sorted(best)
    for cid in ids:
        ch = channels.get(cid)
        if ch is None:
            ch = ET.Element("channel", {"id": cid})
            ET.SubElement(ch, "display-name").text = cid
        out_root.append(ch)
    total = 0
    for cid in ids:
        site, lang, _ = best[cid]
        items = sorted(progs[(cid, site, lang)], key=lambda p: p.get("start", ""))
        seen = set()
        for p in items:
            k = p.get("start")
            if k in seen:
                continue
            seen.add(k)
            out_root.append(p)
            total += 1

    ET.indent(out_root, space="  ")
    ET.ElementTree(out_root).write(args.out, encoding="UTF-8", xml_declaration=True)
    if args.gzip:
        with open(args.out, "rb") as src, gzip.open(args.out + ".gz", "wb", 9) as dst:
            shutil.copyfileobj(src, dst)

    print(f"{len(ids)} channels, {total} programmes -> {args.out}")

    if args.report:
        with open(args.report, "w", encoding="utf-8") as f:
            f.write("# Arabic EPG\n\n")
            f.write(f"- Updated: {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC\n")
            f.write(f"- Channels with programmes: **{len(ids)}**\n")
            f.write(f"- Programmes: **{total}**\n\n")
            f.write("| Channel (xmltv_id) | Source | Lang | Programmes |\n|---|---|---|---:|\n")
            for cid in ids:
                site, lang, n = best[cid]
                f.write(f"| {cid} | {site} | {lang} | {n} |\n")


if __name__ == "__main__":
    main()
