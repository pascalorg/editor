import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  SpawnNode,
  UnitNode,
  WallNode,
  ZoneNode,
} from '@pascal-app/core/schema'
import { buildLevelDuplicateCreateOps } from './level-duplication'

describe('buildLevelDuplicateCreateOps', () => {
  test('parents a duplicated bootstrap level back to its building', () => {
    const level = LevelNode.parse({ level: 0, height: 3.25, children: [] })
    const building = BuildingNode.parse({ children: [level.id] })
    const wall = WallNode.parse({
      parentId: level.id,
      start: [0, 0],
      end: [4, 0],
    })
    const sourceLevel = { ...level, children: [wall.id] } satisfies LevelNode
    const nodes = {
      [building.id]: building,
      [sourceLevel.id]: sourceLevel,
      [wall.id]: wall,
    } as Record<AnyNodeId, AnyNode>

    const { createOps, newLevelId } = buildLevelDuplicateCreateOps({
      nodes,
      level: sourceLevel,
      levels: [sourceLevel],
      preset: 'everything',
    })

    const levelCreateOp = createOps.find((op) => op.node.id === newLevelId)

    expect(sourceLevel.parentId).toBeNull()
    expect(levelCreateOp?.parentId).toBe(building.id)
    expect(levelCreateOp?.node.type === 'level' ? levelCreateOp.node.height : undefined).toBe(3.25)
  })

  test('does not copy spawn points from the source level', () => {
    const building = BuildingNode.parse({})
    const spawn = SpawnNode.parse({ parentId: 'level_source' })
    const level = LevelNode.parse({
      id: 'level_source',
      level: 0,
      parentId: building.id,
      children: [spawn.id],
    })
    const nodes = {
      [building.id]: { ...building, children: [level.id] },
      [level.id]: level,
      [spawn.id]: spawn,
    } as Record<AnyNodeId, AnyNode>

    const { createOps, newLevelId } = buildLevelDuplicateCreateOps({
      nodes,
      level,
      levels: [level],
      preset: 'everything',
    })

    const copiedLevel = createOps.find((op) => op.node.id === newLevelId)?.node as
      | LevelNode
      | undefined

    expect(createOps.some((op) => op.node.type === 'spawn')).toBe(false)
    expect(copiedLevel?.children).toEqual([])
  })
})

describe('unit duplication', () => {
  for (const preset of [
    'everything',
    'structure',
    'structure-materials',
    'structure-furniture',
  ] as const) {
    test(`duplicates only units wholly on the source level with ${preset}`, () => {
      const building = BuildingNode.parse({})
      const level = LevelNode.parse({ parentId: building.id, level: 0 })
      const upper = LevelNode.parse({ parentId: building.id, level: 1 })
      const kitchen = ZoneNode.parse({ parentId: level.id, name: 'Kitchen', polygon: [] })
      const living = ZoneNode.parse({ parentId: level.id, name: 'Living', polygon: [] })
      const bedroom = ZoneNode.parse({ parentId: upper.id, name: 'Bedroom', polygon: [] })
      const single = UnitNode.parse({
        parentId: building.id,
        name: 'Suite',
        kind: 'hotel-room',
        color: '#123456',
        members: [kitchen.id, living.id],
      })
      const duplex = UnitNode.parse({
        parentId: building.id,
        name: 'Duplex',
        members: [living.id, bedroom.id],
      })
      const empty = UnitNode.parse({ parentId: building.id })
      const dangling = UnitNode.parse({
        parentId: building.id,
        members: [kitchen.id, 'zone_missing'],
      })
      level.children = [kitchen.id, living.id]
      upper.children = [bedroom.id]
      building.children = [level.id, upper.id, single.id, duplex.id, empty.id, dangling.id]
      const nodes: Record<AnyNodeId, AnyNode> = Object.fromEntries(
        [building, level, upper, kitchen, living, bedroom, single, duplex, empty, dangling].map(
          (node) => [node.id, node],
        ),
      )
      const before = structuredClone(nodes)
      const { createOps, newLevelId, shiftedLevels } = buildLevelDuplicateCreateOps({
        nodes,
        level,
        levels: [level, upper],
        preset,
      })
      const unitOps = createOps.filter((op) => op.node.type === 'unit')
      expect(unitOps).toHaveLength(1)
      const op = unitOps[0]!
      expect(op.parentId).toBe(building.id)
      expect(op.node.type).toBe('unit')
      if (op.node.type !== 'unit') return
      expect(op.node.id).not.toBe(single.id)
      expect(op.node.name).toBe('Suite copy')
      expect(op.node.kind).toBe(single.kind)
      expect(op.node.color).toBe(single.color)
      expect(op.node.parentId).toBe(building.id)
      expect(op.node.members).toEqual(
        createOps.flatMap((entry) => (entry.node.type === 'zone' ? [entry.node.id] : [])),
      )
      expect(
        createOps
          .filter((entry) => entry.node.type === 'zone')
          .every((entry) => entry.parentId === newLevelId),
      ).toBe(true)
      expect(shiftedLevels).toEqual([{ id: upper.id, level: 2 }])
      expect(nodes).toEqual(before)
    })
  }
})
