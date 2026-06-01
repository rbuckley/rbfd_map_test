// Map-based district importer: draw a boundary on an OpenStreetMap (Leaflet),
// auto-pull every named road inside it from the Overpass API, project to SVG
// coordinates, then review / save / export — reusing the builder's plumbing.
import { saveUserDistrict } from './storage.js';
import { buildDistrictRecord, nextDistrictId, exportDistrictFiles } from './builder.js';

const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
// Drivable street types worth quizzing (skip footways, cycleways, service, etc.)
const HIGHWAY_RE = '^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street)$';

// --- Pure helpers (testable without a DOM / network) ---

// Web Mercator projection; y negated so north is up in SVG space. Absolute
// scale is irrelevant — the viewBox is computed from the resulting bounds.
export function project(lat, lon) {
  const R = 6378137;
  const x = R * lon * Math.PI / 180;
  const y = -R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  return [x, y];
}

// --- Boundary clipping (operates in [lng, lat] space) ---
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const ptEq = (a, b) => Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12;

export function pointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// t along a→b where it crosses polygon edge c→d, or null.
function crossT(a, b, c, d) {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
  const denom = rx * sy - ry * sx;
  if (denom === 0) return null;
  const qx = c[0] - a[0], qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / denom;
  const u = (qx * ry - qy * rx) / denom;
  return (t >= 0 && t <= 1 && u >= 0 && u <= 1) ? t : null;
}

// Clip a polyline to a polygon → array of inside sub-polylines. Correct for
// concave polygons (used for streets, where precision matters).
export function clipPolylineToPolygon(points, poly) {
  const out = [];
  let cur = null;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const ts = [];
    for (let m = 0, n = poly.length - 1; m < poly.length; n = m++) {
      const t = crossT(a, b, poly[n], poly[m]);
      if (t != null && t > 1e-9 && t < 1 - 1e-9) ts.push(t);
    }
    ts.sort((x, y) => x - y);
    const cuts = [0, ...ts, 1];
    for (let k = 0; k < cuts.length - 1; k++) {
      const t0 = cuts[k], t1 = cuts[k + 1];
      if (t1 - t0 < 1e-12) continue;
      if (pointInPolygon(lerp(a, b, (t0 + t1) / 2), poly)) {
        const p0 = lerp(a, b, t0), p1 = lerp(a, b, t1);
        if (cur && ptEq(cur[cur.length - 1], p0)) cur.push(p1);
        else { cur = [p0, p1]; out.push(cur); }
      } else {
        cur = null;
      }
    }
  }
  return out.filter(seg => seg.length >= 2);
}

function signedArea(poly) {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return s / 2;
}
function ensureCCW(poly) { return signedArea(poly) >= 0 ? poly : poly.slice().reverse(); }
function edgeIntersect(p1, p2, A, B) {
  const d = (p2[0] - p1[0]) * (B[1] - A[1]) - (p2[1] - p1[1]) * (B[0] - A[0]);
  if (d === 0) return p2;
  const t = ((A[0] - p1[0]) * (B[1] - A[1]) - (A[1] - p1[1]) * (B[0] - A[0])) / d;
  return lerp(p1, p2, t);
}

// Sutherland–Hodgman polygon clip (clip ring must be CCW). Used for filled
// areas; exact for convex boundaries, good enough for mildly concave ones.
export function clipPolygonToPolygon(subject, clipCCW) {
  let output = subject;
  for (let i = 0; i < clipCCW.length; i++) {
    const A = clipCCW[i], B = clipCCW[(i + 1) % clipCCW.length];
    const input = output; output = [];
    if (!input.length) break;
    const side = p => (B[0] - A[0]) * (p[1] - A[1]) - (B[1] - A[1]) * (p[0] - A[0]); // >=0 = inside (left)
    for (let j = 0; j < input.length; j++) {
      const cur = input[j], prev = input[(j - 1 + input.length) % input.length];
      const curIn = side(cur) >= 0, prevIn = side(prev) >= 0;
      if (curIn) { if (!prevIn) output.push(edgeIntersect(prev, cur, A, B)); output.push(cur); }
      else if (prevIn) { output.push(edgeIntersect(prev, cur, A, B)); }
    }
  }
  return output;
}

export function overpassQuery(polyLatLng) {
  const poly = polyLatLng.map(p => `${p.lat} ${p.lng}`).join(' ');
  const p = `(poly:"${poly}")`;
  return `[out:json][timeout:90];(` +
    `way["highway"~"${HIGHWAY_RE}"]["name"]${p};` +
    `way["leisure"="park"]${p};` +
    `way["amenity"="school"]${p};` +
    `way["natural"="water"]${p};` +
    `way["waterway"="riverbank"]${p};` +
    `);out geom;`;
}

