import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  measurementArea,
  measurementDistance,
  nodeRegistry,
  type RoofNode,
  type RoofSegmentNode,
  registerNode,
  type WallNode,
} from '@pascal-app/core'
import { roofSegmentDefinition } from '../roof-segment/definition'
import { wallDefinition } from '../wall/definition'
import { remapMeasurementReferences, resolveMeasurementNode } from './resolve'

const wall = (end: [number, number]): WallNode =>
  ({
    id: 'wall_host',
    type: 'wall',
    parentId: 'level_a',
    start: [0, 0],
    end,
    children: [],
  }) as WallNode

const resolveFrom = (nodes: AnyNode[]) => {
  const byId = Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<
    AnyNodeId,
    AnyNode
  >
  return (id: AnyNodeId) => byId[id]
}

describe('associative measurement resolution', () => {
  beforeEach(() => {
    nodeRegistry._reset()
    registerNode(wallDefinition)
    registerNode(roofSegmentDefinition)
  })

  afterEach(() => nodeRegistry._reset())

  test('tracks wall centerline edits without mutating the measurement payload', () => {
    const measurement = {
      measurement: {
        kind: 'distance' as const,
        points: [
          {
            kind: 'feature' as const,
            reference: { nodeId: 'wall_host', featureId: 'wall:centerline', parameters: { t: 0 } },
            fallback: [0, 0, 0] as [number, number, number],
          },
          {
            kind: 'feature' as const,
            reference: { nodeId: 'wall_host', featureId: 'wall:centerline', parameters: { t: 1 } },
            fallback: [3, 0, 0] as [number, number, number],
          },
        ] as const,
      },
    }

    const first = resolveMeasurementNode(measurement, resolveFrom([wall([3, 0])]))
    const edited = resolveMeasurementNode(measurement, resolveFrom([wall([5, 0])]))

    expect(first.dangling).toEqual([])
    expect(edited.dangling).toEqual([])
    expect(measurementDistance(...first.payload.points)).toBe(3)
    expect(measurementDistance(...edited.payload.points)).toBeCloseTo(5)
    expect(measurement.measurement.points[1].fallback).toEqual([3, 0, 0])
  })

  test('expands an area whose corners are bound to moved wall endpoints', () => {
    const makeWall = (id: WallNode['id'], start: [number, number], end: [number, number]) => ({
      ...wall(end),
      id,
      start,
    })
    const before = [
      makeWall('wall_south', [0, 0], [4, 0]),
      makeWall('wall_east', [4, 0], [4, 3]),
      makeWall('wall_north', [4, 3], [0, 3]),
      makeWall('wall_west', [0, 3], [0, 0]),
    ]
    const after = [
      makeWall('wall_south', [0, 0], [5, 0]),
      makeWall('wall_east', [5, 0], [5, 3]),
      makeWall('wall_north', [5, 3], [0, 3]),
      before[3]!,
    ]
    const measurement = {
      measurement: {
        kind: 'area' as const,
        base: before.map((host) => ({
          kind: 'feature' as const,
          reference: { nodeId: host.id, featureId: 'wall:start' },
          fallback: [host.start[0], 0, host.start[1]] as [number, number, number],
        })),
      },
    }

    const original = resolveMeasurementNode(measurement, resolveFrom(before))
    const expanded = resolveMeasurementNode(measurement, resolveFrom(after))

    expect(original.payload.kind).toBe('area')
    expect(expanded.payload.kind).toBe('area')
    if (original.payload.kind === 'area' && expanded.payload.kind === 'area') {
      expect(measurementArea(original.payload.base)).toBeCloseTo(12)
      expect(measurementArea(expanded.payload.base)).toBeCloseTo(15)
    }
  })

  test('resolves live wall-face normals for surface-aligned endpoint markers', () => {
    const host = wall([3, 0])
    const measurement = {
      measurement: {
        kind: 'distance' as const,
        points: [
          {
            kind: 'feature' as const,
            reference: {
              nodeId: host.id,
              featureId: 'wall:face:left',
              parameters: { t: 0.25, height: 1 },
            },
            fallback: [0.75, 1, 0.05] as [number, number, number],
          },
          {
            kind: 'feature' as const,
            reference: {
              nodeId: host.id,
              featureId: 'wall:face:right',
              parameters: { t: 0.75, height: 1 },
            },
            fallback: [2.25, 1, -0.05] as [number, number, number],
          },
        ] as const,
      },
    }

    const resolved = resolveMeasurementNode(measurement, resolveFrom([host]))

    expect(resolved.anchorNormals[0]?.[0]).toBeCloseTo(0)
    expect(resolved.anchorNormals[0]?.[1]).toBeCloseTo(0)
    expect(resolved.anchorNormals[0]?.[2]).toBeCloseTo(1)
    expect(resolved.anchorNormals[1]?.[0]).toBeCloseTo(0)
    expect(resolved.anchorNormals[1]?.[1]).toBeCloseTo(0)
    expect(resolved.anchorNormals[1]?.[2]).toBeCloseTo(-1)
  })

  test('resolves roof ridge endpoints through segment and parent transforms', () => {
    const roof = {
      id: 'roof_a',
      type: 'roof',
      parentId: 'level_a',
      children: ['roof-segment_a'],
      position: [10, 1, 5],
      rotation: 0,
    } as RoofNode
    const segment = {
      id: 'roof-segment_a',
      type: 'roof-segment',
      parentId: roof.id,
      children: [],
      position: [0, 0, 0],
      rotation: 0,
      width: 8,
      depth: 6,
      wallHeight: 2.5,
      roofType: 'gable',
      pitch: 40,
    } as RoofSegmentNode
    const featureAnchor = (t: number) => ({
      kind: 'feature' as const,
      reference: {
        nodeId: segment.id,
        featureId: 'roof:ridge:0',
        parameters: { t },
      },
      fallback: [0, 0, 0] as [number, number, number],
    })
    const resolved = resolveMeasurementNode(
      {
        measurement: {
          kind: 'distance',
          points: [featureAnchor(0), featureAnchor(1)],
        },
      },
      resolveFrom([roof, segment]),
    )

    expect(resolved.dangling).toEqual([])
    expect(measurementDistance(...resolved.payload.points)).toBeCloseTo(8)
    expect(resolved.dependencies).toEqual([segment.id, roof.id])
  })

  test('falls back visibly when a reference dangles and remaps internal clone references', () => {
    const measurement = {
      kind: 'distance' as const,
      points: [
        {
          kind: 'feature' as const,
          reference: { nodeId: 'wall_host', featureId: 'wall:start' },
          fallback: [1, 2, 3] as [number, number, number],
        },
        [4, 2, 3] as [number, number, number],
      ] as const,
    }
    const resolved = resolveMeasurementNode({ measurement }, () => undefined)
    const remapped = remapMeasurementReferences(measurement, new Map([['wall_host', 'wall_clone']]))

    expect(resolved.payload.points[0]).toEqual([1, 2, 3])
    expect(resolved.dangling).toHaveLength(1)
    expect(Array.isArray(remapped.points[0])).toBe(false)
    if (!Array.isArray(remapped.points[0])) {
      expect(remapped.points[0].reference.nodeId).toBe('wall_clone')
    }
  })
})
