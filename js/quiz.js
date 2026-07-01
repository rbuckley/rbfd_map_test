// Quiz engine: Explore and Test modes, scoring, missed-street retry, and the
// exclusion manager. Test has two toggles: selection (random vs click-to-pick)
// and answer method (dropdown vs typing). Data (street names, default
// exclusions, confusion groups) and the rendered SVG are injected, so this
// engine is map-agnostic.

import { mergeBlockEntries } from './renames.js';

export function createQuiz({ dom }) {
  // Per-district refs — (re)assigned by setDistrict so we can switch districts
  // without re-wiring the persistent controls.
  let district = null;
  let svg = null;
  let mapView = null;
  let persist = () => {};
  let onSelect = null;           // notified when a street is tapped in Explore
  let onRotate = null;           // notified (new angle) when the map is rotated
  let STREET_NAMES = [];
  let confusionGroupList = [];   // array of name-arrays (any number of groups)
  let defaultExcluded = new Set();
  let userExcluded = new Set();
  let streetEls = {};

  // --- State ---
  let mode = 'explore';          // 'explore' | 'test' | 'blocks'
  let selection = 'random';      // 'random' | 'click' (Test only)
  let answerMethod = 'dropdown'; // 'dropdown' | 'type' (Test only)
  let currentKind = null;        // 'random' | 'retry' | 'click' — the live question's kind
  let target = null;
  let correct = 0;
  let total = 0;
  let missed = new Set();
  let asked = new Set();
  let useMissedPool = false;
  // Blocks mode
  let blockIndex = {};           // street -> [{block, x, y, count}] (from district.blocks)
  let blockList = [];            // [{street, block, x, y, count}]
  let blockThreshold = 150;      // proximity (map units) counted as correct in Locate
  let blockStyle = 'locate';     // 'locate' | 'identify'
  let blockTarget = null;
  // Certification exam (null when inactive). Fully isolated from practice score.
  let exam = null;
  let examUI = null;

  function save() {
    persist({ correct, total, missed, userExcluded });
  }

  const shuffle = arr => {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  };

  // Reset the mode / selection / answer / block-style tab highlights.
  function syncTabUI() {
    dom.modeTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
    dom.selectionTabs.forEach(t => t.classList.toggle('active', t.dataset.selection === selection));
    dom.answerTabs.forEach(t => t.classList.toggle('active', t.dataset.answer === answerMethod));
    dom.blockStyleTabs.forEach(t => t.classList.toggle('active', t.dataset.blockstyle === blockStyle));
  }

  // Load (or switch to) a district: rebind data + SVG and reset quiz state.
  function setDistrict(opts) {
    if (exam) forceClearExam();   // a district switch aborts any stray exam
    district = opts.district;
    svg = opts.svg;
    mapView = opts.mapView;
    persist = opts.persist;
    onSelect = opts.onSelect || null;
    onRotate = opts.onRotate || null;
    const initial = opts.initial || {};

    STREET_NAMES = district.streets;
    confusionGroupList = Object.values(district.confusionGroups || {});
    defaultExcluded = new Set(district.excluded || []);
    userExcluded = new Set(initial.userExcluded || []);

    correct = initial.correct || 0;
    total = initial.total || 0;
    missed = new Set(initial.missed || []);
    asked = new Set();
    useMissedPool = false;
    target = null;
    currentKind = null;
    mode = 'explore';
    selection = 'random';
    answerMethod = 'dropdown';
    blockStyle = 'locate';
    blockTarget = null;

    // Build the Blocks index from district.blocks.
    blockIndex = district.blocks || {};
    rebuildBlockState();
    syncTabUI();

    // Build the street element index from the injected SVG.
    streetEls = {};
    exploreSelectedEl = null;
    svg.querySelectorAll('.street').forEach(g => {
      streetEls[g.dataset.name] = g;
      g.addEventListener('click', e => {
        e.stopPropagation();
        handleStreetClick(g.dataset.name);
      });
    });
    // One capture-phase listener handles both the Exam locate-tap and the
    // Blocks "Locate" tap before they reach the per-street click handlers.
    svg.addEventListener('click', handleMapCaptureTap, true);

    clearAllMarksComplete();
    updateScore();
    updateExclusionCount();
    applyControlVisibility();
    dom.inputRow.style.display = 'none';
    dom.testToggles.style.display = 'none';
    dom.blocksToggles.style.display = 'none';
    showPrompt('Tap any street to see its name. Pinch or scroll to zoom. Drag to pan.');
    showFeedback('');
  }

  // (Re)derive the flat block list + proximity threshold from blockIndex.
  function rebuildBlockState() {
    blockList = [];
    for (const [street, arr] of Object.entries(blockIndex)) {
      for (const b of arr) blockList.push({ street, block: b.block, x: b.x, y: b.y, count: b.count });
    }
    blockThreshold = computeBlockThreshold(blockList);
  }

  function computeBlockThreshold(list) {
    if (list.length < 2) return 150;
    const ds = list.map(a => {
      let best = Infinity;
      for (const b of list) { if (b === a) continue; const d = Math.hypot(a.x - b.x, a.y - b.y); if (d < best) best = d; }
      return best;
    }).filter(d => Number.isFinite(d)).sort((x, y) => x - y);
    const med = ds[Math.floor(ds.length / 2)] || 150;
    return Math.max(40, med * 0.6);
  }

  function clearAllMarks() {
    svg.querySelectorAll('.street').forEach(g => {
      g.classList.remove('target', 'revealed', 'hover');
    });
  }
  function clearAllMarksComplete() {
    svg.querySelectorAll('.street').forEach(g => {
      g.classList.remove('target', 'correct', 'wrong', 'revealed', 'hover', 'retry-highlight');
    });
  }

  // Prompt text for a question, by kind and current answer method.
  function promptFor(kind) {
    const dd = answerMethod === 'dropdown';
    if (kind === 'retry') return dd ? 'Retry: Pick the name of this red street.' : 'Retry: Type the name of this red street.';
    if (kind === 'click') return dd ? 'Pick the name of this street.' : 'Type the name of this street.';
    return dd
      ? 'Pick the name of the highlighted street from the dropdown. Tapping the map = "I don\'t know".'
      : 'Type the name of the highlighted street. Tapping the map = "I don\'t know".';
  }

  // Set up the UI for a question on `name`. Used by every selection path
  // (random pick, click-to-pick, red-street retry) and by the answer toggle.
  function presentQuestion(name, kind) {
    currentKind = kind;
    target = name;
    streetEls[name].classList.add('target');
    if (useMissedPool) streetEls[name].classList.add('retry-highlight');
    mapView.panToStreet(streetEls[name]);
    dom.inputRow.style.display = 'flex';
    if (answerMethod === 'dropdown') {
      setupDropdown(name);
      dom.dropdown.style.display = '';
      dom.textbox.style.display = 'none';
    } else {
      dom.dropdown.style.display = 'none';
      dom.textbox.style.display = '';
      dom.textbox.value = '';
      dom.textbox.focus();
    }
    showPrompt(promptFor(kind));
    showFeedback('');
  }

  // Click selection: user picked the street to be quizzed on (no penalty for
  // switching streets mid-question). Keeps prior correct/wrong marks.
  function askStreet(name) {
    clearAllMarks();
    presentQuestion(name, 'click');
  }

  // What to do after a question is answered/abandoned.
  function advance() {
    if (selection === 'random') {
      nextQuestion();
    } else {
      target = null;
      clearAllMarks();
      showPrompt('Click any street to be quizzed on it.');
    }
  }

  function handleStreetClick(name) {
    if (exam) return;   // exam taps are handled in capture phase
    if (mode === 'explore') {
      showFeedback(name, 'info');
      selectStreet(name);
      if (onSelect) onSelect(name);
      return;
    }
    if (mode !== 'test') return;
    // Tapping a wrong (red) street retries it (both selection modes).
    if (streetEls[name] && streetEls[name].classList.contains('wrong')) {
      retryRedStreet(name);
      return;
    }
    if (selection === 'click') {
      askStreet(name);
      return;
    }
    // Random selection: clicking the map = "I don't know" — stays red for retry.
    if (!target) {
      showFeedback('Press "New" to start a question.', 'info');
      return;
    }
    total++;
    missed.add(target);
    streetEls[target].classList.remove('target');
    streetEls[target].classList.add('wrong');
    const msg = (name === target)
      ? `Didn't know. Tap the red street to retry. Answer: ${target}.`
      : `Didn't know. Answer: ${target}. Tap red streets to retry them.`;
    showFeedback(msg, 'bad');
    updateScore();
    save();
    setTimeout(() => { target = null; advance(); }, 1800);
  }

  function retryRedStreet(name) {
    if (target && target !== name) {
      asked.delete(target);
      streetEls[target] && streetEls[target].classList.remove('target');
    }
    presentQuestion(name, 'retry');
  }

  // Explore selection: keep the tapped street highlighted while its inline row
  // is open. Tracked by element (survives a rename/merge of the street) and
  // cleared on dismiss (Cancel / mode switch / tapping another street).
  let exploreSelectedEl = null;
  function selectStreet(name) {
    if (exploreSelectedEl) exploreSelectedEl.classList.remove('hover');
    exploreSelectedEl = streetEls[name] || null;
    if (exploreSelectedEl) exploreSelectedEl.classList.add('hover');
  }
  function clearExploreSelection() {
    if (exploreSelectedEl) { exploreSelectedEl.classList.remove('hover'); exploreSelectedEl = null; }
  }

  // --- Quiz / Test logic ---
  function isExcluded(n) { return defaultExcluded.has(n) || userExcluded.has(n); }
  function getActiveStreets() { return STREET_NAMES.filter(n => !isExcluded(n)); }
  function pickPool() {
    if (useMissedPool) return Array.from(missed).filter(n => !asked.has(n) && !isExcluded(n));
    return getActiveStreets().filter(n => !asked.has(n));
  }

  function nextQuestion() {
    clearAllMarks();
    const pool = pickPool();
    if (pool.length === 0) {
      if (useMissedPool) {
        showFeedback('All missed streets retried. Press New to restart with a fresh round.', 'info');
      } else {
        const totalStreets = getActiveStreets().length;
        const pct = total ? Math.round(100 * correct / total) : 0;
        showFeedback(`Round complete! All ${totalStreets} streets asked. Score: ${correct}/${total} (${pct}%). Press New to start again.`, 'info');
      }
      target = null;
      return;
    }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    asked.add(pick);
    presentQuestion(pick, 'random');
  }

  function setupDropdown(answer) {
    const active = getActiveStreets();
    const distractors = active.filter(n => n !== answer);

    // Prioritize confusion-group siblings as distractors.
    let prioritized = [];
    for (const grp of confusionGroupList) {
      if (grp.includes(answer)) {
        prioritized = grp.filter(n => n !== answer && active.includes(n));
        break;
      }
    }

    const generalPool = distractors.filter(n => !prioritized.includes(n));

    const shuffle = arr => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };
    shuffle(prioritized);
    shuffle(generalPool);

    const priCount = Math.min(prioritized.length, 4);
    let chosen = prioritized.slice(0, priCount);
    chosen = chosen.concat(generalPool.slice(0, 7 - chosen.length));
    chosen.push(answer);
    shuffle(chosen);

    dom.dropdown.innerHTML = '<option value="">-- choose --</option>' +
      chosen.map(o => `<option value="${o}">${o}</option>`).join('');
  }

  function markCorrect(name) {
    total++; correct++;
    missed.delete(name);
    streetEls[name].classList.remove('target', 'wrong');
    streetEls[name].classList.add('correct');
    showFeedback(`Correct: ${name}`, 'ok');
    updateScore();
    save();
    target = null;
    setTimeout(advance, 900);
  }

  function markWrongCurrent(observed) {
    total++;
    missed.add(target);
    streetEls[target].classList.remove('target');
    streetEls[target].classList.add('wrong');
    const msg = observed
      ? `Wrong. That was ${observed}. The answer was ${target}. Tap the red street to retry.`
      : `Wrong. Answer: ${target}. Tap the red street to retry.`;
    showFeedback(msg, 'bad');
    updateScore();
    save();
    setTimeout(() => { target = null; advance(); }, 1800);
  }

  function revealCurrent() {
    if (mode === 'blocks') {
      if (!blockTarget) { showFeedback('Press "New" to start.', 'info'); return; }
      mapView.marker(blockTarget.x, blockTarget.y, { color: '#f1c40f' });
      mapView.panToPoint(blockTarget.x, blockTarget.y);
      showFeedback(`Answer: ${blockTarget.block} block of ${blockTarget.street} (yellow dot).`, 'info');
      return;
    }
    if (!target) { showFeedback('No active question.', 'info'); return; }
    streetEls[target].classList.add('revealed');
    showFeedback(`Answer: ${target}`, 'info');
  }

  // --- Blocks mode ---
  function newBlockQuestion() {
    mapView.clearMarkers();
    showFeedback('');
    if (!blockList.length) {
      blockTarget = null;
      showPrompt('No address-block data for this district. Re-import it with “Address blocks” enabled.');
      return;
    }
    if (blockStyle === 'locate') {
      blockTarget = blockList[Math.floor(Math.random() * blockList.length)];
      dom.inputRow.style.display = 'none';
      showPrompt(`Tap the ${blockTarget.block} block of ${blockTarget.street}.`);
    } else {
      // Identify: assume the street is known — quiz which block along it is lit.
      // Prefer streets with 2+ blocks so the choice is meaningful.
      const streets = Object.keys(blockIndex);
      const multi = streets.filter(s => blockIndex[s].length >= 2);
      const street = (multi.length ? multi : streets)[Math.floor(Math.random() * (multi.length ? multi.length : streets.length))];
      const arr = blockIndex[street];
      const b = arr[Math.floor(Math.random() * arr.length)];
      blockTarget = { street, block: b.block, x: b.x, y: b.y, count: b.count };
      mapView.marker(blockTarget.x, blockTarget.y, { color: '#ff8a3d' });
      mapView.panToPoint(blockTarget.x, blockTarget.y);
      setupBlockDropdown(blockTarget);
      dom.inputRow.style.display = 'flex';
      dom.dropdown.style.display = ''; dom.textbox.style.display = 'none';
      showPrompt(`Which block of ${blockTarget.street} is highlighted?`);
    }
  }

  // Distractors are the other blocks on the SAME street (the street is given).
  function setupBlockDropdown(tgt) {
    const opts = shuffle(blockIndex[tgt.street].map(b => b.block));
    dom.dropdown.innerHTML = '<option value="">-- choose --</option>' +
      opts.map(n => `<option value="${n}">${n} block</option>`).join('');
  }

  function blocksAdvance() { if (mode === 'blocks') newBlockQuestion(); }

  function markBlockCorrect() {
    total++; correct++;
    showFeedback('Correct!', 'ok');
    updateScore(); save();
    blockTarget = null;
    setTimeout(blocksAdvance, 1000);
  }
  function markBlockWrong() {
    total++;
    const t = blockTarget;
    showFeedback(`Not quite — the ${t.block} block of ${t.street} is the green dot.`, 'bad');
    updateScore(); save();
    blockTarget = null;
    setTimeout(blocksAdvance, 2200);
  }

  // Locate: a tap anywhere on the map is the guess (capture phase, so it
  // pre-empts street click handlers).
  function handleBlockTap(e) {
    if (exam) return;
    if (mode !== 'blocks' || blockStyle !== 'locate' || !blockTarget) return;
    e.stopPropagation();
    const [x, y] = mapView.clientToContent(e.clientX, e.clientY);
    const tgt = blockTarget;
    const hit = Math.hypot(x - tgt.x, y - tgt.y) <= blockThreshold;
    mapView.marker(tgt.x, tgt.y, { color: '#2ecc71' });   // correct spot
    mapView.marker(x, y, { color: '#e74c3c' });            // your tap
    if (hit) markBlockCorrect(); else markBlockWrong();
  }

  function submitBlockAnswer() {
    if (!blockTarget) return;
    const ans = dom.dropdown.value;
    if (!ans) return;
    if (Number(ans) === blockTarget.block) markBlockCorrect();
    else markBlockWrong();
  }

  function setBlockStyle(s) {
    if (s === blockStyle) return;
    blockStyle = s;
    blockTarget = null;
    mapView.clearMarkers();
    showFeedback('');
    dom.inputRow.style.display = 'none';
    showPrompt(`Press "New" to start. ${blockStyle === 'locate' ? "You'll tap where a block is." : "You'll name the highlighted block."}`);
  }

  function updateScore() {
    dom.score.textContent = `${correct}/${total}`;
    dom.pct.textContent = total ? Math.round(100 * correct / total) + '%' : '--';
  }
  function showPrompt(s) { dom.prompt.textContent = s; }
  function showFeedback(s, cls) {
    dom.feedback.textContent = s;
    dom.feedback.className = 'feedback' + (cls ? ' ' + cls : '');
  }

  // Answer normalization for Test mode (case + common abbreviations).
  const norm = s => s.toLowerCase().replace(/\s+/g, ' ').replace(/\./g, '')
    .replace(/\bst\b/g, 'street').replace(/\bave\b/g, 'avenue')
    .replace(/\bblvd\b/g, 'boulevard').replace(/\bln\b/g, 'lane')
    .replace(/\bdr\b/g, 'drive').replace(/\bpl\b/g, 'place')
    .replace(/\brd\b/g, 'road').replace(/\bct\b/g, 'court')
    .replace(/\bn\b/g, 'north').replace(/\bs\b/g, 'south')
    .replace(/\be\b/g, 'east').replace(/\bw\b/g, 'west')
    .trim();

  function submitAnswer() {
    if (mode === 'blocks') { submitBlockAnswer(); return; }
    if (!target) return;
    const answer = answerMethod === 'dropdown' ? dom.dropdown.value : dom.textbox.value.trim();
    if (!answer) return;
    if (norm(answer) === norm(target)) markCorrect(target);
    else markWrongCurrent(answerMethod === 'dropdown' ? answer : null);
  }

  function skipCurrent() {
    if (!target) return;
    total++;
    missed.add(target);
    showFeedback(`Skipped: ${target}. Tap the red street to retry.`, 'info');
    updateScore();
    save();
    streetEls[target] && streetEls[target].classList.remove('target');
    streetEls[target] && streetEls[target].classList.add('wrong');
    target = null;
    setTimeout(advance, 600);
  }

  // --- Exclusion management ---
  function updateExclusionCount() {
    const count = defaultExcluded.size + userExcluded.size;
    dom.exclusionToggle.textContent = `Manage Exclusions (${count})`;
  }
  function renderExclusionManager() {
    const allExcluded = [...defaultExcluded, ...userExcluded].sort();
    if (allExcluded.length === 0) {
      dom.exclusionManager.innerHTML = '<div style="color:var(--dim);font-size:12px;">No excluded streets.</div>';
      updateExclusionCount();
      return;
    }
    dom.exclusionManager.innerHTML = '';
    for (const name of allExcluded) {
      const isDefault = defaultExcluded.has(name);
      const row = document.createElement('div');
      row.className = 'excl-item';
      const label = document.createElement('span');
      label.textContent = name + (isDefault ? ' (default)' : '');
      const btn = document.createElement('button');
      btn.textContent = 'Include';
      btn.addEventListener('click', () => reincludeStreet(name));
      row.append(label, btn);
      dom.exclusionManager.appendChild(row);
    }
    updateExclusionCount();
  }
  function reincludeStreet(name) {
    defaultExcluded.delete(name);
    userExcluded.delete(name);
    renderExclusionManager();
    save();
  }

  // --- Mode / toggle switching ---
  // Random-only controls (New / Skip / Retry Missed) are hidden in Click
  // selection and in Explore.
  function applyControlVisibility() {
    const testRandom = (mode === 'test' && selection === 'random');
    dom.newQ.style.display = (testRandom || mode === 'blocks') ? '' : 'none';
    dom.missed.style.display = testRandom ? '' : 'none';
    dom.skip.style.display = testRandom ? '' : 'none';
  }

  function setMode(newMode) {
    mode = newMode;
    clearAllMarksComplete();
    if (mapView) mapView.clearMarkers();
    target = null;
    blockTarget = null;
    useMissedPool = false;
    dom.testToggles.style.display = mode === 'test' ? 'flex' : 'none';
    dom.blocksToggles.style.display = mode === 'blocks' ? 'flex' : 'none';
    if (mode === 'explore') {
      dom.inputRow.style.display = 'none';
      showPrompt('Tap any street to see its name. Pinch or scroll to zoom. Drag to pan.');
    } else if (mode === 'blocks') {
      dom.inputRow.style.display = 'none';
      showPrompt(blockList.length
        ? `Press "New" to start. ${blockStyle === 'locate' ? "You'll tap where a block is." : "You'll name the highlighted block."}`
        : 'No address-block data for this district. Re-import it with “Address blocks” enabled.');
    } else { // test
      dom.inputRow.style.display = 'flex';
      dom.dropdown.style.display = answerMethod === 'dropdown' ? '' : 'none';
      dom.textbox.style.display = answerMethod === 'type' ? '' : 'none';
      showPrompt(selection === 'random' ? 'Press "New" to start.' : 'Click any street to be quizzed on it.');
    }
    showFeedback('');
    applyControlVisibility();
  }

  function setSelection(s) {
    if (s === selection) return;
    selection = s;
    target = null;
    useMissedPool = false;
    clearAllMarks();
    applyControlVisibility();
    showPrompt(selection === 'random' ? 'Press "New" to start.' : 'Click any street to be quizzed on it.');
    showFeedback('');
  }

  function setAnswerMethod(m) {
    if (m === answerMethod) return;
    answerMethod = m;
    if (target) {
      // Swap the input for the live question without penalty or re-pick.
      presentQuestion(target, currentKind || 'click');
    } else {
      dom.dropdown.style.display = answerMethod === 'dropdown' ? '' : 'none';
      dom.textbox.style.display = answerMethod === 'type' ? '' : 'none';
    }
  }

  function startNew() {
    if (mode === 'blocks') { newBlockQuestion(); return; }
    if (mode === 'explore') {
      showPrompt('Tap any street. (Switch to Test mode to be quizzed.)');
      return;
    }
    // If everything has been asked, restart the round fresh.
    if (asked.size >= getActiveStreets().length) {
      asked.clear();
      correct = 0; total = 0;
      missed.clear();
      clearAllMarksComplete();
      updateScore();
      save();
    }
    useMissedPool = false;
    nextQuestion();
  }

  function retryMissed() {
    if (mode === 'explore') return;
    if (missed.size === 0) { showFeedback('No missed streets yet.', 'info'); return; }
    for (const n of missed) asked.delete(n);
    useMissedPool = true;
    nextQuestion();
  }

  // Toggle a street's exclusion by name (used by the Explore inline control).
  // Returns the new excluded state. Excluded streets are skipped by Test and the
  // exam's question pools (see getActiveStreets).
  function toggleExclude(name) {
    if (!name || !streetEls[name]) return false;
    if (isExcluded(name)) {
      defaultExcluded.delete(name);
      userExcluded.delete(name);
    } else {
      userExcluded.add(name);
      streetEls[name].classList.remove('target', 'correct', 'wrong', 'retry-highlight');
      if (target === name) target = null;
    }
    updateExclusionCount();
    if (dom.exclusionManager.classList.contains('open')) renderExclusionManager();
    save();
    return isExcluded(name);
  }

  function excludeCurrent() {
    if (!target) return;
    const name = target;
    userExcluded.add(name);
    streetEls[name] && streetEls[name].classList.remove('target', 'correct', 'wrong', 'retry-highlight');
    showFeedback(`Excluded: ${name}`, 'info');
    target = null;
    renderExclusionManager();
    save();
    setTimeout(advance, 600);
  }

  // --- Wire up DOM controls ---
  dom.modeTabs.forEach(t => {
    t.addEventListener('click', () => {
      dom.modeTabs.forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      setMode(t.dataset.mode);
    });
  });
  dom.selectionTabs.forEach(t => {
    t.addEventListener('click', () => {
      dom.selectionTabs.forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      setSelection(t.dataset.selection);
    });
  });
  dom.answerTabs.forEach(t => {
    t.addEventListener('click', () => {
      dom.answerTabs.forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      setAnswerMethod(t.dataset.answer);
    });
  });
  dom.blockStyleTabs.forEach(t => {
    t.addEventListener('click', () => {
      dom.blockStyleTabs.forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      setBlockStyle(t.dataset.blockstyle);
    });
  });
  dom.newQ.addEventListener('click', startNew);
  dom.reveal.addEventListener('click', revealCurrent);
  dom.missed.addEventListener('click', retryMissed);
  dom.resetView.addEventListener('click', () => mapView && mapView.resetView());
  dom.rotate.addEventListener('click', () => {
    if (!mapView) return;
    const angle = mapView.rotate();
    if (onRotate) onRotate(angle);
  });
  dom.submitAns.addEventListener('click', submitAnswer);
  dom.skip.addEventListener('click', skipCurrent);
  dom.excludeBtn.addEventListener('click', excludeCurrent);
  dom.textbox.addEventListener('keydown', e => {
    if (e.key === 'Enter') submitAnswer();
  });
  dom.dropdown.addEventListener('change', submitAnswer);
  dom.exclusionToggle.addEventListener('click', () => {
    dom.exclusionManager.classList.toggle('open');
    if (dom.exclusionManager.classList.contains('open')) renderExclusionManager();
  });

  // ===== Certification exam =====
  // A proctored, locate-the-named-street exam. Runs on its own `exam` state and
  // NEVER calls save()/persist — practice progress is untouched.
  const escapeHtml = s => String(s == null ? '' : s).replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function bindExamUI() {
    if (examUI) return examUI;
    const g = id => document.getElementById(id);
    const u = {
      setup: g('examSetup'), setupDistrict: g('examSetupDistrict'),
      name: g('examName'), badge: g('examBadge'), coverage: g('examCoverage'),
      pass: g('examPass'), start: g('examStart'), cancel: g('examCancel'),
      bar: g('examBar'), progress: g('examProgress'), locate: g('examLocate'),
      panel: g('examPanel'), submit: g('examSubmit'), dontKnow: g('examDontKnow'), end: g('examEnd'),
      results: g('examResults'), resultTitle: g('examResultTitle'), resultBody: g('examResultBody'), done: g('examDone'),
    };
    u.start.addEventListener('click', startExam);
    u.cancel.addEventListener('click', exitExam);
    u.submit.addEventListener('click', () => { if (exam && exam.pickedName) commitAnswer(exam.pickedName); });
    u.dontKnow.addEventListener('click', () => { if (exam) commitAnswer(null); });
    u.end.addEventListener('click', () => { if (exam) finishExam(); });
    u.done.addEventListener('click', exitExam);
    u.name.addEventListener('input', updateStartEnabled);
    u.badge.addEventListener('input', updateStartEnabled);
    examUI = u;
    return u;
  }

  function renderCoverageOptions(n) {
    const presets = [25, 50].filter(p => p < n);           // only meaningful below full
    const opts = [...presets.map(p => ({ label: `${p} questions`, count: p })), { label: `Full (${n})`, count: n }];
    examUI.coverage.innerHTML = opts.map((o, i) =>
      `<button type="button" class="mode-tab${i === opts.length - 1 ? ' active' : ''}" data-count="${o.count}">${o.label}</button>`).join('');
    examUI.coverage.querySelectorAll('.mode-tab').forEach(b => b.addEventListener('click', () => {
      examUI.coverage.querySelectorAll('.mode-tab').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    }));
  }
  const selectedCoverageCount = () => {
    const b = examUI.coverage.querySelector('.mode-tab.active');
    return b ? parseInt(b.dataset.count, 10) : 0;
  };
  function updateStartEnabled() {
    examUI.start.disabled = !(examUI.name.value.trim() && examUI.badge.value.trim() && getActiveStreets().length > 0);
  }

  // Open the setup card (called from the Maps menu).
  function enterExam(districtId) {
    const u = bindExamUI();
    const active = getActiveStreets();
    exam = { phase: 'setup', examinee: { name: '', badge: '' }, districtId: districtId || (district && district.id),
      passPct: 90, questions: [], index: 0, startTime: 0, endTime: 0, pickedEl: null, pickedName: null };
    u.setupDistrict.textContent = `District: ${district ? district.name : ''} — ${active.length} active streets`;
    u.name.value = ''; u.badge.value = ''; u.pass.value = '90';
    renderCoverageOptions(active.length);
    updateStartEnabled();
    u.results.style.display = 'none';
    u.setup.style.display = 'flex';
  }

  function startExam() {
    const u = examUI;
    const name = u.name.value.trim(), badge = u.badge.value.trim();
    const active = getActiveStreets();
    if (!name || !badge || !active.length) return;
    const count = Math.min(selectedCoverageCount() || active.length, active.length);
    let pass = parseInt(u.pass.value, 10);
    if (!Number.isFinite(pass) || pass < 1) pass = 90;
    if (pass > 100) pass = 100;
    const pool = shuffle(active.slice()).slice(0, count);
    exam = {
      phase: 'running', examinee: { name, badge }, districtId: exam.districtId, passPct: pass,
      questions: pool.map(s => ({ target: s, answer: null, correct: false })),
      index: 0, startTime: Date.now(), endTime: 0, pickedEl: null, pickedName: null,
    };
    u.setup.style.display = 'none';
    document.body.classList.add('exam-active');
    const menu = document.getElementById('mapsMenu'); if (menu) menu.style.display = 'none';
    clearAllMarksComplete();   // drop any practice marks (does not touch score)
    u.bar.style.display = 'flex';
    u.panel.style.display = 'flex';
    renderExamQuestion();
  }

  function renderExamQuestion() {
    const u = examUI, q = exam.questions[exam.index];
    if (exam.pickedEl) exam.pickedEl.classList.remove('exam-pick');
    exam.pickedEl = null; exam.pickedName = null;
    u.progress.textContent = `Question ${exam.index + 1} of ${exam.questions.length}`;
    u.locate.textContent = `Locate: ${q.target}`;
    u.submit.disabled = true;
  }

  // Capture-phase tap during a running exam: select the tapped street (neutral
  // highlight only) without revealing correctness; ignore empty-space taps.
  function handleExamTap(e) {
    e.stopPropagation();
    let el = e.target;
    while (el && el !== svg && !(el.classList && el.classList.contains('street'))) el = el.parentNode;
    if (!el || !el.classList || !el.classList.contains('street')) return;
    if (exam.pickedEl) exam.pickedEl.classList.remove('exam-pick');
    exam.pickedEl = el; exam.pickedName = el.dataset.name;
    el.classList.add('exam-pick');
    examUI.submit.disabled = false;
  }

  function commitAnswer(answerName) {
    const q = exam.questions[exam.index];
    q.answer = answerName;
    q.correct = answerName === q.target;   // strict: both are canonical street names
    exam.index++;
    if (exam.index >= exam.questions.length) finishExam();
    else renderExamQuestion();
  }

  // Tally and show results. Unanswered questions (ending early) stay incorrect,
  // so ending early can never inflate the score.
  function finishExam() {
    exam.endTime = Date.now();
    exam.phase = 'results';
    if (exam.pickedEl) { exam.pickedEl.classList.remove('exam-pick'); exam.pickedEl = null; }
    document.body.classList.remove('exam-active');
    examUI.bar.style.display = 'none';
    examUI.panel.style.display = 'none';
    const total = exam.questions.length;
    const correct = exam.questions.filter(q => q.correct).length;
    const pct = total ? Math.round(100 * correct / total) : 0;
    const passed = pct >= exam.passPct;
    const missed = exam.questions.filter(q => !q.correct).map(q => q.target);
    const dur = Math.max(0, Math.round((exam.endTime - exam.startTime) / 1000));
    const mm = String(Math.floor(dur / 60)).padStart(2, '0'), ss = String(dur % 60).padStart(2, '0');
    examUI.resultTitle.textContent = passed ? '✅ Pass' : '❌ Fail';
    examUI.resultBody.innerHTML = `
      <div class="exam-result-score">${correct}/${total} <span style="font-size:16px;color:var(--dim)">(${pct}%)</span></div>
      <div class="exam-verdict ${passed ? 'pass' : 'fail'}">${passed ? 'PASS' : 'FAIL'} — needed ${exam.passPct}%</div>
      <div class="exam-meta">
        <span>Examinee: ${escapeHtml(exam.examinee.name)} (${escapeHtml(exam.examinee.badge)})</span>
        <span>District: ${escapeHtml(district ? district.name : '')}</span>
        <span>Time: ${mm}:${ss}</span>
      </div>
      ${missed.length
        ? `<div class="exam-missed"><b>Missed (${missed.length})</b><ul>${missed.map(m => `<li>${escapeHtml(m)}</li>`).join('')}</ul></div>`
        : '<div class="exam-missed">All streets located correctly. 🎉</div>'}`;
    examUI.results.style.display = 'flex';
  }

  function hideExamUI() {
    if (!examUI) return;
    for (const k of ['setup', 'results', 'bar', 'panel']) examUI[k].style.display = 'none';
  }
  // Hard reset used when a district switch interrupts an exam.
  function forceClearExam() {
    if (exam && exam.pickedEl) exam.pickedEl.classList.remove('exam-pick');
    exam = null;
    document.body.classList.remove('exam-active');
    hideExamUI();
  }
  // Leave the exam and restore clean practice chrome (Explore).
  function exitExam() {
    forceClearExam();
    setMode('explore');
    syncTabUI();
  }
  const examInProgress = () => !!exam;

  function handleMapCaptureTap(e) {
    if (exam && exam.phase === 'running') { handleExamTap(e); return; }
    handleBlockTap(e);
  }

  // Rename a street live, in place (keeps zoom/pan). Propagates to all six
  // reference sites; a collision with an existing name merges the two. The
  // persisted override layer (js/app.js) is the source of truth across loads;
  // this mirrors it on the live state so the map updates without a reload.
  function applyRename(oldName, newName) {
    oldName = oldName == null ? '' : String(oldName);
    newName = (newName == null ? '' : String(newName)).trim();
    if (!oldName || !newName || oldName === newName || !streetEls[oldName]) return;
    const merging = !!streetEls[newName] && streetEls[newName] !== streetEls[oldName];

    // DOM: rename the group, or fold its paths into the surviving group.
    const oldEl = streetEls[oldName];
    if (merging) {
      const keep = streetEls[newName];
      while (oldEl.firstChild) keep.appendChild(oldEl.firstChild);
      if (oldEl.parentNode) oldEl.parentNode.removeChild(oldEl);
    } else {
      oldEl.setAttribute('data-name', newName);
      streetEls[newName] = oldEl;
    }
    delete streetEls[oldName];

    STREET_NAMES = [...new Set(STREET_NAMES.map(n => (n === oldName ? newName : n)))];
    confusionGroupList = confusionGroupList.map(grp => [...new Set(grp.map(n => (n === oldName ? newName : n)))]);
    for (const set of [defaultExcluded, userExcluded]) {
      if (set.has(oldName)) { set.delete(oldName); set.add(newName); }
    }
    if (blockIndex[oldName]) {
      blockIndex[newName] = mergeBlockEntries((blockIndex[newName] || []).concat(blockIndex[oldName]));
      delete blockIndex[oldName];
      rebuildBlockState();
    }
    if (target === oldName) target = newName;
    if (blockTarget && blockTarget.street === oldName) blockTarget.street = newName;
    updateExclusionCount();
    if (dom.exclusionManager.classList.contains('open')) renderExclusionManager();
  }

  return { setDistrict, enterExam, exitExam, examInProgress, applyRename, toggleExclude, isExcluded, clearExploreSelection };
}
