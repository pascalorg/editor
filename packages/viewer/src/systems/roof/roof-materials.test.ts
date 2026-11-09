import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  Assembly,
  BuildingNode,
  LevelNode,
  RoofNode,
  WallNode,
} from '@pascal-app/core'
import type * as THREE from 'three'
import { getRoofMaterialArray, levelWallCladdingRef, levelWallFaceRef } from './roof-materials'

// A roof on its building's roof level stands on the storey below: its gables are clad like that
// storey's walls, not the bare drywall default.
const stucco = Assembly.parse({
  face: 'exterior',
  layers: [
    { id: 'studs', role: 'structure', thickness: 0.14, core: true, material: 'wood' },
    { id: 'stucco', role: 'finish', thickness: 0.02, material: 'stucco' },
  ],
})

function house(roofOn: 'level_g' | 'level_r') {
  const wall = WallNode.parse({
    id: 'wall_g',
    parentId: 'level_g',
    start: [0, 0],
    end: [6, 0],
    assembly: stucco,
  })
  const roof = RoofNode.parse({ id: 'roof_main', parentId: roofOn })
  const ground = LevelNode.parse({
    id: 'level_g',
    parentId: 'building_h',
    level: 0,
    height: 2.5,
    children: [wall.id, ...(roofOn === 'level_g' ? [roof.id] : [])],
  })
  const roofLevel = LevelNode.parse({
    id: 'level_r',
    parentId: 'building_h',
    level: 1,
    children: roofOn === 'level_r' ? [roof.id] : [],
    metadata: { role: 'roof' },
  })
  const building = BuildingNode.parse({ id: 'building_h', children: [ground.id, roofLevel.id] })
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [building, ground, roofLevel, wall, roof].map((node) => [node.id, node]),
  )
  return { nodes, roof }
}

describe('levelWallCladdingRef', () => {
  test("a roof on the storey's own level takes its walls' cladding", () => {
    const { nodes, roof } = house('level_g')
    expect(levelWallCladdingRef(nodes, roof)).toBe('library:concrete-stucco')
  })

  test('a roof on the roof level takes the cladding of the storey below', () => {
    const { nodes, roof } = house('level_r')
    expect(levelWallCladdingRef(nodes, roof)).toBe('library:concrete-stucco')
  })
})

describe('the heel band', () => {
  test('follows the walls below, painted or clad, not the gable trim', () => {
    const { nodes, roof } = house('level_g')
    expect(levelWallFaceRef(nodes, roof)).toBe('library:concrete-stucco')
    const wall = nodes.wall_g as WallNode
    // an unresolved wall's outside is face b
    const painted = { ...nodes, wall_g: { ...wall, slots: { b: 'library:wood-cedar' } } as AnyNode }
    expect(levelWallFaceRef(painted, roof)).toBe('library:wood-cedar')
  })

  // A roof saved before the bands had slots of their own: no heel or gable fields.
  const savedRoof = (extra: Record<string, unknown> = {}) =>
    RoofNode.parse({
      object: 'node',
      id: 'roof_saved',
      type: 'roof',
      parentId: 'level_g',
      visible: true,
      metadata: {},
      position: [0, 0, 0],
      rotation: 0,
      children: [],
      ...extra,
    })
  const slotsOf = (roof: RoofNode, nodes: Record<string, AnyNode>, textures = true) =>
    getRoofMaterialArray(
      roof,
      'rendered',
      textures,
      'clay',
      undefined,
      levelWallCladdingRef(nodes, roof),
      undefined,
      levelWallFaceRef(nodes, roof),
    )!

  test('an old roof with no edge paint draws its bands exactly as before', () => {
    const { nodes } = house('level_g')
    const roof = savedRoof()
    expect(roof.heelMaterial).toBeUndefined()
    expect(roof.heelMaterialPreset).toBeUndefined()
    for (const textures of [true, false]) {
      const slots = slotsOf(roof, { ...nodes, [roof.id]: roof }, textures)
      // heel band and both gables: the very wall/trim material they drew with before
      expect(slots[4]).toBe(slots[0])
      expect(slots[5]).toBe(slots[0])
      expect(slots[6]).toBe(slots[0])
    }
    // with no walls below, the drywall default, shared the same way
    const bare = slotsOf(roof, {})
    expect(bare[4]).toBe(bare[0])
  })

  test('edge paint on an old roof stays on the gables; the heel band shows the walls', () => {
    const { nodes } = house('level_g')
    const red = { preset: 'custom', properties: { color: '#aa2222' } }
    const slots = slotsOf(savedRoof({ edgeMaterial: red }), nodes)
    expect((slots[0] as THREE.MeshStandardMaterial).color.getHexString()).toBe('aa2222')
    expect(slots[5]).toBe(slots[0])
    expect(slots[6]).toBe(slots[0])
    // the heel band is what an unpainted roof draws for the stucco walls below
    expect(slots[4]).toBe(slotsOf(savedRoof(), nodes)[0])
  })

  test('keeps its own material when the gables are painted, and the gables keep theirs', () => {
    const painted = RoofNode.parse({
      id: 'roof_p',
      edgeMaterial: { preset: 'custom', properties: { color: '#aa2222' } },
      heelMaterial: { preset: 'custom', properties: { color: '#2222aa' } },
    })
    const materials = getRoofMaterialArray(painted, 'rendered', true)!
    expect(materials).toHaveLength(7)
    expect(materials[4]).not.toBe(materials[0])
    expect((materials[4] as THREE.MeshStandardMaterial).color.getHexString()).toBe('2222aa')
    // the gable slots are the edge role's until a gable is painted on its own
    expect(materials[5]).toBe(materials[0])
    expect(materials[6]).toBe(materials[0])
  })
})
