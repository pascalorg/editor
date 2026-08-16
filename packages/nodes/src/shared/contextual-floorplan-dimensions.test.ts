import { describe, expect, test } from 'bun:test'
import {
  DoorNode,
  type GeometryContext,
  ItemNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '@pascal-app/core'
import { createFloorplanContextExtensions } from '@pascal-app/editor'
import { buildDoorContextualDimensions } from '../door/contextual-dimensions'
import { buildItemContextualDimensions } from '../item/floorplan'
import { buildWallContextualDimensions } from '../wall/contextual-dimensions'
import { buildWindowContextualDimensions } from '../window/contextual-dimensions'
import { buildZoneContextualDimensions } from '../zone/contextual-dimensions'

function context(
  parent: GeometryContext['parent'] = null,
  siblings: GeometryContext['siblings'] = [],
  moving = false,
): GeometryContext {
  return {
    resolve: () => undefined,
    children: [],
    siblings,
    parent,
    extensions: createFloorplanContextExtensions({
      metricNotation: 'meters',
      purpose: 'edit',
      wallDimensionReference: 'centerline',
    }),
    viewState: moving
      ? {
          selected: true,
          unit: 'metric',
          highlighted: false,
          hovered: false,
          moving: true,
        }
      : undefined,
  }
}

describe('contextual floor-plan dimensions', () => {
  test('uses modeled centerline length for a straight wall', () => {
    const wall = WallNode.parse({
      id: 'wall_primary',
      start: [0, 0],
      end: [4, 0],
    })

    expect(buildWallContextualDimensions(wall, context())).toMatchObject({
      kind: 'dimension',
      start: [0, 0],
      end: [4, 0],
      text: '4 m',
    })
  })

  test('places a selected corner-wall dimension on its exterior side', () => {
    const wall = WallNode.parse({
      id: 'wall_corner',
      start: [0, 0],
      end: [4, 0],
      frontSide: 'interior',
      backSide: 'exterior',
    })

    expect(buildWallContextualDimensions(wall, context())).toMatchObject({
      kind: 'dimension',
      offsetNormal: [0, -1],
    })
  })

  test('infers the outside of an unclassified perimeter wall from its connected plan', () => {
    const wall = WallNode.parse({
      id: 'wall_right',
      start: [4, 0],
      end: [4, 6],
    })
    const siblings = [
      WallNode.parse({ id: 'wall_top', start: [0, 0], end: [4, 0] }),
      WallNode.parse({ id: 'wall_bottom', start: [4, 6], end: [0, 6] }),
      WallNode.parse({ id: 'wall_left', start: [0, 6], end: [0, 0] }),
    ]

    expect(buildWallContextualDimensions(wall, context(null, siblings))).toMatchObject({
      kind: 'dimension',
      offsetNormal: [1, 0],
    })
  })

  test('shows one internal-wall dimension between the connected stud faces', () => {
    const wall = WallNode.parse({
      id: 'wall_internal',
      start: [0, 0],
      end: [0, 4],
      thickness: 0.1,
      frontSide: 'interior',
      backSide: 'interior',
    })
    const startWall = WallNode.parse({
      id: 'wall_start',
      start: [-2, 0],
      end: [2, 0],
      thickness: 0.2,
    })
    const endWall = WallNode.parse({
      id: 'wall_end',
      start: [-2, 4],
      end: [2, 4],
      thickness: 0.2,
    })

    expect(buildWallContextualDimensions(wall, context(null, [startWall, endWall]))).toEqual(
      expect.objectContaining({
        kind: 'dimension',
        start: [0, 0.1],
        end: [0, 3.9],
        offsetNormal: [-1, 0],
        text: '3,8 m',
      }),
    )
  })

  test('measures a selected perimeter wall between connected stud centerlines', () => {
    const wall = WallNode.parse({
      id: 'wall_perimeter',
      start: [0, 0],
      end: [0, 4],
      frontSide: 'interior',
      backSide: 'exterior',
    })
    const startWall = WallNode.parse({
      id: 'wall_start',
      start: [-2, 0],
      end: [2, 0],
      thickness: 0.2,
    })
    const endWall = WallNode.parse({
      id: 'wall_end',
      start: [-2, 4],
      end: [2, 4],
      thickness: 0.2,
    })

    expect(buildWallContextualDimensions(wall, context(null, [startWall, endWall]))).toMatchObject({
      kind: 'dimension',
      start: [0, 0],
      end: [0, 4],
      offsetNormal: [1, 0],
      text: '4 m',
    })
  })

  test('uses arc length for a curved wall', () => {
    const wall = WallNode.parse({
      id: 'wall_curved',
      start: [0, 0],
      end: [4, 0],
      curveOffset: 1,
    })
    const geometry = buildWallContextualDimensions(wall, context())

    expect(geometry).toMatchObject({ kind: 'dimension-label' })
    expect(
      geometry && 'text' in geometry ? Number.parseFloat(geometry.text.replace(',', '.')) : 0,
    ).toBeGreaterThan(4)
  })

  test('shows only an opening width along its host wall', () => {
    const wall = WallNode.parse({
      id: 'wall_host',
      start: [0, 0],
      end: [6, 0],
    })
    const door = DoorNode.parse({
      id: 'door_primary',
      parentId: wall.id,
      wallId: wall.id,
      position: [2, 1.05, 0],
      width: 0.9,
    })

    expect(buildDoorContextualDimensions(door, context(wall))).toMatchObject({
      kind: 'dimension',
      start: [1.55, 0],
      end: [2.45, 0],
      text: '0,9 m',
    })
  })

  test('shows a selected window width on the exterior side', () => {
    const wall = WallNode.parse({
      id: 'wall_host',
      start: [0, 0],
      end: [6, 0],
      frontSide: 'interior',
      backSide: 'exterior',
    })
    const startWall = WallNode.parse({
      id: 'wall_start',
      start: [0, -2],
      end: [0, 2],
      thickness: 0.2,
    })
    const endWall = WallNode.parse({
      id: 'wall_end',
      start: [6, -2],
      end: [6, 2],
      thickness: 0.2,
    })
    const window = WindowNode.parse({
      id: 'window_primary',
      parentId: wall.id,
      wallId: wall.id,
      position: [2, 1.05, 0],
      width: 1,
    })

    expect(
      buildWindowContextualDimensions(window, context(wall, [startWall, endWall])),
    ).toMatchObject({
      kind: 'dimension',
      offsetNormal: [0, -1],
      start: [1.5, 0],
      end: [2.5, 0],
      text: '1 m',
    })
  })

  test('updates both window clearances from its live wall-local position', () => {
    const wall = WallNode.parse({
      id: 'wall_host',
      start: [0, 0],
      end: [6, 0],
      frontSide: 'interior',
      backSide: 'exterior',
    })
    const startWall = WallNode.parse({
      id: 'wall_start',
      start: [0, -2],
      end: [0, 2],
      thickness: 0.2,
    })
    const endWall = WallNode.parse({
      id: 'wall_end',
      start: [6, -2],
      end: [6, 2],
      thickness: 0.2,
    })
    const draggedWindow = WindowNode.parse({
      id: 'window_primary',
      parentId: wall.id,
      wallId: wall.id,
      position: [3, 1.05, 0],
      width: 1,
    })
    const geometry = buildWindowContextualDimensions(
      draggedWindow,
      context(wall, [startWall, endWall], true),
    )

    expect(
      geometry?.kind === 'dimension-string' ? geometry.segments.map((segment) => segment.text) : [],
    ).toEqual(['2,4 m', '1 m', '2,4 m'])
  })

  test('shows room area at the polygon centroid', () => {
    const room = ZoneNode.parse({
      id: 'zone_room',
      name: 'Office',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      spaceRole: 'room',
    })

    expect(buildZoneContextualDimensions(room, context())).toMatchObject({
      kind: 'dimension-label',
      cx: 2,
      cy: 1.5,
      text: '12,0 m²',
    })
  })

  test('shows item width and depth without placement chains', () => {
    const item = ItemNode.parse({
      id: 'item_primary',
      position: [2, 0, 3],
      scale: [2, 1, 1],
      asset: {
        id: 'table',
        category: 'furniture',
        name: 'Table',
        thumbnail: '',
        src: 'asset://table',
        dimensions: [1.2, 0.8, 0.6],
      },
    })
    const geometry = buildItemContextualDimensions(item, context())

    expect(geometry?.kind).toBe('group')
    expect(
      geometry?.kind === 'group'
        ? geometry.children.map((child) => ('text' in child ? child.text : null))
        : [],
    ).toEqual(['2,4 m', '0,6 m'])
  })
})
