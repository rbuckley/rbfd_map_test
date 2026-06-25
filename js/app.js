// Bootstrap: build the district picker, load the selected district's map +
// data, render the SVG, and (re)point the quiz engine at it on each switch.
import { DEFAULT_DISTRICT, loadDistrict, listDistricts } from './districts.js';
import { createMapView } from './map.js';
import { createQuiz } from './quiz.js';
import { openBuilder, exportDistrictFiles } from './builder.js';
import { openMapImporter } from './mapImporter.js';
import { loadProgress, saveProgress, loadSelectedDistrict, saveSelectedDistrict, deleteUserDistrict, exportDistrictsBundle, importDistrictsBundle, loadRenames, saveRenames } from './storage.js';
import { applyRenamesToRecord, applyRenamesToSvg, reverseDisplayToOriginal, bakeRenamedRecord } from './renames.js';

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
  let currentDistrict = null;   // renamed/transformed record shown by the quiz
  let currentOriginal = null;   // pristine record from loadDistrict (pre-rename)
  let currentRenames = {};      // { originalName: displayName } overrides
  let currentDistrictId = null;
  let currentSource = null;     // 'builtin' | 'user'

  // Load a district and (re)point the quiz + map view at it. Street-name
  // overrides are applied as a non-destructive layer on top of the shipped data.
  async function switchDistrict(id) {
    if (quiz.examInProgress()) return;   // a proctored exam locks the district
    let original;
    try {
      original = await loadDistrict(id);
    } catch (err) {
      mapWrap.innerHTML = `<div style="padding:24px;color:var(--red)">Failed to load map data: ${err.message}<br><br>This app must be served over HTTP (e.g. a local server or GitHub Pages), not opened directly from the filesystem.</div>`;
      return;
    }
    currentOriginal = original;
    currentDistrictId = id;
    currentRenames = loadRenames(id);
    const district = applyRenamesToRecord(original, currentRenames);
    currentDistrict = district;
    currentSource = (listDistricts().find(d => d.id === id) || {}).source || 'builtin';
    mapWrap.innerHTML = district.svgMarkup;   // markup still carries original names
    const svg = mapWrap.querySelector('#map');
    applyRenamesToSvg(svg, currentRenames);   // patch data-names + merge groups
    const mapView = createMapView(svg);
    quiz.setDistrict({
      district,
      svg,
      mapView,
      initial: loadProgress(id),
      persist: state => saveProgress(id, state),
      onSelect: onExploreSelect,
    });
    hideRenameRow();
    if (renameManager.classList.contains('open')) renderRenameManager();
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

  // --- Street-name editing ---
  const renameRow = document.getElementById('renameRow');
  const renameInput = document.getElementById('renameInput');
  const renameLabel = document.getElementById('renameLabel');
  const renameSave = document.getElementById('renameSave');
  const renameCancel = document.getElementById('renameCancel');
  const renameToggle = document.getElementById('renameToggle');
  const renameManager = document.getElementById('renameManager');
  let renameTargetOld = null;

  function hideRenameRow() { renameRow.style.display = 'none'; renameTargetOld = null; }
  // Tapping a street in Explore offers an inline rename for that street.
  function onExploreSelect(name) {
    renameTargetOld = name;
    renameLabel.textContent = 'Rename:';
    renameInput.value = name;
    renameRow.style.display = 'flex';
  }

  // The one rename entry point: resolve which shipped name is being edited,
  // record the override, persist it, and update the live map. A clash with an
  // existing name merges the two (after confirmation).
  function renameStreet(displayOld, newRaw) {
    const newName = (newRaw || '').trim();
    if (!newName || newName === displayOld || !currentDistrict) return;
    const rev = reverseDisplayToOriginal(currentOriginal.streets, currentRenames);
    const orig = Object.prototype.hasOwnProperty.call(rev, displayOld) ? rev[displayOld] : displayOld;
    if (currentDistrict.streets.includes(newName)) {
      if (!window.confirm(`“${newName}” already exists. Merge “${displayOld}” into it?`)) return;
    }
    if (newName === orig) delete currentRenames[orig];
    else currentRenames[orig] = newName;
    saveRenames(currentDistrictId, currentRenames);
    quiz.applyRename(displayOld, newName);
    currentDistrict = applyRenamesToRecord(currentOriginal, currentRenames);
    if (renameManager.classList.contains('open')) renderRenameManager();
  }

  renameSave.addEventListener('click', () => {
    if (renameTargetOld) { renameStreet(renameTargetOld, renameInput.value); hideRenameRow(); }
  });
  renameCancel.addEventListener('click', hideRenameRow);
  renameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { renameSave.click(); }
    else if (e.key === 'Escape') hideRenameRow();
  });
  // Leaving Explore dismisses the inline editor.
  document.querySelectorAll('#modeTabs .mode-tab').forEach(t => t.addEventListener('click', hideRenameRow));

  // Bulk editor: a filterable list of every street with an editable name.
  function renderRenameManager() {
    renameManager.innerHTML = '';
    const filter = document.createElement('input');
    filter.className = 'rename-filter';
    filter.type = 'text'; filter.placeholder = 'Filter streets…';
    const listWrap = document.createElement('div');
    renameManager.append(filter, listWrap);
    const names = [...currentDistrict.streets].sort((a, b) => a.localeCompare(b));
    const draw = q => {
      const ql = (q || '').toLowerCase();
      listWrap.innerHTML = '';
      for (const name of names) {
        if (ql && !name.toLowerCase().includes(ql)) continue;
        const row = document.createElement('div'); row.className = 'rename-item';
        const inp = document.createElement('input'); inp.type = 'text'; inp.value = name;
        inp.addEventListener('change', () => {
          const v = inp.value.trim();
          if (v && v !== name) renameStreet(name, v);
          else inp.value = name;
        });
        row.appendChild(inp); listWrap.appendChild(row);
      }
    };
    filter.addEventListener('input', () => draw(filter.value));
    draw('');
  }
  renameToggle.addEventListener('click', () => {
    renameManager.classList.toggle('open');
    if (renameManager.classList.contains('open')) renderRenameManager();
  });

  // Export the current map (with renames baked in) as committable files.
  document.getElementById('exportMapBtn').addEventListener('click', () => {
    if (!currentOriginal) return;
    const msg = exportDistrictFiles(bakeRenamedRecord(currentOriginal, currentRenames));
    window.alert(msg);
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

  // Certification exam (proctored). Launches on the current district.
  document.getElementById('examModeBtn').addEventListener('click', () => {
    if (currentDistrict) quiz.enterExam(currentDistrict.id);
  });

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
