import { bootApp, district, ok, section, done, click, change, input, wait } from './harness.mjs';

const streets = ['Alpha St', 'Bravo Ave', 'Carter Rd', 'Delta Way'];
const { $, $$ } = await bootApp({ districts: { u1: district({ streets }) }, selected: 'u1' });

const modeTab = m => $(`#studyTabs [data-mode="${m}"]`);   // Study sub-tabs
const targetName = () => ($('#map .street.target') || {}).dataset?.name;

section('Explore: tapping a street reveals its name');
click($('.street[data-name="Bravo Ave"]'));
ok($('#feedback').textContent === 'Bravo Ave', 'feedback shows the tapped street name');

section('Test / Random / Dropdown: correct answer scores');
click(modeTab('test'));
ok($('#testToggles').style.display !== 'none', 'test toggles shown');
ok($('#newQ').style.display !== 'none', 'New button visible in Test/Random');
click($('#newQ'));
let t = targetName();
ok(!!t, 'a target street is highlighted: ' + t);
change($('#dropdown'), t);   // dropdown change submits
ok($('#score').textContent === '1/1', 'correct dropdown answer -> 1/1');

section('Type answer method');
click($('#answerTabs [data-answer="type"]'));
click($('#newQ'));
t = targetName();
input($('#textbox'), t);
click($('#submitAns'));
ok($('#score').textContent === '2/2', 'correct typed answer -> 2/2');

section('Click selection: tapping a street quizzes it (no New button)');
click($('#selectionTabs [data-selection="click"]'));
ok($('#newQ').style.display === 'none', 'New hidden in Click selection');
click($('.street[data-name="Carter Rd"]'));
ok(targetName() === 'Carter Rd', 'clicked street becomes the target');
input($('#textbox'), 'Carter Rd');
click($('#submitAns'));
ok($('#score').textContent === '3/3', 'answering the clicked street -> 3/3');

section('Reveal names the current target');
click($('#selectionTabs [data-selection="random"]'));
click($('#answerTabs [data-answer="dropdown"]'));
click($('#newQ'));
t = targetName();
click($('#reveal'));
ok($('#feedback').textContent.includes(t), 'Reveal shows the answer');

done();
