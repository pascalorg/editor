import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNodeId,
  clearSceneHistory,
  useScene,
  WALL_FACE_REGION_LIMIT,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import { paintHints, paintRegionHints } from '../components/ui/helpers/helper-manager'
import { paintRegionHovering } from './paint-region-hover'
import { paintRegionModeActive, paintRegionTargets, usePaintRegionMode } from './paint-region-mode'
import {
  addFloorRegion,
  addWallRegion,
  removeWallRegion,
  updateWallRegion,
  WALL_REGION_CAP_MESSAGE,
} from './paint-regions'
import { snapContextOf } from './snapping-mode'

const wall = WallNode.parse({ id: 'wall_regions', start: [0, 0], end: [4, 0], thickness: 0.2 })
const zone = ZoneNode.parse({
  id: 'zone_regions',
  name: 'Room',
  polygon: [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ],
})
const before = useScene.getState()
beforeEach(() => {
  useScene.setState({ nodes: { [wall.id]: wall, [zone.id]: zone }, materials: {}, readOnly: false })
  useScene.temporal.getState().resume()
  clearSceneHistory()
})
afterEach(() => {
  useScene.setState(before)
  usePaintRegionMode.getState().setMode('surface')
})
const node = (id: string) => useScene.getState().nodes[id as AnyNodeId] as never

describe('paint regions', () => {
  test('a wall region is one undo step, carries only the given bounds, and edits in place', () => {
    const added = addWallRegion(wall.id, 'a', { v1: 0.9 }, { materialPreset: 'library:oak' })
    expect(added.ok).toBe(true)
    const regions = (node(wall.id) as WallNode).faceRegions!
    expect(regions).toHaveLength(1)
    expect(regions[0]).toMatchObject({ face: 'a', v1: 0.9, finish: 'library:oak' })
    expect('u0' in regions[0]!).toBe(false)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    const id = (added as { id: string }).id
    expect(updateWallRegion(wall.id, id, { v0: 0.2, v1: 1.1 })).toBe(true)
    expect((node(wall.id) as WallNode).faceRegions![0]).toMatchObject({ v0: 0.2, v1: 1.1 })
    expect(removeWallRegion(wall.id, id)).toBe(true)
    expect((node(wall.id) as WallNode).faceRegions).toBeUndefined()
    expect(useScene.temporal.getState().pastStates).toHaveLength(3)
  })

  test('a one-off colour mints one scene material, reused by the next region', () => {
    const material = { properties: { color: '#ff0000' } } as never
    addWallRegion(wall.id, 'a', { v1: 0.9 }, { material })
    addWallRegion(wall.id, 'b', { v0: 1 }, { material })
    expect(Object.keys(useScene.getState().materials)).toHaveLength(1)
    const [first, second] = (node(wall.id) as WallNode).faceRegions!
    expect(first!.finish).toBe(second!.finish)
    expect(addWallRegion(wall.id, 'a', {}, {})).toEqual({
      ok: false,
      message: 'Pick a material first',
    })
  })

  test('a full face refuses the next region with the cap message', () => {
    for (let i = 0; i < WALL_FACE_REGION_LIMIT; i++)
      expect(
        addWallRegion(wall.id, 'a', { u0: i * 0.4 }, { materialPreset: 'library:oak' }).ok,
      ).toBe(true)
    expect(addWallRegion(wall.id, 'a', { u0: 3.5 }, { materialPreset: 'library:oak' })).toEqual({
      ok: false,
      message: WALL_REGION_CAP_MESSAGE,
    })
    // The other face still has room.
    expect(addWallRegion(wall.id, 'b', {}, { materialPreset: 'library:oak' }).ok).toBe(true)
  })

  test('a floor region lands on the room floor in one step', () => {
    const square: [number, number][] = [
      [1, 1],
      [2, 1],
      [2, 2],
      [1, 2],
    ]
    expect(addFloorRegion(zone.id, square, { materialPreset: 'library:tile' }).ok).toBe(true)
    expect((node(zone.id) as ZoneNode).floor?.regions).toEqual([
      expect.objectContaining({ polygon: square, finish: 'library:tile' }),
    ])
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(addFloorRegion(zone.id, square.slice(0, 2), { materialPreset: 'library:tile' }).ok).toBe(
      false,
    )
  })
})

describe('paint region sub-mode', () => {
  test('owns the pointer and the snapping context only inside paint mode', () => {
    expect(paintRegionModeActive('material-paint')).toBe(false)
    usePaintRegionMode.getState().setMode('rectangle')
    expect(paintRegionModeActive('material-paint')).toBe(true)
    expect(paintRegionModeActive('select')).toBe(false)
    const ctx = (mode: string) =>
      snapContextOf({
        scope: { kind: 'idle' },
        mode,
        tool: null,
        profileOf: () => undefined,
        paintRegion: true,
      })
    expect(ctx('material-paint')).toBe('polygon')
    expect(ctx('select')).toBeNull()
  })

  test('each sub-mode names its surfaces and its HUD gesture', () => {
    expect(paintRegionTargets('rectangle')).toEqual({ wall: true, floor: true })
    expect(paintRegionTargets('polygon')).toEqual({ wall: false, floor: true })
    expect(paintRegionHints('polygon', null).map((hint) => hint.keys[0])).toEqual([
      'Left click',
      'Backspace',
      'Esc',
    ])
    expect(paintRegionHints('rectangle', WALL_REGION_CAP_MESSAGE)[0]).toMatchObject({
      label: WALL_REGION_CAP_MESSAGE,
      active: true,
    })
  })

  test('off anything it draws on, the HUD says where to go: a floor for Polygon', () => {
    expect(paintRegionHints('polygon', null, false).map((hint) => hint.label)).toEqual([
      'Hover a floor or ceiling',
      'Cancel',
    ])
    expect(paintRegionHints('rectangle', null, false)[0]).toMatchObject({
      label: 'Hover a wall, floor or ceiling',
      active: true,
    })
    expect(paintRegionHints('rectangle', null, true)[0]!.keys).toEqual(['Drag'])
  })

  test('the paint cursor is ready over what the sub-mode draws on, never blocked there', () => {
    expect(paintRegionHovering('rectangle', { wall: true, floor: false })).toBe(true)
    expect(paintRegionHovering('rectangle', { wall: false, floor: true })).toBe(true)
    expect(paintRegionHovering('polygon', { wall: true, floor: false })).toBe(false)
    expect(paintRegionHovering('polygon', { wall: false, floor: true })).toBe(true)
    expect(paintRegionHovering('rectangle', { wall: false, floor: false })).toBe(false)
  })
})

test('the whole-surface HUD says what a click does; only painting teaches the held eyedropper', () => {
  const labels = (mode: Parameters<typeof paintHints>[0]) =>
    paintHints(mode).map((hint) => hint.label)
  expect(labels('surface')).toEqual(['Hold to pick a material'])
  expect(labels('erase')).toEqual(['Remove a painted part, or reset a surface'])
  expect(labels('erase').some((label) => /pick|colour|color|paint with/i.test(label))).toBe(false)
  expect(labels('pick')).toEqual(['Paint with this material', 'Cancel'])
})
