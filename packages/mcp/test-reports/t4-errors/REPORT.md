# T4 — Error Contract Verification Report

Server: `http://localhost:3917/`
Run date: 2026-04-18T16:17:28.757Z

## Summary

- PASS: 24
- WARN: 0
- FAIL: 0
- Total cases: 24

Baseline node count: 3
Final node count: 3 (delta=0)
Final validation: valid=true, errors=0

## Cases

### T4-01 — `get_node` — nonexistent id

**Verdict:** ✅ PASS

**Input:**
```json
{
  "id": "node_doesnotexist_xyz"
}
```

**Expected:** McpError InvalidParams (-32602) "Node not found" OR structured tool error

**Actual:**
```json
{
  "kind": "tool_error",
  "message": "MCP error -32602: Node not found: node_doesnotexist_xyz",
  "rawContent": [
    {
      "type": "text",
      "text": "MCP error -32602: Node not found: node_doesnotexist_xyz"
    }
  ]
}
```

### T4-02 — `describe_node` — nonexistent id

**Verdict:** ✅ PASS

**Input:**
```json
{
  "id": "node_missing_123"
}
```

**Expected:** McpError InvalidParams (-32602) "Node not found"

**Actual:**
```json
{
  "kind": "tool_error",
  "message": "MCP error -32602: Node not found: node_missing_123",
  "rawContent": [
    {
      "type": "text",
      "text": "MCP error -32602: Node not found: node_missing_123"
    }
  ]
}
```

### T4-03 — `find_nodes` — invalid type enum "hamster"

**Verdict:** ✅ PASS

**Input:**
```json
{
  "type": "hamster"
}
```

**Expected:** Zod validation error (MCP InvalidParams -32602)

**Actual:**
```json
{
  "kind": "tool_error",
  "message": "MCP error -32602: Input validation error: Invalid arguments for tool find_nodes: [\n  {\n    \"code\": \"invalid_value\",\n    \"values\": [\n      \"site\",\n      \"building\",\n      \"level\",\n      \"wall\",\n      \"fence\",\n      \"zone\",\n      \"slab\",\n      \"ceiling\",\n      \"roof\",\n      \"roof-segment\",\n      \"stair\",\n      \"stair-segment\",\n      \"item\",\n      \"door\",\n      \"window\",\n      \"scan\",\n      \"guide\"\n    ],\n    \"path\": [\n      \"type\"\n    ],\n    \"message\": \"Invalid option: expected one of \\\"site\\\"|\\\"building\\\"|\\\"level\\\"|\\\"wall\\\"|\\\"fence\\\"|\\\"zone\\\"|\\\"slab\\\"|\\\"ceiling\\\"|\\\"roof\\\"|\\\"roof-segment\\\"|\\\"stair\\\"|\\\"stair-segment\\\"|\\\"item\\\"|\\\"door\\\"|\\\"window\\\"|\\\"scan\\\"|\\\"guide\\\"\"\n  }\n]",
  "rawContent": [
    {
      "type": "text",
      "text": "MCP error -32602: Input validation error: Invalid arguments for tool find_nodes: [\n  {\n    \"code\": \"invalid_value\",\n    \"values\": [\n      \"site\",\n      \"building\",\n      \"level\",\n      \"wall\",\n      \"fence\",\n      \"zone\",\n      \"slab\",\n      \"ceiling\",\n      \"roof\",\n      \"roof-segment\",\n      \"stair\",\n      \"stair-segment\",\n      \"item\",\n      \"door\",\n      \"window\",\n      \"scan\",\n      \"guide\"\n    ],\n    \"path\": [\n      \"type\"\n    ],\n    \"message\": \"Invalid option: expected one of \\\"site\\\"|\\\"building\\\"|\\\"level\\\"|\\\"wall\\\"|\\\"fence\\\"|\\\"zone\\\"|\\\"slab\\\"|\\\"ceiling\\\"|\\\"roof\\\"|\\\"roof-segment\\\"|\\\"stair\\\"|\\\"stair-segment\\\"|\\\"item\\\"|\\\"door\\\"|\\\"window\\\"|\\\"scan\\\"|\\\"guide\\\"\"\n  }\n]"
    }
  ]
}
```

