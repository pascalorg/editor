import { describe, expect, test } from 'bun:test'
import mepRules from '../../data/mep-rules.json'
import { DEFAULT_SPEC } from '../core/spec'
import type { Fixture, Member, RoomSlice, WallSlice } from '../core/types'
import { layoutHvac } from './hvac'

/**
 * GATE (prod report 2026-08-16): ducts must NOT cross wall top plates.
 * IRC R602.6/R602.6.1 cap plate notching/boring (a >50% bored plate needs a
 * 16 ga tie) — a duct never fits, so the trunk routes at ATTIC elevation
 * (above every plate band), supply registers become CEILING boots, and the
 * exhaust runs exit through stud bays BELOW the band. Three invariants:
 *  1. no duct-run member OBB intersects any wall's top-plate band
 *     [wall.height − topPlateBandM, wall.height];
 *  2. every supply register sits at its room's ceiling plane (meta ceiling);
 *  3. the trunk is CONTINUOUS from the air handler to every register
 *     (union-find over duct endpoints, like the electrical E2 harness).
 * Numeric basis: data/mep-rules.json hvac.attic (docs/research/mep.md §3.6).
 */

const ATTIC = (mepRules as {
  hvac: { attic: { trunkAboveWallTopM: number; topPlateBandM: number; ceilingJoistDepthM: number } }
}).hvac.attic

function wall(
  id: string,
  start: [number, number],
  end: [number, number],
  exterior = false,
  height = 2.5,
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
    thickness: 0.114,
    height,
    exterior,
    openings: [],
    curved: false,
  }
}

function room(
  id: string,
  name: string,
  category: RoomSlice['category'],
  polygon: [number, number][],
): RoomSlice {
  return { id, name, category, polygon, boundaryWallIds: [], ceilingHeight: 2.5 }
}

/** 10×8 shell with a real interior partition grid (mep.test plan). */
function plan(wallHeights: Partial<Record<string, number>> = {}) {
  const h = (id: string) => wallHeights[id] ?? 2.5
  const walls = [
    wall('w_south', [0, 0], [10, 0], true, h('w_south')),
    wall('w_north', [0, 8], [10, 8], true, h('w_north')),
    wall('w_west', [0, 0], [0, 8], true, h('w_west')),
    wall('w_east', [10, 0], [10, 8], true, h('w_east')),
    wall('w_mid', [5, 0], [5, 8], false, h('w_mid')),
    wall('w_bathwall', [5, 4], [10, 4], false, h('w_bathwall')),
  ]
  const rooms = [
    room('r_kitchen', 'Kitchen', 'kitchen', [[0, 0], [5, 0], [5, 4], [0, 4]]),
    room('r_bath', 'Bathroom', 'bathroom', [[5, 0], [10, 0], [10, 4], [5, 4]]),
    room('r_bed', 'Bedroom', 'bedroom', [[5, 4], [10, 4], [10, 8], [5, 8]]),
    room('r_hall', 'Hallway', 'hallway', [[0, 4], [5, 4], [5, 8], [2, 8], [2, 6], [0, 6]]),
    room('r_laundry', 'Laundry', 'laundry', [[2, 6], [5, 6], [5, 8], [2, 8]]),
  ]
  return { walls, rooms }
}

// ---- OBB sampling (the electrical RO gates' sampling style) -----------------

/** Sample points covering a duct member's box: axis steps × cross corners. */
function obbSamples(m: Member): [number, number, number][] {
  const vertical = m.dims[1] > m.dims[0]
  const yaw = m.rotation[1]
  const axis: [number, number, number] = vertical
    ? [0, 1, 0]
    : [Math.cos(yaw), 0, -Math.sin(yaw)]
  const lateral: [number, number, number] = vertical
    ? [1, 0, 0]
    : [Math.sin(yaw), 0, Math.cos(yaw)]
  const up: [number, number, number] = vertical ? [0, 0, 1] : [0, 1, 0]
  const len = vertical ? m.dims[1] : m.dims[0]
  const lat = vertical ? m.dims[0] : m.dims[2]
  const upSize = vertical ? m.dims[2] : m.dims[1]
  const out: [number, number, number][] = []
  const steps = Math.max(2, Math.ceil(len / 0.1))
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps - 0.5) * len
    for (const sl of [-lat / 2, 0, lat / 2]) {
      for (const su of [-upSize / 2, 0, upSize / 2]) {
        out.push([
          m.position[0] + axis[0] * t + lateral[0] * sl + up[0] * su,
          m.position[1] + axis[1] * t + lateral[1] * sl + up[1] * su,
          m.position[2] + axis[2] * t + lateral[2] * sl + up[2] * su,
        ])
      }
    }
  }
  return out
}

