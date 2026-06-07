import argparse
import json
from io import StringIO
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

import pandas as pd
import requests


ROOT = Path(__file__).resolve().parents[1]
OUTFILE = ROOT / "data" / "advanced_batting.js"

FANGRAPHS_API_URL = "https://www.fangraphs.com/api/leaders/major-league/data"
FANGRAPHS_LEGACY_URL = "https://www.fangraphs.com/leaders-legacy.aspx"
FANGRAPHS_COLUMNS = ",".join(["c", "-1", *[str(index) for index in range(3, 319)]])
REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.fangraphs.com/leaders/major-league",
}


def clean_number(value):
    try:
        if value != value:
            return None
        return float(str(value).replace("%", "").strip())
    except (TypeError, ValueError):
        return None


def clean_int(value):
    number = clean_number(value)
    return int(round(number)) if number is not None else None


def first_column(frame, *names):
    normalized = {str(column).strip().lower(): column for column in frame.columns}
    for name in names:
        column = normalized.get(name.lower())
        if column is not None:
            return column
    return None


def fangraphs_url(season):
    params = {
        "pos": "all",
        "stats": "bat",
        "lg": "all",
        "qual": "0",
        "type": FANGRAPHS_COLUMNS,
        "season": str(season),
        "month": "0",
        "season1": str(season),
        "ind": "1",
        "team": "",
        "rost": "0",
        "age": "0,100",
        "filter": "",
        "players": "",
        "page": "1_1000000",
    }
    query = "&".join(f"{key}={value}" for key, value in params.items())
    return f"{FANGRAPHS_LEGACY_URL}?{query}"


def fangraphs_api_params(season):
    return {
        "age": "",
        "pos": "all",
        "stats": "bat",
        "lg": "all",
        "qual": "0",
        "season": str(season),
        "season1": str(season),
        "startdate": "",
        "enddate": "",
        "month": "0",
        "hand": "",
        "team": "0",
        "pageitems": "10000",
        "pagenum": "1",
        "ind": "0",
        "rost": "0",
        "players": "",
        "type": "1",
        "postseason": "",
        "sortdir": "default",
        "sortstat": "wRC+",
    }


def load_fangraphs_api_frame(season):
    response = requests.get(
        FANGRAPHS_API_URL,
        params=fangraphs_api_params(season),
        headers=REQUEST_HEADERS,
        timeout=30,
    )
    if response.status_code == 403:
        raise RuntimeError("FanGraphs API returned 403 Forbidden.")
    response.raise_for_status()
    payload = response.json()
    rows = payload.get("data") or payload.get("leaders") or []
    frame = pd.DataFrame(rows)
    if frame.empty or not first_column(frame, "wRC+"):
        raise RuntimeError("FanGraphs API response did not include wRC+ data.")
    return frame


def load_fangraphs_frame(season):
    response = requests.get(fangraphs_url(season), headers=REQUEST_HEADERS, timeout=30)
    if response.status_code == 403:
        raise RuntimeError(
            "FanGraphs returned 403 Forbidden. Open fangraphs.com in a browser, "
            "then retry; if it still fails, FanGraphs is blocking scripted requests "
            "from this network."
        )
    response.raise_for_status()
    tables = pd.read_html(StringIO(response.text))
    candidates = [
        table for table in tables
        if first_column(table, "Name", "Player") and first_column(table, "wRC+")
    ]
    if not candidates:
        raise RuntimeError("FanGraphs leaderboard did not include a wRC+ table.")
    return candidates[0]


def load_csv_frame(path):
    csv_path = Path(path).expanduser()
    if not csv_path.is_absolute():
        csv_path = (ROOT / csv_path).resolve()
    if not csv_path.exists():
        raise FileNotFoundError(f"Could not find CSV file: {csv_path}")
    frame = pd.read_csv(csv_path)
    if not first_column(frame, "Name", "Player") or not first_column(frame, "wRC+"):
        raise RuntimeError("CSV must include player Name/Player and wRC+ columns.")
    return frame


def build_players(frame):
    name_column = first_column(frame, "Name", "Player")
    name_column = name_column or first_column(frame, "PlayerName", "playerName")
    mlb_id_column = first_column(frame, "xMLBAMID", "MLBAMID", "mlbID", "MLBID")
    team_column = first_column(frame, "Team")
    team_column = team_column or first_column(frame, "TeamNameAbb", "TeamNameAbbrev", "team_name_abb")
    wrc_column = first_column(frame, "wRC+")
    pa_column = first_column(frame, "PA")
    players = []
    for row in frame.to_dict("records"):
        name = str(row.get(name_column, "")).strip()
        wrc = clean_int(row.get(wrc_column))
        if not name or wrc is None:
            continue
        players.append({
            "name": name,
            "mlbId": clean_int(row.get(mlb_id_column)) if mlb_id_column else None,
            "teamAbbr": str(row.get(team_column, "")).strip() if team_column else "",
            "pa": clean_int(row.get(pa_column)) if pa_column else None,
            "wrc": wrc,
        })
    return players


def main():
    parser = argparse.ArgumentParser(description="Generate FanGraphs wRC+ snapshot.")
    parser.add_argument("--season", type=int, default=datetime.now().year)
    parser.add_argument(
        "--csv",
        help="Path to a manually exported FanGraphs batting leaderboard CSV. Skips web fetch.",
    )
    args = parser.parse_args()

    if args.csv:
        frame = load_csv_frame(args.csv)
        source = "FanGraphs batting leaderboard CSV"
    else:
        try:
            frame = load_fangraphs_api_frame(args.season)
            source = f"FanGraphs API {FANGRAPHS_API_URL}?{urlencode(fangraphs_api_params(args.season))}"
        except Exception as api_error:
            try:
                frame = load_fangraphs_frame(args.season)
                source = "FanGraphs batting leaderboard HTML"
            except Exception as html_error:
                raise RuntimeError(
                    "Could not fetch FanGraphs wRC+ automatically. "
                    f"API error: {api_error}. HTML error: {html_error}. "
                    "Use --csv as a fallback."
                ) from html_error
    payload = {
        "season": args.season,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "players": build_players(frame),
    }
    OUTFILE.write_text(
        "window.ADVANCED_BATTING_DATA = "
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )
    print(f"Wrote {OUTFILE} with {len(payload['players'])} players")


if __name__ == "__main__":
    main()
