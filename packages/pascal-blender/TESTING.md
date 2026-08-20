# Testing pascal-blender

Blender binary assumed at `/Applications/Blender.app/Contents/MacOS/Blender`
(4.5 LTS). All commands run from the repo root.

## 1. Pure-python tests (no Blender)

```sh
python3 tests/test_openings.py   # parametric door/window geometry vs spec constants
python3 tests/test_wallnet.py    # wall footprint mitering incl. demo_1 L-corner
```

## 2. Full headless suite (the losslessness proof)

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
    --python tests/run_headless.py
```

For every fixture in `tests/fixtures/` this: imports the scene, asserts every
node got an anchor datablock, verifies the Text-block copy + sha256, rebuilds
`{nodes, rootNodeIds}` from custom properties alone and asserts it
**deep-equals the source file**, then saves + reopens a `.blend` and asserts
everything again. Exit code 0 = all green.

Run a single fixture:

```sh
... --python tests/run_headless.py -- tests/fixtures/demo_1.json
```

## 3. Fixtures

| Fixture | Exercises |
|---|---|
| `demo_1.json` | real scene from the editor repo: 65 nodes, 2 levels, 6 walls, legacy roofs (migration), 50 items, 7 orphans, parentId/children disagreement |
| `openings.json` | parametric door (glass/panel/empty segments, panic bar) + windows on mitered walls, boolean cutouts |
| `roofs_all.json` | one roof-segment of each of the 7 roofTypes |
| `materials_all.json` | all 9 presets + property override + custom + texture field, dedup |
| `flatwork.json` | site node, ceiling with hole, negative slab elevation, guide (asset:// URL), zone |
| `forward_compat.json` | unknown node type, unknown fields with unicode/huge/tiny numbers, orphan, null parentId |
| `empty.json` | `{nodes:{}, rootNodeIds:[]}` |

## 4. Manual smoke test in the UI

1. Build + install the extension (see README).
2. `File → Import → Pascal Scene (.json)` → `tests/fixtures/demo_1.json`
   (turn **off** "Download assets" if offline — furniture becomes wire boxes).
3. Check the outliner: `Pascal: demo_1.json → Building … → Level 0/1 …`,
   plus `Cameras`, `Pascal Orphans` (excluded), `Zones` (excluded).
4. Select a wall → sidebar (N) → **Pascal** tab shows type/id/params and the
   import report.
5. Move a door along its wall → the opening follows live.
6. Text Editor → `pascal_source.json` = the original file.

## 5. Extension packaging check

```sh
/Applications/Blender.app/Contents/MacOS/Blender --command extension validate pascal_blender
/Applications/Blender.app/Contents/MacOS/Blender --command extension build \
    --source-dir pascal_blender --output-dir dist
```
