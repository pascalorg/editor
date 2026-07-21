import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type FloorplanGeometry,
  type GeometryContext,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import { createFloorplanContextExtensions } from '@pascal-app/editor'
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
      palette: {
        measurementStroke: '#123456',
      } as NonNullable<GeometryContext['viewState']>['palette'],
    },
    extensions: createFloorplanContextExtensions({ purpose: 'edit' }),
  } satisfies GeometryContext
  return { context, nodes, walls, zone }
}

function withFinishAssembly(wall: WallNode): WallNode {
  return WallNode.parse({
    ...wall,
    thickness: undefined,
    assemblyLayers: [
      {
        id: `${wall.id}_core`,
        role: 'structure',
        side: 'core',
        thickness: 0.2,
        datumEligible: ['structural-face'],
      },
      {
        id: `${wall.id}_interior-finish`,
        role: 'interior-finish',
        side: 'interior',
        thickness: 0.02,
        datumEligible: ['finish-face'],
      },
      {
        id: `${wall.id}_exterior-finish`,
        role: 'exterior-finish',
        side: 'exterior',
        thickness: 0.02,
        datumEligible: ['finish-face'],
      },
    ],
  })
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

  test('dimensions finish faces when every boundary wall has assembly finish datums', () => {
    const { context, nodes, walls, zone } = enclosure([
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ])
    const assembledWalls = walls.map(withFinishAssembly)
    const assembledNodes = { ...nodes }
    for (const wall of assembledWalls) assembledNodes[wall.id] = wall

    const result = dimensions(
      buildRoomClearDimensions(
        { ...zone, clearDimensionPolicy: 'finish-faces' },
        {
          ...context,
          resolve: (id) => assembledNodes[id],
        },
      ),
    )

    expect(result).toHaveLength(2)
    expect(result.map((entry) => entry.text).sort()).toEqual(['2.76m', '3.76m'])
  })

  test('adds a room-to-room finish-face dimension for adjacent rectangular rooms', () => {
    const walls = [
      WallNode.parse({ id: 'wall_a_bottom', parentId: 'level_main', start: [0, 0], end: [4, 0] }),
      WallNode.parse({ id: 'wall_shared', parentId: 'level_main', start: [4, 0], end: [4, 3] }),
      WallNode.parse({ id: 'wall_a_top', parentId: 'level_main', start: [4, 3], end: [0, 3] }),
      WallNode.parse({ id: 'wall_a_left', parentId: 'level_main', start: [0, 3], end: [0, 0] }),
      WallNode.parse({ id: 'wall_b_bottom', parentId: 'level_main', start: [4, 0], end: [8, 0] }),
      WallNode.parse({ id: 'wall_b_right', parentId: 'level_main', start: [8, 0], end: [8, 3] }),
      WallNode.parse({ id: 'wall_b_top', parentId: 'level_main', start: [8, 3], end: [4, 3] }),
    ].map(withFinishAssembly)
    const zoneA = ZoneNode.parse({
      id: 'zone_a',
      parentId: 'level_main',
      name: 'A',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      autoFromWalls: true,
      boundaryWallIds: ['wall_a_bottom', 'wall_shared', 'wall_a_top', 'wall_a_left'],
      spaceRole: 'room',
      clearDimensionPolicy: 'finish-faces',
    })
    const zoneB = ZoneNode.parse({
      id: 'zone_b',
      parentId: 'level_main',
      name: 'B',
      polygon: [
        [4, 0],
        [8, 0],
        [8, 3],
        [4, 3],
      ],
      autoFromWalls: true,
      boundaryWallIds: ['wall_b_bottom', 'wall_b_right', 'wall_b_top', 'wall_shared'],
      spaceRole: 'room',
      clearDimensionPolicy: 'finish-faces',
    })
    const nodes = Object.fromEntries(
      [...walls, zoneA, zoneB].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const context = {
      resolve: (id) => nodes[id],
      children: [],
      siblings: [zoneB],
      parent: null,
      viewState: {
        selected: false,
        highlighted: false,
        hovered: false,
        moving: false,
        unit: 'metric',
        palette: {
          measurementStroke: '#123456',
        } as NonNullable<GeometryContext['viewState']>['palette'],
      },
      extensions: createFloorplanContextExtensions({ purpose: 'edit' }),
    } satisfies GeometryContext

    const result = dimensions(buildRoomClearDimensions(zoneA, context))

    expect(result.map((entry) => entry.text).sort()).toEqual(['2.76m', '3.76m', 'R-R 0.24m'])
    expect(result.find((entry) => entry.text.startsWith('R-R'))?.text).toBe('R-R 0.24m')
  })

  test('dimensions proven rectilinear room bays beyond simple rectangles', () => {
    const { context, zone } = enclosure([
      [0, 0],
      [4, 0],
      [4, 2],
      [2, 2],
      [2, 4],
      [0, 4],
    ])

    const result = dimensions(buildRoomClearDimensions(zone, context))

    expect(result.map((entry) => entry.text).sort()).toEqual(['1.8m', '1.8m', '3.8m', '3.8m'])
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
