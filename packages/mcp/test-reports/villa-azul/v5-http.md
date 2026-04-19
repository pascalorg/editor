# Villa Azul — Phase 9 Verifier V5 (HTTP round-trip)

- Date: 2026-04-18
- Base URL: http://localhost:3002
- Scene ID: a6e7919eacbe
- Result: ALL PASS (10/10)

## HTTP Status Code Matrix

| # | Check | HTTP | Status |
|---|---|---|---|
| 01 | GET /api/scenes lists Villa Azul | 200 | PASS |
| 02 | GET /api/scenes/:id headers+shape | 200 | PASS |
| 03 | nodeCount & graph.nodes keys === 56 | 200 | PASS |
| 04 | type counts match build summary | 200 | PASS |
| 05 | 404 not_found on bad id | 404 | PASS |
| 06 | GET /api/scenes?limit=1 returns 1 | 200 | PASS |
| 07 | HEAD /api/scenes/:id behavior | 200 | PASS |
| 08a | PATCH rename with If-Match:"1" → v=2 | 200 | PASS |
| 08b | PATCH revert with If-Match:"2" → v=3 | 200 | PASS |
| 09 | PUT with stale If-Match:"1" → 409 | 409 | PASS |

## Details

### 01 GET /api/scenes lists Villa Azul
- HTTP: 200
- Status: PASS
- Details: found=true name=Villa Azul total=1

### 02 GET /api/scenes/:id headers+shape
- HTTP: 200
- Status: PASS
- Details: ETag="1" Content-Type=application/json

### 03 nodeCount & graph.nodes keys === 56
- HTTP: 200
- Status: PASS
- Details: nodeCount=56 keys=56

### 04 type counts match build summary
- HTTP: 200
- Status: PASS
- Details: {"site":1,"building":1,"level":1,"wall":12,"zone":13,"door":10,"window":12,"slab":1,"fence":5}

### 05 404 not_found on bad id
- HTTP: 404
- Status: PASS
- Details: body={"error":"not_found"}

### 06 GET /api/scenes?limit=1 returns 1
- HTTP: 200
- Status: PASS
- Details: count=1

### 07 HEAD /api/scenes/:id behavior
- HTTP: 200
- Status: PASS
- Details: HEAD returned 200 (supported)

### 08a PATCH rename with If-Match:"1" → v=2
- HTTP: 200
- Status: PASS
- Details: name=Villa Azul renamed version=2

### 08b PATCH revert with If-Match:"2" → v=3
- HTTP: 200
- Status: PASS
- Details: name=Villa Azul version=3

### 09 PUT with stale If-Match:"1" → 409
- HTTP: 409
- Status: PASS
- Details: body={"error":"version_conflict","currentVersion":3}

## Notes

- HEAD /api/scenes/:id returned **200** — supported (Next.js returns HEAD for GET handlers by default).
- Final scene version after PATCH sequence: **3** (was 1; bumped to 2 then 3). The name was restored to 'Villa Azul' so downstream verifiers see the original name.
- PUT with stale If-Match "1" returned **409** (expected 409 since version is now 3).
