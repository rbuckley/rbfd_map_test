// Persistence layer: scores, missed-street history, and user exclusions are
// stored in localStorage, keyed per district so progress on one map doesn't
// clobber another. All access is wrapped so a disabled/full localStorage
// degrades gracefully to an in-memory session instead of throwing.

const KEY_PREFIX = 'rbfd-map-test:';

function keyFor(districtId) {
  return `${KEY_PREFIX}${districtId}`;
}

const DEFAULT_STATE = () => ({
  correct: 0,
  total: 0,
  missed: [],        // names answered wrong / skipped, persisted across reloads
  userExcluded: [],  // streets the user chose to exclude
});

// In-memory fallback used when localStorage is unavailable.
const memory = {};

function available() {
  try {
    const t = `${KEY_PREFIX}__test`;
    localStorage.setItem(t, '1');
    localStorage.removeItem(t);
    return true;
  } catch {
    return false;
  }
}

const useLocal = available();

export function loadProgress(districtId) {
  const fallback = DEFAULT_STATE();
  try {
    const raw = useLocal
      ? localStorage.getItem(keyFor(districtId))
      : memory[districtId];
    if (!raw) return fallback;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

export function saveProgress(districtId, state) {
  const payload = {
    correct: state.correct,
    total: state.total,
    missed: Array.from(state.missed),
    userExcluded: Array.from(state.userExcluded),
  };
  try {
    if (useLocal) {
      localStorage.setItem(keyFor(districtId), JSON.stringify(payload));
    } else {
      memory[districtId] = payload;
    }
  } catch {
    // Out of quota or blocked — keep going with whatever is in memory.
    memory[districtId] = payload;
  }
}

export function clearProgress(districtId) {
  try {
    if (useLocal) localStorage.removeItem(keyFor(districtId));
  } catch { /* ignore */ }
  delete memory[districtId];
}