/** True when the point stands inside `wall`'s top-plate band volume. */
function inPlateBand(p: [number, number, number], w: WallSlice): boolean {
  if (p[1] <= w.height - ATTIC.topPlateBandM || p[1] >= w.height) return false
  const dx = p[0] - w.start[0]
  const dz = p[2] - w.start[1]
  const along = dx * w.dir[0] + dz * w.dir[1]
  if (along < -1e-6 || along > w.length + 1e-6) return false
  const off = Math.abs(-dx * w.dir[1] + dz * w.dir[0])
  return off < w.thickness / 2
}

function plateViolations(members: Member[], walls: WallSlice[]): string[] {
  const out: string[] = []
  for (const m of members) {
    if (m.role !== 'duct-run') continue
    for (const p of obbSamples(m)) {
      const hit = walls.find((w) => inPlateBand(p, w))
      if (hit) {
        out.push(`${m.label ?? m.role} @y=${p[1].toFixed(3)} in ${hit.id} plate band`)
        break
      }
    }
  }
  return out
}

// ---- duct continuity (union-find, adapted from electrical.test-helpers) -----

function ductEndpoints(m: Member): [[number, number, number], [number, number, number]] {
  const vertical = m.dims[1] > m.dims[0]
  if (vertical) {
    return [
      [m.position[0], m.position[1] - m.dims[1] / 2, m.position[2]],
      [m.position[0], m.position[1] + m.dims[1] / 2, m.position[2]],
    ]
  }
  const yaw = m.rotation[1]
  const half = m.dims[0] / 2
  const ax = Math.cos(yaw) * half
  const az = -Math.sin(yaw) * half
  return [
    [m.position[0] - ax, m.position[1], m.position[2] - az],
    [m.position[0] + ax, m.position[1], m.position[2] + az],
  ]
}

const dist = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)

/** Distance from point to the segment between a duct's endpoints. */
function segDist(p: readonly number[], m: Member): number {
  const [a, b] = ductEndpoints(m)
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const len2 = ab[0]! ** 2 + ab[1]! ** 2 + ab[2]! ** 2
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p[0]! - a[0]) * ab[0]! + (p[1]! - a[1]) * ab[1]! + (p[2]! - a[2]) * ab[2]!) /
        Math.max(1e-9, len2),
    ),
  )
  return dist(p, [a[0] + ab[0]! * t, a[1] + ab[1]! * t, a[2] + ab[2]! * t])
}

/** Registers NOT duct-connected to the air handler (empty = gate passes). */
function unreachableRegisters(members: Member[], fixtures: Fixture[]): string[] {
  // Supply network only: trunk (riser/feed/segments), branches, boots —
  // exhaust runs are separate systems by design.
  const ducts = members.filter(
    (m) =>
      m.role === 'duct-run' &&
      (m.label?.startsWith('Trunk') || m.label?.includes('branch') || m.label?.includes('boot')),
  )
  const equipment = fixtures.find((f) => f.kind === 'equipment' && f.label?.includes('Air handler'))
  const registers = fixtures.filter((f) => f.kind === 'register')
  if (!equipment) return registers.map((r) => r.sourceId)

  const parent = ducts.map((_, i) => i)
  const find = (i: number): number => {
    let r = i
    while (parent[r] !== r) r = parent[r] as number
    return r
  }
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b)
  }
  // A tee lands INSIDE the trunk's cross-section, not at its endpoint — the
  // touch tolerance is half the fatter duct's largest section (≤ 0.2 m).
  const tol = 0.2
  for (let i = 0; i < ducts.length; i++) {
    for (let j = i + 1; j < ducts.length; j++) {
      const [a1, a2] = ductEndpoints(ducts[i] as Member)
      const touch =
        segDist(a1, ducts[j] as Member) < tol ||
        segDist(a2, ducts[j] as Member) < tol ||
        ductEndpoints(ducts[j] as Member).some((e) => segDist(e, ducts[i] as Member) < tol)
      if (touch) union(i, j)
    }
  }
  const compsNear = (p: readonly [number, number, number], t: number): Set<number> => {
    const comps = new Set<number>()
    for (let i = 0; i < ducts.length; i++) {
      if (segDist(p, ducts[i] as Member) < t) comps.add(find(i))
    }
    return comps
  }
  const equipComps = compsNear(equipment.position, 0.4)
  if (equipComps.size === 0) return registers.map((r) => r.sourceId)
  const out: string[] = []
  for (const reg of registers) {
    const comps = compsNear(reg.position, 0.05)
    if (![...comps].some((c) => equipComps.has(c))) out.push(reg.sourceId)
  }
  return out
}

