import { describe, expect, test } from 'bun:test'
import { type SlabNode, type WallNode, ZoneNode } from '@pascal-app/core'
import { slabQuickMeasurement } from '../slab/quick-measurement'
import { wallQuickMeasurement } from '../wall/quick-measurement'
import { buildZoneContextualDimensions } from '../zone/contextual-dimensions'
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
      thickness: 0.08,
    } as SlabNode)

    expect(report?.metrics.find((metric) => metric.key === 'area')?.value).toBeCloseTo(11)
    expect(report?.metrics.find((metric) => metric.key === 'perimeter')?.value).toBeCloseTo(14)
    expect(report?.metrics.find((metric) => metric.key === 'thickness')?.value).toBeCloseTo(0.08)
    expect(report?.anchor[1]).toBeCloseTo(0.29)
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
  test('room quantities subtract holes and disappear while the enclosure is open', () => {
    const room = ZoneNode.parse({
      name: 'Hall',
      autoFromWalls: true,
      spaceRole: 'room',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      holes: [
        [
          [1, 1],
          [2, 1],
          [2, 2],
          [1, 2],
        ],
      ],
    })
    expect(zoneQuickMeasurement(room)?.metrics.find((metric) => metric.key === 'area')?.value).toBe(
      15,
    )
    expect(
      buildZoneContextualDimensions(room, {
        resolve: () => undefined,
        siblings: [],
        children: [],
        parent: null,
      }),
    ).toMatchObject({ text: '15.0m²' })
    const open = { ...room, enclosureStatus: 'open' as const }
    expect(zoneQuickMeasurement(open)).toBeNull()
    expect(
      buildZoneContextualDimensions(open, {
        resolve: () => undefined,
        siblings: [],
        children: [],
        parent: null,
      }),
    ).toBeNull()
  })
})
