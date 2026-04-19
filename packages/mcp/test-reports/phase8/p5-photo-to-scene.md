# Phase 8 P5 — `photo_to_scene` via stdio with mocked sampling

Generated: 2026-04-19T18:18:43.532Z

## Summary

- Transport: stdio (`bun packages/mcp/dist/bin/pascal-mcp.js --stdio`)
- Data dir: `/tmp/pascal-phase8-p5`
- Sampling: mocked via `client.setRequestHandler(CreateMessageRequestSchema, …)`
- Passed: **6/6**
- Failed: **0/6**
- Total run time: **172 ms**
- Observed sceneId: `02c817a2772b`
- Node count after load_scene: **8**

## Tests

| # | Test | Status | Summary |
|---|------|--------|---------|
| 1 | 1. happy path photo_to_scene(save:true) | PASS | sceneId=02c817a2772b url=/scene/02c817a2772b walls=4 rooms=1 confidence=0.85 |
| 2 | 2. list_scenes includes new scene | PASS | found id=02c817a2772b name="p5-photo" (total=1) |
| 3 | 3. load_scene + validate_scene | PASS | nodeCount=8 valid=true errors=0 |
| 4 | 4. save:false returns graph inline | PASS | inline graph nodes=8, rootIds=1, walls=4, rooms=1 |
| 5 | 5. invalid sampling JSON → sampling_response_unparseable | PASS | received expected error |
| 6 | 6. no sampling capability → sampling_unavailable | PASS | received expected error |

## Details

### 1. 1. happy path photo_to_scene(save:true) — PASS

Summary: sceneId=02c817a2772b url=/scene/02c817a2772b walls=4 rooms=1 confidence=0.85

```json
{"sceneId":"02c817a2772b","url":"/scene/02c817a2772b","walls":4,"rooms":1,"confidence":0.85}
```

### 2. 2. list_scenes includes new scene — PASS

Summary: found id=02c817a2772b name="p5-photo" (total=1)

```json
{"total":1,"match":{"id":"02c817a2772b","name":"p5-photo","projectId":null,"thumbnailUrl":null,"version":1,"createdAt":"2026-04-19T18:18:43.447Z","updatedAt":"2026-04-19T18:18:43.447Z","ownerId":null,"sizeBytes":4740,"nodeCount":8}}
```

### 3. 3. load_scene + validate_scene — PASS

Summary: nodeCount=8 valid=true errors=0

```json
{"load":{"id":"02c817a2772b","name":"p5-photo","projectId":null,"thumbnailUrl":null,"version":1,"createdAt":"2026-04-19T18:18:43.447Z","updatedAt":"2026-04-19T18:18:43.447Z","ownerId":null,"sizeBytes":4740,"nodeCount":8},"validate":{"valid":true,"errors":[]}}
```

### 4. 4. save:false returns graph inline — PASS

Summary: inline graph nodes=8, rootIds=1, walls=4, rooms=1

```json
{"walls":4,"rooms":1,"confidence":0.85,"nodes":8,"roots":1}
```

### 5. 5. invalid sampling JSON → sampling_response_unparseable — PASS

Summary: received expected error

```json
MCP error -32603: sampling_response_unparseable
```

### 6. 6. no sampling capability → sampling_unavailable — PASS

Summary: received expected error

```json
MCP error -32600: sampling_unavailable
```

## Canned sampling payload

```json
{
  "walls": [
    {
      "start": [
        0,
        0
      ],
      "end": [
        5,
        0
      ],
      "thickness": 0.2
    },
    {
      "start": [
        5,
        0
      ],
      "end": [
        5,
        3
      ],
      "thickness": 0.2
    },
    {
      "start": [
        5,
        3
      ],
      "end": [
        0,
        3
      ],
      "thickness": 0.2
    },
    {
      "start": [
        0,
        3
      ],
      "end": [
        0,
        0
      ],
      "thickness": 0.2
    }
  ],
  "rooms": [
    {
      "name": "living room",
      "polygon": [
        [
          0,
          0
        ],
        [
          5,
          0
        ],
        [
          5,
          3
        ],
        [
          0,
          3
        ]
      ],
      "approximateAreaSqM": 15
    }
  ],
  "approximateDimensions": {
    "widthM": 5,
    "depthM": 3
  },
  "confidence": 0.85
}
```
