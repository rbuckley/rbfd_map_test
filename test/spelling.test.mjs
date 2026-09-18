// Typo tolerance: the name matcher accepts minor misspellings within a small,
// length-scaled edit budget (0 for very short names, up to 2 for long ones),
// on top of the case/abbreviation normalization. Shared by Test and the exam.
import { bootApp, district, ok, section, done, click, input, goStudy } from './harness.mjs';

const streets = ['Ash', 'Oak', 'Pine Street', 'Washington Boulevard', 'Riverside Drive'];
const { $ } = await bootApp({ districts: { u1: district({ streets }) }, selected: 'u1' });

const ask = n => click($(`.street[data-name="${n}"]`));   // click-selection picks the target
const answer = v => { input($('#textbox'), v); click($('#submitAns')); };

goStudy($, 'test');
click($('#answerTabs [data-answer="type"]'));
click($('#selectionTabs [data-selection="click"]'));

section('a minor typo in a long name is accepted');
ask('Washington Boulevard'); answer('Washingtn Boulevard');   // 1 missing letter
ok($('#score').textContent === '1/1', 'single-letter typo counts correct');

section('a genuinely different name is still wrong');
ask('Riverside Drive'); answer('Riverside Avenue');           // wrong suffix, far apart
ok($('#score').textContent === '1/2', 'a different street name is not fuzzy-accepted');

section('abbreviation + a typo together still resolve');
ask('Pine Street'); answer('Pyne St');                        // St→Street, plus i→y
ok($('#score').textContent === '2/3', 'abbrev expansion + one typo counts correct');

section('very short names stay strict (no typo budget)');
ask('Oak'); answer('Ok');                                     // 3 letters: 0 budget
ok($('#score').textContent === '2/4', 'a typo on a 3-letter name is rejected');
ask('Ash'); answer('Ash');
ok($('#score').textContent === '3/5', 'exact short name still correct');

done();