// ---- gates -------------------------------------------------------------------

describe('hvac — ducts never cross top plates (R602.6 + M1601 attic practice)', () => {
  const { walls, rooms } = plan()
  const { members, fixtures } = layoutHvac(walls, rooms)

  test('no duct-run member OBB enters any wall top-plate band', () => {
    expect(plateViolations(members, walls)).toEqual([])
  })

  test('trunk + branches run at attic elevation above the tallest plate', () => {
    const wallTop = Math.max(...walls.map((w) => w.height))
    const horizontals = members.filter(
      (m) =>
        m.role === 'duct-run' &&
        m.dims[0] >= m.dims[1] &&
        (m.label?.startsWith('Trunk') || m.label?.includes('branch')),
    )
    expect(horizontals.length).toBeGreaterThan(0)
    for (const m of horizontals) {
      // bottom of the duct clears the top of every wall
      expect(m.position[1] - m.dims[1] / 2).toBeGreaterThan(wallTop)
      // and the elevation matches the published attic clearance key
      expect(m.position[1]).toBeCloseTo(wallTop + ATTIC.trunkAboveWallTopM, 6)
    }
  })

  test('supply registers hang just BELOW the ceiling plane, fed by drop boots', () => {
    const registers = fixtures.filter((f) => f.kind === 'register')
    expect(registers.length).toBeGreaterThan(0)
    for (const reg of registers) {
      const home = rooms.find((r) => r.id === reg.sourceId) as RoomSlice
      // Visual round 2026-08-16: at/above the host ceiling mesh the grille
      // is invisible from inside the room — it sits 4 cm below the plane
      // (like a recessed light), the boot reaching 5 cm below to meet it.
      expect(reg.position[1]).toBeCloseTo(home.ceilingHeight - 0.04, 6)
      expect(reg.position[1]).toBeLessThan(home.ceilingHeight)
      expect(reg.meta?.ceiling).toBe(true)
    }
    const boots = members.filter((m) => m.role === 'duct-run' && m.label?.includes('boot'))
    expect(boots.length).toBe(registers.length)
    for (const boot of boots) {
      expect(boot.dims[1]).toBeGreaterThan(boot.dims[0]) // vertical
      // the boot's low end drops through the plane to the grille
      const low = boot.position[1] - boot.dims[1] / 2
      expect(low).toBeCloseTo(2.5 - 0.05, 6)
    }
  })

  test('trunk is continuous from the air handler to every register', () => {
    expect(unreachableRegisters(members, fixtures)).toEqual([])
  })

  test('a TALLER wall still keeps every duct clear of its plate band', () => {
    // Raise the partition the old ceiling-height routing used to skim.
    const tall = plan({ w_mid: 3.0, w_bathwall: 3.0 })
    const out = layoutHvac(tall.walls, tall.rooms)
    expect(plateViolations(out.members, tall.walls)).toEqual([])
    expect(unreachableRegisters(out.members, out.fixtures)).toEqual([])
  })

  test('LOD 400 (exhaust + condensate + lineset) stays plate-clean too', () => {
    const out = layoutHvac(walls, rooms, { ...DEFAULT_SPEC, detail: '400' })
    expect(plateViolations(out.members, walls)).toEqual([])
    // exhaust runs exist and exit BELOW the band (through a stud bay)
    const exhaust = out.members.filter(
      (m) => m.role === 'duct-run' && m.label?.includes('exhaust'),
    )
    expect(exhaust.length).toBeGreaterThan(0)
    for (const m of exhaust) {
      for (const w of walls) {
        expect(m.position[1] + m.dims[1] / 2).toBeLessThan(w.height - ATTIC.topPlateBandM)
      }
    }
  })

  test('mep-rules carries the attic keys the engine routes by', () => {
    expect(ATTIC.trunkAboveWallTopM).toBeGreaterThan(ATTIC.ceilingJoistDepthM)
    expect(ATTIC.topPlateBandM).toBeCloseTo(0.09, 6)
  })
})

