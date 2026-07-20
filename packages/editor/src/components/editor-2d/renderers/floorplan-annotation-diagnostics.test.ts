import { describe, expect, test } from 'bun:test'
import type { FloorplanGeometry } from '@pascal-app/core'
import {
  analyzeFloorplanAnnotationCollisions,
  type FloorplanDiagnosticSource,
} from './floorplan-annotation-diagnostics'

function dimension(
  start: number,
  end: number,
  text: string,
  offsetDistance = 1,
): FloorplanGeometry {
  return {
    kind: 'dimension',
    start: [start, 0],
    end: [end, 0],
    offsetNormal: [0, 1],
    offsetDistance,
    extensionOvershoot: 0.12,
    text,
  }
}

function source(
  ownerId: string,
  overlay: FloorplanGeometry,
  base: FloorplanGeometry | null = null,
): FloorplanDiagnosticSource {
  return { ownerId, ownerType: 'wall', base, overlay }
}

describe('analyzeFloorplanAnnotationCollisions', () => {
  test('detects labels from separate strings that overlap', () => {
    const diagnostics = analyzeFloorplanAnnotationCollisions(
      [source('wall_a', dimension(0, 4, '4000')), source('wall_b', dimension(0, 4, '4000'))],
      0.01,
      0,
    )

    expect(diagnostics.filter((entry) => entry.kind === 'label-overlap')).toHaveLength(2)
  })

  test('detects a dimension segment too short to contain its value', () => {
    const diagnostics = analyzeFloorplanAnnotationCollisions(
      [source('wall_short', dimension(0, 0.25, '250'))],
      0.01,
      0,
    )

    expect(diagnostics.some((entry) => entry.kind === 'short-segment')).toBe(true)
  })

  test('detects a label colliding with another node plan footprint', () => {
    const obstacle: FloorplanGeometry = {
      kind: 'polygon',
      points: [
        [1.6, 0.7],
        [2.4, 0.7],
        [2.4, 1.15],
        [1.6, 1.15],
      ],
    }
    const diagnostics = analyzeFloorplanAnnotationCollisions(
      [
        source('wall_dimension', dimension(0, 4, '4000')),
        source('column_obstacle', { kind: 'group', children: [] }, obstacle),
      ],
      0.01,
      0,
    )

    expect(diagnostics.some((entry) => entry.kind === 'plan-collision')).toBe(true)
  })

  test('does not treat a measurement line as a collision with its own label', () => {
    const geometry: FloorplanGeometry = {
      kind: 'group',
      children: [
        { kind: 'line', x1: 0, y1: 0, x2: 2, y2: 0 },
        { kind: 'dimension-label', cx: 1, cy: 0, text: '2.00m', angle: 0 },
      ],
    }
    const diagnostics = analyzeFloorplanAnnotationCollisions(
      [{ ownerId: 'measurement_a', ownerType: 'measurement', base: geometry, overlay: geometry }],
      0.01,
      0,
    )

    expect(diagnostics.some((entry) => entry.kind === 'plan-collision')).toBe(false)
  })
})
