// Future-proofing seams: streets & blocks as parallel entities, and a
// target-type-agnostic exam. A district WITHOUT block data here.
import { bootApp, district, ok, section, done, click, goEdit, goSection } from './harness.mjs';

const streets = ['Alpha St', 'Bravo Ave', 'Carter Rd', 'Delta Way'];
const { window, $, $$ } = await bootApp({ districts: { u1: district({ streets }) }, selected: 'u1' });
const setVal = (el, v) => { el.value = v; el.dispatchEvent(new window.Event('input')); };

section('Edit scope reflects available entities (no blocks -> Blocks scope hidden)');
goEdit($, 'streets');
const streetsTab = $('#editScopeTabs [data-scope="streets"]');
const blocksTab = $('#editScopeTabs [data-scope="blocks"]');
ok(streetsTab && streetsTab.style.display !== 'none', 'Streets scope always available');
ok(blocksTab && blocksTab.style.display === 'none', 'Blocks scope hidden when the district has no block data');
ok($('#editStreetsSurface').style.display !== 'none', 'streets edit surface active');

section('Streets scope stays functional as the first entity');
click($('.street[data-name="Alpha St"]'));
ok($('#renameRow').style.display === 'flex', 'street tap opens the streets edit panel');

section('Exam is target-type-agnostic (question carries a prompt)');
goSection($, 'exam');
setVal($('#examName'), 'A'); setVal($('#examBadge'), 'B');
$$('#examCoverage .mode-tab').at(-1).click();   // Full coverage
click($('#examStart'));
ok(/^Locate: /.test($('#examLocate').textContent), 'running question renders from its prompt field (street type today)');
ok(streets.includes($('#examLocate').textContent.replace(/^Locate: /, '')), 'target is one of the street entities');
click($('#examEnd'));
click($('#examDone'));

done();
