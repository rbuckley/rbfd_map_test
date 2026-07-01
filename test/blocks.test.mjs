import { bootApp, district, ok, section, done, click, change, tapAt, wait } from './harness.mjs';

// Two blocks on Carnegie (for Identify), one on Grant. viewBox 0..1000, and we
// stub the svg rect so screen coords map 1:1 to content coords.
const rec = district({
  streets: ['Carnegie Lane', 'Grant Avenue'],
  viewBox: '0 0 1000 1000',
  blocks: {
    'Carnegie Lane': [{ block: 200, x: 500, y: 500, count: 5 }, { block: 300, x: 200, y: 200, count: 3 }],
    'Grant Avenue': [{ block: 1700, x: 800, y: 300, count: 4 }],
  },
});
rec.svgMarkup = rec.svgMarkup.replace('viewBox="0 0 400 50"', 'viewBox="0 0 1000 1000"');
const { $, $$, ls } = await bootApp({ districts: { u1: rec }, selected: 'u1' });
const svg = $('#map');
svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 1000, right: 1000, bottom: 1000 });

const blocks = rec.blocks;
const findCoord = (street, block) => blocks[street].find(b => b.block === block);

section('Blocks / Locate');
click($('#modeTabs [data-mode="blocks"]'));
ok($('#blocksToggles').style.display === 'flex' && $('#newQ').style.display !== 'none', 'blocks toggles + New shown');
click($('#newQ'));
let m = $('#prompt').textContent.match(/Tap the (\d+) block of (.+)\./);
ok(!!m, 'locate prompt: ' + $('#prompt').textContent);
let c = findCoord(m[2], +m[1]);
tapAt(svg, c.x, c.y);
ok($('#score').textContent === '1/1', 'tapping the right spot scores 1/1');
await wait(1100);
m = $('#prompt').textContent.match(/Tap the (\d+) block of (.+)\./);
c = findCoord(m[2], +m[1]);
tapAt(svg, c.x > 500 ? 20 : 980, c.y > 500 ? 20 : 980);   // far away
ok($('#score').textContent === '1/2', 'a far tap is wrong (1/2)');
await wait(2300);

section('Blocks / Identify (same-street choices)');
click($('#blockStyleTabs [data-blockstyle="identify"]'));
click($('#newQ'));
ok(/Which block of Carnegie Lane is highlighted\?/.test($('#prompt').textContent), 'identify names the multi-block street');
const opts = $$('#dropdown option').map(o => o.value).filter(Boolean).map(Number).sort((a, b) => a - b);
ok(JSON.stringify(opts) === JSON.stringify([200, 300]), 'choices are that street’s blocks (200,300)');
const marker = $('#map .__markers circle');
const mx = +marker.getAttribute('cx'), my = +marker.getAttribute('cy');
const block = blocks['Carnegie Lane'].find(b => Math.abs(b.x - mx) < 1 && Math.abs(b.y - my) < 1).block;
change($('#dropdown'), String(block));
ok($('#score').textContent === '2/3', 'correct identify scores 2/3');

done();
