import { describe, expect, test } from 'bun:test'
import type { AnyNode } from '../schema'
import { BuildingNode, LevelNode, WallNode } from '../schema'
import { DEFAULT_LEVEL_HEIGHT } from '../services/level-height'
import { migrateVerticalSceneNodes } from '../utils/scene-migrations'
import { fillLevelHeights, type LevelHeightWrite } from './level-height-fill'

// L68: a level written without a height is legacy to the editor's load, which derives its storey
// plane; the session that wrote it read 2.5 m. A write gives it the height the load would derive.
const building = BuildingNode.parse({ id: 'building_main' })
const scene = { [building.id]: building } as Record<string, AnyNode>
const heightless = (id: string) => {
  const { height: _height, ...level } = LevelNode.parse({ id, parentId: building.id, level: 0 })
  return level as unknown as AnyNode
}
const tallWalls = (levelId: string) =>
  (
    [
      [
        [0, 0],
        [4, 0],
      ],
      [
        [4, 0],
        [4, 4],
      ],
    ] as const
  ).map(([start, end], i) =>
    WallNode.parse({ id: `wall_${i}`, parentId: levelId, start, end, height: 3 }),
  )

/** What the editor's load makes of the same nodes, the level written without a height. */
const editorHeight = (levelId: string, nodes: AnyNode[]) => {
  const level = { ...heightless(levelId), children: nodes.map((node) => node.id) }
  const loaded = migrateVerticalSceneNodes({
    ...scene,
    [levelId]: level,
    ...Object.fromEntries(nodes.map((node) => [node.id, node])),
  } as never).nodes as Record<string, { height?: number }>
  return loaded[levelId]!.height
}

describe('a level written without a height', () => {
  test('created with its walls, gets the height the editor’s load derives from them', () => {
    const walls = tallWalls('level_up')
    const ops: LevelHeightWrite[] = [
      { op: 'create', node: heightless('level_up') },
      ...walls.map((node) => ({ op: 'create' as const, node })),
    ]
    const notes = fillLevelHeights(ops, scene)
    const height = (ops[0] as { node: { height?: number } }).node.height
    expect(height).toBe(editorHeight('level_up', walls)!)
    expect(height).not.toBe(DEFAULT_LEVEL_HEIGHT)
    expect(notes).toEqual([
      `level level_up: height ${Math.round(height! * 100) / 100} m derived from its walls and ceilings, as the editor reads a level written without one`,
    ])
  })

  test('created empty, gets the default storey height', () => {
    const ops: LevelHeightWrite[] = [{ op: 'create', node: heightless('level_empty') }]
    expect(fillLevelHeights(ops, scene)).toEqual([
      `level level_empty: height ${DEFAULT_LEVEL_HEIGHT} m, the default storey height, as nothing on it gives one`,
    ])
    expect((ops[0] as { node: { height?: number } }).node.height).toBe(DEFAULT_LEVEL_HEIGHT)
  })

  test('cleared by an update, gets the derived height back', () => {
    const walls = tallWalls('level_up')
    const level = {
      ...LevelNode.parse({ id: 'level_up', parentId: building.id, level: 0, height: 2.8 }),
      children: walls.map((wall) => wall.id),
    }
    const nodes = {
      ...scene,
      [level.id]: level,
      ...Object.fromEntries(walls.map((wall) => [wall.id, wall])),
    } as Record<string, AnyNode>
    const ops: LevelHeightWrite[] = [{ op: 'update', id: level.id, data: { height: undefined } }]
    fillLevelHeights(ops, nodes)
    expect((ops[0] as { data: { height?: number } }).data.height).toBe(
      editorHeight('level_up', walls)!,
    )
  })

  test('a level that has a height is written as sent', () => {
    const level = LevelNode.parse({ id: 'level_set', parentId: building.id, level: 0, height: 2.7 })
    const ops: LevelHeightWrite[] = [{ op: 'create', node: level }]
    expect(fillLevelHeights(ops, scene)).toEqual([])
    expect((ops[0] as { node: { height?: number } }).node.height).toBe(2.7)
  })
})
