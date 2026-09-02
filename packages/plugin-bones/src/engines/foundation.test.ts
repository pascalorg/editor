import { describe, expect, test } from 'bun:test'
import { Euler, Vector3 } from 'three'
import { DEFAULT_SPEC, type FramingSpec } from '../core/spec'
import type { Member, WallSlice } from '../core/types'
import { inches } from '../core/units'
import { computeLevel } from '../framing/compute'
import { FramingNode } from '../framing/schema'
import { applyJurisdiction, profileFor } from '../jurisdiction/profiles'
import { cmuDowelPositions } from './cmu'
import {
  DOWEL_SHORT_LAP_FLAG,
  SHORT_PLATE_SECTION_FLAG,
  UNFOOTED_POST_FLAG,
  anchorBoltPositions,
  buildFoundation,
  cornerExtensions,
} from './foundation'
import { computeTakeoff } from './takeoff'

const FOOTING_HEIGHT = inches(8)

function makeWall(overrides: Partial<WallSlice> = {}): WallSlice {
  const start = overrides.start ?? [0, 0]
  const end = overrides.end ?? [4, 0]
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  return {
    id: 'wall_test',
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

const slab = {
  id: 'slab_test',
  polygon: [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ],
  holes: [],
  elevation: 0.05,
  thickness: 0.1,
} as const

const byRole = (members: Member[], role: string): Member[] =>
  members.filter((m) => m.role === role)

describe('anchorBoltPositions — R403.1.6 layout', () => {
  const spacing = DEFAULT_SPEC.anchorBoltSpacing // 6' = 1.8288 m
  const endDist = DEFAULT_SPEC.anchorBoltEndDistance // 12" = 0.3048 m

  test("6m wall → 4 bolts: ends at 12', interior gaps even and ≤ 6' o.c.", () => {
    const bolts = anchorBoltPositions(6, spacing, endDist)
    expect(bolts).toHaveLength(4)
    // first/last within (here exactly at) the 12" end distance
    expect(bolts[0]).toBeCloseTo(endDist, 6)
    expect(bolts[bolts.length - 1]).toBeCloseTo(6 - endDist, 6)
    // no gap may exceed the max o.c. spacing
    for (let i = 1; i < bolts.length; i++) {
      expect((bolts[i] ?? 0) - (bolts[i - 1] ?? 0)).toBeLessThanOrEqual(spacing + 1e-9)
    }
    // even layout: interior gap = span / 3
    expect((bolts[1] ?? 0) - (bolts[0] ?? 0)).toBeCloseTo((6 - 2 * endDist) / 3, 6)
  })

  test('minimum TWO bolts even on a wall shorter than one spacing', () => {
    const bolts = anchorBoltPositions(1, spacing, endDist)
    expect(bolts).toHaveLength(2)
    expect(bolts[0]).toBeCloseTo(endDist, 6)
    expect(bolts[1]).toBeCloseTo(1 - endDist, 6)
  })

  test('very short wall pulls the two bolts to the third points', () => {
    const bolts = anchorBoltPositions(0.5, spacing, endDist)
    expect(bolts).toHaveLength(2)
    expect(bolts[0]).toBeCloseTo(0.5 / 3, 6)
    expect(bolts[1]).toBeCloseTo(0.5 * (2 / 3), 6) // second third point
    // both still within the code end distance of an end
    expect(bolts[0] ?? 0).toBeLessThanOrEqual(endDist)
    expect(0.5 - (bolts[1] ?? 0)).toBeLessThanOrEqual(endDist)
  })
})

describe('buildFoundation — exterior wall, default spec', () => {
  const wall = makeWall() // 4m along +X
  const members = buildFoundation([wall], [])

  test('every member is foundation-system and tied to the wall', () => {
    expect(members.length).toBeGreaterThan(0)
    for (const m of members) {
      expect(m.system).toBe('foundation')
      expect(m.sourceId).toBe('wall_test')
      expect(m.rotation[1] ?? 0).toBeCloseTo(0, 6) // wall along +X → yaw 0
    }
  })

  test('one continuous footing: spec width × 8" high, bottom at -footingDepth', () => {
    const footings = byRole(members, 'footing')
    expect(footings).toHaveLength(1)
    const f = footings[0] as Member
    expect(f.material).toBe('concrete')
    expect(f.dims[0]).toBeCloseTo(4, 6) // runs the wall length
    expect(f.dims[1]).toBeCloseTo(FOOTING_HEIGHT, 6)
    expect(f.dims[2]).toBeCloseTo(DEFAULT_SPEC.footingWidth, 6)
    // centered under the wall in plan
    expect(f.position[0] ?? 0).toBeCloseTo(2, 6)
    expect(f.position[2] ?? 0).toBeCloseTo(0, 6)
    // R403.1.4.1: bearing bottom at frost depth
    const bottom = (f.position[1] ?? 0) - f.dims[1] / 2
    expect(bottom).toBeCloseTo(-DEFAULT_SPEC.footingDepth, 6)
    expect(f.length).toBeCloseTo(4, 6)
  })

  test('stemwall spans footing top → y = 0 at spec thickness', () => {
    const stems = byRole(members, 'stemwall')
    expect(stems).toHaveLength(1)
    const s = stems[0] as Member
    expect(s.material).toBe('concrete')
    expect(s.dims[2]).toBeCloseTo(DEFAULT_SPEC.stemwallThickness, 6)
    const bottom = (s.position[1] ?? 0) - s.dims[1] / 2
    const top = (s.position[1] ?? 0) + s.dims[1] / 2
    expect(bottom).toBeCloseTo(-DEFAULT_SPEC.footingDepth + FOOTING_HEIGHT, 6)
    expect(top).toBeCloseTo(0, 6)
  })

  test('anchor bolts are 5/8" square × 10" steel piercing the plate line', () => {
    const bolts = byRole(members, 'anchor-bolt')
    expect(bolts.length).toBeGreaterThanOrEqual(2)
    for (const b of bolts) {
      expect(b.material).toBe('steel')
      expect(b.dims[0]).toBeCloseTo(inches(5 / 8), 6)
      expect(b.dims[2]).toBeCloseTo(inches(5 / 8), 6)
      expect(b.dims[1]).toBeCloseTo(inches(10), 6)
      const bottom = (b.position[1] ?? 0) - b.dims[1] / 2
      const top = (b.position[1] ?? 0) + b.dims[1] / 2
      expect(bottom).toBeCloseTo(-inches(7), 6) // 7" embedment per R403.1.6
      expect(top).toBeGreaterThan(0) // sticks up through the plate
    }
  })

  test('no hold-downs and no slab field without seismic spec / slabs', () => {
    expect(byRole(members, 'hold-down')).toHaveLength(0)
    expect(byRole(members, 'slab')).toHaveLength(0)
    expect(byRole(members, 'vapor-retarder')).toHaveLength(0)
  })
})

describe('buildFoundation — anchor bolt layout on a 6m wall', () => {
  const wall = makeWall({ end: [6, 0] })
  const bolts = byRole(buildFoundation([wall], []), 'anchor-bolt')

  test('4 bolts, first/last within 12" of the wall ends, gaps ≤ 6\' o.c.', () => {
    expect(bolts).toHaveLength(4)
    const us = bolts.map((b) => b.position[0] ?? 0).sort((a, b) => a - b)
    expect(us[0] ?? 0).toBeLessThanOrEqual(DEFAULT_SPEC.anchorBoltEndDistance + 1e-9)
    expect(6 - (us[us.length - 1] ?? 0)).toBeLessThanOrEqual(
      DEFAULT_SPEC.anchorBoltEndDistance + 1e-9,
    )
    for (let i = 1; i < us.length; i++) {
      expect((us[i] ?? 0) - (us[i - 1] ?? 0)).toBeLessThanOrEqual(
        DEFAULT_SPEC.anchorBoltSpacing + 1e-9,
      )
    }
  })
})

// ---------------------------------------------------------------------------
// LOD-400 B18a — anchor bolts vs door ROs (R403.1.6 per plate SECTION)
// ---------------------------------------------------------------------------

describe('buildFoundation — anchor bolts split at door ROs (B18a)', () => {
  const spacing = DEFAULT_SPEC.anchorBoltSpacing
  const endDist = DEFAULT_SPEC.anchorBoltEndDistance
  // 9 m garage wall with a 16-ft door: RO ≈ [2.0615, 6.9385]
  const garageDoor = {
    id: 'gd',
    kind: 'door' as const,
    u: 4.5,
    width: 4.839,
    roughWidth: 4.877,
    height: 2.1,
    roughHeight: 2.15,
    sillHeight: 0,
  }
  const wall = makeWall({ id: 'w_garage', end: [9, 0], openings: [garageDoor] })
  const bolts = byRole(buildFoundation([wall], []), 'anchor-bolt')
  const us = bolts.map((b) => b.position[0] ?? 0).sort((a, b) => a - b)
  const roLo = garageDoor.u - garageDoor.roughWidth / 2
  const roHi = garageDoor.u + garageDoor.roughWidth / 2

  test('ZERO bolts inside the door RO — a J-bolt in a doorway anchors nothing', () => {
    expect(bolts.length).toBeGreaterThan(0)
    for (const u of us) {
      expect(u <= roLo + 1e-9 || u >= roHi - 1e-9).toBe(true)
    }
  })

  test('each plate SECTION keeps its own R403.1.6 layout: ≥2 bolts, jamb end bolts, gaps ≤ spacing', () => {
    const sections: [number, number][] = [
      [0, roLo],
      [roHi, 9],
    ]
    for (const [a, b] of sections) {
      const inSection = us.filter((u) => u >= a - 1e-9 && u <= b + 1e-9)
      expect(inSection.length).toBeGreaterThanOrEqual(2)
      // one bolt within 12" of EACH section end — including the door jambs
      expect((inSection[0] ?? 0) - a).toBeLessThanOrEqual(endDist + 1e-9)
      expect(b - (inSection[inSection.length - 1] ?? 0)).toBeLessThanOrEqual(endDist + 1e-9)
      for (let i = 1; i < inSection.length; i++) {
        expect((inSection[i] ?? 0) - (inSection[i - 1] ?? 0)).toBeLessThanOrEqual(spacing + 1e-9)
      }
    }
  })

  test('windows never split the plate — sill above the plate band, layout byte-equal', () => {
    const win = {
      id: 'win',
      kind: 'window' as const,
      u: 4.5,
      width: 1.2,
      roughWidth: 1.25,
      height: 1.2,
      roughHeight: 1.25,
      sillHeight: 0.9,
    }
    const withWindow = byRole(buildFoundation([makeWall({ id: 'w_garage', end: [9, 0], openings: [win] })], []), 'anchor-bolt')
    const plain = byRole(buildFoundation([makeWall({ id: 'w_garage', end: [9, 0] })], []), 'anchor-bolt')
    expect(JSON.stringify(withWindow)).toBe(JSON.stringify(plain))
  })

  test('plate washers follow the SECTION bolts one-for-one (seismic LOD 400)', () => {
    const fabSeismic: FramingSpec = { ...DEFAULT_SPEC, detail: '400', seismicHoldDowns: true }
    const members = buildFoundation([wall], [], fabSeismic)
    const sBolts = byRole(members, 'anchor-bolt')
    const washers = byRole(members, 'plate-washer')
    expect(washers).toHaveLength(sBolts.length)
    for (const w of washers) {
      const u = w.position[0] ?? 0
      expect(u <= roLo + 1e-9 || u >= roHi - 1e-9).toBe(true)
    }
  })

  test('SLIVER sections never crowd steel: 150mm corner sliver → ZERO bolts + strap flag (skeptic F2)', () => {
    // Door RO ending 150 mm from the corner — the old ≥2-bolt rule put two
    // bolts 50 mm apart there (3" washers inside each other and inside the
    // corner HDU). 150 mm can't hold even ONE bolt at the 7d_b edge
    // distance (4-3/8" each side) → zero bolts, footing flagged.
    const sliverDoor = { ...garageDoor, u: 0.15 + garageDoor.roughWidth / 2 }
    const fabSeismic: FramingSpec = { ...DEFAULT_SPEC, detail: '400', seismicHoldDowns: true }
    const members = buildFoundation(
      [makeWall({ id: 'w_garage', end: [9, 0], openings: [sliverDoor] })],
      [],
      fabSeismic,
    )
    const sliverBolts = byRole(members, 'anchor-bolt').filter((b) => (b.position[0] ?? 0) < 0.15)
    expect(sliverBolts).toHaveLength(0)
    const footing = byRole(members, 'footing')[0] as Member
    expect(footing.flag).toBe(SHORT_PLATE_SECTION_FLAG)
    // washers exactly mirror the surviving bolts — none stranded in the sliver
    expect(byRole(members, 'plate-washer')).toHaveLength(byRole(members, 'anchor-bolt').length)
    // the normal section keeps its full R403.1.6 layout (jamb rule intact)
    const normal = byRole(members, 'anchor-bolt').map((b) => b.position[0] ?? 0)
    const jamb = sliverDoor.u + sliverDoor.roughWidth / 2
    expect(Math.min(...normal) - jamb).toBeLessThanOrEqual(endDist + 1e-9)
  })

  test('two doors leaving a 200mm middle: zero bolts between the jambs + flag; outer sections intact (skeptic F2)', () => {
    const doorAt = (u: number) => ({ ...garageDoor, id: `d${u}`, u, roughWidth: 2 })
    const members = buildFoundation(
      [makeWall({ id: 'w_two', end: [9, 0], openings: [doorAt(2), doorAt(4.2)] })],
      [],
    )
    const us = byRole(members, 'anchor-bolt')
      .map((b) => b.position[0] ?? 0)
      .sort((a, b) => a - b)
    // middle section [3, 3.2] holds nothing
    expect(us.filter((u) => u > 3 - 1e-9 && u < 3.2 + 1e-9)).toHaveLength(0)
    expect((byRole(members, 'footing')[0] as Member).flag).toBe(SHORT_PLATE_SECTION_FLAG)
    // outer sections keep the per-section rule: ≥2 bolts, ends within 12"
    for (const [a, b] of [
      [0, 1],
      [5.2, 9],
    ] as [number, number][]) {
      const inSection = us.filter((u) => u >= a - 1e-9 && u <= b + 1e-9)
      expect(inSection.length).toBeGreaterThanOrEqual(2)
      expect((inSection[0] ?? 0) - a).toBeLessThanOrEqual(endDist + 1e-9)
      expect(b - (inSection[inSection.length - 1] ?? 0)).toBeLessThanOrEqual(endDist + 1e-9)
    }
  })

  test('a section that holds exactly ONE legal bolt gets one, centered, edges ≥ 7d_b + flag (skeptic F2)', () => {
    // RO starting 300 mm from the corner: too short for two bolts at the
    // 7d_b edge distance + washer gap, long enough for one.
    const door300 = { ...garageDoor, u: 0.3 + garageDoor.roughWidth / 2 }
    const members = buildFoundation(
      [makeWall({ id: 'w_one', end: [9, 0], openings: [door300] })],
      [],
    )
    const sectionBolts = byRole(members, 'anchor-bolt').filter(
      (b) => (b.position[0] ?? 0) < 0.3,
    )
    expect(sectionBolts).toHaveLength(1)
    const u = sectionBolts[0]?.position[0] ?? 0
    expect(u).toBeCloseTo(0.15, 6) // centered
    expect(u).toBeGreaterThanOrEqual(7 * inches(5 / 8) - 1e-9) // 7 diameters clear
    expect(0.3 - u).toBeGreaterThanOrEqual(7 * inches(5 / 8) - 1e-9)
    expect((byRole(members, 'footing')[0] as Member).flag).toBe(SHORT_PLATE_SECTION_FLAG)
  })

  test('normal walls carry NO short-section flag (non-vacuous inverse)', () => {
    const members = buildFoundation([makeWall({ id: 'w_plain', end: [9, 0] })], [])
    expect((byRole(members, 'footing')[0] as Member).flag).toBeUndefined()
  })

  test('stemwall verticals still nudge clear of the SECTION bolt layout', () => {
    const members = buildFoundation([wall], [])
    const boltPos = byRole(members, 'anchor-bolt').map((b) => b.position[0] ?? 0)
    const verts = members.filter((m) => m.label === '#4 stemwall vertical')
    expect(verts.length).toBeGreaterThan(0)
    for (const v of verts) {
      for (const b of boltPos) {
        expect(Math.abs((v.position[0] ?? 0) - b)).toBeGreaterThanOrEqual(inches(3) - 1e-9)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// LOD-400 B18b — the CMU foundation interface (no sole-plate kit, dowels lap)
// ---------------------------------------------------------------------------

describe('buildFoundation — CMU walls swap the bolt kit for lapping dowels (B18b)', () => {
  const fabSeismic: FramingSpec = { ...DEFAULT_SPEC, detail: '400', seismicHoldDowns: true }
  const wall = makeWall({ thickness: 0.2032 })
  const layout = cmuDowelPositions(wall)
  const cmuOpts = { cmu: new Map([[wall.id, layout]]) }
  const members = buildFoundation([wall], [], fabSeismic, cmuOpts)

  test('NO sole-plate hardware: zero anchor bolts, washers and hold-downs on the CMU wall', () => {
    // Pre-B18b every 'sole plate anchorage' J-bolt on a CMU wall stuck 3"
    // up into a block cell where no plate exists.
    expect(byRole(members, 'anchor-bolt')).toHaveLength(0)
    expect(byRole(members, 'plate-washer')).toHaveLength(0)
    expect(byRole(members, 'hold-down')).toHaveLength(0)
  })

  test('dowels rise beside every wall vertical: footing mat → 48d_b past the top', () => {
    const dowels = members.filter((m) => m.label?.startsWith('#5 dowel'))
    expect(dowels.length).toBe(layout.us.length)
    expect(dowels.length).toBeGreaterThan(0)
    for (const d of dowels) {
      expect(d.material).toBe('steel')
      expect(d.role).toBe('rebar')
      expect(d.dims[0]).toBeCloseTo(inches(0.625), 6) // #5, matching the wall bar
      const bottom = (d.position[1] ?? 0) - d.dims[1] / 2
      const top = (d.position[1] ?? 0) + d.dims[1] / 2
      expect(bottom).toBeCloseTo(-DEFAULT_SPEC.footingDepth + inches(3), 6) // hooked in the mat
      expect(top).toBeCloseTo(inches(30), 6) // 48·(5/8") lap above the foundation top
      // the wall vertical stands at y ∈ [0, …] in the same cell → the two
      // bars overlap ≥ 24" — a code lap, not a miss
      expect(top).toBeGreaterThanOrEqual(inches(24))
      // BESIDE the vertical: 1" across-wall offset (wall runs +X → world z)
      expect(d.position[2] ?? 0).toBeCloseTo(inches(1), 6)
    }
    // one dowel per wall-vertical cell, at the exact cell positions
    const us = dowels.map((d) => d.position[0] ?? 0).sort((a, b) => a - b)
    expect(us.map((u) => Number(u.toFixed(6)))).toEqual(
      layout.us.map((u) => Number(u.toFixed(6))),
    )
  })

  test('the generic stemwall-vertical grid stays off CMU walls (dowels ARE the verticals)', () => {
    expect(members.filter((m) => m.label === '#4 stemwall vertical')).toHaveLength(0)
  })

  test('the seismic top-of-stemwall bar (B18c) still rides a CMU stemwall', () => {
    expect(
      members.filter((m) => m.label === '#4 horizontal — top of stemwall (R403.1.3.1)'),
    ).toHaveLength(1)
  })

  test('framed walls in the same set keep the full bolt kit (per-wall interface)', () => {
    const framed = makeWall({ id: 'w_framed', start: [0, 4], end: [4, 4] })
    const both = buildFoundation([wall, framed], [], fabSeismic, cmuOpts)
    const bolts = byRole(both, 'anchor-bolt')
    expect(bolts.length).toBeGreaterThanOrEqual(2)
    for (const b of bolts) expect(b.sourceId).toBe('w_framed')
    expect(byRole(both, 'hold-down').every((m) => m.sourceId === 'w_framed')).toBe(true)
  })

  test('interior CMU bearing wall: dowels rise from its thickened footing', () => {
    const interior = makeWall({ id: 'w_int', exterior: false, start: [0, 2], end: [4, 2] })
    const intLayout = cmuDowelPositions(interior)
    const intMembers = buildFoundation([interior], [slab], DEFAULT_SPEC, {
      cmu: new Map([[interior.id, intLayout]]),
    })
    const dowels = intMembers.filter((m) => m.label?.startsWith('#5 dowel'))
    expect(dowels.length).toBe(intLayout.us.length)
    expect(dowels.length).toBeGreaterThan(0)
    for (const d of dowels) {
      const bottom = (d.position[1] ?? 0) - d.dims[1] / 2
      expect(bottom).toBeCloseTo(-inches(12) + inches(3), 6) // the 12" thickened footing's mat
    }
  })

  test('shallow spec (no stemwall): dowels still rise from the footing into the cells', () => {
    const shallow: FramingSpec = { ...DEFAULT_SPEC, footingDepth: inches(8) }
    const m = buildFoundation([wall], [], shallow, cmuOpts)
    const dowels = m.filter((d) => d.label?.startsWith('#5 dowel'))
    expect(dowels.length).toBe(layout.us.length)
  })
})

describe('computeLevel — CMU scene anchor truth end-to-end (B18b)', () => {
  // FL defaults every exterior wall to CMU; one wall is a mixed knee wall so
  // the SEAM-SILL bolts (the bond-beam story, cmu.ts) still exist.
  const scene: Record<string, Record<string, unknown>> = {
    level_1: { id: 'level_1', type: 'level', level: 0, height: 2.5 },
    slab_1: {
      id: 'slab_1',
      type: 'slab',
      parentId: 'level_1',
      polygon: [
        [0, 0],
        [6, 0],
        [6, 4],
        [0, 4],
      ],
      holes: [],
    },
    ...Object.fromEntries(
      (
        [
          ['w_s', [0, 0], [6, 0]],
          ['w_e', [6, 0], [6, 4]],
          ['w_n', [6, 4], [0, 4]],
          ['w_w', [0, 4], [0, 0]],
        ] as [string, [number, number], [number, number]][]
      ).map(([id, start, end]) => [
        id,
        {
          id,
          type: 'wall',
          parentId: 'level_1',
          start,
          end,
          thickness: 0.2032,
          height: 2.5,
          frontSide: 'exterior',
          children: [],
        },
      ]),
    ),
  }
  const config = FramingNode.parse({
    id: 'bonesframing_cmu',
    parentId: 'level_1',
    jurisdiction: 'FL',
    detail: '400',
    showWalls: true,
    showFoundation: true,
    showFloor: false,
    showRoof: false,
    showElectrical: false,
    showPlumbing: false,
    showHvac: false,
    wallOverrides: { w_w: { construction: 'cmu', cmuHeightM: 1.0 } },
  })
  const result = computeLevel(scene, config)

  test('the FOUNDATION books zero anchor bolts under CMU walls; the only bolts are the mixed seam sill’s', () => {
    const bolts = result.members.filter((m) => m.role === 'anchor-bolt')
    expect(bolts.length).toBeGreaterThan(0) // the seam sill is anchored
    for (const b of bolts) {
      expect(b.system).toBe('wall-framing')
      expect(b.label).toContain('sill to bond beam')
      expect(b.sourceId).toBe('w_w')
    }
    expect(result.members.filter((m) => m.system === 'foundation' && m.role === 'anchor-bolt')).toHaveLength(0)
  })

  test('foundation dowels exist for every CMU wall and lap the wall verticals in plan', () => {
    const dowels = result.members.filter(
      (m) => m.system === 'foundation' && m.label?.startsWith('#5 dowel'),
    )
    expect(new Set(dowels.map((d) => d.sourceId))).toEqual(new Set(['w_s', 'w_e', 'w_n', 'w_w']))
    const verticals = result.members.filter((m) => m.label?.startsWith('#5 vertical'))
    expect(verticals.length).toBeGreaterThan(0)
    // every emitted wall vertical has a dowel within one bar-plus-gap in plan
    for (const v of verticals) {
      const near = dowels.some(
        (d) =>
          d.sourceId === v.sourceId &&
          Math.hypot((d.position[0] ?? 0) - (v.position[0] ?? 0), (d.position[2] ?? 0) - (v.position[2] ?? 0)) <
            inches(1) + 1e-6,
      )
      expect(near).toBe(true)
    }
  })

  test('takeoff: no ‘sole plate anchorage’ row on a CMU scene — the bolts row is the seam sill’s; dowels join the foundation rebar lf', () => {
    const rows = computeTakeoff(result.members, result.fixtures, result.areas)
    const boltRows = rows.filter((r) => r.item === 'Anchor bolts')
    expect(boltRows).toHaveLength(1)
    expect(boltRows[0]?.section).toBe('Wall framing')
    expect(boltRows[0]?.detail).toBe('seam sill to bond beam (R403.1.6)')
    const foundationRebar = rows.find((r) => r.item === 'Rebar' && r.section === 'Foundation')
    expect(foundationRebar).toBeDefined()
    // the dowels are real lf on that row: strip them and the row shrinks
    const withoutDowels = computeTakeoff(
      result.members.filter((m) => !m.label?.startsWith('#5 dowel')),
      result.fixtures,
      result.areas,
    ).find((r) => r.item === 'Rebar' && r.section === 'Foundation')
    expect((withoutDowels?.quantity as number) < (foundationRebar?.quantity as number)).toBe(true)
  })

  test('KNEE wall through compute: dowels cap at the seam story, flagged + true-lap labeled (skeptic F1)', () => {
    // The verbatim repro: cmuHeightM 0.61 → 3 courses (seam 0.6096), zone
    // bar top 0.508 m. Fixed 30" dowels punched through the PT seam sill
    // and framed zone (13 SAT pairs). Compute must plumb barTop through.
    const kneeConfig = FramingNode.parse({
      ...config,
      id: 'bonesframing_cmuknee',
      wallOverrides: { w_w: { construction: 'cmu', cmuHeightM: 0.61 } },
    })
    const knee = computeLevel(scene, kneeConfig)
    const kneeDowels = knee.members.filter(
      (m) => m.sourceId === 'w_w' && m.label?.startsWith('#5 dowel'),
    )
    expect(kneeDowels.length).toBeGreaterThan(0)
    for (const d of kneeDowels) {
      expect((d.position[1] ?? 0) + d.dims[1] / 2).toBeCloseTo(3 * 0.2032 - 0.1016, 6)
      expect(d.label).toContain('laps CMU wall vertical 20"')
      expect(d.flag).toBe(DOWEL_SHORT_LAP_FLAG)
    }
    // the PT seam sill sits ABOVE every dowel top — numerically clear
    const sill = knee.members.find((m) => m.sourceId === 'w_w' && m.role === 'mudsill')
    expect(sill).toBeDefined()
    const sillBottom = (sill?.position[1] ?? 0) - (sill?.dims[1] ?? 0) / 2
    for (const d of kneeDowels) {
      expect((d.position[1] ?? 0) + d.dims[1] / 2).toBeLessThanOrEqual(sillBottom + 1e-9)
    }
    // FULL-height CMU walls in the same scene keep the unflagged 48d_b lap
    const fullDowels = knee.members.filter(
      (m) => m.sourceId === 'w_s' && m.label?.startsWith('#5 dowel'),
    )
    expect(fullDowels.length).toBeGreaterThan(0)
    for (const d of fullDowels) {
      expect((d.position[1] ?? 0) + d.dims[1] / 2).toBeCloseTo(inches(30), 6)
      expect(d.flag).toBeUndefined()
      expect(d.label).toBe('#5 dowel — laps CMU wall vertical (R606.12)')
    }
  })
})

// ---------------------------------------------------------------------------
// LOD-400 B18c — R403.1.3.1 top-of-stemwall horizontal bar (SDC D)
// ---------------------------------------------------------------------------

describe('buildFoundation — SDC-D top-of-stemwall bar (B18c, R403.1.3.1)', () => {
  const TOP_BAR = '#4 horizontal — top of stemwall (R403.1.3.1)'

  test('seismic spec: one #4 bar within 12" of the stemwall top, full interlocked run', () => {
    // AK-flavored frost depth: 42" → 34" stemwall. Pre-B18c the nearest
    // horizontal steel sat at the footing mat, 38.8" below the top.
    const seismicFrost: FramingSpec = {
      ...DEFAULT_SPEC,
      seismicHoldDowns: true,
      footingDepth: inches(42),
    }
    const members = buildFoundation([makeWall()], [], seismicFrost)
    const bars = members.filter((m) => m.label === TOP_BAR)
    expect(bars).toHaveLength(1)
    const bar = bars[0] as Member
    expect(bar.material).toBe('steel')
    expect(bar.role).toBe('rebar')
    // within 12" of the top of the wall (stemwall top = y 0)
    expect(Math.abs(bar.position[1] ?? 0)).toBeLessThanOrEqual(inches(12))
    // horizontal: runs the stemwall's extent
    expect(bar.dims[0]).toBeCloseTo(4, 6)
    expect(bar.dims[1]).toBeCloseTo(inches(0.5), 6)
    // sits INSIDE the stemwall band, just under the vertical bar tops
    expect((bar.position[1] ?? 0) + bar.dims[1] / 2).toBeCloseTo(-inches(2), 6)
    // the bottom bar mandate is already covered by the footing mat at 3" up
    expect(
      members.some(
        (m) =>
          m.label === '#4 continuous footing bar' &&
          (m.position[1] ?? 0) - m.dims[1] / 2 - -inches(42) < inches(4),
      ),
    ).toBe(true)
  })

  test('non-seismic spec (INTL) emits NO top bar — byte-equal stays byte-equal', () => {
    const members = buildFoundation([makeWall()], [])
    expect(members.filter((m) => m.label === TOP_BAR)).toHaveLength(0)
  })

  test('shallow spec without a stemwall carries no top bar even under seismic', () => {
    const seismicShallow: FramingSpec = {
      ...DEFAULT_SPEC,
      seismicHoldDowns: true,
      footingDepth: inches(8),
    }
    const members = buildFoundation([makeWall()], [], seismicShallow)
    expect(members.filter((m) => m.label === TOP_BAR)).toHaveLength(0)
  })

  test('the AK/CA profiles trigger the bar; INTL does not (jurisdiction-driven)', () => {
    for (const code of ['AK', 'CA'] as const) {
      const spec = applyJurisdiction({ ...DEFAULT_SPEC }, profileFor(code))
      const bars = buildFoundation([makeWall()], [], spec).filter((m) => m.label === TOP_BAR)
      expect({ code, bars: bars.length }).toEqual({ code, bars: 1 })
    }
    const intl = applyJurisdiction({ ...DEFAULT_SPEC }, profileFor('INTL'))
    expect(buildFoundation([makeWall()], [], intl).filter((m) => m.label === TOP_BAR)).toHaveLength(0)
  })
})

describe('buildFoundation — seismic hold-downs', () => {
  const seismic: FramingSpec = { ...DEFAULT_SPEC, seismicHoldDowns: true }
  const wall = makeWall()
  const holdDowns = byRole(buildFoundation([wall], [], seismic), 'hold-down')

  test('one HDU at each end, just inside the corner, bearing on y = 0', () => {
    expect(holdDowns).toHaveLength(2)
    const us = holdDowns.map((h) => h.position[0] ?? 0).sort((a, b) => a - b)
    const inset = inches(1.5) + inches(3) / 2 // past the end stud, half body
    expect(us[0]).toBeCloseTo(inset, 6)
    expect(us[1]).toBeCloseTo(4 - inset, 6)
    for (const h of holdDowns) {
      expect(h.material).toBe('steel')
      expect(h.label).toBe('HDU hold-down')
      expect(h.dims[0]).toBeCloseTo(inches(3), 6)
      expect(h.dims[1]).toBeCloseTo(inches(12), 6)
      expect(h.dims[2]).toBeCloseTo(inches(3), 6)
      // body base sits at the plate line
      expect((h.position[1] ?? 0) - h.dims[1] / 2).toBeCloseTo(0, 6)
    }
  })
})

describe('buildFoundation — slab-on-grade perimeter detail', () => {
  const wall = makeWall()

  test('NO thickened edge where a footing + stemwall already run (round-10)', () => {
    // The slab pours AGAINST the stemwall (R403.1); a turned-down
    // monolithic edge is the alternative detail. Emitting both doubled the
    // perimeter concrete inside one volume — the interpenetration gate
    // pinned it. Footing + stemwall remain the perimeter elements; the
    // FIELD (role 'slab', B17) pours beside them — the old 'slab-edge'
    // role is gone from the Member union entirely (nothing ever emitted
    // it, the takeoff mapped a phantom pour).
    const members = buildFoundation([wall], [slab])
    expect(byRole(members, 'footing').length).toBeGreaterThan(0)
    expect(byRole(members, 'stemwall').length).toBeGreaterThan(0)
    expect(byRole(members, 'slab').length).toBeGreaterThan(0)
  })
})

describe('buildFoundation — wall frame mapping (rotated wall)', () => {
  // Wall along +Z: same yaw convention as wall-framing (atan2(-dz, dx)).
  const wall = makeWall({ start: [1, 0], end: [1, 3] })
  const members = buildFoundation([wall], [])
  const footing = byRole(members, 'footing')[0] as Member

  test('footing yaw maps the +X box axis onto the wall direction', () => {
    expect(footing.rotation[1] ?? 0).toBeCloseTo(-Math.PI / 2, 6)
    // Verify with three: the rotated local +X axis is the wall dir in plan.
    const axis = new Vector3(1, 0, 0).applyEuler(new Euler(...footing.rotation))
    expect(axis.x).toBeCloseTo(wall.dir[0] ?? 0, 6)
    expect(axis.y).toBeCloseTo(0, 6)
    expect(axis.z).toBeCloseTo(wall.dir[1] ?? 0, 6)
  })

  test('members are placed at the wall midline in level space', () => {
    expect(footing.position[0] ?? 0).toBeCloseTo(1, 6)
    expect(footing.position[2] ?? 0).toBeCloseTo(1.5, 6)
    // bolts march along z (the wall run), staying on x = 1
    for (const b of byRole(members, 'anchor-bolt')) {
      expect(b.position[0] ?? 0).toBeCloseTo(1, 6)
    }
    const zs = byRole(members, 'anchor-bolt').map((b) => b.position[2] ?? 0)
    expect(Math.min(...zs)).toBeCloseTo(DEFAULT_SPEC.anchorBoltEndDistance, 6)
    expect(Math.max(...zs)).toBeCloseTo(3 - DEFAULT_SPEC.anchorBoltEndDistance, 6)
  })
})

describe('buildFoundation — guards', () => {
  test('interior walls get no perimeter run (no stemwall/bolts/hold-downs)', () => {
    const interior = makeWall({ exterior: false })
    const members = buildFoundation([interior], [slab])
    expect(byRole(members, 'stemwall')).toHaveLength(0)
    expect(byRole(members, 'anchor-bolt')).toHaveLength(0)
    expect(byRole(members, 'hold-down')).toHaveLength(0)
    // The slab field pours regardless — sourced to the SLAB, never the wall.
    for (const m of members) {
      if (m.role === 'slab' || m.role === 'vapor-retarder') expect(m.sourceId).toBe('slab_test')
      else expect(m.sourceId).not.toBe('slab_test')
    }
  })

  test('at LOD 200 interior walls get nothing — the slab field still pours', () => {
    const lod200: FramingSpec = { ...DEFAULT_SPEC, detail: '200' }
    const interior = makeWall({ exterior: false })
    const members = buildFoundation([interior], [slab], lod200)
    // no wall-sourced members (the partition bears on the slab)…
    expect(members.filter((m) => m.sourceId === 'wall_test')).toHaveLength(0)
    // …but the floor itself is core geometry at EVERY detail level (B17).
    expect(byRole(members, 'slab').length).toBeGreaterThan(0)
  })

  test('curved walls are skipped like wall-framing v1', () => {
    const curved = makeWall({ curved: true })
    expect(buildFoundation([curved], [])).toHaveLength(0)
  })

  test('shallow spec (footingDepth = footing height) omits the stemwall', () => {
    const shallow: FramingSpec = { ...DEFAULT_SPEC, footingDepth: inches(8) }
    const members = buildFoundation([makeWall()], [], shallow)
    expect(byRole(members, 'stemwall')).toHaveLength(0)
    const f = byRole(members, 'footing')[0] as Member
    expect((f.position[1] ?? 0) - f.dims[1] / 2).toBeCloseTo(-inches(8), 6)
    expect((f.position[1] ?? 0) + f.dims[1] / 2).toBeCloseTo(0, 6)
  })

  test('mixed level: interior walls never join the perimeter run', () => {
    const walls = [
      makeWall({ id: 'ext_a' }),
      makeWall({ id: 'int_b', exterior: false, start: [0, 2], end: [4, 2] }),
      makeWall({ id: 'ext_c', start: [0, 0], end: [0, 4] }),
    ]
    const members = buildFoundation(walls, [])
    const perimeterRoles = ['stemwall', 'anchor-bolt', 'hold-down']
    const intMembers = members.filter((m) => m.sourceId === 'int_b')
    // the long interior wall gets ONLY its thickened footing + bars
    expect(intMembers.length).toBeGreaterThan(0)
    for (const m of intMembers) expect(perimeterRoles).not.toContain(m.role)
    expect(members.some((m) => m.sourceId === 'ext_a' && m.role === 'stemwall')).toBe(true)
    expect(members.some((m) => m.sourceId === 'ext_c' && m.role === 'stemwall')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// LOD 350 — corner continuity (rubric: monolithic footing corners)
// ---------------------------------------------------------------------------

/** World-space run extents of a member along its local +X axis. */
function runEnds(m: Member): { near: Vector3; far: Vector3; axis: Vector3 } {
  const axis = new Vector3(1, 0, 0).applyEuler(new Euler(...m.rotation))
  const c = new Vector3(...m.position)
  const half = axis.clone().multiplyScalar((m.dims[0] ?? 0) / 2)
  return { near: c.clone().sub(half), far: c.clone().add(half), axis }
}

/** Plan-view (XZ) check that `point` lies inside the member's box. */
function coversInPlan(m: Member, point: readonly [number, number]): boolean {
  const { near, axis } = runEnds(m)
  const p = new Vector3(point[0], near.y, point[1])
  const d = p.clone().sub(near)
  const along = d.dot(axis)
  const acrossV = d.clone().sub(axis.clone().multiplyScalar(along))
  return (
    along >= -1e-9 &&
    along <= (m.dims[0] ?? 0) + 1e-9 &&
    acrossV.length() <= (m.dims[2] ?? 0) / 2 + 1e-9
  )
}

describe('buildFoundation — LOD 350 corner continuity', () => {
  const halfOtherFooting = DEFAULT_SPEC.footingWidth / 2 // 8" = 0.2032 m
  // L-corner at (4, 0): A runs +X and ends there, B runs +Z and starts there.
  const wallA = makeWall({ id: 'wall_a', start: [0, 0], end: [4, 0] })
  const wallB = makeWall({ id: 'wall_b', start: [4, 0], end: [4, 3] })
  const members = buildFoundation([wallA, wallB], [])
  const footA = byRole(members, 'footing').find((m) => m.sourceId === 'wall_a') as Member
  const footB = byRole(members, 'footing').find((m) => m.sourceId === 'wall_b') as Member

  test('the LONGER wall lays through the corner; the other butts flush', () => {
    // A (4 m) is the through wall: its run extends footingWidth/2 past the
    // corner, out to B's far footing face. B (3 m) retreats the same amount
    // and butts against A's side face — no overlap, no jutting ends.
    expect(footA.dims[0] - wallA.length).toBeCloseTo(halfOtherFooting, 6)
    expect(footB.dims[0] - wallB.length).toBeCloseTo(-halfOtherFooting, 6)
    const { near: aNear, far: aFar } = runEnds(footA)
    expect(aNear.x).toBeCloseTo(0, 6) // free end untouched
    expect(aFar.x).toBeCloseTo(4 + halfOtherFooting, 6)
    const { near: bNear, far: bFar } = runEnds(footB)
    expect(bNear.z).toBeCloseTo(halfOtherFooting, 6) // flush against A's face
    expect(bFar.z).toBeCloseTo(3, 6)
  })

  test('the corner is covered exactly ONCE — no overlapping pour boxes', () => {
    // through run covers the corner point…
    expect(coversInPlan(footA, [4, 0])).toBe(true)
    // …the butting run stops at the through run's face (flush, not inside)
    expect(coversInPlan(footB, [4, 0])).toBe(false)
    // zero plan overlap between the two boxes (the round-2 visual bug:
    // overlapping translucent boxes z-fight and read as corner seams)
    const { near: bNear } = runEnds(footB)
    const aFaceZ = DEFAULT_SPEC.footingWidth / 2
    expect(bNear.z).toBeGreaterThanOrEqual(aFaceZ - 1e-9)
    // and the through run reaches B's far face exactly (flush outer corner)
    const { far: aFar } = runEnds(footA)
    expect(aFar.x - 4).toBeCloseTo(halfOtherFooting, 6)
  })

  test('no double-height stack: one footing per wall, both on the SAME course', () => {
    expect(byRole(members, 'footing')).toHaveLength(2)
    expect(footA.position[1] ?? 0).toBeCloseTo(footB.position[1] ?? 0, 6)
    expect(footA.dims[1]).toBeCloseTo(footB.dims[1], 6)
    // course top/bottom identical → overlap is within one pour, not stacked
    const topA = (footA.position[1] ?? 0) + footA.dims[1] / 2
    const topB = (footB.position[1] ?? 0) + footB.dims[1] / 2
    expect(topA).toBeCloseTo(topB, 6)
  })

  test('stemwalls interlock with their OWN width — narrow runs stay flush too', () => {
    const stemA = byRole(members, 'stemwall').find((m) => m.sourceId === 'wall_a') as Member
    const stemB = byRole(members, 'stemwall').find((m) => m.sourceId === 'wall_b') as Member
    const halfStem = DEFAULT_SPEC.stemwallThickness / 2
    expect(stemA.dims[0] - wallA.length).toBeCloseTo(halfStem, 6)
    expect(stemB.dims[0] - wallB.length).toBeCloseTo(-halfStem, 6)
    expect(coversInPlan(stemA, [4, 0])).toBe(true)
    // flush: B's stem starts exactly at A's stem face — never past it
    const { near: bNear } = runEnds(stemB)
    expect(bNear.z).toBeCloseTo(halfStem, 6)
  })

  test('anchor bolts stay on the PLATE (never march into the extended pour)', () => {
    const boltsA = byRole(members, 'anchor-bolt').filter((m) => m.sourceId === 'wall_a')
    for (const b of boltsA) {
      expect(b.position[0] ?? 0).toBeGreaterThanOrEqual(0)
      expect(b.position[0] ?? 0).toBeLessThanOrEqual(4)
    }
  })

  test('diagonal corner: through/butt measured along the run, tie broken by id', () => {
    // corner at (3,3) between two 45° walls of EQUAL length → 'diag_a' through
    const diagA = makeWall({ id: 'diag_a', start: [0, 0], end: [3, 3] })
    const diagB = makeWall({ id: 'diag_b', start: [3, 3], end: [6, 0] })
    const foots = byRole(buildFoundation([diagA, diagB], []), 'footing')
    const fA = foots.find((m) => m.sourceId === 'diag_a') as Member
    const fB = foots.find((m) => m.sourceId === 'diag_b') as Member
    expect(fA.dims[0] - diagA.length).toBeCloseTo(halfOtherFooting, 6)
    expect(fB.dims[0] - diagB.length).toBeCloseTo(-halfOtherFooting, 6)
    // far end of the through run sits exactly 8" past the corner in plan
    const { far } = runEnds(fA)
    expect(Math.hypot(far.x - 3, far.z - 3)).toBeCloseTo(halfOtherFooting, 6)
    expect(coversInPlan(fA, [3, 3])).toBe(true)
    expect(coversInPlan(fB, [3, 3])).toBe(false)
  })

  test('LOD 200 keeps plain wall-length runs (350 gate)', () => {
    const lod200: FramingSpec = { ...DEFAULT_SPEC, detail: '200' }
    const foots = byRole(buildFoundation([wallA, wallB], [], lod200), 'footing')
    for (const f of foots) expect(f.dims[0]).toBeCloseTo(f.sourceId === 'wall_a' ? 4 : 3, 6)
  })

  test('collinear butt splice is NOT a corner — no extension', () => {
    const a = makeWall({ id: 'seg_a', start: [0, 0], end: [4, 0] })
    const b = makeWall({ id: 'seg_b', start: [4, 0], end: [8, 0] })
    const foots = byRole(buildFoundation([a, b], []), 'footing')
    for (const f of foots) expect(f.dims[0]).toBeCloseTo(4, 6)
  })
})

// ---------------------------------------------------------------------------
// LOD 350 — interior thickened footings under bearing walls
// ---------------------------------------------------------------------------

describe('buildFoundation — interior thickened footings (LOD 350)', () => {
  const bearing = makeWall({ id: 'int_bearing', exterior: false, start: [0, 1], end: [3, 1] })

  test('interior wall > 2.4 m gets a 12"-deep × footingWidth footing, top at slab line', () => {
    const members = buildFoundation([bearing], [slab])
    const foots = byRole(members, 'footing')
    expect(foots).toHaveLength(1)
    const f = foots[0] as Member
    expect(f.material).toBe('concrete')
    expect(f.dims[0]).toBeCloseTo(3, 6) // runs the wall
    expect(f.dims[1]).toBeCloseTo(inches(12), 6) // 12" deep
    expect(f.dims[2]).toBeCloseTo(DEFAULT_SPEC.footingWidth, 6)
    // monolithic with the slab: top at y = 0, bottom 12" down
    expect((f.position[1] ?? 0) + f.dims[1] / 2).toBeCloseTo(0, 6)
    expect((f.position[1] ?? 0) - f.dims[1] / 2).toBeCloseTo(-inches(12), 6)
    // centered under the wall in plan
    expect(f.position[0] ?? 0).toBeCloseTo(1.5, 6)
    expect(f.position[2] ?? 0).toBeCloseTo(1, 6)
    // no perimeter kit sneaks in
    expect(byRole(members, 'stemwall')).toHaveLength(0)
    expect(byRole(members, 'anchor-bolt')).toHaveLength(0)
  })

  test('short partitions (≤ 2.4 m) bear on the slab — no footing', () => {
    const short = makeWall({ id: 'int_short', exterior: false, start: [0, 1], end: [2.4, 1] })
    // only the slab field itself pours (B17) — nothing wall-sourced
    expect(buildFoundation([short], [slab]).filter((m) => m.sourceId === 'int_short')).toHaveLength(0)
  })

  test('gated at LOD 350: detail 200 emits nothing for interior walls', () => {
    const lod200: FramingSpec = { ...DEFAULT_SPEC, detail: '200' }
    expect(
      buildFoundation([bearing], [slab], lod200).filter((m) => m.sourceId !== 'slab_test'),
    ).toHaveLength(0)
  })

  test('interior footing carries its own 2× #4 bars at 3" clear off ITS bottom', () => {
    const bars = byRole(buildFoundation([bearing], [slab]), 'rebar')
    expect(bars).toHaveLength(2)
    for (const b of bars) {
      const bottom = (b.position[1] ?? 0) - b.dims[1] / 2
      expect(bottom - -inches(12)).toBeCloseTo(inches(3), 6) // 3" clear cover
      expect(b.dims[0]).toBeCloseTo(3, 6) // continuous along the run
    }
  })
})

// ---------------------------------------------------------------------------
// LOD 350 — rebar (2× #4 continuous + stemwall verticals)
// ---------------------------------------------------------------------------

describe('buildFoundation — rebar (LOD 350)', () => {
  const wall = makeWall() // 4 m along +X, no corners
  const members = buildFoundation([wall], [])
  const longs = members.filter((m) => m.role === 'rebar' && m.label === '#4 continuous footing bar')
  const verts = members.filter((m) => m.role === 'rebar' && m.label === '#4 stemwall vertical')

  test('2 continuous #4 bars per footing run, 0.5" square, full run length', () => {
    expect(longs).toHaveLength(2)
    for (const b of longs) {
      expect(b.material).toBe('steel')
      expect(b.dims[0]).toBeCloseTo(4, 6)
      expect(b.dims[1]).toBeCloseTo(inches(0.5), 6)
      expect(b.dims[2]).toBeCloseTo(inches(0.5), 6)
      expect(b.length).toBeCloseTo(4, 6)
    }
  })

  test('longitudinal bars sit 3" clear off the footing bottom', () => {
    for (const b of longs) {
      const barBottom = (b.position[1] ?? 0) - b.dims[1] / 2
      const footingBottom = -DEFAULT_SPEC.footingDepth
      expect(barBottom - footingBottom).toBeCloseTo(inches(3), 6)
    }
  })

  test('longitudinal bars split the footing width in thirds (v = ±width/6)', () => {
    // wall runs +X → across-offset v shows up on world z
    const zs = longs.map((b) => b.position[2] ?? 0).sort((a, b) => a - b)
    expect(zs[0]).toBeCloseTo(-DEFAULT_SPEC.footingWidth / 6, 6)
    expect(zs[1]).toBeCloseTo(DEFAULT_SPEC.footingWidth / 6, 6)
  })

  test('stemwall verticals at 48" o.c. — 5 bars, ≤48" gaps, clear of every bolt', () => {
    expect(verts).toHaveLength(5)
    const us = verts.map((b) => b.position[0] ?? 0).sort((a, b) => a - b)
    expect(us[0]).toBeCloseTo(inches(4), 6) // end cover
    expect(us[us.length - 1]).toBeCloseTo(4 - inches(4), 6)
    for (let i = 1; i < us.length; i++) {
      const gap = (us[i] ?? 0) - (us[i - 1] ?? 0)
      // Bars near an anchor bolt nudge one hand-width aside (round-12:
      // both layouts anchor to the run ends, so shared multiples used to
      // COINCIDE — a #4 bar inside a 5/8" bolt). Gaps stay ≤ 48" + nudge.
      expect(gap).toBeLessThanOrEqual(inches(48) + inches(4) + 1e-9)
    }
    const boltUs = members
      .filter((m) => m.role === 'anchor-bolt')
      .map((b) => b.position[0] ?? 0)
    for (const u of us) {
      for (const b of boltUs) {
        expect(Math.abs(u - b)).toBeGreaterThanOrEqual(inches(3) - 1e-9)
      }
    }
  })

  test('verticals RISE from the footing into the stemwall (numeric extents)', () => {
    const footingTop = -DEFAULT_SPEC.footingDepth + FOOTING_HEIGHT
    for (const v of verts) {
      const bottom = (v.position[1] ?? 0) - v.dims[1] / 2
      const top = (v.position[1] ?? 0) + v.dims[1] / 2
      expect(bottom).toBeCloseTo(-DEFAULT_SPEC.footingDepth + inches(3), 6) // stands on the mat
      expect(top).toBeCloseTo(-inches(2), 6) // 2" shy of the stemwall top
      expect(bottom).toBeLessThan(footingTop) // anchored IN the footing
      expect(top).toBeGreaterThan(footingTop) // …rising INTO the stemwall
      expect(v.dims[0]).toBeCloseTo(inches(0.5), 6)
      expect(v.dims[2]).toBeCloseTo(inches(0.5), 6)
    }
  })

  test('seismic spec tightens verticals to 24" o.c. — 8 bars on the 4 m run', () => {
    const seismic: FramingSpec = { ...DEFAULT_SPEC, seismicHoldDowns: true }
    const sVerts = buildFoundation([wall], [], seismic).filter(
      (m) => m.label === '#4 stemwall vertical',
    )
    expect(sVerts).toHaveLength(8)
    const us = sVerts.map((b) => b.position[0] ?? 0).sort((a, b) => a - b)
    for (let i = 1; i < us.length; i++) {
      expect((us[i] ?? 0) - (us[i - 1] ?? 0)).toBeLessThanOrEqual(inches(24) + 1e-9)
    }
  })

  test('corner-extended runs carry full-length continuous bars', () => {
    const a = makeWall({ id: 'ca', start: [0, 0], end: [4, 0] })
    const b = makeWall({ id: 'cb', start: [4, 0], end: [4, 3] })
    const bars = buildFoundation([a, b], []).filter(
      (m) => m.label === '#4 continuous footing bar' && m.sourceId === 'ca',
    )
    expect(bars).toHaveLength(2)
    for (const bar of bars) {
      expect(bar.dims[0]).toBeCloseTo(4 + DEFAULT_SPEC.footingWidth / 2, 6)
    }
  })

  test('no stemwall → no verticals (shallow spec), longitudinal bars remain', () => {
    const shallow: FramingSpec = { ...DEFAULT_SPEC, footingDepth: inches(8) }
    const rebar = byRole(buildFoundation([wall], [], shallow), 'rebar')
    expect(rebar.filter((m) => m.label === '#4 stemwall vertical')).toHaveLength(0)
    expect(rebar.filter((m) => m.label === '#4 continuous footing bar')).toHaveLength(2)
  })

  test('gated at LOD 350: detail 200 emits zero rebar', () => {
    const lod200: FramingSpec = { ...DEFAULT_SPEC, detail: '200' }
    expect(byRole(buildFoundation([wall], [], lod200), 'rebar')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// LOD 400 — plate washers at anchor bolts (R602.11.1)
// ---------------------------------------------------------------------------

describe('buildFoundation — plate washers (LOD 400, R602.11.1)', () => {
  const fabSeismic: FramingSpec = { ...DEFAULT_SPEC, detail: '400', seismicHoldDowns: true }
  const wall = makeWall() // 4 m → 3 anchor bolts under the default spec
  const members = buildFoundation([wall], [], fabSeismic)
  const bolts = byRole(members, 'anchor-bolt')
  const washers = byRole(members, 'plate-washer')

  test('exactly one 3×3×0.229" steel washer per anchor bolt', () => {
    expect(bolts.length).toBeGreaterThan(0)
    expect(washers).toHaveLength(bolts.length)
    for (const w of washers) {
      expect(w.material).toBe('steel')
      expect(w.dims[0]).toBeCloseTo(inches(3), 6)
      expect(w.dims[1]).toBeCloseTo(inches(0.229), 6)
      expect(w.dims[2]).toBeCloseTo(inches(3), 6)
    }
  })

  test('each washer is centered on its bolt in plan, seated on the 1.5" plate', () => {
    const boltUs = bolts.map((b) => b.position[0] ?? 0).sort((a, b) => a - b)
    const washerUs = washers.map((w) => w.position[0] ?? 0).sort((a, b) => a - b)
    for (let i = 0; i < boltUs.length; i++) {
      expect(washerUs[i]).toBeCloseTo(boltUs[i] ?? 0, 6)
    }
    for (const w of washers) {
      expect(w.position[2] ?? 0).toBeCloseTo(0, 6) // on the wall line, like the bolts
      const bottom = (w.position[1] ?? 0) - w.dims[1] / 2
      expect(bottom).toBeCloseTo(inches(1.5), 6) // top of the 2x mudsill
    }
  })

  test('washers vanish without the seismic trigger, even at detail 400', () => {
    const fabOnly: FramingSpec = { ...DEFAULT_SPEC, detail: '400' }
    expect(byRole(buildFoundation([wall], [], fabOnly), 'plate-washer')).toHaveLength(0)
  })

  test('washers vanish below detail 400, even with the seismic trigger', () => {
    const seismic300: FramingSpec = { ...DEFAULT_SPEC, detail: '300', seismicHoldDowns: true }
    expect(byRole(buildFoundation([wall], [], seismic300), 'plate-washer')).toHaveLength(0)
  })
})

describe('cornerExtensions — oblique corners (round-10)', () => {
  test('45° corner scales the lap by (1+|cosθ|)/sinθ; 90° keeps ±1', () => {
    // Horizontal run meeting a 45° chamfer: through = the longer wall.
    const a = makeWall({ id: 'w_long', start: [0, 0], end: [4, 0] })
    const c = Math.SQRT1_2
    const b = makeWall({ id: 'w_chamfer', start: [4, 0], end: [4 + c, c] })
    const ext = cornerExtensions([a, b])
    const expected = (1 + c) / c // (1+cos45°)/sin45° ≈ 2.414
    expect(ext.get('w_long')?.end).toBeCloseTo(expected, 6) // through extends
    expect(ext.get('w_chamfer')?.start).toBeCloseTo(-expected, 6) // butt retreats
    // Perpendicular corners keep the classic ±1 (regression).
    const d = makeWall({ id: 'w_perp', start: [4, 0], end: [4, 3] })
    const ext2 = cornerExtensions([a, d])
    expect(ext2.get('w_long')?.end).toBeCloseTo(1, 6)
    expect(ext2.get('w_perp')?.start).toBeCloseTo(-1, 6)
  })
})

describe('buildFoundation — short interior link walls (blueprint round-1 p_link)', () => {
  const FAB: FramingSpec = { ...DEFAULT_SPEC, detail: '400' }
  const perimeter = [
    makeWall({ id: 'w_s', start: [0, 0], end: [8, 0] }),
    makeWall({ id: 'w_e', start: [8, 0], end: [8, 4] }),
    makeWall({ id: 'w_n', start: [8, 4], end: [0, 4] }),
    makeWall({ id: 'w_w', start: [0, 4], end: [0, 0] }),
  ]

  test('a 1.2 m interior wall bridging two footing runs gets a footing', () => {
    // links the south perimeter to a long interior bearing wall — the ring
    // on the foundation plan must close through it
    const bearing = makeWall({ id: 'w_bear', start: [0, 1.2], end: [8, 1.2], exterior: false })
    const link = makeWall({ id: 'w_link', start: [4, 0], end: [4, 1.2], exterior: false })
    const members = buildFoundation([...perimeter, bearing, link], [slab as never], FAB)
    const linkFootings = byRole(members, 'footing').filter((m) => m.sourceId === 'w_link')
    expect(linkFootings.length).toBeGreaterThan(0)
  })

  test('an isolated 1.2 m closet partition still gets none', () => {
    const stub = makeWall({ id: 'w_stub', start: [3, 2], end: [4.2, 2], exterior: false })
    const members = buildFoundation([...perimeter, stub], [slab as never], FAB)
    const stubFootings = byRole(members, 'footing').filter((m) => m.sourceId === 'w_stub')
    expect(stubFootings).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// LOD-400 B18d — pad footings under upper-storey girder posts (R403.1/R407.3)
// ---------------------------------------------------------------------------

describe('buildFoundation — girder-post pad footings (B18d)', () => {
  const perimeter = [
    makeWall({ id: 'w_s', start: [0, 0], end: [8, 0] }),
    makeWall({ id: 'w_e', start: [8, 0], end: [8, 6] }),
    makeWall({ id: 'w_n', start: [8, 6], end: [0, 6] }),
    makeWall({ id: 'w_w', start: [0, 6], end: [0, 0] }),
  ]
  const bigSlab = {
    id: 'slab_big',
    polygon: [
      [0, 0],
      [8, 0],
      [8, 6],
      [0, 6],
    ],
    holes: [],
    elevation: 0.05,
    thickness: 0.1,
  } as const
  const posts = [
    { plan: [2.5, 3] as const, sourceId: 'slab_up' },
    { plan: [5.5, 3] as const, sourceId: 'slab_up' },
  ]
  const members = buildFoundation(perimeter, [bigSlab as never], DEFAULT_SPEC, {
    girderPosts: posts,
  })
  const pads = members.filter((m) => m.label?.startsWith('Pad footing'))

  test('one 24"×24"×12" pad per post, top at y = 0 (the post bearing seat), booked concrete', () => {
    expect(pads).toHaveLength(2)
    for (const [i, p] of pads.entries()) {
      expect(p.role).toBe('footing')
      expect(p.system).toBe('foundation')
      expect(p.material).toBe('concrete')
      expect(p.dims[0]).toBeCloseTo(inches(24), 6)
      expect(p.dims[1]).toBeCloseTo(inches(12), 6)
      expect(p.dims[2]).toBeCloseTo(inches(24), 6)
      expect((p.position[1] ?? 0) + p.dims[1] / 2).toBeCloseTo(0, 6) // monolithic top
      expect(p.position[0] ?? 0).toBeCloseTo(posts[i]?.plan[0] ?? 0, 6)
      expect(p.position[2] ?? 0).toBeCloseTo(posts[i]?.plan[1] ?? 0, 6)
      expect(p.sourceId).toBe('slab_up')
      expect(p.label).toContain('R403.1')
      expect(p.label).toContain('R407.3')
      expect(p.advisory).toContain('verify')
    }
  })

  test('the slab field carves around every pad — no strip pours through a pad', () => {
    const strips = members.filter((m) => m.role === 'slab' || m.role === 'vapor-retarder')
    expect(strips.length).toBeGreaterThan(0)
    for (const pad of pads) {
      const [phx, phz] = [pad.dims[0] / 2, pad.dims[2] / 2]
      for (const s of strips) {
        const [shx, shz] = [s.dims[0] / 2, s.dims[2] / 2]
        const ox =
          Math.min((s.position[0] ?? 0) + shx, (pad.position[0] ?? 0) + phx) -
          Math.max((s.position[0] ?? 0) - shx, (pad.position[0] ?? 0) - phx)
        const oz =
          Math.min((s.position[2] ?? 0) + shz, (pad.position[2] ?? 0) + phz) -
          Math.max((s.position[2] ?? 0) - shz, (pad.position[2] ?? 0) - phz)
        expect(Math.min(ox, oz)).toBeLessThanOrEqual(1e-6)
      }
    }
  })

  test('a post landing on an existing pour bears there — NO doubled pad', () => {
    // dead-center on an interior bearing wall's thickened footing…
    const bearing = makeWall({ id: 'w_bear', exterior: false, start: [0, 3], end: [8, 3] })
    const onFooting = buildFoundation([...perimeter, bearing], [bigSlab as never], DEFAULT_SPEC, {
      girderPosts: [{ plan: [4, 3], sourceId: 'slab_up' }],
    })
    expect(onFooting.filter((m) => m.label?.startsWith('Pad footing'))).toHaveLength(0)
    // …and flush against the perimeter stemwall band
    const onPerimeter = buildFoundation(perimeter, [bigSlab as never], DEFAULT_SPEC, {
      girderPosts: [{ plan: [4, 0.1], sourceId: 'slab_up' }],
    })
    expect(onPerimeter.filter((m) => m.label?.startsWith('Pad footing'))).toHaveLength(0)
  })

  test('coincident posts pour ONE pad (two girder lines meeting)', () => {
    const doubled = buildFoundation(perimeter, [bigSlab as never], DEFAULT_SPEC, {
      girderPosts: [
        { plan: [4, 3], sourceId: 'slab_up' },
        { plan: [4.1, 3], sourceId: 'slab_up' },
      ],
    })
    expect(doubled.filter((m) => m.label?.startsWith('Pad footing'))).toHaveLength(1)
  })

  test('GRAZING pad, post OFF the band: pad pours CLIPPED beside the pour — never a silent bare post (skeptic F3)', () => {
    // Bearing wall at z = 3.5 → footing band z ∈ [3.2968, 3.7032]. The full
    // 24" pad for a post at [4, 3] reaches 3.3048 — a graze the old
    // rect-overlap skip turned into NO pad at all (post on the bare slab,
    // silent). The pad now shrinks centered until it clears: 23".
    const bearing = makeWall({ id: 'w_bear', exterior: false, start: [0, 3.5], end: [8, 3.5] })
    const m = buildFoundation([...perimeter, bearing], [bigSlab as never], DEFAULT_SPEC, {
      girderPosts: [{ plan: [4, 3], sourceId: 'slab_up' }],
    })
    const pad = m.find((x) => x.label?.startsWith('Pad footing'))
    expect(pad).toBeDefined()
    expect(pad?.dims[0]).toBeCloseTo(inches(23), 6)
    expect(pad?.dims[2]).toBeCloseTo(inches(23), 6)
    expect(pad?.position[0]).toBeCloseTo(4, 6) // still centered on the POST
    expect(pad?.position[2]).toBeCloseTo(3, 6)
    expect(pad?.label).toContain('23"')
    expect(pad?.advisory).toContain('clipped beside an adjacent pour')
    // clear of the footing band (contact allowed, overlap not)
    expect((pad?.position[2] ?? 0) + (pad?.dims[2] ?? 0) / 2).toBeLessThanOrEqual(3.2968 + 1e-9)
    // no unfooted flag anywhere — the post GOT its pad
    expect(m.some((x) => x.flag?.includes('bears without a pad footing'))).toBe(false)
  })

  test('NO room even for the 12" minimum pad: the post flags the pour it abuts — loudly (skeptic F3 repro)', () => {
    // The verbatim repro: bearing wall z = 3.35 (band lo 3.1468), post
    // [4, 3] — even the minimum pad reaches 3.1524. Old behavior: silent
    // skip, post on the bare 3-1/2" slab.
    const bearing = makeWall({ id: 'w_bear', exterior: false, start: [0, 3.35], end: [8, 3.35] })
    const m = buildFoundation([...perimeter, bearing], [bigSlab as never], DEFAULT_SPEC, {
      girderPosts: [{ plan: [4, 3], sourceId: 'slab_up' }],
    })
    expect(m.filter((x) => x.label?.startsWith('Pad footing'))).toHaveLength(0)
    const flagged = m.find((x) => x.flag?.includes(UNFOOTED_POST_FLAG))
    expect(flagged).toBeDefined()
    expect(flagged?.sourceId).toBe('w_bear') // the pour the post abuts
    expect(flagged?.role).toBe('footing')
  })

  test('two posts 0.5 m apart: BOTH bear on concrete — full pad + clipped neighbor (skeptic F3)', () => {
    const m = buildFoundation(perimeter, [bigSlab as never], DEFAULT_SPEC, {
      girderPosts: [
        { plan: [3.5, 3], sourceId: 'slab_up' },
        { plan: [4, 3], sourceId: 'slab_up' },
      ],
    })
    const twoPads = m.filter((x) => x.label?.startsWith('Pad footing'))
    expect(twoPads).toHaveLength(2)
    const [a, b] = twoPads as [Member, Member]
    expect(a.dims[0]).toBeCloseTo(inches(24), 6) // first post: the full pad
    expect(b.dims[0]).toBeCloseTo(inches(15), 6) // second: clipped clear
    expect(b.dims[0]).toBeGreaterThanOrEqual(inches(12) - 1e-9)
    // the two pours never share volume (centers 0.5 m apart)
    expect(Math.abs((a.position[0] ?? 0) - (b.position[0] ?? 0))).toBeGreaterThanOrEqual(
      (a.dims[0] + b.dims[0]) / 2 - 1e-9,
    )
    expect(m.some((x) => x.flag?.includes('bears without a pad footing'))).toBe(false)
  })

  test('LOD 200 pours no pads (350 gate, like the interior thickened footings)', () => {
    const lod200: FramingSpec = { ...DEFAULT_SPEC, detail: '200' }
    const m = buildFoundation(perimeter, [bigSlab as never], lod200, { girderPosts: posts })
    expect(m.filter((x) => x.label?.startsWith('Pad footing'))).toHaveLength(0)
  })

  test('pads book into the foundation footings pour (S4: rendered == booked)', () => {
    const rows = computeTakeoff(members, [], {})
    const withoutPads = computeTakeoff(
      members.filter((m) => !m.label?.startsWith('Pad footing')),
      [],
      {},
    )
    const footings = (r: { section: string; item: string; detail: string; quantity: number | string }[]) =>
      // detail carries the stated B21e waste suffix — match the pour name
      r.find(
        (x) =>
          x.section === 'Foundation' && x.item === 'Concrete' && x.detail.startsWith('footings'),
      )
    expect(footings(rows)).toBeDefined()
    expect(Number(footings(rows)?.quantity)).toBeGreaterThan(Number(footings(withoutPads)?.quantity))
  })
})

describe('buildFoundation — slab-on-grade field + vapor retarder (LOD-400 B17)', () => {
  // 6×4 closed shell + a bearing partition — the baseline foundation shape.
  const perimeter = [
    makeWall({ id: 'w_s', start: [0, 0], end: [6, 0] }),
    makeWall({ id: 'w_e', start: [6, 0], end: [6, 4] }),
    makeWall({ id: 'w_n', start: [6, 4], end: [0, 4] }),
    makeWall({ id: 'w_w', start: [0, 4], end: [0, 0] }),
  ]
  const rectSlab = {
    id: 'slab_field',
    polygon: [
      [0, 0],
      [6, 0],
      [6, 4],
      [0, 4],
    ],
    holes: [],
    elevation: 0.05,
    thickness: 0.1,
  } as const
  const members = buildFoundation(perimeter, [rectSlab as never])
  const field = byRole(members, 'slab')
  const membrane = byRole(members, 'vapor-retarder')

  test('the field is REAL: concrete strips, 3-1/2" thick, walking surface at y = 0 (R506.1)', () => {
    expect(field.length).toBeGreaterThan(0)
    for (const m of field) {
      expect(m.material).toBe('concrete')
      expect(m.system).toBe('foundation')
      expect(m.sourceId).toBe('slab_field')
      expect(m.dims[1]).toBeCloseTo(inches(3.5), 6)
      // top of slab = plate line (the PT sole plate bears on it, B5)
      expect((m.position[1] ?? 0) + m.dims[1] / 2).toBeCloseTo(0, 6)
      expect(m.label).toContain('R506.1')
      // 4" base course is a stated ASSUMPTION, never invented geometry
      expect(m.advisory).toContain('base course')
      expect(m.advisory).toContain('R506.2.2')
    }
  })

  test('the strips tile INSIDE the polygon and clear of the stemwall band', () => {
    const stemHalf = DEFAULT_SPEC.stemwallThickness / 2
    for (const m of field) {
      const [hx, hz] = [m.dims[0] / 2, m.dims[2] / 2]
      // inside the 6×4 footprint…
      expect((m.position[0] ?? 0) - hx).toBeGreaterThanOrEqual(-1e-6)
      expect((m.position[0] ?? 0) + hx).toBeLessThanOrEqual(6 + 1e-6)
      expect((m.position[2] ?? 0) - hz).toBeGreaterThanOrEqual(-1e-6)
      expect((m.position[2] ?? 0) + hz).toBeLessThanOrEqual(4 + 1e-6)
      // …and clear of every perimeter stemwall band (the slab pours AGAINST
      // the stemwall, R403.1 — the strip stops at its face)
      expect((m.position[0] ?? 0) - hx).toBeGreaterThanOrEqual(stemHalf - 1e-6)
      expect((m.position[0] ?? 0) + hx).toBeLessThanOrEqual(6 - stemHalf + 1e-6)
      expect((m.position[2] ?? 0) - hz).toBeGreaterThanOrEqual(stemHalf - 1e-6)
      expect((m.position[2] ?? 0) + hz).toBeLessThanOrEqual(4 - stemHalf + 1e-6)
    }
    // the field still covers most of the footprint — the carve is a band,
    // not a moat (first compose lost 32% to axis-parallel over-carve)
    const area = field.reduce((sum, m) => sum + m.dims[0] * m.dims[2], 0)
    expect(area).toBeGreaterThan(0.8 * 6 * 4)
    expect(area).toBeLessThan(6 * 4)
  })

  test('the 6-mil vapor retarder mirrors the field 1:1 directly UNDER it (R506.2.3)', () => {
    expect(membrane.length).toBe(field.length)
    const fieldArea = field.reduce((sum, m) => sum + m.dims[0] * m.dims[2], 0)
    const memArea = membrane.reduce((sum, m) => sum + m.dims[0] * m.dims[2], 0)
    expect(memArea).toBeCloseTo(fieldArea, 6)
    for (const m of membrane) {
      expect(m.material).toBe('pvc')
      expect(m.dims[1]).toBeCloseTo(inches(0.006), 9) // 6 mil
      // membrane top == slab bottom
      expect((m.position[1] ?? 0) + m.dims[1] / 2).toBeCloseTo(-inches(3.5), 6)
      expect(m.label).toContain('R506.2.3')
    }
  })

  test('holes are CARVED: no strip crosses a stair/utility opening', () => {
    const holed = {
      ...rectSlab,
      holes: [
        [
          [2, 1],
          [3.2, 1],
          [3.2, 2.6],
          [2, 2.6],
        ],
      ],
    }
    const holedMembers = buildFoundation(perimeter, [holed as never])
    const holedField = [
      ...byRole(holedMembers, 'slab'),
      ...byRole(holedMembers, 'vapor-retarder'),
    ]
    expect(byRole(holedMembers, 'slab').length).toBeGreaterThan(0)
    for (const m of holedField) {
      const [hx, hz] = [m.dims[0] / 2, m.dims[2] / 2]
      const overlapX =
        Math.min((m.position[0] ?? 0) + hx, 3.2) - Math.max((m.position[0] ?? 0) - hx, 2)
      const overlapZ =
        Math.min((m.position[2] ?? 0) + hz, 2.6) - Math.max((m.position[2] ?? 0) - hz, 1)
      expect(Math.min(overlapX, overlapZ)).toBeLessThanOrEqual(1e-6)
    }
    // and the carved field books LESS than the unholed one
    const holedArea = byRole(holedMembers, 'slab').reduce(
      (sum, m) => sum + m.dims[0] * m.dims[2],
      0,
    )
    const fullArea = field.reduce((sum, m) => sum + m.dims[0] * m.dims[2], 0)
    expect(holedArea).toBeLessThan(fullArea - 1.2 * 1.6 + 0.2)
  })

  test('an interior bearing wall interrupts the field at its thickened footing', () => {
    const bearing = makeWall({ id: 'w_bear', start: [3, 0], end: [3, 4], exterior: false })
    const withBearing = buildFoundation([...perimeter, bearing], [rectSlab as never])
    const footHalf = DEFAULT_SPEC.footingWidth / 2
    // The thickened footing tee-retreats off the exterior runs, so test
    // against its ACTUAL emitted extent (a sliver of field legitimately
    // pours between the stemwall face and the retreated footing end).
    const foot = byRole(withBearing, 'footing').find((m) => m.sourceId === 'w_bear')
    expect(foot).toBeDefined()
    const footZ: [number, number] = [
      (foot?.position[2] ?? 0) - (foot?.dims[0] ?? 0) / 2,
      (foot?.position[2] ?? 0) + (foot?.dims[0] ?? 0) / 2,
    ]
    let interrupted = 0
    for (const m of byRole(withBearing, 'slab')) {
      const [lo, hi] = [(m.position[0] ?? 0) - m.dims[0] / 2, (m.position[0] ?? 0) + m.dims[0] / 2]
      const [zLo, zHi] = [(m.position[2] ?? 0) - m.dims[2] / 2, (m.position[2] ?? 0) + m.dims[2] / 2]
      // strips inside the footing's z-extent must clear the x = 3 band
      if (zLo >= footZ[0] - 1e-6 && zHi <= footZ[1] + 1e-6) {
        expect(lo >= 3 + footHalf - 1e-6 || hi <= 3 - footHalf + 1e-6).toBe(true)
        interrupted++
      }
    }
    expect(interrupted).toBeGreaterThan(0) // non-vacuous
  })

  test('no slabs → no field, no membrane (hasSlab is live code again)', () => {
    const bare = buildFoundation(perimeter, [])
    expect(byRole(bare, 'slab')).toHaveLength(0)
    expect(byRole(bare, 'vapor-retarder')).toHaveLength(0)
  })
})
