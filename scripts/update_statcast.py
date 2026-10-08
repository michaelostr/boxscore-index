"""Cache Savant leaderboards without replacing good data on failed downloads."""
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
OUT = ROOT / "data" / "statcast.js"
PREFIX = "window.STATCAST_DATA = "
METRICS = {
    "xwoba": ("xwoba", "est_woba"),
    "xba": ("xba", "est_ba"),
    "xslg": ("xslg", "est_slg"),
    "xera": ("xera", "est_era"),
    "exitVelocity": ("exit_velocity_avg", "exit_velocity", "avg_hit_speed"),
    "hardHit": ("hard_hit_percent", "hard_hit_rate", "ev95percent"),
    "barrel": ("barrel_batted_rate", "brl_percent"),
    "strikeout": ("k_percent", "strikeout_percent"),
    "walk": ("bb_percent", "walk_percent"),
    "whiff": ("whiff_percent",),
    "chase": ("chase_percent", "oz_swing_percent"),
    "sprintSpeed": ("sprint_speed",),
    "batSpeed": ("bat_speed", "avg_bat_speed"),
    "oaa": ("oaa", "outs_above_average"),
    "armStrength": ("arm_strength",),
    "pitchingRunValue": ("pitching_run_value", "p_run_value"),
    "battingRunValue": ("batting_run_value", "b_run_value"),
    "fieldingRunValue": ("fielding_run_value", "f_run_value"),
    "baserunningRunValue": ("baserunning_run_value", "r_run_value"),
}


def number(value):
    try:
        result = float(str(value).strip().rstrip("%"))
        return result if math.isfinite(result) else None
    except (ValueError, TypeError):
        return None


def pick(row, names):
    for name in names:
        value = number(row.get(name))
        if value is not None:
            return value
    return None


def normalize(rows, kind):
    players = {}
    for original in rows:
        row = {str(k).strip().lower(): v for k, v in original.items() if k is not None}
        pid = pick(row, ("player_id", "playerid", "entity_id", "entityid", "mlb_id", "id"))
        if pid is None or pid <= 0 or pid == 999999 or pid != int(pid):
            continue
        metrics = {}
        if kind == "percentiles":
            for key, aliases in METRICS.items():
                value = pick(row, tuple("percentile_" + alias for alias in aliases) + aliases)
                if value is not None and 0 <= value <= 100:
                    metrics[key] = value
        elif kind in ("expected", "contact", "speed"):
            keys = {"expected": ("xwoba", "xba", "xslg", "xera"), "contact": ("exitVelocity", "hardHit", "barrel"), "speed": ("sprintSpeed",)}[kind]
            for key in keys:
                value = pick(row, METRICS[key])
                maximum = 1 if key in ("xwoba", "xba", "xslg") else 150
                if value is not None and 0 <= value <= maximum:
                    metrics[key] = value
        else:
            aliases = {
                "batting": ("runs_all", "run_value", "all", "batting_run_value"),
                "pitching": ("runs_all", "run_value", "all", "pitching_run_value"),
                "fielding": ("total_runs", "fielding_run_value", "total_fielding_run_value"),
                "baserunning": ("runner_runs_tot", "baserunning_run_value"),
            }[kind]
            value = pick(row, aliases)
            if value is not None:
                metrics[kind + "RunValue"] = value
        if metrics:
            key = str(int(pid))
            if key in players:
                raise ValueError(f"Duplicate player {key}; feed may contain splits")
            players[key] = metrics
    if not players:
        raise ValueError("No recognized player/metric columns; saved data retained")
    return players


def feeds(season):
    return {
        "batterPercentiles": ("percentile-rankings", {"type": "batter", "year": season}, "percentiles"),
        "pitcherPercentiles": ("percentile-rankings", {"type": "pitcher", "year": season}, "percentiles"),
        "batterExpected": ("expected_statistics", {"type": "batter", "year": season, "position": "", "team": "", "min": 1}, "expected"),
        "pitcherExpected": ("expected_statistics", {"type": "pitcher", "year": season, "position": "", "team": "", "min": 1}, "expected"),
        "batterContact": ("statcast", {"type": "batter", "year": season, "position": "", "team": "", "min": 1}, "contact"),
        "pitcherContact": ("statcast", {"type": "pitcher", "year": season, "position": "", "team": "", "min": 1}, "contact"),
        "speed": ("sprint_speed", {"year": season, "position": "", "team": "", "min": 1}, "speed"),
        "batting": ("swing-take", {"group": "Batter", "type": "All", "year": season}, "batting"),
        "pitching": ("swing-take", {"group": "Pitcher", "type": "All", "year": season}, "pitching"),
        "fielding": ("fielding-run-value", {"seasonStart": season, "seasonEnd": season}, "fielding"),
        "baserunning": ("baserunning-run-value", {"season_start": season, "season_end": season, "type": "Run", "game_type": "Regular", "n": 1}, "baserunning"),
    }


def download(url):
    request = Request(url, headers={"User-Agent": "BoxscoreIndex/1.0", "Accept": "text/csv"})
    with urlopen(request, timeout=30) as response:
        text = response.read().decode("utf-8-sig")
    if text.lstrip().startswith("<"):
        raise ValueError("Received HTML instead of CSV")
    return list(csv.DictReader(StringIO(text)))


def load_snapshot(path):
    if not path.exists():
        return {"seasons": {}}
    text = path.read_text(encoding="utf-8")
    if not text.startswith(PREFIX):
        raise ValueError("Invalid snapshot wrapper")
    return json.loads(text[len(PREFIX):].strip().removesuffix(";"))


def update(season, path=OUT, fetch=download):
    payload = load_snapshot(path)
    sources = payload.setdefault("seasons", {}).setdefault(str(season), {}).setdefault("sources", {})
    succeeded = 0
    for name, (endpoint, params, kind) in feeds(season).items():
        url = "https://baseballsavant.mlb.com/leaderboard/" + endpoint + "?" + urlencode({**params, "csv": "true"})
        try:
            rows = fetch(url)
            if rows:
                print(f"{name} columns: {', '.join(str(key) for key in rows[0])}")
                if name == "fielding":
                    print(f"fielding first row: {json.dumps(rows[0])}")
            # Reject a different-season export rather than relabeling it.
            for row in rows:
                year = pick(row, ("year", "season"))
                if year is not None and year != season:
                    raise ValueError("Response contains a different season")
            players = normalize(rows, kind)
            sources[name] = {"updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "url": url, "players": players}
            succeeded += 1
            print(f"{name}: {len(players)} players")
            if "691718" in players:
                print(f"{name} example: {json.dumps(players['691718'])}")
        except Exception as error:
            print(f"{name}: {error} (previous data retained)", file=sys.stderr)
    if succeeded:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(PREFIX + json.dumps(payload, ensure_ascii=True, allow_nan=False, separators=(",", ":")) + ";\n", encoding="utf-8")
        temporary.replace(path)
    return succeeded


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", type=int, default=datetime.now(timezone.utc).year)
    args = parser.parse_args()
    sys.exit(0 if update(args.season) else 1)
