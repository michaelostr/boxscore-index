"""Download official seasonal WAR, preserving each source on failure."""
import argparse
import csv
import json
import math
import sys
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "war.js"
PREFIX = "window.WAR_DATA = "


def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (ValueError, TypeError):
        return None


def get(url):
    request = Request(url, headers={"User-Agent": "BoxscoreIndex/1.0", "Accept": "application/json,text/csv,*/*"})
    with urlopen(request, timeout=45) as response:
        return response.read().decode("utf-8-sig")


def normalize(rows, season, source):
    grouped = {}
    for original in rows:
        row = {str(k).lower(): v for k, v in original.items() if k is not None}
        year = number(row.get("year_id", row.get("season", row.get("year"))))
        if year is not None and year != season:
            continue
        pid = next((number(row.get(key)) for key in ("mlb_id", "xmlbamid", "mlbamid", "mlbid") if number(row.get(key)) is not None), None)
        value = number(row.get("war"))
        if pid is None or pid <= 0 or pid != int(pid) or value is None:
            continue
        key = str(int(pid))
        stint = number(row.get("stint_id"))
        team = str(row.get("team_id", row.get("team", ""))).upper()
        total = stint == 0 or team in ("TOT", "TOTAL", "2TM", "3TM", "4TM", "- - -")
        grouped.setdefault(key, []).append((total, value))
    result = {}
    for pid, values in grouped.items():
        totals = [value for total, value in values if total]
        if len(totals) > 1 or (source == "fwar" and len(values) > 1):
            raise ValueError(f"Ambiguous duplicate WAR for player {pid}")
        result[pid] = round(totals[0] if totals else sum(value for _, value in values), 4)
    if not result:
        raise ValueError("No WAR values with verified MLB IDs for the requested season")
    return result


def fangraphs(season, role, fetch=get):
    params = {"age": "", "pos": "all", "stats": role, "lg": "all", "qual": "0", "season": season, "season1": season,
              "startdate": "", "enddate": "", "month": "0", "hand": "", "team": "0", "pageitems": "10000", "pagenum": "1",
              "ind": "0", "rost": "0", "players": "", "type": "8", "postseason": "", "sortdir": "desc", "sortstat": "WAR"}
    url = "https://www.fangraphs.com/api/leaders/major-league/data?" + urlencode(params)
    payload = json.loads(fetch(url))
    rows = payload.get("data", payload.get("leaders", []))
    if not isinstance(rows, list) or not rows:
        raise ValueError("No FanGraphs leaderboard rows")
    if len(rows) >= 10000:
        raise ValueError("FanGraphs results may be truncated")
    print(f"FanGraphs {role} columns: {list(rows[0])}")
    return normalize(rows, season, "fwar"), url


def baseball_reference(season, role, fetch=get):
    url = f"https://www.baseball-reference.com/data/war_daily_{role}.txt"
    text = fetch(url)
    if text.lstrip().startswith("<"):
        raise ValueError("Baseball-Reference returned HTML instead of WAR data")
    rows = list(csv.DictReader(StringIO(text)))
    if rows:
        print(f"Baseball-Reference {role} columns: {list(rows[0])}")
    return normalize(rows, season, "bwar"), url


def update(season, path=OUT, fetch=get):
    if path.exists():
        text = path.read_text(encoding="utf-8")
        if not text.startswith(PREFIX):
            raise ValueError("Invalid saved WAR snapshot")
        payload = json.loads(text[len(PREFIX):].strip().removesuffix(";"))
    else:
        payload = {"seasons": {}}
    sources = payload.setdefault("seasons", {}).setdefault(str(season), {}).setdefault("sources", {})
    successes = 0
    for name, loader, role in (("fwarBatting", fangraphs, "bat"), ("fwarPitching", fangraphs, "pit"),
                               ("bwarBatting", baseball_reference, "bat"), ("bwarPitching", baseball_reference, "pitch")):
        try:
            players, url = loader(season, role, fetch)
            sources[name] = {"players": players, "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "url": url}
            successes += 1
            print(f"{name}: {len(players)} players")
        except Exception as error:
            print(f"{name}: {error}; previous values retained", file=sys.stderr)
    if successes:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(PREFIX + json.dumps(payload, separators=(",", ":"), allow_nan=False) + ";\n", encoding="utf-8")
        temporary.replace(path)
    return successes


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", type=int, default=datetime.now(timezone.utc).year)
    args = parser.parse_args()
    sys.exit(0 if update(args.season) else 1)

