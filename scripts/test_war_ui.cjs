const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const elements = new Map();
const context = vm.createContext({
  URLSearchParams,
  window: { location: { search: '?id=1&season=2026' }, MLB_STATS_DATA: { season: 2026 },
    WAR_DATA: { seasons: { '2026': { sources: {
      fwarBatting: { players: { '1': 0 } }, bwarBatting: { players: { '1': -0.5 } },
      fwarPitching: { players: { '1': 2.4 } }, bwarPitching: { players: { '1': 3.1 } }
    } } } } },
  document: { querySelector(selector) {
    if (!elements.has(selector)) elements.set(selector, {});
    return elements.get(selector);
  } }
});
const source = fs.readFileSync(path.join(root, 'player.js'), 'utf8');
vm.runInContext(source.slice(0, source.indexOf('const requestedType =')), context);
assert.equal(vm.runInContext('fmtFwar({ id: 1 })', context), '0.0');
assert.equal(vm.runInContext('savedWar({ id: 1 }, "bwar", "Batting")', context), -0.5);
assert.equal(vm.runInContext('savedWar({ id: 1 }, "fwar", "Pitching")', context), 2.4);
assert.equal(vm.runInContext('savedWar({ id: 999 }, "bwar", "Batting")', context), null);
vm.runInContext('renderPitchingSeason({ id: 1 })', context);
assert.match(elements.get('#seasonStats').innerHTML, /fWAR<\/dt><dd>2\.4/);
assert.match(elements.get('#seasonStats').innerHTML, /bWAR<\/dt><dd>3\.1/);
vm.runInContext('params.set("season", "2025")', context);
assert.equal(vm.runInContext('savedWar({ id: 1 }, "fwar", "Pitching")', context), null);
console.log('WAR UI checks passed: zero, negative, role, missing player, and season isolation.');

