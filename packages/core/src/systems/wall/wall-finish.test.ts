import { describe, expect, test } from 'bun:test'
import { extractRooms } from '../../lib/room-graph'
import { WallNode } from '../../schema/nodes/wall'
import { ZoneNode } from '../../schema/nodes/zone'
import {
  buildWallFinishLayout,
  getWallZoneSpans,
  resolveWallFaceChain,
  resolveWallFinish,
  type WallFinishHit,
  wallFinishMaterialIndex,
} from './wall-finish'

// Two rooms side by side on the a side (+z) of one long wall; the partition
// meets the long wall mid-span (a T-junction at x = 4). Side b faces outside.
//
//   z=4  +-------+-------+
//        |   A   |   B   |
//   z=0  +=======+=======+   ← host wall 0 → 8 (face a up, face b down)
function tJunction(host: Partial<WallNode> = {}) {
  const wall = (id: string, start: [number, number], end: [number, number], extra = {}) =>
    WallNode.parse({ id, parentId: 'level_t', start, end, ...extra })
  const walls = [
    wall('wall_host', [0, 0], [8, 0], host),
    wall('wall_east', [8, 0], [8, 4]),
    wall('wall_north', [8, 4], [0, 4]),
    wall('wall_west', [0, 4], [0, 0]),
    wall('wall_partition', [4, 0], [4, 4]),
  ]
  const rooms = extractRooms(walls)
  expect(rooms).toHaveLength(2)
  const zone = (name: 'A' | 'B', extra: Partial<ZoneNode> = {}) => {
    const room = rooms.find((candidate) =>
      candidate.referencePolygon.every(([x]) => (name === 'A' ? x <= 4 : x >= 4)),
    )!
    return ZoneNode.parse({
      id: `zone_${name}`,
      parentId: 'level_t',
      name,
      spaceRole: 'room',
      autoFromWalls: true,
      polygon: room.referencePolygon,
      holes: room.holes,
      boundaryWallIds: [...new Set(room.spans.map((span) => span.boundaryId))],
      ...extra,
    })
  }
  return { host: walls[0]!, zone }
}

const describeHit = (hit: WallFinishHit) =>
  hit.source === 'slot' ? 'slot' : `${hit.source}:${hit.ref}`

describe('wall face spans from zones', () => {
  test('a long wall bordering two rooms on one face splits at the T-junction', () => {
    const { host, zone } = tJunction()
    expect(getWallZoneSpans(host, [zone('A'), zone('B')])).toEqual([
      { zoneId: 'zone_A', face: 'a', t0: 0, t1: 0.5 },
      { zoneId: 'zone_B', face: 'a', t0: 0.5, t1: 1 },
    ])
  })

  test('the face follows the wall direction, not the room', () => {
    const { host, zone } = tJunction()
    const reversed = { ...host, start: host.end, end: host.start }
    expect(getWallZoneSpans(reversed, [zone('A'), zone('B')])).toEqual([
      { zoneId: 'zone_B', face: 'b', t0: 0, t1: 0.5 },
      { zoneId: 'zone_A', face: 'b', t0: 0.5, t1: 1 },
    ])
  })

  test('a zone that does not list the wall contributes nothing', () => {
    const { host, zone } = tJunction()
    expect(getWallZoneSpans(host, [zone('A', { boundaryWallIds: [] })])).toEqual([])
  })
})

