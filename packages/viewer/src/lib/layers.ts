import { Layers } from 'three'

/** Default Three.js layer for main scene geometry. */
export const SCENE_LAYER = 0

/**
 * Layer for editor-only overlays (gizmos, move handles, tool previews, grid).
 * The post-processing pipeline excludes this layer from the depth/normal MRT
 * scene pass so the screen-space ink and SSGI never treat overlays as geometry,
 * then composites it back on top via a dedicated overlay pass.
 *
 * Editor's `EDITOR_LAYER` (packages/editor) re-exports this — they MUST match.
 */
export const OVERLAY_LAYER = 1

/** Layer used for zone rendering (floor fills and wall borders). */
export const ZONE_LAYER = 2

/**
 * Layer for editor-only visuals that scene geometry must hide: the ground grid
 * and the construction reveal's dust. Rendered *inside* the scene pass (so
 * walls and objects depth-occlude them instead of them bleeding through) —
 * they write no depth, and a transparent one must write alpha 0 to the pass's
 * normal and diffuse attachments (`scenePassMrt`), or the screen-space ink
 * reads its whole quad as an edge. Kept off OVERLAY_LAYER because overlays
 * composite on top with no scene-depth test.
 * Excluded from thumbnails like the other editor-only layers.
 */
export const GRID_LAYER = 3

/**
 * Layer for geometry hidden from the color passes but still rendered into the
 * shadow map ("shadow-caster-only"). Used when cutaway/solo views hide roofs
 * or non-selected levels: the sun keeps casting their shadows, so interiors
 * get window-shaped light patches instead of flooding with uniform sun.
 * No camera or pass enables this layer — only each shadow-casting light's
 * shadow camera does (see `lights.tsx`). Applied per-object (layers don't
 * cascade) via `applyShadowOnly` / `clearShadowOnly` in `lib/shadow-only.ts`.
 */
export const SHADOW_ONLY_LAYER = 4

/**
 * Layer for source geometry that a collective batch already draws. No camera
 * or pass enables it, so a batched object costs no draw call while its children
 * and interaction proxies remain in the graph.
 *
 * Raycasters that query real surfaces must opt in via
 * {@link setSurfaceRaycastLayers}, otherwise a sewn wall would stop answering
 * measurement rays.
 */
export const BATCHED_LAYER = 5

/** What the post-processing scene pass draws: the scene geometry, and the grid layer it depth-tests. */
export function scenePassLayers(): Layers {
  const layers = new Layers()
  layers.set(SCENE_LAYER)
  layers.enable(GRID_LAYER)
  return layers
}

/**
 * Aims a raycaster at every real scene surface, whether a wall still draws
 * itself or a level batch draws it for us.
 */
export function setSurfaceRaycastLayers(layers: Layers): void {
  layers.set(SCENE_LAYER)
  layers.enable(BATCHED_LAYER)
}