describe('hvac — exhaust height keys off the EXIT wall, not the room ceiling', () => {
  test('a 2.4 m exit wall under a 2.5 m ceiling keeps the duct out of ITS plate band', () => {
    // The bathroom (7.5, 2) exits through w_south (nearest exterior) —
    // shorten THAT wall: the old room.ceilingHeight-keyed elevation put the
    // 4" run inside its [2.31, 2.4] plate band (skeptic 2026-08-16).
    const short = plan({ w_south: 2.4 })
    const out = layoutHvac(short.walls, short.rooms)
    expect(plateViolations(out.members, short.walls)).toEqual([])
    const exhaust = out.members.filter(
      (m) => m.role === 'duct-run' && m.label?.includes('Bath exhaust'),
    )
    expect(exhaust.length).toBeGreaterThan(0)
    for (const m of exhaust) {
      expect(m.position[1] + m.dims[1] / 2).toBeLessThan(2.4 - ATTIC.topPlateBandM)
    }
  })
})

describe('hvac — concave rooms: the register drops INSIDE the room, off every wall band', () => {
  // Skeptic repro: an L-shaped room whose vertex-average "centroid" lands in
  // the notch (outside the polygon, kissing the reentrant walls) — the
  // register printed inside the wall, the boot bored the plate band.
  const L: [number, number][] = [[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]]
  const wallsL = [
    wall('w_s', [0, 0], [6, 0], true),
    wall('w_e', [6, 0], [6, 2], true),
    wall('w_nx', [6, 2], [2, 2], true),
    wall('w_nz', [2, 2], [2, 6], true),
    wall('w_n', [2, 6], [0, 6], true),
    wall('w_w', [0, 6], [0, 0], true),
  ]
  const roomsL = [room('r_l', 'Living', 'other', L)]

  const inPoly = (p: [number, number], poly: [number, number][]): boolean => {
    let inside = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i] as [number, number]
      const [xj, zj] = poly[j] as [number, number]
      if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) {
        inside = !inside
      }
    }
    return inside
  }

  test('register point is in the polygon and clear of every wall body', () => {
    const { members, fixtures } = layoutHvac(wallsL, roomsL)
    const reg = fixtures.find((f) => f.kind === 'register' && f.sourceId === 'r_l')
    expect(reg).toBeDefined()
    const p: [number, number] = [(reg as Fixture).position[0], (reg as Fixture).position[2]]
    expect(inPoly(p, L)).toBe(true)
    for (const w of wallsL) {
      const dx = p[0] - w.start[0]
      const dz = p[1] - w.start[1]
      const along = dx * w.dir[0] + dz * w.dir[1]
      if (along < -0.01 || along > w.length + 0.01) continue
      const off = Math.abs(-dx * w.dir[1] + dz * w.dir[0])
      // clear by the boot's half-section — the drop never grazes a wall
      expect(off).toBeGreaterThan(w.thickness / 2 + 0.076)
    }
    expect(plateViolations(members, wallsL)).toEqual([])
    expect(unreachableRegisters(members, fixtures)).toEqual([])
  })
})

describe('hvac — interior storeys route in soffits, never into the storey above (M1)', () => {
  const { walls, rooms } = plan()

  test('hasLevelAbove caps every duct below the storey ceiling and says so', () => {
    const out = layoutHvac(walls, rooms, DEFAULT_SPEC, undefined, { hasLevelAbove: true })
    const ducts = out.members.filter((m) => m.role === 'duct-run')
    expect(ducts.length).toBeGreaterThan(0)
    for (const m of ducts) {
      // top of every duct stays below this storey's ceiling plane
      expect(m.position[1] + m.dims[1] / 2).toBeLessThanOrEqual(2.5)
    }
    expect(plateViolations(out.members, walls)).toEqual([])
    expect(unreachableRegisters(out.members, out.fixtures)).toEqual([])
    expect(out.warnings).toContain('interior-storey ducts run in soffits/floor webs — verify')
  })

  test('top storeys keep the attic routing, warning-free', () => {
    const out = layoutHvac(walls, rooms)
    expect(out.warnings).toEqual([])
    const trunk = out.members.filter(
      (m) => m.role === 'duct-run' && m.dims[0] >= m.dims[1] && m.label?.startsWith('Trunk'),
    )
    expect(trunk.length).toBeGreaterThan(0)
    for (const m of trunk) {
      expect(m.position[1] - m.dims[1] / 2).toBeGreaterThan(2.5)
    }
  })
})
