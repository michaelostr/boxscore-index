const API_BASE = "https://statsapi.mlb.com/api/v1";
const MLB_STATS_TABLE_BASE = "https://bdfed.stitch.mlbinfra.com/bdfed/stats/player";

const params = new URLSearchParams(window.location.search);
const snapshot = window.MLB_STATS_DATA ?? { players: [], teams: [] };
const advancedSnapshot = window.ADVANCED_BATTING_DATA ?? { players: [] };
let players = snapshot.players ?? [];
const teams = snapshot.teams ?? [];
const teamById = Object.fromEntries(teams.map((team) => [team.id, team]));

const els = {
  name: document.querySelector("#playerName"),
  headshot: document.querySelector("#playerHeadshot"),
  bio: document.querySelector("#bioGrid"),
  season: document.querySelector("#seasonStats"),
  seasonLabel: document.querySelector("#seasonStatsLabel"),
  career: document.querySelector("#careerStats"),
  careerStatus: document.querySelector("#careerStatus"),
  resultsPanel: document.querySelector("#searchResultsPanel"),
  results: document.querySelector("#searchResults"),
  bioPanel: document.querySelector("#bioGrid"),
  seasonPanel: document.querySelector("#seasonPanel"),
  careerPanel: document.querySelector("#careerPanel")
};

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function fmtRate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return numeric.toFixed(3).replace(/^0/, "");
}

function fmtPitchingRate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return numeric.toFixed(2);
}

