// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  ColumnNode,
  calculateLevelMiters,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  WallNode,
} from '@pascal-app/core'
import * as THREE from 'three'
import { resolveColumnRoofHeight } from '../roof/roof-underside'
import { resolveWallRoofCover, syncWallRoofFit, wallRoofCoverSignature } from './wall-roof-fit'
import { generateExtrudedWall } from './wall-system'

const TAN17 = Math.tan((17 * Math.PI) / 180)
const TAN23 = Math.tan((23 * Math.PI) / 180)
const STOREY = 3.05

type SegmentInput = Partial<RoofSegmentNode> & { id: string }
type WallInput = Partial<WallNode> & { id: string; start: [number, number]; end: [number, number] }

/**
 * One building: storey `level_0` (3.05 m) and an empty `level_1` holding the
 * roofs flagged `upper` — the "roof level" layout of the main house.
 */
function scene(input: {
  roofs: Array<{
    id: string
    upper?: boolean
    position?: [number, number, number]
    segments: SegmentInput[]
  }>
  walls: Array<WallInput & { upper?: boolean }>
}): Record<string, AnyNode> {
  const nodes: Record<string, AnyNode> = {}
  const add = (node: AnyNode) => {
    nodes[node.id] = node
  }
  const level0: string[] = []
  const level1: string[] = []
  for (const roof of input.roofs) {
    ;(roof.upper ? level1 : level0).push(roof.id)
    add(
      RoofNode.parse({
        id: roof.id,
        type: 'roof',
        parentId: roof.upper ? 'level_1' : 'level_0',
        position: roof.position ?? [0, 0, 0],
        children: roof.segments.map((segment) => segment.id),
      }),
    )
    for (const segment of roof.segments) {
      add(
        RoofSegmentNode.parse({
          type: 'roof-segment',
          parentId: roof.id,
          roofType: 'shed',
          overhang: 0,
          wallThickness: 0.1,
          deckThickness: 0.2,
          wallShell: 'omit',
          ...segment,
        }),
      )
    }
  }
  for (const wall of input.walls) {
    const { upper, ...data } = wall
    ;(upper ? level1 : level0).push(wall.id)
    add(
      WallNode.parse({
        type: 'wall',
        thickness: 0.3,
        parentId: upper ? 'level_1' : 'level_0',
        ...data,
      }),
    )
  }
  add(BuildingNode.parse({ id: 'building_a', type: 'building', children: ['level_0', 'level_1'] }))
  add(
    LevelNode.parse({
      id: 'level_0',
      type: 'level',
      parentId: 'building_a',
      level: 0,
      height: STOREY,
      children: level0,
    }),
  )
  add(
    LevelNode.parse({
      id: 'level_1',
      type: 'level',
      parentId: 'building_a',
      level: 1,
      height: 2.5,
      children: level1,
    }),
  )
  return nodes
}

function build(nodes: Record<string, AnyNode>, wallId: string, storeyHeight = STOREY) {
  const wall = nodes[wallId] as WallNode
  const walls = Object.values(nodes).filter(
    (node): node is WallNode => node.type === 'wall' && node.parentId === wall.parentId,
  )
  return generateExtrudedWall(
    wall,
    [],
    calculateLevelMiters(walls),
    0,
    0,
    undefined,
    storeyHeight,
    undefined,
    undefined,
    undefined,
    nodes,
  )
}

/** Wall top (mesh-local Y) at wall-local x along the axis, `z` across it. */
function topAt(geometry: THREE.BufferGeometry, x: number, z = 0): number | null {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
  const hits = new THREE.Raycaster(
    new THREE.Vector3(x, 50, z),
    new THREE.Vector3(0, -1, 0),
  ).intersectObject(mesh)
  return hits[0]?.point.y ?? null
}

/** The addition: two sheds, 17° north / 23° south, eaves 0.5 m above the roof level. */
function gableRoof(extraSouth: Partial<RoofSegmentNode> = {}) {
  return {
    id: 'roof_gable',
    upper: true,
    position: [5, 0, 0] as [number, number, number],
    segments: [
      {
        id: 'rseg_north',
        width: 10,
        depth: 4,
        pitch: 17,
        wallHeight: 0.5,
        rotation: Math.PI,
        position: [0, 0, -2] as [number, number, number],
      },
      {
        id: 'rseg_south',
        width: 10,
        depth: 4,
        pitch: 23,
        wallHeight: 0.5,
        position: [0, 0, 2] as [number, number, number],
        ...extraSouth,
      },
    ],
  }
}

const northUnderside = (z: number) => STOREY + 0.5 + (z + 4) * TAN17
const southUnderside = (z: number) => STOREY + 0.5 + (4 - z) * TAN23

