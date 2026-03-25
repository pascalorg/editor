# Okiyuka Integration

This document describes the current proof-of-concept path for loading Okiyuka output into Pascal Editor.

## Purpose

Use Okiyuka as the layout calculation tool and Pascal Editor as the local visualization and inspection UI.

## Current Integration Path

1. Export Okiyuka JSON from the desktop app
2. Convert that JSON into a Pascal scene graph JSON
3. Open Pascal Editor locally
4. Load the converted scene with `Settings -> Load Build`

## Current Working Files

- Okiyuka converter: `C:\Okiyuka_V1.0\tools\okiyuka_to_pascal_scene.py`
- Okiyuka workflow memo: `C:\Okiyuka_V1.0\docs\pascal_editor_local_setup.md`
- Tracked validation fixtures: `C:\dev\pascal-editor\fixtures\okiyuka\normal_plan2\`

## Pascal Editor Local URL

Current local development URL:

- `http://127.0.0.1:3002`

The development server is intentionally bound to localhost only.

## Expected Scene JSON Shape

Pascal Editor can load a local JSON file with this shape:

```json
{
  "nodes": {},
  "rootNodeIds": []
}
```

The existing UI import path already supports this format.

## Okiyuka Conversion Command

```powershell
Set-Location -LiteralPath C:\Okiyuka_V1.0
c:/Okiyuka_V1.0/.venv/Scripts/python.exe tools/okiyuka_to_pascal_scene.py \
  --input artifacts/okiyuka_layout.json \
  --output artifacts/pascal_scene.json
```

## Current Mapping

- Okiyuka room polygon -> Pascal zone
- Okiyuka room boundary edges -> Pascal wall
- all rooms -> one site / one building / one level
- Okiyuka summary and offcut pool -> node metadata
- Okiyuka pedestals -> level metadata plus per-zone pedestal summaries
- all rooms' panels -> Pascal item nodes with proxy item assets
- stable input-derived IDs -> site, building, level, wall, zone, and imported item nodes

## Current Load Procedure

1. Start Pascal Editor locally
2. Open `Settings`
3. Click `Load Build`
4. Select `pascal_scene.json`

## What This PoC Is Good For

- checking room geometry in the Pascal viewer
- confirming the coordinate conversion path
- preserving pedestal counts and height distributions for later promotion
- validating a future richer bridge for panels, pedestals, and rails

## Real Data Validation (2026-03-25)

An end-to-end validation was completed with a real Okiyuka export generated from `normal_plan2.dxf`.

- Okiyuka export file: `C:\dev\pascal-editor\fixtures\okiyuka\normal_plan2\okiyuka_export.json`
- Source drawing recorded in export: `normal_plan2.dxf`
- Converted Pascal scene file: `C:\dev\pascal-editor\fixtures\okiyuka\normal_plan2\pascal_scene.json`
- Conversion result: success
- Generated scene size: 127 nodes, 1 root node
- Imported panel item count: 72 across 6 rooms
- Pascal load result: success through `Settings -> Load Build`

Observed result in Pascal Editor:

- six rooms were visible after loading
- room names `_0-2_ROOM_OUTLINE-1` through `_0-2_ROOM_OUTLINE-6` appeared in the scene
- the current bridge was sufficient for real room polygon import without adding any new Pascal-side importer code

## Fixture Reproduction

Use the tracked fixture pair for a quick local repro without re-exporting from Okiyuka UI.

1. Start Pascal Editor locally on `http://127.0.0.1:3002`
2. Open `Settings`
3. Click `Load Build`
4. Select `C:\dev\pascal-editor\fixtures\okiyuka\normal_plan2\pascal_scene.json`

If you want to regenerate the Pascal scene from the saved Okiyuka export fixture:

```powershell
Set-Location -LiteralPath C:\Okiyuka_V1.0
c:/Okiyuka_V1.0/.venv/Scripts/python.exe tools/okiyuka_to_pascal_scene.py \
  --input C:/dev/pascal-editor/fixtures/okiyuka/normal_plan2/okiyuka_export.json \
  --output C:/dev/pascal-editor/fixtures/okiyuka/normal_plan2/pascal_scene.json
```

## Current Limitations

- all rooms with panel geometry now map panels into Pascal item nodes
- imported panel items currently use a proxy asset and metadata-rich box approximation
- imported panel items can now be resized from the existing item panel using width / thickness / depth sliders
- pedestals are preserved as metadata only and do not render as explicit scene elements
- edge rails are not yet mapped
- wall thickness and height are placeholder visualization values
- shared room edges are deduplicated only by exact segment match

## Richer Mapping Plan

The next phase should expand the bridge in stages instead of trying to map every Okiyuka concept at once.

### Phase 1: Pedestal Metadata Preservation

Status:

- implemented in the current converter

Goal:

- preserve pedestal data in a way that survives Pascal import immediately
- avoid blocking on a new Pascal node type before the data is usable

Approach:

- keep room and wall mapping as-is
- copy `geometry.pedestals` into level metadata keyed by room
- add per-zone pedestal count and height distribution summaries
- verify that pedestal count and height distribution remain inspectable after `Load Build`

Why first:

- pedestal records already exist in the real validation fixture
- this adds value without requiring renderer or schema changes in Pascal

Current result:

- level metadata now carries `pedestal_count`, `pedestal_room_count`, `pedestal_height_distribution_mm`, and `pedestals_by_room`
- each zone metadata now carries `pedestal_count` and `pedestal_height_distribution_mm`
- regenerated fixture import continues to load successfully in Pascal Editor

### Phase 2: Panel Mapping Strategy

