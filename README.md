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

Player pages load MLB regular-season, season-by-season batting and pitching history along with career totals. Traded seasons include MLB's official combined totals followed by team stints. Historical WAR is displayed only when that season has a saved official snapshot; team stints do not repeat full-season WAR.

Season summaries show only key statistics and verified wRC+ when available, without an estimate fallback. Each history table ends with MLB's official cumulative career row. Career WAR is summed once per season only when all seasons in that history have saved values; incomplete coverage displays a dash.

Season-by-season leader values are bold and colored red for AL, blue for NL, or gold for MLB, with a color key at the bottom of the player page. There are no leader superscripts or hover tooltips, and the top season summary stays unmarked. Gold takes precedence; tied leaders are all highlighted. MLB's official leader feeds supply batting R, H, 2B, 3B, HR, RBI, SB, BB, AVG, OBP, SLG, OPS and pitching W, SV, IP, SO, ERA, WHIP. Rate statistics use the qualified pool; counting statistics use all players. MLB handles lower-is-better pitching rates and cross-league traded-player splits. Career totals and team-stint rows are never marked. Saved WAR snapshots support MLB-wide WAR leaders only, without inferring league WAR from current teams. Unsupported statistics remain unmarked.

Leader feeds load automatically when player history loads. Results are cached in the browser for five minutes for the current year and 30 days for past years. Failed feeds leave their statistics unmarked. Run `node scripts/test_player_leaders.cjs` for display checks, or add `--live` to check MLB's live rankings.

## Statcast Profiles

Player pages read `data/statcast.js`, keyed by season and MLB player ID, and display only run values and their leaderboard percentiles. When no official run-value percentile is supplied, the page calculates a midpoint rank within that metric's saved leaderboard and labels it as a leaderboard percentile. These ranks may differ from Savant's player-profile percentiles because the qualifying populations can differ. Missing data is shown as a dash, and older saved data is identified on the page.

The Update Statcast workflow downloads and validates Savant exports every six hours on the default branch. You can also run it from GitHub's Actions tab and select a season. Downloads are automatic; no manual CSV exports are needed. Each failed feed retains its previous successful snapshot and timestamp. A completely failed update fails the workflow without changing saved data.

For a local update on a machine with network access:

```powershell
python scripts/update_statcast.py --season 2026
```

Run updater tests with `python scripts/test_statcast.py`.

## Wins Above Replacement

Season stats show FanGraphs fWAR and Baseball-Reference bWAR separately for batting and pitching. The home batting table also uses the saved FanGraphs values. These are provider values, not local estimates, matched using verified MLB IDs. Batting WAR and pitching WAR are separate contributions for two-way players, not a combined total.

The Update WAR workflow fetches both providers every six hours. Each successful source has its own timestamp in `data/war.js`; failed downloads preserve the previous values. Missing values display as a dash, including when a player has no entry for the selected season. GitHub runners successfully retrieved all four feeds in the initial access test; local access may still be blocked by the providers.

Run locally with `python scripts/update_war.py --season 2026`, and test with `python scripts/test_war.py`.

