// Registry of built-in districts. Add a new entry here (plus a folder under
// data/<id>/ with a map.svg and streets.json) to ship a district with the app —
// the quiz engine itself never needs to change. User-created districts live in
// localStorage (see js/storage.js) and are merged in at runtime.
import { loadUserDistricts, getUserDistrict } from './storage.js';

export const DISTRICTS = [
  {
    id: 'd1',
    name: 'District 1',
    config: 'data/d1/streets.json',
  },
  {
    id: 'd2',
    name: 'District 2',
    config: 'data/d2/streets.json',
  },
];

// The district shown on first load (or when no saved preference exists).
export const DEFAULT_DISTRICT = 'd1';

// All selectable districts (built-in + user-created), for the header picker.
export function listDistricts() {
  const builtin = DISTRICTS.map(d => ({ id: d.id, name: d.name, source: 'builtin' }));
  const user = Object.values(loadUserDistricts()).map(d => ({ id: d.id, name: d.name, source: 'user' }));
  return [...builtin, ...user];
}

// Load a district by id. Built-ins are fetched from data/<id>/; user districts
// are read whole from localStorage. Returns the config with the raw SVG markup
// attached as `svgMarkup`.
export async function loadDistrict(id) {
  const entry = DISTRICTS.find(d => d.id === id);
  if (entry) {
    const config = await fetch(entry.config).then(r => {
      if (!r.ok) throw new Error(`Failed to load ${entry.config}: ${r.status}`);
      return r.json();
    });
    const svgMarkup = await fetch(config.map).then(r => {
      if (!r.ok) throw new Error(`Failed to load ${config.map}: ${r.status}`);
      return r.text();
    });
    return { ...config, svgMarkup };
  }

  const user = getUserDistrict(id);
  if (user) return { ...user };

  throw new Error(`Unknown district: ${id}`);
}
