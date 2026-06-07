const API_BASE = "https://statsapi.mlb.com/api/v1";
const MLB_STATS_TABLE_BASE = "https://bdfed.stitch.mlbinfra.com/bdfed/stats/player";
const CURRENT_SEASON = new Date().getFullYear();
const DEFAULT_LIMIT = 5000;
const DEFAULT_TABLE_ROWS = 50;

const sampleTeams = [
  { id: "147", abbr: "NYY", name: "New York Yankees", league: "AL", record: "0-0", runs: 0, era: 0, color: "#315f8c" },
  { id: "143", abbr: "PHI", name: "Philadelphia Phillies", league: "NL", record: "0-0", runs: 0, era: 0, color: "#b54a2f" },
  { id: "117", abbr: "HOU", name: "Houston Astros", league: "AL", record: "0-0", runs: 0, era: 0, color: "#d9a441" },
  { id: "119", abbr: "LAD", name: "Los Angeles Dodgers", league: "NL", record: "0-0", runs: 0, era: 0, color: "#315f8c" }
];

const samplePlayers = [
  { id: "656941", name: "Kyle Schwarber", team: "143", teamAbbr: "PHI", pos: "DH", g: 59, pa: 250, avg: .233, obp: .352, slg: .592, ops: .944, hr: 23, rbi: 40, sb: 1, fwar: null, war: null, hits: 52, doubles: 9, triples: 1, runs: 37, bb: 37, so: 90, note: "Sample row shown only when live MLB data cannot load." },
  { id: "670541", name: "Yordan Alvarez", team: "117", teamAbbr: "HOU", pos: "DH", g: 63, pa: 270, avg: .316, obp: .428, slg: .649, ops: 1.077, hr: 21, rbi: 44, sb: 1, fwar: null, war: null, hits: 72, doubles: 13, triples: 0, runs: 41, bb: 41, so: 48, note: "Sample row shown only when live MLB data cannot load." },
  { id: "660271", name: "Shohei Ohtani", team: "119", teamAbbr: "LAD", pos: "DH", g: 60, pa: 265, avg: .290, obp: .385, slg: .590, ops: .975, hr: 18, rbi: 45, sb: 10, fwar: null, war: null, hits: 68, doubles: 12, triples: 2, runs: 50, bb: 35, so: 62, note: "Sample row shown only when live MLB data cannot load." }
];

let teams = [];
let players = [];
let teamById = {};
let qualifiedPlayerIds = null;
let qualifiedPitcherIds = null;

const state = {
  search: "",
  league: "all",
  pos: "all",
  season: CURRENT_SEASON,
  sortKey: "fwar",
  sortDir: "desc",
  tableExpanded: false,
  pitchingExpanded: false,
  usingFallback: false
};

let searchMatches = [];
let activeSearchIndex = -1;

const numberKeys = new Set(["g", "pa", "avg", "obp", "slg", "ops", "hr", "rbi", "sb", "fwar", "war", "hits", "runs"]);

const els = {
  search: document.querySelector("#searchInput"),
  searchForm: document.querySelector("#playerSearchForm"),
  searchDropdown: document.querySelector("#playerSearchDropdown"),
  rows: document.querySelector("#playerRows"),
  resultCount: document.querySelector("#resultCount"),
  toggleRows: document.querySelector("#toggleTableRows"),
  pitcherRows: document.querySelector("#pitcherRows"),
  pitcherResultCount: document.querySelector("#pitcherResultCount"),
  togglePitcherRows: document.querySelector("#togglePitcherRows"),
  teamGrid: document.querySelector("#teamGrid"),
  seasonLabel: document.querySelector("#seasonLabel"),
  dataStatus: document.querySelector("#dataStatus"),
  drawer: document.querySelector("#playerDrawer"),
  drawerContent: document.querySelector("#drawerContent"),
  closeDrawer: document.querySelector("#closeDrawer"),
  scrim: document.querySelector("#scrim")
};

function fmtRate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return numeric.toFixed(3).replace(/^0/, "");
}

function fmtNumber(value, digits = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return numeric.toFixed(digits);
}

