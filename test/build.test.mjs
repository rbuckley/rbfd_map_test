import { jsdomEnv, ok, section, done } from './harness.mjs';
const window = jsdomEnv();
const { addressesToBlockIndex } = await import('../js/mapImporter.js');
const { buildDistrictRecord, exportDistrictFiles, makeUniqueId } = await import('../js/builder.js');

section('addressesToBlockIndex: positions, block bucketing, name-variant merge, boundary clip');
const json = { elements: [
  { type: 'node', tags: { 'addr:housenumber': '234', 'addr:street': 'Carnegie Lane' }, lat: 0.50, lon: 0.50 },
  { type: 'node', tags: { 'addr:housenumber': '250', 'addr:street': 'Carnegie Lane' }, lat: 0.50, lon: 0.52 },
  { type: 'node', tags: { 'addr:housenumber': '330', 'addr:street': 'Carnegie Lane' }, lat: 0.60, lon: 0.50 },
  { type: 'node', tags: { 'addr:housenumber': '1500', 'addr:street': 'Aviation Blvd.' }, lat: 0.30, lon: 0.30 },
  { type: 'node', tags: { 'addr:housenumber': '1520', 'addr:street': 'Aviation Boulevard' }, lat: 0.31, lon: 0.31 },
  { type: 'node', tags: { 'addr:housenumber': '9999', 'addr:street': 'Outside St' }, lat: 9, lon: 9 },
] };
const idx = addressesToBlockIndex(json, [[0, 0], [1, 0], [1, 1], [0, 1]]);
ok(idx['Carnegie Lane'].length === 2 && idx['Carnegie Lane'][0].block === 200 && idx['Carnegie Lane'][1].block === 300, 'Carnegie -> 200 & 300 blocks, sorted');
ok(idx['Carnegie Lane'][0].count === 2 && Number.isFinite(idx['Carnegie Lane'][0].x), '200 block has 2 addrs + a centroid');
const av = idx['Aviation Boulevard'] || idx['Aviation Blvd.'];
ok(av && av.length === 1 && av[0].count === 2, 'Blvd./Boulevard variants merged (1500 block, 2 addrs)');
ok(!idx['Outside St'], 'address outside the boundary dropped');

section('buildDistrictRecord assembles record + svg from geometry');
const draft = {
  id: 't', name: 'T',
  streets: [{ name: 'Main St', segments: [[[0, 0], [100, 0]]] }, { name: 'Oak Ave', segments: [[[0, 50], [80, 50]]] }],
  features: [], excluded: new Set(['Oak Ave']), confusionGroups: { grp: ['Main St', 'Oak Ave'] },
  blocks: { 'Main St': [{ block: 100, x: 50, y: 0, count: 3 }] },
};
const rec = buildDistrictRecord(draft);
ok(JSON.stringify(rec.streets) === JSON.stringify(['Main St', 'Oak Ave']), 'streets = deduped names');
ok(rec.map === 'data/t/map.svg' && /^-?\d/.test(rec.viewBox), 'map path + computed viewBox');
ok(/data-name="Main St"/.test(rec.svgMarkup) && /data-name="Oak Ave"/.test(rec.svgMarkup), 'svg has a group per street');
ok(rec.blocks['Main St'] && JSON.stringify(rec.excluded) === JSON.stringify(['Oak Ave']), 'blocks + exclusions carried');
ok(rec.geometry === draft.streets, 'geometry (authoring) preserved');
ok(makeUniqueId('t', new Set(['t'])) === 't-2', 'makeUniqueId avoids collisions');

section('exportDistrictFiles splits into streets.json (keeps blocks) + map.svg (svg only)');
const blobs = [];
globalThis.Blob = class { constructor(parts) { this.text0 = String(parts[0]); } };
globalThis.URL.createObjectURL = b => { blobs.push(b); return 'blob:' + blobs.length; };
globalThis.URL.revokeObjectURL = () => {};
const msg = exportDistrictFiles(rec);
ok(/t\.streets\.json/.test(msg) && /t\.map\.svg/.test(msg), 'returns hand-off instructions');
ok(blobs.length === 2, 'two files downloaded');
const cfg = JSON.parse(blobs[0].text0);
ok(cfg.blocks && cfg.streets && cfg.viewBox, 'config keeps blocks/streets/viewBox');
ok(!('svgMarkup' in cfg) && !('geometry' in cfg) && !('features' in cfg), 'authoring/svg fields stripped from config');
ok(blobs[1].text0.startsWith('<svg'), 'map.svg is the raw svg');

done();