// Convert an Overpass JSON response into street records grouped by name. When a
// boundary ([[lng,lat],...]) is given, each road is clipped to it so streets
// stop at the drawn border.
export function overpassToStreets(json, boundary) {
  const clip = boundary && boundary.length >= 3;
  const byName = new Map();
  for (const el of (json.elements || [])) {
    if (el.type !== 'way' || !el.tags || !el.tags.highway || !el.tags.name || !el.geometry) continue;
    const pts = el.geometry.map(g => [g.lon, g.lat]);
    const subs = clip ? clipPolylineToPolygon(pts, boundary) : [pts];
    for (const sub of subs) {
      if (sub.length < 2) continue;
      if (!byName.has(el.tags.name)) byName.set(el.tags.name, []);
      byName.get(el.tags.name).push(sub.map(([lon, lat]) => project(lat, lon)));
    }
  }
  return [...byName.entries()].map(([name, segments]) => ({ name, segments }));
}

// Park / school / water area polygons for shading, clipped to the boundary.
export function overpassToFeatures(json, boundary) {
  const clipRing = (boundary && boundary.length >= 3) ? ensureCCW(boundary) : null;
  const feats = [];
  for (const el of (json.elements || [])) {
    if (el.type !== 'way' || !el.tags || !el.geometry) continue;
    let type = null;
    if (el.tags.leisure === 'park') type = 'park';
    else if (el.tags.amenity === 'school') type = 'school';
    else if (el.tags.natural === 'water' || el.tags.waterway === 'riverbank') type = 'water';
    if (!type) continue;
    let ring = el.geometry.map(g => [g.lon, g.lat]);
    if (clipRing) { ring = clipPolygonToPolygon(ring, clipRing); if (ring.length < 3) continue; }
    feats.push({ type, polygon: ring.map(([lon, lat]) => project(lat, lon)) });
  }
  return feats;
}

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  return new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = LEAFLET_CSS;
      document.head.appendChild(css);
    }
    const s = document.createElement('script');
    s.src = LEAFLET_JS;
    s.onload = () => resolve(window.L);
    s.onerror = () => reject(new Error('Could not load the map library (are you online?)'));
    document.head.appendChild(s);
  });
}

// --- Importer UI ---

