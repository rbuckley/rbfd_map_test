// District builder: trace streets over a reference image, name them, manage
// quiz exclusions + confusion groups, then save (localStorage) or export
// (downloadable streets.json + map.svg) for committing to the repo.
//
// The pure data helpers (buildDistrictRecord, parseGeometryFromSvg, slugify,
// makeUniqueId) are exported separately so they can be unit-tested without a DOM.
import { saveUserDistrict, loadUserDistricts } from './storage.js';
import { DISTRICTS } from './districts.js';

const STREET_STROKE = '#9bb4cc';
// Filled background areas, matching the District 1 palette.
const AREA_STYLE = {
  water: { fill: '#15455e', stroke: '#2c5a73', width: 1 },
  park: { fill: '#1f3d2c', stroke: '#2d5a3d', width: 1 },
  school: { fill: '#3d3320', stroke: '#5a4d2d', width: 0.8 },
};
// Draw order (low = furthest back): water under parks under schools.
const AREA_RANK = { water: 0, park: 1, school: 2 };
const round = n => Math.round(n * 10) / 10;
const escAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function slugify(name) {
  const s = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'district';
}

export function makeUniqueId(base, takenIds) {
  let id = base, i = 2;
  while (takenIds.has(id)) id = `${base}-${i++}`;
  return id;
}

function segPath(seg) {
  return seg.map((p, i) => `${i ? 'L' : 'M'}${round(p[0])},${round(p[1])}`).join('');
}

// Build the full district record from a draft:
//   { id, name, streets:[{name, segments:[[[x,y],...],...]}], excluded:[],
//     confusionGroups:{}, refImage, imgW, imgH }
export function buildDistrictRecord(draft) {
  const features = draft.features || [];
  // Bounding box over every street + area point (loop, not spread, to stay
  // safe for large point counts).
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, any = false;
  const grow = (x, y) => { any = true; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; };
  for (const st of draft.streets) for (const seg of st.segments) for (const [x, y] of seg) grow(x, y);
  for (const f of features) for (const [x, y] of f.polygon) grow(x, y);

  let vb;
  if (any) {
    const m = Math.max(20, 0.04 * Math.max(maxx - minx, maxy - miny));
    vb = `${round(minx - m)} ${round(miny - m)} ${round(maxx - minx + 2 * m)} ${round(maxy - miny + 2 * m)}`;
  } else {
    vb = `0 0 ${draft.imgW || 1000} ${draft.imgH || 1000}`;
  }
  const [vx, vy, vw, vh] = vb.split(' ');

  // Filled water/park/school areas, drawn behind the streets (water furthest
  // back) and non-interactive.
  const ordered = [...features].sort((a, b) => (AREA_RANK[a.type] ?? 1) - (AREA_RANK[b.type] ?? 1));
  const areaPaths = ordered.map(f => {
    const s = AREA_STYLE[f.type] || AREA_STYLE.park;
    const d = f.polygon.map((p, i) => `${i ? 'L' : 'M'}${round(p[0])},${round(p[1])}`).join('') + 'Z';
    return `<path class="area" d="${d}" fill="${s.fill}" stroke="${s.stroke}" stroke-width="${s.width}" fill-rule="evenodd"/>`;
  }).join('\n');

  const groups = draft.streets.map(st => {
    const paths = st.segments.map(seg =>
      `<path class="hit" d="${segPath(seg)}" fill="none" stroke="rgba(0,0,0,0)" stroke-width="14" stroke-linecap="round"/>` +
      `<path class="vis" d="${segPath(seg)}" fill="none" stroke="${STREET_STROKE}" stroke-width="2.4" stroke-linecap="round"/>`
    ).join('');
    return `<g class="street" data-name="${escAttr(st.name)}">${paths}</g>`;
  }).join('\n');

  const svgMarkup =
    `<svg id="map" viewBox="${vb}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">\n` +
    `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="#0d3144"/>\n` +
    (areaPaths ? areaPaths + '\n' : '') +
    `${groups}\n</svg>\n`;

  // De-duplicate street names for the quiz list (a street may have segments
  // under the same name added separately).
  const names = [];
  for (const st of draft.streets) if (!names.includes(st.name)) names.push(st.name);

  return {
    id: draft.id,
    name: draft.name,
    map: `data/${draft.id}/map.svg`,
    viewBox: vb,
    streets: names,
    excluded: Array.from(draft.excluded || []),
    confusionGroups: draft.confusionGroups || {},
    svgMarkup,
    // authoring data (ignored by the quiz, used to re-edit losslessly)
    geometry: draft.streets,
    features,
    refImage: draft.refImage || null,
    imgW: draft.imgW || null,
    imgH: draft.imgH || null,
  };
}

