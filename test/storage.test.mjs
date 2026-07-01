import { jsdomEnv, ok, section, done } from './harness.mjs';
const w = jsdomEnv();
globalThis.localStorage = w.localStorage;
const st = await import('../js/storage.js');

section('progress');
ok(JSON.stringify(st.loadProgress('x')) === JSON.stringify({ correct: 0, total: 0, missed: [], userExcluded: [] }), 'default progress');
st.saveProgress('x', { correct: 3, total: 5, missed: new Set(['A']), userExcluded: new Set(['B']) });
let p = st.loadProgress('x');
ok(p.correct === 3 && p.total === 5 && p.missed[0] === 'A' && p.userExcluded[0] === 'B', 'saved/loaded (sets serialized to arrays)');
st.clearProgress('x');
ok(st.loadProgress('x').total === 0, 'cleared');

section('user districts CRUD');
st.saveUserDistrict({ id: 'u1', name: 'One', streets: ['A'], svgMarkup: '<svg/>' });
st.saveUserDistrict({ id: 'u2', name: 'Two', streets: ['B'], svgMarkup: '<svg/>' });
ok(Object.keys(st.loadUserDistricts()).length === 2 && st.getUserDistrict('u2').name === 'Two', 'saved two, fetch one');
st.deleteUserDistrict('u1');
ok(!st.getUserDistrict('u1') && st.getUserDistrict('u2'), 'deleted one, kept other');

section('renames store');
ok(Object.keys(st.loadRenames('d1')).length === 0, 'no renames by default');
st.saveRenames('d1', { 'Old St': 'New St' });
ok(st.loadRenames('d1')['Old St'] === 'New St', 'saved/loaded');
st.saveRenames('d1', {});
ok(Object.keys(st.loadRenames('d1')).length === 0, 'empty map clears the entry');

section('rotation store');
ok(st.loadRotation('d1') === undefined, 'unset -> undefined (falls back to config)');
st.saveRotation('d1', 270);
ok(st.loadRotation('d1') === 270, 'saved/loaded');
st.saveRotation('d1', 0);
ok(st.loadRotation('d1') === undefined, 'saving 0 clears it (default)');

section('backup bundle: wrapped export + import (districts + renames + rotations)');
st.saveRenames('d2', { 'A': 'B' });
st.saveRotation('d2', 90);
const bundle = JSON.parse(st.exportDistrictsBundle());
ok(bundle.districts && bundle.renames && bundle.rotations, 'wrapped shape { districts, renames, rotations }');
ok(bundle.renames.d2.A === 'B' && bundle.rotations.d2 === 90, 'renames + rotations included');
localStorage.clear();
let res = st.importDistrictsBundle(bundle);
ok(res.districts === 1 && res.renames === 1 && st.loadRenames('d2').A === 'B' && st.loadRotation('d2') === 90, 'round-trip restores all three');
ok(res.firstId === 'u2', 'firstId is an imported district');

section('legacy flat bundle still imports (backward compatible)');
localStorage.clear();
res = st.importDistrictsBundle({ torrance: { id: 'torrance', name: 'T', streets: [], svgMarkup: '' } });
ok(res.districts === 1 && res.renames === 0 && st.getUserDistrict('torrance'), 'flat map imported as districts');
ok(st.importDistrictsBundle({ districts: { bad: { name: 'no id' } }, renames: {} }).districts === 0, 'records without id skipped');

done();