function statBlock(label, value) {
  return `<div><dt>${label}</dt><dd>${value ?? "-"}</dd></div>`;
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

function mergeLocalAdvancedStats(player, localPlayer) {
  const fwar = fwarValue(localPlayer);
  const advanced = advancedStatsForPlayer(localPlayer) ?? advancedStatsForPlayer(player);
  return {
    ...player,
    fwar,
    war: fwar,
    wrc: advanced?.wrc ?? localPlayer?.wrc ?? player.wrc
  };
}

function advancedStatsForPlayer(player) {
  if (!player) return null;
  const id = String(player.mlbId ?? player.id ?? "");
  const name = normalizeSearchText(player.name);
  const team = String(player.teamAbbr ?? player.team ?? "").toUpperCase();
  const rows = advancedSnapshot.players ?? [];
  return rows.find((row) => {
    if (row.mlbId && String(row.mlbId) === id) return true;
    const rowName = normalizeSearchText(row.name);
    const rowTeam = String(row.teamAbbr ?? row.team ?? "").toUpperCase();
    return rowName === name && (!rowTeam || !team || rowTeam === team);
  }) ?? rows.find((row) => normalizeSearchText(row.name) === name) ?? null;
}

function fmtIndexStat(value) {
  const numeric = finiteValue(value);
  return numeric == null ? "-" : String(Math.round(numeric));
}

function singles(player) {
  return Math.max(
    Number(player.hits ?? 0) -
      Number(player.doubles ?? 0) -
      Number(player.triples ?? 0) -
      Number(player.hr ?? 0),
    0
  );
}

function estimatedWoba(player) {
  const ab = Number(player.ab ?? 0);
  const bb = Number(player.bb ?? 0);
  const denominator = ab + bb;
  if (!denominator) return null;
  const value =
    0.69 * bb +
    0.89 * singles(player) +
    1.27 * Number(player.doubles ?? 0) +
    1.62 * Number(player.triples ?? 0) +
    2.1 * Number(player.hr ?? 0);
  return value / denominator;
}

function estimatedWrcPlus(player) {
  const playerWoba = estimatedWoba(player);
  if (!playerWoba) return null;
  const league = players.reduce(
    (totals, item) => {
      totals.ab += Number(item.ab ?? 0);
      totals.bb += Number(item.bb ?? 0);
      totals.singles += singles(item);
      totals.doubles += Number(item.doubles ?? 0);
      totals.triples += Number(item.triples ?? 0);
      totals.hr += Number(item.hr ?? 0);
      return totals;
    },
    { ab: 0, bb: 0, singles: 0, doubles: 0, triples: 0, hr: 0 }
  );
  const denominator = league.ab + league.bb;
  if (!denominator) return null;
  const leagueWoba =
    (0.69 * league.bb +
      0.89 * league.singles +
      1.27 * league.doubles +
      1.62 * league.triples +
      2.1 * league.hr) /
    denominator;
  return leagueWoba ? Math.round((playerWoba / leagueWoba) * 100) : null;
}

function wrcLabelAndValue(player) {
  const advanced = advancedStatsForPlayer(player);
  const actual = advanced?.wrc ?? player.wrc;
  const actualValue = finiteValue(actual);
  if (actualValue != null) {
    return ["wRC+", fmtIndexStat(actualValue)];
  }
  return ["wRC+ est.", fmtIndexStat(estimatedWrcPlus(player))];
}

async function fetchLivePlayers() {
  const search = new URLSearchParams({
    stitch_env: "prod",
    season: String(snapshot.season ?? new Date().getFullYear()),
    sportId: "1",
    stats: "season",
    group: "hitting",
    gameType: "R",
    limit: "5000",
    offset: "0",
    sortStat: "onBasePlusSlugging",
    order: "desc",
    playerPool: "ALL"
  });
  const response = await fetch(`${MLB_STATS_TABLE_BASE}?${search.toString()}`);
  if (!response.ok) throw new Error("MLB.com table fetch failed");
  const data = await response.json();
  return (data.stats ?? []).map((row) => ({
    id: String(row.playerId ?? row.playerName),
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
    wrc: null,
    hits: Number(row.hits ?? 0),
    doubles: Number(row.doubles ?? 0),
    triples: Number(row.triples ?? 0),
    runs: Number(row.runs ?? 0),
    bb: Number(row.baseOnBalls ?? 0),
    so: Number(row.strikeOuts ?? 0)
  }));
}

async function fetchLivePitchers() {
  const search = new URLSearchParams({
    stitch_env: "prod",
    season: String(snapshot.season ?? new Date().getFullYear()),
    sportId: "1",
    stats: "season",
    group: "pitching",
    gameType: "R",
    limit: "5000",
    offset: "0",
    sortStat: "earnedRunAverage",
    order: "asc",
    playerPool: "ALL"
  });
  const response = await fetch(`${MLB_STATS_TABLE_BASE}?${search.toString()}`);
  if (!response.ok) throw new Error("MLB.com pitching table fetch failed");
  const data = await response.json();
  return (data.stats ?? [])
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
      er: Number(row.earnedRuns ?? 0)
    }))
    .filter((player) => player.name !== "Unknown Pitcher" && player.p_g > 0);
}

function findPlayer() {
  const id = params.get("id");
  const query = params.get("q");
  if (id) {
    return players.find((player) => String(player.mlbId ?? player.id) === String(id) || String(player.id) === String(id));
  }
  if (!query) return null;
  const normalized = normalizeSearchText(query);
  return players.find((player) => normalizeSearchText(player.name) === normalized);
}

function searchMatches() {
  const query = normalizeSearchText(params.get("q") ?? "");
  if (!query) return [];
  return players.filter((player) => normalizeSearchText(player.name).includes(query)).slice(0, 12);
}

function renderSearchResults(matches) {
  els.resultsPanel.hidden = false;
  els.bioPanel.hidden = true;
  els.seasonPanel.hidden = true;
  els.careerPanel.hidden = true;
  els.name.textContent = "Player search";
  els.bio.innerHTML = "";
  els.season.innerHTML = "";
  els.career.innerHTML = "";
  els.careerStatus.textContent = "";
  els.results.innerHTML = matches
    .map((player) => {
      const team = teamById[player.team] ?? {};
      const type = player.hasBatting === false ? "pitching" : "batting";
      const position = player.hasBatting === false ? "P" : player.pos;
      return `
        <a class="search-result" href="./player.html?id=${encodeURIComponent(player.mlbId ?? player.id)}&season=${encodeURIComponent(snapshot.season ?? "")}&type=${type}">
          <strong>${player.name}</strong>
          <span>${team.name ?? player.teamAbbr} / ${position}</span>
        </a>
      `;
    })
    .join("");
}

