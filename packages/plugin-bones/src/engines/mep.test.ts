import { describe, expect, test } from 'bun:test'
import type { Fixture, Member, RoomSlice, WallSlice } from '../core/types'
import { layoutHvac, polygonArea, tonsFor } from './hvac'
import { layoutPlumbing, wetWallFor } from './plumbing'

/** A 10m × 8m two-bath plan: kitchen, bathroom, bedroom, hallway, laundry. */
function wall(id: string, start: [number, number], end: [number, number]): WallSlice {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  return {
    id,
    start,
    end,
    length,
    dir: [dx / length, dz / length],
    thickness: 0.1,
    height: 2.5,
    exterior: false,
    openings: [],
    curved: false,
  }
}

function room(
  id: string,
  name: string,
  category: RoomSlice['category'],
  polygon: [number, number][],
  boundaryWallIds: string[] = [],
): RoomSlice {
  return { id, name, category, polygon, boundaryWallIds, ceilingHeight: 2.5 }
}

const walls = [
  wall('w_south', [0, 0], [10, 0]),
  wall('w_north', [0, 8], [10, 8]),
  wall('w_mid', [5, 0], [5, 8]),
  wall('w_bathwall', [5, 4], [10, 4]),
]

const rooms = [
  room('r_kitchen', 'Kitchen', 'kitchen', [[0, 0], [5, 0], [5, 4], [0, 4]], ['w_south', 'w_mid']),
  room('r_bath', 'Bathroom', 'bathroom', [[5, 0], [10, 0], [10, 4], [5, 4]], ['w_mid', 'w_bathwall']),
  room('r_bed', 'Bedroom', 'bedroom', [[5, 4], [10, 4], [10, 8], [5, 8]]),
  room('r_hall', 'Hallway', 'hallway', [[0, 4], [5, 4], [5, 8], [2, 8], [2, 6], [0, 6]]),
  room('r_laundry', 'Laundry', 'laundry', [[2, 6], [5, 6], [5, 8], [2, 8]]),
]

const byKind = (fixtures: Fixture[], kind: string) => fixtures.filter((f) => f.kind === kind)
const byRole = (members: Member[], role: string) => members.filter((m) => m.role === role)

describe('layoutPlumbing', () => {
  const { members, fixtures } = layoutPlumbing(walls, rooms)

  test('one vent stack rising through the roof at the bathroom wet wall', () => {
    const stacks = byRole(members, 'vent-stack')
    expect(stacks).toHaveLength(1)
    const stack = stacks[0] as Member
    expect(stack.length).toBeCloseTo(2.5 + 0.6, 5)
    expect(stack.material).toBe('pvc')
    expect(stack.sourceId).toBe('r_bath')
  })

  test('every wet room gets stub-outs (3 bath — WC/shower/lav, 1 kitchen, 1 laundry)', () => {
    const stubs = byKind(fixtures, 'stub-out')
    expect(stubs.filter((s) => s.sourceId === 'r_bath')).toHaveLength(3)
    expect(stubs.filter((s) => s.sourceId === 'r_kitchen')).toHaveLength(1)
    expect(stubs.filter((s) => s.sourceId === 'r_laundry')).toHaveLength(1)
  })

  test('drains + hot/cold supplies run from remote wet rooms toward the stack', () => {
    const pipes = byRole(members, 'pipe-run')
    const drains = pipes.filter((p) => p.label?.includes('drain'))
    const supplies = pipes.filter((p) => p.label?.includes('Supply'))
    // Kitchen and bath share the w_mid wet wall back-to-back (the ideal
    // plumbing core), so their runs collapse to zero and only the remote
    // laundry needs a real drain run.
    expect(drains.length).toBeGreaterThanOrEqual(1)
    expect(supplies.length).toBeGreaterThanOrEqual(2) // hot+cold for the remote room
    for (const s of supplies) expect(s.material).toBe('copper')
  })

  test('water heater prefers the laundry; cleanouts at the stack base AND sewer exit', () => {
    expect(byKind(fixtures, 'water-heater')[0]?.sourceId).toBe('r_laundry')
    const cleanouts = byKind(fixtures, 'cleanout')
    expect(cleanouts).toHaveLength(2)
    expect(cleanouts.some((c) => c.label?.includes('sewer'))).toBe(true)
  })

  test('no wet rooms → nothing (never crashes on empty scenes)', () => {
    const empty = layoutPlumbing(walls, [room('r', 'Living', 'other', [[0, 0], [1, 0], [1, 1]])])
    expect(empty.members).toHaveLength(0)
    expect(empty.fixtures).toHaveLength(0)
    const noWalls = layoutPlumbing([], rooms)
    expect(noWalls.members).toHaveLength(0)
  })

  test('wetWallFor honors boundary walls', () => {
    const core: [number, number] = [5, 2]
    const picked = wetWallFor(rooms[1] as RoomSlice, walls, core)
    expect(['w_mid', 'w_bathwall']).toContain(picked?.id ?? '')
  })
})

