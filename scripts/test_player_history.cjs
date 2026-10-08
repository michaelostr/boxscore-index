const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const elements = new Map();
const context = vm.createContext({ URLSearchParams, window: {
  location: { search: '?id=1&season=2026' }, MLB_STATS_DATA: { players: [], teams: [] },
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
  split('2026', { id: 2, name: '<Team>' }, { age: 25, hits: 3, avg: '.100' }),
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
assert.equal(elements.get('#pitchingHistory').hidden, true);
assert.match(elements.get('#battingHistoryTotals').innerHTML, /Career/);
assert.match(elements.get('#battingHistoryTotals').innerHTML, /<td>33<\/td>/);
assert.match(elements.get('#battingHistoryTotals').innerHTML, /<td>\.250<\/td>/);
assert.equal(vm.runInContext('careerWar({ id: 1 }, historyRows(person, "hitting"), "fwar", "hitting")', context), '-');
vm.runInContext('window.WAR_DATA.seasons["2025"] = { sources: { fwarBatting: { players: { "1": 1.25 } } } }', context);
assert.equal(vm.runInContext('careerWar({ id: 1 }, historyRows(person, "hitting"), "fwar", "hitting")', context), '1.3');
vm.runInContext('renderSeason({ id: 1, avg: .3, ops: .9, hr: 20, rbi: 60 })', context);
assert.equal((elements.get('#seasonStats').innerHTML.match(/<dt>/g) ?? []).length, 6);
assert.doesNotMatch(elements.get('#seasonStats').innerHTML, /wRC|est\./);
vm.runInContext('renderSeason({ id: 1, wrc: 0 })', context);
assert.match(elements.get('#seasonStats').innerHTML, /wRC\+<\/dt><dd>0/);
vm.runInContext('renderPitchingSeason({ id: 1, ip: "10.2", era: 2.5, whip: 1.1, p_so: 12 })', context);
assert.equal((elements.get('#seasonStats').innerHTML.match(/<dt>/g) ?? []).length, 6);
vm.runInContext('renderHistory({ stats: [] }, { id: 1 })', context);
assert.equal(elements.get('#battingHistory').hidden, true);
assert.match(elements.get('#historyStatus').textContent, /No MLB/);

async function main() {
  if (process.argv.includes('--live')) {
    for (const [id, group] of [[665742, 'hitting'], [656427, 'pitching'], [660271, 'pitching']]) {
      const response = await fetch(`https://statsapi.mlb.com/api/v1/people/${id}?hydrate=stats(group=[hitting,pitching],type=[career,yearByYear],sportIds=[1])`);
      assert.equal(response.ok, true);
      context.person = (await response.json()).people[0];
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
  }
  console.log('Player history checks passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

