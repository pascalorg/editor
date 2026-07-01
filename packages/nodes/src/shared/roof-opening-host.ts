import type {
  AnyNode,
  AnyNodeId,
  RoofNode,
  RoofSegmentNode,
  RoofWallFaceId,
} from '@pascal-app/core'
import {
  getMaxRoofRectHeightFromAnchor,
  getMaxRoofRectWidthFromAnchor,
  getRoofSegmentWallFace,
  roofFacePointToSegment,
} from '@pascal-app/core'

/**
 * Host-side helpers for openings (door / window) hosted on a roof-segment
 * wall face: resize-handle limits derived from the face profile, and the
 * plan-space anchors the 2D floor-plan move path needs. Hosted children
 * store FACE-LOCAL coords ([u, v, z-from-mid-plane]) + `roofFace`.
 */

type RoofHostedOpening = {
  roofSegmentId?: string
  roofFace?: RoofWallFaceId
  parentId: string | null
  position: [number, number, number]
  width: number
  height: number
}

type SceneReader = { get: (id: AnyNodeId) => unknown }

function resolveHostFace(node: RoofHostedOpening, scene: SceneReader) {
  if (!(node.roofSegmentId && node.roofFace)) return null
  const segment = scene.get(node.roofSegmentId as AnyNodeId) as RoofSegmentNode | undefined
  if (segment?.type !== 'roof-segment') return null
  return { segment, face: getRoofSegmentWallFace(segment, node.roofFace) }
}

/**
 * Resize-handle width limit for a roof-hosted opening: the opposite edge
 * is anchored, `growSign` (+1 = door-local +X arrow) is the direction
 * the dragged edge moves. Null when the node is not roof-hosted.
 */
export function readRoofFaceWidthMax(
  node: RoofHostedOpening,
  scene: SceneReader,
  growSign: number,
): number | null {
  const host = resolveHostFace(node, scene)
  if (!host) return null
  const anchorU = node.position[0] - (growSign * node.width) / 2
  return getMaxRoofRectWidthFromAnchor(host.face, anchorU, growSign, node.position[1], node.height)
}

/**
 * Resize-handle height limit for a roof-hosted opening. `growSign` +1 =
 * bottom edge anchored, top grows up; -1 = top anchored, bottom grows
 * down. Null when the node is not roof-hosted.
 */
export function readRoofFaceHeightMax(
  node: RoofHostedOpening,
  scene: SceneReader,
  growSign: number,
): number | null {
  const host = resolveHostFace(node, scene)
  if (!host) return null
  const anchorV = node.position[1] - (growSign * node.height) / 2
  return getMaxRoofRectHeightFromAnchor(host.face, node.position[0], node.width, anchorV, growSign)
}

/**
 * Level hosting a roof-hosted opening's roof (opening → segment → roof →
 * level). Null when the parent chain isn't roof-shaped.
 */
export function getRoofHostedOpeningLevelId(
  node: { parentId: string | null },
  nodes: Record<string, AnyNode | undefined>,
): AnyNodeId | null {
  const segment = node.parentId ? nodes[node.parentId] : undefined
  if (segment?.type !== 'roof-segment') return null
  const roof = segment.parentId ? nodes[segment.parentId] : undefined
  if (roof?.type !== 'roof') return null
  return (roof.parentId as AnyNodeId | null) ?? null
}

/**
 * The level that owns the wall-snap candidates for an opening (door /
 * window), across all three parentings the 2D move can start from:
 *   - roof-hosted: opening → segment → roof → level (`getRoofHostedOpeningLevelId`).
 *   - wall-hosted (existing opening): parent is a wall → its parent is the level.
 *   - fresh placement (preset/catalog): the clone is parented straight to the
 *     LEVEL (`place-preset` sets `parentId: levelId`), so the parent IS the level.
 *
 * The fresh-placement case is the subtle one: treating the parent as always a
 * wall (`parent.parentId`) resolves a fresh opening's level to the BUILDING,
 * and `collectLevelWallSegments(building)` finds no walls — so a new door /
 * window never snapped in 2D. Returns null when the parent chain is none of
 * the above.
 */
export function getOpeningHostLevelId(
  node: { parentId: string | null },
  nodes: Record<string, AnyNode | undefined>,
): AnyNodeId | null {
  const roofLevelId = getRoofHostedOpeningLevelId(node, nodes)
  if (roofLevelId) return roofLevelId
  const parent = node.parentId ? nodes[node.parentId] : undefined
  if (!parent) return null
  if (parent.type === 'level') return parent.id as AnyNodeId
  return (parent.parentId as AnyNodeId | null) ?? null
}

/**
 * Level-plan [x, z] of a roof-hosted node — its face-local center mapped
 * through the face frame, then composed through the segment's and roof's
 * yaw + position.
 */
export function getRoofHostedOpeningPlanPoint(
  node: {
    parentId: string | null
    roofFace?: RoofWallFaceId
    position: [number, number, number]
  },
  nodes: Record<string, AnyNode | undefined>,
): [number, number] | null {
  const segment = node.parentId ? (nodes[node.parentId] as RoofSegmentNode | undefined) : undefined
  if (segment?.type !== 'roof-segment' || !node.roofFace) return null
  const roof = segment.parentId ? (nodes[segment.parentId] as RoofNode | undefined) : undefined
  if (roof?.type !== 'roof') return null

  const rotate = (x: number, z: number, yaw: number): [number, number] => [
    x * Math.cos(yaw) + z * Math.sin(yaw),
    -x * Math.sin(yaw) + z * Math.cos(yaw),
  ]

  const segLocal = roofFacePointToSegment(segment, node.roofFace, [
    node.position[0],
    node.position[1],
    node.position[2],
  ])
  const [sx, sz] = rotate(segLocal[0], segLocal[2], segment.rotation ?? 0)
  const segX = sx + segment.position[0]
  const segZ = sz + segment.position[2]
  const [rx, rz] = rotate(segX, segZ, roof.rotation ?? 0)
  return [rx + roof.position[0], rz + roof.position[2]]
}
