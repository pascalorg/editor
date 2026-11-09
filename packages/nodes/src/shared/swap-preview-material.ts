import { hasMaterialsForGroups } from '@pascal-app/viewer'
import type { BufferGeometry, Material, Mesh } from 'three'

/**
 * Shows a paint preview by giving `mesh` another material (or material
 * array), and `groups` with it when the preview also regroups the geometry's
 * triangles onto that array; returns the undo. Groups and materials index into
 * each other, so the undo only puts back what still is the preview's: groups
 * a rebuild or commit replaced meanwhile stay, and the original material goes
 * back only over groups it can draw — restoring an older, shorter array over a
 * rebuilt geometry's groups would leave a group with no material, which the
 * next raycast trips over on `material.side`.
 */
export function swapPreviewMaterial(
  mesh: Mesh,
  preview: Material | Material[],
  groups?: BufferGeometry['groups'],
): () => void {
  const geometry = mesh.geometry
  const previous = mesh.material
  const previousGroups = geometry.groups
  if (groups) geometry.groups = groups
  mesh.material = preview
  return () => {
    if (groups && mesh.geometry === geometry && geometry.groups === groups) {
      geometry.groups = previousGroups
    }
    if (mesh.material === preview && hasMaterialsForGroups(mesh, previous)) {
      mesh.material = previous
    }
  }
}
