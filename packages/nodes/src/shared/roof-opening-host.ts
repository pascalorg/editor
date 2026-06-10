import type { AnyNode, AnyNodeId, RoofNode, RoofSegmentNode } from '@pascal-app/core'
import {
  getMaxRoofRectHeightFromAnchor,
  getMaxRoofRectWidthFromAnchor,
  getRoofSegmentWallFace,
  getRoofWallFaceIdFromYaw,
  segmentPointToRoofWallFace,
} from '@pascal-app/core'

/**
 * Host-side helpers for openings (door / window) hosted on a roof-segment
 * wall face: resize-handle limits derived from the face profile, and the
 * plan-space anchors the 2D floor-plan move path needs.
 */

type RoofHostedOpening = {
  roofSegmentId?: string
  parentId: string | null
  position: [number, number, number]
  rotation: [number, number, number]
  width: number
  height: number
}

type SceneReader = { get: (id: AnyNodeId) => unknown }

function resolveHostFace(node: RoofHostedOpening, scene: SceneReader) {
  if (!node.roofSegmentId) return null
  const segment = scene.get(node.roofSegmentId as AnyNodeId) as RoofSegmentNode | undefined
  if (!segment || segment.type !== 'roof-segment') return null
  const faceId = getRoofWallFaceIdFromYaw(node.rotation[1])
  if (!faceId) return null
  const face = getRoofSegmentWallFace(segment, faceId)
  const { u, v } = segmentPointToRoofWallFace(segment, faceId, node.position)
  return { segment, face, u, v }
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
  const anchorU = host.u - (growSign * node.width) / 2
  return getMaxRoofRectWidthFromAnchor(host.face, anchorU, growSign, host.v, node.height)
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
  const anchorV = host.v - (growSign * node.height) / 2
  return getMaxRoofRectHeightFromAnchor(host.face, host.u, node.width, anchorV, growSign)
}

/**
 * Level hosting a roof-hosted opening's roof (opening → segment → roof →
 * level). Null when the parent chain isn't roof-shaped.
 */
export function getRoofHostedOpeningLevelId(
  node: RoofHostedOpening,
  nodes: Record<string, AnyNode | undefined>,
): AnyNodeId | null {
  const segment = node.parentId ? nodes[node.parentId] : undefined
  if (segment?.type !== 'roof-segment') return null
  const roof = segment.parentId ? nodes[segment.parentId] : undefined
  if (roof?.type !== 'roof') return null
  return (roof.parentId as AnyNodeId | null) ?? null
}

/**
 * Level-plan [x, z] of a roof-hosted opening — its segment-local center
 * composed through the segment's and roof's yaw + position.
 */
export function getRoofHostedOpeningPlanPoint(
  node: RoofHostedOpening,
  nodes: Record<string, AnyNode | undefined>,
): [number, number] | null {
  const segment = node.parentId ? (nodes[node.parentId] as RoofSegmentNode | undefined) : undefined
  if (segment?.type !== 'roof-segment') return null
  const roof = segment.parentId ? (nodes[segment.parentId] as RoofNode | undefined) : undefined
  if (roof?.type !== 'roof') return null

  const rotate = (x: number, z: number, yaw: number): [number, number] => [
    x * Math.cos(yaw) + z * Math.sin(yaw),
    -x * Math.sin(yaw) + z * Math.cos(yaw),
  ]

  const [sx, sz] = rotate(node.position[0], node.position[2], segment.rotation ?? 0)
  const segX = sx + segment.position[0]
  const segZ = sz + segment.position[2]
  const [rx, rz] = rotate(segX, segZ, roof.rotation ?? 0)
  return [rx + roof.position[0], rz + roof.position[2]]
}
