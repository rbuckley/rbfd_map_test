// Exam · click-to-fill format: tap a street, type its name. Scored by name
// match (same normalization as Test), no feedback until results.
import { bootApp, district, ok, section, done, click, goSection } from './harness.mjs';

const streets = ['Alpha St', 'Bravo Ave', 'Carter Rd'];
const { window, $, $$ } = await bootApp({ districts: { u1: district({ streets }) }, selected: 'u1' });
const setVal = (el, v) => { el.value = v; el.dispatchEvent(new window.Event('input')); };
const tap = n => $(`.street[data-name="${n}"]`).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const cls = (n, c) => $(`.street[data-name="${n}"]`).classList.contains(c);

section('setup: pick the Click-to-fill format');
goSection($, 'exam');
$$('#examFormat .mode-tab').find(b => /click to fill/i.test(b.textContent)).click();
setVal($('#examName'), 'Jane'); setVal($('#examBadge'), 'FF-1');
click($('#examStart'));
ok($('body').classList.contains('exam-active'), 'lockdown on');
ok(/Named 0 of 3/.test($('#examProgress').textContent), 'progress counts named-of-total');
ok($('#examAnswer').style.display !== 'none' && $('#examSubmit').disabled, 'answer box shown, Submit locked until a pick + text');

section('answer 1: tap a street, type its name (normalized match)');
tap('Alpha St');
ok(cls('Alpha St', 'exam-pick') && $('#examSubmit').disabled, 'tap picks the street; Submit still locked with empty box');
setVal($('#examAnswer'), 'alpha street');   // case + abbrev variation, still correct
ok(!$('#examSubmit').disabled, 'Submit unlocks once text is entered');
click($('#examSubmit'));
ok(/Named 1 of 3/.test($('#examProgress').textContent), 'progress advances');
ok(cls('Alpha St', 'exam-done') && !cls('Alpha St', 'exam-pick'), 'answered street marked done, no correctness leak');
ok($('#examAnswer').value === '', 'answer box cleared for the next street');

section('an already-answered street is locked out');
tap('Alpha St');
ok(!cls('Alpha St', 'exam-pick') && cls('Alpha St', 'exam-done'), 'tapping a done street is ignored');

section('answer 2 wrong, answer 3 correct → finishes with a score');
tap('Bravo Ave'); setVal($('#examAnswer'), 'Nope Street'); click($('#examSubmit'));
ok(/Named 2 of 3/.test($('#examProgress').textContent), 'second answer recorded');
tap('Carter Rd'); setVal($('#examAnswer'), 'Carter Rd'); click($('#examSubmit'));
ok($('#examResults').style.display === 'flex', 'exam finishes after the last street');
ok(/2\/3/.test($('#examResultBody').textContent), 'scored 2 of 3');
ok(/Bravo Ave/.test($('#examResultBody').textContent), 'the mis-named street is listed as missed');
ok(!$('body').classList.contains('exam-active'), 'lockdown lifted at results');

done();
