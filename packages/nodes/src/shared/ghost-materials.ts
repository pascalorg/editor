'use client'

import type { Material, Mesh, Object3D, Raycaster } from 'three'

export const INVALID_GHOST_COLOR = 0xef_44_44
export const VALID_GHOST_COLOR = 0x22_c5_5e

const NO_RAYCAST = (_raycaster: Raycaster, _intersects: unknown[]) => {}

/**
 * Apply ghost material treatment to a preview mesh tree.
 *
 * Traverses the object tree, disables raycasting on all descendants (prevents
 * cursor-ray starvation), and clones visible mesh materials to set translucency.
 *
 * Tint by state:
 *   - `invalid` (red, opacity ~0.4): off-host or colliding — can't place here.
 *   - `valid` (green, opacity ~0.45): on a host and placeable — the "go" cue.
 *   - neither (opacity ~0.5, original color): a plain translucent preview.
 * `invalid` wins if both are passed.
 *
 * Skips: meshes whose material.visible === false (door/window root hitbox) and
 * children named 'cutout'.
 *
 * Returns cleanup that disposes only the cloned materials (never originals or geometry).
 *
 * @param root - The preview mesh tree (typically from buildDoorPreviewMesh / buildWindowPreviewMesh)
 * @param opts - { invalid?, valid? } placement-state tint
 * @returns Cleanup function that disposes the cloned materials
 */
export function applyGhost(
  root: Object3D,
  opts?: { invalid?: boolean; valid?: boolean },
): () => void {
  const invalid = opts?.invalid ?? false
  const valid = !invalid && (opts?.valid ?? false)
  const cloned: Material[] = []

  root.traverse((obj) => {
    // Disable raycast on every descendant to prevent cursor-ray starvation.
    obj.raycast = NO_RAYCAST

    const mesh = obj as Mesh
    if (!mesh.isMesh) return
    if (mesh.name === 'cutout') return

    const original = mesh.material
    const wasArray = Array.isArray(original)

    const cloneOne = (mat: Material): Material | null => {
      // Skip invisible materials (door/window root hitbox).
      if ((mat as { visible?: boolean }).visible === false) return null
      const clone = mat.clone()
      clone.transparent = true
      clone.depthWrite = false
      if (invalid) {
        ;(clone as { color?: { setHex: (c: number) => void } }).color?.setHex(INVALID_GHOST_COLOR)
        ;(clone as { emissive?: { setHex: (c: number) => void } }).emissive?.setHex(
          INVALID_GHOST_COLOR,
        )
        clone.opacity = 0.4
      } else if (valid) {
        ;(clone as { color?: { setHex: (c: number) => void } }).color?.setHex(VALID_GHOST_COLOR)
        ;(clone as { emissive?: { setHex: (c: number) => void } }).emissive?.setHex(
          VALID_GHOST_COLOR,
        )
        clone.opacity = 0.45
      } else {
        clone.opacity = 0.5
      }
      cloned.push(clone)
      return clone
    }

    if (wasArray) {
      const clonedMats = original.map(cloneOne).filter((m): m is Material => m !== null)
      if (clonedMats.length > 0) mesh.material = clonedMats
    } else {
      const clone = cloneOne(original)
      if (clone) mesh.material = clone
    }
  })

  return () => {
    for (const mat of cloned) {
      mat.dispose()
    }
  }
}
