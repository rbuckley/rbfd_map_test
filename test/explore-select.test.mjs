import { bootApp, district, ok, section, done, click, goStudy, goEdit } from './harness.mjs';

const streets = ['Alpha St', 'Bravo Ave', 'Carter Rd'];
const { $ } = await bootApp({ districts: { u1: district({ streets }) }, selected: 'u1' });
const g = n => $(`.street[data-name="${n}"]`);
const hi = n => g(n).classList.contains('hover');

section('Study/Explore: tapped street stays highlighted (no 1.2s fade), no edit row');
click(g('Alpha St'));
ok(hi('Alpha St'), 'Alpha highlighted on tap');
ok($('#renameRow').style.display === 'none', 'no edit row in Study');

section('tapping another street moves the highlight');
click(g('Bravo Ave'));
ok(hi('Bravo Ave') && !hi('Alpha St'), 'only one street highlighted at a time');

section('switching Study sub-mode clears the selection');
goStudy($, 'test');
ok(!hi('Bravo Ave'), 'highlight cleared when leaving Explore');
goStudy($, 'explore');

section('Edit: Cancel clears the highlight');
goEdit($, 'streets');
click(g('Carter Rd'));
ok(hi('Carter Rd') && $('#renameRow').style.display === 'flex', 'Edit tap highlights + opens row');
click($('#renameCancel'));
ok(!hi('Carter Rd'), 'highlight cleared on Cancel');

section('renaming the selected street leaves no orphaned highlight');
click(g('Alpha St'));
ok(hi('Alpha St'), 'Alpha highlighted before rename');
$('#renameInput').value = 'Alpha Street';
click($('#renameSave'));   // hides row -> clears selection by design
ok(document.querySelectorAll('.street.hover').length === 0, 'no orphaned highlight after rename + dismiss');

done();
