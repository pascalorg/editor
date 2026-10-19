import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  SiteNode,
  SlabNode,
  WallNode,
} from '../schema'
import {
  assemblyThickness,
  resolveWallAssembly,
  wallAssemblyFraming,
} from '../systems/wall/wall-assembly'
import { planWallRectangle } from '../systems/wall/wall-operations'
import { planWallInsertion } from '../systems/wall/wall-topology'
import { FOUNDATION_CONSTRUCTIONS } from './foundation-construction'
import {
  foundationWallConstruction,
  levelHoldsFoundationWalls,
  wallsAgainstGround,
} from './foundation-wall'
import { genericFoundation } from './generic-foundation'
import { levelGradeStanding } from './grade-standing'
import { encodeTerrainField } from './terrain-codec'
import { createTerrainField } from './terrain-field'

type Nodes = Record<AnyNodeId, AnyNode>

const SQUARE: Array<[number, number]> = [
  [-4, -4],
  [4, -4],
  [4, 4],
  [-4, 4],
]

/** A basement under a ground floor; `terrainCm` raises the whole site's ground by that much. */
function house({
  named = false,
  terrainCm,
  y = 0,
  baseElevation = -2.5,
}: {
  named?: boolean
  terrainCm?: number
  y?: number
  baseElevation?: number
} = {}): Nodes {
  const terrain = (() => {
    if (terrainCm === undefined) return undefined
    const field = createTerrainField({ cols: 33, rows: 33, spacing: 1, origin: [-16, -16] })
    return encodeTerrainField({
      ...field,
      heights: new Int16Array(field.heights.length).fill(terrainCm),
    })
  })()
  const nodes: AnyNode[] = [
    SiteNode.parse({ id: 'site_a', children: ['building_a'], ...(terrain ? { terrain } : {}) }),
    BuildingNode.parse({
      id: 'building_a',
      parentId: 'site_a',
      children: ['level_base', 'level_main'],
      position: [0, y, 0],
      ...(named ? { groundLevelId: 'level_main' } : {}),
    }),
    LevelNode.parse({
      id: 'level_base',
      parentId: 'building_a',
      level: -1,
      baseElevation,
      height: 2.5,
      children: ['slab_base'],
    }),
    SlabNode.parse({ id: 'slab_base', parentId: 'level_base', polygon: SQUARE }),
    LevelNode.parse({
      id: 'level_main',
      parentId: 'building_a',
      level: 0,
      height: 2.5,
      children: ['slab_main'],
    }),
    SlabNode.parse({ id: 'slab_main', parentId: 'level_main', polygon: SQUARE }),
  ]
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as Nodes
}

const draw = (nodes: Nodes, levelId: string, wallDefaults?: Partial<WallNode>) => {
  const result = planWallInsertion(nodes, {
    levelId: levelId as AnyNodeId,
    start: [0, 0],
    end: [4, 0],
    joinRadius: 0,
    ...(wallDefaults ? { wallDefaults } : {}),
  })
  if (!result.ok) throw Error(result.reason)
  return result.plan.insertedWalls[0]!
}

