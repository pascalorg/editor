# Architecture

Canonical rules for code that touches `packages/core`, `packages/viewer`, `packages/editor`, `packages/mcp`, or `apps/editor`. Read on demand from `AGENTS.md` and from `.agents/skills/review-architecture/SKILL.md`.

## Pages

| Page | Covers |
|---|---|
| [layers](layers.md) | Three.js layer constants, ownership, and rendering separation |
| [systems](systems.md) | Core and viewer systems architecture |
| [renderers](renderers.md) | Node renderer pattern in `packages/viewer` |
| [node-definitions](node-definitions.md) | Three-checkbox composition model for registry-driven kinds (`geometry` / `renderer` / `system`) |
| [materials-and-themes](materials-and-themes.md) | Surface colour: surface roles, colour presets, the textures axis, and scene themes (appearance / ground / clay tints) |
| [item-authoring](item-authoring.md) | Content-author contract for catalog item GLBs: `slot_` material naming, authored defaults + `pascal_material` extras, the `cutout` reserved mesh, UV world scale, and the validated Blender/export recipe |
| [plugin-authoring](plugin-authoring.md) | Public contract for external plugins — `Plugin` shape, `setPluginDiscovery`, lifecycle, what's in and out of v1 |
| [tools](tools.md) | Editor tools structure, 2D↔3D behavioral parity, manipulation constraints, and Shift bypass defaults |
| [interaction-scope](interaction-scope.md) | The authoritative interaction state machine ("the spine"): `InteractionScope` union, the begin/update/end/endIf contract, the raycast hot-set, and the overlay scope matrix |
| [viewer-isolation](viewer-isolation.md) | Keeping `@pascal-app/viewer` editor-agnostic |
| [selection-managers](selection-managers.md) | Two-layer selection (viewer + editor), events, outliner |
| [scene-registry](scene-registry.md) | Global node ID → Object3D map and `useRegistry` |
| [spatial-queries](spatial-queries.md) | Placement validation (`canPlaceOnFloor`/`Wall`/`Ceiling`) for tools |
| [node-schemas](node-schemas.md) | Zod schema pattern for node types, `createNode`, `updateNode` |
| [events](events.md) | Typed event bus — emitting and listening to node and grid events |
| [creating-rules](creating-rules.md) | How to add or update a page in this folder |

## Reading order for an architecture review

1. [layers](layers.md), [systems](systems.md), [renderers](renderers.md), [tools](tools.md), [viewer-isolation](viewer-isolation.md) — required every review.
   - When the diff touches placement / move / handle / reshape / box-select / paint or any overlay or picking behaviour, also read [interaction-scope](interaction-scope.md).
2. The remaining pages on demand, based on what the diff touches.