/** A closed rectangle of exterior walls 0.3 m thick, centred on x0..x1 × z0..z1. */
function box(x0: number, z0: number, x1: number, z1: number): WallInput[] {
  const sides = { frontSide: 'exterior' as const, backSide: 'interior' as const }
  return [
    { id: 'wall_n', start: [x0, z0], end: [x1, z0], ...sides },
    { id: 'wall_e', start: [x1, z0], end: [x1, z1], ...sides },
    { id: 'wall_s', start: [x1, z1], end: [x0, z1], ...sides },
    { id: 'wall_w', start: [x0, z1], end: [x0, z0], ...sides },
  ]
}

describe('walls cut by the roof above', () => {
  test('a wall under a higher roof keeps the storey height', () => {
    const nodes = scene({ roofs: [gableRoof()], walls: box(0, -3.5, 10, 3.5) })
    const geometry = build(nodes, 'wall_w')
    geometry.computeBoundingBox()
    expect(geometry.boundingBox!.max.y).toBeCloseTo(STOREY, 6)
    geometry.dispose()
  })

  test('a low roof on the same level cuts every wall under it, half walls included', () => {
    const nodes = scene({
      roofs: [
        {
          id: 'roof_low',
          position: [5, 0, 0],
          segments: [
            {
              id: 'rseg_low',
              width: 10,
              depth: 6,
              pitch: 17,
              wallHeight: 2.2,
              rotation: Math.PI,
              position: [0, 0, -1],
            },
          ],
        },
      ],
      walls: [
        {
          id: 'wall_front',
          start: [0, -3],
          end: [10, -3],
          frontSide: 'exterior',
          backSide: 'interior',
        },
        { id: 'wall_partition', start: [5, -3.5], end: [5, 1.5], thickness: 0.1 },
        { id: 'wall_half', start: [2, -3.5], end: [2, -2], thickness: 0.1, height: 3 },
      ],
    })
    // Eave at z = -4: underside 2.2 + (z + 4) tan 17°.
    const low = (z: number) => 2.2 + (z + 4) * TAN17
    const front = build(nodes, 'wall_front')
    expect(topAt(front, 3)).toBeCloseTo(low(-3), 3)
    front.dispose()
    const partition = build(nodes, 'wall_partition')
    expect(topAt(partition, 0.5)).toBeCloseTo(low(-3), 3)
    // Past z = -1.2 the roof is above the storey: the partition keeps 3.05.
    expect(topAt(partition, 4.5)).toBeCloseTo(STOREY, 3)
    partition.dispose()
    const half = build(nodes, 'wall_half')
    expect(topAt(half, 0.5)).toBeCloseTo(Math.min(3, low(-3)), 3)
    half.dispose()
  })

  test('a wall outside every roof outline keeps its geometry', () => {
    const nodes = scene({
      roofs: [gableRoof()],
      walls: [
        {
          id: 'wall_far',
          start: [20, -4],
          end: [20, 4],
          frontSide: 'exterior',
          backSide: 'interior',
        },
      ],
    })
    expect(resolveWallRoofCover(nodes.wall_far as WallNode, nodes)).toBeNull()
  })

  test('a roof edit marks only the walls whose cover changed', () => {
    const nodes = scene({
      roofs: [
        {
          id: 'roof_low',
          position: [5, 0, 0],
          segments: [
            {
              id: 'rseg_low',
              width: 10,
              depth: 6,
              pitch: 17,
              wallHeight: 2.2,
              rotation: Math.PI,
              position: [0, 0, -1],
            },
          ],
        },
      ],
      walls: [
        { id: 'wall_front', start: [0, -3], end: [10, -3] },
        { id: 'wall_far', start: [20, -4], end: [20, 4] },
      ],
    })
    const dirty: string[] = []
    syncWallRoofFit(nodes, {}, (id) => dirty.push(id))
    expect(dirty).toEqual(['wall_front'])
    expect(wallRoofCoverSignature(resolveWallRoofCover(nodes.wall_far as WallNode, nodes))).toBe('')
  })
})

describe('posts under a roof', () => {
  test('a post under a roof reaches its underside, up or down', () => {
    const nodes = scene({ roofs: [gableRoof()], walls: [] })
    const post = (x: number, z: number) =>
      ColumnNode.parse({ type: 'column', parentId: 'level_0', position: [x, 0, z], height: 3 })
    expect(resolveColumnRoofHeight(post(2, -3.8), nodes)).toBeCloseTo(northUnderside(-3.8), 4)
    expect(resolveColumnRoofHeight(post(2, 3), nodes)).toBeCloseTo(southUnderside(3), 4)
    expect(resolveColumnRoofHeight(post(20, 0), nodes)).toBeNull()
    // On a 0.4 m slab the post is shorter by the lift, so its top still meets the underside.
    expect(resolveColumnRoofHeight(post(2, 3), nodes, 0.4)).toBeCloseTo(southUnderside(3) - 0.4, 4)
  })
})
