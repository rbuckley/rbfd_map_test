// Shared test harness. Two modes:
//   jsdomEnv()  — a minimal window for pure DOM helpers (DOMParser/XMLSerializer).
//   bootApp()   — boots the real app (js/app.js) against index.html with a
//                 stubbed fetch (reads files from the repo) and a seeded
//                 localStorage, returning query helpers.
//
// Each *.test.mjs file is run in its own process by run.mjs, so app.js's
// one-time main() executes fresh per file and module state never leaks.
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, resolve } from 'path';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const K = 'rbfd-map-test:';

// --- assertions ---
let total = 0, fails = 0;
export function ok(cond, msg) {
  total++;
  if (cond) console.log('  ✓ ' + msg);
  else { fails++; console.log('  ✗ ' + msg); }
}
export function section(name) { console.log(name); }
export function done() {
  console.log(fails ? `\n${fails}/${total} assertions FAILED` : `\n${total} assertions passed`);
  process.exit(fails ? 1 : 0);
}

// --- pure DOM env (no app) ---
export function jsdomEnv() {
  const { window } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.DOMParser = window.DOMParser;
  globalThis.XMLSerializer = window.XMLSerializer;
  window.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 });
  return window;
}

// --- boot the real app ---
export async function bootApp(opts = {}) {
  const dom = new JSDOM(readFileSync(resolve(ROOT, 'index.html'), 'utf8'), { url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  Object.assign(globalThis, {
    window, document: window.document, HTMLElement: window.HTMLElement,
    MouseEvent: window.MouseEvent, Event: window.Event, localStorage: window.localStorage,
    DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer, Blob: window.Blob,
  });
  Object.defineProperty(globalThis, 'location', { value: window.location, configurable: true });
  // app.js registers a service worker at import via `'serviceWorker' in navigator`.
  // Node <21 has no global navigator; give it jsdom's (which lacks serviceWorker,
  // so registration is correctly skipped). Node 21+ already has one — leave it.
  try { Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true }); } catch { /* already provided */ }
  window.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 });

  const state = { alerts: [], errors: [] };
  window.alert = m => state.alerts.push(String(m));
  window.confirm = () => (opts.confirm === undefined ? true : opts.confirm);
  window.prompt = (m, def) => (opts.prompt === undefined ? def : opts.prompt);
  window.addEventListener('error', e => state.errors.push(e.error || e.message));
  globalThis.URL.createObjectURL = () => { state.downloads = (state.downloads || 0) + 1; return 'blob:x'; };
  globalThis.URL.revokeObjectURL = () => {};
  globalThis.fetch = async u => {
    const p = resolve(ROOT, String(u).replace(/^\.?\//, ''));
    const b = readFileSync(p, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(b), text: async () => b };
  };

  if (opts.districts) localStorage.setItem(K + 'districts', JSON.stringify(opts.districts));
  if (opts.selected) localStorage.setItem(K + 'selectedDistrict', JSON.stringify(opts.selected));
  if (opts.renames) localStorage.setItem(K + 'renames', JSON.stringify(opts.renames));
  if (opts.rotations) localStorage.setItem(K + 'rotations', JSON.stringify(opts.rotations));
  for (const [id, st] of Object.entries(opts.progress || {})) localStorage.setItem(K + id, JSON.stringify(st));

  await import(pathToFileURL(resolve(ROOT, 'js/app.js')).href);
  await wait(opts.wait || 200);

  const d = window.document;
  return {
    window, d, state,
    $: s => d.querySelector(s),
    $$: s => [...d.querySelectorAll(s)],
    ls: key => JSON.parse(localStorage.getItem(K + key) || 'null'),
  };
}

// --- interaction helpers ---
export const wait = ms => new Promise(r => setTimeout(r, ms));
export const click = el => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
export const tapAt = (el, clientX, clientY) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true, clientX, clientY }));
export const change = (el, v) => { el.value = v; el.dispatchEvent(new el.ownerDocument.defaultView.Event('change')); };
export const input = (el, v) => { el.value = v; el.dispatchEvent(new el.ownerDocument.defaultView.Event('input')); };

// --- fixtures ---
export const seg = (n, i) => `<g class="street" data-name="${n}"><path class="hit" d="M${i * 5},5L${i * 5 + 40},5"/><path class="vis" d="M${i * 5},5L${i * 5 + 40},5"/></g>`;
export const svgMarkup = (streets, vb = '0 0 400 50', extra = '') =>
  `<svg id="map" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg"><rect width="400" height="50"/>${extra}${streets.map((n, i) => seg(n, i)).join('')}</svg>`;
// A ready-made user district record.
export const district = (over = {}) => {
  const streets = over.streets || ['Alpha St', 'Bravo Ave', 'Carter Rd'];
  return {
    id: 'u1', name: 'Testville', viewBox: '0 0 400 50',
    streets, excluded: [], confusionGroups: {}, blocks: {},
    svgMarkup: svgMarkup(streets, over.viewBox || '0 0 400 50'),
    ...over,
  };
};
