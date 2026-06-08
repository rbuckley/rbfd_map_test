// Quiz engine: Explore and Test modes, scoring, missed-street retry, and the
// exclusion manager. Test has two toggles: selection (random vs click-to-pick)
// and answer method (dropdown vs typing). Data (street names, default
// exclusions, confusion groups) and the rendered SVG are injected, so this
// engine is map-agnostic.

export function createQuiz({ dom }) {
  // Per-district refs — (re)assigned by setDistrict so we can switch districts
  // without re-wiring the persistent controls.
  let district = null;
  let svg = null;
  let mapView = null;
  let persist = () => {};
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
    district = opts.district;
    svg = opts.svg;
    mapView = opts.mapView;
    persist = opts.persist;
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
    blockList = [];
    for (const [street, arr] of Object.entries(blockIndex)) {
      for (const b of arr) blockList.push({ street, block: b.block, x: b.x, y: b.y, count: b.count });
    }
    blockThreshold = computeBlockThreshold(blockList);
    syncTabUI();

    // Build the street element index from the injected SVG.
    streetEls = {};
    svg.querySelectorAll('.street').forEach(g => {
      streetEls[g.dataset.name] = g;
      g.addEventListener('click', e => {
        e.stopPropagation();
        handleStreetClick(g.dataset.name);
      });
    });
    // Capture taps for Blocks "Locate" before they reach street handlers.
    svg.addEventListener('click', handleBlockTap, true);

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
    if (mode === 'explore') {
      showFeedback(name, 'info');
      flashHover(name);
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

  function flashHover(name) {
    const g = streetEls[name];
    if (!g) return;
    g.classList.add('hover');
    setTimeout(() => g.classList.remove('hover'), 1200);
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
  dom.rotate.addEventListener('click', () => mapView && mapView.rotate());
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

  return { setDistrict };
}
