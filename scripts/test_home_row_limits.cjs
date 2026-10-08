const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const elements = new Map();
const context = vm.createContext({ window: {}, document: { querySelector(selector) {
  if (!elements.has(selector)) elements.set(selector, { value: '10', handlers: {},
    addEventListener(event, callback) { this.handlers[event] = callback; } });
  return elements.get(selector);
} } });
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
vm.runInContext(source.slice(0, source.indexOf('els.searchForm.addEventListener')), context);
vm.runInContext(source.slice(source.indexOf('els.battingRowLimit.addEventListener'),
  source.indexOf('document.querySelectorAll("th button")')), context);
context.fixture = [
  ...Array.from({ length: 180 }, (_, i) => ({ id: `h${i}`, name: `Hitter ${i}`, hasBatting: true,
    ops: i / 100, avg: .3, obp: .4, slg: .5, teamAbbr: 'MLB', pos: 'DH' })),
  ...Array.from({ length: 120 }, (_, i) => ({ id: `p${i}`, name: `Pitcher ${i}`, hasBatting: false,
    hasPitching: true, era: 1 + i / 100, whip: 1, teamAbbr: 'MLB' })),
  { id: 'unqualified', name: 'Unqualified hitter', ops: 99 },
  { id: 'unqualifiedPitcher', name: 'Unqualified pitcher', hasBatting: false, hasPitching: true, era: 0 }
];
vm.runInContext('players = fixture; qualifiedPlayerIds = new Set(fixture.slice(0, 180).map(p => p.id)); qualifiedPitcherIds = new Set(fixture.slice(180, 300).map(p => p.id)); renderTable(); renderPitchingTable();', context);
const rowCount = id => (elements.get(id).innerHTML.match(/<tr>/g) ?? []).length;
assert.equal(rowCount('#playerRows'), 10);
assert.equal(rowCount('#pitcherRows'), 10);
assert.match(elements.get('#playerRows').innerHTML, /Hitter 179/);
for (const [option, expected] of [['50', 50], ['100', 100], ['200', 180], ['500', 180], ['all', 180], ['10', 10]]) {
  const control = elements.get('#battingRowLimit');
  control.value = option;
  control.handlers.change();
  assert.equal(rowCount('#playerRows'), expected);
  assert.equal(rowCount('#pitcherRows'), 10);
}
elements.get('#pitchingRowLimit').value = '100';
elements.get('#pitchingRowLimit').handlers.change();
assert.equal(rowCount('#pitcherRows'), 100);
assert.equal(rowCount('#playerRows'), 10);
elements.get('#pitchingRowLimit').value = 'all';
elements.get('#pitchingRowLimit').handlers.change();
assert.equal(rowCount('#pitcherRows'), 120);
assert.doesNotMatch(elements.get('#playerRows').innerHTML, /Unqualified/);
assert.doesNotMatch(elements.get('#pitcherRows').innerHTML, /Unqualified/);
assert.equal(vm.runInContext('players.length', context), 302);
assert.equal(vm.runInContext('tableRowLimit("invalid")', context), 10);
vm.runInContext('players = []; renderTable(); renderPitchingTable();', context);
assert.equal(rowCount('#playerRows'), 0);
assert.equal(rowCount('#pitcherRows'), 0);
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const id of ['battingRowLimit', 'pitchingRowLimit']) {
  assert.match(html, new RegExp(`id="${id}"[^>]*>\\s*<option value="10">Top 10`));
}
console.log('Home table checks passed: defaults, dropdown changes, independent limits, sorting, qualification, and empty lists.');

