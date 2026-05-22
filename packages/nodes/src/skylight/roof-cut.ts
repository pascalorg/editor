import type { RoofSegmentNode, SkylightNode } from '@pascal-app/core'
import { getRoofOuterSurfaceFrameAtPoint } from '@pascal-app/viewer'
import * as THREE from 'three'

/**
 * Build the segment-local cut geometry the host roof's merge loop
 * subtracts from its shin / deck / wall brushes so the skylight has a
 * clean hole to poke through.
 *
 * The cut is a box, sized to the skylight footprint plus frame +
 * cutout offset, oriented to the outer roof surface frame at the
 * skylight's position (so multi-slope roofs — gambrel / mansard /
 * dutch — cut perpendicular to the actual surface rather than world
 * up).
 *
 * Returns null on degenerate input.
 *
 * Coordinates are SEGMENT-LOCAL. The viewer welds vertices, attaches
 * a single material group, and wraps the result in a Brush — see
 * `wiki/architecture/node-definitions.md` (`capabilities.roofAccessory.buildCut`).
 */
export function buildSkylightRoofCut(
  skylight: SkylightNode,
  segment: RoofSegmentNode,
): THREE.BufferGeometry | null {
  const inflate = Math.max(0, skylight.cutoutOffset ?? 0.01)
  const w = Math.max(0.05, skylight.width + 2 * skylight.frameThickness + 2 * inflate)
  const d = Math.max(0.05, skylight.height + 2 * skylight.frameThickness + 2 * inflate)

  const lx = skylight.position[0]
  const lz = skylight.position[2]

  const surfaceFrame = getRoofOuterSurfaceFrameAtPoint(segment, lx, lz)
  const surfaceY = surfaceFrame.point.y
  const normal = surfaceFrame.normal

  const h = 2.0
  const geo = new THREE.BoxGeometry(w, h, d)

  // Yaw in the box's own (un-tilted) frame so it stays a rotation
  // about the surface normal once tilted. Yawing after the tilt twists
  // the cutout around world-Y on sloped roofs.
  if (Math.abs(skylight.rotation) > 1e-4) {
    geo.rotateY(skylight.rotation)
  }

  if (normal.y < 0.9999) {
    // Match the renderer's basis construction (right = up × normal, forward
    // = right × normal). `setFromUnitVectors` would yaw the cut around the
    // normal by ~90° on hip side faces relative to the frame, leaving a
    // visibly rotated hole.
    const up = new THREE.Vector3(0, 1, 0)
    const right = new THREE.Vector3().crossVectors(up, normal)
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0)
    else right.normalize()
    const forward = new THREE.Vector3().crossVectors(right, normal).normalize()
    const basis = new THREE.Matrix4().makeBasis(right, normal, forward)
    const quat = new THREE.Quaternion().setFromRotationMatrix(basis)
    geo.applyQuaternion(quat)
  }

  geo.translate(lx, surfaceY, lz)

  // The viewer's merge loop welds vertices (mandatory after
  // `applyQuaternion` on a BoxGeometry — three-bvh-csg's three-way
  // subtraction silently no-ops on certain tilt angles when the
  // half-edge structure is left in the un-welded state), attaches a
  // single material group, and wraps the result in a Brush. Kinds
  // only emit the raw shape.
  return geo
}
