import type { DormerNode } from '@pascal-app/core'
import * as THREE from 'three'

/**
 * Grid-snap step (metres) applied to the world cursor position while a
 * dormer placement / move ghost is in flight. Shared by both tools so
 * the audible snap and the committed position step stay in lockstep.
 */
export const DORMER_PLACEMENT_SNAP_M = 0.05

/**
 * Rotation step (radians) used by the keyboard rotate shortcuts (R /
 * Shift+R) while a dormer placement / move ghost is in flight. 15° —
 * lets the user reach the 90° cardinals in six taps and the 45°
 * diagonals in three.
 */
export const DORMER_PLACEMENT_ROTATION_STEP = (15 * Math.PI) / 180

/**
 * Lightweight silhouette geometry used by the placement / move-tool
 * ghost preview only. Renders the dormer as an extruded pentagon
 * (rectangle body + triangular gable) dropped by `wallSkirtHeight` below
 * the anchor so the cursor sits at the floor of the dormer the way the
 * committed CSG geometry does.
 *
 * For `roofType === 'flat'` (or `roofHeight === 0`) the gable apex is
 * skipped and the shape collapses to a rectangle. Other roof types use
 * the gable approximation — exact per-type silhouettes are a future
 * improvement.
 *
 * Kept self-contained (no `@pascal-app/viewer` imports) so the geometry
 * test doesn't drag in the CSG / BVH module graph, which fails to load
 * outside of a browser/WebGL context. The viewer has its own
 * `buildDormerFallbackGeometry` that mirrors this shape — used both as
 * the CSG fallback when boolean ops fail and as the live-drag preview
 * in the dormer renderer.
 */
export function buildDormerGhostGeometry(node: DormerNode): THREE.BufferGeometry {
  const w = Math.max(0.05, node.width)
  const wallH = Math.max(0.05, node.height)
  const roofH = Math.max(0, node.roofHeight)
  const d = Math.max(0.05, node.depth)
  const skirt = Math.max(0.05, node.wallSkirtHeight)
  const hw = w / 2
  const isFlat = node.roofType === 'flat' || roofH === 0

  const shape = new THREE.Shape()
  shape.moveTo(-hw, -skirt)
  shape.lineTo(hw, -skirt)
  shape.lineTo(hw, wallH)
  if (!isFlat) shape.lineTo(0, wallH + roofH)
  shape.lineTo(-hw, wallH)
  shape.closePath()

  const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false })
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
