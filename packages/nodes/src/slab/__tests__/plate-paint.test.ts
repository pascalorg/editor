import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  MaterialSchema,
  SlabNode,
  useScene,
  type ZoneNode,
  ZoneNode as ZoneSchema,
} from '@pascal-app/core'
import { Group, Mesh, MeshBasicMaterial, Object3D } from 'three'
import { slabPaint } from '../paint'

globalThis.requestAnimationFrame ??= (callback: FrameRequestCallback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

const WOOD = 'library:wood-woodplank48'
const TILE = 'library:flooring-tiles3'

function hit(slotId: string) {
  const object = new Object3D()
  object.userData.slotId = slotId
  return object
}

function role(slotId: string) {
  return slabPaint.resolveRole({ node: plate, materialIndex: null, hitObject: hit(slotId) })
}

let plate: SlabNode
let manual: SlabNode
let zone: ZoneNode

beforeEach(() => {
  plate = SlabNode.parse({
    id: 'slab_plate',
    parentId: 'level_1',
    boundary: 'auto',
    autoFromWalls: true,
    zoneIds: ['zone_a'],
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
  })
  manual = SlabNode.parse({
    id: 'slab_manual',
    parentId: 'level_1',
    polygon: [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ],
  })
  zone = ZoneSchema.parse({
    id: 'zone_a',
    parentId: 'level_1',
    name: 'Kitchen',
    spaceRole: 'room',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
    floor: {
      finish: WOOD,
      regions: [
        {
          id: 'region_1',
          finish: TILE,
          polygon: [
            [0.5, 0.5],
            [2, 0.5],
            [2, 2],
            [0.5, 2],
          ],
        },
      ],
    },
  })
  useScene.setState({
    nodes: { [plate.id]: plate, [manual.id]: manual, [zone.id]: zone } as Record<
      AnyNodeId,
      AnyNode
    >,
    materials: {},
    dirtyNodes: new Set(),
    readOnly: false,
  })
  useScene.temporal.getState().clear()
})

afterEach(() => {
  useScene.setState({ nodes: {}, materials: {}, dirtyNodes: new Set(), readOnly: false })
  useScene.temporal.getState().clear()
})

function zoneNow(): ZoneNode {
  return useScene.getState().nodes.zone_a as ZoneNode
}

function slabNow(id: string): SlabNode {
  return useScene.getState().nodes[id as AnyNodeId] as SlabNode
}

describe('slab paint role resolution', () => {
  test('routes every plate face to its own role', () => {
    // Top inside a room → the room; top under a wall or outside every room →
    // the plate; sides by exposure; a manual slab keeps the single `side`.
    expect(role('room:zone_a')).toBe('room:zone_a')
    expect(role('room:zone_a/region_1')).toBe('room:zone_a/region_1')
    expect(role('surface')).toBe('surface')
    expect(role('edge')).toBe('edge')
    expect(role('riser')).toBe('riser')
    expect(role('underside')).toBe('underside')
    expect(role('side')).toBe('side')
    expect(
      slabPaint.resolveRole({ node: plate, materialIndex: null, hitObject: new Object3D() }),
    ).toBeNull()
  })

  test('labels a room role by the room it belongs to, never by the zone id', () => {
    expect(slabPaint.roleLabel?.(plate, 'room:zone_a')).toBe('Floor · Kitchen')
    expect(slabPaint.roleLabel?.(plate, 'step:zone_a')).toBe('Steps · Kitchen')
    expect(slabPaint.roleLabel?.(plate, 'edge:zone_a')).toBe('Floor edge · Kitchen')
    expect(slabPaint.roleLabel?.(plate, 'surface')).toBeNull()
  })
})

describe('slab paint commit', () => {
  test('painting the plate top inside a room writes the room finish', () => {
    slabPaint.commit?.({
      node: plate,
      role: 'room:zone_a',
      material: undefined,
      materialPreset: TILE,
    })
    expect(zoneNow().floor?.finish).toBe(TILE)
    expect(slabNow('slab_plate').slots).toBeUndefined()
  })

  test('painting a region writes that region, leaving the room finish alone', () => {
    slabPaint.commit?.({
      node: plate,
      role: 'room:zone_a/region_1',
      material: undefined,
      materialPreset: WOOD,
    })
    expect(zoneNow().floor?.regions?.[0]?.finish).toBe(WOOD)
    expect(zoneNow().floor?.finish).toBe(WOOD)
  })

  test('erasing a room finish clears the zone field, erasing a region drops it', () => {
    slabPaint.commit?.({
      node: plate,
      role: 'room:zone_a',
      material: undefined,
      materialPreset: undefined,
    })
    expect(zoneNow().floor?.finish).toBeUndefined()
    slabPaint.commit?.({
      node: plate,
      role: 'room:zone_a/region_1',
      material: undefined,
      materialPreset: undefined,
    })
    expect(zoneNow().floor?.regions).toEqual([])
  })

  test('a one-off colour on a room finish mints one shared scene material', () => {
    slabPaint.commit?.({
      node: plate,
      role: 'room:zone_a',
      material: MaterialSchema.parse({ properties: { color: '#ff0000' } }),
      materialPreset: undefined,
    })
    const materials = Object.values(useScene.getState().materials)
    expect(materials).toHaveLength(1)
    expect(zoneNow().floor?.finish).toBe(`scene:${materials[0]!.id}`)
  })

  test('painting the plate top outside a room or a side writes the slab slot', () => {
    slabPaint.commit?.({
      node: plate,
      role: 'surface',
      material: undefined,
      materialPreset: TILE,
    })
    slabPaint.commit?.({
      node: slabNow('slab_plate'),
      role: 'riser',
      material: undefined,
      materialPreset: WOOD,
    })
    expect(slabNow('slab_plate').slots).toEqual({ surface: TILE, riser: WOOD })
    expect(zoneNow().floor?.finish).toBe(WOOD)
  })

  test('a manual slab still paints its own side slot', () => {
    slabPaint.commit?.({ node: manual, role: 'side', material: undefined, materialPreset: TILE })
    expect(slabNow('slab_manual').slots).toEqual({ side: TILE })
  })
})

describe('slab paint effective material', () => {
  test('reads a room finish back for the picker', () => {
    expect(
      slabPaint.getEffectiveMaterial?.({
        nodes: useScene.getState().nodes,
        node: plate,
        role: 'room:zone_a',
      }),
    ).toEqual({
      material: undefined,
      materialPreset: WOOD,
    })
    expect(
      slabPaint.getEffectiveMaterial?.({
        nodes: useScene.getState().nodes,
        node: plate,
        role: 'room:zone_a/region_1',
      }),
    ).toEqual({ material: undefined, materialPreset: TILE })
    expect(
      slabPaint.getEffectiveMaterial?.({
        nodes: useScene.getState().nodes,
        node: plate,
        role: 'surface',
      }),
    ).toBeNull()
  })
})

test('room-owned riser resolves, previews, restores and commits the higher room finish', () => {
  const material = new MeshBasicMaterial()
  const mesh = new Mesh(undefined, material)
  mesh.userData = { slotId: 'riser', paintRole: `step:${zone.id}`, __fromGeometry: true }
  const root = new Group()
  root.add(mesh)
  const role = slabPaint.resolveRole({ node: plate, materialIndex: null, hitObject: mesh })!
  expect(role).toBe(`step:${zone.id}`)
  const restore = slabPaint.applyPreview?.({
    node: plate,
    root,
    role,
    material: MaterialSchema.parse({ properties: { color: '#123456' } }),
    materialPreset: undefined,
  })
  expect(restore).toBeFunction()
  expect(mesh.material).not.toBe(material)
  restore?.()
  expect(mesh.material).toBe(material)
  slabPaint.commit?.({ node: plate, role, material: undefined, materialPreset: TILE })
  expect(zoneNow().floorStepFinish).toBe(TILE)
  expect(zoneNow().floor).toEqual(zone.floor)
  expect(slabNow(plate.id).slots).toBeUndefined()
  mesh.geometry.dispose()
  material.dispose()
})

for (const [role, field] of [
  ['step', 'floorStepFinish'],
  ['edge', 'floorEdgeFinish'],
] as const) {
  test(`${role} paint changes only ${field}; erasing restores inheritance`, () => {
    const before = zoneNow()
    slabPaint.commit?.({
      node: plate,
      role: `${role}:${zone.id}`,
      material: undefined,
      materialPreset: TILE,
    })
    expect(zoneNow()).toEqual({ ...before, [field]: TILE })
    expect(slabNow(plate.id)).toEqual(plate)
    slabPaint.commit?.({
      node: plate,
      role: `${role}:${zone.id}`,
      material: undefined,
      materialPreset: undefined,
    })
    expect(zoneNow()[field]).toBeUndefined()
    expect(zoneNow().floor).toEqual(before.floor)
  })
}

test('foundation paint changes only its own material and erases to concrete', () => {
  plate = { ...plate, plateRole: 'base', foundation: { type: 'solid' }, slots: { edge: WOOD } }
  useScene.setState({ nodes: { ...useScene.getState().nodes, [plate.id]: plate } })
  const before = zoneNow()
  slabPaint.commit?.({ node: plate, role: 'foundation', material: undefined, materialPreset: TILE })
  expect(slabNow(plate.id).foundation).toEqual({ type: 'solid', material: TILE })
  expect(slabNow(plate.id).slots).toEqual({ edge: WOOD })
  expect(zoneNow()).toEqual(before)
  slabPaint.commit?.({
    node: slabNow(plate.id),
    role: 'foundation',
    material: undefined,
    materialPreset: undefined,
  })
  expect(slabNow(plate.id).foundation).toEqual({ type: 'solid', material: undefined })
  expect(
    slabPaint.getEffectiveMaterial?.({
      nodes: useScene.getState().nodes,
      node: slabNow(plate.id),
      role: 'foundation',
    }),
  ).toEqual({ material: undefined, materialPreset: 'library:concrete-raw' })
})

test('base surface paint routes to a covering room and never writes the protected slot', () => {
  plate = { ...plate, plateRole: 'base' }
  useScene.setState({ nodes: { ...useScene.getState().nodes, [plate.id]: plate } })
  expect(role('surface')).toBe('room:zone_a')
  slabPaint.commit?.({ node: plate, role: 'surface', material: undefined, materialPreset: TILE })
  expect(zoneNow().floor?.finish).toBe(TILE)
  expect(slabNow(plate.id).slots).toBeUndefined()
})

test.each([
  true,
  false,
])('foundation paint uses one undo step, including a new material: %s', (custom) => {
  plate = { ...plate, plateRole: 'base', foundation: { type: 'solid', material: WOOD } }
  useScene.setState({ nodes: { ...useScene.getState().nodes, [plate.id]: plate } })
  useScene.temporal.getState().clear()
  const before = useScene.getState().nodes
  slabPaint.commit?.({
    node: plate,
    role: 'foundation',
    material: custom ? MaterialSchema.parse({ properties: { color: '#123456' } }) : undefined,
    materialPreset: custom ? undefined : TILE,
  })
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  expect(slabNow(plate.id).foundation?.material).not.toBe(WOOD)
  if (custom) expect(Object.keys(useScene.getState().materials)).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(before)
  expect(useScene.getState().materials).toEqual({})
})

test('a zoneless base surface returns a notice instead of throwing or recording history', () => {
  plate = { ...plate, plateRole: 'base', zoneIds: [] }
  useScene.setState({ nodes: { ...useScene.getState().nodes, [plate.id]: plate } })
  useScene.temporal.getState().clear()
  const before = useScene.getState().nodes
  expect(
    slabPaint.commit({ node: plate, role: 'surface', material: undefined, materialPreset: TILE }),
  ).toMatchObject({ status: 'refused', code: 'floor-surface-without-room' })
  expect(useScene.getState().nodes).toBe(before)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})
