import { bootApp, district, ok, section, done, click } from './harness.mjs';

// Config ships rotation 180; a local override of 90 should win at load.
const rec = district({ streets: ['Alpha St', 'Bravo Ave'], rotation: 180, viewBox: '0 0 400 200' });
const { $, ls } = await bootApp({ districts: { u1: rec }, selected: 'u1', rotations: { u1: 90 } });
const rotG = () => $('#map .__maprot');
const rots = () => ls('rotations') || {};

section('local override wins over the config rotation at load');
ok(/rotate\(90 /.test(rotG().getAttribute('transform') || ''), 'loaded at overridden 90° (not config 180°)');

section('rotating auto-persists per district');
click($('#rotateBtn'));   // 90 -> 180
ok(rots().u1 === 180 && /rotate\(180 /.test(rotG().getAttribute('transform')), 'rotation persisted and shown (180°)');

section('rotating back to 0° clears the stored override');
click($('#rotateBtn'));   // 180 -> 270
click($('#rotateBtn'));   // 270 -> 0
ok(rots().u1 === undefined, '0° clears the override (default)');
ok(!rotG().getAttribute('transform'), 'no transform at 0°');

done();
