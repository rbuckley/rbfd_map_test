// Score is session-only: it resets to 0/0 on every page load, while deliberate
// exclusions persist. A manual Reset button zeroes the live score too.
import { bootApp, district, ok, section, done, click, change, goStudy } from './harness.mjs';

const streets = ['Alpha St', 'Bravo Ave', 'Carter Rd', 'Delta Way'];
// A stored score + exclusion, as if left by a previous session.
const SEED = { correct: 5, total: 8, missed: ['Alpha St'], userExcluded: ['Carter Rd'] };
const { $, ls } = await bootApp({ districts: { u1: district({ streets }) }, selected: 'u1', progress: { u1: SEED } });

const targetName = () => ($('#map .street.target') || {}).dataset?.name;

section('a stored score does NOT come back on load');
ok($('#score').textContent === '0/0', 'score starts at 0/0 after refresh');
ok($('#pct').textContent === '--', 'percentage cleared too');

section('deliberate exclusions still persist across the reload');
ok(/Manage Exclusions \(1\)/.test($('#exclusionToggle').textContent), 'seeded exclusion restored (Carter Rd)');
ok((ls('u1').userExcluded || []).includes('Carter Rd'), 'exclusion still in stored progress');

section('scoring works, then the Reset button zeroes it live');
goStudy($, 'test');
click($('#newQ'));
const t = targetName();
ok(!!t, 'a target is highlighted: ' + t);
change($('#dropdown'), t);
ok($('#score').textContent === '1/1', 'a correct answer scores 1/1');
click($('#resetScore'));
ok($('#score').textContent === '0/0' && $('#pct').textContent === '--', 'Reset returns the score to 0/0');

done();
