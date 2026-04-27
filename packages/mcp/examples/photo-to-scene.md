# Floor-plan photo to Pascal scene

The `photo_to_scene` orchestrator takes a single floor-plan photo and
returns a saved, navigable Pascal scene. It chains vision (via MCP
sampling) → scene build → save in one call, so an agent doesn't have to
stitch three tools together manually.

> **Note:** `photo_to_scene` uses MCP sampling to call the host's model.
> Hosts that do not advertise `sampling` capability will receive a
> structured `sampling_unavailable` error; fall back to the text-only
> `from_brief` prompt in that case.

## The brief

A user drops a photo of a hand-drawn floor plan into the chat and types:

> **User:** here's a floor plan photo, turn it into a Pascal scene.

## The tool call

The agent reads the attachment as a data URI and issues a single tool call:

```jsonc
// tool: photo_to_scene
{
  "name": "photo_to_scene",
  "arguments": {
    "image": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD...",
    "scaleHint": "1 cm = 1 m, approx 20 m²",
    "name": "Weekend flat"
  }
}
```

Optional knobs:

- `save` (default `true`) — if `false`, the response includes `graph`
  inline instead of persisting to the `SceneStore`.
- `defaultWallThickness` (default `0.2` m) — used when the vision model
  doesn't propose a per-wall thickness.
- `defaultWallHeight` (default `2.6` m) — applied to every generated wall
  since the vision schema only captures 2D geometry.

## What happens under the hood

1. The orchestrator issues an MCP sampling request to the host with the
   image and a structured JSON-only system prompt, mirroring
   `analyze_floorplan_image`. The host's model returns walls, rooms, and
   approximate dimensions as JSON.
2. The reply is validated against a strict Zod schema. Unparseable or
   schema-failing responses surface as `sampling_response_unparseable` /
   `sampling_response_invalid` MCP errors.
3. A fresh `SceneGraph` is built using the core schema factories: a
   `site` → `building` → `level 0` skeleton, then one `WallNode` per
   vision wall and one `ZoneNode` per vision room. Each node is
   re-parsed with `AnyNode.safeParse`; invalid ones are dropped with a
   warning appended to `notes`.
4. `bridge.setScene(...)` swaps the live scene so any follow-up MCP call
   (`find_nodes`, `measure`, `apply_patch`, ...) operates on the new
   geometry.
5. If `save: true`, the graph is persisted via `SceneStore.save` and the
   response carries `sceneId` + `url: /scene/<id>`.

## The response

```jsonc
{
  "sceneId": "scene_01hx8a...",
  "url": "/scene/scene_01hx8a...",
  "walls": 4,
  "rooms": 1,
  "confidence": 0.82
}
```

When `save: false` instead:

```jsonc
{
  "walls": 4,
  "rooms": 1,
  "confidence": 0.82,
  "graph": {
    "nodes": { /* flat id → node dict */ },
    "rootNodeIds": ["site_..."],
    "collections": {}
  }
}
```

If any wall or room failed schema validation, the response includes a
`notes` string summarising what was dropped.

## Opening the scene

The user follows `url` in their browser:

```
https://your-pascal-host/scene/scene_01hx8a...
```

...and lands in the editor with the new scene loaded, camera auto-framed
on the building footprint.

## Follow-up prompts

Because the bridge now holds the new scene, subsequent agent turns can
operate on it without reloading:

> **User:** add a door on the south wall between Living and Kitchen.

The agent calls `find_nodes({ type: "wall" })`, picks the appropriate
wall, and issues `cut_opening` — no extra wiring needed.

## Takeaways

- `photo_to_scene` is a one-shot primitive: one call, one scene.
- Vision confidence is surfaced so the agent can warn the user.
- v0.1 covers walls + zones; doors, windows, items are follow-up tools.
