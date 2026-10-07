import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  MaterialSchema,
  type SlabNode,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import type { Group, Mesh } from 'three'
import { doorwayStepsFixture } from '../../../../core/src/systems/slab/__fixtures__/doorway-steps'
import { buildSlabGeometry } from '../geometry'
import { erasedSlabLook, slabPaint } from '../paint'

globalThis.requestAnimationFrame ??= (callback: FrameRequestCallback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

// B is raised between A and C: one step at each door. Painting one doorway's
// step must leave the other alone (the reported bug: one click repainted the
// steps toward every room).
const WOOD = 'library:wood-woodplank48'
const TILE = 'library:flooring-tiles3'
const RED = 'library:preset-red'

const zone = (id: string) => useScene.getState().nodes[id as AnyNodeId] as ZoneNode
const platform = () =>
  Object.values(useScene.getState().nodes).find(
    (node): node is SlabNode => node.type === 'slab' && node.plateRole === 'platform',
  )!
const paint = (role: string, materialPreset?: string) =>
  slabPaint.commit({ node: platform(), role, material: undefined, materialPreset })
const shows = (role: string) =>
  slabPaint.getEffectiveMaterial?.({
    materials: useScene.getState().materials,
    node: platform(),
    role,
    nodes: useScene.getState().nodes,
  })?.materialPreset

function build(textures = false): Group {
  const nodes = useScene.getState().nodes as Record<string, AnyNode>
  const plate = platform()
  const group = buildSlabGeometry(
    plate,
    {
      parent: nodes[plate.parentId!]!,
      resolve: (id) => nodes[id] as never,
      children: [],
      siblings: Object.values(nodes).filter((node) => node.parentId === plate.parentId),
      materials: useScene.getState().materials,
    },
    'rendered',
    textures,
  )
  // What the geometry system marks on the meshes it builds.
  for (const mesh of group.children) mesh.userData.__fromGeometry = true
  return group
}
const stepMeshes = (group: Group) =>
  Object.fromEntries(
    (group.children as Mesh[])
      .filter((mesh) => String(mesh.userData.paintRole).startsWith('step:'))
      .map((mesh) => [mesh.userData.paintRole as string, mesh]),
  )

beforeEach(() => {
  const nodes = doorwayStepsFixture()
  const b = nodes.zone_b as ZoneNode
  useScene.setState({
    nodes: { ...nodes, zone_b: { ...b, floor: { ...b.floor, finish: WOOD } } } as Record<
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

describe('a doorway step paints on its own', () => {
  test('the raised room draws one step mesh per door', () => {
    expect(Object.keys(stepMeshes(build())).sort()).toEqual([
      'step:zone_b/door_ab',
      'step:zone_b/door_bc',
    ])
  })

  test('painting the C-side step changes only that step, and undo/redo round-trip', () => {
    const before = useScene.getState().nodes
    paint('step:zone_b/door_bc', TILE)
    expect(zone('zone_b').floorStepOverrides).toEqual([{ key: 'door_bc', finish: TILE }])
    expect(zone('zone_b').floorStepFinish).toBeUndefined()
    for (const id of ['zone_a', 'zone_c'])
      expect(zone(id)).toBe(before[id as AnyNodeId] as ZoneNode)
    // The eyedropper reads each doorway on its own.
    expect(shows('step:zone_b/door_bc')).toBe(TILE)
    expect(shows('step:zone_b/door_ab')).toBe(WOOD)
    useScene.temporal.getState().undo()
    expect(zone('zone_b').floorStepOverrides).toBeUndefined()
    useScene.temporal.getState().redo()
    expect(zone('zone_b').floorStepOverrides).toEqual([{ key: 'door_bc', finish: TILE }])
  })

  test('the painted doorway draws its own material; the other keeps the room one', () => {
    const colour = (mesh: Mesh) =>
      (mesh.material as { color?: { getHexString: () => string } }).color?.getHexString()
    const red = MaterialSchema.parse({ properties: { color: '#ff0000' } })
    const green = MaterialSchema.parse({ properties: { color: '#00ff00' } })
    slabPaint.commit({
      node: platform(),
      role: 'room:zone_b',
      material: green,
      materialPreset: undefined,
    })
    slabPaint.commit({
      node: platform(),
      role: 'step:zone_b/door_bc',
      material: red,
      materialPreset: undefined,
    })
    const meshes = stepMeshes(build(true))
    expect(colour(meshes['step:zone_b/door_bc']!)).toBe('ff0000')
    expect(colour(meshes['step:zone_b/door_ab']!)).toBe('00ff00')
  })

  test('erasing a doorway falls back to the room steps, then the floor', () => {
    paint('step:zone_b', RED)
    paint('step:zone_b/door_bc', TILE)
    expect(erasedSlabLook({ node: platform(), role: 'step:zone_b/door_bc' } as never)).toEqual({
      materialPreset: RED,
    })
    paint('step:zone_b/door_bc')
    expect(zone('zone_b').floorStepOverrides).toBeUndefined()
    expect(shows('step:zone_b/door_bc')).toBe(RED)
    paint('step:zone_b')
    expect(shows('step:zone_b/door_bc')).toBe(WOOD)
  })

  test('the room scope paints every step of the room; a stranger doorway stays', () => {
    useScene.setState({
      nodes: {
        ...useScene.getState().nodes,
        zone_b: {
          ...zone('zone_b'),
          floorStepOverrides: [
            { key: 'door_bc', finish: TILE },
            { key: 'door_elsewhere', finish: TILE },
          ],
        },
      },
    })
    paint('step:zone_b', RED)
    expect(zone('zone_b').floorStepFinish).toBe(RED)
    expect(zone('zone_b').floorStepOverrides).toEqual([{ key: 'door_elsewhere', finish: TILE }])
    expect(shows('step:zone_b/door_bc')).toBe(RED)
    expect(shows('step:zone_b/door_ab')).toBe(RED)
  })

  test('a floor paint or room-wide erase never touches a doorway paint', () => {
    paint('step:zone_b/door_bc', TILE)
    paint('room:zone_b', RED)
    expect(zone('zone_b').floor?.finish).toBe(RED)
    expect(shows('step:zone_b/door_ab')).toBe(RED)
    expect(shows('step:zone_b/door_bc')).toBe(TILE)
    paint('room:zone_b/*')
    expect(zone('zone_b').floorStepOverrides).toEqual([{ key: 'door_bc', finish: TILE }])
  })
})

describe('the preview swaps exactly what the click paints', () => {
  const swapped = (role: string) => {
    const group = build()
    const meshes = stepMeshes(group)
    const before = new Map(Object.entries(meshes).map(([key, mesh]) => [key, mesh.material]))
    const restore = slabPaint.applyPreview({
      node: platform(),
      root: group,
      role,
      material: MaterialSchema.parse({ properties: { color: '#123456' } }),
      materialPreset: undefined,
    })
    const changed = Object.keys(meshes)
      .filter((key) => meshes[key]!.material !== before.get(key))
      .sort()
    restore?.()
    for (const [key, mesh] of Object.entries(meshes)) expect(mesh.material).toBe(before.get(key)!)
    return changed
  }

  test('one doorway, or every step in the room scope', () => {
    expect(swapped('step:zone_b/door_bc')).toEqual(['step:zone_b/door_bc'])
    expect(swapped('step:zone_b')).toEqual(['step:zone_b/door_ab', 'step:zone_b/door_bc'])
  })

  test('a room-wide floor paint carries the unpainted steps only', () => {
    paint('step:zone_b/door_bc', TILE)
    expect(swapped('room:zone_b/*')).toEqual(['step:zone_b/door_ab'])
  })
})
