// Barriers between the three top-level modes: Study | Edit | Exam.
import { bootApp, district, ok, section, done, click, goSection, goEdit, goStudy } from './harness.mjs';

const streets = ['Alpha St', 'Bravo Ave', 'Carter Rd'];
const rec = district({ streets, blocks: { 'Alpha St': [{ block: 100, x: 1, y: 1, count: 1 }] } });
const { window, $ } = await bootApp({ districts: { u1: rec }, selected: 'u1' });
const tap = n => click($(`.street[data-name="${n}"]`));

section('Study is the default and read-only');
ok($('#studyControls').style.display !== 'none' && $('#editControls').style.display === 'none', 'study chrome shown, edit hidden');
ok(!window.document.body.classList.contains('edit-active'), 'no edit accent in Study');
tap('Bravo Ave');
ok($('#feedback').textContent === 'Bravo Ave', 'Study tap reveals the name');
ok($('#renameRow').style.display === 'none', 'no edit row in Study');
ok($('#editControls').style.display === 'none', 'the Map menu (inside Edit) is unreachable from Study');

section('Edit is guarded + entity-scoped');
goEdit($, 'streets');
ok(window.document.body.classList.contains('edit-active') && $('#editBanner').style.display !== 'none', 'edit banner + accent');
ok($('#editScopeTabs [data-scope="streets"]') && $('#editScopeTabs [data-scope="blocks"]'), 'Streets | Blocks scope tabs present');
ok($('#studyControls').style.display === 'none', 'quiz/study controls hidden in Edit');
tap('Bravo Ave');
ok($('#renameRow').style.display === 'flex', 'Edit tap opens the edit panel');

section('Blocks scope shows the reserved placeholder');
click($('#editScopeTabs [data-scope="blocks"]'));
ok($('#editBlocksSurface').style.display !== 'none' && $('#editStreetsSurface').style.display === 'none', 'blocks surface shown, streets hidden');
ok(/coming soon/i.test($('#editBlocksSurface').textContent), 'placeholder text present');

section('Exam is a locked peer mode; cancel returns to Study');
goSection($, 'exam');
ok($('#examSetup').style.display === 'flex', 'exam setup shown on Exam section');
click($('#examCancel'));
ok($('#studyControls').style.display !== 'none' && !window.document.body.classList.contains('edit-active'), 'back to clean Study after cancel');

section('score is a Study-only readout');
goEdit($, 'streets');
ok(window.document.querySelector('.score').style.display === 'none', 'score hidden in Edit');
goStudy($, 'explore');
ok(window.document.querySelector('.score').style.display !== 'none', 'score shown in Study');

done();