Status:

- expanded across all rooms from the real fixture

Goal:

- make Okiyuka panel layout visible as explicit scene elements instead of only room metadata

Preferred direction:

- map Okiyuka panels to Pascal item-like nodes only after confirming the correct existing node type and renderer path in the current checkout
- preserve panel label, source label, type, and polygon coordinates

Current prototype result:

- the converter maps panels from every room in the real fixture to level child `item` nodes
- each imported panel item carries source coordinates, panel type, dimensions, and rotation in metadata
- each imported panel item uses a proxy asset so the current viewer can render it without adding a new renderer
- imported panel items can be edited in meters through the existing Pascal item property panel, which updates effective dimensions via item scale
- the real fixture now imports 72 panel items across 6 rooms that expose Okiyuka panel geometry

Open design questions:

- whether panels should map to an existing item node type or a new dedicated node type
- whether panel geometry should render as flat polygons, boxes, or overlay-only helpers
- whether rejected panels should be imported or filtered out at conversion time

Acceptance target:

- rooms from the real fixture show individual panel elements in Pascal Editor
- full, cut, reused, and rejected panels remain distinguishable in metadata or appearance

### Phase 3: Edge Rail Mapping

Goal:

- carry Okiyuka edge rail geometry into Pascal for perimeter inspection

Approach options:

- if Pascal already has a compatible linear node type, map rails there
- otherwise store rails in metadata first and only promote them to dedicated nodes when rendering needs are clear

Required data from Okiyuka:

- start point
- end point
- length_mm

Acceptance target:

- rails from exports with non-empty `geometry.edge_rails` can be inspected in Pascal without losing source measurements

### Phase 4: Schema and Viewer Promotion

This phase should only start after metadata-first validation shows stable demand for richer rendering.

Potential work:

- add or confirm Pascal node schemas for imported panel-like and rail-like elements
- add renderer support in the correct package without violating viewer isolation
- keep conversion logic aligned with current core schema contracts instead of inventing ad-hoc shapes in the editor layer

### Recommended Order

1. pedestal metadata preservation
2. panel element prototype across the real fixture
3. edge rail import path
4. schema and renderer promotion only where the prototype proves useful

## Stable ID Strategy

The converter now derives IDs from input content instead of generating random IDs.

Current scope:

- site, building, and level IDs are derived from source scene identity
- zone IDs are derived from room identity and polygon shape
- wall IDs are derived from normalized segment coordinates
- panel item IDs are derived from room identity, panel index, panel type, and panel coordinates

Why this changed:

- fixture regeneration should produce the same scene JSON for the same Okiyuka export
- git diffs become smaller and easier to review after the first stable-ID migration
- follow-up work on panel and rail promotion can rely on consistent imported node IDs

### Non-Goals For The Next Step

- rebuilding Okiyuka export schema
- adding a new Pascal-side importer UI
- mixing auth or database restoration work into the geometry bridge

## Progress Snapshot (2026-03-25)

- Pascal Editor was cloned into `C:\dev\pascal-editor` and brought up for local development with Bun.
- The editor dev server is configured to run on `http://127.0.0.1:3002` so local inspection stays bound to localhost.
- The current scene import seam was confirmed: `Settings -> Load Build` accepts a JSON scene graph with `nodes` and `rootNodeIds`.
- A minimal bridge now exists on the Okiyuka side at `C:\Okiyuka_V1.0\tools\okiyuka_to_pascal_scene.py`.
- The bridge currently converts room polygons into Pascal zones and room perimeter segments into Pascal walls under one site, one building, and one level.
- Phase 1 pedestal preservation is now in place: the converter stores full pedestal records in level metadata and room-level summaries in zone metadata.
- Phase 2 panel prototyping is now in place across the real fixture: 72 panel items are imported as level child item nodes using a proxy asset for all 6 rooms that carry panel geometry.
- Imported Okiyuka panel items now expose width, thickness, and depth sliders in the existing Pascal item panel, providing a minimal editable-dimension path without introducing a dedicated panel node type.
- Converter output IDs are now deterministic for identical inputs, which keeps fixture regeneration stable.
- Synthetic import validation succeeded in Pascal Editor, confirming that the current conversion shape can be loaded by the existing UI.
- Local setup and architecture notes in this repository were updated to reflect the current checkout instead of the older auth / db / Supabase-oriented documentation.
- Repository drift was verified from git history: the current checkout does not contain `packages/auth`, `packages/db`, or `supabase/`, so the historical full local backend setup cannot be reproduced from this revision alone.

## Forward Policy

- Keep the integration data-first. Use Okiyuka as the source of layout output and Pascal Editor as the visualization target until there is a clear reason to build a tighter runtime bridge.
- Continue using the existing Pascal scene import path before adding any new editor-side importer UI.
- Treat the current working tree as the source of truth. Do not rely on stale documentation for auth, database, or Supabase workflows without first verifying that the files exist in the checkout.
- Expand the converter incrementally, starting with real Okiyuka export files and then adding richer mappings for panels, pedestals, and edge rails.
- Preserve viewer isolation and existing scene schema rules when extending the bridge, so editor-specific behavior does not leak into the viewer package.
- If a full local auth / database workflow becomes necessary, restore or reintroduce the removed stack from history as a separate task instead of mixing that recovery into the current PoC work.

## Repository Drift Note

The current Pascal Editor checkout does not include the older local Supabase stack described by historical documents.

Verified missing parts in the current checkout:

- `packages/auth`
- `packages/db`
- `supabase/`

That does not block the Okiyuka import PoC, but it does block the older full local auth / database workflow.