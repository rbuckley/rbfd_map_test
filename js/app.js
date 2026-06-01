// Bootstrap: pick a district, load its map + data, render the SVG, then wire up
// the map view and quiz engine.
import { DEFAULT_DISTRICT, loadDistrict } from './districts.js';
import { createMapView } from './map.js';
import { createQuiz } from './quiz.js';
import { loadProgress, saveProgress } from './storage.js';

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
    modeTabs: Array.from(document.querySelectorAll('.mode-tab')),
  };
}

async function main() {
  const districtId = DEFAULT_DISTRICT;
  const mapWrap = document.querySelector('.map-wrap');

  let district;
  try {
    district = await loadDistrict(districtId);
  } catch (err) {
    mapWrap.innerHTML = `<div style="padding:24px;color:var(--red)">Failed to load map data: ${err.message}<br><br>This app must be served over HTTP (e.g. a local server or GitHub Pages), not opened directly from the filesystem.</div>`;
    return;
  }

  // Inject the SVG map into the page.
  mapWrap.innerHTML = district.svgMarkup;
  const svg = mapWrap.querySelector('#map');

  const mapView = createMapView(svg);
  const initial = loadProgress(districtId);

  createQuiz({
    district,
    svg,
    mapView,
    dom: gatherDom(),
    initial,
    persist: state => saveProgress(districtId, state),
  });
}

// Register the service worker for offline / installable use (no-op on file://).
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
  });
}

main();
