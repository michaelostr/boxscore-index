import argparse
import csv
import json
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]
OUTFILE = ROOT / "data" / "savant_run_values.js"
SEASON = datetime.now().year

SAVANT_URLS = {
    "batting": [
        f"https://baseballsavant.mlb.com/leaderboard/swing-take?group=Batter&type=All&year={SEASON}&csv=true",
        f"https://baseballsavant.mlb.com/swing-take?group=Batter&type=All&year={SEASON}&csv=true",
    ],
    "fielding": [
        f"https://baseballsavant.mlb.com/leaderboard/fielding-run-value?year={SEASON}&csv=true",
        f"https://baseballsavant.mlb.com/leaderboard/fielding-run-value?start_year={SEASON}&end_year={SEASON}&csv=true",
        "https://baseballsavant.mlb.com/leaderboard/fielding-run-value?csv=true",
    ],
    "baserunning": [
        f"https://baseballsavant.mlb.com/leaderboard/baserunning-run-value?game_type=Regular&start_year={SEASON}&end_year={SEASON}&csv=true",
        f"https://baseballsavant.mlb.com/leaderboard/baserunning-run-value?game_type=Regular&year={SEASON}&csv=true",
        "https://baseballsavant.mlb.com/leaderboard/baserunning-run-value?game_type=Regular&csv=true",
    ],
}


def key_name(value):
    return "".join(ch for ch in str(value).lower() if ch.isalnum())


def normalize_name(value):
    return " ".join(str(value).replace(",", "").split()).lower()


def keyed(row):
    return {key_name(key): value for key, value in row.items()}


def value_from(row, candidates):
    if not row:
        return None
    values = keyed(row)
    for candidate in candidates:
        value = values.get(key_name(candidate))
        if value not in (None, ""):
            try:
                return float(str(value).replace(",", ""))
            except ValueError:
                return None
    return None


def read_csv_file(path):
    csv_path = Path(path).expanduser()
    if not csv_path.is_absolute():
        csv_path = (ROOT / csv_path).resolve()
    if not csv_path.exists():
        raise FileNotFoundError(f"Could not find CSV file: {csv_path}")
    return list(csv.DictReader(StringIO(csv_path.read_text(encoding="utf-8-sig"))))


def fetch_csv(urls):
    last_error = None
    for url in urls:
        try:
            with urlopen(url, timeout=45) as response:
                text = response.read().decode("utf-8", errors="replace")
            if "," not in text or text.lstrip().startswith("<"):
                raise RuntimeError("response was not CSV")
            return list(csv.DictReader(StringIO(text)))
        except Exception as exc:
            last_error = exc
    raise RuntimeError(f"No Savant CSV URL worked: {last_error}")


def player_id(row):
    values = keyed(row)
    for candidate in ("playerid", "entityid", "mlbid", "id"):
        value = values.get(candidate)
        if value:
            return str(value)
    return None


def player_name(row):
    values = keyed(row)
    for candidate in ("player", "name", "playername", "playerfullname"):
        value = values.get(candidate)
        if value:
            return normalize_name(value)
    return None


def player_key(row):
    return player_id(row) or player_name(row)


def merge_metric(players, metric, rows, candidates):
    for row in rows:
        pid = player_key(row)
        if not pid:
            continue
        players.setdefault(pid, {})[metric] = value_from(row, candidates)


def main():
    parser = argparse.ArgumentParser(description="Generate Baseball Savant run value snapshot.")
    parser.add_argument("--season", type=int, default=SEASON)
    parser.add_argument("--batting-csv", help="Local Baseball Savant batting/swing-take CSV export.")
    parser.add_argument("--fielding-csv", help="Local Baseball Savant fielding run value CSV export.")
    parser.add_argument("--baserunning-csv", help="Local Baseball Savant baserunning run value CSV export.")
    parser.add_argument("--no-fetch", action="store_true", help="Only use provided CSV files; do not call Baseball Savant.")
    args = parser.parse_args()

    urls = {
        metric: [url.replace(str(SEASON), str(args.season)) for url in metric_urls]
        for metric, metric_urls in SAVANT_URLS.items()
    }
    players = {}
    merge_metric(
        players,
        "batting",
        read_csv_file(args.batting_csv) if args.batting_csv else ([] if args.no_fetch else fetch_csv(urls["batting"])),
        ("all", "run_value", "run value", "runs", "batting_run_value", "batting run value"),
    )
    merge_metric(
        players,
        "fielding",
        read_csv_file(args.fielding_csv) if args.fielding_csv else ([] if args.no_fetch else fetch_csv(urls["fielding"])),
        ("fielding_run_value", "fielding run value", "run_value", "run value", "runs", "frv", "total"),
    )
    merge_metric(
        players,
        "baserunning",
        read_csv_file(args.baserunning_csv) if args.baserunning_csv else ([] if args.no_fetch else fetch_csv(urls["baserunning"])),
        ("baserunning_run_value", "baserunning run value", "run_value", "run value", "runs", "brv", "total"),
    )
    payload = {
        "season": args.season,
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "Baseball Savant CSV exports" if any([args.batting_csv, args.fielding_csv, args.baserunning_csv]) else "Baseball Savant CSV",
        "players": players,
    }
    OUTFILE.write_text(
        "window.SAVANT_RUN_VALUES_DATA = "
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )
    print(f"Wrote Savant run values for {len(players)} players to {OUTFILE}")


if __name__ == "__main__":
    main()
