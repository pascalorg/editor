import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  createConicalRoofSectorAboveWall,
  RoofNode,
  RoofSegmentNode,
  type SceneApi,
} from '@pascal-app/core'
import { getFloorplanNodeExtension } from '@pascal-app/editor'
import { wallDefinition } from './definition'

test('wallDefinition records the lean-to child schema migration', () => {
  expect(wallDefinition.schemaVersion).toBe(8)
})

describe('wallDefinition floor-plan extension', () => {
  test('owns curve eligibility for hosted openings', () => {
    const wall = wallDefinition.schema.parse({
      id: 'wall_test',
      children: ['door_test'],
      start: [0, 0],
      end: [4, 0],
    })
    const canCurve = getFloorplanNodeExtension(wallDefinition)?.actionMenu?.canCurve
    const nodes = {
      [wall.id]: wall,
      door_test: {
        object: 'node',
        id: 'door_test',
        type: 'door',
        parentId: wall.id,
        visible: true,
        metadata: {},
      } as AnyNode,
    } as Record<AnyNodeId, AnyNode>

    expect(canCurve?.({ node: wall, nodes })).toBe(false)
    expect(canCurve?.({ node: { ...wall, children: [] }, nodes })).toBe(true)
  })
})

test('wall top surface follows the effective level-bound height', () => {
  const level = {
    object: 'node',
    id: 'level_test',
    type: 'level',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    level: 0,
    height: 3.2,
  } as AnyNode
  const wall = wallDefinition.schema.parse({
    id: 'wall_test',
    parentId: level.id,
    start: [0, 0],
    end: [4, 0],
  })
  const nodes = { [level.id]: level, [wall.id]: wall }
  const height = wallDefinition.capabilities.surfaces?.top?.height

  expect(typeof height).toBe('function')
  expect(typeof height === 'function' ? height(wall, { nodes }) : height).toBe(3.2)
})

test('curved wall roof builder creates a matching conical sector above it', () => {
  const level = {
    object: 'node',
    id: 'level_test',
    type: 'level',
    parentId: null,
    visible: true,
    metadata: {},
    children: ['wall_test'],
    level: 0,
    height: 3,
  } as AnyNode
  const wall = wallDefinition.schema.parse({
    id: 'wall_test',
    parentId: level.id,
    start: [-2, 0],
    end: [2, 0],
    curveOffset: 2,
    height: 3,
  })
  const nodes = { [level.id]: level, [wall.id]: wall } as Record<AnyNodeId, AnyNode>
  const created: Array<{ node: AnyNode; parentId?: AnyNodeId }> = []
  const sceneApi = {
    createMany: (ops) => created.push(...ops),
    nodes: () => nodes,
  } as SceneApi
  const segmentId = createConicalRoofSectorAboveWall(wall, nodes, sceneApi, level.id as AnyNodeId)
  const roof = created.find((entry) => entry.node.type === 'roof')?.node
  const segment = created.find((entry) => entry.node.type === 'roof-segment')?.node

  expect(wallDefinition.quickActions).toBeUndefined()
  expect(roof).toMatchObject({ position: [0, 3, 0] })
  expect(segment).toMatchObject({
    roofType: 'conical',
    width: 4,
    depth: 4,
    wallHeight: 0,
    conicalFullCircle: true,
    conicalSweepAngle: Math.PI,
  })
  expect(segmentId).toBe(segment?.id)
})

test('curved wall roof builder parents the roof to the active level', () => {
  const sourceLevel = {
    object: 'node',
    id: 'level_source',
    type: 'level',
    parentId: null,
    visible: true,
    metadata: {},
    children: ['wall_test'],
    level: 0,
    height: 3,
  } as AnyNode
  const activeLevel = {
    ...sourceLevel,
    id: 'level_active',
    children: [],
    level: 1,
  } as AnyNode
  const wall = wallDefinition.schema.parse({
    id: 'wall_test',
    parentId: sourceLevel.id,
    start: [-2, 0],
    end: [2, 0],
    curveOffset: 2,
    height: 3,
  })
  const nodes = Object.fromEntries(
    [sourceLevel, activeLevel, wall].map((node) => [node.id, node]),
  ) as Record<AnyNodeId, AnyNode>
  const created: Array<{ node: AnyNode; parentId?: AnyNodeId }> = []
  const sceneApi = {
    createMany: (ops) => created.push(...ops),
    nodes: () => nodes,
  } as SceneApi

  createConicalRoofSectorAboveWall(wall, nodes, sceneApi, activeLevel.id as AnyNodeId)

  const createdRoof = created.find((entry) => entry.node.type === 'roof')
  expect(createdRoof?.parentId).toBe(activeLevel.id)
  expect(createdRoof?.node).toMatchObject({ position: [0, 0, 0] })
})

