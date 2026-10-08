const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const storage = new Map();
const calls = [];
const context = vm.createContext({ URLSearchParams, console, window: {
  localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  WAR_DATA: { seasons: { '2024': { sources: { fwarBatting: { players: { '3': 7, '1': 5 } } } } } }
}, fetch: async url => {
  const parsed = new URL(url);
  calls.push(parsed);
  if (parsed.pathname.includes('/seasons/')) return { ok: true, json: async () => ({ seasons: [{ regularSeasonEndDate: '2026-09-27' }] }) };
  const params = parsed.searchParams;
  const group = params.get('statGroup');
  const scope = params.get('leagueId') === '103' ? 'AL' : params.get('leagueId') === '104' ? 'NL' : 'MLB';
  const categories = params.get('leaderCategories').split(',');
  return { ok: true, json: async () => ({ leagueLeaders: categories.map(leaderCategory => ({
    leaderCategory, statGroup: group, season: params.get('season'), gameType: { id: 'R' },
    leaders: (leaderCategory === 'wins' && scope === 'MLB' ? [1, 2] : leaderCategory === 'battingAverage' ? [4]
      : leaderCategory === 'earnedRunAverage' ? [5] : scope === 'MLB' ? [3] : scope === 'AL' ? [1] : [2, 3])
      .map(id => ({ rank: 1, person: { id }, value: leaderCategory === 'earnedRunAverage' ? '2.00' : '30' }))
  })) }) };
} });
vm.runInContext(fs.readFileSync(path.join(root, 'player-leaders.js'), 'utf8'), context);
const leaders = context.window.PLAYER_LEADERS;

async function main() {
  await leaders.load([{ group: 'hitting', season: '2024' }, { group: 'pitching', season: '2024' }], () => {});
  assert.match(leaders.format(30, 1, 'hitting', 2024, 'homeRuns'), /leader-al/);
  assert.match(leaders.format(30, 2, 'hitting', 2024, 'homeRuns'), /leader-nl/);
  assert.match(leaders.format(30, 3, 'hitting', 2024, 'homeRuns'), /leader-mlb/);
  assert.doesNotMatch(leaders.format(30, 3, 'hitting', 2024, 'homeRuns'), /leader-nl/);
  assert.match(leaders.format(8, 1, 'pitching', 2024, 'wins'), /tied for the lead/);
  assert.match(leaders.format(8, 2, 'pitching', 2024, 'wins'), /leader-mlb/);
  assert.match(leaders.format('.320', 4, 'hitting', 2024, 'avg'), /leader-mlb/);
  assert.equal(leaders.format('.600', 6, 'hitting', 2024, 'avg'), '.600');
  assert.match(leaders.format('2.00', 5, 'pitching', 2024, 'era'), /leader-mlb/);
  assert.match(leaders.format(30, 3, 'hitting', 2024, 'rbi'), /RBI/);
  assert.match(leaders.format(30, 3, 'hitting', 2024, 'baseOnBalls'), /walks/);
  assert.match(leaders.format(7, 3, 'hitting', 2024, 'fwar'), /saved WAR snapshot/);
  assert.equal(leaders.format(30, 3, 'hitting', 2024, 'homeRuns', false), '30');
  assert.equal(leaders.format(30, 3, 'hitting', 2023, 'homeRuns'), '30');
  assert.match(leaders.format(30, 3, 'hitting', 2024, 'homeRuns'), /Led/);
  assert.equal(leaders.format('<missing>', 999, 'hitting', 2024, 'homeRuns'), '&lt;missing&gt;');
  assert.ok(calls.some(url => url.searchParams.get('playerPool') === 'QUALIFIED' &&
    url.searchParams.get('leaderCategories').includes('earnedRunAverage')));
  assert.ok(calls.some(url => url.searchParams.get('playerPool') === 'ALL' &&
    url.searchParams.get('leaderCategories').includes('saves')));
  assert.equal(Object.keys(leaders.parse({ leagueLeaders: [{ statGroup: 'pitching', season: '2024',
    gameType: { id: 'R' }, leaderCategory: 'homeRuns', leaders: [] }] }, 'hitting', 2024, ['homeRuns'])).length, 0);
  const elements = new Map();
  context.document = { querySelector(selector) {
    if (!elements.has(selector)) elements.set(selector, {});
    return elements.get(selector);
  } };
  context.window.location = { search: '?id=3&season=2024' };
  context.window.MLB_STATS_DATA = { season: 2024, players: [], teams: [] };
  const playerSource = fs.readFileSync(path.join(root, 'player.js'), 'utf8');
  vm.runInContext(playerSource.slice(0, playerSource.indexOf('const requestedType =')), context);
  context.person = { stats: [{ type: { displayName: 'yearByYear' }, group: { displayName: 'hitting' }, splits: [
    { season: '2024', numTeams: 2, sport: { id: 1 }, gameType: 'R', stat: { homeRuns: 30 } },
    { season: '2024', team: { id: 1, name: 'Team' }, sport: { id: 1 }, gameType: 'R', stat: { homeRuns: 30 } }
  ] }, { type: { displayName: 'career' }, group: { displayName: 'hitting' }, splits: [{ stat: { homeRuns: 60 } }] }] };
  vm.runInContext('renderHistory(person, { id: 3 })', context);
  const tableRows = elements.get('#battingHistoryRows').innerHTML.split('</tr>');
  assert.match(tableRows[0], /leader-mlb/);
  assert.doesNotMatch(tableRows[1], /stat-leader/);
  assert.doesNotMatch(elements.get('#battingHistoryTotals').innerHTML, /stat-leader/);
  vm.runInContext('renderSeason({ id: 3, hr: 30, avg: .3, ops: .9 })', context);
  assert.match(elements.get('#seasonStats').innerHTML, /leader-mlb/);
  if (process.argv.includes('--live')) {
    context.fetch = fetch;
    await leaders.load([{ group: 'hitting', season: '2022' }, { group: 'pitching', season: '2020' }], () => {});
    assert.match(leaders.format(62, 592450, 'hitting', 2022, 'homeRuns'), /leader-mlb/);
    assert.match(leaders.format(8, 669456, 'pitching', 2020, 'wins'), /leader-mlb/);
    assert.match(leaders.format(8, 506433, 'pitching', 2020, 'wins'), /leader-mlb/);
    assert.match(leaders.format(8, 506433, 'pitching', 2020, 'wins'), /tied for the lead/);
    console.log('Live MLB leaders verified, including both tied 2020 wins leaders.');
  }
  console.log('Leader checks passed: league colors, MLB precedence, ties, qualified rates, aliases, and exclusions.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

