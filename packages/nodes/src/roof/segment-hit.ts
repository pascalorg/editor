import {
  type AnyNodeId,
  type RoofNode,
  type RoofSegmentNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import * as THREE from 'three'

const worldPoint = new THREE.Vector3()

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
 * The resolution is two-pass and forgiving:
 *
 *  1. Exact pass — iterate the roof's children, transform the world
 *     click point into each segment's local frame, and accept the
 *     first whose local (x, z) lies inside `[width/2 + overhang,
 *     depth/2 + overhang]`. The overhang inclusion matters because
 *     the visible merged-roof mesh extends past `width/2` by the
 *     overhang on each side; without it, clicks on the eave bands
 *     produced `null` and silently no-op'd the placement (the bug
 *     this helper fixes).
 *
 *  2. Fallback pass — if no segment passed the exact test (the user
 *     clicked beyond every segment's outer overhang, OR the segment
 *     bounds are stale), return the FIRST segment with the click
 *     point projected into its local frame. This matches the legacy
 *     `roof-panel.tsx`'s "use segments[0]" fallback so add operations
 *     always commit somewhere. The user can move the placed node
 *     afterward via the standard move tool.
 *
 * Returns null only if the roof has zero registered segments —
 * effectively "no roof to drop onto."
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

  for (const childId of roof.children ?? []) {
    const seg = state.nodes[childId as AnyNodeId] as RoofSegmentNode | undefined
    if (seg?.type !== 'roof-segment') continue
    const segObj = sceneRegistry.nodes.get(seg.id)
    if (!segObj) continue
    segObj.updateWorldMatrix(true, false)
    const local = segObj.worldToLocal(worldPoint.clone())

    if (!firstSegment) firstSegment = { seg, segObj }

    const overhang = seg.overhang ?? 0
    const halfW = seg.width / 2 + overhang
    const halfD = seg.depth / 2 + overhang
    if (Math.abs(local.x) <= halfW && Math.abs(local.z) <= halfD) {
      return { segment: seg, localX: local.x, localY: local.y, localZ: local.z }
    }
  }

  if (firstSegment) {
    const local = firstSegment.segObj.worldToLocal(worldPoint.clone())
    return {
      segment: firstSegment.seg,
      localX: local.x,
      localY: local.y,
      localZ: local.z,
    }
  }
  return null
}
