# Generate a 2-bed apartment from a brief

This example walks through a realistic session with an MCP host (Claude
Desktop, Claude Code, or Cursor) that has `pascal-mcp` configured. The agent
uses the `from_brief` prompt to turn a short brief into a concrete scene.

## The brief

> **User:** Claude, create a 2-bedroom 1-bath apartment in 80 m² in Spain.

The host UI lets the user select the **`from_brief`** prompt and fills in:

```text
brief: "2-bedroom 1-bath apartment in 80 m² in Spain, open-plan living /
         kitchen, bathroom on the interior wall"
constraints: "Spanish building regulations; ceiling height 2.5 m"
```

## What the agent does

The prompt returns a system message instructing the agent to start from an
empty site, read the current scene, and emit incremental `apply_patch` calls.
The agent proceeds roughly like this:

### 1. Inspect the current scene

```jsonc
// tool: get_scene
{ "name": "get_scene", "arguments": {} }
```

Response (trimmed):

```jsonc
{
  "nodes": {
    "site-1": { "type": "site", "id": "site-1", "children": [/* ... */] },
    "building-1": { "type": "building", "id": "building-1", "parentId": "site-1" },
    "level-1":    { "type": "level",    "id": "level-1",    "parentId": "building-1",
                    "elevation": 0, "height": 2.5 }
  },
  "rootNodeIds": ["site-1"]
}
```

The default scene is a Site → Building → Level stack with no walls. The
agent decides to work on `level-1` and targets a 10 m × 8 m = 80 m² outline.

### 2. Create the perimeter walls

The agent chooses a rectangular outline with its origin at (0, 0):

```jsonc
// tool: apply_patch
{
  "name": "apply_patch",
  "arguments": {
    "patches": [
      { "op": "create", "parentId": "level-1",
        "node": { "type": "wall", "start": [0, 0], "end": [10, 0],
                  "thickness": 0.2, "height": 2.5 } },
      { "op": "create", "parentId": "level-1",
        "node": { "type": "wall", "start": [10, 0], "end": [10, 8],
                  "thickness": 0.2, "height": 2.5 } },
      { "op": "create", "parentId": "level-1",
        "node": { "type": "wall", "start": [10, 8], "end": [0, 8],
                  "thickness": 0.2, "height": 2.5 } },
      { "op": "create", "parentId": "level-1",
        "node": { "type": "wall", "start": [0, 8], "end": [0, 0],
                  "thickness": 0.2, "height": 2.5 } }
    ]
  }
}
```

Response:

```jsonc
{ "applied": 4 }
```

### 3. Create interior partitions

Two bedrooms on the east side, bathroom on the interior wall, open-plan
living / kitchen on the west.

```jsonc
// tool: apply_patch
{
  "name": "apply_patch",
  "arguments": {
    "patches": [
      { "op": "create", "parentId": "level-1",
        "node": { "type": "wall", "start": [5.5, 0], "end": [5.5, 8],
                  "thickness": 0.15, "height": 2.5 } },
      { "op": "create", "parentId": "level-1",
        "node": { "type": "wall", "start": [5.5, 4], "end": [10, 4],
                  "thickness": 0.15, "height": 2.5 } },
      { "op": "create", "parentId": "level-1",
        "node": { "type": "wall", "start": [5.5, 5.5], "end": [8, 5.5],
                  "thickness": 0.15, "height": 2.5 } },
      { "op": "create", "parentId": "level-1",
        "node": { "type": "wall", "start": [8, 4], "end": [8, 5.5],
                  "thickness": 0.15, "height": 2.5 } }
    ]
  }
}
```

### 4. Define zones

The agent declares the rooms so later queries and item placement can target
them by name:

```jsonc
// tool: set_zone  (called once per zone)
{
  "name": "set_zone",
  "arguments": {
    "levelId": "level-1",
    "label": "Living / Kitchen",
    "polygon": [[0, 0], [5.5, 0], [5.5, 8], [0, 8]]
  }
}
// → { "zoneId": "zone-living" }

{
  "name": "set_zone",
  "arguments": {
    "levelId": "level-1",
    "label": "Bedroom 1",
    "polygon": [[5.5, 0], [10, 0], [10, 4], [5.5, 4]]
  }
}
// → { "zoneId": "zone-bed1" }

{
  "name": "set_zone",
  "arguments": {
    "levelId": "level-1",
    "label": "Bedroom 2",
    "polygon": [[5.5, 5.5], [10, 5.5], [10, 8], [5.5, 8]]
  }
}
// → { "zoneId": "zone-bed2" }

{
  "name": "set_zone",
  "arguments": {
    "levelId": "level-1",
    "label": "Bathroom",
    "polygon": [[5.5, 4], [8, 4], [8, 5.5], [5.5, 5.5]]
  }
}
// → { "zoneId": "zone-bath" }
```

### 5. Cut doors and windows

The agent uses `cut_opening` to add entry doors on each interior partition
and windows on the south and east façades:

```jsonc
// tool: cut_opening  (called once per opening)
{
  "name": "cut_opening",
  "arguments": {
    "wallId": "wall-south",       // perimeter wall [0,0] → [10,0]
    "type": "window",
    "position": 0.25,             // 25% along centerline
    "width": 1.2,
    "height": 1.2
  }
}
// → { "openingId": "window-south-1" }
```

```jsonc
{
  "name": "cut_opening",
  "arguments": {
    "wallId": "wall-bed1",        // partition wall to Bedroom 1
    "type": "door",
    "position": 0.4,
    "width": 0.9,
    "height": 2.1
  }
}
// → { "openingId": "door-bed1" }
```

The agent repeats this for Bedroom 2's door, the bathroom door, and two
more windows on the east façade.

### 6. Validate and report

```jsonc
// tool: validate_scene
{ "name": "validate_scene", "arguments": {} }
```

Response:

```jsonc
{ "valid": true, "errors": [] }
```

The agent then reads the scene summary for its response to the user:

```jsonc
// resource: pascal://scene/current/summary
{ "uri": "pascal://scene/current/summary" }
```

The host displays the returned Markdown: 1 site, 1 building, 1 level, 8
walls, 4 zones, 3 doors, 3 windows; usable area ~78 m²; perimeter ~36 m.

### 7. Iterate

The user follows up:

> **User:** Swap the bathroom and bedroom 2 — I want the bathroom near the
> entrance.

The agent loads the `iterate_on_feedback` prompt and issues a single
`apply_patch` that updates the polygon of `zone-bath` and `zone-bed2` and
moves the corresponding partition walls. Because mutation goes through the
Zustand store, the user can `undo` the change if they dislike it:

```jsonc
{ "name": "undo", "arguments": { "steps": 1 } }
// → { "undone": 1 }
```

## Takeaways

- Mutations batch inside a single `apply_patch` so that `undo` rolls back
  the whole logical change.
- Zones are not walls — they're polygon annotations that make later queries
  (`find_nodes({ zoneId })`) and planning steps much easier for the agent.
- The agent never needs to speak to `@pascal-app/viewer`: everything the
  host sees flows through tools + resources + prompts.
