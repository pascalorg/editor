import { afterEach, describe, expect, test } from 'bun:test'
import { spatialGridManager } from '../hooks/spatial-grid/spatial-grid-manager'
import { reconcileSceneStructure } from '../lib/structure-reconcile'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  SpawnNode,
  UnitNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '../schema'
import { assertDerivedNodeWrites, filterDerivedNodeWrites } from '../store/derived-node-guard'
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

describe('duplicated construction', () => {
  afterEach(() => spatialGridManager.clear())

  let serial = 0
  const mintId = (kind: string) => `${kind}_dup${++serial}`
  const reconcile = (nodes: Record<string, AnyNode>) =>
    reconcileSceneStructure({ nodes, mintId }).nodes as Record<AnyNodeId, AnyNode>

  /** A walled room with its derived floor plate and ceiling, and a window already past its wall top. */
  function roomLevel() {
    const ring: [number, number][] = [
      [0, 0],
      [6, 0],
      [6, 4],
      [0, 4],
    ]
    const walls = ring.map((start, i) =>
      WallNode.parse({ parentId: 'level_dup', start, end: ring[(i + 1) % 4], thickness: 0.2 }),
    )
    const window = WindowNode.parse({
      parentId: walls[0]!.id,
      wallId: walls[0]!.id,
      position: [3, 1.6, 0],
      width: 1.2,
      height: 2.4,
    })
    walls[0] = { ...walls[0]!, children: [window.id] }
    const building = BuildingNode.parse({ children: ['level_dup'] })
    const level = LevelNode.parse({
      id: 'level_dup',
      parentId: building.id,
      height: 2.5,
      children: walls.map((wall) => wall.id),
    })
    const nodes = reconcile(
      Object.fromEntries([building, level, ...walls, window].map((node) => [node.id, node])),
    )
    return { nodes, level: nodes[level.id] as LevelNode, window }
  }

  test('keeps one derived plate and ceiling per copied room, linked to the copy', () => {
    const { nodes, level } = roomLevel()
    const { createOps, newLevelId } = buildLevelDuplicateCreateOps({
      nodes,
      level,
      levels: [level],
      preset: 'everything',
    })
    // The editor's createNodes keeps the copy derived; the hosted bridges accept it as is.
    expect(filterDerivedNodeWrites(nodes, { create: createOps }).create).toEqual(createOps)
    expect(() => assertDerivedNodeWrites(nodes, { create: createOps })).not.toThrow()

    const copied = reconcile({
      ...nodes,
      ...Object.fromEntries(createOps.map(({ node }) => [node.id, node])),
    })
    const onCopy = Object.values(copied).filter((node) => node.parentId === newLevelId)
    const room = onCopy.find((node) => node.type === 'zone')!
    const surfaces = onCopy.filter((node) => node.type === 'slab' || node.type === 'ceiling')
    expect(surfaces.map((node) => node.type).sort()).toEqual(['ceiling', 'slab'])
    for (const surface of surfaces) {
      expect(surface).toMatchObject({ boundary: 'auto' })
      expect(createOps.some(({ node }) => node.id === surface.id)).toBe(true)
    }
    expect(surfaces.find((node) => node.type === 'slab')).toMatchObject({ zoneIds: [room.id] })
    expect(surfaces.find((node) => node.type === 'ceiling')).toMatchObject({ zoneId: room.id })
  })

  test('judges a copied window like its source, and still refuses a new one that does not fit', () => {
    const { nodes, level, window } = roomLevel()
    const { createOps } = buildLevelDuplicateCreateOps({
      nodes,
      level,
      levels: [level],
      preset: 'everything',
    })
    expect(createOps.some(({ node }) => node.type === 'window')).toBe(true)
    expect(() => assertDerivedNodeWrites(nodes, { create: createOps })).not.toThrow()
    const taller = WindowNode.parse({ ...window, id: undefined, height: 2.6 })
    expect(() => assertDerivedNodeWrites(nodes, { create: [{ node: taller }] })).toThrow(
      'does not fit',
    )
  })
})
