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

export function overpassQuery(polyLatLng) {
  const poly = polyLatLng.map(p => `${p.lat} ${p.lng}`).join(' ');
  const p = `(poly:"${poly}")`;
  return `[out:json][timeout:90];(` +
    `way["highway"~"${HIGHWAY_RE}"]["name"]${p};` +
    `way["leisure"="park"]${p};` +
    `way["amenity"="school"]${p};` +
    `);out geom;`;
}

// Convert an Overpass JSON response into street records grouped by name.
export function overpassToStreets(json) {
  const byName = new Map();
  for (const el of (json.elements || [])) {
    if (el.type !== 'way' || !el.tags || !el.tags.highway || !el.tags.name || !el.geometry) continue;
    const seg = el.geometry.map(g => project(g.lat, g.lon));
    if (seg.length < 2) continue;
    if (!byName.has(el.tags.name)) byName.set(el.tags.name, []);
    byName.get(el.tags.name).push(seg);
  }
  return [...byName.entries()].map(([name, segments]) => ({ name, segments }));
}

// Park (leisure=park) and school (amenity=school) area polygons for shading.
export function overpassToFeatures(json) {
  const feats = [];
  for (const el of (json.elements || [])) {
    if (el.type !== 'way' || !el.tags || !el.geometry) continue;
    let type = null;
    if (el.tags.leisure === 'park') type = 'park';
    else if (el.tags.amenity === 'school') type = 'school';
    if (!type) continue;
    const poly = el.geometry.map(g => project(g.lat, g.lon));
    if (poly.length >= 3) feats.push({ type, polygon: poly });
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
  const draft = { id: null, name: '', streets: [], features: [], excluded: new Set(), confusionGroups: {} };

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
        draft.streets = overpassToStreets(json);
        draft.features = overpassToFeatures(json);
        renderList();
        if (draft.streets.length || draft.features.length) {
          $('miSave').disabled = false; $('miExport').disabled = false;
          const parks = draft.features.filter(f => f.type === 'park').length;
          const schools = draft.features.filter(f => f.type === 'school').length;
          hint(`Imported ${draft.streets.length} streets, ${parks} parks, ${schools} schools. Review the list, name the district, then Save or Export.`);
          // Preview parks/schools (filled) and streets (lines) on the map.
          for (const el of json.elements) {
            if (!el.geometry || !el.tags) continue;
            const latlngs = el.geometry.map(g => [g.lat, g.lon]);
            if (el.tags.leisure === 'park' || el.tags.amenity === 'school') {
              const park = el.tags.leisure === 'park';
              L.polygon(latlngs, { color: park ? '#2d5a3d' : '#5a4d2d', fillColor: park ? '#1f3d2c' : '#3d3320', fillOpacity: 0.55, weight: 1 }).addTo(map);
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