function parseRate(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function finiteValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function fwarValue(player) {
  return finiteValue(player?.fwar) ?? finiteValue(player?.war);
}

function fmtFwar(player) {
  const value = fwarValue(player);
  return value == null ? "-" : value.toFixed(1);
}

function statValue(player, key) {
  if (key === "fwar" || key === "war") return fwarValue(player);
  return player?.[key];
}

function inningsToOuts(value) {
  const [whole, partial = "0"] = String(value ?? "0").split(".");
  const innings = Number(whole);
  const outs = Number(partial);
  if (!Number.isFinite(innings) || !Number.isFinite(outs)) return 0;
  return innings * 3 + outs;
}

function hasFwar() {
  return players.some((player) => fwarValue(player) != null);
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function snapshotPlayersByMlbId() {
  const snapshot = window.MLB_STATS_DATA;
  if (!snapshot || Number(snapshot.season) !== state.season || !Array.isArray(snapshot.players)) return new Map();
  return new Map(
    snapshot.players
      .filter((player) => player.mlbId)
      .map((player) => [String(player.mlbId), player])
  );
}

function mergePybaseballStats(playerList) {
  const snapshotById = snapshotPlayersByMlbId();
  if (!snapshotById.size) return playerList;
  return playerList.map((player) => {
    const snapshotPlayer = snapshotById.get(String(player.mlbId ?? player.id));
    if (!snapshotPlayer) return player;
    const fwar = fwarValue(snapshotPlayer);
    return {
      ...player,
      fwar,
      war: fwar,
      note: fwar == null
        ? player.note
        : `${player.note} fWAR from pybaseball FanGraphs batting_stats snapshot.`
    };
  });
}

function teamColor(index) {
  const colors = ["#315f8c", "#b54a2f", "#1f7a56", "#d9a441", "#496b5e", "#8f3d52"];
  return colors[index % colors.length];
}

function apiUrl(path, params) {
  const search = new URLSearchParams(params);
  return `${API_BASE}${path}?${search.toString()}`;
}

async function fetchJson(path, params) {
  const response = await fetch(apiUrl(path, params));
  if (!response.ok) throw new Error(`MLB request failed with ${response.status}`);
  return response.json();
}

async function fetchMlbStatsTable(playerPool, group = "hitting", sortStat = "onBasePlusSlugging") {
  const search = new URLSearchParams({
    stitch_env: "prod",
    season: String(state.season),
    sportId: "1",
    stats: "season",
    group,
    gameType: "R",
    limit: String(DEFAULT_LIMIT),
    offset: "0",
    sortStat,
    order: "desc",
    playerPool
  });
  const response = await fetch(`${MLB_STATS_TABLE_BASE}?${search.toString()}`);
  if (!response.ok) throw new Error(`MLB.com stats table request failed with ${response.status}`);
  return response.json();
}

async function loadMlbData() {
  setLoading(true);
  try {
    const [allStatsData, qualifiedStatsData, pitchingStatsData, qualifiedPitchingStatsData, standingsData] = await Promise.all([
      fetchMlbStatsTable("ALL", "hitting", "onBasePlusSlugging"),
      fetchMlbStatsTable("QUALIFIED", "hitting", "onBasePlusSlugging"),
      fetchMlbStatsTable("ALL", "pitching", "earnedRunAverage"),
      fetchMlbStatsTable("QUALIFIED", "pitching", "earnedRunAverage"),
      fetchJson("/standings", {
        leagueId: "103,104",
        season: state.season,
        standingsTypes: "regularSeason"
      })
    ]);

    const hitters = mergePybaseballStats(normalizeMlbStatsTablePlayers(allStatsData));
    const pitchers = normalizeMlbStatsTablePitchers(pitchingStatsData);
    const qualifiedPitchersFromFeed = normalizeMlbStatsTablePitchers(qualifiedPitchingStatsData);
    players = mergePlayerPools(hitters, pitchers);
    qualifiedPlayerIds = new Set(normalizeMlbStatsTablePlayers(qualifiedStatsData).map((player) => String(player.mlbId ?? player.id)));
    qualifiedPitcherIds = qualifiedPitchersFromFeed.length
      ? new Set(qualifiedPitchersFromFeed.map((player) => String(player.mlbId ?? player.id)))
      : null;
    teams = normalizeTeams(standingsData, players);
    teamById = Object.fromEntries(teams.map((team) => [team.id, team]));
    state.usingFallback = false;
    setStatus(`Live MLB.com ${state.season} hitters and pitchers loaded. Refresh the page for the newest available stats.`);
  } catch (error) {
    if (!loadPybaseballSnapshot()) {
      players = samplePlayers;
      teams = sampleTeams;
      teamById = Object.fromEntries(teams.map((team) => [team.id, team]));
      qualifiedPlayerIds = null;
      qualifiedPitcherIds = null;
      state.usingFallback = true;
      setStatus("Live MLB data could not load here, so the page is showing a small sample fallback.");
    }
  }

  setLoading(false);
  renderAll();
}

function loadPybaseballSnapshot() {
  const snapshot = window.MLB_STATS_DATA;
  if (!snapshot || Number(snapshot.season) !== state.season || !Array.isArray(snapshot.players)) return false;
  players = snapshot.players.map((player) => ({ ...player, role: "hitter", hasBatting: true, hasPitching: false }));
  teams = snapshot.teams ?? [];
  qualifiedPlayerIds = null;
  qualifiedPitcherIds = null;
  teamById = Object.fromEntries(teams.map((team) => [team.id, team]));
  state.usingFallback = false;
  setStatus(`pybaseball snapshot loaded for ${snapshot.season}. Updated ${snapshot.updatedAt ?? "recently"}.`);
  return true;
}

function normalizeMlbStatsTablePlayers(data) {
  const rows = data?.stats ?? [];
  return rows
    .map((row) => ({
      id: String(row.playerId ?? row.playerName),
      role: "hitter",
      mlbId: Number(row.playerId ?? 0) || null,
      name: row.playerFullName ?? row.playerName ?? "Unknown Player",
      team: String(row.teamId ?? "0"),
      teamAbbr: row.teamAbbrev ?? "-",
      pos: row.positionAbbrev ?? row.primaryPositionAbbrev ?? "-",
      g: Number(row.gamesPlayed ?? 0),
      pa: Number(row.plateAppearances ?? 0),
      ab: Number(row.atBats ?? 0),
      avg: parseRate(row.avg),
      obp: parseRate(row.obp),
      slg: parseRate(row.slg),
      ops: parseRate(row.ops),
      hr: Number(row.homeRuns ?? 0),
      rbi: Number(row.rbi ?? 0),
      sb: Number(row.stolenBases ?? 0),
      fwar: null,
      war: null,
      hits: Number(row.hits ?? 0),
      doubles: Number(row.doubles ?? 0),
      triples: Number(row.triples ?? 0),
      runs: Number(row.runs ?? 0),
      bb: Number(row.baseOnBalls ?? 0),
      so: Number(row.strikeOuts ?? 0),
      note: "MLB.com batting table feed."
    }))
    .filter((player) => player.name !== "Unknown Player" && player.g > 0);
}

function normalizeMlbStatsTablePitchers(data) {
  const rows = data?.stats ?? [];
  return rows
    .map((row) => ({
      id: String(row.playerId ?? row.playerName),
      role: "pitcher",
      hasBatting: false,
      hasPitching: true,
      mlbId: Number(row.playerId ?? 0) || null,
      name: row.playerFullName ?? row.playerName ?? "Unknown Pitcher",
      team: String(row.teamId ?? "0"),
      teamAbbr: row.teamAbbrev ?? "-",
      pos: row.positionAbbrev ?? row.primaryPositionAbbrev ?? "P",
      p_g: Number(row.gamesPlayed ?? row.gamesPitched ?? 0),
      gs: Number(row.gamesStarted ?? 0),
      ip: row.inningsPitched ?? "0.0",
      era: parseRate(row.era),
      whip: parseRate(row.whip),
      wins: Number(row.wins ?? 0),
      losses: Number(row.losses ?? 0),
      saves: Number(row.saves ?? 0),
      p_so: Number(row.strikeOuts ?? 0),
      p_bb: Number(row.baseOnBalls ?? 0),
      p_hits: Number(row.hits ?? 0),
      er: Number(row.earnedRuns ?? 0),
      note: "MLB.com pitching table feed."
    }))
    .filter((player) => player.name !== "Unknown Pitcher" && player.p_g > 0);
}

function mergePlayerPools(hitters, pitchers) {
  const merged = new Map();
  hitters.forEach((player) => {
    const key = String(player.mlbId ?? player.id);
    merged.set(key, { ...player, hasBatting: true, hasPitching: false });
  });
  pitchers.forEach((pitcher) => {
    const key = String(pitcher.mlbId ?? pitcher.id);
    const existing = merged.get(key);
    if (existing) {
      merged.set(key, { ...existing, pitching: pitcher, hasPitching: true });
      return;
    }
    merged.set(key, { ...pitcher, hasBatting: false, hasPitching: true });
  });
  return [...merged.values()];
}

function normalizePlayers(data) {
  const splits = data?.stats?.[0]?.splits ?? [];
  return splits
    .map((split) => {
      const stat = split.stat ?? {};
      const team = split.team ?? {};
      const player = split.player ?? {};
      const position = split.position?.abbreviation || player.primaryPosition?.abbreviation || "DH";
      return {
        id: String(player.id ?? split.person?.id ?? player.fullName),
        mlbId: Number(player.id ?? split.person?.id ?? 0) || null,
        name: player.fullName ?? split.person?.fullName ?? "Unknown Player",
        team: String(team.id ?? "0"),
        teamAbbr: team.abbreviation ?? team.teamCode?.toUpperCase() ?? team.name ?? "-",
        pos: position,
        g: Number(stat.gamesPlayed ?? 0),
        pa: Number(stat.plateAppearances ?? 0),
        ab: Number(stat.atBats ?? 0),
        avg: parseRate(stat.avg),
        obp: parseRate(stat.obp),
        slg: parseRate(stat.slg),
        ops: parseRate(stat.ops),
        hr: Number(stat.homeRuns ?? 0),
        rbi: Number(stat.rbi ?? 0),
        sb: Number(stat.stolenBases ?? 0),
        fwar: null,
        war: null,
        hits: Number(stat.hits ?? 0),
        doubles: Number(stat.doubles ?? 0),
        triples: Number(stat.triples ?? 0),
        runs: Number(stat.runs ?? 0),
        bb: Number(stat.baseOnBalls ?? 0),
        so: Number(stat.strikeOuts ?? 0),
        note: "Official MLB standard batting stats. Advanced stats are supplied separately when available from the local pybaseball snapshot."
      };
    })
    .filter((player) => player.name !== "Unknown Player" && player.g > 0);
}

function normalizeTeams(standingsData, playerList) {
  const records = (standingsData?.records ?? []).flatMap((division) => division.teamRecords ?? []);
  const standingsTeams = records.map((record, index) => {
    const team = record.team ?? {};
    const wins = Number(record.wins ?? 0);
    const losses = Number(record.losses ?? 0);
    return {
      id: String(team.id),
      abbr: team.abbreviation ?? team.teamCode?.toUpperCase() ?? team.name,
      name: team.name,
      league: record.league?.abbreviation ?? (record.league?.id === 103 ? "AL" : "NL"),
      record: `${wins}-${losses}`,
      runs: Number(record.runsScored ?? 0),
      era: Number(record.team?.era ?? 0),
      winPct: parseRate(record.winningPercentage),
      color: teamColor(index)
    };
  });

  const missingFromPlayers = playerList
    .filter((player) => !standingsTeams.some((team) => team.id === player.team))
    .map((player, index) => ({
      id: player.team,
      abbr: player.teamAbbr,
      name: player.teamAbbr,
      league: "MLB",
      record: "0-0",
      runs: 0,
      era: 0,
      winPct: 0,
      color: teamColor(standingsTeams.length + index)
    }));

  return [...standingsTeams, ...missingFromPlayers];
}

function setLoading(isLoading) {
  els.search.disabled = isLoading;
}

function setStatus(message) {
  els.dataStatus.textContent = message;
}

function filteredPlayers() {
  return qualifiedPlayers();
}

function sortPlayers(list) {
  return [...list].sort((a, b) => {
    const key = state.sortKey;
    const direction = state.sortDir === "asc" ? 1 : -1;
    if (numberKeys.has(key)) return (Number(statValue(a, key) ?? -1) - Number(statValue(b, key) ?? -1)) * direction;
    return String(a[key] ?? "").localeCompare(String(b[key] ?? "")) * direction;
  });
}

function renderTable() {
  if (!hasFwar() && state.sortKey === "fwar") state.sortKey = "ops";
  const list = sortPlayers(filteredPlayers());
  const visible = state.tableExpanded ? list : list.slice(0, DEFAULT_TABLE_ROWS);
  els.resultCount.textContent = `Showing ${visible.length} of ${list.length} qualified hitter${list.length === 1 ? "" : "s"}`;
  els.toggleRows.hidden = list.length <= DEFAULT_TABLE_ROWS;
  els.toggleRows.textContent = state.tableExpanded ? "Show fewer" : "Show more";
  els.rows.innerHTML = visible
    .map((player) => {
      const team = teamById[player.team] ?? {};
      return `
        <tr>
          <td><button class="player-button" type="button" data-player="${player.id}">${player.name}</button></td>
          <td><span class="team-chip" style="--team-color: ${team.color ?? "#315f8c"}">${player.teamAbbr}</span></td>
          <td>${player.pos}</td>
          <td>${player.g}</td>
          <td>${fmtRate(player.avg)}</td>
          <td>${fmtRate(player.obp)}</td>
          <td>${fmtRate(player.slg)}</td>
          <td>${fmtRate(player.ops)}</td>
          <td>${player.hr}</td>
          <td>${player.rbi}</td>
          <td>${player.sb}</td>
          <td>${fmtFwar(player)}</td>
        </tr>
      `;
    })
    .join("");
}

function allPitchers() {
  return players.flatMap((player) => {
    if (player.pitching) {
      return [{
        ...player.pitching,
        id: String(player.pitching.id ?? player.id),
        mlbId: player.pitching.mlbId ?? player.mlbId,
        name: player.name,
        hasBatting: false,
        hasPitching: true
      }];
    }
    return player.hasPitching ? [player] : [];
  });
}

function qualifiedPitchers() {
  const pitchers = allPitchers();
  if (qualifiedPitcherIds) {
    return pitchers.filter((player) => qualifiedPitcherIds.has(String(player.mlbId ?? player.id)));
  }
  const minimumOuts = gamesPlayedForQualification() * 3;
  return pitchers.filter((player) => inningsToOuts(player.ip) >= minimumOuts);
}

function renderPitchingTable() {
  const list = qualifiedPitchers().sort((a, b) => Number(a.era ?? 99) - Number(b.era ?? 99));
  const visible = state.pitchingExpanded ? list : list.slice(0, DEFAULT_TABLE_ROWS);
  els.pitcherResultCount.textContent = `Showing ${visible.length} of ${list.length} qualified pitcher${list.length === 1 ? "" : "s"}`;
  els.togglePitcherRows.hidden = list.length <= DEFAULT_TABLE_ROWS;
  els.togglePitcherRows.textContent = state.pitchingExpanded ? "Show fewer" : "Show more";
  els.pitcherRows.innerHTML = visible
    .map((player) => {
      const team = teamById[player.team] ?? {};
      return `
        <tr>
          <td><button class="player-button" type="button" data-pitcher="${player.id}">${player.name}</button></td>
          <td><span class="team-chip" style="--team-color: ${team.color ?? "#315f8c"}">${player.teamAbbr}</span></td>
          <td>${player.p_g}</td>
          <td>${player.gs}</td>
          <td>${player.ip}</td>
          <td>${fmtRate(player.era)}</td>
          <td>${fmtRate(player.whip)}</td>
          <td>${player.wins}</td>
          <td>${player.losses}</td>
          <td>${player.saves}</td>
          <td>${player.p_so}</td>
          <td>${player.p_bb}</td>
        </tr>
      `;
    })
    .join("");
}

function gamesPlayedForQualification() {
  const mlbTeams = teams.filter((team) => team.league === "AL" || team.league === "NL");
  const records = mlbTeams
    .map((team) => {
      const [wins, losses] = String(team.record ?? "").split("-").map(Number);
      return Number.isFinite(wins) && Number.isFinite(losses) ? wins + losses : 0;
    })
    .filter(Boolean);
  if (records.length) return Math.max(...records);
  return Math.max(...players.map((player) => Number(player.g ?? 0)), 0);
}

function qualifiedPlateAppearances() {
  return Math.ceil(gamesPlayedForQualification() * 3.1);
}

function qualifiedPlayers() {
  const hitters = players.filter((player) => player.hasBatting !== false);
  if (qualifiedPlayerIds) {
    return hitters.filter((player) => qualifiedPlayerIds.has(String(player.mlbId ?? player.id)));
  }
  const minimumPa = qualifiedPlateAppearances();
  return hitters.filter((player) => Number(player.pa ?? 0) >= minimumPa);
}

function renderTeams() {
  const featuredTeams = teams
    .filter((team) => team.league === "AL" || team.league === "NL")
    .sort((a, b) => Number(b.winPct ?? 0) - Number(a.winPct ?? 0))
    .slice(0, 8);

  els.teamGrid.innerHTML = featuredTeams
    .map((team) => {
      const roster = players.filter((player) => player.team === team.id && player.hasBatting !== false);
      const best = [...roster].sort((a, b) => Number(b.ops ?? 0) - Number(a.ops ?? 0))[0];
      return `
        <article class="team-card" style="--team-color: ${team.color}">
          <h3>${team.name}</h3>
          <dl>
            <div><dt>Record</dt><dd>${team.record}</dd></div>
            <div><dt>Runs</dt><dd>${team.runs || "-"}</dd></div>
            <div><dt>Pct</dt><dd>${team.winPct ? fmtRate(team.winPct) : "-"}</dd></div>
          </dl>
          <p class="leader-meta">Top bat: ${best ? `${best.name}, ${fmtRate(best.ops)} OPS` : "No hitter in current table"}</p>
        </article>
      `;
    })
    .join("");
}

function renderSummary() {
  els.seasonLabel.textContent = `${state.season} MLB regular season / qualified hitters and pitchers`;
}

function renderPlayerSuggestions() {
  renderSearchDropdown();
}

function matchingPlayers(value) {
  const query = normalizeSearchText(value.trim());
  if (!query) return [];
  return players
    .filter((player) => normalizeSearchText(player.name).includes(query))
    .sort((a, b) => {
      const aName = normalizeSearchText(a.name);
      const bName = normalizeSearchText(b.name);
      const aStarts = aName.startsWith(query) ? 0 : 1;
      const bStarts = bName.startsWith(query) ? 0 : 1;
      return aStarts - bStarts || a.name.localeCompare(b.name);
    })
    .slice(0, 8);
}

function findPlayerBySearch(value) {
  const query = normalizeSearchText(value.trim());
  if (!query) return null;
  return players.find((player) => normalizeSearchText(player.name) === query);
}

function renderSearchDropdown() {
  searchMatches = matchingPlayers(els.search.value);
  activeSearchIndex = searchMatches.length ? 0 : -1;
  if (!searchMatches.length) {
    els.searchDropdown.hidden = true;
    els.searchDropdown.innerHTML = "";
    return;
  }
  els.searchDropdown.hidden = false;
  els.searchDropdown.innerHTML = searchMatches
    .map((player, index) => {
      const team = teamById[player.team] ?? {};
      return `
        <button class="search-option${index === activeSearchIndex ? " is-active" : ""}" type="button" data-player="${player.id}">
          <strong>${player.name}</strong>
          <span>${team.name ?? player.teamAbbr} / ${player.hasBatting === false ? "P" : player.pos}</span>
        </button>
      `;
    })
    .join("");
}

function updateActiveSearchOption() {
  els.searchDropdown.querySelectorAll(".search-option").forEach((button, index) => {
    button.classList.toggle("is-active", index === activeSearchIndex);
  });
}

function openPlayerPage(playerId) {
  const player = players.find((item) => item.id === playerId);
  if (!player) return;
  const id = player.mlbId || player.id;
  const type = player.hasBatting === false ? "pitching" : "batting";
  window.location.href = `./player.html?id=${encodeURIComponent(id)}&season=${encodeURIComponent(state.season)}&type=${type}`;
}

function openPitcherPage(playerId) {
  const pitcher = allPitchers().find((item) => item.id === playerId);
  if (!pitcher) return;
  const id = pitcher.mlbId || pitcher.id;
  window.location.href = `./player.html?id=${encodeURIComponent(id)}&season=${encodeURIComponent(state.season)}&type=pitching`;
}

function openDrawer(playerId) {
  const player = players.find((item) => item.id === playerId);
  if (!player) return;
  const team = teamById[player.team] ?? {};
  els.drawerContent.innerHTML = `
    <p class="eyebrow">${team.league ?? "MLB"} / ${team.name ?? player.teamAbbr}</p>
    <h2>${player.name}</h2>
    <p class="player-subtitle">${player.pos} / ${player.g} games / ${player.pa ?? "-"} PA / ${state.season}</p>
    <div class="stat-stack">
      <div><span>OPS</span><strong>${fmtRate(player.ops)}</strong></div>
      <div><span>AVG</span><strong>${fmtRate(player.avg)}</strong></div>
      <div><span>OBP</span><strong>${fmtRate(player.obp)}</strong></div>
      <div><span>HR</span><strong>${player.hr}</strong></div>
      <div><span>RBI</span><strong>${player.rbi}</strong></div>
      <div><span>SB</span><strong>${player.sb}</strong></div>
      <div><span>H</span><strong>${player.hits}</strong></div>
      <div><span>BB</span><strong>${player.bb}</strong></div>
      <div><span>SO</span><strong>${player.so}</strong></div>
    </div>
    <p class="note">${player.note}</p>
  `;
  els.drawer.classList.add("is-open");
  els.drawer.setAttribute("aria-hidden", "false");
  els.scrim.classList.add("is-open");
  els.closeDrawer.focus();
}

function closeDrawer() {
  els.drawer.classList.remove("is-open");
  els.drawer.setAttribute("aria-hidden", "true");
  els.scrim.classList.remove("is-open");
}

function renderAll() {
  renderTable();
  renderPitchingTable();
  renderTeams();
  renderSummary();
  renderPlayerSuggestions();
}

els.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const player = findPlayerBySearch(els.search.value);
  if (player) {
    openPlayerPage(player.id);
    return;
  }
  if (searchMatches[activeSearchIndex]) openPlayerPage(searchMatches[activeSearchIndex].id);
});

