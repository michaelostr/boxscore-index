# Boxscore Index

A lightweight Baseball Reference-style MLB stats site with current-season player search, sortable qualified batting and pitching tables, and compact player pages.

## What It Uses

- MLB.com public stats feeds for current hitting, pitching, standings, player bio, and career lines
- `pybaseball` scripts for local stat snapshots where available
- Static HTML, CSS, and JavaScript

## Updating Local Snapshots

Install dependencies:

```powershell
pip install -r requirements.txt
```

Update the local MLB batting snapshot:

```powershell
python scripts/update_mlb_stats.py --season 2026
```

The site will try live MLB.com data first in the browser, then use local snapshots as a fallback.

## Statcast Profiles

Player pages read `data/statcast.js`, keyed by season and MLB player ID. The snapshot stores official Savant percentiles separately from metric values and run values. Missing data is shown as a dash, and older saved data is identified on the page.

The Update Statcast workflow downloads and validates Savant exports every six hours on the default branch. You can also run it from GitHub's Actions tab and select a season. Downloads are automatic; no manual CSV exports are needed. Each failed feed retains its previous successful snapshot and timestamp. A completely failed update fails the workflow without changing saved data.

For a local update on a machine with network access:

```powershell
python scripts/update_statcast.py --season 2026
```

Run updater tests with `python scripts/test_statcast.py`.
