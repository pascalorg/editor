import {
  type AnyNodeId,
  getRoofSegmentSurfaceY,
  type RoofNode,
  type RoofSegmentNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import * as THREE from 'three'

const worldPoint = new THREE.Vector3()
const localPoint = new THREE.Vector3()

export type RoofSegmentHit = {
  segment: RoofSegmentNode
  localX: number
  localY: number
  localZ: number
}

/**
 * Resolve which roof-segment the user clicked. Used by every placement
 * tool that drops a new node onto a roof (box-vent, ridge-vent,
 * chimney, solar-panel, skylight, dormer).
 *
 * The hip/gable case puts every slope at the same roof origin and
 * differs them only by `rotation-y`. After `worldToLocal`, the hit
 * point's (x, z) lies inside *every* segment's axis-aligned half-
 * extents, so a naive first-match returns the wrong slope (typically
 * segments[0]). We instead score each candidate by
 * `|localY − getRoofSegmentSurfaceY(localX, localZ)|` and pick the
 * smallest — the slope the user actually clicked is the one whose
 * sloped surface passes through the hit point.
 *
 *  - Overhang is included in the bbox filter because the visible
 *    merged-roof mesh extends past `width/2` by the overhang on each
 *    side; without it, clicks on the eave bands produced `null`.
 *
 *  - Fallback: if no segment passes the bbox filter (clicked beyond
 *    every outer overhang, or registry is stale), return the first
 *    segment with the click projected into its frame — matches the
 *    legacy "always commit somewhere" behaviour.
 *
 * Returns null only if the roof has zero registered segments.
 */
export function resolveRoofSegmentHit(
  roof: RoofNode,
  wx: number,
  wy: number,
  wz: number,
): RoofSegmentHit | null {
  worldPoint.set(wx, wy, wz)
  const state = useScene.getState()
  let firstSegment: { seg: RoofSegmentNode; segObj: THREE.Object3D } | null = null
  let best: { hit: RoofSegmentHit; score: number } | null = null

  for (const childId of roof.children ?? []) {
    const seg = state.nodes[childId as AnyNodeId] as RoofSegmentNode | undefined
    if (seg?.type !== 'roof-segment') continue
    const segObj = sceneRegistry.nodes.get(seg.id)
    if (!segObj) continue
    segObj.updateWorldMatrix(true, false)
    const local = segObj.worldToLocal(localPoint.copy(worldPoint))

    if (!firstSegment) firstSegment = { seg, segObj }

    const overhang = seg.overhang ?? 0
    const halfW = seg.width / 2 + overhang
    const halfD = seg.depth / 2 + overhang
    if (Math.abs(local.x) <= halfW && Math.abs(local.z) <= halfD) {
      const surfaceY = getRoofSegmentSurfaceY(seg, local.x, local.z)
      const score = Math.abs(local.y - surfaceY)
      if (!best || score < best.score) {
        best = {
          hit: { segment: seg, localX: local.x, localY: local.y, localZ: local.z },
          score,
        }
      }
    }
  }

  if (best) return best.hit

  if (firstSegment) {
    const local = firstSegment.segObj.worldToLocal(localPoint.copy(worldPoint))
    return {
      segment: firstSegment.seg,
      localX: local.x,
      localY: local.y,
      localZ: local.z,
    }
  }
  return null
}
