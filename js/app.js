// Bootstrap: build the district picker, load the selected district's map +
// data, render the SVG, and (re)point the quiz engine at it on each switch.
import { DEFAULT_DISTRICT, loadDistrict, listDistricts } from './districts.js';
import { createMapView } from './map.js';
import { createQuiz } from './quiz.js';
import { openBuilder } from './builder.js';
import { openMapImporter } from './mapImporter.js';
import { loadProgress, saveProgress, loadSelectedDistrict, saveSelectedDistrict, deleteUserDistrict, exportDistrictsBundle, importDistrictsBundle } from './storage.js';

function gatherDom() {
  const $ = id => document.getElementById(id);
  return {
    score: $('score'),
    pct: $('pct'),
    prompt: $('prompt'),
    feedback: $('feedback'),
    dropdown: $('dropdown'),
    textbox: $('textbox'),
    inputRow: $('inputRow'),
    submitAns: $('submitAns'),
    skip: $('skip'),
    excludeBtn: $('excludeBtn'),
    exclusionToggle: $('exclusionToggle'),
    exclusionManager: $('exclusionManager'),
    newQ: $('newQ'),
    reveal: $('reveal'),
    missed: $('missed'),
    resetView: $('resetView'),
    rotate: $('rotateBtn'),
    testToggles: $('testToggles'),
    modeTabs: Array.from(document.querySelectorAll('#modeTabs .mode-tab')),
    selectionTabs: Array.from(document.querySelectorAll('#selectionTabs .mode-tab')),
    answerTabs: Array.from(document.querySelectorAll('#answerTabs .mode-tab')),
    blocksToggles: document.getElementById('blocksToggles'),
    blockStyleTabs: Array.from(document.querySelectorAll('#blockStyleTabs .mode-tab')),
  };
}

async function main() {
  const mapWrap = document.querySelector('.map-wrap');
  const quiz = createQuiz({ dom: gatherDom() });
  let currentDistrict = null;   // full record of the loaded district
  let currentSource = null;     // 'builtin' | 'user'

  // Load a district and (re)point the quiz + map view at it.
  async function switchDistrict(id) {
    let district;
    try {
      district = await loadDistrict(id);
    } catch (err) {
      mapWrap.innerHTML = `<div style="padding:24px;color:var(--red)">Failed to load map data: ${err.message}<br><br>This app must be served over HTTP (e.g. a local server or GitHub Pages), not opened directly from the filesystem.</div>`;
      return;
    }
    currentDistrict = district;
    currentSource = (listDistricts().find(d => d.id === id) || {}).source || 'builtin';
    mapWrap.innerHTML = district.svgMarkup;
    const svg = mapWrap.querySelector('#map');
    const mapView = createMapView(svg);
    quiz.setDistrict({
      district,
      svg,
      mapView,
      initial: loadProgress(id),
      persist: state => saveProgress(id, state),
    });
    saveSelectedDistrict(id);
    renderPicker(id);
    // Only user-created districts can be deleted.
    document.getElementById('deleteDistrictBtn').style.display = currentSource === 'user' ? '' : 'none';
  }

  // Header: an <h1> title for a single district, or a <select> when there are
  // several. Re-rendered after each switch so the current district stays shown.
  function renderPicker(currentId) {
    const districts = listDistricts();
    const container = document.getElementById('districtTitle');
    const current = districts.find(d => d.id === currentId);
    if (districts.length <= 1) {
      container.innerHTML = `<h1>RBFD Map Test${current ? ' - ' + current.name : ''}</h1>`;
      return;
    }
    const sel = document.createElement('select');
    sel.id = 'districtPicker';
    sel.innerHTML = districts
      .map(d => `<option value="${d.id}"${d.id === currentId ? ' selected' : ''}>${d.name}</option>`)
      .join('');
    sel.addEventListener('change', () => switchDistrict(sel.value));
    container.innerHTML = '';
    container.appendChild(sel);
  }

  // Maps menu (Add map / Edit / Delete / Export / Import) open-close.
  const mapsBtn = document.getElementById('mapsMenuBtn');
  const mapsMenu = document.getElementById('mapsMenu');
  mapsBtn.addEventListener('click', e => {
    e.stopPropagation();
    mapsMenu.style.display = mapsMenu.style.display === 'none' ? 'flex' : 'none';
  });
  mapsMenu.addEventListener('click', () => { mapsMenu.style.display = 'none'; });
  document.addEventListener('click', e => {
    if (e.target !== mapsBtn && !mapsMenu.contains(e.target)) mapsMenu.style.display = 'none';
  });

  // Small chooser: draw on a map (auto-import) vs trace an image (manual).
  function chooseNewDistrict() {
    const onSaved = id => switchDistrict(id);
    const ov = document.createElement('div');
    ov.className = 'chooser-overlay';
    ov.innerHTML = `
      <div class="chooser-card">
        <h2>Add a map</h2>
        <button class="btn primary" id="chMap">Draw on a map<small>Auto-import streets from OpenStreetMap</small></button>
        <button class="btn" id="chImg">Trace an image<small>Draw streets by hand over an uploaded image</small></button>
        <button class="btn" id="chCancel">Cancel</button>
      </div>`;
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    ov.querySelector('#chMap').addEventListener('click', () => { close(); openMapImporter({ onSaved }); });
    ov.querySelector('#chImg').addEventListener('click', () => { close(); openBuilder({ onSaved }); });
    ov.querySelector('#chCancel').addEventListener('click', close);
  }

  // Builder entry points.
  document.getElementById('newDistrictBtn').addEventListener('click', chooseNewDistrict);
  document.getElementById('editDistrictBtn').addEventListener('click', () => {
    if (!currentDistrict) return;
    // User districts edit in place; built-ins open as an editable duplicate.
    openBuilder({ existing: currentDistrict, editable: currentSource === 'user', onSaved: id => switchDistrict(id) });
  });
  // Export every created district as one .json (backup / hand-off / commit).
  document.getElementById('exportAllBtn').addEventListener('click', () => {
    const json = exportDistrictsBundle();
    if (Object.keys(JSON.parse(json)).length === 0) {
      window.alert('No created districts to export yet. Make one with “＋ District” first.');
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = 'districts-backup.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  // Import a previously-exported bundle back into this browser.
  document.getElementById('importAllInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const bundle = JSON.parse(reader.result);
        const n = importDistrictsBundle(bundle);
        window.alert(`Imported ${n} district(s).`);
        const firstId = Object.keys(bundle)[0];
        if (firstId) switchDistrict(firstId); else renderPicker(currentDistrict && currentDistrict.id);
      } catch (err) {
        window.alert('Could not read that file: ' + err.message);
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  });
  document.getElementById('deleteDistrictBtn').addEventListener('click', () => {
    if (currentSource !== 'user' || !currentDistrict) return;
    if (!window.confirm(`Delete district “${currentDistrict.name}”? This removes it and its saved progress from this browser. (Exported files in the repo are not affected.)`)) return;
    deleteUserDistrict(currentDistrict.id);
    const next = (listDistricts()[0] || { id: DEFAULT_DISTRICT }).id;
    switchDistrict(next);
  });

  // Pick the remembered district if it still exists, else the default.
  const remembered = loadSelectedDistrict();
  const known = new Set(listDistricts().map(d => d.id));
  const startId = (remembered && known.has(remembered)) ? remembered : DEFAULT_DISTRICT;
  await switchDistrict(startId);
}

// Register the service worker for offline / installable use (no-op on file://).
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
  });
}

main();
