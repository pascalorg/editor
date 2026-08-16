import {
  remapSetbacksForVertexInsert,
  remapSetbacksForVertexRemove,
  type SiteNode,
} from '@pascal-app/core'
import type { PolygonStructuralEdit } from '../components/tools/shared/polygon-editor'
import type { Mode, Phase } from '../store/use-editor'

export const SITE_BOUNDARY_DRAG_LABEL = 'site-boundary'

/**
 * Whether the site's vertex/midpoint handles are grabbable right now.
 *
 * Shared by the 3D boundary editor (`tool-manager.tsx`) and the floorplan's SVG
 * handles (`floorplan-panel.tsx`) because they must agree, and until this existed
 * they did not: each derived the rule from `phase`/`mode` locally, and the sculpt
 * clause was added to only one of them.
 *
 * The disagreement was reachable in exactly one configuration, which is why it was
 * easy to miss: arming sculpt from the 2D view promotes `viewMode` to `split` *and*
 * the phase to `site`, so the floorplan's `phase === 'site'` term went true at the
 * same moment the 3D editor's `!sculpting` term went false — handles gone in one
 * pane, live in the other. Grabbing one then calls `begin({kind: 'handle-drag'})`,
 * which atomically replaces the held `sculpting` scope: the brush stays armed and
 * still paints, while the rest of the editor believes a boundary drag is running.
 *
 * Sculpt is excluded rather than merely deprioritised because the flags sit *on* the
 * ground the brush is aimed at — leaving them mounted puts a grabbable handle under
 * every dab near the lot line, in either view.
 */
export function siteBoundaryHandlesEnabled(args: { mode: Mode; phase: Phase }): boolean {
  if (args.mode === 'terrain-sculpt') return false
  return args.phase === 'site' || args.mode === 'select'
}

/**
 * The setback record re-keyed for a ring that just gained or lost a vertex.
 *
 * Returns `null` when nothing needs to move, so a caller can leave `setbacks`
 * out of its patch entirely — the polygon and the rules then travel in one
 * `updateNode`, which is what keeps the edit a single undo step.
 *
 * Shared by the 3D boundary editor and the floorplan for the same reason
 * `siteBoundaryHandlesEnabled` is: the two must agree, and until something is
 * shared they drift.
 */
export function setbacksAfterPolygonEdit(
  setbacks: SiteNode['setbacks'] | undefined,
  edit: PolygonStructuralEdit | undefined,
): SiteNode['setbacks'] | null {
  if (!edit || !setbacks || Object.keys(setbacks).length === 0) return null
  return edit.kind === 'insert'
    ? remapSetbacksForVertexInsert(setbacks, edit.edgeIndex)
    : remapSetbacksForVertexRemove(setbacks, edit.vertexIndex, edit.pointCount)
}