describe('the default construction of a wall below grade', () => {
  test('the stack is 8 in of CMU and a 2x4 laid flat, and the thickness is their sum', () => {
    const [block, furring] = FOUNDATION_CONSTRUCTIONS.cmu.assembly.layers
    expect(block).toMatchObject({
      role: 'structure',
      core: true,
      material: 'cmu',
      thickness: 0.203,
    })
    expect(furring).toMatchObject({ role: 'furring', thickness: 0.038 })
    expect(foundationWallConstruction(FOUNDATION_CONSTRUCTIONS.cmu).thickness).toBe(0.241)
    expect(assemblyThickness(FOUNDATION_CONSTRUCTIONS.cmu.assembly)).toBeCloseTo(0.241, 12)
  })

  test('the wall the editor tool plans on a basement carries it; the ground floor does not', () => {
    const nodes = house()
    const below = draw(nodes, 'level_base')
    expect(below.thickness).toBe(0.241)
    expect(below.assembly?.layers.map((layer) => layer.id)).toEqual(['block', 'furring'])
    const above = draw(nodes, 'level_main')
    expect(above.assembly).toBeUndefined()
    expect(above.thickness).toBeUndefined()
  })

  test('the stack reads as a CMU core with its furring inside, drawn at its true thickness', () => {
    const wall = draw(house(), 'level_base')
    expect(wallAssemblyFraming(wall)).toEqual({ depth: 0.203, kind: 'cmu' })
    const resolved = resolveWallAssembly(wall)
    expect(resolved.total).toBeCloseTo(0.241, 9)
    expect(resolved.layers.reduce((sum, layer) => sum + layer.thickness, 0)).toBeCloseTo(0.241, 9)
    expect(resolved.layers.map((layer) => layer.material)).toEqual(['CMU', 'pressure-treated wood'])
  })

  test('a wall given a thickness or an assembly keeps what it was given', () => {
    const nodes = house()
    expect(draw(nodes, 'level_base', { thickness: 0.3 })).toMatchObject({ thickness: 0.3 })
    expect(draw(nodes, 'level_base', { thickness: 0.3 }).assembly).toBeUndefined()
    const own = {
      layers: [
        {
          id: 'framing',
          role: 'structure' as const,
          core: true,
          material: 'wood',
          thickness: 0.09,
        },
      ],
    }
    const kept = draw(nodes, 'level_base', { assembly: own, thickness: 0.09 })
    expect(kept.assembly).toEqual(own)
    expect(kept.thickness).toBe(0.09)
    expect(draw(nodes, 'level_base', { height: 2.4 }).thickness).toBe(0.241)
  })

  test('walls already drawn are not rewritten', () => {
    const nodes = house()
    const old = WallNode.parse({
      id: 'wall_old',
      parentId: 'level_base',
      start: [0, 0],
      end: [4, 0],
    })
    const withOld = { ...nodes, wall_old: old } as Nodes
    const result = planWallInsertion(withOld, {
      levelId: 'level_base' as AnyNodeId,
      start: [2, -2],
      end: [2, 2],
      joinRadius: 0.05,
    })
    if (!result.ok) throw Error(result.reason)
    const split = result.plan.changes.create.filter(({ node }) => node.type === 'wall')
    const inserted = result.plan.insertedWalls[0]!
    expect(inserted.assembly?.layers).toHaveLength(2)
    const insertedIds = new Set(result.plan.insertedWalls.map((wall) => wall.id))
    const replacements = split
      .map(({ node }) => node)
      .filter((node) => !insertedIds.has(node.id as WallNode['id']))
    expect(replacements.length).toBeGreaterThan(0)
    for (const node of replacements) {
      expect((node as WallNode).assembly).toBeUndefined()
      expect((node as WallNode).thickness).toBe(old.thickness)
    }
    expect(withOld.wall_old).toBe(old)
  })
})

describe('which levels hold foundation walls', () => {
  test('a basement does, the ground floor and what is over it do not', () => {
    const nodes = house()
    expect(levelHoldsFoundationWalls(nodes, 'level_base')).toBe(true)
    expect(levelHoldsFoundationWalls(nodes, 'level_main')).toBe(false)
    expect(levelHoldsFoundationWalls(nodes, 'wall_missing')).toBe(false)
  })

  test('on a hillside that buries the basement it does, named or not', () => {
    // The ground floor seated on the 1.5 m ground, 8 in over it.
    const seated = { named: true, terrainCm: 150, y: 1.703 }
    expect(levelHoldsFoundationWalls(house({ terrainCm: 150, y: 1.703 }), 'level_base')).toBe(true)
    expect(levelHoldsFoundationWalls(house(seated), 'level_base')).toBe(true)
    expect(levelHoldsFoundationWalls(house(seated), 'level_main')).toBe(false)
  })

  test('a basement under the named ground line that the terrain leaves out of the ground still does', () => {
    const nodes = house({ named: true, terrainCm: 0, baseElevation: 4 })
    expect(levelGradeStanding(nodes, 'level_base')).toBe('partly-below-grade')
    expect(levelHoldsFoundationWalls(nodes, 'level_base')).toBe(true)
    const unnamed = house({ terrainCm: 0, baseElevation: 4 })
    expect(levelHoldsFoundationWalls(unnamed, 'level_base')).toBe(false)
  })

  test('a ground floor the terrain buries over half is a below-grade floor', () => {
    const nodes = house({ terrainCm: 300 })
    expect(levelHoldsFoundationWalls(nodes, 'level_main')).toBe(true)
  })
})

