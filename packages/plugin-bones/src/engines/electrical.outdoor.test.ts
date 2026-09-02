import { describe, expect, test } from 'bun:test'
import type { DeviceOverrides, Fixture, OpeningSlice, RoomSlice, WallSlice } from '../core/types'
import { inches } from '../core/units'
import { applyDeviceOverrides, layoutElectrical, pointInPolygon, routeWiring } from './electrical'
import { unreachableDevices } from './electrical.test-helpers'

/**
 * NIGHT-10 gates — OUTDOOR-ZONE ELECTRICAL HONESTY (the day-9 residual
 * family two skeptics verified): the electrical engine counted outdoor
 * zones (M4 open-air category) as rooms —
 *  - a garden-only level composed 'Light — Garden' floating in open air
 *    AND 'Smoke alarm — one per story (R314.3(3))' hanging in the yard;
 *  - mixed scenes gave outdoor zones ceiling lights at y=2.7 in open air,
 *    and a big garden could OUTRANK the living room for the per-story
 *    alarm election;
 *  - interiorFaces() treated a garden polygon like a room: interior-style
 *    15" receptacles minted on the yard side of shell walls (while the
 *    indoor face got none) and on garden fences.
 * DECISIONS (stated): ceiling lights in outdoor zones are FICTION → the
 * zone's honest lighting is NEC 210.70(A)(2)(2)'s own requirement — a
 * wall-mounted exterior fixture above each dwelling door into the zone;
 * zones with no dwelling entrance warn. Smoke alarms NEVER mount in
 * outdoor zones (R314 covers the dwelling interior) — the per-story alarm
 * elects the largest INDOOR room and an outdoor-only level warns (E6
 * never-silent convention). The 210.52(A) walk skips open-air faces; the
 * B14a WR machinery stays the outdoor-coverage answer.
 */

const RO_PAD = inches(1.5)

function wall(
  id: string,
  start: [number, number],
  end: [number, number],
  overrides: Partial<WallSlice> = {},
): WallSlice {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  return {
    id,
    start,
    end,
    length,
    dir: [dx / length, dz / length],
    thickness: 0.15,
    height: 2.5,
    exterior: true,
    openings: [],
    curved: false,
    ...overrides,
  }
}

function door(u: number, width = 0.9, id = 'door_test'): OpeningSlice {
  return {
    id,
    kind: 'door',
    u,
    width,
    height: 2.1,
    sillHeight: 0,
    roughWidth: width + RO_PAD,
    roughHeight: 2.1 + RO_PAD,
  }
}

function room(
  category: RoomSlice['category'],
  polygon: readonly (readonly [number, number])[],
  overrides: Partial<RoomSlice> = {},
): RoomSlice {
  return {
    id: `room_${category}`,
    name: category,
    category,
    polygon,
    boundaryWallIds: [],
    ceilingHeight: 2.7,
    ...overrides,
  }
}

const GARDEN: readonly (readonly [number, number])[] = [
  [0, -10],
  [12, -10],
  [12, 0],
  [0, 0],
]

/** Garden-house shape: 12×8 shell (living), 12×10 garden to the NORTH
 * (z < 0 — LARGER than the living room, the alarm-election trap), privacy
 * fences around the garden, a garden door in the north wall. The north
 * wall runs [12,0]→[0,0] so its +normal face is the GARDEN side — the
 * orientation whose face election used to hand the garden the interior
 * receptacles and flip the meter indoors. */
function gardenHouse(): { walls: WallSlice[]; rooms: RoomSlice[]; garden: RoomSlice; living: RoomSlice } {
  const walls = [
    wall('w_n', [12, 0], [0, 0], { openings: [door(3, 0.9, 'door_garden')] }),
    wall('w_e', [12, 8], [12, 0]),
    wall('w_s', [0, 8], [12, 8], { openings: [door(2, 0.9, 'door_front')] }),
    wall('w_w', [0, 0], [0, 8]),
    wall('fence_n', [0, -10], [12, -10], { thickness: 0.08, height: 1.8 }),
    wall('fence_e', [12, -10], [12, 0], { thickness: 0.08, height: 1.8 }),
    wall('fence_w', [0, 0], [0, -10], { thickness: 0.08, height: 1.8 }),
  ]
  const garden = room('outdoor', GARDEN, { id: 'zone_garden', name: 'Back garden' })
  const living = room(
    'other',
    [
      [0, 0],
      [12, 0],
      [12, 8],
      [0, 8],
    ],
    { id: 'zone_living', name: 'Living' },
  )
  // garden FIRST: the old lighting-VA packing burned LTG-1 on the yard
  return { walls, rooms: [garden, living], garden, living }
}

