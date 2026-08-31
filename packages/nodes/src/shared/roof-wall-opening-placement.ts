import {
  type AnyNodeId,
  clampRectToRoofWallFace,
  type RoofEvent,
  type RoofNode,
  type RoofSegmentNode,
  type RoofSegmentWallFace,
  roofFacePointToSegment,
  sceneRegistry,
} from '@pascal-app/core'
import { hasRoofFaceChildOverlap, resolveRoofWallHit } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Vector3 } from 'three'

/**
 * Stateless target/cursor math shared by the door and window placement
 * + move tools' roof flows. The tools keep ownership of everything
 * stateful (draft lifecycle, undo/temporal sequencing, commit field
 * lists, SFX/selection) — only the settled geometry lives here.
 */

export type RoofWallOpeningTarget = {
  segment: RoofSegmentNode
  face: RoofSegmentWallFace
  /** FACE-LOCAL stored position: [u, v-center, 0] on the wall mid-plane. */
  position: [number, number, number]
  /** False when the rect overlaps a sibling on the same face. */
  valid: boolean
}

export type RoofWallOpeningVertical =
  /** Doors: bottom on the segment base, only `u` slides. */
  | { kind: 'bottom-locked' }
  /** Windows: free height, optionally grid-snapped before the clamp. */
  | { kind: 'free'; snap?: (v: number) => number }

/**
 * Resolve a roof pointer event to an opening placement on a segment
 * wall face: hit → vertical policy → profile clamp → overlap check.
 * Null when the pointer isn't over a placeable face or the rect cannot
 * fit at that spot.
 */
export function resolveRoofWallOpeningTarget(args: {
  event: RoofEvent
  width: number
  height: number
  ignoreId?: string
  vertical: RoofWallOpeningVertical
}): RoofWallOpeningTarget | null {
  const { event, width, height, ignoreId, vertical } = args
  const hit = resolveRoofWallHit(event.node as RoofNode, event.position, event.normal, event.object)
  if (!hit) return null

  const centerV = vertical.kind === 'bottom-locked' ? height / 2 : (vertical.snap?.(hit.v) ?? hit.v)
  const clamped = clampRectToRoofWallFace(
    hit.face,
    hit.u,
    centerV,
    width,
    height,
    vertical.kind === 'bottom-locked' ? { lockV: true } : undefined,
  )
  if (!clamped) return null

  const valid = !hasRoofFaceChildOverlap(
    hit.segment,
    hit.face.id,
    clamped.u,
    clamped.v,
    width,
    height,
    ignoreId,
  )
  return {
    segment: hit.segment,
    face: hit.face,
    position: [clamped.u, clamped.v, 0],
    valid,
  }
}

const cursorPoint = new Vector3()

/**
 * World → building-local. Tool cursor groups render inside the
 * building's frame (same conversion as the roof accessory tools).
 */
export function worldToSelectedBuildingLocal(point: Vector3): [number, number, number] {
  const buildingId = useViewer.getState().selection.buildingId
  const buildingObj = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : undefined
  if (buildingObj) {
    buildingObj.updateWorldMatrix(true, false)
    buildingObj.worldToLocal(point)
  }
  return [point.x, point.y, point.z]
}

/**
 * Cursor pose for a resolved target: building-local position of the
 * opening center + total yaw (roof ∘ segment ∘ face).
 */
export function getRoofWallOpeningCursorPose(
  target: RoofWallOpeningTarget,
  roof: RoofNode,
): { position: [number, number, number]; rotationY: number } | null {
  const segObj = sceneRegistry.nodes.get(target.segment.id as AnyNodeId)
  if (!segObj) return null
  segObj.updateWorldMatrix(true, false)
  const segLocal = roofFacePointToSegment(target.segment, target.face.id, target.position)
  cursorPoint.set(segLocal[0], segLocal[1], segLocal[2])
  segObj.localToWorld(cursorPoint)
  return {
    position: worldToSelectedBuildingLocal(cursorPoint),
    rotationY: (roof.rotation ?? 0) + (target.segment.rotation ?? 0) + target.face.yaw,
  }
}
