#!/usr/bin/env python3
"""
Build a custom *.channels.xml containing every Arabic channel that has
at least one EPG source in iptv-org/epg.

A channel is considered "Arabic" when ANY of these is true:
  * its country (iptv-org/database) is an Arab League member state
  * one of its feeds broadcasts in Arabic (language code "ara")
  * the site's channel entry is tagged lang="ar"

Usage:
  build_channels.py --epg PATH_TO_iptv-org/epg --db PATH_TO_iptv-org/database \
                    --out arabic.channels.xml [--report channels_report.md]
"""
import argparse
import csv
import glob
import os
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from xml.sax.saxutils import escape, quoteattr

# Arab League member states (ISO 3166-1 alpha-2)
ARAB_COUNTRIES = {
    "DZ", "BH", "KM", "DJ", "EG", "IQ", "JO", "KW", "LB", "LY", "MR",
    "MA", "OM", "PS", "QA", "SA", "SO", "SD", "SY", "TN", "AE", "YE",
}


def load_db(db_dir):
    channels = {}
    with open(os.path.join(db_dir, "data", "channels.csv"), encoding="utf-8") as f:
        for row in csv.DictReader(f):
            channels[row["id"]] = row
    arabic_feeds = defaultdict(set)  # channel id -> feed ids that speak Arabic
    with open(os.path.join(db_dir, "data", "feeds.csv"), encoding="utf-8") as f:
        for row in csv.DictReader(f):
            langs = set(filter(None, row["languages"].split(";")))
            if "ara" in langs:
                arabic_feeds[row["channel"]].add(row["id"])
    return channels, arabic_feeds


def is_arabic(xmltv_id, lang, channels, arabic_feeds):
    if lang and lang.lower().startswith("ar"):
        return True
    if not xmltv_id:
        return False
    cid = xmltv_id.split("@", 1)[0]
    ch = channels.get(cid)
    if ch is None:
        return False
    if ch.get("closed"):
        return False
    if ch.get("is_nsfw", "").upper() == "TRUE":
        return False
    if ch["country"] in ARAB_COUNTRIES:
        return True
    if cid in arabic_feeds:
        return True
    return False


def write_channels(path, entries):
    with open(path, "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<channels>\n')
        for site, attrs, name in entries:
            order = ["site", "lang", "xmltv_id", "site_id"]
            keys = order + [k for k in attrs if k not in order]
            a = " ".join(f"{k}={quoteattr(attrs[k])}" for k in keys if k in attrs)
            f.write(f"  <channel {a}>{escape(name)}</channel>\n")
        f.write("</channels>\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epg", required=True)
    ap.add_argument("--db", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--report")
    ap.add_argument("--shards", type=int, default=0,
                    help="also split the list into N files (by site) for parallel grabbing")
    ap.add_argument("--shard-dir", default="shards")
    ap.add_argument("--exclude-sites", default="",
                    help="comma separated list of sites to skip")
    args = ap.parse_args()

    channels, arabic_feeds = load_db(args.db)
    excluded = set(filter(None, args.exclude_sites.split(",")))

    entries = []          # (site, attrs, name)
    seen = set()
    per_site = defaultdict(int)
    ids = set()

    files = sorted(glob.glob(os.path.join(args.epg, "sites", "*", "*.channels.xml")))
    for path in files:
        try:
            root = ET.parse(path).getroot()
        except ET.ParseError as e:
            print(f"skip {path}: {e}", file=sys.stderr)
            continue
        for el in root.iter("channel"):
            site = el.get("site")
            if not site or site in excluded:
                continue
            xmltv_id = el.get("xmltv_id", "")
            lang = el.get("lang", "")
            if not is_arabic(xmltv_id, lang, channels, arabic_feeds):
                continue
            # entries without an xmltv_id can't be matched by players: skip
            if not xmltv_id:
                continue
            key = (site, el.get("site_id"), xmltv_id, lang)
            if key in seen:
                continue
            seen.add(key)
            entries.append((site, dict(el.attrib), (el.text or "").strip()))
            per_site[site] += 1
            ids.add(xmltv_id)

    entries.sort(key=lambda e: (e[1].get("xmltv_id", ""), e[0]))
    write_channels(args.out, entries)

    if args.shards > 0:
        # greedy bin packing: biggest sites first into the lightest shard,
        # a site is never split so each grab run writes complete per-site files
        bins = [[] for _ in range(args.shards)]
        load = [0] * args.shards
        for site, n in sorted(per_site.items(), key=lambda x: -x[1]):
            i = load.index(min(load))
            bins[i].append(site)
            load[i] += n
        os.makedirs(args.shard_dir, exist_ok=True)
        for i, sites in enumerate(bins):
            sset = set(sites)
            write_channels(os.path.join(args.shard_dir, f"shard{i}.channels.xml"),
                           [e for e in entries if e[0] in sset])
            print(f"shard{i}: {load[i]} entries, sites: {', '.join(sorted(sites))}")

    print(f"{len(entries)} entries, {len(ids)} unique channels, {len(per_site)} sites")

    if args.report:
        with open(args.report, "w", encoding="utf-8") as f:
            f.write(f"# Arabic channel sources\n\n")
            f.write(f"- Entries: **{len(entries)}**\n- Unique channels: **{len(ids)}**\n"
                    f"- Sites: **{len(per_site)}**\n\n| Site | Entries |\n|---|---:|\n")
            for s, n in sorted(per_site.items(), key=lambda x: -x[1]):
                f.write(f"| {s} | {n} |\n")


if __name__ == "__main__":
    main()
