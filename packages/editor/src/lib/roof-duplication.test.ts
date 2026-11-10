import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  type AnyNodeId,
  BaseNode,
  LevelNode,
  nodeRegistry,
  nodeType,
  objectId,
  RoofNode,
  RoofSegmentNode,
  registerNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { z } from 'zod'
import { duplicateRoofSubtree } from './roof-duplication'

// A plugin's solved roof plane: a face of the roof holding it (`capabilities.roofs`).
const RoofPlane = BaseNode.extend({
  id: objectId('roofplane'),
  type: nodeType('test:roof-plane'),
  polygon: z.array(z.tuple([z.number(), z.number()])),
})
const roofPlanes = {
  kind: 'test:roof-plane',
  schemaVersion: 1,
  schema: RoofPlane,
  category: 'structure',
  defaults: () => ({}),
  capabilities: {
    roofs: {
      outline: (node: AnyNode) => (node as unknown as z.infer<typeof RoofPlane>).polygon,
      heightAt: () => 2.9,
    },
  },
} as unknown as AnyNodeDefinition

const LEVEL_ID = 'level_roof-duplicate' as AnyNodeId
const ROOF_ID = 'roof_original' as AnyNodeId
const SEGMENT_ID = 'rseg_original' as AnyNodeId
const PLANE_ID = 'roofplane_original' as AnyNodeId
const POLYGON: [number, number][] = [
  [0, 0],
  [8, 0],
  [8, 3],
]

let restoreRegistry = () => {}
const previousScene = useScene.getState()

beforeEach(() => {
  restoreRegistry = nodeRegistry._snapshot()
  registerNode(roofPlanes)
  useScene.setState({
    nodes: {
      [LEVEL_ID]: LevelNode.parse({ id: LEVEL_ID, children: [ROOF_ID] }) as AnyNode,
      [ROOF_ID]: RoofNode.parse({
        id: ROOF_ID,
        parentId: LEVEL_ID,
        children: [SEGMENT_ID, PLANE_ID],
      }) as AnyNode,
      [SEGMENT_ID]: RoofSegmentNode.parse({ id: SEGMENT_ID, parentId: ROOF_ID }) as AnyNode,
      [PLANE_ID]: RoofPlane.parse({
        id: PLANE_ID,
        parentId: ROOF_ID,
        polygon: POLYGON,
      }) as unknown as AnyNode,
    },
    rootNodeIds: [LEVEL_ID],
    collections: {},
    dirtyNodes: new Set(),
  } as never)
})

afterEach(() => {
  restoreRegistry()
  useViewer.getState().setSelection({ selectedIds: [] })
  useScene.setState(previousScene)
  useScene.temporal.getState().clear()
})

describe('duplicateRoofSubtree', () => {
  test("copies the roof's faces of other kinds with it, as they stand in its frame", () => {
    const { roof } = duplicateRoofSubtree(ROOF_ID, { mode: 'select' })
    const nodes = useScene.getState().nodes
    const copied = (nodes[roof.id as AnyNodeId] as RoofNode).children.map(
      (id) => nodes[id as AnyNodeId]!,
    )

    expect(copied.map((node): string => node.type)).toEqual(['roof-segment', 'test:roof-plane'])
    const plane = copied[1] as unknown as z.infer<typeof RoofPlane>
    expect(plane.id).not.toBe(PLANE_ID)
    expect(plane.id.startsWith('roofplane_')).toBe(true)
    expect(plane.parentId).toBe(roof.id)
    expect(plane.polygon).toEqual(POLYGON)
    expect((nodes[ROOF_ID] as RoofNode).children).toEqual([SEGMENT_ID, PLANE_ID])
  })
})
