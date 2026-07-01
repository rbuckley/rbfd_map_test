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
// Every district's overrides, for backup. { districtId: { orig: new } }.
export function loadAllRenames() {
  return readKey(RENAMES_KEY, {});
}

const ROTATIONS_KEY = `${KEY_PREFIX}rotations`;

// Per-district map orientation override (0/90/180/270), applied at load over
// the value shipped in the config. Kept like renames: non-destructive, backed
// up, and bakeable into the shipped map.
export function loadRotation(districtId) {
  const all = readKey(ROTATIONS_KEY, {});
  return all[districtId];   // undefined when unset -> caller falls back to config
}
export function saveRotation(districtId, angle) {
  const all = readKey(ROTATIONS_KEY, {});
  if (angle) all[districtId] = angle;
  else delete all[districtId];   // 0 is the default; don't store it
  writeKey(ROTATIONS_KEY, all);
}
export function loadAllRotations() {
  return readKey(ROTATIONS_KEY, {});
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

// A full local backup: user-created districts AND street-name overrides (the
// latter so corrections to built-in maps aren't lost on an "Export all").
export function exportDistrictsBundle() {
  return JSON.stringify({ districts: loadUserDistricts(), renames: loadAllRenames(), rotations: loadAllRotations() }, null, 2);
}

// Merge a backup into the store. Accepts the current wrapped shape
// { districts, renames } and the legacy flat map of id -> record.
// Returns { districts, renames, firstId } (counts + first imported district id).
export function importDistrictsBundle(bundle) {
  bundle = bundle || {};
  const wrapped = bundle.districts && typeof bundle.districts === 'object' && !bundle.districts.id;
  const districts = wrapped ? bundle.districts : bundle;
  const renames = (wrapped && bundle.renames && typeof bundle.renames === 'object') ? bundle.renames : null;
  const rotations = (wrapped && bundle.rotations && typeof bundle.rotations === 'object') ? bundle.rotations : null;

  const all = loadUserDistricts();
  let d = 0, firstId = null;
  for (const [id, rec] of Object.entries(districts)) {
    if (rec && rec.id) { all[id] = rec; if (!firstId) firstId = id; d++; }
  }
  writeKey(DISTRICTS_KEY, all);

  let r = 0;
  if (renames) {
    const allR = readKey(RENAMES_KEY, {});
    for (const [id, map] of Object.entries(renames)) {
      if (map && typeof map === 'object' && Object.keys(map).length) { allR[id] = map; r++; }
    }
    writeKey(RENAMES_KEY, allR);
  }
  if (rotations) {
    const allT = readKey(ROTATIONS_KEY, {});
    for (const [id, angle] of Object.entries(rotations)) {
      if (angle) allT[id] = angle;
    }
    writeKey(ROTATIONS_KEY, allT);
  }
  return { districts: d, renames: r, firstId };
}
