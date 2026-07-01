import { bootApp, district, ok, section, done, click } from './harness.mjs';

const streets = ['Alpha St', 'Bravo Ave', 'S Pacific Coast Hwy', 'Pacific Coast Hwy', 'N Pacific Coast Hwy'];
const rec = district({
  streets,
  blocks: {
    'S Pacific Coast Hwy': [{ block: 200, x: 20, y: 5, count: 2 }],
    'Pacific Coast Hwy': [{ block: 300, x: 40, y: 5, count: 1 }],
    'N Pacific Coast Hwy': [{ block: 400, x: 60, y: 5, count: 1 }],
  },
});
const { window, $, $$, ls } = await bootApp({ districts: { u1: rec }, selected: 'u1' });

const names = () => $$('#map .street').map(g => g.getAttribute('data-name'));
const rowFor = n => $$('#renameManager .rename-item').find(r => r.querySelector('input[type="text"]')?.value === n);
const mergeBtn = () => $('#renameManager .rename-toolbar button');
const renames = () => ls('renames')?.u1 || {};
const pch = ['S Pacific Coast Hwy', 'Pacific Coast Hwy', 'N Pacific Coast Hwy'];

section('bulk list: select 2+ and Merge');
click($('#renameToggle'));
ok(/Merge selected \(0\)/.test(mergeBtn().textContent) && mergeBtn().disabled, 'merge disabled at 0 selected');
for (const n of pch) click(rowFor(n).querySelector('input[type="checkbox"]'));
ok(/Merge selected \(3\)/.test(mergeBtn().textContent) && !mergeBtn().disabled, 'enabled at 3 selected');
window.prompt = () => 'Pacific Coast Hwy';
click(mergeBtn());
ok(names().filter(n => n === 'Pacific Coast Hwy').length === 1, 'one PCH group on the map');
ok($('.street[data-name="Pacific Coast Hwy"]').querySelectorAll('path').length === 6, 'merged group holds all 3 sections (3×2 paths)');
ok(renames()['S Pacific Coast Hwy'] === 'Pacific Coast Hwy' && renames()['N Pacific Coast Hwy'] === 'Pacific Coast Hwy' && !('Pacific Coast Hwy' in renames()), 'two overrides recorded, keeper has none');

section('merged row shows badge + unmerge + split controls');
const row = rowFor('Pacific Coast Hwy');
ok(/merged ×3/.test(row.textContent) && row.querySelector('.rename-unmerge'), 'badge + Unmerge present');
ok(row.querySelectorAll('.rename-sub-item').length === 3 && row.querySelectorAll('.rename-split').length === 2, '3 constituents, 2 split buttons (anchor excluded)');

section('split one section out (partial unmerge)');
const nSub = [...row.querySelectorAll('.rename-sub-item')].find(s => /N Pacific Coast Hwy/.test(s.textContent));
click(nSub.querySelector('.rename-split'));
ok(names().includes('N Pacific Coast Hwy') && names().filter(n => n === 'Pacific Coast Hwy').length === 1, 'N PCH separated, PCH still ×2');
ok(!('N Pacific Coast Hwy' in renames()) && renames()['S Pacific Coast Hwy'] === 'Pacific Coast Hwy', 'only N override dropped');

section('full unmerge restores all sections');
click(rowFor('Pacific Coast Hwy').querySelector('.rename-unmerge'));
ok(pch.every(n => names().includes(n)) && Object.keys(renames()).length === 0, 'all 3 restored, overrides cleared');

section('map: two-tap “Merge with…” then Unmerge');
window.confirm = () => true;
click($('.street[data-name="Alpha St"]'));
ok($('#unmergeBtn').style.display === 'none', 'Unmerge hidden for a non-merged street');
click($('#mergeWithBtn'));
click($('.street[data-name="Bravo Ave"]'));
ok(names().filter(n => n === 'Alpha St').length === 1 && !names().includes('Bravo Ave'), 'Bravo merged into Alpha via two taps');
click($('.street[data-name="Alpha St"]'));
ok($('#unmergeBtn').style.display !== 'none', 'Unmerge shown for the merged street');
click($('#unmergeBtn'));
ok(names().includes('Bravo Ave') && names().includes('Alpha St') && Object.keys(renames()).length === 0, 'split apart again, overrides cleared');

done();