const inGarden = (f: Fixture): boolean => pointInPolygon([f.position[0], f.position[2]], GARDEN)

describe('outdoor zones — ceiling fixtures are open-air fiction (mixed scene)', () => {
  test('no ceiling light composes in the garden; the living room keeps its light', () => {
    const { walls, rooms } = gardenHouse()
    const fixtures = layoutElectrical(walls, rooms)
    const ceiling = fixtures.filter((f) => f.kind === 'light' && f.label?.startsWith('Light —'))
    expect(ceiling.length).toBe(1)
    expect(ceiling[0]?.sourceId).toBe('zone_living')
    expect(ceiling.some((f) => f.label?.includes('garden'))).toBe(false)
    expect(ceiling.some((f) => inGarden(f))).toBe(false)
  })

  test('the garden door gets a wall-mounted exterior light on the OUTDOOR face above the door (NEC 210.70(A)(2))', () => {
    const { walls, rooms, living } = gardenHouse()
    const warnings: string[] = []
    const fixtures = layoutElectrical(walls, rooms, undefined, warnings)
    const ext = fixtures.filter((f) => f.kind === 'light' && f.label?.startsWith('Exterior light'))
    expect(ext.length).toBe(1)
    const light = ext[0] as Fixture
    expect(light.label).toContain('Back garden')
    expect(light.label).toContain('210.70(A)(2)')
    // outdoor face of w_n (z < 0), centered over the door at u=3 → x=9,
    // mounted above the door head — never floating at ceiling height
    expect(light.position[2]).toBeLessThan(0)
    expect(light.position[0]).toBeCloseTo(9, 1)
    expect(light.position[1]).toBeGreaterThan(2.1)
    expect(light.position[1]).toBeLessThan(2.5)
    // it rides the served indoor room's lighting circuit — and with the
    // garden's phantom 220.12 VA no longer packed, that circuit is LTG-1
    expect(light.sourceId).toBe(living.id)
    const livingLight = fixtures.find((f) => f.kind === 'light' && f.sourceId === living.id && f !== light)
    expect(light.meta?.circuit).toBe('LTG-1')
    expect(light.meta?.circuit).toBe(livingLight?.meta?.circuit)
    // an entrance-lit zone does NOT warn about unmodeled lighting
    expect(warnings.some((w) => w.includes('ceiling lighting not modeled'))).toBe(false)
  })

  test('the exterior entrance light is wired: every circuit device reaches the panel (E2)', () => {
    const { walls, rooms } = gardenHouse()
    const fixtures = layoutElectrical(walls, rooms)
    const members = routeWiring(fixtures, walls)
    expect(unreachableDevices(members, fixtures)).toEqual([])
  })

  test('the per-story smoke alarm elects the largest INDOOR room — a bigger garden never outranks it', () => {
    const { walls, rooms, living } = gardenHouse()
    const fixtures = layoutElectrical(walls, rooms)
    const alarms = fixtures.filter((f) => f.kind === 'smoke-alarm')
    expect(alarms.length).toBe(1)
    expect(alarms[0]?.sourceId).toBe(living.id)
    expect(alarms.some((f) => inGarden(f))).toBe(false)
  })

  test('the 210.52(A) walk skips open-air faces: nothing interior-style mounts in the garden (WR + entrance light only)', () => {
    const { walls, rooms } = gardenHouse()
    const fixtures = layoutElectrical(walls, rooms)
    for (const f of fixtures.filter(inGarden)) {
      const legit =
        f.kind === 'receptacle-wr-gfci' ||
        (f.kind === 'light' && f.label?.startsWith('Exterior light') === true) ||
        f.kind === 'electric-meter' // exteriorFaceOf mounts it on the true outside
      expect(`${f.kind}:${f.label ?? ''}`).toSatisfy(() => legit)
    }
    // fences bound no habitable space: zero 210.52(A) receptacles, ever
    const fenceIds = new Set(['fence_n', 'fence_e', 'fence_w'])
    const onFences = fixtures.filter(
      (f) =>
        (f.kind === 'receptacle' || f.kind === 'receptacle-gfci') && fenceIds.has(f.sourceId),
    )
    expect(onFences).toEqual([])
  })

  test('face election is INDOOR-first: w_n receptacles mount on the living side, the meter on the garden side', () => {
    const { walls, rooms } = gardenHouse()
    const fixtures = layoutElectrical(walls, rooms)
    const onWn = fixtures.filter(
      (f) => (f.kind === 'receptacle' || f.kind === 'receptacle-gfci') && f.sourceId === 'w_n',
    )
    expect(onWn.length).toBeGreaterThan(0)
    for (const f of onWn) expect(f.position[2]).toBeGreaterThan(0) // living side
    const meter = fixtures.find((f) => f.kind === 'electric-meter')
    expect(meter).toBeDefined()
    // the garden IS the outside of w_n — the meter mounts there, not indoors
    expect((meter as Fixture).position[2]).toBeLessThan(0)
  })

  test('un-zoned interior + garden outside: the outdoor zone NAMES the outside — the meter never flips indoors', () => {
    // same shape, but nobody drew the living zone: no indoor face resolves
    // on w_n, so exteriorFaceOf's fallback must read the garden as the
    // outside (the legacy −normal guess pointed the meter INTO the house
    // on this orientation).
    const { walls, rooms } = gardenHouse()
    const gardenOnlyRooms = rooms.filter((r) => r.category === 'outdoor')
    const fixtures = layoutElectrical(walls, gardenOnlyRooms)
    const meter = fixtures.find((f) => f.kind === 'electric-meter')
    expect(meter).toBeDefined()
    expect((meter as Fixture).sourceId).toBe('w_n')
    expect((meter as Fixture).position[2]).toBeLessThan(0)
  })
})

