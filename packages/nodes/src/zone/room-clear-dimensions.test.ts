import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type FloorplanGeometry,
  type GeometryContext,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import { buildRoomClearDimensions } from './room-clear-dimensions'

function enclosure(points: Array<[number, number]>) {
  const walls = points.map((start, index) =>
    WallNode.parse({
      id: `wall_${index}`,
      parentId: 'level_main',
      start,
      end: points[(index + 1) % points.length],
      thickness: 0.2,
    }),
  )
  const zone = ZoneNode.parse({
    id: 'zone_room',
    parentId: 'level_main',
    name: 'Office',
    polygon: points,
    autoFromWalls: true,
    boundaryWallIds: walls.map((wall) => wall.id),
    spaceRole: 'room',
    clearDimensionPolicy: 'inside-faces',
  })
  const nodes = Object.fromEntries([...walls, zone].map((node) => [node.id, node])) as Record<
    string,
    AnyNode
  >
  const context = {
    resolve: (id) => nodes[id],
    children: [],
    siblings: [],
    parent: null,
    viewState: {
      selected: false,
      highlighted: false,
      hovered: false,
      moving: false,
      unit: 'metric',
      purpose: 'edit',
      palette: {
        measurementStroke: '#123456',
      } as NonNullable<GeometryContext['viewState']>['palette'],
    },
  } satisfies GeometryContext
  return { context, nodes, walls, zone }
}

function dimensions(geometry: FloorplanGeometry[]) {
  return geometry.filter(
    (entry): entry is Extract<FloorplanGeometry, { kind: 'dimension' }> =>
      entry.kind === 'dimension',
  )
}

describe('buildRoomClearDimensions', () => {
  test('dimensions the proven inside faces of a rectangular room', () => {
    const { context, zone } = enclosure([
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ])
    const result = dimensions(buildRoomClearDimensions(zone, context))

    expect(result).toHaveLength(2)
    expect(result.map((entry) => entry.text).sort()).toEqual(['2.8m', '3.8m'])
    expect(result.every((entry) => entry.stroke === '#123456')).toBe(true)
    expect(result[0]?.start[0]).toBeCloseTo(1.316)
    expect(result[0]?.start[1]).toBeCloseTo(0.1)
    expect(result[0]?.end[0]).toBeCloseTo(1.316)
    expect(result[0]?.end[1]).toBeCloseTo(2.9)
  })

  test('preserves clear spans when the room is rotated', () => {
    const angle = Math.PI / 6
    const rotate = ([x, y]: [number, number]): [number, number] => [
      x * Math.cos(angle) - y * Math.sin(angle),
      x * Math.sin(angle) + y * Math.cos(angle),
    ]
    const { context, zone } = enclosure(
      [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ].map(rotate),
    )

    expect(
      dimensions(buildRoomClearDimensions(zone, context))
        .map((entry) => entry.text)
        .sort(),
    ).toEqual(['2.8m', '3.8m'])
  })

  test('consolidates collinear wall segments before proving the clear rectangle', () => {
    const { context, zone } = enclosure([
      [0, 0],
      [2, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ])

    expect(
      dimensions(buildRoomClearDimensions(zone, context))
        .map((entry) => entry.text)
        .sort(),
    ).toEqual(['2.8m', '3.8m'])
  })

  test('suppresses dimensions when the requested datum cannot be proven', () => {
    const { context, nodes, walls, zone } = enclosure([
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ])

    expect(buildRoomClearDimensions({ ...zone, clearDimensionPolicy: 'none' }, context)).toEqual([])
    expect(
      buildRoomClearDimensions({ ...zone, clearDimensionPolicy: 'finish-faces' }, context),
    ).toEqual([])
    expect(buildRoomClearDimensions({ ...zone, enclosureStatus: 'open' }, context)).toEqual([])
    expect(buildRoomClearDimensions({ ...zone, autoFromWalls: false }, context)).toEqual([])

    const missingWallNodes = { ...nodes }
    delete missingWallNodes[walls[0]!.id]
    expect(
      buildRoomClearDimensions(zone, {
        ...context,
        resolve: (id) => missingWallNodes[id],
      }),
    ).toEqual([])
  })

  test('suppresses dimensions for a proven enclosure that is not rectangular', () => {
    const { context, zone } = enclosure([
      [0, 0],
      [4, 0],
      [4, 2],
      [2, 3],
      [0, 2],
    ])

    expect(buildRoomClearDimensions(zone, context)).toEqual([])
  })
})
