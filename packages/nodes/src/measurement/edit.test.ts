import { describe, expect, test } from 'bun:test'
import { MeasurementNode, measurementDistance } from '@pascal-app/core'
import {
  constrainMeasurementPlanEditPoint,
  constrainMeasurementSpatialEditPoint,
  refreshMeasurementAnchorFallbacks,
  replaceMeasurementAnchor,
} from './edit'
import { resolveMeasurementNode } from './resolve'

describe('measurement committed vertex editing', () => {
  test('replaces only the moved anchor and preserves other associations', () => {
    const node = MeasurementNode.parse({
      id: 'measurement_edit_distance',
      type: 'measurement',
      measurement: {
        kind: 'distance',
        points: [
          {
            kind: 'feature',
            reference: { nodeId: 'wall_a', featureId: 'wall:start' },
            fallback: [0, 0, 0],
          },
          {
            kind: 'feature',
            reference: { nodeId: 'wall_b', featureId: 'wall:end' },
            fallback: [2, 0, 0],
          },
        ],
      },
    })
    const next = replaceMeasurementAnchor(node.measurement, 0, [1, 0, 0])
    expect(next?.kind).toBe('distance')
    if (next?.kind !== 'distance') return
    expect(next.points[0]).toEqual([1, 0, 0])
    expect(next.points[1]).toEqual(node.measurement.points[1])
  })

  test('refreshes semantic fallbacks from the live resolved geometry before editing', () => {
    const node = MeasurementNode.parse({
      id: 'measurement_edit_fallback',
      type: 'measurement',
      measurement: {
        kind: 'distance',
        points: [
          {
            kind: 'feature',
            reference: { nodeId: 'missing', featureId: 'wall:start' },
            fallback: [0, 0, 0],
          },
          [2, 0, 0],
        ],
      },
    })
    const resolved = resolveMeasurementNode(node, () => undefined)
    resolved.payload.points[0] = [3, 1, 4]
    const refreshed = refreshMeasurementAnchorFallbacks(node.measurement, resolved.payload)
    expect(refreshed.kind === 'distance' && refreshed.points[0]).toMatchObject({
      fallback: [3, 1, 4],
    })
  })

  test('keeps plan edits on horizontal, sloped, and vertical polygon planes', () => {
    expect(
      constrainMeasurementPlanEditPoint(
        {
          kind: 'area',
          base: [
            [0, 2, 0],
            [2, 2, 0],
            [2, 2, 2],
          ],
        },
        1,
        [4, 5],
      ),
    ).toEqual([4, 2, 5])

    const sloped = constrainMeasurementPlanEditPoint(
      {
        kind: 'area',
        base: [
          [0, 0, 0],
          [2, 2, 0],
          [2, 2, 2],
        ],
      },
      1,
      [4, 3],
    )
    expect(sloped).toEqual([4, 4, 3])

    const vertical = constrainMeasurementPlanEditPoint(
      {
        kind: 'area',
        base: [
          [1, 0, 0],
          [1, 2, 0],
          [1, 2, 2],
        ],
      },
      1,
      [4, 3],
    )
    expect(vertical?.[0]).toBeCloseTo(1)
    expect(vertical?.[1]).toBe(2)
    expect(vertical?.[2]).toBeCloseTo(3)
  })

  test('projects spatial polygon edits onto the original arbitrary plane', () => {
    const point = constrainMeasurementSpatialEditPoint(
      {
        kind: 'area',
        base: [
          [0, 0, 0],
          [2, 2, 0],
          [2, 2, 2],
        ],
      },
      [3, 0, 1],
    )
    expect(measurementDistance(point, [1.5, 1.5, 1])).toBeLessThan(1e-9)
  })
})
