import { jsdomEnv, ok, section, done } from './harness.mjs';
jsdomEnv();
const { applyRenamesToRecord, applyRenamesToSvg, reverseDisplayToOriginal, displayToOriginals, bakeRenamedRecord, mergeBlockEntries } =
  await import('../js/renames.js');

const rec = {
  id: 'd1', name: 'D', map: 'data/d1/map.svg', viewBox: '0 0 100 100',
  streets: ['A St', 'B Ave', 'C Rd'],
  blocks: {
    'A St': [{ block: 200, x: 10, y: 10, count: 2 }],
    'B Ave': [{ block: 200, x: 20, y: 20, count: 2 }, { block: 300, x: 30, y: 30, count: 1 }],
    'C Rd': [{ block: 100, x: 0, y: 0, count: 1 }],
  },
  confusionGroups: { g: ['A St', 'B Ave'] }, excluded: ['B Ave'],
  svgMarkup: '<svg id="map" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><g class="street" data-name="A St"><path class="vis" d="M0,0L1,1"/></g><g class="street" data-name="B Ave"><path class="vis" d="M2,2L3,3"/></g><g class="street" data-name="C Rd"><path class="vis" d="M4,4L5,5"/></g></svg>',
};

section('simple rename');
let out = applyRenamesToRecord(rec, { 'A St': 'Alpha Street' });
ok(out.streets.includes('Alpha Street') && !out.streets.includes('A St'), 'streets remapped');
ok(out.blocks['Alpha Street'] && !out.blocks['A St'], 'blocks re-keyed');
ok(out.confusionGroups.g.includes('Alpha Street'), 'confusion group remapped');
ok(out.excluded.includes('B Ave'), 'unrelated exclusion preserved');
ok(rec.streets.includes('A St'), 'original record untouched (clone)');

section('merge two streets (target already exists)');
out = applyRenamesToRecord(rec, { 'B Ave': 'A St' });
ok(JSON.stringify(out.streets) === JSON.stringify(['A St', 'C Rd']), 'merged streets deduped');
const a = out.blocks['A St'];
ok(a.length === 2, 'A St has 2 blocks after merge (200 combined, 300)');
const b200 = a.find(e => e.block === 200);
ok(b200.count === 4 && b200.x === 15 && b200.y === 15, '200 block: counts summed, weighted centroid');
ok(JSON.stringify(out.confusionGroups.g) === JSON.stringify(['A St']), 'confusion group collapsed');
ok(JSON.stringify(out.excluded) === JSON.stringify(['A St']), 'exclusion remapped to merge target');

section('mergeBlockEntries dedupes by block number');
const m = mergeBlockEntries([{ block: 100, x: 0, y: 0, count: 1 }, { block: 100, x: 10, y: 10, count: 1 }, { block: 200, x: 5, y: 5, count: 1 }]);
ok(m.length === 2 && m[0].block === 100 && m[0].count === 2 && m[0].x === 5, 'combined 100 block, sorted');

section('applyRenamesToSvg patches + merges groups');
const doc = new DOMParser().parseFromString(rec.svgMarkup, 'image/svg+xml');
const svg = doc.documentElement;
applyRenamesToSvg(svg, { 'B Ave': 'A St', 'C Rd': 'Cedar Road' });
ok(svg.querySelectorAll('.street').length === 2, 'two groups remain (B merged into A)');
ok(svg.querySelector('.street[data-name="A St"]').querySelectorAll('path').length === 2, 'A St group holds both paths');
ok(svg.querySelector('.street[data-name="Cedar Road"]') && !svg.querySelector('.street[data-name="B Ave"]'), 'C Rd renamed, B Ave gone');

section('reverseDisplayToOriginal + displayToOriginals');
const rev = reverseDisplayToOriginal(rec.streets, { 'A St': 'Alpha Street' });
ok(rev['Alpha Street'] === 'A St' && rev['C Rd'] === 'C Rd', 'display->original (renamed + identity)');
const groups = displayToOriginals(rec.streets, { 'B Ave': 'A St' });
ok(JSON.stringify(groups['A St'].sort()) === JSON.stringify(['A St', 'B Ave']), 'merged display lists both originals');
ok(groups['C Rd'].length === 1, 'unmerged street -> single original');

section('bakeRenamedRecord + merge->unmerge round-trip');
const baked = bakeRenamedRecord(rec, { 'B Ave': 'A St' });
ok(!baked.streets.includes('B Ave') && /data-name="A St"/.test(baked.svgMarkup) && !/data-name="B Ave"/.test(baked.svgMarkup), 'baked config + svg merged');
ok(baked.id === 'd1' && baked.map === 'data/d1/map.svg', 'baked keeps identity');
ok(applyRenamesToRecord(rec, {}) === rec, 'empty renames is a no-op (same ref)');
const merged = { 'B Ave': 'A St' };
const afterUnmerge = { ...merged }; for (const o of groups['A St']) delete afterUnmerge[o];
ok(applyRenamesToRecord(rec, afterUnmerge) === rec, 'record identical to pristine after unmerge');

done();
