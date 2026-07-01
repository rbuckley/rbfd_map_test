# Tests

Node + jsdom tests for the quiz app. No browser or build step.

```sh
npm install   # one-time: pulls jsdom (dev only)
npm test      # runs every test/*.test.mjs
npm test rename   # runs only files whose name matches "rename"
```

Each `*.test.mjs` runs in its own process (see `run.mjs`) so the app's one-time
bootstrap (`js/app.js` → `main()`) starts fresh per file and module state never
leaks between tests.

- `harness.mjs` — shared setup. `jsdomEnv()` for pure-logic tests;
  `bootApp({districts, selected, renames, rotations, progress})` boots the real
  app against `index.html` with `fetch` stubbed to read repo files and a seeded
  `localStorage`, returning `$`/`$$`/`ls` helpers. Plus `ok()`/`done()`
  assertions and interaction helpers (`click`, `change`, `tapAt`, …).

## Coverage

| File | What it covers |
|------|----------------|
| `renames.test.mjs` | override transforms, block merge, svg group merge, bake, merge↔unmerge round-trip |
| `storage.test.mjs` | progress, user districts, renames/rotations stores, backup bundle (wrapped + legacy) |
| `map.test.mjs` | initial rotation, `rotate()`, letterbox-correct `clientToContent` |
| `build.test.mjs` | `addressesToBlockIndex`, `buildDistrictRecord`, `exportDistrictFiles` split |
| `quiz-modes.test.mjs` | Explore / Test (random+click, dropdown+type) / Reveal |
| `rename.test.mjs` | inline + bulk rename, merge-on-clash, decline, progress isolation |
| `merge-unmerge.test.mjs` | list checkbox-merge, unmerge, split-off, map two-tap merge/unmerge |
| `rotation.test.mjs` | config vs override precedence, auto-persist, clear at 0° |
| `exam.test.mjs` | certification exam: gating, lockdown, no-feedback, scoring, pass boundary, end-early, isolation |
| `blocks.test.mjs` | Blocks Locate (hit/miss) + Identify (same-street choices) |
| `export-import.test.mjs` | Export-all backs up built-in edits; empty-state message |
| `smoke.test.mjs` | boots the real shipped D1 (`data/d1/*`), rotation persists, no errors |