els.search.addEventListener("input", renderSearchDropdown);

els.search.addEventListener("keydown", (event) => {
  if (els.searchDropdown.hidden || !searchMatches.length) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    activeSearchIndex = (activeSearchIndex + 1) % searchMatches.length;
    updateActiveSearchOption();
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    activeSearchIndex = (activeSearchIndex - 1 + searchMatches.length) % searchMatches.length;
    updateActiveSearchOption();
  }
  if (event.key === "Escape") {
    els.searchDropdown.hidden = true;
  }
});

els.searchDropdown.addEventListener("click", (event) => {
  const button = event.target.closest("[data-player]");
  if (button) openPlayerPage(button.dataset.player);
});

document.addEventListener("click", (event) => {
  if (!els.searchForm.contains(event.target)) els.searchDropdown.hidden = true;
});

els.toggleRows.addEventListener("click", () => {
  state.tableExpanded = !state.tableExpanded;
  renderTable();
});

els.togglePitcherRows.addEventListener("click", () => {
  state.pitchingExpanded = !state.pitchingExpanded;
  renderPitchingTable();
});

document.querySelectorAll("th button").forEach((button) => {
  button.addEventListener("click", () => {
    const nextSort = button.dataset.sort;
    state.sortDir = state.sortKey === nextSort && state.sortDir === "desc" ? "asc" : "desc";
    state.sortKey = nextSort;
    renderTable();
  });
});

els.rows.addEventListener("click", (event) => {
  const button = event.target.closest("[data-player]");
  if (button) openPlayerPage(button.dataset.player);
});

els.pitcherRows.addEventListener("click", (event) => {
  const button = event.target.closest("[data-pitcher]");
  if (button) openPitcherPage(button.dataset.pitcher);
});

els.closeDrawer.addEventListener("click", closeDrawer);
els.scrim.addEventListener("click", closeDrawer);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDrawer();
});

loadMlbData();
