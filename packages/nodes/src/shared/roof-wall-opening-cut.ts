import type { DoorNode, RoofSegmentNode, WindowNode } from '@pascal-app/core'
import { getRoofWallFaceFrame, roofFacePointToSegment } from '@pascal-app/core'
import { buildOpeningCutoutGeometry, hasFlatOpeningCutoutBottom } from '@pascal-app/viewer'
import * as THREE from 'three'

/**
 * CSG cut for a door / window hosted on a roof-segment wall face
 * (`capabilities.roofAccessory.buildCut`). The cut goes through the wall
 * mid-plane, derived from the CURRENT host geometry (the opening stores
 * face-local coords), so the hole follows segment resizes for free.
 * Plain rectangles cut a box; shaped openings (arch / rounded /
 * frameless `opening` kind) reuse the wall pipeline's cutout profile so
 * roof-hosted holes match wall-hosted ones.
 *
 * Returns null for wall-hosted openings: their cut is handled by the
 * wall system's own cutout pipeline.
 */
export function buildRoofWallOpeningCut(
  node: DoorNode | WindowNode,
  hostSegment: RoofSegmentNode,
): THREE.BufferGeometry | null {
  if (!node.roofSegmentId || !node.roofFace) return null

  const wallThickness = hostSegment.wallThickness ?? 0.1
  // Through the wall both ways, but well short of the rake/eave overhang
  // so the cut never nicks the soffit or fascia bands.
  const depth = wallThickness * 2 + 0.04

  // A door's cut bottom is coplanar with the wall brush base — extend it
  // slightly downward so three-bvh-csg never has to clip coplanar faces.
  // Only a flat bottom chord may extend; a rounded bottom is never
  // coplanar and shifting it would distort the profile.
  const bottom = node.position[1] - node.height / 2
  const bottomPad = bottom < 0.005 && hasFlatOpeningCutoutBottom(node) ? 0.02 : 0

  const center = roofFacePointToSegment(hostSegment, node.roofFace, [
    node.position[0],
    node.position[1],
    0,
  ])
  const { yaw } = getRoofWallFaceFrame(hostSegment, node.roofFace)

  const geo = buildCutGeometry(node, wallThickness, depth, bottomPad)
  geo.rotateY(yaw)
  geo.translate(center[0], center[1], center[2])
  return geo
}

function buildCutGeometry(
  node: DoorNode | WindowNode,
  wallThickness: number,
  depth: number,
  bottomPad: number,
): THREE.BufferGeometry {
  const shaped =
    node.openingKind === 'opening' ||
    node.openingShape === 'arch' ||
    node.openingShape === 'rounded'

  if (!shaped) {
    const geo = new THREE.BoxGeometry(node.width, node.height + bottomPad, depth)
    geo.translate(0, -bottomPad / 2, 0)
    return geo
  }

  const halfWidth = node.width / 2
  const halfHeight = node.height / 2
  return buildOpeningCutoutGeometry(
    node,
    { left: -halfWidth, right: halfWidth, bottom: -halfHeight - bottomPad, top: halfHeight },
    depth,
    wallThickness,
  )
}
