import { afterEach, describe, expect, test } from 'bun:test'
import { spatialGridManager } from '../hooks/spatial-grid/spatial-grid-manager'
import { getLevelElevations, getWallPlaneTop, setFloorFoundation, useScene } from '../index'
import { getLevelDisplayName } from '../lib/level-name'
import { reconcileSceneStructure } from '../lib/structure-reconcile'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  ItemNode,
  LevelNode,
  SlabNode,
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

describe('duplicate names', () => {
  // Names as the level selector shows them, bottom to top.
  function duplicate(sourceName: string | undefined, position: 'above' | 'below') {
    const building = BuildingNode.parse({})
    const ground = LevelNode.parse({ level: 0, name: sourceName, parentId: building.id })
    const legacy = LevelNode.parse({ level: 1, name: 'Level 1', parentId: building.id })
    const attic = LevelNode.parse({ level: 2, name: 'Attic', parentId: building.id })
    const levels = [ground, legacy, attic]
    const nodes = Object.fromEntries(
      [{ ...building, children: levels.map((level) => level.id) }, ...levels].map((node) => [
        node.id,
        node,
      ]),
    ) as Record<AnyNodeId, AnyNode>
    const { createOps, updateOps } = buildLevelDuplicateCreateOps({
      nodes,
      level: ground,
      levels,
      preset: 'everything',
      position,
    })
    const after = { ...nodes, ...Object.fromEntries(createOps.map(({ node }) => [node.id, node])) }
    for (const { id, data } of updateOps) after[id] = { ...after[id], ...data } as AnyNode
    return Object.values(after)
      .filter((node): node is LevelNode => node.type === 'level')
      .sort((a, b) => a.level - b.level)
      .map(getLevelDisplayName)
  }

  for (const sourceName of ['Level 0', 'Ground floor', undefined]) {
    test(`a copy of the ${sourceName ?? 'unnamed'} ground floor reads by its place, like an added level`, () => {
      expect(duplicate(sourceName, 'above')).toEqual([
        'Ground floor',
        'Floor 1',
        'Floor 2',
        'Attic',
      ])
      expect(duplicate(sourceName, 'below')).toEqual([
        'Ground floor',
        'Floor 1',
        'Floor 2',
        'Attic',
      ])
    })
  }

  test('a name someone gave stays with its level, and the copy reads by its place', () => {
    expect(duplicate('Kitchen floor', 'above')).toEqual([
      'Kitchen floor',
      'Floor 1',
      'Floor 2',
      'Attic',
    ])
    expect(duplicate('Kitchen floor', 'below')).toEqual([
      'Ground floor',
      'Kitchen floor',
      'Floor 2',
      'Attic',
    ])
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
      expect(surface.id).not.toBe(
        Object.values(nodes).find((node) => node.type === surface.type)?.id,
      )
    }
    expect(surfaces.find((node) => node.type === 'slab')).toMatchObject({ zoneIds: [room.id] })
    expect(surfaces.find((node) => node.type === 'ceiling')).toMatchObject({ zoneId: room.id })
  })

  for (const preset of [
    'everything',
    'structure',
    'structure-materials',
    'structure-furniture',
  ] as const) {
    for (const position of ['above', 'below'] as const) {
      test(`duplicates a foundation level ${position} with ${preset}: one plate, no gap, ordinal names`, () => {
        const fixture = roomLevel()
        let nodes = fixture.nodes
        const plate = Object.values(nodes).find((node) => node.type === 'slab')!
        nodes = { ...nodes, [plate.id]: { ...plate, referenceFloorElevation: 0.05 } as AnyNode }
        const plan = setFloorFoundation(nodes, {
          slabId: plate.id,
          patch: { thickness: 0.2, foundationHeight: 0.6 },
        })
        expect(plan.conflicts).toEqual([])
        for (const change of plan.changes) {
          if (change.op === 'update')
            nodes = { ...nodes, [change.id]: { ...nodes[change.id], ...change.data } as AnyNode }
        }
        nodes = reconcile(nodes)
        const level = { ...nodes[fixture.level.id], name: 'Ground floor' } as LevelNode
        nodes = { ...nodes, [level.id]: level }
        const before = structuredClone(nodes)
        const { createOps, newLevelId, updateOps } = buildLevelDuplicateCreateOps({
          nodes,
          level,
          levels: [level],
          preset,
          position,
        })
        expect(() =>
          assertDerivedNodeWrites(nodes, { create: createOps, update: updateOps }),
        ).not.toThrow()
        useScene
          .getState()
          .setScene(nodes, [Object.values(nodes).find((node) => node.type === 'building')!.id])
        useScene.getState().applyNodeChanges({ create: createOps, update: updateOps })
        const stored = useScene.getState().nodes
        const storedUpperId = position === 'above' ? newLevelId : level.id
        const storedUpper = Object.values(stored).find(
          (node) => node.type === 'slab' && node.parentId === storedUpperId,
        )
        expect(storedUpper).toMatchObject({
          elevation: 0.2,
          thickness: 0.2,
          foundation: { type: 'none' },
        })
        const draft = {
          ...nodes,
          ...Object.fromEntries(createOps.map(({ node }) => [node.id, node])),
        }
        for (const { id, data } of updateOps) draft[id] = { ...draft[id], ...data } as AnyNode
        const after = reconcile(draft)
        expect(nodes).toEqual(before)
        const groundId = position === 'above' ? level.id : newLevelId
        const upperId = position === 'above' ? newLevelId : level.id
        expect(after[groundId]).toMatchObject({ level: 0 })
        expect(after[upperId]).toMatchObject({ level: 1, baseElevation: 0 })
        expect(getLevelDisplayName(after[groundId] as LevelNode)).toBe('Ground floor')
        expect(getLevelDisplayName(after[upperId] as LevelNode)).toBe('Floor 1')
        expect(after[newLevelId]).not.toHaveProperty('name')
        const plates = Object.values(after).filter((node) => node.type === 'slab')
        expect(plates).toHaveLength(2)
        const ground = plates.find((node) => node.parentId === groundId)!
        const upper = plates.find((node) => node.parentId === upperId)!
        if (ground.type !== 'slab' || upper.type !== 'slab') throw new Error('missing plate')
        expect(ground).toMatchObject({
          thickness: 0.2,
          floorHeight: 0.8,
          foundation: { type: 'solid' },
        })
        expect(upper).toMatchObject({
          thickness: 0.2,
          foundation: { type: 'none' },
          boundary: 'auto',
        })
        expect(upper.floorHeight).toBeUndefined()
        const elevations = getLevelElevations(after)
        const wall = Object.values(after).find(
          (node) => node.type === 'wall' && node.parentId === groundId,
        )!
        if (wall.type !== 'wall') throw new Error('missing wall')
        const wallTop = elevations.get(groundId)!.baseY + getWallPlaneTop(wall, groundId, after)
        const underside = elevations.get(upperId)!.baseY + upper.elevation - upper.thickness
        expect(underside).toBeCloseTo(wallTop, 6)
        expect(underside).toBeCloseTo(3.25, 6)
        expect(reconcile(after)).toEqual(after)
      })
    }
  }

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

  test('a ceiling light follows its ceiling onto the copy', () => {
    const fixture = roomLevel()
    const ceiling = Object.values(fixture.nodes).find((node) => node.type === 'ceiling')!
    const lamp = ItemNode.parse({
      parentId: ceiling.id,
      position: [3, 0, 2],
      asset: {
        id: 'lamp',
        category: 'lighting',
        name: 'Lamp',
        thumbnail: '/lamp.png',
        src: '/lamp.glb',
        dimensions: [0.5, 0.5, 0.5],
        attachTo: 'ceiling',
      },
    })
    const nodes = {
      ...fixture.nodes,
      [lamp.id]: lamp,
      [ceiling.id]: { ...ceiling, children: [lamp.id] } as AnyNode,
    }
    const { createOps, newLevelId } = buildLevelDuplicateCreateOps({
      nodes,
      level: fixture.level,
      levels: [fixture.level],
      preset: 'everything',
    })
    const copies = createOps.map(({ node }) => node)
    const copiedCeiling = copies.find((node) => node.type === 'ceiling')!
    const copiedLamp = copies.find((node) => node.type === 'item')!
    expect(copiedCeiling.parentId).toBe(newLevelId)
    expect(copiedLamp.parentId).toBe(copiedCeiling.id)
    expect(copiedCeiling.type === 'ceiling' && copiedCeiling.children).toEqual([copiedLamp.id])
  })

  test('regenerates one plate per disconnected footprint and leaves manual slabs authored', () => {
    const fixture = roomLevel()
    const extraWalls = Object.values(fixture.nodes).flatMap((node) =>
      node.type === 'wall'
        ? [
            WallNode.parse({
              ...node,
              id: undefined,
              children: [],
              start: [node.start[0] + 12, node.start[1]],
              end: [node.end[0] + 12, node.end[1]],
            }),
          ]
        : [],
    )
    const manual = SlabNode.parse({
      parentId: fixture.level.id,
      polygon: [
        [20, -5],
        [22, -5],
        [22, -3],
        [20, -3],
      ],
      thickness: 0.3,
      elevation: 0.5,
    })
    const nodes = reconcile({
      ...fixture.nodes,
      ...Object.fromEntries(extraWalls.map((node) => [node.id, node])),
      [manual.id]: manual,
    })
    const level = nodes[fixture.level.id] as LevelNode
    expect(
      Object.values(nodes).filter((node) => node.type === 'slab' && node.boundary === 'auto'),
    ).toHaveLength(2)
    const { createOps, newLevelId } = buildLevelDuplicateCreateOps({
      nodes,
      level,
      levels: [level],
      preset: 'everything',
    })
    const result = reconcile({
      ...nodes,
      ...Object.fromEntries(createOps.map(({ node }) => [node.id, node])),
    })
    const plates = Object.values(result).filter(
      (node) => node.type === 'slab' && node.parentId === newLevelId,
    )
    expect(plates.filter((node) => node.type === 'slab' && node.boundary === 'auto')).toHaveLength(
      2,
    )
    expect(plates.filter((node) => node.type === 'slab' && node.boundary !== 'auto')).toEqual([
      expect.objectContaining({ polygon: manual.polygon, thickness: 0.3, elevation: 0.5 }),
    ])
  })
})
