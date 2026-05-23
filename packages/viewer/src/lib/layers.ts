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
 * Layer for the editor ground grid. Rendered *inside* the scene pass (so scene
 * geometry depth-occludes it instead of it bleeding through walls/objects) — it
 * is a flat, depth-non-writing plane, so the screen-space ink never picks it up.
 * Kept off OVERLAY_LAYER because overlays composite on top with no scene-depth
 * test, which is exactly what we don't want for a full-floor plane. Excluded
 * from thumbnails like the other editor-only layers.
 */
export const GRID_LAYER = 3
