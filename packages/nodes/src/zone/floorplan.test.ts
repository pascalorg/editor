import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  containsPoint,
  type FloorplanGeometry,
  type GeometryContext,
  ZoneNode,
} from '@pascal-app/core'
import { createFloorplanContextExtensions, readFloorplanGeometryMetadata } from '@pascal-app/editor'
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
      'Office',
      '101',
      'FL: Timber · WL: Paint · CL: ACT',
      'CH: 2.7m · Business',
    ])
    expect(labels.every((label) => label.kind === 'text' && label.upright)).toBe(true)
    expect(
      labels.every((label) => readFloorplanGeometryMetadata(label).annotationRole === 'room-label'),
    ).toBe(true)
  })

  test('the editor canvas labels zones with pills, so it draws no tags or wash; unit painting keeps both', () => {
    const room = ZoneNode.parse({
      id: 'zone_pill_room',
      name: 'Office',
      spaceRole: 'room',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
    })
    const drawn = ZoneNode.parse({ id: 'zone_pill_drawn', name: 'Nook', polygon: room.polygon })
    const overlay = {
      ...context,
      extensions: createFloorplanContextExtensions({ roomLabelOverlay: true }),
    }
    const fill = (geometry: FloorplanGeometry | null) =>
      geometry?.kind === 'group' && 'fillOpacity' in geometry.children[0]!
        ? geometry.children[0].fillOpacity
        : undefined
    for (const zone of [room, drawn]) {
      const editor = buildZoneFloorplan(zone, overlay)
      expect(textChildren(editor)).toEqual([])
      expect(fill(editor)).toBe(0)
      expect(textChildren(buildZoneFloorplan(zone, context)).length).toBeGreaterThan(0)
      const painting = buildZoneFloorplan(zone, {
        ...overlay,
        viewState: {
          selected: false,
          unit: 'metric',
          highlighted: false,
          hovered: false,
          moving: false,
          focusedUnitId: 'unit_paint',
        } as never,
      })
      expect(textChildren(painting).length).toBeGreaterThan(0)
      expect(fill(painting)).toBeGreaterThan(0)
    }
  })

  test('a drafted sheet gets only an invisible outline', () => {
    const room = ZoneNode.parse({
      id: 'zone_sheet',
      name: 'Office',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      spaceRole: 'room',
    })
    const geometry = buildZoneFloorplan(room, {
      ...context,
      extensions: createFloorplanContextExtensions({ drafting: true }),
    })
    expect(textChildren(geometry)).toEqual([])
    expect(geometry).toEqual({
      kind: 'group',
      children: [expect.objectContaining({ kind: 'polygon', fill: 'none', stroke: 'none' })],
    })
  })
})

test('zone floorplan leaves holes empty and labels the usable interior', () => {
  const zone = ZoneNode.parse({
    name: 'Hall',
    polygon: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    holes: [
      [
        [3, 3],
        [7, 3],
        [7, 7],
        [3, 7],
      ],
    ],
  })
  const geometry = buildZoneFloorplan(zone, context)!
  expect(geometry.kind).toBe('group')
  if (geometry.kind !== 'group') throw new Error('Expected group')
  expect(geometry.children[0]).toMatchObject({ kind: 'path', fillRule: 'evenodd' })
  expect((geometry.children[0] as { d: string }).d.match(/M /g)).toHaveLength(2)
  const label = textChildren(geometry)[0]!
  expect(containsPoint([{ outer: zone.polygon, holes: zone.holes }], [label.x, label.y])).toBe(true)
})

describe('buildZoneFloorplan floor lift chip', () => {
  const room = (elevation?: number) =>
    ZoneNode.parse({
      id: 'zone_lifted',
      name: 'Lounge',
      parentId: 'level_lift',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      spaceRole: 'room',
      ...(elevation === undefined ? {} : { floor: { elevation } }),
    })
  const withPlate = (zone: ZoneNode): GeometryContext => {
    const level = { id: 'level_lift', type: 'level', children: ['slab_lift_base'] }
    const plate = {
      id: 'slab_lift_base',
      type: 'slab',
      plateRole: 'base',
      zoneIds: [zone.id],
      elevation: 0.05,
    }
    const byId: Record<string, unknown> = { [level.id]: level, [plate.id]: plate }
    return { ...context, resolve: ((id: string) => byId[id]) as GeometryContext['resolve'] }
  }
  const texts = (zone: ZoneNode) =>
    textChildren(buildZoneFloorplan(zone, withPlate(zone))).map(
      (child) => (child as { text: string }).text,
    )

  test('a raised or sunken room shows its lift above its name', () => {
    expect(texts(room(0.2))[0]).toBe('+0.15m')
    expect(texts(room(-0.25))[0]).toBe('−0.3m')
  })

  test('a room at its footprint floor shows none', () => {
    expect(texts(room(0.05))[0]).toBe('Lounge')
    expect(texts(room())[0]).toBe('Lounge')
  })
})

describe('buildZoneFloorplan after a scene load', () => {
  test('legacy zones stored without holes build once loaded, and the editor loads like the viewer', async () => {
    const { materializeRegisteredNodeDefaults, useScene } = await import('@pascal-app/core')
    const source = JSON.parse(
      readFileSync(
        new URL(
          '../../../core/src/utils/__fixtures__/project_hrY3qVVq16yo5Out.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as Record<string, Record<string, unknown>>
    const stored = Object.values(source).filter((node) => node.type === 'zone')
    expect(stored.some((zone) => !('holes' in zone))).toBe(true)

    const load = (nodes: Record<string, unknown>) => {
      useScene.getState().setScene(structuredClone(nodes) as never, [])
      return structuredClone(useScene.getState().nodes) as Record<string, any>
    }
    try {
      const viewer = load(source)
      expect(load(materializeRegisteredNodeDefaults(source))).toEqual(viewer)
      const zones = Object.values(viewer).filter((node) => node.type === 'zone')
      expect(zones.length).toBeGreaterThan(0)
      const resolve = ((id: string) => viewer[id]) as GeometryContext['resolve']
      for (const zone of zones)
        expect(() => buildZoneFloorplan(zone, { ...context, resolve })).not.toThrow()
    } finally {
      useScene.getState().unloadScene()
    }
  })
})
