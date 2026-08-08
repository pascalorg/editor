# Changelog

All notable changes to `@pascal-app/mcp` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **On the gap between 0.1.0 and 0.3.2.** This file was written with the initial
> scaffolding and then went unmaintained through five releases, while the tool
> count went from 19 to 46. The entries below for 0.1.1 – 0.3.2 were
> reconstructed after the fact from the version bumps in
> `packages/mcp/package.json` and the commits touching `packages/mcp/` between
> them, so they are a summary of what changed rather than a record kept at the
> time. Dates are the release commit's, not the publish date. Anything that
> only moved a shared dependency version is omitted.

## [Unreleased]

### Added

- 2 formwork tools, the first on this surface: `inspect_project_formwork` (the
  bill for a scope — panel/tie/prop lines, total weight, elements nobody has
  formed yet, and the caveats that invalidate the figures) and
  `validate_formwork` (whether that formwork can be erected — 15 invariants
  over the solved layout, pressure envelope, catalog system and drilled tie
  grid). Neither answer is derivable from the scene graph, so before this an
  external agent could read a whole project and not ask either question.
  Read-only: the formwork mutations write through the store and want the
  live-snapshot publish path.
- A `## Formwork` section in the agent guide resource. MCP gives a server no
  system prompt, so the reasoning the editor's own AI is told — that formwork
  is a different model from the building, that the two severity counts must
  never be merged, that `notChecked` and `caveats` are always reported — lives
  there and in the tool descriptions instead.
- `@pascal-app/nodes` and `three` as dependencies, reached through the narrow
  `@pascal-app/nodes/formwork-assembly/headless` entry point so the server
  takes the solve without React, `@pascal-app/viewer` or `@pascal-app/editor`.

## [0.3.2] - 2026-07-17

### Added

- Natural-language measurements on tool inputs via `@pascal-app/lingo`:
  `measurement()` accepts `"6 ft"`, `"180cm"`, `"2 ft 3 in"` for lengths and
  `"45°"`, `"0.25 turn"` for angles anywhere a dimension is taken
  (`create_wall`, `create_level`, `cut_opening`, `place_item`, the room and
  construction tools), canonicalising to the unit the handler already expects.
  A bare number is still valid and is read in the field's own unit.
- `installedPlugins` round-trips through `SceneBridge`, so a scene saved by an
  editor with plugins installed reloads with the same set.

### Fixed

- `measurement()` rejects genuinely ambiguous separators — `"1,234"` could mean
  1234 or 1.234, and absorbing it silently is how a European decimal becomes a
  1000× value in a wall length.
- `measurement()` restored its `positive` / `min` / `max` validation, which the
  first natural-language pass dropped. A zero or negative dimension produced a
  degenerate node rather than an error the model could read.

## [0.3.1] - 2026-06-10

### Added

- The plan → world coordinate convention is documented in the README, with a
  worked demonstration in `examples/coordinate-conventions-demo.{md,json}`:
  the axis-aligned baseline, a slab rotated 30°, and a paired
  "page-intent vs world-result" case for coordinates authored outside the
  editor. Written because Pascal's `[x, z]` plan pairs are not the `[x, y]`
  north-up convention most external tooling produces, and the mistake is
  invisible until something is viewed.

## [0.3.0] - 2026-05-27

### Changed

- `SiteNode.children` is `string[]`. The bundled templates and
  `rehydrate-site-children` follow the schema rather than carrying their own
  shape for it.
- `construction-tools` covers the six roof-accessory kinds (chimney, dormer,
  skylight, solar panel, ridge vent, box vent) added on the registry model.
- Peer dependency on `@pascal-app/core` moved to `^0.8.0`.

## [0.2.0] - 2026-05-10

Synchronised with the private editor, which is where the project lifecycle was
built. The package's subject widened here: from "drive a scene graph" to "drive
a browser-visible project".

### Added

- 3 project-lifecycle tools: `create_project`, `get_project_status`, and
  `create_house_from_brief` (46 tools total).
- `save_scene` takes a `saveMode`: `draft` for autosave-style progress against
  the browser-visible working model, `checkpoint` for a durable version. The
  distinction is the one an agent gets wrong by default — every save a
  milestone, or none of them.
- `pascal://agent-guide` as the canonical URI for the agent guide;
  `pascal://agent/guide` is kept as a legacy alias (6 resources total).
- Scene metadata on the store — project name, published/latest version,
  browser-visible version, node count and graph hash — so an agent can tell a
  non-empty graph from an empty browser tab.

## [0.1.1] - 2026-04-28

The first release with a usable tool surface: 19 tools at the point this file
was first written, 43 by the release (5 resources, 3 prompts).

### Added

- Semantic construction tools, so an agent does not hand-write node graphs:
  `create_story_shell`, `create_stair_between_levels`, `create_roof`,
  `create_room`, `add_door`, `add_window`, `furnish_room`, `search_assets`.
- Scene-query tools: `list_levels`, `get_level_summary`, `get_walls`,
  `get_zones`, `verify_scene`.
- Scene lifecycle against the local SQLite store: `save_scene`, `load_scene`,
  `list_scenes`, `rename_scene`, `delete_scene`.
- `list_templates` / `create_from_template`, `generate_variants`, and
  `photo_to_scene`.
- A local `scene_events` stream, so an open editor tab can apply snapshots as
  an agent edits the same saved scene.
- `pascal://agent/guide` — the MCP-first workflow, scene invariants and tool
  preferences for external agents.

### Fixed

- URL-validation bypasses in the vision tools (SSRF) and on the editor's
  scene PUT route, found by a pre-push audit.
- `apply_patch` preserves schema-defaulted ids across a multi-op batch, so a
  later op in the same batch can reference something an earlier one created.
- Root scene nodes are normalised on load, and level duplication no longer
  loses descendants.
- Scene storage moved to the local SQLite store, replacing the Supabase
  adapter.

## [0.1.0] - 2026-04-18

### Added

- Initial release.
- `SceneBridge` headless adapter for `@pascal-app/core` with RAF polyfill so
  the Zustand store and Zundo temporal middleware run cleanly in Node.
- 19 MCP tools covering scene querying (`get_scene`, `get_node`,
  `describe_node`, `find_nodes`, `measure`), mutation (`apply_patch`,
  `create_level`, `create_wall`, `place_item`, `cut_opening`, `set_zone`,
  `duplicate_level`, `delete_node`), undo/redo (`undo`, `redo`), export
  (`export_json`, `export_glb`), validation (`validate_scene`,
  `check_collisions`), plus 2 vision tools (`analyze_floorplan_image`,
  `analyze_room_photo`) backed by MCP sampling.
- 4 MCP resources: `pascal://scene/current`,
  `pascal://scene/current/summary`, `pascal://catalog/items`, and
  `pascal://constraints/{levelId}`.
- 3 MCP prompts: `from_brief`, `iterate_on_feedback`, and
  `renovation_from_photos`.
- stdio and Streamable HTTP transports.
- `pascal-mcp` CLI binary with `--stdio`, `--http --port`, and `--scene`
  flags.
- Local `SqliteSceneStore` backed by built-in SQLite drivers (`bun:sqlite` in
  the MCP CLI, `node:sqlite` in the Next.js editor server), with WAL mode,
  transaction-scoped optimistic locking, revision rows, and shared
  `PASCAL_DATA_DIR` / `PASCAL_DB_PATH` configuration for MCP and the editor.

### Removed

- Supabase storage adapter, SQL migrations, and the `@supabase/supabase-js`
  runtime dependency.
- Committed MCP `test-reports/` development artifacts.
