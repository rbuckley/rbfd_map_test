import { bootApp, district, ok, section, done, click, goEdit, goStudy } from './harness.mjs';

const streets = ['Alpha St', 'Bravo Ave', 'Carter Rd'];
const { $, $$, ls } = await bootApp({ districts: { u1: district({ streets }) }, selected: 'u1' });

const excludeBtn = $('#excludeToggleBtn');
const userExcluded = () => (ls('u1') || {}).userExcluded || [];
const managerNames = () => $$('#exclusionManager .excl-item span').map(s => s.textContent);
const tap = n => click($(`.street[data-name="${n}"]`));

section('Exclude lives in Edit (not Study)');
tap('Bravo Ave');   // in Study, a tap must NOT open the edit row
ok($('#renameRow').style.display === 'none', 'no edit row on a Study tap');
goEdit($, 'streets');
tap('Bravo Ave');
ok($('#renameRow').style.display === 'flex' && excludeBtn.style.display !== 'none' && excludeBtn.textContent === 'Exclude', 'Edit tap shows the Exclude control');

section('clicking Exclude excludes the street and persists it');
click(excludeBtn);
ok(excludeBtn.textContent === 'Include', 'button flips to "Include"');
ok(userExcluded().includes('Bravo Ave'), 'persisted to progress.userExcluded');
ok(/Manage Exclusions \(1\)/.test($('#exclusionToggle').textContent), 'exclusion count updated to 1');

section('re-tapping the excluded street shows "Include"');
tap('Alpha St');
tap('Bravo Ave');
ok(excludeBtn.textContent === 'Include', 'excluded street re-opens as "Include"');

section('an excluded street is never chosen as a Test target');
goStudy($, 'test');
let picked = new Set();
for (let i = 0; i < 40; i++) {
  click($('#newQ'));
  const t = ($('#map .street.target') || {}).dataset?.name;
  if (t) picked.add(t);
}
ok(picked.size > 0 && !picked.has('Bravo Ave'), 'Test never targets the excluded street');
ok([...picked].every(n => n === 'Alpha St' || n === 'Carter Rd'), 'only the two active streets get quizzed');

section('Include re-activates the street');
goEdit($, 'streets');
tap('Bravo Ave');
click(excludeBtn);   // Include
ok(excludeBtn.textContent === 'Exclude' && !userExcluded().includes('Bravo Ave'), 'included again, removed from userExcluded');
ok(/Manage Exclusions \(0\)/.test($('#exclusionToggle').textContent), 'exclusion count back to 0');

section('Manage Exclusions panel lists an excluded street with Include');
tap('Carter Rd');
click(excludeBtn);   // exclude Carter Rd
click($('#exclusionToggle'));
ok(managerNames().includes('Carter Rd'), 'excluded street appears in Manage Exclusions');

done();
