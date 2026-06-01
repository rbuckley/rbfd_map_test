// Quiz engine: Explore / Quiz / Test modes, scoring, missed-street retry, and
// the exclusion manager. Data (street names, default exclusions, confusion
// groups) and the rendered SVG are injected, so this engine is map-agnostic.

export function createQuiz({ district, svg, mapView, dom, persist, initial }) {
  const STREET_NAMES = district.streets;
  const SISTER_STREETS = district.confusionGroups.sisterStreets;
  const GEM_STREETS = district.confusionGroups.gemStreets;
  const LETTER_AVENUES = district.confusionGroups.letterAvenues;

  // Default (map-author) exclusions can be re-included at runtime, so keep them
  // in a mutable Set rather than treating them as constant.
  const defaultExcluded = new Set(district.excluded);
  const userExcluded = new Set(initial.userExcluded || []);

  // --- State ---
  let mode = 'explore';
  let target = null;
  let correct = initial.correct || 0;
  let total = initial.total || 0;
  let missed = new Set(initial.missed || []);
  let asked = new Set();
  let useMissedPool = false;

  function save() {
    persist({ correct, total, missed, userExcluded });
  }

  // --- Build the street element index from the injected SVG ---
  const streetEls = {};
  svg.querySelectorAll('.street').forEach(g => {
    streetEls[g.dataset.name] = g;
    g.addEventListener('click', e => {
      e.stopPropagation();
      handleStreetClick(g.dataset.name);
    });
  });

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

  function handleStreetClick(name) {
    if (mode === 'explore') {
      showFeedback(name, 'info');
      flashHover(name);
    } else if (mode === 'quiz' || mode === 'test') {
      // Tapping a wrong (red) street retries it.
      if (streetEls[name] && streetEls[name].classList.contains('wrong')) {
        retryRedStreet(name);
        return;
      }
      if (!target) {
        showFeedback('Press "New" to start a question.', 'info');
        return;
      }
      // Clicking the map during quiz/test = "I don't know" — stays red for retry.
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
      setTimeout(() => { target = null; nextQuestion(); }, 1800);
    }
  }

  function retryRedStreet(name) {
    if (target && target !== name) {
      asked.delete(target);
      streetEls[target] && streetEls[target].classList.remove('target');
    }
    target = name;
    streetEls[name].classList.add('target');
    mapView.panToStreet(streetEls[name]);
    if (mode === 'quiz') {
      setupDropdown(name);
      dom.inputRow.style.display = 'flex';
      dom.dropdown.style.display = '';
      dom.textbox.style.display = 'none';
      showPrompt('Retry: Pick the name of this red street.');
    } else if (mode === 'test') {
      dom.inputRow.style.display = 'flex';
      dom.dropdown.style.display = 'none';
      dom.textbox.style.display = '';
      dom.textbox.value = '';
      dom.textbox.focus();
      showPrompt('Retry: Type the name of this red street.');
    }
    showFeedback('');
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
    target = pool[Math.floor(Math.random() * pool.length)];
    asked.add(target);
    if (mode === 'quiz') {
      setupDropdown(target);
      dom.inputRow.style.display = 'flex';
      dom.dropdown.style.display = '';
      dom.textbox.style.display = 'none';
      showPrompt('Pick the name of the highlighted street from the dropdown. Tapping the map = "I don\'t know".');
    } else if (mode === 'test') {
      dom.inputRow.style.display = 'flex';
      dom.dropdown.style.display = 'none';
      dom.textbox.style.display = '';
      dom.textbox.value = '';
      dom.textbox.focus();
      showPrompt('Type the name of the highlighted street. Tapping the map = "I don\'t know".');
    }
    streetEls[target].classList.add('target');
    if (useMissedPool) streetEls[target].classList.add('retry-highlight');
    mapView.panToStreet(streetEls[target]);
    showFeedback('');
  }

  function setupDropdown(answer) {
    const active = getActiveStreets();
    const distractors = active.filter(n => n !== answer);

    // Prioritize confusion-group siblings as distractors.
    let prioritized = [];
    const groups = [SISTER_STREETS, GEM_STREETS, LETTER_AVENUES];
    for (const grp of groups) {
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
    setTimeout(nextQuestion, 900);
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
    setTimeout(() => { target = null; nextQuestion(); }, 1800);
  }

  function revealCurrent() {
    if (!target) { showFeedback('No active question.', 'info'); return; }
    streetEls[target].classList.add('revealed');
    showFeedback(`Answer: ${target}`, 'info');
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
    if (!target) return;
    const answer = mode === 'quiz' ? dom.dropdown.value : dom.textbox.value.trim();
    if (!answer) return;
    if (norm(answer) === norm(target)) markCorrect(target);
    else markWrongCurrent(mode === 'quiz' ? answer : null);
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
    setTimeout(nextQuestion, 600);
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

  // --- Mode switching ---
  function setMode(newMode) {
    mode = newMode;
    clearAllMarksComplete();
    target = null;
    if (mode === 'explore') {
      dom.inputRow.style.display = 'none';
      showPrompt('Tap any street to see its name. Pinch or scroll to zoom. Drag to pan.');
      showFeedback('');
    } else {
      showPrompt('Press "New" to start.');
      dom.inputRow.style.display = 'flex';
      dom.dropdown.style.display = mode === 'quiz' ? '' : 'none';
      dom.textbox.style.display = mode === 'test' ? '' : 'none';
    }
  }

  function startNew() {
    if (mode === 'explore') {
      showPrompt('Tap any street. (Switch to Quiz or Test mode to be quizzed.)');
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
    setTimeout(nextQuestion, 600);
  }

  // --- Wire up DOM controls ---
  dom.modeTabs.forEach(t => {
    t.addEventListener('click', () => {
      dom.modeTabs.forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      setMode(t.dataset.mode);
    });
  });
  dom.newQ.addEventListener('click', startNew);
  dom.reveal.addEventListener('click', revealCurrent);
  dom.missed.addEventListener('click', retryMissed);
  dom.resetView.addEventListener('click', mapView.resetView);
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

  // --- Initial render ---
  updateScore();
  updateExclusionCount();
  showPrompt('Tap any street to see its name. Pinch or scroll to zoom. Drag to pan.');
}
