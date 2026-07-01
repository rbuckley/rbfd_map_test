import { bootApp, district, ok, section, done, click, input } from './harness.mjs';

// 30 streets so the "25" preset shows and "50" is hidden.
const streets = Array.from({ length: 30 }, (_, i) => 'Street ' + (i + 1));
const SEED = { correct: 7, total: 9, missed: [], userExcluded: [] };
const { window, $, $$, ls } = await bootApp({
  districts: { u1: district({ streets, viewBox: '0 0 1000 100' }) },
  selected: 'u1', progress: { u1: SEED },
});
const setVal = (el, v) => { el.value = v; el.dispatchEvent(new window.Event('input')); };
const tap = n => $(`.street[data-name="${n}"]`).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const curTarget = () => $('#examLocate').textContent.replace(/^Locate:\s*/, '');

section('setup gating + preset clamping');
ok($('#score').textContent === '7/9', 'seeded practice score');
click($('#examModeBtn'));
ok($('#examSetup').style.display === 'flex' && $('#examStart').disabled, 'setup shown, Start disabled');
setVal($('#examName'), 'Jane'); setVal($('#examBadge'), 'FF-1');
ok(!$('#examStart').disabled, 'Start enabled after name + badge');
const cov = $$('#examCoverage .mode-tab').map(b => b.textContent);
ok(cov.some(l => /25 questions/.test(l)) && !cov.some(l => /50 questions/.test(l)) && cov.some(l => /Full \(30\)/.test(l)), '25 shown, 50 hidden, Full(30)');

section('locked run: no feedback, correct scoring, pass at the >= boundary');
$$('#examCoverage .mode-tab').find(b => /25 questions/.test(b.textContent)).click();
setVal($('#examPass'), '60');
click($('#examStart'));
ok($('body').classList.contains('exam-active') && /Question 1 of 25/.test($('#examProgress').textContent), 'lockdown on, 25 questions');
const scoreFrozen = $('#score').textContent;
let leak = true;
for (let i = 0; i < 25; i++) {
  const t = curTarget();
  const pick = i < 15 ? t : streets.find(n => n !== t);   // 15 correct, 10 wrong -> 60%
  tap(pick);
  if (i === 0) {
    const el = $(`.street[data-name="${pick}"]`);
    leak = el.classList.contains('correct') || el.classList.contains('wrong') || el.classList.contains('target');
    ok(el.classList.contains('exam-pick') && !leak, 'tap shows neutral exam-pick, no correctness class');
    ok($('#score').textContent === scoreFrozen, 'header score frozen during exam');
  }
  click($('#examSubmit'));
}
ok($('#examResults').style.display === 'flex' && /15\/25/.test($('#examResultBody').textContent), 'results 15/25');
ok(/PASS/.test($('#examResultBody').textContent), 'PASS at exactly 60%');

section('isolation: practice progress untouched, Done restores');
ok(JSON.stringify(ls('u1')) === JSON.stringify(SEED), 'progress byte-identical after exam');
click($('#examDone'));
ok(!$('body').classList.contains('exam-active') && $('#score').textContent === '7/9', 'exam closed, practice score intact');

section('end-early counts the rest as missed');
click($('#examModeBtn')); setVal($('#examName'), 'A'); setVal($('#examBadge'), 'B');
$$('#examCoverage .mode-tab').find(b => /25 questions/.test(b.textContent)).click();
click($('#examStart'));
click($('#examEnd'));
ok(/0\/25/.test($('#examResultBody').textContent) && /FAIL/.test($('#examResultBody').textContent), 'ending immediately -> 0/25 FAIL');

done();
