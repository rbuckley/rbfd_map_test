// Boots against the REAL shipped built-in D1 (data/d1/*), catching regressions
// in loading the actual map data.
import { bootApp, ok, section, done, click } from './harness.mjs';

const { $, $$, state, ls } = await bootApp({ wait: 350 });

section('real D1 loads');
ok($('#map'), 'map svg rendered');
ok($('#map .__maprot'), 'rotation group present');
ok($$('#map .street').length >= 100, `streets rendered (${$$('#map .street').length})`);
ok($('#modeTabs'), 'header controls present');

section('rotation: honors the shipped default and persists a change');
const angle = () => { const m = ($('#map .__maprot').getAttribute('transform') || '').match(/rotate\((\d+)/); return m ? +m[1] : 0; };
ok(angle() === 270, 'D1 opens at its shipped default rotation (270°)');
const a0 = angle();
click($('#rotateBtn'));
const a1 = angle();
ok(a1 === (a0 + 90) % 360, `rotate advances 90° (${a0} -> ${a1})`);
const stored = (ls('rotations') || {}).d1;
ok(a1 === 0 ? stored === undefined : stored === a1, 'new angle persisted (or cleared at 0°)');

section('no uncaught errors during boot + interaction');
ok(state.errors.length === 0, 'zero window errors (' + state.errors.length + ')');

done();
