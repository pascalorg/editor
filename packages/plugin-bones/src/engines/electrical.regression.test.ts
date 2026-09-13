/**
 * Adversarial verification for src/engines/electrical.ts and the
 * src/framing/compute.ts seam. Property tests + degenerate inputs.
 */
import { describe, expect, test } from 'bun:test'
import { Euler, Vector3 } from 'three'
import type { Fixture, OpeningSlice, RoomSlice, WallSlice } from '../core/types'
import { feet, inches } from '../core/units'
import { layoutElectrical, receptaclePositions, usableSegments } from './electrical'
import { computeLevel } from '../framing/compute'
import { FramingNode } from '../framing/schema'

const RO_PAD = inches(1.5)
const SIX_FT = feet(6)
const TWELVE_FT = feet(12)
const EPS = 1e-9

// Deterministic PRNG (mulberry32) so failures are reproducible.
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function wallOf(
  start: readonly [number, number],
  end: readonly [number, number],
  overrides: Partial<WallSlice> = {},
): WallSlice {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  return {
    id: 'w',
    start,
    end,
    length,
    dir: [dx / length, dz / length],
    thickness: 0.1,
    height: 2.5,
    exterior: false,
    openings: [],
    curved: false,
    ...overrides,
  }
}

function doorAt(u: number, width = 0.9, id = 'd'): OpeningSlice {
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

const receptaclesOf = (fx: Fixture[]) =>
  fx.filter((f) => f.kind === 'receptacle' || f.kind === 'receptacle-gfci')

const facing = (rotationY: number) => new Vector3(0, 0, 1).applyEuler(new Euler(0, rotationY, 0))

describe('(1) receptacle spacing property — random walls 0.5–15m', () => {
  test('every usable floor-line point within 6ft, pitch <= 12ft, none in door ROs', () => {
    const rand = rng(0xb0e5)
    for (let iter = 0; iter < 400; iter++) {
      const L = 0.5 + rand() * 14.5
      const psi = rand() * Math.PI * 2
      const start: [number, number] = [(rand() - 0.5) * 20, (rand() - 0.5) * 20]
      const dir: [number, number] = [Math.cos(psi), Math.sin(psi)]
      const end: [number, number] = [start[0] + dir[0] * L, start[1] + dir[1] * L]
      const nDoors = Math.floor(rand() * 3) // 0..2
      const openings: OpeningSlice[] = []
      for (let d = 0; d < nDoors; d++) {
        // deliberately allow doors near/over the wall ends
        openings.push(doorAt(-0.5 + rand() * (L + 1), 0.7 + rand() * 0.3, `d${d}`))
      }
      const wall = wallOf(start, end, { openings, id: `w${iter}` })
      const fixtures = layoutElectrical([wall], [])
      const receptacles = receptaclesOf(fixtures)

      // project every receptacle back to (u, v) in the wall frame
      const off = wall.thickness / 2 + inches(0.75)
      const projected = receptacles.map((r) => {
        const px = (r.position[0] ?? 0) - start[0]
        const pz = (r.position[2] ?? 0) - start[1]
        const u = px * dir[0] + pz * dir[1]
        const v = px * -dir[1] + pz * dir[0]
        // face offset must be exactly half thickness + box proud, on either side
        expect(Math.abs(Math.abs(v) - off)).toBeLessThan(1e-9)
        // device faces away from the wall (outward normal of its face)
        const f = facing(r.rotationY)
        const side = Math.sign(v)
        expect(f.x).toBeCloseTo(-dir[1] * side, 9)
        expect(f.z).toBeCloseTo(dir[0] * side, 9)
        expect(Math.abs(f.y)).toBeLessThan(1e-12)
        return { u, side }
      })

      // no receptacle inside a door rough opening
      for (const { u } of projected) {
        for (const o of openings) {
          const a = o.u - o.roughWidth / 2
          const b = o.u + o.roughWidth / 2
          expect(u <= a + EPS || u >= b - EPS).toBe(true)
        }
      }

      // NEC walk per usable segment, per face
      const segments = usableSegments(wall)
      for (const side of [1, -1]) {
        for (const seg of segments) {
          const us = projected
            .filter((p) => p.side === side && p.u > seg.a - EPS && p.u < seg.b + EPS)
            .map((p) => p.u)
            .sort((a, b) => a - b)
          expect(us.length).toBeGreaterThan(0)
          expect((us[0] ?? 0) - seg.a).toBeLessThanOrEqual(SIX_FT + 1e-9)
          expect(seg.b - (us[us.length - 1] ?? 0)).toBeLessThanOrEqual(SIX_FT + 1e-9)
          for (let i = 1; i < us.length; i++) {
            expect((us[i] ?? 0) - (us[i - 1] ?? 0)).toBeLessThanOrEqual(TWELVE_FT + 1e-9)
          }
        }
      }

      // conversely: every receptacle lies inside SOME usable segment
      for (const { u } of projected) {
        expect(segments.some((s) => u > s.a - EPS && u < s.b + EPS)).toBe(true)
      }
    }
  })

  test('receptaclePositions direct property', () => {
    const rand = rng(0xcafe)
    for (let i = 0; i < 500; i++) {
      const a = (rand() - 0.5) * 10
      const L = feet(2) + rand() * 14
      const us = receptaclePositions({ a, b: a + L })
      expect(us.length).toBeGreaterThan(0)
      expect((us[0] ?? 0) - a).toBeLessThanOrEqual(SIX_FT + 1e-9)
      expect(a + L - (us[us.length - 1] ?? 0)).toBeLessThanOrEqual(SIX_FT + 1e-9)
      for (let j = 1; j < us.length; j++) {
        expect((us[j] ?? 0) - (us[j - 1] ?? 0)).toBeLessThanOrEqual(TWELVE_FT + 1e-9)
      }
    }
  })
})

describe('(2) exterior face resolution on a rotated wall, room on the -normal side', () => {
  test('diagonal wall: devices land on the -normal face and face -normal', () => {
    // wall (0,0) → (4,3): dir (0.8, 0.6); +normal = (-0.6, 0.8); room on -normal side
    const wall = wallOf([0, 0], [4, 3], { exterior: true })
    const room: RoomSlice = {
      id: 'r',
      name: 'living',
      category: 'other',
      // rectangle strictly on the (0.6, -0.8) side of the wall line
      polygon: [
        [0, 0],
        [4, 3],
        [4 + 0.6 * 3, 3 - 0.8 * 3],
        [0.6 * 3, -0.8 * 3],
      ],
      boundaryWallIds: [],
      ceilingHeight: 2.7,
    }
    const receptacles = receptaclesOf(layoutElectrical([wall], [room]))
    expect(receptacles.length).toBeGreaterThan(0)
    const off = wall.thickness / 2 + inches(0.75)
    for (const r of receptacles) {
      const px = r.position[0] ?? 0
      const pz = r.position[2] ?? 0
      const u = px * 0.8 + pz * 0.6
      const v = px * -0.6 + pz * 0.8
      expect(v).toBeCloseTo(-off, 9) // -normal side (into the room)
      expect(u).toBeGreaterThan(0)
      expect(u).toBeLessThan(5)
      const f = facing(r.rotationY)
      expect(f.x).toBeCloseTo(0.6, 9)
      expect(f.z).toBeCloseTo(-0.8, 9)
    }
  })
})

describe('(3) switch flip at wall ends', () => {
  const halfRo = (0.9 + RO_PAD) / 2

  test('door near the end flips the switch inside the wall', () => {
    const wall = wallOf([0, 0], [4, 0], { openings: [doorAt(3.7)] })
    const switches = layoutElectrical([wall], []).filter((f) => f.kind === 'switch')
    expect(switches.length).toBe(2)
    for (const s of switches) {
      const u = s.position[0] ?? 0
      expect(u).toBeCloseTo(3.7 - halfRo - inches(8), 9)
      expect(u).toBeGreaterThanOrEqual(inches(1))
      expect(u).toBeLessThanOrEqual(4 - inches(1))
    }
  })

  test('door consuming the whole wall → no switch, no crash', () => {
    const wall = wallOf([0, 0], [1.1, 0], { openings: [doorAt(0.55)] })
    const switches = layoutElectrical([wall], []).filter((f) => f.kind === 'switch')
    expect(switches.length).toBe(0)
  })

  test('degenerate: door center beyond the wall end must not place a floating switch', () => {
    // door u = 5 on a 4 m wall (corrupt/drag-in-progress scene data):
    // +u side fails the end check, the flip lands at u ≈ 4.33 — BEYOND the wall.
    const wall = wallOf([0, 0], [4, 0], { openings: [doorAt(5)] })
    const switches = layoutElectrical([wall], []).filter((f) => f.kind === 'switch')
    for (const s of switches) {
      const u = s.position[0] ?? 0
      expect(u).toBeGreaterThanOrEqual(0)
      expect(u).toBeLessThanOrEqual(4)
    }
  })
})

describe('(4) degenerate inputs', () => {
  test('empty walls + empty rooms → empty, no crash', () => {
    expect(layoutElectrical([], [])).toEqual([])
  })

  test('rooms only → lights (and alarms) but no receptacles/panel', () => {
    const bath: RoomSlice = {
      id: 'b',
      name: 'bath',
      category: 'bathroom',
      polygon: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
      boundaryWallIds: [],
      ceilingHeight: 2.4,
    }
    const fx = layoutElectrical([], [bath])
    expect(receptaclesOf(fx).length).toBe(0)
    expect(fx.filter((f) => f.kind === 'panel').length).toBe(0)
    expect(fx.filter((f) => f.kind === 'light').length).toBe(1)
  })

  test('wall shorter than 2 ft → no receptacles (210.52(A)(2)(1)), still no crash', () => {
    const wall = wallOf([0, 0], [0.5, 0])
    const fx = layoutElectrical([wall], [])
    expect(receptaclesOf(fx).length).toBe(0)
    // exactly 2 ft is required
    const wall2 = wallOf([0, 0], [feet(2), 0])
    expect(receptaclesOf(layoutElectrical([wall2], [])).length).toBe(2) // one per face
  })
})

// ---------------- compute.ts seam ----------------

function makeConfig(overrides: Record<string, unknown> = {}, parentId = 'level_1') {
  const config = FramingNode.parse({ jurisdiction: 'INTL', ...overrides })
  return { ...config, parentId: parentId as FramingNode['parentId'] }
}

const bathZone = {
  id: 'zone_bath',
  type: 'zone',
  parentId: 'level_1',
  name: 'Bathroom',
  polygon: [
    [0, 0],
    [3, 0],
    [3, 3],
    [0, 3],
  ],
  boundaryWallIds: ['wall_wet'],
  ceilingHeight: 2.4,
}

function seamScene(): Record<string, Record<string, unknown>> {
  return {
    level_1: { id: 'level_1', type: 'level', level: 0, height: 2.7 },
    wall_wet: {
      id: 'wall_wet',
      type: 'wall',
      parentId: 'level_1',
      start: [0, 0],
      end: [3, 0],
      thickness: 0.1,
      height: 2.5,
      children: [],
    },
    wall_other: {
      id: 'wall_other',
      type: 'wall',
      parentId: 'level_1',
      start: [0, 3],
      end: [3, 3],
      thickness: 0.1,
      height: 2.5,
      children: [],
    },
    zone_bath: bathZone,
  }
}

describe('(5) computeLevel routing on odd configs', () => {
  test('rooms present but showElectrical false → zero electrical fixtures', () => {
    const result = computeLevel(seamScene(), makeConfig({ showElectrical: false }))
    expect(result.fixtures.filter((f) => f.system === 'electrical').length).toBe(0)
  })

  test('plumbing on with zero walls → no crash, no plumbing output', () => {
    const scene = seamScene()
    delete scene.wall_wet
    delete scene.wall_other
    const result = computeLevel(scene, makeConfig({ showPlumbing: true }))
    expect(result.members.filter((m) => m.system === 'plumbing').length).toBe(0)
    expect(result.fixtures.filter((f) => f.system === 'plumbing').length).toBe(0)
  })

  test('framing node parented to a BUILDING → empty result, no crash', () => {
    const scene: Record<string, Record<string, unknown>> = {
      building_1: { id: 'building_1', type: 'building' },
      ...seamScene(),
    }
    ;(scene.level_1 as Record<string, unknown>).parentId = 'building_1'
    const result = computeLevel(
      scene,
      makeConfig({ showElectrical: true, showPlumbing: true }, 'building_1'),
    )
    expect(result.members.length).toBe(0)
    expect(result.fixtures.length).toBe(0)
  })
})

describe("(6) 'skip' override vs plumbing wet wall", () => {
  test('skipping the bathroom boundary wall: no crash; document the fallback', () => {
    const result = computeLevel(
      seamScene(),
      makeConfig({ showPlumbing: true, wallOverrides: { wall_wet: 'skip' } }),
    )
    const plumbingFixtures = result.fixtures.filter((f) => f.system === 'plumbing')
    const plumbingMembers = result.members.filter((m) => m.system === 'plumbing')
    // Sane fallback: the stack re-anchors on the remaining active wall rather
    // than silently deleting ALL plumbing for the level.
    expect(plumbingMembers.some((m) => m.role === 'vent-stack')).toBe(true)
    expect(plumbingFixtures.length).toBeGreaterThan(0)
    // and nothing plumbing-related may reference the skipped wall
    expect(plumbingMembers.every((m) => m.sourceId !== 'wall_wet')).toBe(true)
  })

  test('control: without the skip, plumbing anchors on the wet wall side', () => {
    const result = computeLevel(seamScene(), makeConfig({ showPlumbing: true }))
    expect(result.members.some((m) => m.system === 'plumbing' && m.role === 'vent-stack')).toBe(
      true,
    )
  })
})