### T4-04 — `measure` — nonexistent fromId

**Verdict:** ✅ PASS

**Input:**
```json
{
  "fromId": "node_nosuch_f",
  "toId": "site_watn4a0qt2xpgri7"
}
```

**Expected:** McpError InvalidParams "Node not found"

**Actual:**
```json
{
  "kind": "tool_error",
  "message": "MCP error -32602: Node not found: node_nosuch_f",
  "rawContent": [
    {
      "type": "text",
      "text": "MCP error -32602: Node not found: node_nosuch_f"
    }
  ]
}
```

### T4-05 — `apply_patch` — patches with one invalid node (missing type)

**Verdict:** ✅ PASS

**Input:**
```json
{
  "patches": [
    {
      "op": "create",
      "node": {
        "foo": "bar"
      },
      "parentId": "level_tl2aravmn2u9afft"
    }
  ]
}
```

**Expected:** McpError InvalidParams, all-or-nothing rollback (no partial state change)

**Actual:**
```json
{
  "kind": "tool_error",
  "message": "MCP error -32602: invalid patch: patches[0] create node failed schema: [\n  {\n    \"code\": \"invalid_union\",\n    \"errors\": [],\n    \"note\": \"No matching discriminator\",\n    \"discriminator\": \"type\",\n    \"path\": [\n      \"type\"\n    ],\n    \"message\": \"Invalid input\"\n  }\n]",
  "rawContent": [
    {
      "type": "text",
      "text": "MCP error -32602: invalid patch: patches[0] create node failed schema: [\n  {\n    \"code\": \"invalid_union\",\n    \"errors\": [],\n    \"note\": \"No matching discriminator\",\n    \"discriminator\": \"type\",\n    \"path\": [\n      \"type\"\n    ],\n    \"message\": \"Invalid input\"\n  }\n]"
    }
  ]
}
```

### T4-06 — `apply_patch` — delete nonexistent id

**Verdict:** ✅ PASS

**Input:**
```json
{
  "patches": [
    {
      "op": "delete",
      "id": "node_nonexistent_delete_xyz"
    }
  ]
}
```

**Expected:** McpError InvalidParams, no state change

**Actual:**
```json
{
  "kind": "tool_error",
  "message": "MCP error -32602: invalid patch: patches[0] delete id \"node_nonexistent_delete_xyz\" not found",
  "rawContent": [
    {
      "type": "text",
      "text": "MCP error -32602: invalid patch: patches[0] delete id \"node_nonexistent_delete_xyz\" not found"
    }
  ]
}
```

### T4-07 — `create_level` — buildingId is not a building (passed a wall/level/site id)

**Verdict:** ✅ PASS

**Input:**
```json
{
  "buildingId": "level_tl2aravmn2u9afft",
  "elevation": 0
}
```

**Expected:** McpError InvalidParams "expected building"

**Actual:**
```json
{
  "kind": "tool_error",
  "message": "MCP error -32602: Node level_tl2aravmn2u9afft is a level, expected building",
  "rawContent": [
    {
      "type": "text",
      "text": "MCP error -32602: Node level_tl2aravmn2u9afft is a level, expected building"
    }
  ]
}
```

### T4-08 — `create_wall` — levelId doesn't exist

**Verdict:** ✅ PASS

**Input:**
```json
{
  "levelId": "level_nosuch_999",
  "start": [
    0,
    0
  ],
  "end": [
    5,
    0
  ]
}
```

**Expected:** McpError InvalidParams "Level not found"

**Actual:**
```json
{
  "kind": "tool_error",
  "message": "MCP error -32602: Level not found: level_nosuch_999",
  "rawContent": [
    {
      "type": "text",
      "text": "MCP error -32602: Level not found: level_nosuch_999"
    }
  ]
}
```

### T4-09 — `create_wall` — start not a tuple

**Verdict:** ✅ PASS

**Input:**
```json
{
  "levelId": "level_tl2aravmn2u9afft",
  "start": "not-a-tuple",
  "end": [
    5,
    0
  ]
}
```

