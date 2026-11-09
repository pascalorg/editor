import { expect, test } from 'bun:test'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { clearRiseTextureScale, setRiseTextureScale } from './reveal-texture-scale'

test('a rise keeps shared source geometry untouched and restores it when finished', () => {
  const geometry = new BoxGeometry(4, 3, 0.2).translate(0, 1.5, 0)
  const material = new MeshStandardMaterial()
  const rising = new Mesh(geometry, material)
  const resting = new Mesh(geometry, material)
  const root = new Group().add(rising)
  const uv = geometry.getAttribute('uv')
  const original = Array.from(uv.array)
  setRiseTextureScale(root, 0.3, 0)
  expect(rising.geometry).not.toBe(geometry)
  expect(resting.geometry).toBe(geometry)
  expect(Array.from(uv.array)).toEqual(original)
  clearRiseTextureScale(root)
  expect(rising.geometry).toBe(geometry)
  expect(rising.material).toBe(material)
  geometry.dispose()
  material.dispose()
})

test('a geometry rebuild mid-rise gets fresh UV compensation without restoring stale geometry', () => {
  const initial = new BoxGeometry(4, 3, 0.2)
  const replacement = new BoxGeometry(6, 3, 0.2)
  const mesh = new Mesh(initial, new MeshStandardMaterial())
  const root = new Group().add(mesh)
  setRiseTextureScale(root, 0.3, -1.5)
  mesh.geometry = replacement
  setRiseTextureScale(root, 0.6, -1.5)
  expect(mesh.geometry).not.toBe(initial)
  expect(mesh.geometry).not.toBe(replacement)
  clearRiseTextureScale(root)
  expect(mesh.geometry).toBe(replacement)
  initial.dispose()
  replacement.dispose()
  ;(mesh.material as MeshStandardMaterial).dispose()
})
