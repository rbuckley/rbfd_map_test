// Street-name overrides: a non-destructive layer applied on top of a district
// record (built-in or user) at load time. The override is a map of
// { originalName: displayName }; a *merge* is simply two original names mapping
// to the same display name, so unioning falls out for free. See js/storage.js
// for where the map is persisted, and js/app.js for where it's applied.

const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);

// Collapse block entries that share a block number (happens when two streets
// merge): sum counts, count-weight the centroid.
export function mergeBlockEntries(arr) {
  const byBlock = new Map();
  for (const e of arr) {
    const c = e.count || 1;
    const cur = byBlock.get(e.block);
    if (!cur) byBlock.set(e.block, { block: e.block, sx: e.x * c, sy: e.y * c, count: c });
    else { cur.sx += e.x * c; cur.sy += e.y * c; cur.count += c; }
  }
  return [...byBlock.values()].sort((a, b) => a.block - b.block).map(b => ({
    block: b.block,
    x: Math.round(b.sx / b.count * 10) / 10,
    y: Math.round(b.sy / b.count * 10) / 10,
    count: b.count,
  }));
}

// Apply renames to the data fields of a record (streets, blocks, confusion
// groups, exclusions). Returns a shallow clone; the original is untouched.
export function applyRenamesToRecord(record, renames) {
  if (!renames || !Object.keys(renames).length) return record;
  const map = name => (has(renames, name) ? renames[name] : name);

  const streets = [...new Set((record.streets || []).map(map))];

  const blocks = {};
  for (const [s, arr] of Object.entries(record.blocks || {})) {
    const n = map(s);
    blocks[n] = (blocks[n] || []).concat(arr);
  }
  for (const n of Object.keys(blocks)) blocks[n] = mergeBlockEntries(blocks[n]);

  const confusionGroups = {};
  for (const [g, arr] of Object.entries(record.confusionGroups || {})) {
    confusionGroups[g] = [...new Set((arr || []).map(map))];
  }

  const excluded = [...new Set((record.excluded || []).map(map))];

  return { ...record, streets, blocks, confusionGroups, excluded };
}

// Patch the injected SVG to match: rename each `.street` group's data-name,
// then merge groups that now share a name (move their paths into the first).
export function applyRenamesToSvg(svgEl, renames) {
  const seen = new Map();   // display name -> first group kept
  svgEl.querySelectorAll('.street').forEach(g => {
    const old = g.getAttribute('data-name');
    const name = (renames && has(renames, old)) ? renames[old] : old;
    if (name !== old) g.setAttribute('data-name', name);
    const first = seen.get(name);
    if (first) {
      while (g.firstChild) first.appendChild(g.firstChild);
      if (g.parentNode) g.parentNode.removeChild(g);
    } else {
      seen.set(name, g);
    }
  });
}

// displayName -> originalName, for resolving which shipped name a user edits.
export function reverseDisplayToOriginal(originalStreets, renames) {
  const out = {};
  for (const orig of originalStreets || []) {
    out[(renames && has(renames, orig)) ? renames[orig] : orig] = orig;
  }
  return out;
}

// A full record with renames baked into both the data and the svgMarkup string,
// ready for exportDistrictFiles (so a correction can be committed to data/).
export function bakeRenamedRecord(original, renames) {
  const record = applyRenamesToRecord(original, renames);
  let svgMarkup = original.svgMarkup;
  if (renames && Object.keys(renames).length && svgMarkup && typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
    const svgEl = doc.documentElement;
    applyRenamesToSvg(svgEl, renames);
    svgMarkup = (typeof XMLSerializer !== 'undefined')
      ? new XMLSerializer().serializeToString(svgEl)
      : svgEl.outerHTML;
  }
  return { ...record, svgMarkup };
}
