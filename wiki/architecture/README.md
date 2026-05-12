# Architecture

Canonical rules for code that touches `packages/core`, `packages/viewer`, `packages/editor`, `packages/mcp`, or `apps/editor`. Read on demand from `AGENTS.md` and from `.agents/skills/review-architecture/SKILL.md`.

## Pages

| Page | Covers |
|---|---|
| [layers](layers.md) | Three.js layer constants, ownership, and rendering separation |
| [systems](systems.md) | Core and viewer systems architecture |
| [renderers](renderers.md) | Node renderer pattern in `packages/viewer` |
| [tools](tools.md) | Editor tools structure in `apps/editor` |
| [viewer-isolation](viewer-isolation.md) | Keeping `@pascal-app/viewer` editor-agnostic |
| [selection-managers](selection-managers.md) | Two-layer selection (viewer + editor), events, outliner |
| [scene-registry](scene-registry.md) | Global node ID → Object3D map and `useRegistry` |
| [spatial-queries](spatial-queries.md) | Placement validation (`canPlaceOnFloor`/`Wall`/`Ceiling`) for tools |
| [node-schemas](node-schemas.md) | Zod schema pattern for node types, `createNode`, `updateNode` |
| [events](events.md) | Typed event bus — emitting and listening to node and grid events |
| [creating-rules](creating-rules.md) | How to add or update a page in this folder |

## Reading order for an architecture review

1. [layers](layers.md), [systems](systems.md), [renderers](renderers.md), [tools](tools.md), [viewer-isolation](viewer-isolation.md) — required every review.
2. The remaining pages on demand, based on what the diff touches.
