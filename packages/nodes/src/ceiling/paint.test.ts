import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  CeilingNode,
  clearSceneHistory,
  LevelNode,
  useScene,
  ZoneNode,
} from '@pascal-app/core'
import { CEILING_REGION_MESH } from '@pascal-app/viewer'
import { Mesh, MeshBasicMaterial, Object3D } from 'three'
import { ceilingPaint } from './paint'

// Ceiling paint: a click lands on the region under it or the ceiling's own
// surface; repaint and erase go through the paint path in one undo step, onto
// the room for an automatic ceiling and onto the ceiling for a manual one.

const square = (x: number, z: number, size: number): [number, number][] => [
  [x, z],
  [x + size, z],
  [x + size, z + size],
  [x, z + size],
]
globalThis.requestAnimationFrame ??= (callback: FrameRequestCallback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}
const saved = useScene.getState()
let level: LevelNode
let zone: ZoneNode
let auto: CeilingNode
let manual: CeilingNode

beforeEach(() => {
  level = LevelNode.parse({ id: 'level_ceiling_paint' })
  zone = ZoneNode.parse({
    id: 'zone_ceiling_paint',
    name: 'Kitchen',
    parentId: level.id,
    polygon: square(0, 0, 4),
    ceiling: { regions: [{ id: 'patch', polygon: square(0, 0, 2), finish: 'library:blue' }] },
  })
  auto = CeilingNode.parse({
    id: 'ceiling_auto_paint',
    parentId: level.id,
    polygon: square(0, 0, 4),
    boundary: 'auto',
    zoneId: zone.id,
    slots: { surface: 'library:plaster' },
  })
  manual = CeilingNode.parse({
    id: 'ceiling_manual_paint',
    parentId: level.id,
    polygon: square(6, 0, 2),
    regions: [{ id: 'own', polygon: square(6, 0, 1), finish: 'library:green' }],
  })
  const nodes = { [level.id]: level, [zone.id]: zone, [auto.id]: auto, [manual.id]: manual }
  useScene.setState({
    nodes: nodes as Record<string, AnyNode>,
    materials: {},
    readOnly: false,
  } as never)
  clearSceneHistory()
})
afterEach(() => {
  useScene.setState(saved)
  clearSceneHistory()
})

const current = (id: string) => useScene.getState().nodes[id as never] as AnyNode
const hit = (role?: string) => {
  const object = new Object3D()
  if (role) object.userData.paintRole = role
  return object
}
const paint = (node: AnyNode, role: string, materialPreset?: string) =>
  ceilingPaint.commit!({ node, role, material: undefined, materialPreset })

test('a hit resolves to the region under it, else the ceiling surface', () => {
  expect(
    ceilingPaint.resolveRole({ node: auto, materialIndex: null, hitObject: hit('region:patch') }),
  ).toBe('region:patch')
  expect(ceilingPaint.resolveRole({ node: auto, materialIndex: null, hitObject: hit() })).toBe(
    'surface',
  )
  expect(ceilingPaint.roleLabel?.(auto, 'region:patch')).toBe('Painted part')
})

test('an automatic ceiling repaints and erases its room region, one undo step each', () => {
  paint(auto, 'region:patch', 'library:red')
  expect((current(zone.id) as ZoneNode).ceiling?.regions?.[0]?.finish).toBe('library:red')
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  expect(
    ceilingPaint.getEffectiveMaterial!({ node: auto, role: 'region:patch', nodes: {} }),
  ).toEqual({
    material: undefined,
    materialPreset: 'library:red',
  })

  paint(current(auto.id), 'region:patch')
  expect((current(zone.id) as ZoneNode).ceiling?.regions).toBeUndefined()
  expect(useScene.temporal.getState().pastStates).toHaveLength(2)
  useScene.temporal.getState().undo()
  expect((current(zone.id) as ZoneNode).ceiling?.regions).toHaveLength(1)
})

test('erasing the surface resets a whole-painted ceiling; its regions stay', () => {
  paint(auto, 'surface')
  expect((current(auto.id) as CeilingNode).slots?.surface).toBeUndefined()
  expect((current(zone.id) as ZoneNode).ceiling?.regions).toHaveLength(1)
})

test('a manual ceiling keeps its regions on itself', () => {
  paint(manual, 'region:own', 'library:red')
  expect((current(manual.id) as CeilingNode).regions?.[0]?.finish).toBe('library:red')
  paint(current(manual.id), 'region:own')
  expect((current(manual.id) as CeilingNode).regions).toBeUndefined()
  expect(current(zone.id)).toBe(zone)
})

test('the hover preview swaps exactly the region mesh; erase shows the ceiling under it', () => {
  const ceilingMaterial = new MeshBasicMaterial()
  const regionMaterial = new MeshBasicMaterial()
  const root = new Mesh(undefined, ceilingMaterial)
  const region = new Mesh(undefined, regionMaterial)
  region.name = CEILING_REGION_MESH
  region.userData.paintRole = 'region:patch'
  root.add(region)

  const restore = ceilingPaint.applyPreview({
    node: auto,
    role: 'region:patch',
    material: undefined,
    materialPreset: undefined,
    root,
  })
  expect(region.material).toBe(ceilingMaterial)
  expect(root.material).toBe(ceilingMaterial)
  restore?.()
  expect(region.material).toBe(regionMaterial)

  const recolor = ceilingPaint.applyPreview({
    node: auto,
    role: 'region:patch',
    material: { preset: 'custom', properties: { color: '#ff0000' } } as never,
    materialPreset: undefined,
    root,
  })
  expect(region.material).not.toBe(regionMaterial)
  expect(root.material).toBe(ceilingMaterial)
  recolor?.()
  expect(region.material).toBe(regionMaterial)
})