describe('outdoor zones — garden-only level (the day-9 exhibit)', () => {
  function gardenOnly(withGate = false): { walls: WallSlice[]; rooms: RoomSlice[] } {
    const walls = [
      wall('fence_n', [0, -10], [12, -10], {
        thickness: 0.08,
        height: 1.8,
        openings: withGate ? [door(4, 1.0, 'gate_n')] : [],
      }),
      wall('fence_e', [12, -10], [12, 0], { thickness: 0.08, height: 1.8 }),
      wall('fence_w', [0, 0], [0, -10], { thickness: 0.08, height: 1.8 }),
    ]
    return { walls, rooms: [room('outdoor', GARDEN, { id: 'zone_garden', name: 'Back garden' })] }
  }

  test('no light, no smoke alarm, no interior receptacle/switch — honest warnings instead', () => {
    const { walls, rooms } = gardenOnly()
    const warnings: string[] = []
    const fixtures = layoutElectrical(walls, rooms, undefined, warnings)
    expect(fixtures.filter((f) => f.kind === 'light')).toEqual([])
    expect(fixtures.filter((f) => f.kind === 'smoke-alarm' || f.kind === 'co-alarm')).toEqual([])
    expect(
      fixtures.filter(
        (f) => f.kind === 'receptacle' || f.kind === 'receptacle-gfci' || f.kind === 'switch',
      ),
    ).toEqual([])
    expect(
      warnings.some(
        (w) => w.includes('all zones on this level are outdoor') && w.includes('R314.3(3)'),
      ),
    ).toBe(true)
    expect(
      warnings.some((w) => w.includes('Back garden') && w.includes('ceiling lighting not modeled')),
    ).toBe(true)
  })

  test('a garden GATE is not a dwelling entrance: no switch, no exterior light on the fence', () => {
    const { walls, rooms } = gardenOnly(true)
    const fixtures = layoutElectrical(walls, rooms)
    expect(fixtures.filter((f) => f.kind === 'switch')).toEqual([])
    expect(fixtures.filter((f) => f.kind === 'light')).toEqual([])
  })

  test('interior-TYPED fences (exterior=false — the extraction reality) mint nothing either (round-1 F2)', () => {
    // real fences classify interior-typed: both sides uncovered leaves
    // exposedSides=2 and the host fallback marks exactly-1 — the exhibit
    // minted 4 receptacles + a gate switch on the OUTER face at 15"
    const { walls, rooms } = gardenOnly(true)
    for (const w of walls) (w as { exterior: boolean }).exterior = false
    const fixtures = layoutElectrical(walls, rooms)
    expect(
      fixtures.filter(
        (f) => f.kind === 'receptacle' || f.kind === 'receptacle-gfci' || f.kind === 'switch',
      ),
    ).toEqual([])
    expect(fixtures.filter((f) => f.kind === 'light')).toEqual([])
  })
})

