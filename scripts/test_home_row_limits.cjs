const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const elements = new Map();
const context = vm.createContext({ window: {}, document: { querySelector(selector) {
  if (!elements.has(selector)) elements.set(selector, { handlers: {},
    addEventListener(event, callback) { this.handlers[event] = callback; } });
  return elements.get(selector);
} } });
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
vm.runInContext(source.slice(0, source.indexOf('els.searchForm.addEventListener')), context);
vm.runInContext(source.slice(source.indexOf('els.moreBatters.addEventListener'),
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
assert.equal(elements.get('#fewerBatters').hidden, true);
assert.equal(elements.get('#fewerPitchers').hidden, true);
assert.equal(elements.get('#moreBatters').hidden, false);
for (const expected of [50, 100, 180]) {
  elements.get('#moreBatters').handlers.click();
  assert.equal(rowCount('#playerRows'), expected);
  assert.equal(rowCount('#pitcherRows'), 10);
  assert.equal(elements.get('#fewerBatters').hidden, false);
}
assert.equal(elements.get('#moreBatters').hidden, true);
for (const expected of [100, 50]) {
  elements.get('#fewerBatters').handlers.click();
  assert.equal(rowCount('#playerRows'), expected);
  assert.equal(rowCount('#pitcherRows'), 10);
  assert.equal(elements.get('#fewerBatters').hidden, false);
  assert.equal(elements.get('#moreBatters').hidden, false);
}
elements.get('#fewerBatters').handlers.click();
assert.equal(rowCount('#playerRows'), 10);
assert.equal(elements.get('#fewerBatters').hidden, true);
assert.equal(elements.get('#moreBatters').hidden, false);
elements.get('#morePitchers').handlers.click();
assert.equal(rowCount('#pitcherRows'), 50);
assert.equal(elements.get('#fewerPitchers').hidden, false);
elements.get('#morePitchers').handlers.click();
assert.equal(rowCount('#pitcherRows'), 100);
assert.equal(rowCount('#playerRows'), 10);
elements.get('#morePitchers').handlers.click();
assert.equal(rowCount('#pitcherRows'), 120);
assert.equal(elements.get('#morePitchers').hidden, true);
for (const expected of [100, 50]) {
  elements.get('#fewerPitchers').handlers.click();
  assert.equal(rowCount('#pitcherRows'), expected);
  assert.equal(rowCount('#playerRows'), 10);
  assert.equal(elements.get('#fewerPitchers').hidden, false);
}
elements.get('#fewerPitchers').handlers.click();
assert.equal(rowCount('#pitcherRows'), 10);
assert.equal(elements.get('#fewerPitchers').hidden, true);
assert.doesNotMatch(elements.get('#playerRows').innerHTML, /Unqualified/);
assert.doesNotMatch(elements.get('#pitcherRows').innerHTML, /Unqualified/);
assert.equal(vm.runInContext('players.length', context), 302);
assert.equal(vm.runInContext('nextRowLimit(200)', context), 500);
assert.equal(vm.runInContext('nextRowLimit(500)', context), Infinity);
assert.equal(vm.runInContext('previousRowLimit(100)', context), 50);
assert.equal(vm.runInContext('previousRowLimit(Infinity, 800)', context), 500);
assert.equal(vm.runInContext('previousRowLimit(Infinity, 180)', context), 100);
assert.equal(vm.runInContext('previousRowLimit(500, 70)', context), 50);
vm.runInContext('players = fixture.slice(0, 6); renderTable();', context);
assert.equal(rowCount('#playerRows'), 6);
assert.equal(elements.get('#moreBatters').hidden, true);
assert.equal(elements.get('#fewerBatters').hidden, true);
vm.runInContext('players = []; renderTable(); renderPitchingTable();', context);
assert.equal(rowCount('#playerRows'), 0);
assert.equal(rowCount('#pitcherRows'), 0);
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const id of ['fewerBatters', 'fewerPitchers']) {
  assert.match(html, new RegExp(`id="${id}"[^>]*hidden>Show less`));
}
assert.doesNotMatch(html, /id="(?:batting|pitching)RowLimit"/);
console.log('Home table checks passed: progressive expansion, collapse, button visibility, independence, sorting, and qualification.');