**Expected:** Zod validation error (MCP InvalidParams -32602)

**Actual:**
```json
{
  "kind": "tool_error",
  "message": "MCP error -32602: Input validation error: Invalid arguments for tool create_wall: [\n  {\n    \"expected\": \"tuple\",\n    \"code\": \"invalid_type\",\n    \"path\": [\n      \"start\"\n    ],\n    \"message\": \"Invalid input: expected tuple, received string\"\n  }\n]",
  "rawContent": [
    {
      "type": "text",
      "text": "MCP error -32602: Input validation error: Invalid arguments for tool create_wall: [\n  {\n    \"expected\": \"tuple\",\n    \"code\": \"invalid_type\",\n    \"path\": [\n      \"start\"\n    ],\n    \"message\": \"Invalid input: expected tuple, received string\"\n  }\n]"
    }
  ]
}
```

### T4-10 — `place_item` — targetNodeId doesn't exist

**Verdict:** ✅ PASS

**Input:**
```json
{
  "catalogItemId": "chair-1",
  "targetNodeId": "node_nosuch_target",
  "position": [
    0,
    0,
    0
  ]
}
```

**Expected:** McpError InvalidParams "Target node not found"

**Actual:**
```json
{
  "kind": "tool_error",
  "message": "MCP error -32602: Target node not found: node_nosuch_target",
  "rawContent": [
    {
      "type": "text",
      "text": "MCP error -32602: Target node not found: node_nosuch_target"
    }
  ]
}
```

### T4-11 — `cut_opening` — wallId is not a wall

**Verdict:** ✅ PASS

**Input:**
```json
{
  "wallId": "site_watn4a0qt2xpgri7",
  "type": "door",
  "position": 0.5,
  "width": 0.8,
  "height": 2
}
```

**Expected:** McpError InvalidParams "expected wall"

**Actual:**
```json
{
  "kind": "tool_error",
  "message": "MCP error -32602: Node site_watn4a0qt2xpgri7 is a site, expected wall",
  "rawContent": [
    {
      "type": "text",
      "text": "MCP error -32602: Node site_watn4a0qt2xpgri7 is a site, expected wall"
    }
  ]
}
```

### T4-12 — `cut_opening` — position out of [0,1]

**Verdict:** ✅ PASS

**Input:**
```json
{
  "wallId": "missing_wall",
  "type": "door",
  "position": 2.5,
  "width": 0.8,
  "height": 2
}
```

**Expected:** Zod validation error (MCP InvalidParams) — position must be <= 1

**Actual:**
```json
{
  "kind": "tool_error",
  "message": "MCP error -32602: Input validation error: Invalid arguments for tool cut_opening: [\n  {\n    \"origin\": \"number\",\n    \"code\": \"too_big\",\n    \"maximum\": 1,\n    \"inclusive\": true,\n    \"path\": [\n      \"position\"\n    ],\n    \"message\": \"Too big: expected number to be <=1\"\n  }\n]",
  "rawContent": [
    {
      "type": "text",
      "text": "MCP error -32602: Input validation error: Invalid arguments for tool cut_opening: [\n  {\n    \"origin\": \"number\",\n    \"code\": \"too_big\",\n    \"maximum\": 1,\n    \"inclusive\": true,\n    \"path\": [\n      \"position\"\n    ],\n    \"message\": \"Too big: expected number to be <=1\"\n  }\n]"
    }
  ]
}
```

### T4-13 — `set_zone` — polygon with < 3 points

**Verdict:** ✅ PASS

**Input:**
```json
{
  "levelId": "level_tl2aravmn2u9afft",
  "polygon": [
    [
      0,
      0
    ],
    [
      5,
      0
    ]
  ],
  "label": "Tiny"
}
```

**Expected:** Zod validation error (MCP InvalidParams) — polygon must have >= 3 points

