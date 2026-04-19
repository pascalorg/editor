# Renovate an existing flat from photos

This example shows how an agent can combine the `renovation_from_photos`
prompt with the `analyze_floorplan_image` and `analyze_room_photo` vision
tools to propose a renovation plan grounded in real photos.

> **Note:** the vision tools use MCP sampling (`createMessage`), which
> Claude Desktop supports today. Hosts without sampling support will get a
> structured `sampling_unavailable` error; fall back to the text-only
> `from_brief` prompt in that case.

## The brief

The user drops four photos into the chat:

1. A floorplan PDF page (exported as PNG).
2. A photo of the current living room.
3. A photo of the current kitchen.
4. An inspirational photo from a magazine — a minimal Scandinavian loft.

And types:

> **User:** Claude, help me plan a renovation. Here's the current plan and
> two room photos. I want something like this Scandinavian reference —
> open-plan, neutral tones, keep the footprint.

## What the agent does

The host loads the **`renovation_from_photos`** prompt:

```text
currentPhotos: ["data:image/png;base64,...", "data:image/jpeg;base64,..."]
referencePhotos: ["data:image/jpeg;base64,..."]
goals: "Open-plan living/kitchen, neutral tones, keep the footprint."
```

The prompt tells the agent to (1) analyze the floorplan, (2) analyze each
room photo, (3) seed a scene from the floorplan, (4) compare against the
reference, and (5) propose patches.

### 1. Extract the floorplan

```jsonc
// tool: analyze_floorplan_image
{
  "name": "analyze_floorplan_image",
  "arguments": {
    "image": "data:image/png;base64,iVBORw0KGgoAAAANS...",
    "scaleHint": "1 m grid, total footprint ~9.5 m × 7 m"
  }
}
```

Under the hood, the tool issues an MCP sampling request to the host with
the image and a structured prompt asking for walls, rooms, and
approximate dimensions. The response is validated against the tool's
output schema:

```jsonc
{
  "walls": [
    { "start": [0, 0], "end": [9.5, 0], "thickness": 0.25 },
    { "start": [9.5, 0], "end": [9.5, 7], "thickness": 0.25 },
    { "start": [9.5, 7], "end": [0, 7], "thickness": 0.25 },
    { "start": [0, 7], "end": [0, 0], "thickness": 0.25 },
    { "start": [4.5, 0], "end": [4.5, 7], "thickness": 0.15 },
    { "start": [4.5, 3.5], "end": [9.5, 3.5], "thickness": 0.15 }
  ],
  "rooms": [
    { "label": "Living",  "polygon": [[0, 0], [4.5, 0], [4.5, 7], [0, 7]] },
    { "label": "Kitchen", "polygon": [[4.5, 0], [9.5, 0], [9.5, 3.5], [4.5, 3.5]] },
    { "label": "Bedroom", "polygon": [[4.5, 3.5], [9.5, 3.5], [9.5, 7], [4.5, 7]] }
  ],
  "approximateDimensions": { "widthMeters": 9.5, "depthMeters": 7, "areaSqMeters": 66.5 },
  "confidence": 0.82
}
```

### 2. Analyze the room photos

```jsonc
// tool: analyze_room_photo
{
  "name": "analyze_room_photo",
  "arguments": { "image": "data:image/jpeg;base64,/9j/4AAQ..." }
}
```

Response:

```jsonc
{
  "approximateDimensions": { "widthMeters": 4.4, "depthMeters": 5.8, "heightMeters": 2.5 },
  "identifiedFixtures": [
    { "kind": "sofa",         "approximatePosition": [2.2, 3.5] },
    { "kind": "coffee-table", "approximatePosition": [2.2, 2.4] },
    { "kind": "tv-unit",      "approximatePosition": [0.3, 2.0] }
  ],
  "identifiedWindows": [
    { "wallHint": "south", "approximateWidth": 1.4, "approximateHeight": 1.5 }
  ]
}
```

The kitchen photo is analyzed the same way.

### 3. Seed the scene

The agent reads `get_scene`, confirms the default empty Site → Building →
Level is present, and then batch-creates walls matching the floorplan:

```jsonc
// tool: apply_patch
{
  "name": "apply_patch",
  "arguments": {
    "patches": [
      { "op": "create", "parentId": "level-1",
        "node": { "type": "wall", "start": [0, 0], "end": [9.5, 0],
                  "thickness": 0.25, "height": 2.5 } },
      /* ...remaining perimeter + partition walls from the vision result... */
    ]
  }
}
```

The agent then calls `set_zone` three times to seed the Living / Kitchen /
Bedroom polygons from the floorplan rooms.

### 4. Cut the identified openings

For each window the vision tool reported, the agent calls `cut_opening`
against the corresponding perimeter wall:

```jsonc
{
  "name": "cut_opening",
  "arguments": {
    "wallId": "wall-south",
    "type": "window",
    "position": 0.5,
    "width": 1.4,
    "height": 1.5
  }
}
```

### 5. Propose the renovation

Guided by the reference photo's analysis (bright neutrals, open plan,
minimal furnishing), the agent proposes a single logical patch:

- Remove the partition wall between Living and Kitchen.
- Relocate the kitchen island further west.
- Delete the bulky TV unit item; leave the sofa and coffee table.
- Re-label the merged zone `"Open-Plan Living / Kitchen"`.

All of that goes into one `apply_patch`:

```jsonc
{
  "name": "apply_patch",
  "arguments": {
    "patches": [
      { "op": "delete", "id": "wall-partition-living-kitchen", "cascade": false },
      { "op": "update", "id": "zone-living", "data": { "label": "Open-Plan Living / Kitchen",
                                                         "polygon": [[0, 0], [9.5, 0],
                                                                     [9.5, 3.5], [0, 3.5]] } },
      { "op": "delete", "id": "zone-kitchen", "cascade": false }
      /* + item moves / deletes for the TV unit etc. */
    ]
  }
}
```

The user can walk back with `undo`; `redo` returns them to the proposal.

### 6. Sanity-check

```jsonc
// tool: validate_scene
{ "name": "validate_scene", "arguments": {} }
// → { "valid": true, "errors": [] }

// tool: check_collisions
{ "name": "check_collisions", "arguments": { "levelId": "level-1" } }
// → { "collisions": [] }
```

The agent reports a summary of the changes plus the approximate new
usable area (from the summary resource), and the user opens the scene in
`@pascal-app/viewer` to see the renovated 3D layout.

## Takeaways

- The vision tools only return **data**. They don't mutate the scene —
  the agent is explicit about every structural change via `apply_patch`.
- Photos supply priors (approximate dimensions, fixture types) that a
  brief-only workflow can't. Combine them with `from_brief`-style
  prompts when the user has both a reference and concrete text goals.
- All renovation steps are a single temporal step per patch, so the user
  can compare before/after with `undo` / `redo`.
