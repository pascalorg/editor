import { describe, expect, test } from 'bun:test'
import type { AnyNode, ColumnNode, SlabNode, WallNode } from '@pascal-app/core'
import { buildFormworkNode, buildFormworkNodes, pourUnitsForHost } from './attach'

function makeWall(overrides: Partial<WallNode> = {}): WallNode {
  return {
    object: 'node',
    id: 'wall_test',
    type: 'wall',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    start: [0, 0],
    end: [3, 0],
    thickness: 0.2,
    height: 2.4,
    frontSide: 'unknown',
    backSide: 'unknown',
    ...overrides,
  } as WallNode
}

describe('buildFormworkNode', () => {
  test('stays at identity transform regardless of wall position/heading', () => {
    // WallRenderer nests the formwork node inside the wall's own <mesh>,
    // and WallSystem already sets that mesh's position/rotation to
    // wall.start / wall heading. The formwork node must NOT re-apply
    // that transform itself or it double-rotates/double-translates for
    // any wall that isn't sitting at the origin along +X.
    const offOriginWall = makeWall({ start: [5, -3], end: [2, 4] })
    const node = buildFormworkNode(offOriginWall)
    expect(node.position).toEqual([0, 0, 0])
    expect(node.rotation).toEqual([0, 0, 0])
  })

  test('parents to the host wall', () => {
    const node = buildFormworkNode(makeWall())
    expect(node.parentId).toBe('wall_test')
  })
})

function expansionJoint(along: number): AnyNode {
  return {
    object: 'node',
    id: 'construction-joint_a',
    type: 'construction-joint',
    parentId: 'level_test',
    visible: true,
    metadata: {},
    children: [],
    kind: 'expansion',
    elementIds: ['wall_test'],
    along,
    treatments: [],
    solverPlaced: false,
  } as unknown as AnyNode
}

describe('buildFormworkNodes', () => {
  test('an unsplit wall gets a single assembly covering the element', () => {
    const nodes = buildFormworkNodes(makeWall())
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.segmentIndex).toBe(0)
    expect(nodes[0]?.liftIndex).toBe(0)
  })

  test('a wall capped at 3 m lifts gets one assembly per lift', () => {
    const nodes = buildFormworkNodes(makeWall({ height: 9, maxLiftHeight: 3 } as Partial<WallNode>))
    expect(nodes).toHaveLength(3)
    expect(nodes.map((n) => n.liftIndex)).toEqual([0, 1, 2])
  })

  test('an expansion joint splits the wall into one assembly per bay', () => {
    const wall = makeWall({ parentId: 'level_test', end: [40, 0] })
    const nodes = buildFormworkNodes(wall, [wall as AnyNode, expansionJoint(15)])
    expect(nodes).toHaveLength(2)
    expect(nodes.map((n) => n.segmentIndex)).toEqual([0, 1])
  })

  test('every assembly names a distinct pour unit', () => {
    const wall = makeWall({ parentId: 'level_test', end: [40, 0], height: 9, maxLiftHeight: 3 })
    const nodes = buildFormworkNodes(wall, [wall as AnyNode, expansionJoint(15)])
    const keys = nodes.map((n) => `${n.segmentIndex}:${n.liftIndex}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toHaveLength(6)
  })

  test('each assembly gets its own id so they do not collide in the graph', () => {
    const nodes = buildFormworkNodes(makeWall({ height: 9, maxLiftHeight: 3 } as Partial<WallNode>))
    expect(new Set(nodes.map((n) => n.id)).size).toBe(3)
  })
})

function makeColumn(overrides: Partial<ColumnNode> = {}): ColumnNode {
  return {
    object: 'node',
    id: 'column_test',
    type: 'column',
    parentId: 'level_test',
    visible: true,
    metadata: {},
    children: [],
    position: [2, 0, 3],
    rotation: 0,
    height: 3,
    width: 0.4,
    depth: 0.4,
    radius: 0.2,
    crossSection: 'square',
    ...overrides,
  } as ColumnNode
}

function makeSlab(overrides: Partial<SlabNode> = {}): SlabNode {
  return {
    object: 'node',
    id: 'slab_test',
    type: 'slab',
    parentId: 'level_test',
    visible: true,
    metadata: {},
    children: [],
    polygon: [
      [0, 0],
      [8, 0],
      [8, 6],
      [0, 6],
    ],
    holes: [],
    holeMetadata: [],
    elevation: 3,
    thickness: 0.2,
    recessed: false,
    autoFromWalls: false,
    ...overrides,
  } as SlabNode
}

describe('buildFormworkNodes on a column', () => {
  test('parents to the column and stays at identity — the renderer group is already placed', () => {
    // ColumnRenderer's root group carries node.position and node.rotation, so
    // the assembly builds in column-local space centred on the origin.
    const nodes = buildFormworkNodes(makeColumn({ position: [5, 0, -3], rotation: 0.7 }))
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.parentId).toBe('column_test')
    expect(nodes[0]?.position).toEqual([0, 0, 0])
    expect(nodes[0]?.rotation).toEqual([0, 0, 0])
  })

  test('a 9 m column capped at 3 m lifts gets one assembly per lift', () => {
    const nodes = buildFormworkNodes(makeColumn({ height: 9, maxLiftHeight: 3 }))
    expect(nodes.map((n) => n.liftIndex)).toEqual([0, 1, 2])
  })

  test('never splits along its length — a column is a point on the centreline', () => {
    // maxPourLength is meaningless for a column: start === end, so there is
    // nothing to cut but the height.
    const nodes = buildFormworkNodes(makeColumn({ maxPourLength: 0.1 }))
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.segmentIndex).toBe(0)
  })
})

describe('buildFormworkNodes on a slab', () => {
  test('one assembly for the whole slab — a bay split is a polygon partition', () => {
    const nodes = buildFormworkNodes(makeSlab({ maxPourLength: 2, maxLiftHeight: 0.05 }))
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.parentId).toBe('slab_test')
    expect(nodes[0]?.segmentIndex).toBe(0)
    expect(nodes[0]?.liftIndex).toBe(0)
  })

  test('a degenerate slab still yields an assembly rather than nothing', () => {
    // `toCastableElement` rejects a 2-point polygon, so `pourUnitsForHost`
    // returns nothing — the button must still produce a node to select rather
    // than silently doing nothing.
    const degenerate = makeSlab({
      polygon: [
        [0, 0],
        [1, 0],
      ],
    })
    expect(pourUnitsForHost(degenerate)).toHaveLength(0)
    expect(buildFormworkNodes(degenerate)).toHaveLength(1)
  })
})
