import { jsdomEnv, ok, section, done } from './harness.mjs';
const window = jsdomEnv();
const { createMapView } = await import('../js/map.js');

const mk = (vb = '0 0 100 200') => {
  const wrap = window.document.createElement('div');
  window.document.body.appendChild(wrap);
  wrap.innerHTML = `<svg id="map" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg"><rect/></svg>`;
  return wrap.querySelector('#map');
};

section('initial rotation from opts');
let svg = mk(); let mv = createMapView(svg, { rotation: 90 });
ok(mv.getRotation() === 90, 'honors opts.rotation = 90');
ok(/rotate\(90 /.test(svg.querySelector('.__maprot').getAttribute('transform')), 'rotation group transformed on init');
const vb = svg.getAttribute('viewBox').split(/\s+/).map(Number);
ok(vb[2] === 200 && vb[3] === 100, 'viewBox extent swapped for 90° (200x100)');
ok(createMapView(mk(), { rotation: 450 }).getRotation() === 90, '450° normalizes/snaps to 90');
ok(createMapView(mk(), {}).getRotation() === 0, 'default is 0');

section('rotate() advances by 90° and returns the new angle');
mv = createMapView(mk());
ok(mv.rotate() === 90 && mv.getRotation() === 90, '0 -> 90');
ok(mv.rotate() === 180, '90 -> 180');
ok(mv.rotate() === 270 && mv.rotate() === 0, 'wraps 270 -> 0');
ok(!mk().querySelector('.__maprot'), 'fresh svg has no rotation group until wrapped');

section('clientToContent maps screen -> content under letterbox (xMidYMid meet)');
svg = mk('0 0 1000 1000');
mv = createMapView(svg);
// Non-square container: 1600x800 around a 1000x1000 viewBox -> scale 0.8, x letterboxed 400px.
const rect = { left: 100, top: 50, width: 1600, height: 800, right: 1700, bottom: 850 };
svg.getBoundingClientRect = () => rect;
const scale = Math.min(rect.width / 1000, rect.height / 1000);       // 0.8
const offX = (rect.width - 1000 * scale) / 2, offY = (rect.height - 1000 * scale) / 2; // 400, 0
const [cx, cy] = mv.clientToContent(rect.left + offX + 250 * scale, rect.top + offY + 400 * scale);
ok(Math.abs(cx - 250) < 0.5 && Math.abs(cy - 400) < 0.5, `tap maps back to content (250,400) got (${cx.toFixed(1)},${cy.toFixed(1)})`);
// The naive stretch formula would mis-map x — proving the letterbox correction matters.
const stretchX = 1000 * (rect.left + offX + 250 * scale - rect.left) / rect.width;
ok(Math.abs(stretchX - 250) > 50, 'stretch (no-letterbox) formula would be wrong here');

done();
