import { describe, expect, test } from 'bun:test'
import type { SlabNode, WallNode, ZoneNode } from '@pascal-app/core'
import { slabQuickMeasurement } from '../slab/quick-measurement'
import { wallQuickMeasurement } from '../wall/quick-measurement'
import { zoneQuickMeasurement } from '../zone/quick-measurement'

describe('quick measurement reports', () => {
  test('reports the requested wall dimensions and gross face surface', () => {
    const report = wallQuickMeasurement({
      id: 'wall_a',
      type: 'wall',
      parentId: 'level_a',
      start: [0, 0],
      end: [4, 0],
      height: 3,
      thickness: 0.2,
      children: [],
    } as WallNode)

    expect(report.metrics.map((metric) => metric.key)).toEqual([
      'length',
      'height',
      'surface',
      'thickness',
    ])
    expect(report.metrics.find((metric) => metric.key === 'surface')?.value).toBeCloseTo(12)
  })

  test('subtracts slab openings while keeping the outside perimeter', () => {
    const report = slabQuickMeasurement({
      id: 'slab_a',
      type: 'slab',
      parentId: 'level_a',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      holes: [
        [
          [1, 1],
          [2, 1],
          [2, 2],
          [1, 2],
        ],
      ],
      elevation: 0.25,
    } as SlabNode)

    expect(report?.metrics.find((metric) => metric.key === 'area')?.value).toBeCloseTo(11)
    expect(report?.metrics.find((metric) => metric.key === 'perimeter')?.value).toBeCloseTo(14)
  })

  test('keeps zone hover quantities explicitly footprint-only', () => {
    const report = zoneQuickMeasurement({
      id: 'zone_a',
      type: 'zone',
      parentId: 'level_a',
      name: 'Kitchen',
      polygon: [
        [0, 0],
        [5, 0],
        [5, 4],
        [0, 4],
      ],
    } as ZoneNode)

    expect(report?.title).toBe('Kitchen')
    expect(report?.metrics.find((metric) => metric.key === 'area')?.value).toBeCloseTo(20)
    expect(report?.note).toContain('room envelope not proven')
  })
})
