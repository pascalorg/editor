import { afterEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  ColumnNode,
  FenceNode,
  type GeometryContext,
  getFloorPlacedElevation,
  LevelNode,
  nodeRegistry,
  registerNode,
  SlabNode,
  spatialGridManager,
  useScene,
  ZoneNode,
} from '@pascal-app/core'
import { Raycaster, Vector3 } from 'three'
import { columnDefinition } from '../../column/definition'
import { buildFenceGeometry } from '../../fence/geometry'
import { resolveFenceLiftElevationForNodes } from '../../fence/lift'
import { createSlabDependencyTracker } from '../dependency-tracker'
import { buildSlabGeometry } from '../geometry'

const rect = (a: number, b: number): [number, number][] => [
  [a, a],
  [b, a],
  [b, b],
  [a, b],
]
afterEach(() => {
  useScene.getState().unloadScene()
  spatialGridManager.clear()
})

test('a manual deck, railing and ground-pinned column follow a footprint in geometry and support reads', () => {
  const level = LevelNode.parse({ id: 'level_construction' })
  const zone = ZoneNode.parse({
    id: 'zone_construction',
    name: 'Room',
    parentId: level.id,
    spaceRole: 'room',
    polygon: rect(0, 4),
  })
  const base = SlabNode.parse({
    id: 'slab_base',
    parentId: level.id,
    plateRole: 'base',
    boundary: 'auto',
    polygon: rect(0, 4),
    elevation: 0.05,
    zoneIds: [zone.id],
  })
  const deck = SlabNode.parse({
    id: 'slab_deck',
    parentId: level.id,
    polygon: rect(1, 3),
    elevation: 0.3,
  })
  const fence = FenceNode.parse({
    id: 'fence_construction',
    parentId: level.id,
    start: [1, 1],
    end: [3, 1],
    supportSlabId: 'ground',
  })
  const column = ColumnNode.parse({
    id: 'column_construction',
    parentId: level.id,
    position: [2, 0, 2],
    supportSlabId: 'ground',
  })
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [level, zone, base, deck, fence, column].map((node) => [node.id, node]),
  )
  level.children = [zone.id, base.id, deck.id, fence.id, column.id]
  const tracker = createSlabDependencyTracker(nodes)
  const raised = { ...nodes, [base.id]: { ...base, floorHeight: 0.55, elevation: 0.55 } }
  expect(tracker(raised)).toContain(deck.id)
  const ctx: GeometryContext = {
    parent: level,
    resolve: (id) => raised[id],
    children: [],
    siblings: Object.values(raised),
    levelBaseAt: () => 0,
  }
  const group = buildSlabGeometry(deck, ctx, 'solid', false)
  group.updateMatrixWorld(true)
  const hits = new Raycaster(new Vector3(1.8, 2, 2), new Vector3(0, -1, 0)).intersectObject(
    group,
    true,
  )
  expect(hits[0]!.point.y).toBeCloseTo(0.8)
  expect(resolveFenceLiftElevationForNodes(fence, raised)).toBeCloseTo(0.5)
  expect(buildFenceGeometry(fence, ctx, 'solid', false).children[0]!.position.y).toBeCloseTo(0.5)
  useScene.setState({ nodes: raised })
  spatialGridManager.handleNodeCreated(deck, level.id)
  expect(spatialGridManager.getSlabElevationAt(level.id, 2, 2)).toBeCloseTo(0.8)
  const restore = nodeRegistry._snapshot()
  const registered = nodeRegistry.get('column')
  if (!registered) registerNode(columnDefinition)
  try {
    expect(
      getFloorPlacedElevation({
        node: column,
        nodes: raised,
        position: column.position,
        levelId: level.id,
      }),
    ).toBeCloseTo(0.5)
  } finally {
    restore()
  }
})
