import { describe, expect, test } from 'bun:test'
import { DEFAULT_SPEC } from '../core/spec'
import type { DeviceOverride, Member, OpeningSlice, RoomSlice, WallSlice } from '../core/types'
import {
  applyDeviceOverrides,
  DEVICE_BOX_W,
  deviceWallOf,
  layoutElectrical,
  RECEPTACLE_HEIGHT_BAND,
  SWITCH_HEIGHT_BAND,
} from './electrical'
import { frameWall, frameWalls } from './wall-framing'

/**
 * Movable outlets (Q7) — engine gates, checklist row E5:
 *  - every wall device fixture carries a DETERMINISTIC meta.deviceId
 *    (unchanged scene → identical ids; editing another wall never shuffles
 *    a wall's own ids);
 *  - a moved bones:device override WINS over the derived spot, but lands
 *    code-legal: never inside an RO (snap-out + warning), box edge against
 *    a stud face, off-stud books a device-blocking member (SAT-clean vs the
 *    bay studs), heights clamp to the legal bands;
 *  - the NEC 210.52 spacing advisory fires on a real >12ft gap and NEVER on
 *    untouched walls;
 *  - zero overrides return the fixtures REFERENCE-EQUAL (byte-equality).
 */

function makeWall(overrides: Partial<WallSlice> = {}): WallSlice {
  const start = overrides.start ?? [0, 0]
  const end = overrides.end ?? [6, 0]
  const dx = (end[0] ?? 0) - (start[0] ?? 0)
  const dz = (end[1] ?? 0) - (start[1] ?? 0)
  const length = Math.hypot(dx, dz)
  return {
    id: 'w1',
    start,
    end,
    dir: [dx / length, dz / length],
    length,
    thickness: 0.114,
    height: 2.44,
    exterior: true,
    openings: [] as OpeningSlice[],
    curved: false,
    ...overrides,
  }
}

const door = (u: number, roughWidth = 0.95): OpeningSlice => ({
  id: `door_${u}`,
  kind: 'door',
  u,
  width: roughWidth - 0.05,
  roughWidth,
  height: 2.1,
  roughHeight: 2.15,
  sillHeight: 0,
})

const room = (
  id: string,
  category: RoomSlice['category'],
  polygon: [number, number][],
): RoomSlice => ({ id, name: category, category, polygon, boundaryWallIds: [], ceilingHeight: 2.5 })

/** Along-wall coordinate of a fixture position. */
const uOn = (wall: WallSlice, p: readonly [number, number, number]): number =>
  (p[0] - wall.start[0]) * wall.dir[0] + (p[2] - wall.start[1]) * wall.dir[1]

const deviceFixtures = (fixtures: ReturnType<typeof layoutElectrical>) =>
  fixtures.filter(
    (f) => f.kind === 'receptacle' || f.kind === 'receptacle-gfci' || f.kind === 'switch',
  )