**Actual:**
```json
{
  "kind": "tool_error",
  "message": "MCP error -32602: Input validation error: Invalid arguments for tool set_zone: [\n  {\n    \"origin\": \"array\",\n    \"code\": \"too_small\",\n    \"minimum\": 3,\n    \"inclusive\": true,\n    \"path\": [\n      \"polygon\"\n    ],\n    \"message\": \"Too small: expected array to have >=3 items\"\n  }\n]",
  "rawContent": [
    {
      "type": "text",
      "text": "MCP error -32602: Input validation error: Invalid arguments for tool set_zone: [\n  {\n    \"origin\": \"array\",\n    \"code\": \"too_small\",\n    \"minimum\": 3,\n    \"inclusive\": true,\n    \"path\": [\n      \"polygon\"\n    ],\n    \"message\": \"Too small: expected array to have >=3 items\"\n  }\n]"
    }
  ]
}
```

### T4-14 — `duplicate_level` — levelId is not a level

**Verdict:** ✅ PASS

**Input:**
```json
{
  "levelId": "site_watn4a0qt2xpgri7"
}
```

**Expected:** McpError InvalidParams "expected level"

**Actual:**
```json
{
  "kind": "tool_error",
  "message": "MCP error -32602: Node site_watn4a0qt2xpgri7 is a site, expected level",
  "rawContent": [
    {
      "type": "text",
      "text": "MCP error -32602: Node site_watn4a0qt2xpgri7 is a site, expected level"
    }
  ]
}
```

### T4-15 — `delete_node` — cascade=false with children (target site site_watn4a0qt2xpgri7 children=1)

**Verdict:** ✅ PASS

**Input:**
```json
{
  "id": "site_watn4a0qt2xpgri7",
  "cascade": false
}
```

**Expected:** McpError InvalidRequest "node has children" (no delete)

**Actual:**
```json
{
  "kind": "tool_error",
  "message": "MCP error -32600: node has 2 descendant(s); pass cascade: true to delete recursively",
  "rawContent": [
    {
      "type": "text",
      "text": "MCP error -32600: node has 2 descendant(s); pass cascade: true to delete recursively"
    }
  ]
}
```

### T4-16a — `undo` — negative steps

**Verdict:** ✅ PASS

**Input:**
```json
{
  "steps": -1
}
```

**Expected:** Zod validation error (MCP InvalidParams) — steps must be positive int

**Actual:**
```json
{
  "kind": "tool_error",
  "message": "MCP error -32602: Input validation error: Invalid arguments for tool undo: [\n  {\n    \"origin\": \"number\",\n    \"code\": \"too_small\",\n    \"minimum\": 0,\n    \"inclusive\": false,\n    \"path\": [\n      \"steps\"\n    ],\n    \"message\": \"Too small: expected number to be >0\"\n  }\n]",
  "rawContent": [
    {
      "type": "text",
      "text": "MCP error -32602: Input validation error: Invalid arguments for tool undo: [\n  {\n    \"origin\": \"number\",\n    \"code\": \"too_small\",\n    \"minimum\": 0,\n    \"inclusive\": false,\n    \"path\": [\n      \"steps\"\n    ],\n    \"message\": \"Too small: expected number to be >0\"\n  }\n]"
    }
  ]
}
```

### T4-16b — `redo` — negative steps

**Verdict:** ✅ PASS

**Input:**
```json
{
  "steps": -2
}
```

**Expected:** Zod validation error (MCP InvalidParams) — steps must be positive int

**Actual:**
```json
{
  "kind": "tool_error",
  "message": "MCP error -32602: Input validation error: Invalid arguments for tool redo: [\n  {\n    \"origin\": \"number\",\n    \"code\": \"too_small\",\n    \"minimum\": 0,\n    \"inclusive\": false,\n    \"path\": [\n      \"steps\"\n    ],\n    \"message\": \"Too small: expected number to be >0\"\n  }\n]",
  "rawContent": [
    {
      "type": "text",
      "text": "MCP error -32602: Input validation error: Invalid arguments for tool redo: [\n  {\n    \"origin\": \"number\",\n    \"code\": \"too_small\",\n    \"minimum\": 0,\n    \"inclusive\": false,\n    \"path\": [\n      \"steps\"\n    ],\n    \"message\": \"Too small: expected number to be >0\"\n  }\n]"
    }
  ]
}
```

