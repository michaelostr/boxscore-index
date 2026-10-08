const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const elements = new Map();
const context = vm.createContext({ URLSearchParams, window: {
  location: { search: '?id=1&season=2026' }, MLB_STATS_DATA: { season: 2026, players: [], teams: [{ id: 'NYM', abbr: 'NYM', name: 'New York Mets' }, { id: 'CHC', abbr: 'CHC', name: 'Chicago Cubs' }] },
  WAR_DATA: { seasons: { '2026': { sources: { fwarBatting: { players: { '1': 0 } },
    bwarPitching: { players: { '1': -0.7 } } } } } }
}, document: { querySelector(selector) {
  if (!elements.has(selector)) elements.set(selector, {});
  return elements.get(selector);
} } });
const source = fs.readFileSync(path.join(root, 'player.js'), 'utf8');
vm.runInContext(source.slice(0, source.indexOf('const requestedType =')), context);
const split = (season, team, stat = {}, extra = {}) => ({ season, team, stat,
  sport: { id: 1 }, gameType: 'R', ...extra });
context.person = { stats: [{ type: { displayName: 'yearByYear' }, group: { displayName: 'hitting' }, splits: [
  split('2026', { id: 2, name: 'Team', abbreviation: '<Team>' }, { age: 25, hits: 3, avg: '.100' }),
  split('2025', { id: 2, name: 'Team B' }, { hits: 10 }),
  split('2025', { id: 3, name: 'Team C' }, { hits: 20 }),
  split('2025', undefined, { hits: 30, avg: '.300' }, { numTeams: 2 }),
  split('2024', { id: 4 }, {}, { sport: { id: 11 } }),
  split('2024', { id: 4 }, {}, { gameType: 'P' })
] }, { type: { displayName: 'career' }, group: { displayName: 'pitching' }, splits: [{ stat: { wins: 2 } }] },
{ type: { displayName: 'career' }, group: { displayName: 'hitting' }, splits: [{ stat: { hits: 33, avg: '.250' } }] }] };
const rows = vm.runInContext('historyRows(person, "hitting")', context);
assert.equal(rows.length, 4);
assert.equal(rows[0].season, '2025');
assert.equal(rows[0].isTotal, true);
assert.equal(rows[0].stat.hits, 30);
assert.equal(rows[1].isStint, true);
assert.equal(vm.runInContext('careerStatsFromPerson(person, "pitching").wins', context), 2);
assert.equal(vm.runInContext('historyWar({ id: 1 }, { season: "2026" }, "fwar", "hitting")', context), '0.0');
assert.equal(vm.runInContext('historyWar({ id: 1 }, { season: "2026" }, "bwar", "pitching")', context), '-0.7');
assert.equal(vm.runInContext('historyWar({ id: 1 }, { season: "2025" }, "fwar", "hitting")', context), '-');
assert.equal(vm.runInContext('historyWar({ id: 1 }, { season: "2026", isStint: true }, "fwar", "hitting")', context), '-');
vm.runInContext('renderHistory(person, { id: 1 })', context);
assert.match(elements.get('#battingHistoryRows').innerHTML, /&lt;Team&gt;/);
assert.match(elements.get('#battingHistoryRows').innerHTML, /2 teams/);
assert.match(elements.get('#battingHistoryRows').innerHTML, /aria-expanded="false"/);
assert.equal((elements.get('#battingHistoryRows').innerHTML.match(/class="history-stint"[^>]* hidden/g) ?? []).length, 2);
const toggleStints = () => elements.get('#battingHistoryRows').onclick({ target: { closest: () => ({ dataset: { historySeason: '2025' } }) } });
toggleStints();
assert.match(elements.get('#battingHistoryRows').innerHTML, /aria-expanded="true"/);
assert.doesNotMatch(elements.get('#battingHistoryRows').innerHTML, /class="history-stint"[^>]* hidden/);
vm.runInContext('renderHistory(person, { id: 1 })', context);
assert.match(elements.get('#battingHistoryRows').innerHTML, /aria-expanded="true"/);
toggleStints();
assert.equal((elements.get('#battingHistoryRows').innerHTML.match(/class="history-stint"[^>]* hidden/g) ?? []).length, 2);
context.dualPerson = { stats: [...context.person.stats, { type: { displayName: 'yearByYear' }, group: { displayName: 'pitching' }, splits: [
  split('2025', undefined, { wins: 3 }, { numTeams: 2 }),
  split('2025', { id: 2 }, { wins: 1 }), split('2025', { id: 3 }, { wins: 2 })
] }] };
vm.runInContext('renderHistory(dualPerson, { id: 1 })', context);
toggleStints();
assert.match(elements.get('#battingHistoryRows').innerHTML, /aria-expanded="true"/);
assert.match(elements.get('#pitchingHistoryRows').innerHTML, /aria-expanded="false"/);
elements.get('#pitchingHistoryRows').onclick({ target: { closest: () => ({ dataset: { historySeason: '2025' } }) } });
assert.match(elements.get('#pitchingHistoryRows').innerHTML, /aria-expanded="true"/);
vm.runInContext('expandedHistorySeasons.clear(); renderHistory(person, { id: 1 })', context);
assert.equal(elements.get('#pitchingHistory').hidden, true);
assert.match(elements.get('#battingHistoryTotals').innerHTML, /Career/);
assert.match(elements.get('#battingHistoryTotals').innerHTML, /<td>33<\/td>/);
assert.match(elements.get('#battingHistoryTotals').innerHTML, /<td>\.250<\/td>/);
assert.equal(vm.runInContext('careerWar({ id: 1 }, historyRows(person, "hitting"), "fwar", "hitting")', context), '-');
vm.runInContext('window.WAR_DATA.seasons["2025"] = { sources: { fwarBatting: { players: { "1": 1.25 } } } }', context);
assert.equal(vm.runInContext('careerWar({ id: 1 }, historyRows(person, "hitting"), "fwar", "hitting")', context), '1.3');
vm.runInContext('renderSeason({ id: 1, avg: .3, ops: .9, hr: 20, rbi: 60 })', context);
assert.equal((elements.get('#seasonStats').innerHTML.match(/<dt>/g) ?? []).length, 6);
assert.equal(elements.get('#seasonStatsLabel').textContent, '2026 Season Stats');
assert.doesNotMatch(elements.get('#seasonStats').innerHTML, /wRC|est\./);
vm.runInContext('renderSeason({ id: 1, wrc: 0 })', context);
assert.match(elements.get('#seasonStats').innerHTML, /wRC\+<\/dt><dd>0/);
vm.runInContext('renderPitchingSeason({ id: 1, ip: "10.2", era: 2.5, whip: 1.1, p_so: 12 })', context);
assert.equal((elements.get('#seasonStats').innerHTML.match(/<dt>/g) ?? []).length, 6);
vm.runInContext('renderHistory({ stats: [] }, { id: 1 })', context);
assert.equal(elements.get('#battingHistory').hidden, true);
assert.match(elements.get('#historyStatus').textContent, /No MLB/);
vm.runInContext('renderStatcast({ id: 1 })', context);
assert.equal(elements.get('#statcastSeason').textContent, '2026 Run Values');
assert.doesNotMatch(elements.get('#statcastRows').innerHTML, /Batting run value|Fielding run value|Baserunning run value/);
const html = fs.readFileSync(path.join(root, 'player.html'), 'utf8');
assert.doesNotMatch(html, /class="eyebrow"|Baseball stats, pared down/);
assert.match(html, /<h2 id="seasonStatsLabel">Season Stats<\/h2>/);
assert.match(html, /<h2 id="statcastSeason">Run Values<\/h2>/);
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
assert.match(css, /\.stat-leader\{[^}]*color:inherit[^}]*text-decoration-line:underline/);
assert.match(css, /\.leader-key i\{[^}]*border-bottom:2px solid var\(--leader-color\)/);
vm.runInContext('renderBio({ currentTeam: { id: 121, name: "New York Mets" } }, { teamAbbr: "HOU" })', context);
assert.match(elements.get('#bioGrid').innerHTML, /Team<\/dt><dd>New York Mets/);
assert.doesNotMatch(elements.get('#bioGrid').innerHTML, /HOU/);
vm.runInContext('renderLocalPlayer({ id: 1, team: "NYM", teamAbbr: "NYM", name: "Test Player" })', context);
assert.match(elements.get('#bioGrid').innerHTML, /Team<\/dt><dd>New York Mets/);
vm.runInContext('renderLocalPitcher({ id: 1, team: "NYM", teamAbbr: "NYM", name: "Test Pitcher", hasBatting: false })', context);
assert.match(elements.get('#bioGrid').innerHTML, /Team<\/dt><dd>New York Mets/);
context.abbreviationPerson = { stats: [{ type: { displayName: 'yearByYear' }, group: { displayName: 'hitting' },
  splits: [split('2026', { id: 121, name: 'New York Mets' }, { homeRuns: 1 })] }] };