function renderSeason(player) {
  const [wrcLabel, wrcValue] = wrcLabelAndValue(player);
  els.seasonLabel.textContent = `${snapshot.season ?? "Current"} season`;
  els.season.innerHTML = [
    statBlock("G", player.g),
    statBlock("PA", player.pa),
    statBlock("AVG", fmtRate(player.avg)),
    statBlock("OBP", fmtRate(player.obp)),
    statBlock("SLG", fmtRate(player.slg)),
    statBlock("OPS", fmtRate(player.ops)),
    statBlock(wrcLabel, wrcValue),
    statBlock("fWAR", fmtFwar(player)),
    statBlock("HR", player.hr),
    statBlock("RBI", player.rbi),
    statBlock("SB", player.sb),
    statBlock("H", player.hits),
    statBlock("BB", player.bb),
    statBlock("SO", player.so)
  ].join("");
}

function renderPitchingSeason(player) {
  els.seasonLabel.textContent = `${snapshot.season ?? "Current"} season`;
  els.season.innerHTML = [
    statBlock("G", player.p_g),
    statBlock("GS", player.gs),
    statBlock("IP", player.ip),
    statBlock("ERA", fmtPitchingRate(player.era)),
    statBlock("WHIP", fmtPitchingRate(player.whip)),
    statBlock("W", player.wins),
    statBlock("L", player.losses),
    statBlock("SV", player.saves),
    statBlock("SO", player.p_so),
    statBlock("BB", player.p_bb),
    statBlock("H", player.p_hits),
    statBlock("ER", player.er)
  ].join("");
}

function renderPlayerHeader(player) {
  els.name.textContent = player.name;
  renderHeadshot(player);
}

function renderHeadshot(player) {
  const id = player.mlbId ?? player.id;
  if (!id) {
    els.headshot.hidden = true;
    return;
  }
  els.headshot.hidden = false;
  els.headshot.alt = `${player.name} headshot`;
  els.headshot.src = `https://img.mlbstatic.com/mlb-photos/image/upload/w_213,q_100/v1/people/${id}/headshot/67/current`;
  els.headshot.onerror = () => {
    els.headshot.hidden = true;
  };
}

function renderLocalPlayer(player) {
  const team = teamById[player.team] ?? {};
  renderPlayerHeader(player);
  els.bio.innerHTML = [
    statBlock("Position", player.pos),
    statBlock("Team", team.name ?? player.teamAbbr),
    statBlock("Bats", "-"),
    statBlock("Throws", "-"),
    statBlock("Height", "-"),
    statBlock("Weight", "-"),
    statBlock("Born", "-")
  ].join("");
  renderSeason(player);
}

function renderLocalPitcher(player) {
  renderPlayerHeader(player);
  els.bio.innerHTML = [
    statBlock("Position", player.pos ?? "P"),
    statBlock("Team", player.teamAbbr),
    statBlock("Bats", "-"),
    statBlock("Throws", "-"),
    statBlock("Height", "-"),
    statBlock("Weight", "-"),
    statBlock("Born", "-")
  ].join("");
  renderPitchingSeason(player);
}

function careerStatsFromPerson(person) {
  const statGroup = (person.stats ?? []).find((item) => item.type?.displayName === "career" || item.type?.type === "career");
  return statGroup?.splits?.[0]?.stat ?? null;
}

function renderBio(person, localPlayer) {
  const team = person.currentTeam?.name ?? teamById[localPlayer.team]?.name ?? localPlayer.teamAbbr;
  els.bio.innerHTML = [
    statBlock("Position", person.primaryPosition?.abbreviation ?? localPlayer.pos),
    statBlock("Team", team),
    statBlock("Bats", person.batSide?.description),
    statBlock("Throws", person.pitchHand?.description),
    statBlock("Height", person.height),
    statBlock("Weight", person.weight ? `${person.weight} lb` : "-"),
    statBlock("Born", person.birthDate),
    statBlock("Birthplace", [person.birthCity, person.birthStateProvince, person.birthCountry].filter(Boolean).join(", "))
  ].join("");
}