// Recover editable geometry from a rendered map (used when editing a district
// that has no stored geometry, e.g. a built-in). Streets are simple polylines.
export function parseGeometryFromSvg(svgMarkup) {
  const doc = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
  const streets = [];
  doc.querySelectorAll('.street').forEach(g => {
    const segments = [];
    g.querySelectorAll('.vis').forEach(p => {
      const d = p.getAttribute('d') || '';
      const seg = [];
      for (const m of d.matchAll(/(-?\d+\.?\d*),(-?\d+\.?\d*)/g)) seg.push([parseFloat(m[1]), parseFloat(m[2])]);
      if (seg.length >= 2) segments.push(seg);
    });
    if (segments.length) streets.push({ name: g.dataset.name, segments });
  });
  return streets;
}

function parseConfusionText(text, validNames) {
  const groups = {};
  for (const line of String(text).split('\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    const members = line.slice(i + 1).split(',').map(s => s.trim()).filter(Boolean)
      .filter(n => !validNames || validNames.includes(n));
    if (key && members.length) groups[key] = members;
  }
  return groups;
}
function confusionToText(groups) {
  return Object.entries(groups || {}).map(([k, v]) => `${k}: ${v.join(', ')}`).join('\n');
}

function takenIds() {
  return new Set([...DISTRICTS.map(d => d.id), ...Object.keys(loadUserDistricts())]);
}

function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// A fresh, collision-free district id derived from a name.
export function nextDistrictId(name) {
  return makeUniqueId(slugify(name), takenIds());
}

// Download a district's streets.json + map.svg (authoring fields stripped) and
// return on-screen instructions for committing them.
export function exportDistrictFiles(record) {
  const { svgMarkup, geometry, features, refImage, imgW, imgH, ...config } = record;
  download(`${record.id}.streets.json`, JSON.stringify(config, null, 2) + '\n', 'application/json');
  download(`${record.id}.map.svg`, svgMarkup, 'image/svg+xml');
  return `Downloaded ${record.id}.streets.json + ${record.id}.map.svg. Put them at ` +
    `data/${record.id}/streets.json and data/${record.id}/map.svg, then add to js/districts.js: ` +
    `{ id:'${record.id}', name:'${record.name}', config:'data/${record.id}/streets.json' }`;
}

// ---- Builder UI ----------------------------------------------------------

export function openBuilder({ existing = null, editable = false, onSaved } = {}) {
  // Draft state
  const draft = {
    id: editable && existing ? existing.id : null,
    name: existing ? existing.name : '',
    refImage: existing ? (existing.refImage || null) : null,
    imgW: existing ? existing.imgW : null,
    imgH: existing ? existing.imgH : null,
    streets: existing
      ? (existing.geometry || parseGeometryFromSvg(existing.svgMarkup || '')).map(s => ({ name: s.name, segments: s.segments.map(seg => seg.map(p => [...p])) }))
      : [],
    excluded: new Set(existing ? (existing.excluded || []) : []),
    confusionGroups: existing ? { ...(existing.confusionGroups || {}) } : {},
    // Park/school areas aren't hand-editable here, but carry them through a
    // save so editing an imported district doesn't drop its shading.
    features: existing ? (existing.features || []) : [],
  };

  let drawMode = true;        // true = draw, false = pan
  let current = [];           // in-progress polyline points
  let vb = null;              // builder viewBox {x,y,w,h}

  // Overlay scaffold
  const overlay = document.createElement('div');
  overlay.className = 'builder-overlay';
  overlay.innerHTML = `
    <div class="builder-bar">
      <input id="bName" class="builder-name" placeholder="District name" />
      <button id="bDrawPan" class="btn">✏ Draw</button>
      <button id="bFinish" class="btn primary">Finish street</button>
      <button id="bUndo" class="btn">Undo point</button>
      <label class="btn" style="cursor:pointer">Image<input id="bImg" type="file" accept="image/*" hidden></label>
      <span style="flex:1"></span>
      <button id="bSave" class="btn primary">Save</button>
      <button id="bExport" class="btn">Export</button>
      <button id="bClose" class="btn">Close</button>
    </div>
    <div class="builder-body">
      <div class="builder-canvas-wrap">
        <svg id="bCanvas" xmlns="http://www.w3.org/2000/svg"></svg>
        <div class="builder-hint" id="bHint">Upload a reference image, then click to trace a street. “Finish street” to name it.</div>
      </div>
      <div class="builder-side">
        <div class="builder-section"><b>Streets</b> (<span id="bCount">0</span>)</div>
        <div id="bList" class="builder-list"></div>
        <div class="builder-section"><b>Confusion groups</b><br><small>One per line — <code>Group: Street A, Street B</code></small></div>
        <textarea id="bGroups" class="builder-groups" placeholder="Gem Streets: Ruby Street, Opal Street"></textarea>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const $ = id => overlay.querySelector('#' + id);
  const canvas = $('bCanvas');
  $('bName').value = draft.name;
  $('bGroups').value = confusionToText(draft.confusionGroups);

  const imgLayer = document.createElementNS('http://www.w3.org/2000/svg', 'image');
  const drawLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  canvas.append(imgLayer, drawLayer);

  function setViewBox(x, y, w, h) { vb = { x, y, w, h }; canvas.setAttribute('viewBox', `${x} ${y} ${w} ${h}`); }
  function fitToImage() {
    if (draft.imgW && draft.imgH) setViewBox(0, 0, draft.imgW, draft.imgH);
    else setViewBox(0, 0, 1000, 1000);
  }
  fitToImage();

  if (draft.refImage) {
    imgLayer.setAttributeNS('http://www.w3.org/1999/xlink', 'href', draft.refImage);
    imgLayer.setAttribute('href', draft.refImage);
    imgLayer.setAttribute('x', 0); imgLayer.setAttribute('y', 0);
    imgLayer.setAttribute('width', draft.imgW || 1000); imgLayer.setAttribute('height', draft.imgH || 1000);
  }

  function clientToSvg(e) {
    const r = canvas.getBoundingClientRect();
    return [vb.x + (e.clientX - r.left) / r.width * vb.w, vb.y + (e.clientY - r.top) / r.height * vb.h];
  }

  function redraw() {
    drawLayer.innerHTML = '';
    draft.streets.forEach((st, idx) => {
      st.segments.forEach(seg => {
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', segPath(seg));
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke', draft.excluded.has(st.name) ? '#6b7a8d' : STREET_STROKE);
        p.setAttribute('stroke-width', Math.max(2, vb.w / 300));
        p.setAttribute('stroke-linecap', 'round');
        p.dataset.idx = idx;
        drawLayer.appendChild(p);
      });
    });
    if (current.length) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', segPath(current));
      p.setAttribute('fill', 'none'); p.setAttribute('stroke', '#ff8a3d');
      p.setAttribute('stroke-width', Math.max(2, vb.w / 250)); p.setAttribute('stroke-linecap', 'round');
      drawLayer.appendChild(p);
      current.forEach(pt => {
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('cx', pt[0]); c.setAttribute('cy', pt[1]); c.setAttribute('r', Math.max(2, vb.w / 350));
        c.setAttribute('fill', '#ff8a3d'); drawLayer.appendChild(c);
      });
    }
  }

  function renderList() {
    $('bCount').textContent = draft.streets.length;
    const list = $('bList');
    list.innerHTML = '';
    draft.streets.forEach((st, idx) => {
      const row = document.createElement('div');
      row.className = 'builder-row';
      const name = document.createElement('input');
      name.value = st.name; name.className = 'builder-row-name';
      name.addEventListener('change', () => { st.name = name.value.trim() || st.name; name.value = st.name; redraw(); });
      const excl = document.createElement('input');
      excl.type = 'checkbox'; excl.checked = draft.excluded.has(st.name); excl.title = 'Exclude from quiz';
      excl.addEventListener('change', () => { excl.checked ? draft.excluded.add(st.name) : draft.excluded.delete(st.name); redraw(); });
      const del = document.createElement('button');
      del.textContent = '✕'; del.className = 'builder-del';
      del.addEventListener('click', () => { draft.streets.splice(idx, 1); renderList(); redraw(); });
      const lbl = document.createElement('label'); lbl.className = 'builder-excl'; lbl.append(excl, document.createTextNode('skip'));
      row.append(name, lbl, del);
      list.appendChild(row);
    });
  }

  function finishStreet() {
    if (current.length < 2) { $('bHint').textContent = 'Click at least two points before finishing a street.'; return; }
    const def = `Street ${draft.streets.length + 1}`;
    const nm = (window.prompt('Street name:', def) || '').trim();
    if (!nm) { return; }
    const existingStreet = draft.streets.find(s => s.name === nm);
    if (existingStreet) existingStreet.segments.push(current);
    else draft.streets.push({ name: nm, segments: [current] });
    current = [];
    renderList(); redraw();
    $('bHint').textContent = 'Street added. Keep tracing, or Save / Export when done.';
  }

  // Interactions
  canvas.addEventListener('click', e => {
    if (!drawMode) return;
    current.push(clientToSvg(e));
    redraw();
  });
  canvas.addEventListener('dblclick', e => { if (drawMode) finishStreet(); });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    const f = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    const nw = vb.w * f, nh = vb.h * f;
    setViewBox(vb.x + (vb.w - nw) * px, vb.y + (vb.h - nh) * py, nw, nh);
    redraw();
  }, { passive: false });
  let panning = false, panStart = null;
  canvas.addEventListener('mousedown', e => { if (drawMode) return; panning = true; panStart = { x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y }; });
  window.addEventListener('mousemove', e => {
    if (!panning) return;
    const r = canvas.getBoundingClientRect();
    setViewBox(panStart.vx - (e.clientX - panStart.x) / r.width * vb.w, panStart.vy - (e.clientY - panStart.y) / r.height * vb.h, vb.w, vb.h);
  });
  window.addEventListener('mouseup', () => { panning = false; });

  $('bDrawPan').addEventListener('click', () => {
    drawMode = !drawMode;
    $('bDrawPan').textContent = drawMode ? '✏ Draw' : '✋ Pan';
    canvas.style.cursor = drawMode ? 'crosshair' : 'grab';
  });
  canvas.style.cursor = 'crosshair';
  $('bFinish').addEventListener('click', finishStreet);
  $('bUndo').addEventListener('click', () => { current.pop(); redraw(); });

  $('bImg').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        draft.refImage = reader.result; draft.imgW = img.naturalWidth; draft.imgH = img.naturalHeight;
        imgLayer.setAttribute('href', draft.refImage);
        imgLayer.setAttributeNS('http://www.w3.org/1999/xlink', 'href', draft.refImage);
        imgLayer.setAttribute('x', 0); imgLayer.setAttribute('y', 0);
        imgLayer.setAttribute('width', draft.imgW); imgLayer.setAttribute('height', draft.imgH);
        fitToImage(); redraw();
        $('bHint').textContent = 'Click to trace a street, then “Finish street”.';
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  function collect() {
    draft.name = $('bName').value.trim() || 'Untitled District';
    const names = draft.streets.map(s => s.name);
    draft.confusionGroups = parseConfusionText($('bGroups').value, names);
    // assign / keep id
    if (!draft.id || !editable) {
      draft.id = nextDistrictId(draft.name);
    }
    return buildDistrictRecord(draft);
  }

  $('bSave').addEventListener('click', () => {
    if (!draft.streets.length) { $('bHint').textContent = 'Add at least one street before saving.'; return; }
    const record = collect();
    saveUserDistrict(record);
    cleanup();
    if (onSaved) onSaved(record.id);
  });

  $('bExport').addEventListener('click', () => {
    if (!draft.streets.length) { $('bHint').textContent = 'Add at least one street before exporting.'; return; }
    $('bHint').textContent = exportDistrictFiles(collect());
  });

  function cleanup() { overlay.remove(); }
  $('bClose').addEventListener('click', cleanup);

  renderList(); redraw();
  return { overlay, _collect: collect, _draft: draft }; // last two for tests
}
