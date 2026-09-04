# Contributing

## Ground rules

- **Losslessness is the invariant.** Any change must keep the round-trip
  harness green: import → rebuild JSON from the .blend → deep-equal with the
  source. New node types must preserve unknown fields verbatim.
- `pascal_blender/core/` stays **bpy-free** (plain Python 3.9+, testable with
  `python3` directly). Blender-dependent code lives in `build/`, `operators/`, `ui/`.
- Follow the design doc (`docs/design/lossless-mapping.md`) for where data
  lives in the .blend; follow the specs in `docs/spec/` for editor geometry
  semantics — they were extracted from the editor source and are normative.

## Running tests

```sh
# pure python (fast)
python3 tests/test_openings.py
python3 tests/test_wallnet.py

# full suite in headless Blender (what CI runs)
<blender> --background --factory-startup --python tests/run_headless.py

# a single fixture
<blender> --background --factory-startup --python tests/run_headless.py -- tests/fixtures/demo_1.json
```

CI runs all of this on a real Blender 4.5 for every PR — a red run blocks merge.

## Adding support for a node type

1. Find or write its schema/geometry reference (see `docs/research/new-node-types.md`
   for the pattern — the editor repo is the ground truth).
2. Pure geometry math → `core/`; object/material creation → a builder in
   `build/` following the `build_x(ctx, node_id, node)` pattern in `flatwork.py`.
3. Register in `core/schema.py` (`KNOWN_NODE_TYPES`) and `build/importer.py`.
4. Add a fixture in `tests/fixtures/` exercising it; the harness picks it up
   automatically and will enforce losslessness on it.

## Releases (maintainers)

Bump `version` in `pascal_blender/blender_manifest.toml`, tag `vX.Y.Z`, push
the tag. CI builds the zip with Blender itself, attaches it to a GitHub
Release, and republishes the extension repository on GitHub Pages.
