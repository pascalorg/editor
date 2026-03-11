---
description: Three.js layer conventions — which layer each object type lives on and why
globs: packages/viewer/**,apps/editor/**
alwaysApply: false
---

# Three.js Layers

Three.js `Layers` control which objects each camera and render pass sees. We use them to separate scene geometry, editor helpers, and zone overlays into distinct rendering buckets without duplicating scene structure.

## Layer Map

| Constant | Value | Package | Purpose |
|---|---|---|---|
| `SCENE_LAYER` | `0` | `@pascal-app/viewer` | Default Three.js layer — all regular scene geometry |
| `EDITOR_LAYER` | `1` | `apps/editor` | Editor-only helpers: grid, tool previews, cursor meshes, snap guides |
| `ZONE_LAYER` | `2` | `@pascal-app/viewer` | Zone floor fills and wall borders — composited in a separate post-processing pass |

Import the constants from their owning packages:

```ts
// In viewer code
import { SCENE_LAYER, ZONE_LAYER } from '@pascal-app/viewer'

// In editor code
import { EDITOR_LAYER } from '@/lib/constants'
```

## Why Separate Zones onto Layer 2

Zones use semi-transparent, `depthTest: false` materials that must be composited *on top of* the scene without being fed into SSGI or TRAA. The post-processing pipeline in `post-processing.tsx` renders a dedicated `zonePass` with a `Layers` mask that enables only `ZONE_LAYER` (and disables `SCENE_LAYER`), then blends its output into the final composite manually:

```ts
const zoneLayers = useMemo(() => {
  const l = new Layers()
  l.enable(ZONE_LAYER)
  l.disable(SCENE_LAYER)
  return l
}, [])

zonePass.setLayers(zoneLayers)
```

This keeps zones out of the SSGI depth/normal buffers (which would produce incorrect AO on transparent surfaces) while still letting them appear correctly over the scene.

## Why Separate Editor Helpers onto Layer 1

The editor camera enables `EDITOR_LAYER` so tools and helpers are visible during editing. The thumbnail generator disables `EDITOR_LAYER` so exports show clean geometry without snap lines or cursor spheres.

## Rules

- **Never hardcode layer numbers.** Always use the named constants.
- **`SCENE_LAYER` and `ZONE_LAYER` belong in `@pascal-app/viewer`** — they are renderer concerns, not editor concerns.
- **`EDITOR_LAYER` belongs in `apps/editor`** — the viewer must never import it; editor behaviour is injected via props/children.
- **Zone meshes must set `layers={ZONE_LAYER}`** so they are picked up by `zonePass` and excluded from `scenePass` depth buffers.
- **Editor helper meshes must set `layers={EDITOR_LAYER}`** so they are invisible to the thumbnail camera and the viewer's render passes.
- **Do not add new layers without updating this rule** and the post-processing pipeline accordingly.
