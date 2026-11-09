# Changelog

All notable changes to `@pascal-app/mcp` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `registerOperationTool(server, operations, tool, catalog?)` from
  `@pascal-app/mcp/tools/shared-tools`: the shared tools' runner, so a host
  registers a plugin's `'operation'` tools the same way, with its own
  annotations ([#1026](https://github.com/pascalorg/editor/pull/1026)).
- `createSceneOperations({ activeLevelId })`: the floor the host's person is
  viewing, which the shared tools, `add_object`, `add_column` and the scripted
  openings read when a call names no level; without it, the lowest storey
  ([#1083](https://github.com/pascalorg/editor/pull/1083)).
- `add_object`, `add_window`, `add_door` and `add_column` take
  `language: 'bpy'`; a local server runs Blender modules in the binary
  `PASCAL_BLENDER` names ([#1033](https://github.com/pascalorg/editor/pull/1033)).
- `move_roofs_to_roof_level` moves the roofs a storey holds on its own walls to
  the roof level ([#1047](https://github.com/pascalorg/editor/pull/1047)).
- The agent guide points a hosted server's agent at the project's other chats,
  files and members ([#1035](https://github.com/pascalorg/editor/pull/1035)).

### Changed

- Built on the v2 MCP SDK (`@modelcontextprotocol/server` 2.2). Over stdio the
  server answers clients on protocol 2026-07-28 as well as 2025 clients; HTTP
  still serves the 2025 sessionful protocol. A call to a tool name no server
  has is a JSON-RPC error (`-32602`), not a tool result with `isError`.
  Embedding code imports `Client` and `InMemoryTransport` from
  `@modelcontextprotocol/client`
  ([#1118](https://github.com/pascalorg/editor/pull/1118)).
- `get_site` gives the street's frontage and depth, each buildable edge as a
  front, the ground and the usual footprint range, and reads a lot by `site`
  with no building yet ([#1044](https://github.com/pascalorg/editor/pull/1044),
  [#1080](https://github.com/pascalorg/editor/pull/1080)).
- Lengths and angles read text in any unit, and `create_roof`'s `pitch` rise
  over run (`"6:12"`) ([#1079](https://github.com/pascalorg/editor/pull/1079)).
- `paint` reaches every part with surfaces and `search_materials` browses the
  library ([#1034](https://github.com/pascalorg/editor/pull/1034),
  [#1076](https://github.com/pascalorg/editor/pull/1076)).
- `view_scene` takes street-relative sides, `camera: 'current'` (refused here,
  `no_current_camera`), `lighting`, `maxPx` and `interior`, and renders
  1920 × 1200 ([#1034](https://github.com/pascalorg/editor/pull/1034),
  [#1051](https://github.com/pascalorg/editor/pull/1051),
  [#1075](https://github.com/pascalorg/editor/pull/1075)).
- `create_stair` builds L and U stairs, railings and a flight to no level
  ([#1073](https://github.com/pascalorg/editor/pull/1073)).
- `create_roof` builds barrel and glazed roofs (`roofSystem`, `glazing`,
  `barrelRise`, `barrelSegments`) ([#1055](https://github.com/pascalorg/editor/pull/1055)).
- `apply_patch` seats a roof on the level above the walls that carry it, with a
  note, and refuses `roof_level`, `roof_level_holds_storey` and
  `roof_level_on_top` ([#1039](https://github.com/pascalorg/editor/pull/1039),
  [#1057](https://github.com/pascalorg/editor/pull/1057)).

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
  error `tool_retired` with its replacement and how to use it
  ([#1081](https://github.com/pascalorg/editor/pull/1081),
  [#1084](https://github.com/pascalorg/editor/pull/1084)).

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
