import {
  type AnyNodeId,
  getRoofSegmentWallFaces,
  getScaledDimensions,
  type ItemNode,
  type RoofNode,
  type RoofSegmentNode,
  type RoofSegmentWallFace,
  type RoofWallFaceId,
  sceneRegistry,
  segmentPointToRoofWallFace,
  useScene,
} from '@pascal-app/core'
import * as THREE from 'three'

const worldPoint = new THREE.Vector3()
const worldNormal = new THREE.Vector3()
const localPoint = new THREE.Vector3()
const localNormal = new THREE.Vector3()
const inverseMatrix = new THREE.Matrix4()

export type RoofWallHit = {
  segment: RoofSegmentNode
  face: RoofSegmentWallFace
  /** Face coords of the hit (u along the face, v above the segment base). */
  u: number
  v: number
}

/** Pointer hits more than this far off the wall plane are not wall hits. */
const PLANE_TOLERANCE = 0.06
/** Reject faces whose normal disagrees with the hit normal (slope / soffit). */
const NORMAL_ALIGNMENT = 0.7
/** A wall face is vertical; slope faces on low pitches have |ny| ≫ 0. */
const MAX_NORMAL_Y = 0.4

/**
 * Resolve a pointer hit on a roof to one of its segments' vertical wall
 * faces (base walls under the roof + the coplanar gable/shed/gambrel end
 * faces). Counterpart of `resolveRoofSegmentHit`, which resolves to the
 * sloped top surface instead.
 *
 * `normal` must be the raw `NodeEvent.normal` (hit-object-local) together
 * with the `object` it came from — roof events can originate from the
 * merged-roof mesh (roof-local frame) or a painted segment mesh
 * (segment-local frame), so the normal is normalised through world space
 * here instead of trusting the event frame.
 *
 * Lives in `@pascal-app/editor` because both the kind-owned door/window
 * tools (in `@pascal-app/nodes`, which depends on editor) and the item
 * placement coordinator (in editor itself) consume it.
 */
export function resolveRoofWallHit(
  roof: RoofNode,
  position: [number, number, number],
  normal: [number, number, number] | undefined,
  object: THREE.Object3D | undefined,
): RoofWallHit | null {
  if (!normal || !object) return null

  worldPoint.set(position[0], position[1], position[2])
  worldNormal.set(normal[0], normal[1], normal[2])
  object.updateWorldMatrix(true, false)
  worldNormal.transformDirection(object.matrixWorld)

  const state = useScene.getState()
  let best: { hit: RoofWallHit; score: number } | null = null

  for (const childId of roof.children ?? []) {
    const segment = state.nodes[childId as AnyNodeId] as RoofSegmentNode | undefined
    if (segment?.type !== 'roof-segment') continue
    const segObj = sceneRegistry.nodes.get(segment.id)
    if (!segObj) continue
    segObj.updateWorldMatrix(true, false)

    localPoint.copy(worldPoint)
    segObj.worldToLocal(localPoint)
    inverseMatrix.copy(segObj.matrixWorld).invert()
    localNormal.copy(worldNormal).transformDirection(inverseMatrix)

    if (Math.abs(localNormal.y) > MAX_NORMAL_Y) continue

    for (const face of getRoofSegmentWallFaces(segment)) {
      const alignment =
        localNormal.x * face.normal[0] +
        localNormal.y * face.normal[1] +
        localNormal.z * face.normal[2]
      if (alignment < NORMAL_ALIGNMENT) continue

      const { u, v, dist } = segmentPointToRoofWallFace(segment, face.id, [
        localPoint.x,
        localPoint.y,
        localPoint.z,
      ])
      if (Math.abs(dist) > PLANE_TOLERANCE) continue
      if (u < -PLANE_TOLERANCE || u > face.length + PLANE_TOLERANCE) continue
      if (v < -PLANE_TOLERANCE) continue

      const score = Math.abs(dist)
      if (!best || score < best.score) {
        best = { hit: { segment, face, u, v }, score }
      }
    }
  }

  return best?.hit ?? null
}

/**
 * Overlap guard for nodes sharing a roof-segment wall face — the
 * roof-host analogue of `hasWallChildOverlap`. Hosted children store
 * FACE-LOCAL coords + an explicit `roofFace`, so siblings compare
 * directly: doors/windows are center-anchored in v, wall items
 * bottom-anchored.
 */
export function hasRoofFaceChildOverlap(
  segment: RoofSegmentNode,
  faceId: RoofWallFaceId,
  u: number,
  v: number,
  width: number,
  height: number,
  ignoreId?: string,
): boolean {
  const nodes = useScene.getState().nodes
  const newLeft = u - width / 2
  const newRight = u + width / 2
  const newBottom = v - height / 2
  const newTop = v + height / 2

  for (const childId of segment.children ?? []) {
    if (childId === ignoreId) continue
    const child = nodes[childId as AnyNodeId]
    if (!child) continue
    if ((child as { roofFace?: RoofWallFaceId }).roofFace !== faceId) continue
    const position = (child as { position?: [number, number, number] }).position
    if (!position) continue

    let childW: number
    let childBottom: number
    let childTop: number
    if (child.type === 'door' || child.type === 'window') {
      const opening = child as { width: number; height: number }
      childW = opening.width
      childBottom = position[1] - opening.height / 2
      childTop = position[1] + opening.height / 2
    } else if (child.type === 'item') {
      const item = child as ItemNode
      if (item.asset.attachTo !== 'wall' && item.asset.attachTo !== 'wall-side') continue
      const [w, h] = getScaledDimensions(item)
      childW = w
      // Items anchor position[1] at their bottom edge.
      childBottom = position[1]
      childTop = position[1] + h
    } else {
      continue
    }

    const xOverlap = newLeft < position[0] + childW / 2 && newRight > position[0] - childW / 2
    const yOverlap = newBottom < childTop && newTop > childBottom
    if (xOverlap && yOverlap) return true
  }
  return false
}
