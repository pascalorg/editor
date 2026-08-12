import type { RoofSegmentNode } from '@pascal-app/core'
import * as THREE from 'three'

const tmpMatrix = new THREE.Matrix4()
const tmpInv = new THREE.Matrix4()
const tmpPos = new THREE.Vector3()
const tmpQuat = new THREE.Quaternion()
const tmpScale = new THREE.Vector3()

export type DormerSegmentTransform = {
  position: [number, number, number]
  quaternion: [number, number, number, number]
}

export type DormerPlacementHit = {
  segment: RoofSegmentNode
  localX: number
  localY: number
  localZ: number
}

/**
 * Shared placement-tool plumbing for fresh-place and duplicate/move
 * tools. Owns:
 *   - cursor → roof-segment hit resolution (delegated to the host
 *     RoofNode pointer events)
 *   - building-local segment transform extraction (for ghost mounting)
 *   - 5cm grid snap
 *   - keyboard rotate (R / Shift+R, ±15°)
 *
 * Does NOT own:
 *   - the ghost mesh (caller renders `<DormerPreview>`)
 *   - any node-lifecycle state (caller passes an `onCommit` that
 *     decides between createNode / updateNode / etc.)
 *
 * Returns the segment transform + cursor hit so the caller can mount
 * the ghost, plus the live ghost rotation (driven by R / Shift+R).
 */
