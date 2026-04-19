# P3 — Phase 8: Version Conflict / Optimistic Locking Report

Run: 2026-04-19T18:19:49.835Z

## Summary

- PASS: 12
- WARN: 0
- FAIL: 0
- Total: 12

## Matrix

| ID | Part | Description | Verdict |
|----|------|-------------|---------|
| A1 | A | save_scene fresh → version === 1 | PASS |
| A2 | A | save_scene expectedVersion=1 → version === 2 | PASS |
| A3 | A | save_scene expectedVersion=5 (stale) → version_conflict | PASS |
| A4 | A | save_scene WITHOUT expectedVersion on existing id | PASS |
| A5 | A | rename_scene expectedVersion=99 (current=2) → version_conflict | PASS |
| A6 | A | delete_scene expectedVersion=99 (stale) → version_conflict | PASS |
| B1 | B | POST /api/scenes { id: "p3-http-mo63c61z", name: "p3-http" } → 201 | PASS |
| B2 | B | GET /api/scenes/p3-http-mo63c61z — ETag header matches "1" | PASS |
| B3 | B | PUT with If-Match: "1" (matching current) → 200 | PASS |
| B4 | B | PUT with If-Match: "99" (stale) → 409 | PASS |
| B5 | B | DELETE with If-Match: "99" (stale) → 409 | PASS |
| B6 | B | DELETE with correct If-Match: "2" → 204 | PASS |

## Details

### A1 — part A — save_scene fresh → version === 1

**Verdict:** PASS

**Expected:** success, version=1

**Actual:** success, version=1, id=p3-mcp

### A2 — part A — save_scene expectedVersion=1 → version === 2

**Verdict:** PASS

**Expected:** success, version=2

**Actual:** success, version=2

### A3 — part A — save_scene expectedVersion=5 (stale) → version_conflict

**Verdict:** PASS

**Expected:** McpError / tool_error with code=version_conflict

**Actual:** tool_error: MCP error -32600: version_conflict

### A4 — part A — save_scene WITHOUT expectedVersion on existing id

**Verdict:** PASS

**Expected:** Document behaviour: lenient overwrite OR strict reject

**Actual:** tool_error: MCP error -32600: Scene with id "p3-mcp" already exists. Pass a different id or provide expectedVersion to overwrite.

**Note:** STRICT: save without expectedVersion rejected — existing scene protected

### A5 — part A — rename_scene expectedVersion=99 (current=2) → version_conflict

**Verdict:** PASS

**Expected:** McpError / tool_error with code=version_conflict

**Actual:** tool_error: MCP error -32600: version_conflict

### A6 — part A — delete_scene expectedVersion=99 (stale) → version_conflict

**Verdict:** PASS

**Expected:** McpError / tool_error with code=version_conflict

**Actual:** tool_error: MCP error -32600: version_conflict

### B1 — part B — POST /api/scenes { id: "p3-http-mo63c61z", name: "p3-http" } → 201

**Verdict:** PASS

**Expected:** status 201, body has version=1

**Actual:** status=201, body={"id":"p3-http-mo63c61z","name":"p3-http","projectId":null,"thumbnailUrl":null,"version":1,"createdAt":"2026-04-19T18:19:49.805Z","updatedAt":"2026-04-19T18:19:49.805Z","ownerId":null,"sizeBytes":928,"nodeCount":1}

### B2 — part B — GET /api/scenes/p3-http-mo63c61z — ETag header matches "1"

**Verdict:** PASS

**Expected:** status 200, ETag: "1"

**Actual:** status=200, ETag="\"1\""

### B3 — part B — PUT with If-Match: "1" (matching current) → 200

**Verdict:** PASS

**Expected:** status 200, version=2, ETag: "2"

**Actual:** status=200, version=2, ETag="\"2\""

### B4 — part B — PUT with If-Match: "99" (stale) → 409

**Verdict:** PASS

**Expected:** status 409, body { error: "version_conflict" }

**Actual:** status=409, body={"error":"version_conflict","currentVersion":2}

### B5 — part B — DELETE with If-Match: "99" (stale) → 409

**Verdict:** PASS

**Expected:** status 409, body { error: "version_conflict" }

**Actual:** status=409, body={"error":"version_conflict","currentVersion":2}

### B6 — part B — DELETE with correct If-Match: "2" → 204

**Verdict:** PASS

**Expected:** status 204, empty body

**Actual:** status=204, body=(empty)
