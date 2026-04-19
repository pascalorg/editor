# Changelog

All notable changes to `@pascal-app/mcp` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