type Segment = [[number, number], [number, number]]
const PERIMETER: Segment[] = [
  [
    [0, 0],
    [8, 0],
  ],
  [
    [8, 0],
    [8, 6],
  ],
  [
    [8, 6],
    [0, 6],
  ],
  [
    [0, 6],
    [0, 0],
  ],
]
const isFoundationWall = (wall: AnyNode | undefined) =>
  wall?.type === 'wall' && wall.thickness === 0.241 && wall.assembly?.layers.length === 2
const isPlainWall = (wall: AnyNode | undefined) =>
  wall?.type === 'wall' && wall.assembly === undefined && wall.thickness === undefined

/** Draws `segments` one after the other, as the wall tool does, each against what is already there. */
function drawEach(nodes: Nodes, levelId: string, segments: Segment[]) {
  const scene: Nodes = { ...nodes }
  const drawn: WallNode[][] = []
  for (const [start, end] of segments) {
    const result = planWallInsertion(scene, {
      levelId: levelId as AnyNodeId,
      start,
      end,
      joinRadius: 0.001,
    })
    if (!result.ok) throw Error(result.reason)
    for (const id of result.plan.changes.delete) delete scene[id]
    for (const { node, parentId } of result.plan.changes.create)
      scene[node.id] = { ...node, ...(parentId ? { parentId } : {}) } as AnyNode
    for (const { id, data } of result.plan.changes.update)
      if (scene[id]) scene[id] = { ...scene[id], ...data } as AnyNode
    drawn.push(result.plan.insertedWalls.map((wall) => scene[wall.id] as WallNode))
  }
  return { scene, drawn }
}

