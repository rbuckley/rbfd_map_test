// Registry of available districts. Add a new entry here (plus a folder under
// data/<id>/ with a map.svg and streets.json) to support another district —
// the quiz engine itself never needs to change.
export const DISTRICTS = [
  {
    id: 'd1',
    name: 'District 1',
    config: 'data/d1/streets.json',
  },
];

// The district shown on first load (or when no saved preference exists).
export const DEFAULT_DISTRICT = 'd1';

// Fetch a district's config JSON and its SVG map. Returns the parsed config
// with the raw SVG markup attached as `svgMarkup`.
export async function loadDistrict(id) {
  const entry = DISTRICTS.find(d => d.id === id);
  if (!entry) throw new Error(`Unknown district: ${id}`);

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
