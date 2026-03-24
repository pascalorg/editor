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

## Current Load Procedure

1. Start Pascal Editor locally
2. Open `Settings`
3. Click `Load Build`
4. Select `pascal_scene.json`

## What This PoC Is Good For

- checking room geometry in the Pascal viewer
- confirming the coordinate conversion path
- validating a future richer bridge for panels, pedestals, and rails

## Current Limitations

- panels are not yet mapped into Pascal item nodes
- pedestals are not yet mapped
- edge rails are not yet mapped
- wall thickness and height are placeholder visualization values
- shared room edges are deduplicated only by exact segment match

## Progress Snapshot (2026-03-25)

- Pascal Editor was cloned into `C:\dev\pascal-editor` and brought up for local development with Bun.
- The editor dev server is configured to run on `http://127.0.0.1:3002` so local inspection stays bound to localhost.
- The current scene import seam was confirmed: `Settings -> Load Build` accepts a JSON scene graph with `nodes` and `rootNodeIds`.
- A minimal bridge now exists on the Okiyuka side at `C:\Okiyuka_V1.0\tools\okiyuka_to_pascal_scene.py`.
- The bridge currently converts room polygons into Pascal zones and room perimeter segments into Pascal walls under one site, one building, and one level.
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