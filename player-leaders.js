window.PLAYER_LEADERS = (() => {
  const categories = {
    hitting: { ALL: ['runs', 'hits', 'doubles', 'triples', 'homeRuns', 'runsBattedIn', 'stolenBases', 'walks'],
      QUALIFIED: ['battingAverage', 'onBasePercentage', 'sluggingPercentage', 'onBasePlusSlugging'] },
    pitching: { ALL: ['wins', 'saves', 'inningsPitched', 'strikeouts'],
      QUALIFIED: ['earnedRunAverage', 'walksAndHitsPerInningPitched'] }
  };
  const fields = { avg: 'battingAverage', obp: 'onBasePercentage', slg: 'sluggingPercentage', ops: 'onBasePlusSlugging',
    era: 'earnedRunAverage', whip: 'walksAndHitsPerInningPitched', strikeOuts: 'strikeouts', rbi: 'runsBattedIn', baseOnBalls: 'walks' };
  const names = { runs: 'runs', hits: 'hits', doubles: 'doubles', triples: 'triples', homeRuns: 'home runs',
    runsBattedIn: 'RBI', stolenBases: 'stolen bases', walks: 'walks', battingAverage: 'batting average',
    onBasePercentage: 'on-base percentage', sluggingPercentage: 'slugging percentage', onBasePlusSlugging: 'OPS',
    wins: 'wins', saves: 'saves', inningsPitched: 'innings pitched', strikeouts: 'strikeouts',
    earnedRunAverage: 'ERA', walksAndHitsPerInningPitched: 'WHIP', fwar: 'fWAR', bwar: 'bWAR' };
  const scopes = [['MLB', null, 'the major leagues'], ['AL', 103, 'the American League'], ['NL', 104, 'the National League']];
  const records = new Map();
  const requests = new Map();
  let currentSeasonEnd = null;
  const escape = value => String(value ?? '-').replace(/[&<>"']/g, char =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

  function parse(payload, group, season, allowed) {
    const result = {};
    for (const board of payload.leagueLeaders ?? []) {
      if (board.statGroup !== group || String(board.season) !== String(season) ||
          board.gameType?.id !== 'R' || !allowed.includes(board.leaderCategory)) continue;
      const first = (board.leaders ?? []).filter(row => Number(row.rank) === 1 && row.person?.id &&
        Number.isFinite(Number(row.value)));
      result[board.leaderCategory] = first.map(row => ({ id: String(row.person.id), value: row.value, tied: first.length > 1 }));
    }
    return result;
  }

  async function fetchBoard(group, season, scope, leagueId, pool) {
    const key = `${group}:${season}:${scope}:${pool}`;
    if (requests.has(key)) return requests.get(key);
    const task = (async () => {
      const storageKey = `boxscore-leaders-v1:${key}`;
      const ttl = Number(season) < new Date().getFullYear() ? 30 * 86400000 : 5 * 60000;
      try {
        const saved = JSON.parse(window.localStorage.getItem(storageKey));
        if (saved && Date.now() - saved.updatedAt < ttl) {
          records.set(key, saved.data);
          return;
        }
      } catch (_) { /* Private browsing may disable local storage. */ }
      const search = new URLSearchParams({ leaderCategories: categories[group][pool].join(','), statGroup: group,
        season: String(season), sportId: '1', gameType: 'R', playerPool: pool, limit: '1' });
      if (leagueId) search.set('leagueId', String(leagueId));
      const response = await fetch(`https://statsapi.mlb.com/api/v1/stats/leaders?${search}`);
      if (!response.ok) throw new Error('MLB leaders unavailable');
      const data = parse(await response.json(), group, season, categories[group][pool]);
      records.set(key, data);
      try { window.localStorage.setItem(storageKey, JSON.stringify({ updatedAt: Date.now(), data })); } catch (_) {}
    })();
    requests.set(key, task);
    try { await task; } catch (error) { requests.delete(key); throw error; }
  }

  async function load(jobs, onUpdate) {
    try {
      const response = await fetch(`https://statsapi.mlb.com/api/v1/seasons/${new Date().getFullYear()}?sportId=1`);
      if (response.ok) currentSeasonEnd = (await response.json()).seasons?.[0]?.regularSeasonEndDate ?? null;
    } catch (_) {}
    // Limit concurrent seasons while keeping each season's six small feeds together.
    const queue = [...jobs];
    async function worker() {
      while (queue.length) {
        const { group, season } = queue.shift();
        await Promise.allSettled(scopes.flatMap(([scope, leagueId]) => ['ALL', 'QUALIFIED'].map(pool =>
          fetchBoard(group, season, scope, leagueId, pool))));
        onUpdate();
      }
    }
    await Promise.all([worker(), worker()]);
  }

  function format(value, id, group, season, field, eligible = true) {
    const plain = escape(value);
    if (!eligible || value == null || value === '-') return plain;
    const category = fields[field] ?? field;
    let winner = null;
    for (const [scope, , scopeName] of scopes) {
      const pool = categories[group]?.QUALIFIED.includes(category) ? 'QUALIFIED' : 'ALL';
      const rows = records.get(`${group}:${season}:${scope}:${pool}`)?.[category] ?? [];
      const match = rows.find(row => row.id === String(id));
      if (match) { winner = { scope, scopeName, ...match }; break; }
    }
    if (!winner && ['fwar', 'bwar'].includes(field)) {
      const role = group === 'pitching' ? 'Pitching' : 'Batting';
      const source = window.WAR_DATA?.seasons?.[String(season)]?.sources?.[field + role];
      const values = Object.values(source?.players ?? {}).filter(v => typeof v === 'number' && Number.isFinite(v));
      const own = source?.players?.[String(id)];
      const best = values.length ? Math.max(...values) : null;
      if (typeof own === 'number' && own === best) winner = { scope: 'MLB', scopeName: 'the major leagues',
        value: own.toFixed(1), tied: values.filter(v => v === best).length > 1, saved: true };
    }
    if (!winner) return plain;
    const year = new Date().getFullYear();
    const finished = Number(season) < year || (Number(season) === year && currentSeasonEnd &&
      new Date().toISOString().slice(0, 10) > currentSeasonEnd);
    const verb = finished ? 'Led' : 'Leads';
    const title = `${verb} ${winner.scopeName} in ${names[category] ?? category} (${season})${winner.tied ? '; tied for the lead' : ''}; leaderboard value: ${winner.value}${winner.saved ? '; saved WAR snapshot' : ''}`;
    return `<span class="stat-leader leader-${winner.scope.toLowerCase()}" title="${escape(title)}" aria-label="${escape(`${value}; ${title}`)}">${plain}<sup aria-hidden="true">${winner.scope}</sup></span>`;
  }

  return { load, format, parse };
})();

