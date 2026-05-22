# Three.js Layers

*Three.js layer conventions — which layer each object type lives on and why.*

Applies to: `packages/viewer/**`, `apps/editor/**`.

Three.js `Layers` control which objects each camera and render pass sees. We use them to separate scene geometry, editor helpers, and zone overlays into distinct rendering buckets without duplicating scene structure.

## Layer Map

| Constant | Value | Package | Purpose |
|---|---|---|---|
| `SCENE_LAYER` | `0` | `@pascal-app/viewer` | Default Three.js layer — all regular scene geometry |
| `OVERLAY_LAYER` | `1` | `@pascal-app/viewer` | Editor overlays: gizmos, move handles, tool previews, cursor meshes, snap guides. Composited on top in its own pass. |
| `ZONE_LAYER` | `2` | `@pascal-app/viewer` | Zone floor fills and wall borders — composited in a separate post-processing pass |
| `GRID_LAYER` | `3` | `@pascal-app/viewer` | The editor ground grid — rendered *in* the scene pass for correct depth occlusion |

`apps/editor` exposes `EDITOR_LAYER` for editor-helper meshes; it **re-exports** `OVERLAY_LAYER` (`EDITOR_LAYER === OVERLAY_LAYER`) so the editor stays decoupled from the viewer's pass numbering while landing on the same layer.

```ts
// In viewer code
import { SCENE_LAYER, OVERLAY_LAYER, ZONE_LAYER, GRID_LAYER } from '@pascal-app/viewer'

// In editor code (alias of OVERLAY_LAYER)
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

## Why Separate Overlays onto Layer 1 (`OVERLAY_LAYER`)

Gizmos, move handles, and tool previews must read as crisp UI — never inked by the screen-space edge pass or darkened by SSGI/AO. The scene pass renders only `SCENE_LAYER` (+ `GRID_LAYER`, below), so overlays stay out of its depth/normal MRT. A dedicated `overlayPass` then renders just `OVERLAY_LAYER` and is composited on top after the ink + selection outlines:

```ts
const overlayPass = pass(scene, camera)
overlayPass.setLayers(overlayLayers) // only OVERLAY_LAYER
// …composited last, depth-gated against the scene depth so overlays that
// write depth are still occluded by geometry in front of them.
```

The editor camera enables `OVERLAY_LAYER`; the thumbnail generator disables it so exports are clean.

## Why the Grid is on its own Layer 3 (`GRID_LAYER`)

The ground grid is a flat, depth-non-writing plane that must be **occluded by walls/objects** — which only works if it shares the scene's depth buffer. So unlike other overlays it is rendered *inside* the scene pass (`scenePass` enables `SCENE_LAYER` + `GRID_LAYER`), not the overlay pass. Being flat, it never triggers the screen-space ink. The thumbnail camera disables `GRID_LAYER` too, so it stays out of exports.

## Rules

- **Never hardcode layer numbers.** Always use the named constants.
- **All four layer constants belong in `@pascal-app/viewer`** — they are renderer concerns. `apps/editor`'s `EDITOR_LAYER` is an alias re-export of `OVERLAY_LAYER`.
- **Zone meshes must set `layers={ZONE_LAYER}`** so they are picked up by `zonePass` and excluded from `scenePass` depth buffers.
- **Overlay/helper meshes must set `layers={EDITOR_LAYER}`** (= `OVERLAY_LAYER`) so they render on top, stay out of the ink/SSGI buffers, and are invisible to the thumbnail camera.
- **The grid uses `GRID_LAYER`**, not the overlay layer, because it needs scene-depth occlusion.
- **Do not add new layers without updating this page** and the post-processing pipeline accordingly.
