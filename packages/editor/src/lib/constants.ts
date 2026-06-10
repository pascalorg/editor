import { OVERLAY_LAYER } from '@pascal-app/viewer'

/** Three.js layer used for editor-only objects (helpers, grid, polygon editors).
 *  The thumbnail camera renders only layer 0, so these are excluded from thumbnails.
 *  Aliased to viewer's `OVERLAY_LAYER` so the post-processing overlay pass and the
 *  editor's overlay meshes stay on the same layer. */
export const EDITOR_LAYER = OVERLAY_LAYER

/** When false, item place/move wireframes stay green and overlaps are allowed. */
export const ITEM_PLACEMENT_COLLISION_ENABLED = false
