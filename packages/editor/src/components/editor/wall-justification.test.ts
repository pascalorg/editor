import { afterEach, expect, test } from 'bun:test'
import {
  getWallBodyLine,
  ItemNode,
  LevelNode,
  useScene,
  type WallEvent,
  WallNode,
} from '@pascal-app/core'
import { Mesh, Vector3 } from 'three'
import { wallPushHandles } from '../../lib/room-handle-drag'
import { duplicateNodesToLevel } from '../../lib/scene-clipboard'
import { wallStrategy } from '../tools/item/placement-strategies'
import type { PlacementContext, SpatialValidators } from '../tools/item/placement-types'
import {
  collectParticipants,
  rotateGroupPatches,
  rotateGroupSnapshots,
  translateGroupPatches,
} from './group-transform-shared'

globalThis.requestAnimationFrame ??= () => 0
globalThis.cancelAnimationFrame ??= () => {}
const original = useScene.getState()
afterEach(() => useScene.setState(original))
const wall = () =>
  WallNode.parse({ start: [0, 0], end: [4, 0], thickness: 0.2, justification: 'a' })

test('3D side handles follow the actual faces of a justified wall', () => {
  const w = wall()
  const handles = wallPushHandles(w, {})
  expect(handles[0]!.position[1]).toBeCloseTo(0.47)
  expect(handles[1]!.position[1]).toBeCloseTo(-0.33)
  const opposite = wallPushHandles({ ...w, justification: 'b' }, {})
  expect(opposite[0]!.position[1]).toBeCloseTo(0.33)
  expect(opposite[1]!.position[1]).toBeCloseTo(-0.47)
})

test('group rotation and translation preserve wall orientation and carry the body rigidly', () => {
  const w = wall()
  const starts = [{ id: w.id, kind: 'endpoint' as const, start: w.start, end: w.end }]
  const rotated = {
    ...w,
    ...rotateGroupPatches(starts, [], { x: 0, z: 0 }, Math.PI)[0]![1],
  } as WallNode
  expect(rotated.justification).toBe('a')
  expect(getWallBodyLine(rotated).start.y).toBeCloseTo(-0.1)
  expect(getWallBodyLine(rotated).end.x).toBeCloseTo(-4)
  const moved = { ...w, ...translateGroupPatches(starts, [], 2, 3)[0]![1] } as WallNode
  expect(getWallBodyLine(moved)).toEqual({ start: { x: 2, y: 3.1 }, end: { x: 6, y: 3.1 } })
})

test('clipboard duplicate preserves justification and endpoint order', () => {
  const level = LevelNode.parse({})
  const w = { ...wall(), parentId: level.id }
  useScene.setState({
    nodes: { [level.id]: { ...level, children: [w.id] }, [w.id]: w },
    rootNodeIds: [level.id],
  })
  const result = duplicateNodesToLevel([w.id], level.id)!
  const duplicate = useScene.getState().nodes[result.pastedIds[0]!] as WallNode
  expect(duplicate.justification).toBe('a')
  expect(getWallBodyLine(duplicate)).toEqual(getWallBodyLine(w))
})

for (const attachTo of ['wall', 'wall-side'] as const)
  for (const side of ['front', 'back'] as const)
    test(`placement cursor follows ${attachTo} ${side} offset`, () => {
      const w = wall()
      const asset = {
        id: 'test',
        name: 'test',
        category: 'test',
        thumbnail: '/test.png',
        src: '/test.glb',
        dimensions: [0.5, 0.5, 0.2] as [number, number, number],
        attachTo,
      }
      const item = ItemNode.parse({ asset, parentId: w.id })
      const object = new Mesh()
      const ctx: PlacementContext = {
        asset,
        draftItem: item,
        levelId: 'level_test',
        gridPosition: new Vector3(),
        currentCursorRotationY: 0,
        state: {
          surface: 'wall',
          wallId: w.id,
          roofSegmentId: null,
          ceilingId: null,
          surfaceItemId: null,
          shelfId: null,
        },
      }
      const event = {
        node: w,
        object,
        localPosition: [2, 1, 0],
        normal: [0, 0, side === 'front' ? 1 : -1],
      } as unknown as WallEvent
      const validators = { canPlaceOnWall: () => ({ valid: true }) } as unknown as SpatialValidators
      const result = wallStrategy.move(ctx, event, validators)!
      const expected = attachTo === 'wall' ? 0.1 : side === 'front' ? 0.2 : 0
      expect(result.cursorPosition[2]).toBeCloseTo(expected)
      expect(result.gridPosition[2]).toBeCloseTo(attachTo === 'wall' ? 0 : expected)
      object.geometry.dispose()
    })

test('group linked endpoint crossing and snapshot reseeding keep stored orientation', () => {
  const level = LevelNode.parse({})
  const selected = { ...wall(), parentId: level.id }
  const linked = WallNode.parse({
    parentId: level.id,
    start: [4, 0],
    end: [6, 0],
    thickness: 0.2,
    justification: 'a',
  })
  const { starts, links } = collectParticipants(
    [selected.id],
    { [selected.id]: selected, [linked.id]: linked },
    level.id,
  )
  const moved = {
    ...linked,
    ...translateGroupPatches(starts, links, 4, 0).find(([id]) => id === linked.id)![1],
  } as WallNode
  expect(moved.justification).toBe('a')
  expect(getWallBodyLine(moved).start.y).toBeCloseTo(-0.1)
  const rotated = rotateGroupSnapshots(starts, links, { x: 6, z: 0 }, Math.PI)
  const reseeded = {
    ...linked,
    ...translateGroupPatches(rotated.starts, rotated.links, 0, 0).find(
      ([id]) => id === linked.id,
    )![1],
  } as WallNode
  expect(reseeded.justification).toBe('a')
  expect(getWallBodyLine(reseeded).start.y).toBeCloseTo(-0.1)
})
