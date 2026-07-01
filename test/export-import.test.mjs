import { bootApp, ok, section, done, click } from './harness.mjs';

// The reported bug: only built-in name edits (no user districts) — Export all
// must still produce a backup instead of dead-ending.
const { window, $, state } = await bootApp({
  renames: { d1: { 'Pacific Coast Highway': 'PCH' } },
  rotations: { d1: 90 },
});

section('Export all backs up built-in edits (renames + rotation)');
state.downloads = 0; state.alerts.length = 0;
click($('#exportAllBtn'));
ok(state.downloads === 1, 'a backup file was generated (download triggered)');
ok(!state.alerts.some(a => /Nothing to back up|No created districts/.test(a)), 'no dead-end "nothing to export" alert');

section('Export this map runs (bakes renames + rotation)');
state.downloads = 0;
click($('#exportMapBtn'));
ok(state.downloads >= 1, 'export this map produced file(s)');

section('empty store shows the helpful message, not a download');
window.localStorage.clear();
state.downloads = 0; state.alerts.length = 0;
click($('#exportAllBtn'));
ok(state.downloads === 0 && state.alerts.some(a => /Nothing to back up/.test(a)), 'empty -> message, no download');
ok(state.alerts.some(a => /Export this map/.test(a)), 'message points to "Export this map"');

done();
