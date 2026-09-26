import { describe, expect, test } from 'bun:test'
import { type FloorplanGeometry, type GeometryContext, ZoneNode } from '@pascal-app/core'
import { readFloorplanGeometryMetadata } from '@pascal-app/editor'
import { buildZoneFloorplan } from './floorplan'

const context = {
  resolve: () => undefined,
  children: [],
  siblings: [],
  parent: null,
} satisfies GeometryContext

function textChildren(geometry: FloorplanGeometry | null) {
  if (geometry?.kind !== 'group') return []
  return geometry.children.filter((child) => child.kind === 'text')
}

describe('buildZoneFloorplan room documentation', () => {
  test('keeps a generic zone label unchanged', () => {
    const zone = ZoneNode.parse({
      id: 'zone_landscape',
      name: 'Courtyard',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
    })

    expect(textChildren(buildZoneFloorplan(zone, context))).toEqual([
      expect.objectContaining({ kind: 'text', text: 'Courtyard', upright: true }),
    ])
  })

  test('centers room name, number, finish, and height information as room annotations', () => {
    const room = ZoneNode.parse({
      id: 'zone_office',
      name: 'Office',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      spaceRole: 'room',
      roomNumber: '101',
      floorFinish: 'Timber',
      wallFinish: 'Paint',
      ceilingFinish: 'ACT',
      ceilingHeight: 2.7,
      occupancy: 'Business',
    })

    const labels = textChildren(buildZoneFloorplan(room, context))
    expect(labels.map((label) => ('text' in label ? label.text : ''))).toEqual([
      'OFFICE',
      '101',
      'FL: Timber · WL: Paint · CL: ACT',
      'CH: 2.7m · Business',
    ])
    expect(labels.every((label) => label.kind === 'text' && label.upright)).toBe(true)
    // the name and number are the room label; the finish and height lines
    // are room DETAIL, hidden on the clean plan
    expect(labels.map((label) => readFloorplanGeometryMetadata(label).annotationRole)).toEqual([
      'room-label',
      'room-label',
      'room-detail',
      'room-detail',
    ])
    // the stack is centred on the room and the name is the boldest line
    const ys = labels.map((label) => ('y' in label ? label.y : 0))
    expect((ys[0]! + ys[3]!) / 2).toBeCloseTo(1.5, 1)
    expect(labels[0]).toMatchObject({ fontWeight: 700, fontSize: 0.2 })
  })

  test('a narrow room shrinks its name to fit and drops the detail lines it cannot carry', () => {
    const closet = ZoneNode.parse({
      id: 'zone_closet',
      name: 'Primary closet',
      polygon: [
        [0, 0],
        [1.2, 0],
        [1.2, 1.0],
        [0, 1.0],
      ],
      spaceRole: 'room',
      roomNumber: '7',
      floorFinish: 'CARPET',
      wallFinish: 'GWB, PAINT',
      ceilingFinish: 'GWB, PAINT',
      ceilingHeight: 2.74,
    })
    const labels = textChildren(buildZoneFloorplan(closet, context))
    const texts = labels.map((label) => ('text' in label ? label.text : ''))
    // the finish line (too wide for 1.2 m) is dropped; the short height line still fits
    expect(texts).toEqual(['PRIMARY CLOSET', '7', 'CH: 2.74m'])
    const name = labels[0] as { fontSize: number }
    expect(name.fontSize).toBeLessThan(0.2)
    expect(name.fontSize).toBeGreaterThanOrEqual(0.12)
  })

  test('a compound name breaks at its slash when one line will not fit', () => {
    const great = ZoneNode.parse({
      id: 'zone_great',
      name: 'Great room / Kitchen',
      polygon: [
        [0, 0],
        [2.4, 0],
        [2.4, 4],
        [0, 4],
      ],
      spaceRole: 'room',
      ceilingHeight: 2.74,
    })
    const texts = textChildren(buildZoneFloorplan(great, context)).map((label) =>
      'text' in label ? label.text : '',
    )
    expect(texts.slice(0, 2)).toEqual(['GREAT ROOM', 'KITCHEN'])
  })
})