test('curved wall roof builder reuses its existing hosted roof', () => {
  const level = {
    object: 'node',
    id: 'level_test',
    type: 'level',
    parentId: null,
    visible: true,
    metadata: {},
    children: ['wall_test', 'roof_test'],
    level: 0,
    height: 3,
  } as AnyNode
  const wall = wallDefinition.schema.parse({
    id: 'wall_test',
    parentId: level.id,
    start: [-2, 0],
    end: [2, 0],
    curveOffset: 2,
    height: 3,
  })
  const segment = RoofSegmentNode.parse({
    id: 'rseg_test',
    parentId: 'roof_test',
    roofType: 'conical',
  })
  const roof = RoofNode.parse({
    id: 'roof_test',
    parentId: level.id,
    metadata: { conicalSourceWallId: wall.id },
    children: [segment.id],
  })
  const nodes = {
    [level.id]: level,
    [wall.id]: wall,
    [roof.id]: roof,
    [segment.id]: segment,
  } as Record<AnyNodeId, AnyNode>
  const created: AnyNode[] = []
  const sceneApi = {
    createMany: (ops) => created.push(...ops.map((op) => op.node)),
    nodes: () => nodes,
  } as SceneApi

  expect(createConicalRoofSectorAboveWall(wall, nodes, sceneApi, level.id as AnyNodeId)).toBe(
    segment.id,
  )
  expect(created).toHaveLength(0)
})

test('curved wall roof builder clamps a lower-floor wall to the active floor', () => {
  const sourceLevel = {
    object: 'node',
    id: 'level_source',
    type: 'level',
    parentId: null,
    visible: true,
    metadata: {},
    children: ['wall_test'],
    level: 0,
    height: 3,
  } as AnyNode
  const activeLevel = {
    ...sourceLevel,
    id: 'level_active',
    children: [],
    level: 1,
  } as AnyNode
  const wall = wallDefinition.schema.parse({
    id: 'wall_test',
    parentId: sourceLevel.id,
    start: [-2, 0],
    end: [2, 0],
    curveOffset: 2,
    height: 1,
  })
  const nodes = Object.fromEntries(
    [sourceLevel, activeLevel, wall].map((node) => [node.id, node]),
  ) as Record<AnyNodeId, AnyNode>
  const created: Array<{ node: AnyNode; parentId?: AnyNodeId }> = []
  const sceneApi = {
    createMany: (ops) => created.push(...ops),
    nodes: () => nodes,
  } as SceneApi

  createConicalRoofSectorAboveWall(wall, nodes, sceneApi, activeLevel.id as AnyNodeId)

  const createdRoof = created.find((entry) => entry.node.type === 'roof')
  expect(createdRoof?.node).toMatchObject({ position: [0, 0, 0] })
})

test('curved wall roof builder rejects walls more than one level below', () => {
  const sourceLevel = {
    object: 'node',
    id: 'level_source',
    type: 'level',
    parentId: null,
    visible: true,
    metadata: {},
    children: ['wall_test'],
    level: 0,
    height: 3,
  } as AnyNode
  const middleLevel = { ...sourceLevel, id: 'level_middle', children: [], level: 1 } as AnyNode
  const activeLevel = { ...sourceLevel, id: 'level_active', children: [], level: 2 } as AnyNode
  const wall = wallDefinition.schema.parse({
    id: 'wall_test',
    parentId: sourceLevel.id,
    start: [-2, 0],
    end: [2, 0],
    curveOffset: 2,
    height: 3,
  })
  const nodes = Object.fromEntries(
    [sourceLevel, middleLevel, activeLevel, wall].map((node) => [node.id, node]),
  ) as Record<AnyNodeId, AnyNode>
  const created: Array<{ node: AnyNode; parentId?: AnyNodeId }> = []
  const sceneApi = {
    createMany: (ops) => created.push(...ops),
    nodes: () => nodes,
  } as SceneApi

  expect(
    createConicalRoofSectorAboveWall(wall, nodes, sceneApi, activeLevel.id as AnyNodeId),
  ).toBeNull()
  expect(created).toEqual([])
})
