import { expect, test } from 'bun:test'
import { BufferGeometry, Mesh, MeshBasicMaterial } from 'three'
import { swapPreviewMaterial } from './swap-preview-material'

test('a paint preview undoes itself, but never over materials a rebuild gave the mesh meanwhile', () => {
  const base = new MeshBasicMaterial()
  const preview = new MeshBasicMaterial()
  const palette = [base, base, base]
  const mesh = new Mesh(new BufferGeometry(), palette)

  const undo = swapPreviewMaterial(mesh, [base, preview, base])
  undo()
  expect(mesh.material).toBe(palette)

  const again = swapPreviewMaterial(mesh, [base, preview, base])
  // The click commits a new finish: the wall rebuilds with a fourth palette entry.
  const rebuilt = [base, base, base, preview]
  mesh.material = rebuilt
  again()
  expect(mesh.material).toBe(rebuilt)
})
