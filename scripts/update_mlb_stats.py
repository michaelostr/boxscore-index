import argparse
import json
import codecs
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

try:
    from pybaseball import batting_stats, batting_stats_bref, standings
except ImportError as exc:
    raise SystemExit(
        "pybaseball is not installed. Run: python -m pip install -r requirements.txt"
    ) from exc


ROOT = Path(__file__).resolve().parents[1]
OUTFILE = ROOT / "data" / "mlb_stats.js"
MLB_API = "https://statsapi.mlb.com/api/v1"

TEAM_NAMES = {
    "TOT": "Multiple Teams",
    "ARI": "Arizona Diamondbacks",
    "ATL": "Atlanta Braves",
    "BAL": "Baltimore Orioles",
    "BOS": "Boston Red Sox",
    "CHC": "Chicago Cubs",
    "CHW": "Chicago White Sox",
    "CIN": "Cincinnati Reds",
    "CLE": "Cleveland Guardians",
    "COL": "Colorado Rockies",
    "DET": "Detroit Tigers",
    "HOU": "Houston Astros",
    "KC": "Kansas City Royals",
    "LAA": "Los Angeles Angels",
    "LAD": "Los Angeles Dodgers",
    "MIA": "Miami Marlins",
    "MIL": "Milwaukee Brewers",
    "MIN": "Minnesota Twins",
    "NYM": "New York Mets",
    "NYY": "New York Yankees",
    "OAK": "Athletics",
    "ATH": "Athletics",
    "PHI": "Philadelphia Phillies",
    "PIT": "Pittsburgh Pirates",
    "SD": "San Diego Padres",
    "SEA": "Seattle Mariners",
    "SF": "San Francisco Giants",
    "STL": "St. Louis Cardinals",
    "TB": "Tampa Bay Rays",
    "TEX": "Texas Rangers",
    "TOR": "Toronto Blue Jays",
    "WSH": "Washington Nationals",
}

TEAM_NAME_TO_CODE = {
    "Arizona": "ARI",
    "Arizona Diamondbacks": "ARI",
    "Atlanta": "ATL",
    "Atlanta Braves": "ATL",
    "Baltimore": "BAL",
    "Baltimore Orioles": "BAL",
    "Boston": "BOS",
    "Boston Red Sox": "BOS",
    "Chicago": "CHC",
    "Chicago Cubs": "CHC",
    "Chicago White Sox": "CHW",
    "Cincinnati": "CIN",
    "Cincinnati Reds": "CIN",
    "Cleveland": "CLE",
    "Cleveland Guardians": "CLE",
    "Colorado": "COL",
    "Colorado Rockies": "COL",
    "Detroit": "DET",
    "Detroit Tigers": "DET",
    "Houston": "HOU",
    "Houston Astros": "HOU",
    "Kansas City": "KC",
    "Kansas City Royals": "KC",
    "Los Angeles": "LAD",
    "Los Angeles Angels": "LAA",
    "Los Angeles Dodgers": "LAD",
    "Miami": "MIA",
    "Miami Marlins": "MIA",
    "Milwaukee": "MIL",
    "Milwaukee Brewers": "MIL",
    "Minnesota": "MIN",
    "Minnesota Twins": "MIN",
    "New York": "NYY",
    "New York Yankees": "NYY",
    "New York Mets": "NYM",
    "Oakland": "OAK",
    "Athletics": "ATH",
    "Philadelphia": "PHI",
    "Philadelphia Phillies": "PHI",
    "Pittsburgh": "PIT",
    "Pittsburgh Pirates": "PIT",
    "San Diego": "SD",
    "San Diego Padres": "SD",
    "San Francisco": "SF",
    "San Francisco Giants": "SF",
    "Seattle": "SEA",
    "Seattle Mariners": "SEA",
    "St. Louis": "STL",
    "St. Louis Cardinals": "STL",
    "Tampa Bay": "TB",
    "Tampa Bay Rays": "TB",
    "Texas": "TEX",
    "Texas Rangers": "TEX",
    "Toronto": "TOR",
    "Toronto Blue Jays": "TOR",
    "Washington": "WSH",
    "Washington Nationals": "WSH",
}

TEAM_COLORS = ["#315f8c", "#b54a2f", "#1f7a56", "#d9a441", "#496b5e", "#8f3d52"]


def clean_number(value, default=0):
    try:
        if value != value:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def clean_int(value):
    return int(round(clean_number(value)))


def clean_text(value):
    text = str(value).strip()
    if "\\x" not in text:
        return text
    try:
        decoded = codecs.decode(text, "unicode_escape")
        return decoded.encode("latin1").decode("utf-8")
    except (UnicodeDecodeError, UnicodeEncodeError):
        return text


def normalize_team_code(value, league_hint=""):
    raw = str(value).strip()
    if "," in raw:
        return "TOT"
    if raw in {"Chicago", "New York", "Los Angeles"}:
        if "AL" in str(league_hint):
            return {"Chicago": "CHW", "New York": "NYY", "Los Angeles": "LAA"}[raw]
        if "NL" in str(league_hint):
            return {"Chicago": "CHC", "New York": "NYM", "Los Angeles": "LAD"}[raw]
    code = raw.upper()
    if len(code) > 3:
        return TEAM_NAME_TO_CODE.get(raw, code[:3])
    return {"WSN": "WSH", "KCR": "KC", "TBR": "TB", "SDP": "SD", "SFG": "SF"}.get(code, code)


