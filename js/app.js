// Bootstrap: build the district picker, load the selected district's map +
// data, render the SVG, and (re)point the quiz engine at it on each switch.
import { DEFAULT_DISTRICT, loadDistrict, listDistricts } from './districts.js';
import { createMapView } from './map.js';
import { createQuiz } from './quiz.js';
import { openBuilder } from './builder.js';
import { loadProgress, saveProgress, loadSelectedDistrict, saveSelectedDistrict } from './storage.js';

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
    testToggles: $('testToggles'),
    modeTabs: Array.from(document.querySelectorAll('#modeTabs .mode-tab')),
    selectionTabs: Array.from(document.querySelectorAll('#selectionTabs .mode-tab')),
    answerTabs: Array.from(document.querySelectorAll('#answerTabs .mode-tab')),
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

  // Builder entry points.
  document.getElementById('newDistrictBtn').addEventListener('click', () => {
    openBuilder({ onSaved: id => switchDistrict(id) });
  });
  document.getElementById('editDistrictBtn').addEventListener('click', () => {
    if (!currentDistrict) return;
    // User districts edit in place; built-ins open as an editable duplicate.
    openBuilder({ existing: currentDistrict, editable: currentSource === 'user', onSaved: id => switchDistrict(id) });
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
