# Overnight build summary — 2026-08-02

Goal (your words): *"export from Pascal editor into Blender format. Blender
project very clean, no information loss."* Kimi explicitly out of scope.

## What exists now

A working, tested, installable **Blender 4.5 extension** at
`~/Documents/GitHub/pascal-blender`:

- `dist/pascal_blender-0.1.0.zip` — install via Preferences → Get Extensions
  → Install from Disk. Verified headless: installs, enables, imports
  demo_1.json (64 anchored nodes), uninstalls cleanly.
- `File → Import → Pascal Scene (.json)` + drag-drop into the viewport.

## Proven properties (all automated, all green)

1. **Losslessness** — for 7 fixtures (incl. the editor's real demo_1.json and
   a hostile forward-compat fixture with unknown node types, unicode, 2^33
   ints, orphans): import → rebuild JSON from the .blend's custom properties
   alone → **deep-equals the source file**, before AND after .blend
   save/reload. Run: `Blender --background --factory-startup --python tests/run_headless.py`
2. **Geometry** — wall volumes exact with live boolean door/window cutouts
   (move a door → hole follows); demo slab outset volume 1.2505 exact; level
   stacking at the editor's 2.55 (not 2.5); mitered wall corners matching the
   editor's junction algorithm (demo L-corner miter points verified to 1e-9);
   all 7 roof types manifold with editor slope math (ridge = WH+RH+(DT+ST)/cosθ);
   parametric doors/windows to spec constants at 1e-6.
3. **Materials** — the 10 presets → Principled BSDF with exact socket values,
   override precedence, dedup, glass alpha-blend, texture-field option.
4. **Robustness** — malformed JSON cancels with zero partial datablocks;
   walls missing required fields degrade to data-layer anchors + report;
   unknown node types preserved in "Pascal Unhandled".

## Where things are

| | |
|---|---|
| Design doc (field-disposition tables, audited) | `docs/design/lossless-mapping.md` |
| Reimplementation specs extracted from the editor | `docs/spec/01…07` |
| How to test everything locally | `TESTING.md` |
| Sample render of the imported demo scene | `docs/demo1-import-render.png` |
| Getting JSON out of the editor today | README "Getting the JSON" (console snippet; a tiny PR to pascalorg/editor can add a proper button) |

## Honest gaps (also in README roadmap)

- Roof geometry is a **solid envelope** matching the editor's silhouette and
  slot scheme — not the hollow 6-shell CSG sandwich (spec 03 has the full
  formulas + numeric vectors when you want exactness; params are lossless
  either way).
- Exporter (.blend → Pascal JSON after edits) designed (§7 of the design)
  but not implemented; the no-edit round-trip is already proven by the harness.
- `asset://` blobs (browser IndexedDB) are unrecoverable → labeled placeholders.
- Furniture GLB downloads default to editor.pascal.app; offline = wire boxes.

## Suggested next steps

1. Open the zip in Blender yourself and drag `tests/fixtures/demo_1.json` in.
2. Export a real scene from editor.pascal.app (console snippet) and import it —
   any new node shapes will land in the report/Unhandled rather than crashing.
3. Decide: PR to pascalorg/editor adding "Download scene (.pascal.json)".
4. M7 exporter if you want full round-trip editing.