def chunks(values, size):
    for index in range(0, len(values), size):
        yield values[index : index + size]


def fetch_player_positions(player_ids):
    positions = {}
    ids = [str(player_id) for player_id in player_ids if str(player_id).strip()]
    for group in chunks(sorted(set(ids)), 100):
        query = urlencode({"personIds": ",".join(group)})
        with urlopen(f"{MLB_API}/people?{query}", timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))
        for person in data.get("people", []):
            position = person.get("primaryPosition", {})
            abbreviation = position.get("abbreviation") or position.get("code")
            if abbreviation:
                positions[str(person.get("id"))] = abbreviation
    return positions


def build_players(season, limit, min_pa):
    source = "pybaseball FanGraphs batting_stats"
    try:
        frame = batting_stats(season, season, qual=0)
        average_column = "AVG"
    except Exception:
        frame = batting_stats_bref(season)
        source = "pybaseball Baseball Reference batting_stats_bref"
        average_column = "BA"

    if "PA" in frame.columns:
        frame = frame[frame["PA"] >= min_pa]

    sort_columns = [column for column in ["WAR", "OPS", "PA"] if column in frame.columns]
    if sort_columns:
        frame = frame.sort_values(sort_columns, ascending=[False] * len(sort_columns))
    if limit > 0:
        frame = frame.head(limit)
    players = []
    for row in frame.to_dict("records"):
        team = normalize_team_code(row.get("Team", ""), row.get("Lev", ""))
        if not team or team == "NON":
            team = normalize_team_code(row.get("Tm", ""), row.get("Lev", ""))
        name = clean_text(row.get("Name", ""))
        if not name or team in {"", "- - -"}:
            continue
        players.append(
            {
                "id": f"{name}-{team}-{season}",
                "name": name,
                "mlbId": clean_int(row.get("mlbID")),
                "team": team,
                "teamAbbr": team,
                "pos": str(row.get("Pos", "")).split("/")[0] if row.get("Pos") else "",
                "g": clean_int(row.get("G")),
                "pa": clean_int(row.get("PA")),
                "ab": clean_int(row.get("AB")),
                "avg": round(clean_number(row.get(average_column)), 3),
                "obp": round(clean_number(row.get("OBP")), 3),
                "slg": round(clean_number(row.get("SLG")), 3),
                "ops": round(clean_number(row.get("OPS")), 3),
                "hr": clean_int(row.get("HR")),
                "rbi": clean_int(row.get("RBI")),
                "sb": clean_int(row.get("SB")),
                "fwar": round(clean_number(row.get("WAR")), 1) if "WAR" in row else None,
                "war": round(clean_number(row.get("WAR")), 1) if "WAR" in row else None,
                "hits": clean_int(row.get("H")),
                "doubles": clean_int(row.get("2B")),
                "triples": clean_int(row.get("3B")),
                "runs": clean_int(row.get("R")),
                "bb": clean_int(row.get("BB")),
                "so": clean_int(row.get("SO")),
                "note": f"{source} season batting snapshot.",
            }
        )

    positions = fetch_player_positions([player["mlbId"] for player in players])
    for player in players:
        player["pos"] = positions.get(str(player["mlbId"])) or player["pos"] or "-"
    return players, source


def build_teams(season, players):
    teams_by_code = {}
    try:
        tables = standings(season)
    except Exception:
        tables = []

    for division_index, table in enumerate(tables):
        league = "AL" if division_index < 3 else "NL"
        for row in table.to_dict("records"):
            code = normalize_team_code(row.get("Tm") or row.get("Team") or "", league)
            if not code:
                continue
            wins = clean_int(row.get("W"))
            losses = clean_int(row.get("L"))
            teams_by_code[code] = {
                "id": code,
                "abbr": code,
                "name": TEAM_NAMES.get(code, code),
                "league": league,
                "record": f"{wins}-{losses}",
                "runs": clean_int(row.get("R")),
                "era": 0,
                "winPct": round(clean_number(row.get("W-L%")), 3),
                "color": TEAM_COLORS[len(teams_by_code) % len(TEAM_COLORS)],
            }

    for player in players:
        code = player["team"]
        teams_by_code.setdefault(
            code,
            {
                "id": code,
                "abbr": code,
                "name": TEAM_NAMES.get(code, code),
                "league": "MLB",
                "record": "0-0",
                "runs": 0,
                "era": 0,
                "winPct": 0,
                "color": TEAM_COLORS[len(teams_by_code) % len(TEAM_COLORS)],
            },
        )

    return list(teams_by_code.values())


def main():
    parser = argparse.ArgumentParser(description="Build a local MLB stats snapshot for Boxscore Index.")
    parser.add_argument("--season", type=int, default=datetime.now().year)
    parser.add_argument("--limit", type=int, default=0, help="Maximum hitters to include. Use 0 for all.")
    parser.add_argument("--min-pa", type=int, default=0)
    args = parser.parse_args()

    players, source = build_players(args.season, args.limit, args.min_pa)
    teams = build_teams(args.season, players)
    payload = {
        "season": args.season,
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": source,
        "players": players,
        "teams": teams,
    }

    OUTFILE.parent.mkdir(parents=True, exist_ok=True)
    OUTFILE.write_text(
        "window.MLB_STATS_DATA = "
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(players)} players and {len(teams)} teams to {OUTFILE}")


if __name__ == "__main__":
    main()