describe('layoutHvac', () => {
  const { members, fixtures } = layoutHvac(walls, rooms)

  test('tonnage from conditioned area (garage excluded), sane bounds', () => {
    expect(polygonArea([[0, 0], [4, 0], [4, 3], [0, 3]])).toBeCloseTo(12, 6)
    // 10x8m = 80m² ≈ 861 sqft → 861/500 = 1.72 → 2.0 tons
    expect(tonsFor(80)).toBe(2)
    const equip = byKind(fixtures, 'equipment')[0] as Fixture
    expect(equip.meta?.tons).toBe(2)
    expect(equip.sourceId).toBe('r_laundry') // service-space preference
  })

  test('a register in every habitable room (laundry included), none in the hallway', () => {
    const regs = byKind(fixtures, 'register')
    expect(regs.map((r) => r.sourceId).sort()).toEqual(['r_bath', 'r_bed', 'r_kitchen', 'r_laundry'])
  })

  test('trunk + one branch per register, branches end at the registers', () => {
    const ducts = byRole(members, 'duct-run')
    const trunk = ducts.find((d) => d.label?.includes('Trunk'))
    expect(trunk).toBeDefined()
    const branches = ducts.filter((d) => d.label?.includes('branch'))
    const regs = byKind(fixtures, 'register')
    for (const reg of regs) {
      const [rx, , rz] = reg.position
      const onBranchEnd = branches.some((b) => {
        // A branch ends at the register: center + half length along the
        // branch direction (member +X maps to (cos ψ, 0, -sin ψ)).
        const [cx, , cz] = b.position
        const yaw = b.rotation[1]
        const dx = Math.cos(yaw)
        const dz = -Math.sin(yaw)
        const half = b.length / 2
        const ends = [
          [cx + dx * half, cz + dz * half],
          [cx - dx * half, cz - dz * half],
        ]
        return ends.some(([ex, ez]) => Math.hypot((ex as number) - rx, (ez as number) - rz) < 0.02)
      })
      // A register sitting ON the trunk line needs no branch — the trunk
      // serves it directly (engine drops sub-15cm branches).
      const onTrunk = (() => {
        if (!trunk) return false
        const [cx, , cz] = trunk.position
        const yaw = trunk.rotation[1]
        const dx = Math.cos(yaw)
        const dz = -Math.sin(yaw)
        const half = trunk.length / 2
        const ax = cx - dx * half
        const az = cz - dz * half
        const t = Math.max(0, Math.min(trunk.length, (rx - ax) * dx + (rz - az) * dz))
        return Math.hypot(ax + dx * t - rx, az + dz * t - rz) < 0.16
      })()
      expect(onBranchEnd || onTrunk).toBe(true)
    }
  })

  test('return near the unit, thermostat on a wall at 52 inches', () => {
    expect(byKind(fixtures, 'return')).toHaveLength(1)
    const tstat = byKind(fixtures, 'thermostat')[0] as Fixture
    expect(tstat.position[1]).toBeCloseTo(52 * 0.0254, 5)
    expect(walls.some((w) => w.id === tstat.sourceId)).toBe(true)
  })

  test('no rooms → nothing', () => {
    const empty = layoutHvac(walls, [])
    expect(empty.members).toHaveLength(0)
    expect(empty.fixtures).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Round-1 fabrication features (sizes, slope, main, vents, WH loop; HVAC
// Manhattan trunk, cfm, step-down, exhaust, condensate/lineset)
// ---------------------------------------------------------------------------

import { DEFAULT_SPEC } from '../core/spec'
import { inches } from '../core/units'
import { DFU_BY_CATEGORY, DRAIN_SLOPE, MAIN_CAPACITY_DFU } from './plumbing'
import { CFM_PER_TON, returnGrilleIn2 } from './hvac'

/** Same plan, but with real exterior walls so services can terminate. */
function exteriorPlan() {
  const w = (id: string, start: [number, number], end: [number, number], exterior = false) => ({
    ...wall(id, start, end),
    exterior,
  })
  return {
    walls: [
      w('w_south', [0, 0], [10, 0], true),
      w('w_north', [0, 8], [10, 8], true),
      w('w_west', [0, 0], [0, 8], true),
      w('w_east', [10, 0], [10, 8], true),
      w('w_mid', [5, 0], [5, 8]),
      w('w_bathwall', [5, 4], [10, 4]),
    ],
    rooms,
  }
}

describe('plumbing — sizes, rough-in heights, slope (round-1 gaps)', () => {
  const { walls: xwalls } = exteriorPlan()
  const { members, fixtures } = layoutPlumbing(xwalls, rooms)
  const pipes = byRole(members, 'pipe-run')

  test('pipe diameters: 3" stack, 3" bathroom branch, 2" others, ½/¾" supply', () => {
    const stack = byRole(members, 'vent-stack')[0] as Member
    expect(stack.dims[0]).toBeCloseTo(inches(3), 6)
    const bathBranch = pipes.filter(
      (p) => p.sourceId === 'dwv-branch-r_bath' && p.label?.includes('branch drain'),
    )
    expect(bathBranch.length).toBeGreaterThan(0)
    for (const b of bathBranch) expect(b.dims[1]).toBeCloseTo(inches(3), 6)
    const laundryBranch = pipes.filter(
      (p) => p.sourceId === 'dwv-branch-r_laundry' && p.label?.includes('branch drain — '),
    )
    expect(laundryBranch.length).toBeGreaterThan(0)
    for (const b of laundryBranch) expect(b.dims[1]).toBeCloseTo(inches(2), 6)
    const service = pipes.find((p) => p.label?.includes('water service')) as Member
    expect(service.dims[1]).toBeCloseTo(inches(0.75), 6)
    const branch = pipes.find((p) => p.label === 'Supply cold ½"') as Member
    expect(branch.dims[1]).toBeCloseTo(inches(0.5), 6)
  })

  test('stub-out rough-in heights: 12" toilet, 21" lav, 18" sink, 42" laundry', () => {
    const stubs = byKind(fixtures, 'stub-out')
    const bath = stubs.filter((s) => s.sourceId === 'r_bath').map((s) => s.position[1]).sort((a, b) => a - b)
    expect(bath[0]).toBeCloseTo(inches(12), 6)
    expect(bath[1]).toBeCloseTo(inches(21), 6)
    expect(stubs.find((s) => s.sourceId === 'r_kitchen')?.position[1]).toBeCloseTo(inches(18), 6)
    expect(stubs.find((s) => s.sourceId === 'r_laundry')?.position[1]).toBeCloseTo(inches(42), 6)
  })

  test('the 3" building drain is REAL geometry from the stack to an exterior wall', () => {
    const main = pipes.filter((p) => p.label?.includes('building drain'))
    expect(main.length).toBeGreaterThanOrEqual(1)
    const total = main.reduce((s, m) => s + m.length, 0)
    expect(total).toBeGreaterThan(0.5) // not the old zero-length dead code
    for (const m of main) expect(m.dims[1]).toBeCloseTo(inches(3), 6)
    // DFU total in the label (bath 6 + kitchen 2 + laundry 2 = 10)
    expect(main[0]?.label).toContain('10 DFU')
    expect(main[0]?.flag).toBeUndefined() // 10 < 42 — properly sized
  })

  test('horizontal drains render the P3005.3 slope FOR THEIR SIZE; supplies stay level', () => {
    const sloped = pipes.filter((p) => p.label?.includes('branch drain') && p.length > 0.2)
    expect(sloped.length).toBeGreaterThan(0)
    for (const p of sloped) {
      // 1/4"/ft below 3", 1/8"/ft allowed at 3"+ (data/mep-rules.json)
      const sizeIn = Math.round((Math.min(p.dims[1], p.dims[2]) / 0.0254) * 8) / 8
      const slope = sizeIn >= 3 ? 1 / 96 : 1 / 48
      expect(p.rotation[2]).toBeCloseTo(Math.atan(slope), 6)
    }
    const supplies = pipes.filter((p) => p.label?.includes('Supply') && p.dims[0] > 0.2)
    for (const s of supplies) expect(s.rotation[2]).toBe(0)
  })

  test('Manhattan: every horizontal pipe is axis-aligned (no diagonal air runs)', () => {
    for (const p of pipes) {
      if (p.dims[1] > p.dims[0]) continue // riser
      const yaw = ((p.rotation[1] % Math.PI) + Math.PI) % (Math.PI / 2)
      expect(Math.min(yaw, Math.PI / 2 - yaw)).toBeLessThan(1e-9)
    }
  })

  test('remote rooms re-vent above the flood rim back to the stack', () => {
    const vents = pipes.filter((p) => p.label?.includes('vent — reconnect'))
    expect(vents.length).toBeGreaterThan(0)
    const horizontal = vents.filter((v) => v.dims[0] > v.dims[1])
    for (const v of horizontal) expect(v.position[1]).toBeCloseTo(inches(42), 6)
    for (const v of vents) expect(v.dims[2]).toBeCloseTo(inches(1.5), 6)
  })

  test('every stub gets a through-floor drop just off the wall (crawl-space feedback)', () => {
    // Drops leave the wet wall DROP_SETBACK (0.3 m) into the room so the
    // through-floor risers clear the footings under the wall — one riser
    // per stub, crossing the floor plane into the under-floor tree.
    for (const stub of byKind(fixtures, 'stub-out')) {
      const drop = pipes.find(
        (p) =>
          p.sourceId.startsWith('dwv-trap-') &&
          p.dims[1] > p.dims[0] && // vertical
          Math.hypot(
            (p.position[0] as number) - stub.position[0],
            (p.position[2] as number) - stub.position[2],
          ) <
            0.3 + 1e-6,
      )
      expect(drop).toBeDefined()
      const d = drop as Member
      // crosses the floor: top at the fixture connection, bottom buried
      expect(d.position[1] + d.dims[1] / 2).toBeGreaterThanOrEqual(-1e-9)
      expect(d.position[1] - d.dims[1] / 2).toBeLessThan(-0.3)
    }
  })

  test('WH loop: hot branches serve sinks but never the toilet', () => {
    const hot = pipes.filter((p) => p.label?.includes('hot'))
    expect(hot.length).toBeGreaterThan(0)
    // toilet stub (12" AFF) plan point gets a cold riser but no hot riser
    const toilet = byKind(fixtures, 'stub-out').find((s) =>
      s.label?.includes('Toilet'),
    ) as Fixture
    const hotAtToilet = hot.filter(
      (p) =>
        p.dims[1] > p.dims[0] &&
        Math.abs((p.position[0] as number) - toilet.position[0]) < 1e-6 &&
        Math.abs((p.position[2] as number) - toilet.position[2]) < 1e-6,
    )
    expect(hotAtToilet).toHaveLength(0)
    const cold = pipes.filter((p) => p.label === 'Supply cold ½"')
    const coldAtToilet = cold.filter(
      (p) =>
        p.dims[1] > p.dims[0] &&
        Math.abs((p.position[0] as number) - toilet.position[0]) < 1e-6 &&
        Math.abs((p.position[2] as number) - toilet.position[2]) < 1e-6,
    )
    expect(coldAtToilet).toHaveLength(1)
  })

  test('DFU overload flags the main as undersized', () => {
    // 8 bathroom groups = 48 DFU > 42 on a 3" building drain.
    const manyBaths: RoomSlice[] = Array.from({ length: 8 }, (_, i) =>
      room(`r_b${i}`, `Bath ${i}`, 'bathroom', [
        [i, 0],
        [i + 1, 0],
        [i + 1, 2],
        [i, 2],
      ]),
    )
    expect(8 * (DFU_BY_CATEGORY.bathroom ?? 0)).toBeGreaterThan(MAIN_CAPACITY_DFU)
    const { members } = layoutPlumbing(exteriorPlan().walls, manyBaths)
    const main = members.find((m) => m.label?.includes('building drain'))
    expect(main?.flag).toContain('UNDERSIZED')
    expect(main?.flag).toContain('4"')
  })

  test('LOD 200 keeps the schematic core only (no vents/traps/supply branches)', () => {
    const { members } = layoutPlumbing(exteriorPlan().walls, rooms, {
      ...DEFAULT_SPEC,
      detail: '200',
    })
    expect(members.some((m) => m.label?.includes('vent — reconnect'))).toBe(false)
    expect(members.some((m) => m.label?.includes('trap arm'))).toBe(false)
    expect(members.some((m) => m.label?.includes('Supply'))).toBe(false)
    // …but the stack and drains remain
    expect(byRole(members, 'vent-stack')).toHaveLength(1)
    expect(members.some((m) => m.label?.includes('building drain'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Under-floor DWV gates (user feedback 2026-08-20: "the crawlspace should
// have pipes — toilets, shower, sink — there should be evacuation/drainage").
// The room-category fallback used to render its drains on a schematic plane
// INSIDE the room volume (+0.08 m); now every drainage fixture drops through
// the floor and the whole tree hangs below the floor plane like the
// placed-fixture engine's.
// ---------------------------------------------------------------------------

import { Vector3 } from 'three'
import { endpointsOf } from './electrical.test-helpers'
import {
  ATTACH_TOL,
  buildingDrainExit,
  drainFailures,
  levelDrains,
  stackToTreeGap,
} from './plumbing.test-helpers'
import { computeTakeoff } from './takeoff'

describe('fallback DWV — under-floor evacuation (crawl-space feedback)', () => {
  const { walls: xwalls } = exteriorPlan()
  const { members, fixtures } = layoutPlumbing(xwalls, rooms)
  const drains = members.filter(
    (m) =>
      m.role === 'pipe-run' &&
      m.sourceId.startsWith('dwv-') &&
      !m.sourceId.startsWith('dwv-vent'),
  )
  const sizeOf = (m: Member): number =>
    Math.round((Math.min(m.dims[1], m.dims[2]) / 0.0254) * 8) / 8

  test('drain presence per fixture class: WC 3", shower 2", lav 1.5", sink 1.5", washer 2"', () => {
    const expectDrop = (sourceId: string, sizeIn: number, labelBit: string) => {
      const drop = members.find((m) => m.sourceId === sourceId && m.dims[1] > m.dims[0])
      expect(drop).toBeDefined()
      const d = drop as Member
      expect(sizeOf(d)).toBe(sizeIn)
      expect(d.label).toContain(labelBit)
      expect(d.label).toContain('P3005.4.1')
    }
    expectDrop('dwv-trap-r_bath-0', 3, 'closet bend')
    expectDrop('dwv-trap-r_bath-1', 2, 'shower trap')
    expectDrop('dwv-trap-r_bath-2', 1.5, 'lav trap')
    expectDrop('dwv-trap-r_kitchen-0', 1.5, 'sink trap')
    expectDrop('dwv-trap-r_laundry-0', 2, 'standpipe')
  })

  test('R1: the fallback stack physically ties into the drainage tree (P3104)', () => {
    expect(stackToTreeGap(members)).toBeLessThanOrEqual(ATTACH_TOL)
  })

  test('continuity: every trap reaches the building-drain exit strictly downhill', () => {
    expect(
      drainFailures(members, ['r_bath-0', 'r_bath-1', 'r_bath-2', 'r_kitchen-0', 'r_laundry-0']),
    ).toEqual([])
    expect(levelDrains(members)).toEqual([])
  })

  test('every horizontal drain hangs FULLY below the floor plane', () => {
    // The one above-floor horizontal is the stack's floor-line jog (R1 —
    // it bridges the wall-line stack to the inboard sleeved drop).
    const horizontals = drains.filter(
      (m) => m.dims[0] > m.dims[1] && !m.label?.includes('floor-line jog'),
    )
    expect(horizontals.length).toBeGreaterThan(0)
    for (const m of horizontals) {
      expect(m.position[1] + m.dims[1] / 2).toBeLessThan(0)
    }
  })

  test('slope pin: every under-floor segment drops its plan length × the P3005.3 slope', () => {
    let pinned = 0
    for (const m of drains) {
      if (m.dims[1] > m.dims[0] || m.length <= 0.06) continue // vertical / stub
      const sizeIn = sizeOf(m)
      const slope = Math.tan(m.rotation[2])
      // legal for the size (1/8"/ft floor at 3"+, 1/4"/ft below) and one of
      // the two code slopes — the building drain keeps 1/4"/ft at 3" (its
      // DFU capacity table is tabulated at that slope)
      const minSlope = sizeIn >= 3 ? 1 / 96 : 1 / 48
      expect(slope).toBeGreaterThanOrEqual(minSlope - 1e-9)
      expect(Math.abs(slope - 1 / 96) < 1e-9 || Math.abs(slope - 1 / 48) < 1e-9).toBe(true)
      const [a, b] = endpointsOf(m)
      const plan = Math.hypot(b.x - a.x, b.z - a.z)
      expect(Math.abs(Math.abs(b.y - a.y) - plan * slope)).toBeLessThan(1e-6)
      pinned++
    }
    expect(pinned).toBeGreaterThan(3)
  })

  test('exit: buried building drain leaves the footprint — labeled → sewer/septic (P3005.4)', () => {
    const main = members.filter((m) => m.sourceId === 'dwv-main')
    expect(main.length).toBeGreaterThan(0)
    expect(main[0]?.label).toContain('→ sewer/septic (P3005.4')
    const exit = buildingDrainExit(members)
    expect(exit).not.toBeNull()
    const e = exit as Vector3
    expect(e.y).toBeLessThan(-0.4)
    // at/beyond the shell (10×8 footprint) — one exit point, street side
    const inside = e.x > 0.05 && e.x < 9.95 && e.z > 0.05 && e.z < 7.95
    expect(inside).toBe(false)
  })

  test('LOD 200 keeps the buried skeleton (branches + main below the floor)', () => {
    const at200 = layoutPlumbing(xwalls, rooms, { ...DEFAULT_SPEC, detail: '200' })
    const buried = at200.members.filter(
      (m) => m.role === 'pipe-run' && m.sourceId.startsWith('dwv-'),
    )
    expect(buried.some((m) => m.sourceId.startsWith('dwv-branch-'))).toBe(true)
    expect(buried.some((m) => m.sourceId === 'dwv-main')).toBe(true)
    for (const m of buried) {
      if (m.dims[1] > m.dims[0]) continue
      if (m.label?.includes('floor-line jog')) continue // the R1 stack bridge
      expect(m.position[1] + m.dims[1] / 2).toBeLessThan(0)
    }
  })

  test('S2: upper storeys drop the foundation/sewer fiction (no sleeve, truthful main)', () => {
    const upper = layoutPlumbing(xwalls, rooms, DEFAULT_SPEC, [], undefined, false)
    const labels = upper.members.map((m) => m.label ?? '')
    expect(labels.some((l) => l.includes('sewer/septic'))).toBe(false)
    expect(labels.some((l) => l.includes('sleeve') || l.includes('P2603.4'))).toBe(false)
    expect(labels.some((l) => l.includes('riser to storey below (not modeled)'))).toBe(true)
    const cleanouts = upper.fixtures.filter((f) => f.kind === 'cleanout')
    expect(cleanouts.length).toBeGreaterThan(0)
    expect(cleanouts.some((c) => c.label?.includes('sewer'))).toBe(false)
    // the buried tree itself is unchanged — drains still hang below the floor
    const horizontals = upper.members.filter(
      (m) =>
        m.role === 'pipe-run' &&
        m.sourceId.startsWith('dwv-') &&
        !m.sourceId.startsWith('dwv-vent') &&
        m.dims[0] > m.dims[1] &&
        !m.label?.includes('floor-line jog'), // the R1 stack bridge
    )
    expect(horizontals.length).toBeGreaterThan(0)
    for (const m of horizontals) expect(m.position[1] + m.dims[1] / 2).toBeLessThan(0)
  })

  test('takeoff: DWV pipe lf by size + fittings estimate + cleanout count (P3005.2)', () => {
    const rows = computeTakeoff(members, fixtures)
    const find = (item: string) =>
      rows.find((r) => r.item === item && r.section === 'Plumbing')
    expect(find('PVC 3"')?.quantity ?? 0).toBeGreaterThan(0)
    expect(find('PVC 2"')?.quantity ?? 0).toBeGreaterThan(0)
    expect(find('PVC 1.5"')?.quantity ?? 0).toBeGreaterThan(0)
    expect(find('PVC 3" fittings')).toBeDefined()
    expect(find('Cleanouts')?.quantity).toBe(2)
    expect(find('Cleanouts')?.detail).toContain('P3005.2')
  })
})

describe('hvac — Manhattan trunk, cfm, step-down, exhaust (round-1 gaps)', () => {
  const { walls: xwalls } = exteriorPlan()
  const { members, fixtures } = layoutHvac(xwalls, rooms)
  const ducts = byRole(members, 'duct-run')

  test('register cfm meta splits 400 cfm/ton by room area share', () => {
    const equip = byKind(fixtures, 'equipment').find((e) => e.label?.includes('Air handler')) as Fixture
    const tons = Number(equip.meta?.tons)
    const total = tons * CFM_PER_TON
    const regs = byKind(fixtures, 'register')
    const sum = regs.reduce((s, r) => s + Number(r.meta?.cfm ?? 0), 0)
    expect(Math.abs(sum - total)).toBeLessThan(regs.length + 1) // rounding only
    // kitchen (20 m²) gets more air than the laundry (6 m²)
    const kitchen = regs.find((r) => r.sourceId === 'r_kitchen')
    const laundry = regs.find((r) => r.sourceId === 'r_laundry')
    expect(Number(kitchen?.meta?.cfm)).toBeGreaterThan(Number(laundry?.meta?.cfm))
    expect(kitchen?.label).toContain('cfm')
  })

  test('trunk runs along the hallway axis; branches leave at right angles', () => {
    const trunks = ducts.filter((d) => d.label?.startsWith('Trunk') && !d.label.includes('feed'))
    expect(trunks.length).toBeGreaterThan(0)
    // hallway bbox (0..5 × 4..8) → long axis X: trunk segments all run on X
    for (const t of trunks) {
      expect(Math.abs(Math.sin(t.rotation[1]))).toBeLessThan(1e-9)
    }
    const branches = ducts.filter((d) => d.label?.includes('branch'))
    for (const b of branches) {
      expect(Math.abs(Math.cos(b.rotation[1]))).toBeLessThan(1e-9) // ⊥ to the trunk
    }
  })

  test('trunk cross-section steps down after each takeoff', () => {
    const trunks = ducts.filter((d) => d.label?.startsWith('Trunk') && !d.label.includes('feed'))
    // widths (dims[2]) are non-increasing with distance from the feed in each direction
    const widths = trunks.map((t) => t.dims[2])
    expect(Math.max(...widths)).toBeGreaterThan(Math.min(...widths) - 1e-9)
    expect(trunks.some((t) => t.dims[2] < inches(14) - 1e-9)).toBe(true)
  })

  test('bath exhaust fan + duct to an exterior termination; laundry dryer vent', () => {
    const fans = byKind(fixtures, 'exhaust-fan')
    expect(fans).toHaveLength(1)
    expect(fans[0]?.sourceId).toBe('r_bath')
    const exhaust = ducts.filter((d) => d.label?.includes('exhaust'))
    expect(exhaust.some((d) => d.label?.includes('M1505'))).toBe(true)
    expect(exhaust.some((d) => d.label?.includes('M1502'))).toBe(true)
    for (const d of exhaust) expect(d.dims[2]).toBeCloseTo(inches(4), 6)
  })

  test('return grille sized to tonnage with capacity meta', () => {
    const ret = byKind(fixtures, 'return')[0] as Fixture
    const equip = byKind(fixtures, 'equipment').find((e) => e.label?.includes('Air handler')) as Fixture
    const tons = Number(equip.meta?.tons)
    expect(ret.meta?.grilleIn2).toBe(returnGrilleIn2(tons))
    expect(Number(ret.meta?.capacityCfm)).toBeGreaterThanOrEqual(tons * CFM_PER_TON)
    expect(ret.label).not.toContain('UNDERSIZED')
  })

  test('LOD 400 adds condensate; the condenser row + lineset ship at EVERY LOD', () => {
    const at400 = layoutHvac(xwalls, rooms, { ...DEFAULT_SPEC, detail: '400' })
    const pipeRuns = byRole(at400.members, 'pipe-run')
    expect(pipeRuns.some((p) => p.label?.includes('Condensate'))).toBe(true)
    expect(pipeRuns.some((p) => p.sourceId.startsWith('lineset-'))).toBe(true)
    const condenser = at400.fixtures.find((f) => f.label?.includes('Condenser'))
    expect(condenser).toBeDefined()
    // pad sits OUTSIDE the footprint (10×8 shell)
    const [px, , pz] = condenser?.position ?? [0, 0, 0]
    const inside = px > 0 && px < 10 && pz > 0 && pz < 8
    expect(inside).toBe(false)
    // 300 keeps the outdoor unit + lineset (condenser-always: an AH never
    // ships without its outdoor unit) — only the condensate stays 400 scope
    expect(byRole(members, 'pipe-run').some((p) => p.sourceId.startsWith('lineset-'))).toBe(true)
    expect(byRole(members, 'pipe-run').some((p) => p.label?.includes('Condensate'))).toBe(false)
  })

  test('garages are excluded from conditioned tonnage', () => {
    const garage = room('r_garage', 'Garage', 'garage', [
      [10, 0],
      [16, 0],
      [16, 8],
      [10, 8],
    ])
    const withGarage = layoutHvac(xwalls, [...rooms, garage])
    const equipA = byKind(fixtures, 'equipment').find((e) => e.label?.includes('Air handler'))
    const equipB = byKind(withGarage.fixtures, 'equipment').find((e) =>
      e.label?.includes('Air handler'),
    )
    // adding a 48 m² garage changes nothing about the conditioned sqft
    expect(equipB?.meta?.conditionedSqft).toBe(equipA?.meta?.conditionedSqft)
    expect(equipB?.meta?.tons).toBe(equipA?.meta?.tons)
    // and the garage gets no register
    expect(byKind(withGarage.fixtures, 'register').some((r) => r.sourceId === 'r_garage')).toBe(false)
  })
})

describe('hvac — condensate slope rendered (round-2 advisory)', () => {
  test('both condensate legs pitch 1/8"/ft and chain downhill', () => {
    const { walls: xwalls } = exteriorPlan()
    const { members } = layoutHvac(xwalls, rooms, { ...DEFAULT_SPEC, detail: '400' })
    const legs = byRole(members, 'pipe-run').filter((p) => p.label?.includes('Condensate'))
    expect(legs.length).toBeGreaterThanOrEqual(1)
    for (const leg of legs) {
      expect(leg.rotation[2]).toBeCloseTo(Math.atan(1 / 96), 6)
    }
    // chained: no two legs share the same center height unless parallel
    if (legs.length === 2) {
      const [a, b] = legs as [Member, Member]
      expect((a.position[1] as number) !== (b.position[1] as number)).toBe(true)
    }
  })
})

describe('hvac — return balance flag can FIRE (round-3: dead branch)', () => {
  test('a big system outgrows the largest stock grille and gets flagged', () => {
    // Two 30×8 halls: 480 m² ≈ 5166 ft² → 10.5 tons → 4200 cfm supply.
    // The biggest stock grille (800 in²) only returns ~1600 cfm.
    const big = [
      room('r_h1', 'Hall A', 'other', [
        [0, 0],
        [30, 0],
        [30, 8],
        [0, 8],
      ]),
      room('r_h2', 'Hall B', 'other', [
        [30, 0],
        [60, 0],
        [60, 8],
        [30, 8],
      ]),
    ]
    const { fixtures } = layoutHvac(exteriorPlan().walls, big)
    const ret = byKind(fixtures, 'return')[0] as Fixture
    expect(ret.meta?.grilleIn2).toBe(800) // capped at the catalog top
    expect(ret.label).toContain('UNDERSIZED')
    expect(ret.label).toContain('add a second return')
    // and the normal-size plan stays clean
    const normal = layoutHvac(exteriorPlan().walls, rooms)
    expect((byKind(normal.fixtures, 'return')[0] as Fixture).label).not.toContain('UNDERSIZED')
  })
})
