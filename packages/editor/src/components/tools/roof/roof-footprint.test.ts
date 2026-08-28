import { describe, expect, test } from 'bun:test'
import { emitter, LevelNode, type WallEvent, WallNode } from '@pascal-app/core'
import {
  fitRoofFootprint,
  parseRoofFootprintSource,
  resolveRoofFootprintElevation,
  resolveRoofFootprintWorldElevation,
  resolveRoofWallTopWorldElevation,
  resolveRoomRoofFootprint,
  subscribeToConicalRoofWallClicks,
} from './roof-footprint'

describe('roof footprint sources', () => {
  test('normalizes footprint sources for the selected roof type', () => {
    expect(parseRoofFootprintSource('room', 'conical')).toBe('walls')
    expect(parseRoofFootprintSource('draw', 'conical')).toBe('walls')
    expect(parseRoofFootprintSource('walls', 'hip')).toBe('room')
    expect(parseRoofFootprintSource('draw', 'hip')).toBe('draw')
  })

  test('fits a rotated rectangular room', () => {
    const target = fitRoofFootprint(
      'room-1',
      [
        [0, 0],
        [4, 4],
        [2, 6],
        [-2, 2],
      ],
      [],
    )

    expect(target?.rectangular).toBe(true)
    expect(target?.width).toBeCloseTo(Math.sqrt(32))
    expect(target?.depth).toBeCloseTo(Math.sqrt(8))
    expect(target?.center[0]).toBeCloseTo(1)
    expect(target?.center[1]).toBeCloseTo(3)
    expect(target?.rotation).toBeCloseTo(-Math.PI / 4)
  })

  test('marks curved and irregular rooms as non-rectangular', () => {
    const target = fitRoofFootprint(
      'room-2',
      [
        [0, 0],
        [4, 0],
        [4, 2],
        [2, 1],
        [0, 2],
      ],
      [],
    )
    expect(target?.rectangular).toBe(false)
  })

  test('keeps an L-shaped room available as straight-wall draw guides but not a room footprint', () => {
    const target = fitRoofFootprint(
      'room-l-shape',
      [
        [0, 0],
        [4, 0],
        [4, 2],
        [2, 2],
        [2, 4],
        [0, 4],
      ],
      [],
    )

    expect(target?.rectangular).toBe(false)
  })

  test('rejects curved and irregular rooms for rectangular-only roof footprints', () => {
    const walls = [
      WallNode.parse({ start: [0, 0], end: [4, 0] }),
      WallNode.parse({ start: [4, 0], end: [4, 2] }),
      WallNode.parse({ start: [4, 2], end: [2, 3] }),
      WallNode.parse({ start: [2, 3], end: [0, 2] }),
      WallNode.parse({ start: [0, 2], end: [0, 0] }),
    ]
    const level = LevelNode.parse({ children: walls.map((wall) => wall.id) })
    const nodes = Object.fromEntries([level, ...walls].map((node) => [node.id, node]))

    expect(resolveRoomRoofFootprint(level.id, nodes, [2, 1], { rectangularOnly: true })).toBeNull()
  })

  test('resolves the enclosed room beneath the pointer', () => {
    const walls = [
      WallNode.parse({ start: [0, 0], end: [4, 0] }),
      WallNode.parse({ start: [4, 0], end: [4, 3] }),
      WallNode.parse({ start: [4, 3], end: [0, 3] }),
      WallNode.parse({ start: [0, 3], end: [0, 0] }),
    ]
    const level = LevelNode.parse({ children: walls.map((wall) => wall.id) })
    const nodes = Object.fromEntries([level, ...walls].map((node) => [node.id, node]))

    const target = resolveRoomRoofFootprint(level.id, nodes, [2, 1])

    expect(target?.rectangular).toBe(true)
    expect(target?.wallIds).toHaveLength(4)
    expect(resolveRoomRoofFootprint(level.id, nodes, [8, 8])).toBeNull()
  })

  test('resolves a room on the level below the active roof level', () => {
    const walls = [
      WallNode.parse({ start: [0, 0], end: [4, 0] }),
      WallNode.parse({ start: [4, 0], end: [4, 3] }),
      WallNode.parse({ start: [4, 3], end: [0, 3] }),
      WallNode.parse({ start: [0, 3], end: [0, 0] }),
    ]
    const groundLevel = LevelNode.parse({
      children: walls.map((wall) => wall.id),
      level: 0,
    })
    const activeLevel = LevelNode.parse({ children: [], level: 1 })
    const nodes = Object.fromEntries(
      [groundLevel, activeLevel, ...walls].map((node) => [node.id, node]),
    )

    const target = resolveRoomRoofFootprint(activeLevel.id, nodes, [2, 1])

    expect(target?.wallIds).toHaveLength(4)
  })

  test('converts a lower-level room height into the active level frame', () => {
    const groundLevel = LevelNode.parse({ children: [], height: 3, level: 0 })
    const activeLevel = LevelNode.parse({ children: [], height: 3, level: 1 })
    const wall = WallNode.parse({
      parentId: groundLevel.id,
      start: [0, 0],
      end: [4, 0],
      height: 3,
    })
    const nodes = Object.fromEntries(
      [groundLevel, activeLevel, wall].map((node) => [node.id, node]),
    )
    const target = fitRoofFootprint(
      'room-ground',
      [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      [wall.id],
    )

    expect(target && resolveRoofFootprintElevation(activeLevel.id, target, nodes)).toBe(0)
    expect(target && resolveRoofFootprintWorldElevation(activeLevel.id, target, nodes)).toBe(3)
  })

  test('keeps a lower-level curved wall hover ghost in the active level world frame', () => {
    const groundLevel = LevelNode.parse({ children: [], height: 3, level: 0 })
    const activeLevel = LevelNode.parse({ children: [], height: 3, level: 1 })
    const wall = WallNode.parse({
      parentId: groundLevel.id,
      start: [-2, 0],
      end: [2, 0],
      curveOffset: 2,
      height: 3,
    })
    const nodes = Object.fromEntries(
      [groundLevel, activeLevel, wall].map((node) => [node.id, node]),
    )

    expect(resolveRoofWallTopWorldElevation(activeLevel.id, wall, nodes)).toBeCloseTo(3)
  })

  test('routes a curved wall click to conical wall placement', () => {
    const wall = WallNode.parse({ start: [-2, 0], end: [2, 0], curveOffset: 2 })
    const level = LevelNode.parse({ children: [wall.id], level: 0 })
    const wallOnLevel = { ...wall, parentId: level.id }
    const nodes = Object.fromEntries([level, wallOnLevel].map((node) => [node.id, node]))
    const selected: string[] = []
    const previewed: Array<string | null> = []
    let stopped = false
    const unsubscribe = subscribeToConicalRoofWallClicks({
      footprintSource: 'walls',
      currentLevelId: level.id,
      getNodes: () => nodes,
      onPreview: (previewWall) => previewed.push(previewWall?.id ?? null),
      onSelect: (selectedWall) => selected.push(selectedWall.id),
      roofType: 'conical',
    })

    emitter.emit('wall:enter', { node: wallOnLevel } as WallEvent)
    emitter.emit('wall:click', {
      node: wallOnLevel,
      stopPropagation: () => {
        stopped = true
      },
    } as WallEvent)
    emitter.emit('wall:leave', { node: wallOnLevel } as WallEvent)
    unsubscribe()

    expect(selected).toEqual([wall.id])
    expect(previewed).toEqual([wall.id, null])
    expect(stopped).toBe(true)
  })

  test('ignores curved walls more than one level below the active roof level', () => {
    const wall = WallNode.parse({
      parentId: 'level_ground',
      start: [-2, 0],
      end: [2, 0],
      curveOffset: 2,
    })
    const groundLevel = LevelNode.parse({ id: 'level_ground', children: [wall.id], level: 0 })
    const middleLevel = LevelNode.parse({ id: 'level_middle', children: [], level: 1 })
    const activeLevel = LevelNode.parse({ id: 'level_active', children: [], level: 2 })
    const nodes = Object.fromEntries(
      [groundLevel, middleLevel, activeLevel, wall].map((node) => [node.id, node]),
    )
    const previewed: Array<string | null> = []
    const selected: string[] = []
    const unsubscribe = subscribeToConicalRoofWallClicks({
      footprintSource: 'walls',
      currentLevelId: activeLevel.id,
      getNodes: () => nodes,
      onPreview: (previewWall) => previewed.push(previewWall?.id ?? null),
      onSelect: (selectedWall) => selected.push(selectedWall.id),
      roofType: 'conical',
    })

    emitter.emit('wall:enter', { node: wall } as WallEvent)
    emitter.emit('wall:click', { node: wall, stopPropagation: () => {} } as WallEvent)
    unsubscribe()

    expect(previewed).toEqual([])
    expect(selected).toEqual([])
  })
})
