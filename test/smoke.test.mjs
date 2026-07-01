// Boots against the REAL shipped built-in D1 (data/d1/*), catching regressions
// in loading the actual map data.
import { bootApp, ok, section, done, click } from './harness.mjs';

const { $, $$, state, ls } = await bootApp({ wait: 350 });

section('real D1 loads');
ok($('#map'), 'map svg rendered');
ok($('#map .__maprot'), 'rotation group present');
ok($$('#map .street').length >= 100, `streets rendered (${$$('#map .street').length})`);
ok($('#modeTabs'), 'header controls present');

section('rotation persists on the real map');
click($('#rotateBtn'));
ok((ls('rotations') || {}).d1 === 90 && /rotate\(90 /.test($('#map .__maprot').getAttribute('transform')), 'D1 rotate persisted to 90°');

section('no uncaught errors during boot + interaction');
ok(state.errors.length === 0, 'zero window errors (' + state.errors.length + ')');

done();
