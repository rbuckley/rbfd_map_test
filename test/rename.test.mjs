import { bootApp, district, ok, section, done, click, change, svgMarkup } from './harness.mjs';

const streets = ['Alpha St', 'Bravo Ave', 'S Pacific Coast Hwy', 'Pacific Coast Hwy'];
const rec = district({
  streets,
  confusionGroups: { grp: ['Alpha St', 'Bravo Ave'] },
  blocks: { 'S Pacific Coast Hwy': [{ block: 200, x: 20, y: 5, count: 2 }], 'Pacific Coast Hwy': [{ block: 300, x: 40, y: 5, count: 1 }] },
});
const SEED = { correct: 4, total: 5, missed: ['Alpha St'], userExcluded: [] };
const { window, $, $$, ls } = await bootApp({ districts: { u1: rec }, selected: 'u1', progress: { u1: SEED } });

const names = () => $$('#map .street').map(g => g.getAttribute('data-name'));
const rowInput = v => $$('#renameManager .rename-item input[type="text"]').find(i => i.value === v);

section('inline rename from Explore');
click($('.street[data-name="Alpha St"]'));
ok($('#renameRow').style.display === 'flex' && $('#renameInput').value === 'Alpha St', 'row appears, prefilled');
change($('#renameInput'), 'Alpha Street');
click($('#renameSave'));
ok(names().includes('Alpha Street') && !names().includes('Alpha St'), 'SVG data-name updated live');
ok(ls('renames').u1['Alpha St'] === 'Alpha Street', 'override persisted {orig -> new}');
ok($('#renameRow').style.display === 'none', 'row hides after save');

section('bulk list rename');
click($('#renameToggle'));
ok($('#renameManager').classList.contains('open'), 'manager opens');
change(rowInput('Bravo Ave'), 'Bravo Avenue');
ok(names().includes('Bravo Avenue') && ls('renames').u1['Bravo Ave'] === 'Bravo Avenue', 'list rename updates map + persists');

section('rename onto an existing name = merge (confirmed)');
window.confirm = () => true;
click($('.street[data-name="S Pacific Coast Hwy"]'));
change($('#renameInput'), 'Pacific Coast Hwy');
click($('#renameSave'));
ok(names().filter(n => n === 'Pacific Coast Hwy').length === 1, 'single PCH group after merge');
ok($('.street[data-name="Pacific Coast Hwy"]').querySelectorAll('path').length === 4, 'merged group holds both streets’ paths');
ok(ls('renames').u1['S Pacific Coast Hwy'] === 'Pacific Coast Hwy', 'merge recorded');

section('declined merge is a no-op');
window.confirm = () => false;
const before = names().slice();
click($('.street[data-name="Bravo Avenue"]'));
change($('#renameInput'), 'Pacific Coast Hwy');
click($('#renameSave'));
ok(JSON.stringify(names()) === JSON.stringify(before), 'declining confirm leaves the map unchanged');

section('practice progress untouched by edits');
ok(JSON.stringify(ls('u1')) === JSON.stringify(SEED), 'progress key byte-identical');

done();
