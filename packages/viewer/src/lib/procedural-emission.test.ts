import { expect, test } from 'bun:test'
import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial } from 'three'
import { cloneWithProceduralEmission, decorateProceduralEmission } from './procedural-emission'

test('preview replacement keeps authored emission and leaves shared material untouched', () => {
  const shared = new MeshStandardMaterial({ color: '#0000ff' })
  const root = new Group()
  const mesh = new Mesh(new BoxGeometry(), shared)
  mesh.userData.slotId = 'bulb'
  root.add(mesh)
  const restore = decorateProceduralEmission(
    root,
    [
      {
        id: 'bulb:0',
        partId: 'bulb',
        index: 0,
        position: [0, 0, 0],
        color: '#ffcc66',
        intensity: 2,
        distance: 5,
        emissiveSlot: 'bulb',
      },
    ],
    true,
  )
  const preview = mesh.material as MeshStandardMaterial
  expect(preview).not.toBe(shared)
  expect(preview.color).toEqual(new Color('#0000ff'))
  expect(preview.emissive).toEqual(new Color('#ffcc66'))
  expect(preview.emissiveIntensity).toBe(1)
  expect(shared.emissiveIntensity).toBe(1)
  expect(shared.emissive.getHexString()).toBe('000000')
  restore()
  expect(mesh.material).toBe(shared)
  shared.dispose()
  mesh.geometry.dispose()
})

test('export emission is on even when the live source is off', () => {
  const live = new MeshStandardMaterial({ color: '#123456' })
  live.emissiveIntensity = 0
  const exported = cloneWithProceduralEmission(live, '#ffbb55', true) as MeshStandardMaterial
  expect(exported.emissiveIntensity).toBe(1)
  expect(exported.emissive.getHexString()).toBe('ffbb55')
  expect(live.emissiveIntensity).toBe(0)
  exported.dispose()
  live.dispose()
})

test('a parent fixture does not recolor a hosted child bulb', () => {
  const root = new Group()
  root.userData.pascalId = 'parent'
  const child = new Group()
  child.userData.pascalId = 'child'
  root.add(child)
  const material = new MeshStandardMaterial()
  const bulb = new Mesh(new BoxGeometry(), material)
  bulb.userData.slotId = 'bulb'
  child.add(bulb)
  const restore = decorateProceduralEmission(
    root,
    [
      {
        id: 'light',
        partId: 'bulb',
        index: 0,
        position: [0, 0, 0],
        color: '#ff0000',
        intensity: 2,
        distance: 5,
        emissiveSlot: 'bulb',
      },
    ],
    true,
  )
  expect(bulb.material).toBe(material)
  restore()
  bulb.geometry.dispose()
  material.dispose()
})
