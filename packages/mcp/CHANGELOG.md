# Changelog

All notable changes to `@pascal-app/mcp` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- `verify_scene` is the one scene check: it lists every node field its schema
  rejects (`schema_invalid`, with `nodeId` and `path`), a node kind no schema
  knows once per kind (`schema_unknown_kind`, info), a hidden site
  (`site_hidden`), and the spaces the walls enclose against the rooms
  (`space_no_room`, `space_many_rooms`, `room_not_enclosed`, `room_unnamed`).
- `find_by_type` is the one finder: beside a type (any core or plugin kind, an
  item category, lights, typed parts), it filters by `levelId`, `parentId`,
  `zoneId`, `sourceId` and `sourceIdPrefix`, finds every node they match
  without a type, and gives each node's `parentId`, `metadata` and
  `provenance`. A level, parent or zone that is not there is refused, and so
  is a type that names nothing (`unknown_type`). It lists 200 results unless
  `limit` asks for more; `count` says how many match and `truncated` that some
  are left out.
- `get_node` is the one node read: beside the node it gives its `ancestorIds`,
  a wall's or ceiling's `resolvedHeight` and `heightIsExplicit`, a wall's
  `resolvedThickness`, a level's or floor plate's `displayName`, and in
  `missingChildIds` the stored children that name no node.

### Removed

- `validate_scene` retired into `verify_scene`, `find_nodes` into
  `find_by_type` and `describe_node` into `get_node`. A call to one returns the
  error `tool_retired` with its replacement and how to use it.

### Fixed

- The published ESM output now resolves relative JavaScript imports under Node,
  so `pascal-mcp` and package subpath exports no longer require Bun's
  extensionless import fallback.
- Tool schemas in `tools/list` now declare the JSON Schema 2020-12 dialect
  instead of the SDK default `draft-07`, so clients that enforce 2020-12 no
  longer reject every tool call.

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