### T4-17 — `export_json` — pretty='yes' (string not bool)

**Verdict:** ✅ PASS

**Input:**
```json
{
  "pretty": "yes"
}
```

**Expected:** Zod validation error (MCP InvalidParams) — pretty must be boolean

**Actual:**
```json
{
  "kind": "tool_error",
  "message": "MCP error -32602: Input validation error: Invalid arguments for tool export_json: [\n  {\n    \"expected\": \"boolean\",\n    \"code\": \"invalid_type\",\n    \"path\": [\n      \"pretty\"\n    ],\n    \"message\": \"Invalid input: expected boolean, received string\"\n  }\n]",
  "rawContent": [
    {
      "type": "text",
      "text": "MCP error -32602: Input validation error: Invalid arguments for tool export_json: [\n  {\n    \"expected\": \"boolean\",\n    \"code\": \"invalid_type\",\n    \"path\": [\n      \"pretty\"\n    ],\n    \"message\": \"Invalid input: expected boolean, received string\"\n  }\n]"
    }
  ]
}
```

### T4-18 — `check_collisions` — levelId doesn't exist

**Verdict:** ✅ PASS

**Input:**
```json
{
  "levelId": "level_nosuch_zzz"
}
```

**Expected:** Empty collisions result OR graceful error

**Actual:**
```json
{
  "kind": "unexpected_success",
  "message": "tool returned successfully with no isError flag",
  "structuredContent": {
    "collisions": []
  },
  "rawContent": [
    {
      "type": "text",
      "text": "{\"collisions\":[]}"
    }
  ]
}
```

**Note:** returned empty collisions (graceful)

### T4-19 — `validate_scene` — baseline: no args

**Verdict:** ✅ PASS

**Input:**
```json
{}
```

**Expected:** Success — structured { valid, errors[] }

**Actual:**
```json
{
  "kind": "unexpected_success",
  "message": "tool returned successfully with no isError flag",
  "structuredContent": {
    "valid": true,
    "errors": []
  },
  "rawContent": [
    {
      "type": "text",
      "text": "{\"valid\":true,\"errors\":[]}"
    }
  ]
}
```

**Note:** baseline passed

### T4-20a — `analyze_floorplan_image` — image: '' (empty string)

**Verdict:** ✅ PASS

**Input:**
```json
{
  "image": ""
}
```

**Expected:** Validation error OR sampling_unavailable

**Actual:**
```json
{
  "kind": "tool_error",
  "message": "MCP error -32600: sampling_unavailable",
  "rawContent": [
    {
      "type": "text",
      "text": "MCP error -32600: sampling_unavailable"
    }
  ]
}
```

### T4-20b — `analyze_floorplan_image` — image: 'not-a-url-or-base64'

**Verdict:** ✅ PASS

**Input:**
```json
{
  "image": "not-a-url-or-base64"
}
```

**Expected:** Validation error OR sampling_unavailable

**Actual:**
```json
{
  "kind": "tool_error",
  "message": "MCP error -32600: sampling_unavailable",
  "rawContent": [
    {
      "type": "text",
      "text": "MCP error -32600: sampling_unavailable"
    }
  ]
}
```

### T4-21a — `analyze_room_photo` — image: '' (empty string)

**Verdict:** ✅ PASS

**Input:**
```json
{
  "image": ""
}
```

**Expected:** Validation error OR sampling_unavailable

**Actual:**
```json
{
  "kind": "tool_error",
  "message": "MCP error -32600: sampling_unavailable",
  "rawContent": [
    {
      "type": "text",
      "text": "MCP error -32600: sampling_unavailable"
    }
  ]
}
```

### T4-21b — `analyze_room_photo` — image: 'not-a-url-or-base64'

**Verdict:** ✅ PASS

**Input:**
```json
{
  "image": "not-a-url-or-base64"
}
```

**Expected:** Validation error OR sampling_unavailable

**Actual:**
```json
{
  "kind": "tool_error",
  "message": "MCP error -32600: sampling_unavailable",
  "rawContent": [
    {
      "type": "text",
      "text": "MCP error -32600: sampling_unavailable"
    }
  ]
}
```