export function openMapImporter({ onSaved } = {}) {
  const draft = { id: null, name: '', streets: [], features: [], excluded: new Set(), confusionGroups: {}, boundary: null };

  const overlay = document.createElement('div');
  overlay.className = 'builder-overlay';
  overlay.innerHTML = `
    <div class="builder-bar">
      <input id="miName" class="builder-name" placeholder="District name" />
      <button id="miFinish" class="btn primary">Finish boundary &amp; import</button>
      <button id="miClear" class="btn">Clear boundary</button>
      <span style="flex:1"></span>
      <button id="miSave" class="btn primary" disabled>Save</button>
      <button id="miExport" class="btn" disabled>Export</button>
      <button id="miClose" class="btn">Close</button>
    </div>
    <div class="builder-body">
      <div class="builder-canvas-wrap">
        <div id="miMap" style="position:absolute;inset:0;"></div>
        <div class="builder-hint" id="miHint">Loading map…</div>
      </div>
      <div class="builder-side">
        <div class="builder-section"><b>Streets</b> (<span id="miCount">0</span>)</div>
        <div id="miList" class="builder-list"></div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const $ = id => overlay.querySelector('#' + id);
  const hint = msg => { $('miHint').textContent = msg; };

  function cleanup() { overlay.remove(); }
  $('miClose').addEventListener('click', cleanup);

  function renderList() {
    $('miCount').textContent = draft.streets.length;
    const list = $('miList');
    list.innerHTML = '';
    draft.streets.forEach((st, idx) => {
      const row = document.createElement('div');
      row.className = 'builder-row';
      const name = document.createElement('input');
      name.value = st.name; name.className = 'builder-row-name';
      name.addEventListener('change', () => { st.name = name.value.trim() || st.name; name.value = st.name; });
      const excl = document.createElement('input');
      excl.type = 'checkbox'; excl.checked = draft.excluded.has(st.name); excl.title = 'Exclude from quiz';
      excl.addEventListener('change', () => { excl.checked ? draft.excluded.add(st.name) : draft.excluded.delete(st.name); });
      const del = document.createElement('button');
      del.textContent = '✕'; del.className = 'builder-del';
      del.addEventListener('click', () => { draft.streets.splice(idx, 1); renderList(); });
      const lbl = document.createElement('label'); lbl.className = 'builder-excl'; lbl.append(excl, document.createTextNode('skip'));
      row.append(name, lbl, del);
      list.appendChild(row);
    });
  }

  function collect() {
    draft.name = $('miName').value.trim() || 'Imported District';
    draft.id = nextDistrictId(draft.name);
    return buildDistrictRecord(draft);
  }

  $('miSave').addEventListener('click', () => {
    if (!draft.streets.length) return;
    const record = collect();
    saveUserDistrict(record);
    cleanup();
    if (onSaved) onSaved(record.id);
  });
  $('miExport').addEventListener('click', () => {
    if (!draft.streets.length) return;
    hint(exportDistrictFiles(collect()));
  });

  // --- Map + boundary drawing ---
  loadLeaflet().then(L => {
    const map = L.map($('miMap')).setView([33.84, -118.39], 14); // Redondo Beach-ish default
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap contributors',
    }).addTo(map);
    setTimeout(() => map.invalidateSize(), 100);
    hint('Click to drop boundary points around your district, then “Finish boundary & import”.');

    let points = [];                 // [L.LatLng]
    const markers = [];
    let line = L.polyline([], { color: '#ff8a3d', weight: 2 }).addTo(map);

    map.on('click', e => {
      points.push(e.latlng);
      markers.push(L.circleMarker(e.latlng, { radius: 4, color: '#ff8a3d' }).addTo(map));
      line.setLatLngs(points.concat(points.length > 2 ? [points[0]] : []));
    });

    $('miClear').addEventListener('click', () => {
      points = [];
      markers.forEach(m => map.removeLayer(m)); markers.length = 0;
      line.setLatLngs([]);
      hint('Boundary cleared. Click to drop new points.');
    });

    $('miFinish').addEventListener('click', async () => {
      if (points.length < 3) { hint('Drop at least 3 boundary points first.'); return; }
      hint('Fetching streets from OpenStreetMap…');
      $('miFinish').disabled = true;
      try {
        const body = 'data=' + encodeURIComponent(overpassQuery(points));
        const res = await fetch(OVERPASS_URL, { method: 'POST', body });
        if (!res.ok) throw new Error(`Overpass error ${res.status}`);
        const json = await res.json();
        const boundary = points.map(p => [p.lng, p.lat]);  // [lng,lat] for clipping
        draft.boundary = points.map(p => ({ lat: p.lat, lng: p.lng }));
        draft.streets = overpassToStreets(json, boundary);
        draft.features = overpassToFeatures(json, boundary);
        renderList();
        if (draft.streets.length || draft.features.length) {
          $('miSave').disabled = false; $('miExport').disabled = false;
          const count = t => draft.features.filter(f => f.type === t).length;
          hint(`Imported ${draft.streets.length} streets, ${count('park')} parks, ${count('school')} schools, ${count('water')} water. Review the list, name the district, then Save or Export.`);
          // Preview areas (filled) and streets (lines) on the map.
          const FILL = {
            park: ['#2d5a3d', '#1f3d2c'], school: ['#5a4d2d', '#3d3320'], water: ['#2c5a73', '#15455e'],
          };
          for (const el of json.elements) {
            if (!el.geometry || !el.tags) continue;
            const latlngs = el.geometry.map(g => [g.lat, g.lon]);
            const t = el.tags.leisure === 'park' ? 'park'
              : el.tags.amenity === 'school' ? 'school'
              : (el.tags.natural === 'water' || el.tags.waterway === 'riverbank') ? 'water' : null;
            if (t) {
              L.polygon(latlngs, { color: FILL[t][0], fillColor: FILL[t][1], fillOpacity: 0.55, weight: 1 }).addTo(map);
            } else if (el.tags.highway) {
              L.polyline(latlngs, { color: '#5fa8d3', weight: 1.5 }).addTo(map);
            }
          }
        } else {
          hint('No named streets found in that area. Try a larger boundary.');
        }
      } catch (err) {
        hint(`Import failed: ${err.message}. (Needs an internet connection.)`);
      } finally {
        $('miFinish').disabled = false;
      }
    });
  }).catch(err => hint(err.message));

  renderList();
  return { overlay, _draft: draft, _collect: collect };
}
