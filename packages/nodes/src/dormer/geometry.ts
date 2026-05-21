import type { DormerNode } from '@pascal-app/core'
import * as THREE from 'three'

/**
 * Lightweight silhouette geometry used by the placement / move-tool
 * ghost preview only. Renders the dormer as an extruded pentagon
 * (rectangle body + triangular gable) dropped `DORMER_GHOST_DROP_BELOW`
 * below the anchor so the cursor sits at the floor of the dormer the
 * way the committed CSG geometry does.
 *
 * The real dormer mesh on a committed node is built by the viewer's
 * `generateDormerGeometry` (CSG against the host roof segment). This
 * helper is intentionally cheap so it can be rebuilt on every cursor
 * move during placement without re-running CSG.
 */
const DORMER_GHOST_DROP_BELOW = 2

export function buildDormerGhostGeometry(node: DormerNode): THREE.BufferGeometry {
  const w = Math.max(0.05, node.width)
  const wallH = Math.max(0.05, node.height)
  const roofH = Math.max(0, node.roofHeight)
  const d = Math.max(0.05, node.depth)
  const hw = w / 2

  const shape = new THREE.Shape()
  shape.moveTo(-hw, -DORMER_GHOST_DROP_BELOW)
  shape.lineTo(hw, -DORMER_GHOST_DROP_BELOW)
  shape.lineTo(hw, wallH)
  shape.lineTo(0, wallH + roofH)
  shape.lineTo(-hw, wallH)
  shape.closePath()

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: d,
    bevelEnabled: false,
  })
  geo.translate(0, 0, -d / 2)
  return geo
}

/**
 * Inspector helper: which window-shape sub-controls to surface for the
 * current dormer.
 */
export function dormerSupportsArch(node: DormerNode): boolean {
  return node.windowShape === 'arch'
}

export function dormerSupportsCornerRadii(node: DormerNode): boolean {
  return node.windowShape === 'rounded'
}
