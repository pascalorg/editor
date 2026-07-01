import {
  type AlignmentAnchor,
  type AlignmentGuide,
  collectAlignmentAnchors,
  useScene,
} from '@pascal-app/core'
import useAlignmentGuides from '../../store/use-alignment-guides'
import { resolveAlignmentForFloorplanView } from '../world-grid-snap'

/**
 * Fixed Figma-style alignment threshold (meters) for floor-plan placement /
 * move — parity with the 3D tools' `ALIGNMENT_THRESHOLD_M`. Pure-2D drafting
 * can pass a zoom-scaled `threshold` instead so the magnetic pull stays
 * constant in screen pixels across zoom levels.
 */
export const FLOORPLAN_ALIGNMENT_THRESHOLD_M = 0.08

export type FloorplanAlignmentResult = {
  /** Plan point with the alignment snap delta applied (grid snap should
   *  already be baked into the input point). */
  point: [number, number]
  snapped: boolean
  guides: AlignmentGuide[]
}

/**
 * Layer Figma-style alignment on top of an already grid-snapped plan point,
 * shared by the 2D move sessions (`*FloorplanMoveTarget`) and the structural
 * drafting branches in `floorplan-panel`.
 *
 * Publishes guides to the `useAlignmentGuides` store as a side effect — set
 * on a match, cleared otherwise — so the mounted `FloorplanAlignmentGuideLayer`
 * renders them. Returns the adjusted point. When `bypass` is true (Alt for
 * alignment-only bypass, or Shift for the full guided-constraint bypass) the
 * point is returned unchanged and guides are cleared.
 *
 * `candidates` should be gathered ONCE per drag (`collectAlignmentAnchors`);
 * the scene is stable during a single drag, so re-collecting per pointer-move
 * is wasted work.
 */
export function applyFloorplanAlignment(
  point: readonly [number, number],
  movingAnchors: AlignmentAnchor[],
  candidates: AlignmentAnchor[],
  opts?: { applySnap?: boolean; bypass?: boolean; threshold?: number },
): FloorplanAlignmentResult {
  if (opts?.bypass) {
    useAlignmentGuides.getState().clear()
    return { point: [point[0], point[1]], snapped: false, guides: [] }
  }

  const result = resolveAlignmentForFloorplanView({
    moving: movingAnchors,
    candidates,
    threshold: opts?.threshold ?? FLOORPLAN_ALIGNMENT_THRESHOLD_M,
  })

  useAlignmentGuides.getState().set(result.guides)

  if (!result.snap || opts?.applySnap === false) {
    return { point: [point[0], point[1]], snapped: false, guides: result.guides }
  }
  return {
    point: [point[0] + result.snap.dx, point[1] + result.snap.dz],
    snapped: true,
    guides: result.guides,
  }
}

/** Synthetic node id for the in-progress structural-draft vertex. Never
 *  collides with a real scene node, so `collectAlignmentAnchors` excludes
 *  nothing real. */
export const FLOORPLAN_DRAFT_ALIGN_ID = '__floorplan_draft__'

/**
 * Align a single grid-snapped structural-draft vertex (wall / fence / polygon
 * / roof endpoint) against every other node's anchors (incl. wall faces from
 * the wall-face anchor work). Treats the vertex as one corner anchor, gathers
 * candidates from the live scene, publishes guides (cleared on `bypass`), and
 * returns the possibly-snapped point.
 *
 * Used by BOTH the move-preview branch and the click-commit handler so the
 * committed vertex lands exactly where the preview showed it. Caller owns the
 * per-kind precedence: existing-wall endpoint/join snap can still win, while
 * angle-locked segments can pass `applySnap: false` to publish passive guide
 * feedback without pulling the endpoint off its constrained ray.
 *
 * `excludeIds` drops those nodes' anchors from the candidate pool — used when
 * dragging a wall / fence endpoint so the moving endpoint doesn't try to
 * align to its own (and its linked siblings') geometry that moves with it.
 */
export function alignFloorplanDraftPoint(
  point: readonly [number, number],
  opts?: {
    applySnap?: boolean
    bypass?: boolean
    threshold?: number
    excludeIds?: readonly string[]
  },
): [number, number] {
  if (opts?.bypass) {
    useAlignmentGuides.getState().clear()
    return [point[0], point[1]]
  }
  let candidates = collectAlignmentAnchors(useScene.getState().nodes, FLOORPLAN_DRAFT_ALIGN_ID)
  if (opts?.excludeIds?.length) {
    const excluded = new Set(opts.excludeIds)
    candidates = candidates.filter((anchor) => !excluded.has(anchor.nodeId))
  }
  const { point: snapped } = applyFloorplanAlignment(
    point,
    [{ nodeId: FLOORPLAN_DRAFT_ALIGN_ID, kind: 'corner', x: point[0], z: point[1] }],
    candidates,
    { applySnap: opts?.applySnap, threshold: opts?.threshold },
  )
  return snapped
}
