import type { RoofSegmentNode } from '@pascal-app/core'
import * as THREE from 'three'

type RoofWallOpening = {
  roofSegmentId?: string
  position: [number, number, number]
  rotation: [number, number, number]
  width: number
  height: number
}

/**
 * CSG cut for a door / window hosted on a roof-segment wall face
 * (`capabilities.roofAccessory.buildCut`). A box through the wall plane,
 * oriented by the opening's face yaw, in segment-local coords — the
 * roof-merge loop subtracts it from the segment's wall brush.
 *
 * Returns null for wall-hosted openings (no `roofSegmentId`): their cut
 * is handled by the wall system's own cutout pipeline.
 */
export function buildRoofWallOpeningCut(
  node: RoofWallOpening,
  hostSegment: RoofSegmentNode,
): THREE.BufferGeometry | null {
  if (!node.roofSegmentId) return null

  const wallThickness = hostSegment.wallThickness ?? 0.1
  // Through the wall both ways, but well short of the rake/eave overhang
  // so the cut never nicks the soffit or fascia bands.
  const depth = wallThickness * 2 + 0.04

  // A door's cut bottom is coplanar with the wall brush base — extend it
  // slightly downward so three-bvh-csg never has to clip coplanar faces.
  const bottom = node.position[1] - node.height / 2
  const bottomPad = bottom < 0.005 ? 0.02 : 0

  const geo = new THREE.BoxGeometry(node.width, node.height + bottomPad, depth)
  geo.translate(0, -bottomPad / 2, 0)
  geo.rotateY(node.rotation[1] ?? 0)
  geo.translate(node.position[0], node.position[1], node.position[2])
  return geo
}