describe('only the walls against the ground are foundation walls', () => {
  test('a basement room drawn wall by wall is foundation all round, its partition is an ordinary wall', () => {
    const { scene, drawn } = drawEach(house(), 'level_base', [
      ...PERIMETER,
      [
        [4, 0],
        [4, 6],
      ],
    ])
    for (const walls of drawn.slice(0, 4))
      for (const wall of walls) expect(isFoundationWall(wall)).toBe(true)
    const partition = drawn[4]!
    expect(partition).toHaveLength(1)
    expect(isPlainWall(partition[0])).toBe(true)
    // the perimeter wall the partition split keeps the construction it was born with
    const pieces = Object.values(scene).filter(
      (node) => node.type === 'wall' && node.start[1] === 0 && node.end[1] === 0,
    )
    expect(pieces.length).toBeGreaterThan(1)
    for (const piece of pieces) expect(isFoundationWall(piece)).toBe(true)
  })

  test('a rectangle on a basement is foundation, and the partition drawn in it is not', () => {
    const nodes = house()
    const plan = planWallRectangle(nodes, {
      levelId: 'level_base' as AnyNodeId,
      start: [0, 0],
      end: [8, 6],
    })
    expect(plan.walls).toHaveLength(4)
    for (const wall of plan.walls) expect(isFoundationWall(wall)).toBe(true)
    const withRoom = { ...nodes }
    for (const { node, parentId } of plan.changes.create)
      withRoom[node.id] = { ...node, ...(parentId ? { parentId } : {}) } as AnyNode
    const { drawn } = drawEach(withRoom, 'level_base', [
      [
        [0, 3],
        [8, 3],
      ],
    ])
    expect(isPlainWall(drawn[0]![0])).toBe(true)
  })

  test('a wall added later on the outline is foundation; one inside is not', () => {
    const { scene } = drawEach(house(), 'level_base', PERIMETER)
    const { drawn } = drawEach(scene, 'level_base', [
      // a bay on the outside of the east wall
      [
        [8, 1],
        [11, 1],
      ],
      [
        [11, 1],
        [11, 4],
      ],
      [
        [11, 4],
        [8, 4],
      ],
      // a short wall that leaves the north wall into the room and stops
      [
        [3, 6],
        [3, 4],
      ],
      // one across the room
      [
        [0, 2],
        [8, 2],
      ],
    ])
    for (const walls of drawn.slice(0, 3))
      for (const wall of walls) expect(isFoundationWall(wall)).toBe(true)
    expect(isPlainWall(drawn[3]![0])).toBe(true)
    for (const wall of drawn[4]!) expect(isPlainWall(wall)).toBe(true)
  })

  test('a courtyard walled inside the outline holds no earth: its walls stay ordinary, a well outside the outline is foundation', () => {
    const { scene } = drawEach(house(), 'level_base', PERIMETER)
    const { drawn } = drawEach(scene, 'level_base', [
      // a courtyard ring inside the outline, touching none of its walls
      [
        [2, 1],
        [5, 1],
      ],
      [
        [5, 1],
        [5, 4],
      ],
      [
        [5, 4],
        [2, 4],
      ],
      [
        [2, 4],
        [2, 1],
      ],
      // a well on the outside of the east wall
      [
        [8, 1],
        [11, 1],
      ],
      [
        [11, 1],
        [11, 4],
      ],
      [
        [11, 4],
        [8, 4],
      ],
    ])
    for (const walls of drawn.slice(0, 4))
      for (const wall of walls) expect(isPlainWall(wall)).toBe(true)
    for (const walls of drawn.slice(4))
      for (const wall of walls) expect(isFoundationWall(wall)).toBe(true)
  })

  test('the walls a gesture draws are asked together: the candidates of one call', () => {
    const { scene } = drawEach(house(), 'level_base', PERIMETER)
    const walls = Object.values(scene).filter((node): node is WallNode => node.type === 'wall')
    const inner = WallNode.parse({
      id: 'wall_in',
      parentId: 'level_base',
      start: [0, 3],
      end: [8, 3],
    })
    const against = wallsAgainstGround(scene, 'level_base', [...walls, inner], [...walls, inner])
    expect(against.map((wall) => wall.id)).not.toContain('wall_in')
    expect(against.length).toBe(walls.length)
    expect(wallsAgainstGround(scene, 'level_main', [...walls, inner], [inner])).toEqual([])
  })

  test('above grade nothing changes: the ground floor draws plain walls, perimeter and partition', () => {
    const { drawn } = drawEach(house(), 'level_main', [
      ...PERIMETER,
      [
        [4, 0],
        [4, 6],
      ],
    ])
    for (const walls of drawn) for (const wall of walls) expect(isPlainWall(wall)).toBe(true)
  })

  test('a thickness given on a basement wall keeps it, on the outline too', () => {
    const result = planWallInsertion(house(), {
      levelId: 'level_base' as AnyNodeId,
      start: [0, 0],
      end: [8, 0],
      joinRadius: 0,
      wallDefaults: { thickness: 0.3 },
    })
    if (!result.ok) throw Error(result.reason)
    expect(result.plan.insertedWalls[0]).toMatchObject({ thickness: 0.3 })
    expect(result.plan.insertedWalls[0]!.assembly).toBeUndefined()
  })

  test('the generic foundation still finds the perimeter and draws nothing under the partition', () => {
    const { scene } = drawEach(house(), 'level_base', [
      ...PERIMETER,
      [
        [4, 0],
        [4, 6],
      ],
    ])
    const walls = Object.values(scene).filter((node): node is WallNode => node.type === 'wall')
    const level = scene.level_base as LevelNode
    const nodes: Nodes = {
      ...scene,
      level_base: { ...level, children: [...level.children, ...walls.map((wall) => wall.id)] },
    } as Nodes
    const members = genericFoundation(nodes)
    const partition = walls.find((wall) => wall.start[0] === 4 && wall.end[0] === 4)!
    expect(isPlainWall(partition)).toBe(true)
    expect(members.length).toBeGreaterThan(0)
    for (const member of members) {
      expect(member.levelId).toBe('level_base')
      // every run lies on the perimeter: x or z at 0, 8 / 6, never along the x = 4 partition
      const onPartition = [member.from, member.to].every(([x]) => Math.abs(x - 4) < 1e-6)
      expect(onPartition).toBe(false)
    }
    const east = members.filter((m) => m.from[0] > 7.9 && m.to[0] > 7.9)
    expect(east.length).toBeGreaterThan(0)
  })
})
