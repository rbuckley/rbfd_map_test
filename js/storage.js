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

// --- Generic keyed JSON (used for the district store + selected district) ---
function readKey(key, fallback) {
  try {
    const raw = useLocal ? localStorage.getItem(key) : memory[key];
    if (raw == null) return fallback;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return fallback;
  }
}
function writeKey(key, value) {
  try {
    if (useLocal) localStorage.setItem(key, JSON.stringify(value));
    else memory[key] = value;
  } catch {
    memory[key] = value;
  }
}

const DISTRICTS_KEY = `${KEY_PREFIX}districts`;
const SELECTED_KEY = `${KEY_PREFIX}selectedDistrict`;
const RENAMES_KEY = `${KEY_PREFIX}renames`;

// Per-district street-name overrides: { districtId: { originalName: newName } }.
// A non-destructive layer applied at load (see js/renames.js), kept separate
// from progress so resetting a score never drops corrections. Works for both
// built-in and user districts.
export function loadRenames(districtId) {
  const all = readKey(RENAMES_KEY, {});
  return all[districtId] || {};
}
export function saveRenames(districtId, map) {
  const all = readKey(RENAMES_KEY, {});
  if (map && Object.keys(map).length) all[districtId] = map;
  else delete all[districtId];
  writeKey(RENAMES_KEY, all);
}

// User-created districts: a map keyed by id. Each value is a full district
// record { id, name, viewBox, streets, excluded, confusionGroups, svgMarkup,
// refImage? } so it can be rendered without any network fetch.
export function loadUserDistricts() {
  return readKey(DISTRICTS_KEY, {});
}
export function getUserDistrict(id) {
  return loadUserDistricts()[id] || null;
}
export function saveUserDistrict(record) {
  const all = loadUserDistricts();
  all[record.id] = record;
  writeKey(DISTRICTS_KEY, all);
}
export function deleteUserDistrict(id) {
  const all = loadUserDistricts();
  delete all[id];
  writeKey(DISTRICTS_KEY, all);
  clearProgress(id);
}

export function loadSelectedDistrict() {
  return readKey(SELECTED_KEY, null);
}
export function saveSelectedDistrict(id) {
  writeKey(SELECTED_KEY, id);
}

// All user-created districts serialized as one JSON string (for a backup /
// hand-off file that can be re-imported or committed to the repo).
export function exportDistrictsBundle() {
  return JSON.stringify(loadUserDistricts(), null, 2);
}

// Merge a bundle (map of id -> district record) back into the store.
export function importDistrictsBundle(bundle) {
  const all = loadUserDistricts();
  let n = 0;
  for (const [id, rec] of Object.entries(bundle || {})) {
    if (rec && rec.id) { all[id] = rec; n++; }
  }
  writeKey(DISTRICTS_KEY, all);
  return n;
}