describe('wall finish resolution order', () => {
  // region > zone override for this face > zone wallMaterial > wall face slot > kind default
  test('each level wins over the ones below it, per span of the T-junction', () => {
    const { host, zone } = tJunction({
      slots: { a: 'library:slot-a' },
      faceRegions: [{ id: 'wainscot', face: 'a', u0: 1, u1: 5, v1: 0.9, finish: 'library:wood' }],
    })
    const zones = [
      zone('A', { wallMaterial: 'library:room-a' }),
      zone('B', {
        wallMaterial: 'library:room-b',
        wallOverrides: [{ wallId: 'wall_host', face: 'a', finish: 'library:override-b' }],
      }),
    ]
    const layout = buildWallFinishLayout(host, zones)
    const at = (face: 'a' | 'b', u: number, v: number) =>
      describeHit(resolveWallFinish(layout, face, u, v))

    const table: Array<[string, ReturnType<typeof at>, string]> = [
      ['region over room A', at('a', 2, 0.5), 'region:library:wood'],
      ['region over room B override', at('a', 4.5, 0.5), 'region:library:wood'],
      ['room A above the region', at('a', 2, 1.5), 'zone:library:room-a'],
      ['room A beside the region', at('a', 0.5, 0.5), 'zone:library:room-a'],
      ['room B override beats its room finish', at('a', 6, 0.5), 'override:library:override-b'],
      ['room B override above the region', at('a', 4.5, 1.5), 'override:library:override-b'],
      ['outside face falls back to the face slot', at('b', 2, 0.5), 'slot'],
      [
        'mitred corner past the end stays in room B',
        at('a', 8.05, 1),
        'override:library:override-b',
      ],
    ]
    for (const [label, actual, expected] of table)
      expect([label, actual]).toEqual([label, expected])

    expect(resolveWallFaceChain(host, 'a')).toEqual({ kind: 'ref', ref: 'library:slot-a' })
    expect(resolveWallFaceChain(host, 'b')).toEqual({
      kind: 'default',
      ref: 'library:concrete-drywall',
    })
  })

  test('removing each level exposes the next one', () => {
    const { host, zone } = tJunction()
    const at = (wall: WallNode, zones: ZoneNode[]) =>
      describeHit(resolveWallFinish(buildWallFinishLayout(wall, zones), 'a', 6, 0.5))
    const region = { id: 'r', face: 'a' as const, finish: 'library:region' }
    const override = [{ wallId: 'wall_host', face: 'a' as const, finish: 'library:override' }]
    const withSlot = { ...host, slots: { a: 'library:slot' } }

    expect(
      at({ ...withSlot, faceRegions: [region] }, [
        zone('B', { wallMaterial: 'library:zone', wallOverrides: override }),
      ]),
    ).toBe('region:library:region')
    expect(
      at(withSlot, [zone('B', { wallMaterial: 'library:zone', wallOverrides: override })]),
    ).toBe('override:library:override')
    expect(at(withSlot, [zone('B', { wallMaterial: 'library:zone' })])).toBe('zone:library:zone')
    expect(at(withSlot, [zone('B')])).toBe('slot')
    expect(resolveWallFaceChain(withSlot, 'a')).toEqual({ kind: 'ref', ref: 'library:slot' })
    expect(resolveWallFaceChain(host, 'a')).toEqual({
      kind: 'default',
      ref: 'library:concrete-drywall',
    })
  })

  test('later regions win and legacy inline finishes sit between slot and default', () => {
    const wall = WallNode.parse({
      start: [0, 0],
      end: [4, 0],
      faceRegions: [
        { id: 'low', face: 'b', v1: 1, finish: 'library:first' },
        { id: 'strip', face: 'b', v0: 0.5, v1: 0.7, finish: 'library:second' },
      ],
      legacyFaceMaterials: { b: { materialPreset: 'library:legacy-b' } },
      materialPreset: 'library:legacy-wall',
    })
    const layout = buildWallFinishLayout(wall, [])
    expect(describeHit(resolveWallFinish(layout, 'b', 1, 0.6))).toBe('region:library:second')
    expect(describeHit(resolveWallFinish(layout, 'b', 1, 0.2))).toBe('region:library:first')
    expect(resolveWallFaceChain(wall, 'b')).toEqual({
      kind: 'legacy',
      spec: { material: undefined, materialPreset: 'library:legacy-b' },
    })
    expect(resolveWallFaceChain(wall, 'a')).toEqual({
      kind: 'legacy',
      spec: { material: undefined, materialPreset: 'library:legacy-wall' },
    })
  })
})

describe('wall finish layout', () => {
  test('plain walls need no splits and draw faces with indices 1 and 2', () => {
    const { host, zone } = tJunction()
    const layout = buildWallFinishLayout(host, [zone('A'), zone('B')])
    expect(layout).toMatchObject({ plain: true, uSplits: [], vSplits: [], refs: [] })
    expect(wallFinishMaterialIndex(layout, 'a', { source: 'slot' })).toBe(1)
    expect(wallFinishMaterialIndex(layout, 'b', { source: 'slot' })).toBe(2)
  })

  test('splits only at bounds that exist and indexes extra finishes canonically', () => {
    const { host, zone } = tJunction({
      slots: { b: 'library:shared' },
      faceRegions: [{ id: 'r', face: 'b', u0: 2, v0: 0.3, v1: 0.9, finish: 'library:z-last' }],
    })
    const layout = buildWallFinishLayout(host, [
      zone('A', { wallMaterial: 'library:shared' }),
      zone('B', { wallMaterial: 'library:a-first' }),
    ])
    expect(layout.plain).toBe(false)
    expect(layout.uSplits).toEqual([2, 4])
    expect(layout.vSplits).toEqual([0.3, 0.9])
    // A finish equal to a face slot still gets its own entry: indices 1 / 2 are
    // the face chains alone, so previewing a face slot never repaints a room span.
    expect(layout.refs).toEqual(['library:a-first', 'library:shared', 'library:z-last'])
    const index = (face: 'a' | 'b', u: number, v: number) =>
      wallFinishMaterialIndex(layout, face, resolveWallFinish(layout, face, u, v))
    expect(index('a', 1, 1)).toBe(4)
    expect(index('a', 6, 1)).toBe(3)
    expect(index('b', 3, 0.5)).toBe(5)
    expect(index('b', 3, 1.5)).toBe(2)
  })
})
