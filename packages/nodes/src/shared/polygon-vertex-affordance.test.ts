import { beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { ceilingDefinition } from '../ceiling/definition'
import { slabDefinition } from '../slab/definition'
import { zoneDefinition } from '../zone/definition'
import { createPolygonDeleteVertexAffordance } from './polygon-vertex-affordance'

globalThis.requestAnimationFrame = () => 1
globalThis.cancelAnimationFrame = () => {}

type PolygonTestNode = AnyNode & {
  polygon: Array<[number, number]>
  holes?: Array<Array<[number, number]>>
}

function polygonNode(
  polygon: Array<[number, number]>,
  holes: Array<Array<[number, number]>> = [],
): PolygonTestNode {
  return {
    id: 'slab_polygon-test' as AnyNodeId,
    type: 'slab',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    polygon,
    holes,
    holeMetadata: [],
    elevation: 0.05,
    autoFromWalls: false,
  } as PolygonTestNode
}

function startDelete(
  node: PolygonTestNode,
  payload: unknown,
  boundaryCommitData?: Partial<PolygonTestNode>,
) {
  useScene.setState({ nodes: { [node.id]: node } } as never)
  return createPolygonDeleteVertexAffordance<PolygonTestNode>('slab', { boundaryCommitData }).start(
    {
      node,
      payload,
      nodes: useScene.getState().nodes,
      initialPlanPoint: [0, 0],
      gridSnapStep: 0.5,
    },
  )
}

describe('polygon delete-vertex floorplan affordance', () => {
  beforeEach(() => {
    useScene.setState({ nodes: {}, rootNodeIds: [] } as never)
  })

  test('deletes an outer vertex and stops at the three-vertex minimum', () => {
    const node = polygonNode([
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ])
    const session = startDelete(node, { vertexIndex: 1 })

    expect(session.canCommit()).toBe(true)
    session.commit?.()
    expect((useScene.getState().nodes[node.id] as PolygonTestNode).polygon).toEqual([
      [0, 0],
      [4, 4],
      [0, 4],
    ])

    const triangle = useScene.getState().nodes[node.id] as PolygonTestNode
    const blocked = startDelete(triangle, { vertexIndex: 1 })
    expect(blocked.canCommit()).toBe(false)
    blocked.commit?.()
    expect((useScene.getState().nodes[node.id] as PolygonTestNode).polygon).toHaveLength(3)
  })

  test('deletes from the targeted hole without changing the outer ring', () => {
    const node = polygonNode(
      [
        [0, 0],
        [8, 0],
        [8, 8],
        [0, 8],
      ],
      [
        [
          [2, 2],
          [4, 2],
          [4, 4],
          [2, 4],
        ],
      ],
    )
    const session = startDelete(node, { holeIndex: 0, vertexIndex: 2 })

    expect(session.canCommit()).toBe(true)
    session.commit?.()
    const updated = useScene.getState().nodes[node.id] as PolygonTestNode
    expect(updated.polygon).toEqual(node.polygon)
    expect(updated.holes?.[0]).toEqual([
      [2, 2],
      [4, 2],
      [2, 4],
    ])
  })

  test('registers delete-vertex for every registry-driven polygon surface', () => {
    expect(zoneDefinition.floorplanAffordances?.['delete-vertex']).toBeDefined()
    expect(slabDefinition.floorplanAffordances?.['delete-vertex']).toBeDefined()
    expect(ceilingDefinition.floorplanAffordances?.['delete-vertex']).toBeDefined()
  })

  test('applies kind-owned detachment data with a manual ring edit', () => {
    const node = {
      ...polygonNode([
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ]),
      autoFromWalls: true,
    }
    const session = startDelete(node, { vertexIndex: 1 }, { autoFromWalls: false })

    session.commit?.()

    expect(
      (useScene.getState().nodes[node.id] as PolygonTestNode & { autoFromWalls: boolean })
        .autoFromWalls,
    ).toBe(false)
  })
})
