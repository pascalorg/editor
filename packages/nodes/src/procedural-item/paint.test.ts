import { expect, test } from 'bun:test'
import { useInteractive } from '@pascal-app/core'
import { ProceduralItemNode, parseRecipe } from '@pascal-app/core/procedural-items'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import pendant from '../../../core/src/procedural-items/__fixtures__/pendant_lamp.json'
import { proceduralItemDefinition } from './definition'

test('procedural Paint preview preserves authored bulb emission and restores the live material', () => {
  const node = ProceduralItemNode.parse({
    id: 'procedural-item_paint_light',
    recipe: parseRecipe(pendant),
  })
  const root = new Group()
  const original = new MeshStandardMaterial({ color: '#ffffff' })
  const mesh = new Mesh(new BoxGeometry(), original)
  mesh.userData.slotId = 'bulb'
  root.add(mesh)
  useInteractive.getState().initProcedural(node.id, [])
  const restore = proceduralItemDefinition.capabilities.paint!.applyPreview({
    node,
    root,
    role: 'bulb',
    material: { properties: { color: '#0000ff' } },
    materialPreset: undefined,
  })
  expect(restore).not.toBeNull()
  const preview = mesh.material as MeshStandardMaterial
  expect(preview.color.getHexString()).toBe('0000ff')
  expect(preview.emissive.getHexString()).toBe('ffdfad')
  expect(preview.emissiveIntensity).toBe(1)
  restore?.()
  expect(mesh.material).toBe(original)
  useInteractive.getState().setProceduralLights(node.id, false)
  const restoreOff = proceduralItemDefinition.capabilities.paint!.applyPreview({
    node,
    root,
    role: 'bulb',
    material: { properties: { color: '#0000ff' } },
    materialPreset: undefined,
  })
  expect((mesh.material as MeshStandardMaterial).emissiveIntensity).toBe(0)
  restoreOff?.()
  useInteractive.getState().removeProcedural(node.id)
  mesh.geometry.dispose()
  original.dispose()
})
