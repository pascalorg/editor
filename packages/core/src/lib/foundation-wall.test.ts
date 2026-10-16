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
import { planWallInsertion } from '../systems/wall/wall-topology'
import {
  defaultWallConstruction,
  FOUNDATION_WALL_ASSEMBLY,
  levelHoldsFoundationWalls,
  withDefaultWallConstruction,
} from './foundation-wall'
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
    const [block, furring] = FOUNDATION_WALL_ASSEMBLY.layers
    expect(block).toMatchObject({
      role: 'structure',
      core: true,
      material: 'cmu',
      thickness: 0.203,
    })
    expect(furring).toMatchObject({ role: 'furring', thickness: 0.038 })
    expect(defaultWallConstruction(house(), 'level_base')?.thickness).toBe(0.241)
    expect(assemblyThickness(FOUNDATION_WALL_ASSEMBLY)).toBeCloseTo(0.241, 12)
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
    expect(withDefaultWallConstruction(nodes, 'level_base', { height: 2.4 }).thickness).toBe(0.241)
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
