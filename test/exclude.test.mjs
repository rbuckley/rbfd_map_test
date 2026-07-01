import { bootApp, district, ok, section, done, click } from './harness.mjs';

const streets = ['Alpha St', 'Bravo Ave', 'Carter Rd'];
const { $, $$, ls } = await bootApp({ districts: { u1: district({ streets }) }, selected: 'u1' });

const excludeBtn = $('#excludeToggleBtn');
const userExcluded = () => (ls('u1') || {}).userExcluded || [];
const managerNames = () => $$('#exclusionManager .excl-item span').map(s => s.textContent);

section('Explore tap shows an Exclude control for the street');
click($('.street[data-name="Bravo Ave"]'));
ok($('#renameRow').style.display === 'flex', 'inline row opens on Explore tap');
ok(excludeBtn.style.display !== 'none' && excludeBtn.textContent === 'Exclude', 'Exclude button shown, labelled "Exclude"');

section('clicking Exclude excludes the street and persists it');
click(excludeBtn);
ok(excludeBtn.textContent === 'Include', 'button flips to "Include"');
ok(userExcluded().includes('Bravo Ave'), 'persisted to progress.userExcluded');
ok(/Manage Exclusions \(1\)/.test($('#exclusionToggle').textContent), 'exclusion count updated to 1');

section('re-tapping the excluded street shows "Include"');
click($('.street[data-name="Alpha St"]'));   // tap another to reset row
click($('.street[data-name="Bravo Ave"]'));
ok(excludeBtn.textContent === 'Include', 'excluded street re-opens as "Include"');

section('an excluded street is never chosen as a Test target');
click($('#modeTabs [data-mode="test"]'));
let picked = new Set();
for (let i = 0; i < 40; i++) {
  click($('#newQ'));
  const t = ($('#map .street.target') || {}).dataset?.name;
  if (t) picked.add(t);
}
ok(picked.size > 0 && !picked.has('Bravo Ave'), 'Test never targets the excluded street');
ok([...picked].every(n => n === 'Alpha St' || n === 'Carter Rd'), 'only the two active streets get quizzed');

section('Include re-activates the street');
click($('#modeTabs [data-mode="explore"]'));
click($('.street[data-name="Bravo Ave"]'));
click(excludeBtn);   // Include
ok(excludeBtn.textContent === 'Exclude' && !userExcluded().includes('Bravo Ave'), 'included again, removed from userExcluded');
ok(/Manage Exclusions \(0\)/.test($('#exclusionToggle').textContent), 'exclusion count back to 0');

section('Manage Exclusions panel lists an excluded street with Include');
click($('.street[data-name="Carter Rd"]'));
click(excludeBtn);   // exclude Carter Rd
click($('#exclusionToggle'));
ok(managerNames().includes('Carter Rd'), 'excluded street appears in Manage Exclusions');

done();
