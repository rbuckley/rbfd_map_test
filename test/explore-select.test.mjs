import { bootApp, district, ok, section, done, click } from './harness.mjs';

const streets = ['Alpha St', 'Bravo Ave', 'Carter Rd'];
const { $ } = await bootApp({ districts: { u1: district({ streets }) }, selected: 'u1' });
const g = n => $(`.street[data-name="${n}"]`);
const hi = n => g(n).classList.contains('hover');

section('tapped street stays highlighted (no 1.2s fade)');
click(g('Alpha St'));
ok(hi('Alpha St'), 'Alpha highlighted on tap');
ok($('#renameRow').style.display === 'flex', 'inline row open');

section('tapping another street moves the highlight');
click(g('Bravo Ave'));
ok(hi('Bravo Ave') && !hi('Alpha St'), 'only one street highlighted at a time');

section('Cancel clears the highlight');
click($('#renameCancel'));
ok(!hi('Bravo Ave'), 'highlight cleared on Cancel');

section('switching modes clears any selection');
click(g('Carter Rd'));
ok(hi('Carter Rd'), 'Carter highlighted');
click($('#modeTabs [data-mode="test"]'));
ok(!hi('Carter Rd'), 'highlight cleared when leaving Explore');

section('renaming the selected street leaves no orphaned highlight');
click($('#modeTabs [data-mode="explore"]'));
click(g('Alpha St'));
ok(hi('Alpha St'), 'Alpha highlighted before rename');
$('#renameInput').value = 'Alpha Street';
click($('#renameSave'));   // hides row -> clears selection by design
ok(document.querySelectorAll('.street.hover').length === 0, 'no orphaned highlight after rename + dismiss');

done();