describe('outdoor zones — R314.3(2) proxy never elects open air', () => {
  test('a garden sharing MORE bedroom boundary than the living room loses the proxy election', () => {
    // bedroom 4×4; garden shares its whole 4 m north edge; living shares
    // only 2 m of the east edge — the old shared-length sort picked the
    // garden and hung the outside-sleeping-area alarm in the yard.
    const walls = [
      wall('w_a', [0, 0], [4, 0]),
      wall('w_b', [4, 0], [4, 4]),
      wall('w_c', [4, 4], [0, 4]),
      wall('w_d', [0, 4], [0, 0]),
    ]
    const bedroom = room(
      'bedroom',
      [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      { id: 'zone_bed', name: 'Bedroom' },
    )
    const garden = room(
      'outdoor',
      [
        [-2, -6],
        [6, -6],
        [6, 0],
        [-2, 0],
      ],
      { id: 'zone_garden', name: 'Garden' },
    )
    const living = room(
      'other',
      [
        [4, 0],
        [8, 0],
        [8, 2],
        [4, 2],
      ],
      { id: 'zone_living', name: 'Den' },
    )
    const fixtures = layoutElectrical(walls, [garden, bedroom, living])
    const outside = fixtures.find(
      (f) => f.kind === 'smoke-alarm' && f.label?.includes('outside sleeping area'),
    )
    expect(outside).toBeDefined()
    expect((outside as Fixture).sourceId).toBe('zone_living')
    expect((outside as Fixture).label).toContain('hallway proxy')
  })

  test('bedroom + garden ONLY: the proxy fails LOUDLY — never an alarm in the yard', () => {
    const walls = [wall('w_a', [0, 0], [4, 0])]
    const bedroom = room(
      'bedroom',
      [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      { id: 'zone_bed', name: 'Bedroom' },
    )
    const garden = room(
      'outdoor',
      [
        [0, -6],
        [4, -6],
        [4, 0],
        [0, 0],
      ],
      { id: 'zone_garden', name: 'Garden' },
    )
    const warnings: string[] = []
    const fixtures = layoutElectrical(walls, [garden, bedroom], undefined, warnings)
    const alarms = fixtures.filter((f) => f.kind === 'smoke-alarm')
    // the bedroom keeps its own R314.3 alarm; nothing mounts outdoors
    expect(alarms.length).toBe(1)
    expect(alarms[0]?.sourceId).toBe('zone_bed')
    expect(warnings.some((w) => w.includes('R314.3(2)') && w.includes('not placed'))).toBe(true)
  })
})

describe('outdoor zones — courtyard (interior walls) + census honesty', () => {
  /** 12×8 shell, partition at x=6: living west, OUTDOOR courtyard east. */
  function courtyardScene(): { walls: WallSlice[]; rooms: RoomSlice[] } {
    const walls = [
      wall('w_s', [0, 0], [12, 0]),
      wall('w_e', [12, 0], [12, 8]),
      wall('w_n', [12, 8], [0, 8]),
      wall('w_w', [0, 8], [0, 0]),
      wall('w_mid', [6, 0], [6, 8], { exterior: false, thickness: 0.114 }),
    ]
    const living = room(
      'other',
      [
        [0, 0],
        [6, 0],
        [6, 8],
        [0, 8],
      ],
      { id: 'zone_living', name: 'Living' },
    )
    const courtyard = room(
      'outdoor',
      [
        [6, 0],
        [12, 0],
        [12, 8],
        [6, 8],
      ],
      { id: 'zone_court', name: 'Courtyard' },
    )
    return { walls, rooms: [living, courtyard] }
  }

  test('an interior partition serves ONLY its indoor face — the courtyard face mints nothing', () => {
    const { walls, rooms } = courtyardScene()
    const warnings: string[] = []
    const fixtures = layoutElectrical(walls, rooms, undefined, warnings)
    const onMid = fixtures.filter(
      (f) => (f.kind === 'receptacle' || f.kind === 'receptacle-gfci') && f.sourceId === 'w_mid',
    )
    expect(onMid.length).toBeGreaterThan(0)
    for (const f of onMid) {
      expect(f.position[0]).toBeLessThan(6) // living side of the partition
      expect(String(f.meta?.deviceId)).toMatch(/-p$/)
    }
    // door-less courtyard: the honest lighting warning fires
    expect(
      warnings.some((w) => w.includes('Courtyard') && w.includes('ceiling lighting not modeled')),
    ).toBe(true)
  })

  test('210.52(A) census: a moved receptacle never trips a spacing warning for the OPEN-AIR face', () => {
    const { walls, rooms } = courtyardScene()
    const fixtures = layoutElectrical(walls, rooms)
    const target = fixtures.find(
      (f) => f.kind === 'receptacle' && f.sourceId === 'w_mid' && f.meta?.deviceId,
    ) as Fixture
    expect(target).toBeDefined()
    // a SMALL slide (u 1.33 → 1.6) that keeps the living face's own
    // 6ft/12ft contract intact — any warning left is the open-air face's
    const overrides: DeviceOverrides = new Map([
      [String(target.meta?.deviceId), { wallId: 'w_mid', wallT: 0.2 }],
    ])
    const applied = applyDeviceOverrides(fixtures, walls, rooms, [], overrides)
    // the living face stays walked; the courtyard face is open air — its
    // permanent zero receptacles are BY DESIGN, not a >12ft gap
    expect(applied.warnings.filter((w) => w.includes('spacing exceeds'))).toEqual([])
  })

  test('a courtyard polygon double-claiming an indoor slice never mints a phantom entrance light (round-1 F1)', () => {
    // living/dining partition with an interior door; the 'Courtyard'
    // outdoor polygon double-claims the WHOLE dining slice. The outdoor-
    // first zone lookup composed 'Exterior light — Courtyard entrance'
    // INSIDE the dining room AND litZones swallowed the courtyard's
    // honest warning — indoor-first must win, like isOpenAirFace.
    const walls = [
      wall('w_s', [0, 0], [12, 0]),
      wall('w_e', [12, 0], [12, 8]),
      wall('w_n', [12, 8], [0, 8]),
      wall('w_w', [0, 8], [0, 0]),
      wall('w_mid', [6, 0], [6, 8], {
        exterior: false,
        thickness: 0.114,
        openings: [door(4, 0.9, 'door_mid')],
      }),
    ]
    const living = room(
      'other',
      [
        [0, 0],
        [6, 0],
        [6, 8],
        [0, 8],
      ],
      { id: 'zone_living', name: 'Living' },
    )
    const dining = room(
      'other',
      [
        [6, 0],
        [12, 0],
        [12, 8],
        [6, 8],
      ],
      { id: 'zone_dining', name: 'Dining' },
    )
    const courtyard = room(
      'outdoor',
      [
        [6, 0],
        [12, 0],
        [12, 8],
        [6, 8],
      ],
      { id: 'zone_court', name: 'Courtyard' },
    )
    const warnings: string[] = []
    const fixtures = layoutElectrical(walls, [living, dining, courtyard], undefined, warnings)
    // no phantom: the door's outdoor-face point stands in the DINING room
    expect(
      fixtures.filter((f) => f.kind === 'light' && f.label?.startsWith('Exterior light')),
    ).toEqual([])
    // …and the courtyard's honesty warning is NOT swallowed by litZones
    expect(
      warnings.some((w) => w.includes('Courtyard') && w.includes('ceiling lighting not modeled')),
    ).toBe(true)
    // the double-claimed partition still serves BOTH indoor rooms
    // (overlap conservatism — indoor-first, both faces walked)
    const onMid = fixtures.filter(
      (f) => (f.kind === 'receptacle' || f.kind === 'receptacle-gfci') && f.sourceId === 'w_mid',
    )
    expect(onMid.some((f) => String(f.meta?.deviceId).endsWith('-p'))).toBe(true)
    expect(onMid.some((f) => String(f.meta?.deviceId).endsWith('-m'))).toBe(true)
  })

  test('overlap resolves indoor-first: a zone seam over the wall keeps BOTH faces serving the room', () => {
    // one indoor room spanning both faces + an outdoor polygon grazing the
    // minus face midpoint — conservative: the receptacles stay
    const walls = [
      wall('w_i', [0, 0], [6, 0], { exterior: false, thickness: 0.114 }),
    ]
    const indoor = room(
      'other',
      [
        [-1, -1],
        [7, -1],
        [7, 3],
        [-1, 3],
      ],
      { id: 'zone_liv', name: 'Living' },
    )
    const outdoor = room(
      'outdoor',
      [
        [-1, -1],
        [7, -1],
        [7, 0],
        [-1, 0],
      ],
      { id: 'zone_out', name: 'Patio strip' },
    )
    const fixtures = layoutElectrical(walls, [indoor, outdoor])
    const ids = fixtures
      .filter((f) => f.kind === 'receptacle' || f.kind === 'receptacle-gfci')
      .map((f) => String(f.meta?.deviceId))
    expect(ids.some((id) => id.endsWith('-p'))).toBe(true)
    expect(ids.some((id) => id.endsWith('-m'))).toBe(true)
  })
})
