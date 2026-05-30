import type { DownspoutNode } from '@pascal-app/core'
import * as THREE from 'three'

/**
 * Downspout pipe builder. The pipe is a vertical cylinder hanging from
 * the gutter outlet down to ground (or wherever `length` ends). Mesh
 * frame is centred on the outlet — local Y = 0 is the TOP of the pipe
 * (flush with the gutter floor / outlet stub bottom) and Y = −length
 * is where the bottom of the pipe sits.
 *
 * Single piece, single material: when a kickout or splash block lands
 * we'll merge them in like the gutter does with its hangers / outlet.
 *
 * Pure: no React, no scene access.
 */
const RADIAL_SEGMENTS = 24

export function buildDownspoutGeometry(node: DownspoutNode): THREE.BufferGeometry {
  const radius = Math.max(0.01, node.diameter / 2)
  const length = Math.max(0.1, node.length)

  // CylinderGeometry's default axis is +Y, centred at the origin.
  // We want the TOP at Y = 0 and the BOTTOM at Y = −length, so
  // translate down by half the length.
  const pipe = new THREE.CylinderGeometry(radius, radius, length, RADIAL_SEGMENTS).toNonIndexed()
  pipe.translate(0, -length / 2, 0)
  pipe.computeVertexNormals()
  return pipe
}
