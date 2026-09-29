import type { Material, Mesh } from 'three'

/**
 * Shows a paint preview by giving `mesh` another material (or material
 * array), and returns the undo. The undo puts the original back only while the
 * mesh still wears the preview: a commit or rebuild that gave it new materials
 * meanwhile (a new finish adds a palette entry and a geometry group) keeps
 * them — restoring the older, shorter array would leave a group with no
 * material, which the next raycast trips over.
 */
export function swapPreviewMaterial(mesh: Mesh, preview: Material | Material[]): () => void {
  const previous = mesh.material
  mesh.material = preview
  return () => {
    if (mesh.material === preview) mesh.material = previous
  }
}
