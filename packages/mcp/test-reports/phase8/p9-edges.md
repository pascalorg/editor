# Phase 8 P9 — edge cases & error-handling depth (stdio MCP)

Generated: 2026-04-19T18:20:30.398Z
Transport: stdio (`bun packages/mcp/dist/bin/pascal-mcp.js --stdio`), data dir `/tmp/pascal-phase8-p9`.

**Summary:** 13/13 PASS, 0 WARN, 0 FAIL, 419 ms.
Scene files on disk after bulk tests: 50

## Test cases

| # | Case | Status | Detail |
|---|------|--------|--------|
| 1 | save 5k-node scene | PASS | nodeCount=5003 (expected 5003), sizeBytes=2392313, version=1 |
| 2 | save 10 MB-ish scene rejected | PASS | tool_error text="MCP error -32600: Scene "too-big-scene" is 12754914 bytes, exceeds cap of 10485760 bytes" |
| 3 | save_scene path-traversal id | PASS | sanitised id="etcpasswd", fileExists=true, noEscape=true |
| 4 | save_scene dirty id sanitisation | PASS | sanitised id="upper-case", fileExists=true |
| 5 | save_scene empty id rejected | PASS | tool_error: MCP error -32602: Input validation error: Invalid arguments for tool save_scene: [   {     "origin": "string",     "code": "too_small",     "minimum": 1,     "inclusive": true,     "path": [       "id… |
| 6 | save_scene empty name rejected | PASS | tool_error: MCP error -32602: Input validation error: Invalid arguments for tool save_scene: [   {     "origin": "string",     "code": "too_small",     "minimum": 1,     "inclusive": true,     "path": [       "na… |
| 7 | save_scene name length 500 rejected | PASS | tool_error: MCP error -32602: Input validation error: Invalid arguments for tool save_scene: [   {     "origin": "string",     "code": "too_big",     "maximum": 200,     "inclusive": true,     "path": [       "na… |
| 8 | create_from_template null id rejected | PASS | tool_error: MCP error -32602: Input validation error: Invalid arguments for tool create_from_template: [   {     "expected": "string",     "code": "invalid_type",     "path": [       "id"     ],     "message": "I… |
| 9 | rename_scene empty newName rejected | PASS | tool_error: MCP error -32602: Input validation error: Invalid arguments for tool rename_scene: [   {     "origin": "string",     "code": "too_small",     "minimum": 1,     "inclusive": true,     "path": [       "… |
| 10 | list 50 scenes updatedAt DESC | PASS | count=50, descOk=true |
| 11 | list_scenes limit=10 | PASS | count=10 |
| 12 | list_scenes limit=-1 | PASS | rejected: MCP error -32602: Input validation error: Invalid arguments for tool list_scenes: [   {     "origin": "number",     "code": "too_small",     "minimum": 0,     "inclusive": false,     "path": [       "… |
| 13 | PASCAL_DATA_DIR nonexistent root | PASS | auto-created=true, file=true, id=first-scene |

## Notes

- Case 1 (5k nodes) constructs walls programmatically and saves via
  `save_scene({ includeCurrentScene: false, graph })`.
- Case 2 pads `metadata.padding` on each of 500 walls to push past 10 MB.
  PASS = structured error mentioning `too_large`; WARN = other rejection reason.
- Cases 3-5 exercise slug hygiene (`sanitizeSlug` in `storage/slug.ts`).
- Case 13 spawns a second stdio child with a deep nonexistent data dir.
  PASS if the dir is auto-created by the filesystem store or the call fails with a
  clear error (ENOENT/EACCES/etc.).