describe('deterministic device ids', () => {
  const scene = () => {
    const walls = [
      makeWall({ id: 'w_s', start: [0, 0], end: [8, 0], openings: [door(3)] }),
      makeWall({ id: 'w_e', start: [8, 0], end: [8, 6] }),
      makeWall({
        id: 'w_mid',
        start: [4, 0],
        end: [4, 6],
        exterior: false,
      }),
    ]
    const rooms = [
      room('r_kitchen', 'kitchen', [
        [4, 0],
        [8, 0],
        [8, 6],
        [4, 6],
      ]),
      room('r_living', 'other', [
        [0, 0],
        [4, 0],
        [4, 6],
        [0, 6],
      ]),
    ]
    return { walls, rooms }
  }

  test('every wall device carries a deviceId; lights/alarms/panel do not', () => {
    const { walls, rooms } = scene()
    const fixtures = layoutElectrical(walls, rooms)
    for (const f of fixtures) {
      const hasId = typeof f.meta?.deviceId === 'string' && (f.meta?.deviceId as string).length > 0
      if (
        f.kind === 'receptacle' ||
        f.kind === 'receptacle-gfci' ||
        f.kind === 'receptacle-wr-gfci' ||
        f.kind === 'switch'
      ) {
        expect(hasId).toBe(true)
      } else {
        expect(hasId).toBe(false)
      }
    }
    // unique across the level
    const ids = deviceFixtures(fixtures).map((f) => String(f.meta?.deviceId))
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('unchanged scene → byte-identical fixtures (ids included)', () => {
    const a = layoutElectrical(scene().walls, scene().rooms)
    const b = layoutElectrical(scene().walls, scene().rooms)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  test('adding a wall elsewhere never shuffles another wall’s ids', () => {
    const { walls, rooms } = scene()
    const before = new Map(
      deviceFixtures(layoutElectrical(walls, rooms))
        .filter((f) => f.sourceId === 'w_s' || f.sourceId.startsWith('door_'))
        .map((f) => [String(f.meta?.deviceId), f.position] as const),
    )
    const grown = [...walls, makeWall({ id: 'w_n', start: [8, 6], end: [0, 6] })]
    const after = new Map(
      deviceFixtures(layoutElectrical(grown, rooms))
        .filter((f) => f.sourceId === 'w_s' || f.sourceId.startsWith('door_'))
        .map((f) => [String(f.meta?.deviceId), f.position] as const),
    )
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort())
    for (const [id, pos] of before) expect(after.get(id)).toEqual(pos)
  })
})

describe('applyDeviceOverrides — code-aware snapping', () => {
  /** One bare 6 m wall, its framing, and its derived devices. */
  const rig = (overrides: Partial<WallSlice> = {}) => {
    const wall = makeWall(overrides)
    const walls = [wall]
    const members = frameWalls(walls, DEFAULT_SPEC)
    const fixtures = layoutElectrical(walls, [])
    return { wall, walls, members, fixtures }
  }
  const studHalfT = 0.0381 / 2 // 2x4 thickness/2
  const boxHalf = DEVICE_BOX_W / 2

  test('zero overrides: fixtures come back REFERENCE-EQUAL, no members/warnings', () => {
    const { walls, members, fixtures } = rig()
    const applied = applyDeviceOverrides(fixtures, walls, [], members, new Map())
    expect(applied.fixtures).toBe(fixtures)
    expect(applied.members).toEqual([])
    expect(applied.warnings).toEqual([])
    const appliedUndef = applyDeviceOverrides(fixtures, walls, [], members, undefined)
    expect(appliedUndef.fixtures).toBe(fixtures)
  })

  test('override wins: wallT + heightAff move the box; edge lands on a stud face', () => {
    const { wall, walls, members, fixtures } = rig()
    const id = String(fixtures.find((f) => f.kind === 'receptacle')?.meta?.deviceId)
    const overrides = new Map<string, DeviceOverride>([
      [id, { wallId: wall.id, wallT: 1.0 / wall.length, heightAff: 0.6 }],
    ])
    const applied = applyDeviceOverrides(fixtures, walls, [], members, overrides)
    const moved = applied.fixtures.find((f) => f.meta?.deviceId === id)
    expect(moved).toBeDefined()
    expect(moved?.position[1]).toBeCloseTo(0.6, 6)
    // nearest stud face to u=1.0: grid stud at 0.8318 → box center 0.8318 +
    // halfT + boxW/2, box EDGE exactly on the stud face
    const u = uOn(wall, (moved as NonNullable<typeof moved>).position)
    const studFaces = members
      .filter((m) => m.role === 'stud')
      .flatMap((m) => {
        const su = uOn(wall, m.position)
        return [su - studHalfT, su + studHalfT]
      })
    const boxEdges = [u - boxHalf, u + boxHalf]
    const edgeOnStud = boxEdges.some((e) => studFaces.some((f) => Math.abs(e - f) < 1e-6))
    expect(edgeOnStud).toBe(true)
    expect(Math.abs(u - 1.0)).toBeLessThan(0.21) // snapped within half a 16" bay
    // no blocking booked — the stud IS the mount
    expect(applied.members).toEqual([])
  })

  test('RO rule: an override into a door RO snaps clear + warns; box clears the RO and mounts on the king stud', () => {
    const { wall, walls, members, fixtures } = rig({ openings: [door(3)] })
    const id = String(fixtures.find((f) => f.kind === 'receptacle')?.meta?.deviceId)
    const overrides = new Map<string, DeviceOverride>([
      [id, { wallId: wall.id, wallT: 3 / wall.length }], // dead center of the door
    ])
    const applied = applyDeviceOverrides(fixtures, walls, [], members, overrides)
    expect(applied.warnings.some((w) => w.includes('rough opening'))).toBe(true)
    const moved = applied.fixtures.find((f) => f.meta?.deviceId === id)
    const u = uOn(wall, (moved as NonNullable<typeof moved>).position)
    const roLo = 3 - 0.95 / 2
    const roHi = 3 + 0.95 / 2
    expect(u + boxHalf <= roLo || u - boxHalf >= roHi).toBe(true)
    // and the stud rule still applies — edge against a vertical's face
    const faces = members
      .filter((m) => ['stud', 'king-stud', 'trimmer'].includes(m.role))
      .flatMap((m) => {
        const su = uOn(wall, m.position)
        return [su - m.dims[0] / 2, su + m.dims[0] / 2]
      })
    const onFace = [u - boxHalf, u + boxHalf].some((e) =>
      faces.some((f) => Math.abs(e - f) < 1e-6),
    )
    expect(onFace).toBe(true)
  })

  test('off-stud: sparse rhythm books a device-blocking member, SAT-clean against the bay studs, box stays put', () => {
    const { wall, walls, fixtures } = rig()
    // Synthetic sparse verticals: studs only at u=0.019 and u=2.0.
    const stud = (u: number): Member => ({
      system: 'wall-framing',
      role: 'stud',
      size: '2x4',
      dims: [0.0381, 2.3, 0.0889],
      length: 2.3,
      position: [wall.start[0] + wall.dir[0] * u, 0.0381 + 2.3 / 2, wall.start[1] + wall.dir[1] * u],
      rotation: [0, 0, 0],
      material: 'lumber',
      sourceId: wall.id,
    })
    const members = [stud(0.019), stud(2.0)]
    const id = String(fixtures.find((f) => f.kind === 'receptacle')?.meta?.deviceId)
    const overrides = new Map<string, DeviceOverride>([
      [id, { wallId: wall.id, wallT: 1.0 / wall.length, heightAff: 0.45 }],
    ])
    const applied = applyDeviceOverrides(fixtures, walls, [], members, overrides)
    // position KEPT (nearest stud face is ~0.9 m away — more than half a bay)
    const moved = applied.fixtures.find((f) => f.meta?.deviceId === id)
    expect(uOn(wall, (moved as NonNullable<typeof moved>).position)).toBeCloseTo(1.0, 6)
    expect(moved?.position[1]).toBeCloseTo(0.45, 6)
    // blocking spans the clear bay at box height
    expect(applied.members).toHaveLength(1)
    const block = applied.members[0] as Member
    expect(block.role).toBe('blocking')
    expect(block.label).toBe('device blocking — box off-stud')
    expect(block.position[1]).toBeCloseTo(0.45, 6)
    const bu = uOn(wall, block.position)
    const b0 = bu - block.dims[0] / 2
    const b1 = bu + block.dims[0] / 2
    // SAT-clean: the block's run interval touches the stud faces, never
    // enters them (face contact is not interpenetration)
    expect(b0).toBeGreaterThanOrEqual(0.019 + 0.0381 / 2 - 1e-9)
    expect(b1).toBeLessThanOrEqual(2.0 - 0.0381 / 2 + 1e-9)
    expect(block.dims[0]).toBeCloseTo(2.0 - 0.019 - 0.0381, 6)
  })

  test('STEEL wall (LGS Phase 1): off-stud blocking is CFS steel, labeled not-booked — never phantom wood', () => {
    const { wall, walls, fixtures } = rig()
    // Synthetic sparse STEEL verticals: catalog C-studs carry no LumberSize.
    const steelStud = (u: number): Member => ({
      system: 'wall-framing',
      role: 'stud',
      dims: [0.0413, 2.3, 0.0889],
      length: 2.3,
      position: [wall.start[0] + wall.dir[0] * u, 0.0413 + 2.3 / 2, wall.start[1] + wall.dir[1] * u],
      rotation: [0, 0, 0],
      material: 'steel',
      sourceId: wall.id,
      profile: '350S162-68',
    })
    const members = [steelStud(0.021), steelStud(2.0)]
    const id = String(fixtures.find((f) => f.kind === 'receptacle')?.meta?.deviceId)
    const overrides = new Map<string, DeviceOverride>([
      [id, { wallId: wall.id, wallT: 1.0 / wall.length, heightAff: 0.45 }],
    ])
    const applied = applyDeviceOverrides(fixtures, walls, [], members, overrides)
    expect(applied.members).toHaveLength(1)
    const block = applied.members[0] as Member
    expect(block.role).toBe('blocking')
    expect(block.material).toBe('steel')
    expect(block.size).toBeUndefined()
    expect(block.label).toContain('CFS strap/track blocking per detail — not booked')
    // and the takeoff really books nothing for it: no LumberSize keeps it
    // off the lumber pcs rows, no `profile` keeps it off the LGS lf rows —
    // exactly what the label states.
  })

  test('one blocking row serves a second off-stud box at the same height band', () => {
    const { wall, walls, fixtures } = rig()
    const stud = (u: number): Member => ({
      system: 'wall-framing',
      role: 'stud',
      size: '2x4',
      dims: [0.0381, 2.3, 0.0889],
      length: 2.3,
      position: [wall.start[0] + wall.dir[0] * u, 0.0381 + 2.3 / 2, wall.start[1] + wall.dir[1] * u],
      rotation: [0, 0, 0],
      material: 'lumber',
      sourceId: wall.id,
    })
    const members = [stud(0.019), stud(2.0)]
    const [d1, d2] = deviceFixtures(fixtures)
      .filter((f) => f.kind === 'receptacle')
      .map((f) => String(f.meta?.deviceId))
    const overrides = new Map<string, DeviceOverride>([
      [String(d1), { wallId: wall.id, wallT: 0.8 / wall.length, heightAff: 0.45 }],
      [String(d2), { wallId: wall.id, wallT: 1.2 / wall.length, heightAff: 0.46 }],
    ])
    const applied = applyDeviceOverrides(fixtures, walls, [], members, overrides)
    expect(applied.members).toHaveLength(1) // second box mounts to the first block
  })

  test('height clamps: receptacle and switch bands, with notes', () => {
    const { wall, walls, members, fixtures } = rig({ openings: [door(3)] })
    const recepId = String(fixtures.find((f) => f.kind === 'receptacle')?.meta?.deviceId)
    const switchId = String(fixtures.find((f) => f.kind === 'switch')?.meta?.deviceId)
    const overrides = new Map<string, DeviceOverride>([
      [recepId, { wallId: wall.id, wallT: 0.2, heightAff: 2.5 }],
      [switchId, { wallId: wall.id, wallT: 0.8, heightAff: 2.4 }],
    ])
    const applied = applyDeviceOverrides(fixtures, walls, [], members, overrides)
    const recep = applied.fixtures.find((f) => f.meta?.deviceId === recepId)
    const sw = applied.fixtures.find((f) => f.meta?.deviceId === switchId)
    expect(recep?.position[1]).toBeCloseTo(RECEPTACLE_HEIGHT_BAND[1], 6)
    expect(sw?.position[1]).toBeCloseTo(SWITCH_HEIGHT_BAND[1], 6)
    expect(applied.warnings.filter((w) => w.includes('height clamped'))).toHaveLength(2)
    expect(applied.warnings.some((w) => w.includes("404.8(A)"))).toBe(true)
    // and below the bands
    const low = new Map<string, DeviceOverride>([
      [switchId, { wallId: wall.id, wallT: 0.8, heightAff: 0.3 }],
    ])
    const appliedLow = applyDeviceOverrides(fixtures, walls, [], members, low)
    expect(
      appliedLow.fixtures.find((f) => f.meta?.deviceId === switchId)?.position[1],
    ).toBeCloseTo(SWITCH_HEIGHT_BAND[0], 6)
  })

  test('moved-position escape hatch outranks the wall anchor (nearest wall, re-keyed sourceId)', () => {
    const w1 = makeWall({ id: 'w1', start: [0, 0], end: [6, 0] })
    const w2 = makeWall({ id: 'w2', start: [0, 4], end: [6, 4] })
    const walls = [w1, w2]
    const members = frameWalls(walls, DEFAULT_SPEC)
    const fixtures = layoutElectrical(walls, [])
    const id = String(
      fixtures.find((f) => f.kind === 'receptacle' && f.sourceId === 'w1')?.meta?.deviceId,
    )
    const overrides = new Map<string, DeviceOverride>([
      [id, { wallId: 'w1', wallT: 0.5, position: [2, 0.4, 3.9] }],
    ])
    const applied = applyDeviceOverrides(fixtures, walls, [], members, overrides)
    const moved = applied.fixtures.find((f) => f.meta?.deviceId === id)
    expect(moved?.sourceId).toBe('w2')
    expect(Math.abs((moved as NonNullable<typeof moved>).position[2] - 4)).toBeLessThan(0.15)
    expect(deviceWallOf(moved as NonNullable<typeof moved>, walls)?.id).toBe('w2')
  })
})

describe('NEC 210.52 spacing advisory', () => {
  const rig = () => {
    const wall = makeWall({ id: 'w_long', start: [0, 0], end: [8, 0] })
    const walls = [wall]
    const members = frameWall(wall, DEFAULT_SPEC)
    const fixtures = layoutElectrical(walls, [])
    return { wall, walls, members, fixtures }
  }

  test('fires when a moved outlet leaves a >12ft gap', () => {
    const { wall, walls, members, fixtures } = rig()
    // derived: 3 receptacles at 1.33 / 4.0 / 6.67 — move the first to the
    // very start: midpoint of [0.16, 4.0] is 1.92 m > 6 ft from either
    const id = String(fixtures.find((f) => f.kind === 'receptacle')?.meta?.deviceId)
    const overrides = new Map<string, DeviceOverride>([
      [id, { wallId: wall.id, wallT: 0.02 }],
    ])
    const applied = applyDeviceOverrides(fixtures, walls, [], members, overrides)
    expect(
      applied.warnings.some((w) =>
        w.includes('receptacle spacing exceeds NEC 210.52 (moved outlet leaves a >12ft gap)'),
      ),
    ).toBe(true)
    expect(applied.warnings.some((w) => w.includes('wall w_long'))).toBe(true)
  })

  test('does NOT fire on a legal move, and never on untouched walls', () => {
    const { wall, walls, members, fixtures } = rig()
    const id = String(fixtures.find((f) => f.kind === 'receptacle')?.meta?.deviceId)
    // 1.33 → 1.0: max midpoint gap (4.0-1.0)/2 = 1.5 m < 6 ft
    const overrides = new Map<string, DeviceOverride>([
      [id, { wallId: wall.id, wallT: 1.0 / wall.length }],
    ])
    const applied = applyDeviceOverrides(fixtures, walls, [], members, overrides)
    expect(applied.warnings.some((w) => w.includes('210.52'))).toBe(false)
    // untouched scene: no overrides — no spacing pass at all
    const untouched = applyDeviceOverrides(fixtures, walls, [], members, new Map())
    expect(untouched.warnings).toEqual([])
  })

  test('a switch move never trips the receptacle spacing pass', () => {
    const wall = makeWall({ id: 'w_d', start: [0, 0], end: [8, 0], openings: [door(4)] })
    const walls = [wall]
    const members = frameWall(wall, DEFAULT_SPEC)
    const fixtures = layoutElectrical(walls, [])
    const id = String(fixtures.find((f) => f.kind === 'switch')?.meta?.deviceId)
    const overrides = new Map<string, DeviceOverride>([
      [id, { wallId: wall.id, wallT: 0.9, heightAff: 1.4 }],
    ])
    const applied = applyDeviceOverrides(fixtures, walls, [], members, overrides)
    expect(applied.warnings.some((w) => w.includes('210.52'))).toBe(false)
  })
})
