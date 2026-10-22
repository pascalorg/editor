import { expect, test } from 'bun:test'
import { hasMaterialsForGroups } from '@pascal-app/viewer'
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

test('a regrouping preview swaps groups and materials together and undoes them as a pair', () => {
  const base = new MeshBasicMaterial()
  const palette = [base, base, base]
  const geometry = new BufferGeometry()
  geometry.addGroup(0, 3, 1)
  const groups = geometry.groups
  const mesh = new Mesh(geometry, palette)

  const undo = swapPreviewMaterial(
    mesh,
    [base, base, base, base],
    [{ start: 0, count: 3, materialIndex: 3 }],
  )
  expect(mesh.geometry.groups[0]!.materialIndex).toBe(3)
  expect(hasMaterialsForGroups(mesh)).toBe(true)
  undo()
  expect(mesh.geometry.groups).toBe(groups)
  expect(mesh.material).toBe(palette)
})

test('a preview never restores a shorter palette over groups a rebuild gave the mesh', () => {
  const base = new MeshBasicMaterial()
  const palette = [base, base, base]
  const mesh = new Mesh(new BufferGeometry(), palette)
  mesh.geometry.addGroup(0, 3, 1)
  const preview = [base, base, base, base]
  const undo = swapPreviewMaterial(mesh, preview, [{ start: 0, count: 3, materialIndex: 3 }])

  // The click commits a new finish: the wall rebuilds a geometry drawing palette entry 3,
  // while the cutout cache still holds the hovered wall's preview material.
  const rebuilt = new BufferGeometry()
  rebuilt.addGroup(0, 3, 3)
  mesh.geometry = rebuilt
  undo()
  expect(mesh.geometry.groups[0]!.materialIndex).toBe(3)
  expect(mesh.material).toBe(preview)
  expect(hasMaterialsForGroups(mesh)).toBe(true)
})
