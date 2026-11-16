import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { resolveGlbPick } from '../../index'
import { filterSectionHits, SECTION_DEFAULTS } from '../../lib/section'

/** A baked level (raised and shifted, as level stacking moves it) holding a wall, a ceiling and a sofa. */
function bakedLevel() {
  const level = new THREE.Group()
  level.userData = { pascalId: 'level_0', kind: 'level' }
  level.position.set(10, 3, -5)
  const identity = new Map<string, THREE.Object3D>([['level_0', level]])
  const add = (pascalId: string, kind: string) => {
    const node = new THREE.Group()
    node.userData = { pascalId, kind }
    const mesh = new THREE.Mesh()
    node.add(mesh)
    level.add(node)
    identity.set(pascalId, node)
    return mesh
  }
  const meshes = {
    ceiling: add('ceiling_1', 'ceiling'),
    wall: add('wall_1', 'wall'),
    sofa: add('item_sofa', 'item'),
  }
  level.updateWorldMatrix(true, true)
  return { level, identity, meshes }
}

test('a baked hit picks the nearest node a click lands on, in its level frame', () => {
  const { identity, meshes } = bakedLevel()
  const pick = resolveGlbPick(
    [
      // The ceiling only frames: the pointer goes through it.
      { object: meshes.ceiling, point: new THREE.Vector3(12, 5.5, -3) },
      { object: meshes.wall, point: new THREE.Vector3(13.85, 4, -3) },
      { object: meshes.sofa, point: new THREE.Vector3(12, 3.4, -3) },
    ],
    identity,
  )
  expect(pick?.nodeId).toBe('wall_1')
  expect(pick?.hitObject).toBe(meshes.wall)
  expect(pick?.point?.[0]).toBeCloseTo(3.85)
  expect(pick?.point?.[1]).toBeCloseTo(2)
})

test('a hidden floor and empty space are no pick', () => {
  const { level, identity, meshes } = bakedLevel()
  expect(resolveGlbPick([], identity)).toBeNull()
  level.visible = false
  expect(
    resolveGlbPick([{ object: meshes.sofa, point: new THREE.Vector3(12, 3.4, -3) }], identity),
  ).toBeNull()
})

test('a cut exposes the next semantic hit in the same level frame', () => {
  const { identity, meshes } = bakedLevel()
  const hits = [
    { object: meshes.wall, point: new THREE.Vector3(13.85, 4, -3) },
    { object: meshes.sofa, point: new THREE.Vector3(12, 3.4, -3) },
  ]
  const pick = resolveGlbPick(
    filterSectionHits(hits, { ...SECTION_DEFAULTS, sectionEnabled: true, sectionPosition: 3.5 }),
    identity,
  )
  expect(pick?.nodeId).toBe('item_sofa')
  expect(pick?.hitObject).toBe(meshes.sofa)
  expect(pick?.point).toEqual([2, 2])
  expect(resolveGlbPick(filterSectionHits(hits, SECTION_DEFAULTS), identity)?.nodeId).toBe('wall_1')
})

test('accepted baked hit metadata uses world coordinates and transformed normals', () => {
  const { identity, meshes } = bakedLevel()
  meshes.wall.rotation.y = Math.PI / 2
  meshes.wall.updateWorldMatrix(true, false)
  const pick = resolveGlbPick(
    [
      { object: meshes.ceiling, point: new THREE.Vector3(0, 10, 0) },
      {
        object: meshes.wall,
        point: new THREE.Vector3(12, 4, -3),
        face: { normal: new THREE.Vector3(0, 0, 1) },
      },
    ],
    identity,
  )!
  expect(pick.worldPosition).toEqual([12, 4, -3])
  expect(pick.normal?.[0]).toBeCloseTo(1)
  expect(pick.normal?.[2]).toBeCloseTo(0)
  expect(
    resolveGlbPick([{ object: meshes.wall, point: new THREE.Vector3() }], identity)?.normal,
  ).toBeNull()
})
