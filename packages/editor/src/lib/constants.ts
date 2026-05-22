import { OVERLAY_LAYER } from '@pascal-app/viewer'

/** Three.js layer used for editor-only objects (helpers, grid, polygon editors).
 *  The thumbnail camera renders only layer 0, so these are excluded from thumbnails.
 *  Aliased to viewer's `OVERLAY_LAYER` so the post-processing overlay pass and the
 *  editor's overlay meshes stay on the same layer. */
export const EDITOR_LAYER = OVERLAY_LAYER
