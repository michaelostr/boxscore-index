# Boxscore Index

A lightweight Baseball Reference-style MLB stats site with current-season player search, qualified batting leaders, qualified pitching tables, and compact player pages.

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