vm.runInContext('renderHistory(abbreviationPerson, { id: 1 })', context);
assert.match(elements.get('#battingHistoryRows').innerHTML, /<td>NYM<\/td>/);
assert.doesNotMatch(elements.get('#battingHistoryRows').innerHTML, /New York Mets/);
assert.equal(vm.runInContext('teamAbbreviation({ name: "Unknown Team" })', context), '-');
assert.equal(vm.runInContext('teamAbbreviation({ id: 112, name: "Chicago Cubs" })', context), 'CHC');

async function main() {
  const requested = [];
  context.fetch = async url => {
    requested.push(url);
    const season = new URL(url).searchParams.get('season');
    return { ok: true, json: async () => ({ teams: [{ id: 999, name: 'Historical Club', abbreviation: season === '2025' ? 'OLD' : 'NEW' }] }) };
  };
  await vm.runInContext('loadHistoryTeams(person)', context);
  assert.equal(vm.runInContext('teamAbbreviation({ id: 999 }, "-", "2025")', context), 'OLD');
  assert.equal(vm.runInContext('teamAbbreviation({ id: 999 }, "-", "2026")', context), 'NEW');
  assert.equal(requested.length, 2);
  await vm.runInContext('loadHistoryTeams(person)', context);
  assert.equal(requested.length, 2);
  if (process.argv.includes('--live')) {
    context.fetch = fetch;
    vm.runInContext('historyTeamsBySeason.clear(); historyTeamRequests.clear();', context);
    for (const [id, group] of [[665742, 'hitting'], [656427, 'pitching'], [660271, 'pitching']]) {
      const response = await fetch(`https://statsapi.mlb.com/api/v1/people/${id}?hydrate=currentTeam,stats(group=[hitting,pitching],type=[career,yearByYear],sportIds=[1])`);
      assert.equal(response.ok, true);
      context.person = (await response.json()).people[0];
      await vm.runInContext('loadHistoryTeams(person)', context);
      const liveRows = vm.runInContext(`historyRows(person, '${group}')`, context);
      assert.ok(liveRows.length > 1);
      assert.ok(vm.runInContext(`careerStatsFromPerson(person, '${group}')`, context));
      vm.runInContext(`renderHistory(person, { mlbId: ${id} })`, context);
      const key = group === 'hitting' ? 'batting' : 'pitching';
      assert.match(elements.get(`#${key}HistoryTotals`).innerHTML, /Career/);
      const headings = (elements.get(`#${key}HistoryHead`).innerHTML.match(/<th /g) ?? []).length;
      const cells = (elements.get(`#${key}HistoryTotals`).innerHTML.match(/<td>/g) ?? []).length;
      assert.equal(cells + 1, headings);
      if (id === 665742) {
        const traded = liveRows.filter(row => row.season === '2022');
        assert.equal(traded.length, 3);
        assert.equal(traded[0].stat.hits, 127);
        assert.equal(traded[0].stat.avg, '.242');
      }
      console.log(`Verified live history for ${context.person.fullName}: ${liveRows.length} ${group} rows.`);
    }
    const response = await fetch('https://statsapi.mlb.com/api/v1/people/691718?hydrate=stats(group=[hitting],type=[yearByYear],sportIds=[1])');
    assert.equal(response.ok, true);
    context.person = (await response.json()).people[0];
    await vm.runInContext('loadHistoryTeams(person)', context);
    vm.runInContext('renderHistory(person, { mlbId: 691718 })', context);
    const cubsRows = vm.runInContext('historyRows(person, "hitting").filter(row => row.team?.id === 112)', context);
    assert.ok(cubsRows.length >= 3);
    for (const row of cubsRows) {
      context.cubsRow = row;
      assert.equal(vm.runInContext('teamAbbreviation(cubsRow.team, "-", cubsRow.season)', context), 'CHC');
    }
    assert.match(elements.get('#battingHistoryRows').innerHTML, /<td>CHC<\/td>/);
    console.log('Verified Chicago Cubs abbreviations for Pete Crow-Armstrong season history.');
  }
  console.log('Player history checks passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

