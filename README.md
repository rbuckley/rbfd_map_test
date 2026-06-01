# RBFD Map Test

**Live site:** https://rbuckley.github.io/rbfd_map_test/

Interactive street-map quiz for learning fire department districts. Tap streets
to explore, then test yourself in **Quiz** (multiple choice) or **Test** (type
the name) mode. Scores, missed-street history, and exclusions persist locally.

## Project structure

```
index.html              App shell (header, map container, controls)
css/styles.css          Styles
js/
  app.js                Bootstrap: load district, inject SVG, wire everything
  districts.js          Registry of available districts + loader
  map.js                Pan/zoom (mouse + touch), encapsulated viewBox
  quiz.js               Explore/Quiz/Test logic, scoring, exclusions
  storage.js            localStorage persistence (graceful in-memory fallback)
data/
  d1/
    map.svg             The District 1 vector map
    streets.json        Street names, default exclusions, confusion groups
manifest.webmanifest    PWA manifest (installable)
sw.js                   Service worker (offline caching)
icon.svg                App icon
```

The quiz engine is **map-agnostic** — all map-specific data lives in
`data/<id>/`. See "Adding a district" below.

## Running locally

The app loads `map.svg` and `streets.json` via `fetch` and uses ES modules, so
it must be served over HTTP (not opened as a `file://` URL):

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

## Deploying (GitHub Pages)

This is a static site — no build step. Enable GitHub Pages for the repo
(Settings → Pages → Deploy from branch), pointing at the branch root. The PWA
manifest + service worker make it installable and usable offline on phones.

## Adding a district

1. Create `data/<id>/map.svg`. Each street is a `<g class="street"
   data-name="...">` containing a wide invisible `.hit` path (for easy tapping)
   and a visible `.vis` path.
2. Create `data/<id>/streets.json` with `streets`, `excluded`, and
   `confusionGroups` (used to pick plausible multiple-choice distractors).
3. Add an entry to `DISTRICTS` in `js/districts.js`.

No engine changes are required.

## Legacy

`D1_Interactive_rotated.html` is the original single-file prototype this app was
refactored from, kept for reference.
