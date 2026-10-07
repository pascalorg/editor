import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  area,
  CeilingNode,
  clearSceneHistory,
  LevelNode,
  useScene,
  ZoneNode,
} from '@pascal-app/core'
import useEditor from '../store/use-editor'
import {
  describeCeilingRegionRoom,
  floorRegionRoomGone,
  moveFloorRegion,
  PICK_MATERIAL_MESSAGE,
  pressFloorRegion,
  releaseFloorRegion,
  useFloorRegionDraft,
} from './floor-region-session'
import type { FloorRegionPoint } from './floor-region-snap'
import { paintRegionHoverHint, usePaintRegionMode } from './paint-region-mode'

// Rectangle and Polygon on a ceiling: the floor's outline gesture, drawn on the
// ceiling's underside, committing one region to the room (an automatic
// ceiling) or to the ceiling (a manual one) in one undo step.

const square = (x: number, z: number, size: number): [number, number][] => [
  [x, z],
  [x + size, z],
  [x + size, z + size],
  [x, z + size],
]
const OFF = { mode: 'off', step: 0.5 } as const
const CLOSE = 0.2

const level = LevelNode.parse({ id: 'level_ceiling_region' })
const zone = ZoneNode.parse({
  id: 'zone_ceiling_region',
  name: 'Room',
  parentId: level.id,
  polygon: square(0, 0, 4),
  floor: { regions: [{ id: 'rug', polygon: square(1, 1, 1), finish: 'library:tile' }] },
})
// A floor opening cut the room's ceiling in two; both parts are the room's.
const west = CeilingNode.parse({
  id: 'ceiling_west',
  parentId: level.id,
  polygon: [
    [0, 0],
    [2, 0],
    [2, 4],
    [0, 4],
  ],
  boundary: 'auto',
  zoneId: zone.id,
  height: 2.5,
})
const east = CeilingNode.parse({
  ...west,
  id: 'ceiling_east',
  polygon: [
    [2.5, 0],
    [4, 0],
    [4, 4],
    [2.5, 4],
  ],
})
const manual = CeilingNode.parse({
  id: 'ceiling_manual',
  parentId: level.id,
  polygon: square(6, 0, 2),
  height: 2.2,
})
const nodes = Object.fromEntries(
  [level, zone, west, east, manual].map((node) => [node.id, node]),
) as Record<string, AnyNode>

const stubbed: string[] = []
const before = useScene.getState()
const node = <T extends AnyNode>(id: string) => useScene.getState().nodes[id as AnyNodeId] as T
const history = () => useScene.temporal.getState().pastStates.length

function drag(ceiling: CeilingNode, from: FloorRegionPoint, to: FloorRegionPoint) {
  const room = describeCeilingRegionRoom(useScene.getState().nodes, ceiling)
  pressFloorRegion('rectangle', room, from, OFF, CLOSE)
  moveFloorRegion(to, OFF, CLOSE)
  releaseFloorRegion(CLOSE)
}

beforeEach(() => {
  globalThis.requestAnimationFrame ??= (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame ??= () => {}
  if (!globalThis.window) {
    globalThis.window = new EventTarget() as Window & typeof globalThis
    stubbed.push('window')
  }
  useScene.setState({ nodes, materials: {}, readOnly: false })
  useScene.temporal.getState().resume()
  clearSceneHistory()
  useEditor.setState({
    mode: 'material-paint',
    activePaintMaterial: { materialPreset: 'library:blue', sourceTarget: 'ceiling' } as never,
  })
  usePaintRegionMode.getState().setMode('rectangle')
  useFloorRegionDraft.setState({ draft: null, hover: null })
})
afterEach(() => {
  useScene.setState(before)
  usePaintRegionMode.getState().setMode('surface')
  useFloorRegionDraft.setState({ draft: null, hover: null })
  useEditor.setState({ mode: 'select', activePaintMaterial: null })
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50))
  for (const key of stubbed.splice(0)) delete (globalThis as Record<string, unknown>)[key]
})

test('an automatic ceiling draws on every part of its room, at the plane it draws at', () => {
  const room = describeCeilingRegionRoom(nodes, west)
  expect(room).toMatchObject({ zoneId: zone.id, ceilingId: west.id, levelId: level.id })
  expect(room.elevation).toBeCloseTo(2.49)
  expect(area(room.clear)).toBeCloseTo(8 + 6)
  expect(describeCeilingRegionRoom(nodes, manual)).toMatchObject({ zoneId: manual.id })
})

test('a rectangle on a room ceiling paints one room region, clipped to the ceiling', () => {
  drag(west, [1, 1], [3, 3])
  const regions = node<ZoneNode>(zone.id).ceiling?.regions ?? []
  expect(regions).toHaveLength(1)
  expect(regions[0]!.finish).toBe('library:blue')
  // Across the opening gap: 1 × 2 on the west part, 0.5 × 2 on the east part.
  expect(area([{ outer: regions[0]!.polygon, holes: [] }])).toBeGreaterThan(2.9)
  expect(history()).toBe(1)
  // The floor is untouched.
  expect(node<ZoneNode>(zone.id).floor).toEqual(zone.floor)
  expect(useFloorRegionDraft.getState().draft).toBeNull()
})

test('a polygon on a manual ceiling paints the ceiling itself', () => {
  usePaintRegionMode.getState().setMode('polygon')
  const room = describeCeilingRegionRoom(useScene.getState().nodes, manual)
  for (const point of [
    [6.2, 0.2],
    [7.5, 0.2],
    [7.5, 1.5],
    [6.2, 0.2],
  ] as FloorRegionPoint[]) {
    pressFloorRegion('polygon', room, point, OFF, CLOSE)
    releaseFloorRegion(CLOSE)
  }
  expect(node<CeilingNode>(manual.id).regions).toHaveLength(1)
  expect(node<ZoneNode>(zone.id).ceiling).toBeUndefined()
  expect(history()).toBe(1)
})

test('outside the ceiling, or with nothing to paint with, nothing is written', () => {
  drag(manual, [10, 10], [12, 12])
  expect(node<CeilingNode>(manual.id).regions).toBeUndefined()
  useEditor.setState({ activePaintMaterial: null })
  drag(manual, [6.5, 0.5], [7.5, 1.5])
  expect(node<CeilingNode>(manual.id).regions).toBeUndefined()
  expect(usePaintRegionMode.getState().notice).toBe(PICK_MATERIAL_MESSAGE)
  expect(history()).toBe(0)
})

test('a ceiling draft ends when its ceiling goes; the hints name ceilings', () => {
  const room = describeCeilingRegionRoom(nodes, manual)
  pressFloorRegion('rectangle', room, [6.5, 0.5], OFF, CLOSE)
  const { [manual.id]: _, ...rest } = nodes
  expect(floorRegionRoomGone(rest)).toBe(true)
  expect(floorRegionRoomGone(nodes)).toBe(false)
  expect(paintRegionHoverHint('polygon')).toBe('Hover a floor or ceiling')
  expect(paintRegionHoverHint('rectangle')).toBe('Hover a wall, floor or ceiling')
})