function renderCareer(stat, group = "hitting") {
  if (!stat) {
    els.careerStatus.textContent = "Career stats unavailable from MLB right now.";
    return;
  }
  els.careerStatus.textContent = "";
  if (group === "pitching") {
    els.career.innerHTML = [
      statBlock("G", stat.gamesPlayed),
      statBlock("GS", stat.gamesStarted),
      statBlock("IP", stat.inningsPitched),
      statBlock("ERA", fmtPitchingRate(stat.era)),
      statBlock("WHIP", fmtPitchingRate(stat.whip)),
      statBlock("W", stat.wins),
      statBlock("L", stat.losses),
      statBlock("SV", stat.saves),
      statBlock("SO", stat.strikeOuts),
      statBlock("BB", stat.baseOnBalls),
      statBlock("H", stat.hits),
      statBlock("ER", stat.earnedRuns)
    ].join("");
    return;
  }
  els.career.innerHTML = [
    statBlock("G", stat.gamesPlayed),
    statBlock("AB", stat.atBats),
    statBlock("AVG", stat.avg),
    statBlock("OBP", stat.obp),
    statBlock("SLG", stat.slg),
    statBlock("OPS", stat.ops),
    statBlock("HR", stat.homeRuns),
    statBlock("RBI", stat.rbi),
    statBlock("SB", stat.stolenBases),
    statBlock("H", stat.hits),
    statBlock("BB", stat.baseOnBalls),
    statBlock("SO", stat.strikeOuts)
  ].join("");
}

async function loadCareer(player, group = "hitting") {
  if (!player.mlbId) {
    els.careerStatus.textContent = "Career stats unavailable from MLB right now.";
    return;
  }
  try {
    const response = await fetch(`${API_BASE}/people/${player.mlbId}?hydrate=stats(group=[${group}],type=[career])`);
    if (!response.ok) throw new Error("career fetch failed");
    const data = await response.json();
    const person = data.people?.[0];
    if (!person) throw new Error("player not found");
    renderBio(person, player);
    renderCareer(careerStatsFromPerson(person), group);
  } catch (error) {
    els.careerStatus.textContent = "Career stats unavailable from MLB right now.";
  }
}

async function loadPitcherById() {
  const id = params.get("id");
  if (!id) return false;
  try {
    const pitchers = await fetchLivePitchers();
    const pitcher = pitchers.find((item) => String(item.mlbId ?? item.id) === String(id));
    if (!pitcher) return false;
    renderLocalPitcher(pitcher);
    loadCareer(pitcher, "pitching");
    return true;
  } catch (error) {
    return false;
  }
}

const requestedType = params.get("type");
const player = requestedType === "pitching" ? null : findPlayer();
if (player) {
  renderLocalPlayer(player);
  loadCareer(player);
  fetchLivePlayers()
    .then((livePlayers) => {
      players = livePlayers.map((livePlayer) => {
        const localPlayer = players.find((item) => String(item.mlbId ?? item.id) === String(livePlayer.mlbId ?? livePlayer.id));
        return localPlayer ? mergeLocalAdvancedStats(livePlayer, localPlayer) : livePlayer;
      });
      const livePlayer = livePlayers.find((item) => String(item.mlbId ?? item.id) === String(player.mlbId ?? player.id));
      if (livePlayer) {
        const mergedPlayer = mergeLocalAdvancedStats(livePlayer, player);
        renderPlayerHeader(mergedPlayer);
        renderSeason(mergedPlayer);
      }
    })
    .catch(() => {});
} else {
  const matches = searchMatches();
  if (matches.length) {
    renderSearchResults(matches);
  } else {
    loadPitcherById().then((found) => {
      if (found) return;
      els.name.textContent = "Player not found";
      els.bioPanel.hidden = true;
      els.seasonPanel.hidden = true;
      els.careerPanel.hidden = true;
      els.careerStatus.textContent = "";
    });
  }
}
