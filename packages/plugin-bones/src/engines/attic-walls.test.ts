/**
 * Attic separation walls (W17): the dwelling–garage separation carried to
 * the roof deck — a flat plate over the ceiling joists, studs up to the roof
 * underside, none through the roof's own members, none where a stud would
 * be a block.
 */
import { describe, expect, test } from 'bun:test'
import { DEFAULT_SPEC } from '../core/spec'
import type { Member, WallSlice } from '../core/types'
import { frameAtticSeparations, onGableEnd, roofUndersideAt } from './attic-walls'
import { frameRoofs, type RoofSegmentSlice } from './roof-framing'

const IN = 0.0254
const T = 1.5 * IN

function seg(overrides: Partial<RoofSegmentSlice> = {}): RoofSegmentSlice {
  return {
    id: 'roofseg_test',
    roofType: 'gable',
    position: [0, 2.5, 0],
    yaw: 0,
    width: 8,
    depth: 6,
    pitch: (40 * Math.PI) / 180,
    overhang: 0.3,
    wallHeight: 0.5,
    ...overrides,
  }
}

function wallSlice(
  id: string,
  start: [number, number],
  end: [number, number],
  over: Partial<WallSlice> = {},
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
    height: 3.0, // the plate line of the 8 × 6 gable seated at y 2.5 + 0.5
    exterior: false,
    curved: false,
    openings: [],
    ...over,
  }
}

const byRole = (ms: Member[], role: string) => ms.filter((m) => m.role === role)

describe('W17: attic separation walls', () => {
  const roof = seg()
  const roofMembers = frameRoofs([roof], [], DEFAULT_SPEC)
  const joistTop = Math.max(
    ...byRole(roofMembers, 'ceiling-joist').map((m) => m.position[1] + m.dims[1] / 2),
  )
  // a separation wall running ACROSS the ridge (along z) at x = 1
  const across = wallSlice('sep_z', [1, -3], [1, 3])

  test('roofUndersideAt reads the gable plane inside the footprint, null off it', () => {
    expect(roofUndersideAt([roof], 1, 0)).toBeCloseTo(3.0 + 3 * Math.tan(roof.pitch), 9)
    expect(roofUndersideAt([roof], 1, 3)).toBeCloseTo(3.0, 9)
    expect(roofUndersideAt([roof], 5, 0)).toBeNull()
  })

  test('a plate on the joists, studs at 16" from it up to the roof underside, none through the ridge, none at the eaves', () => {
    const { members, warnings } = frameAtticSeparations([across], [roof], roofMembers, DEFAULT_SPEC)
    const studs = byRole(members, 'stud')
    const plates = byRole(members, 'bottom-plate')
    expect(plates).toHaveLength(1)
    expect(studs.length).toBeGreaterThan(6)
    const plate = plates[0] as Member
    expect(plate.position[1] - plate.dims[1] / 2).toBeCloseTo(joistTop, 9) // flat on the joists
    expect(plate.dims[1]).toBeCloseTo(T, 9)
    expect(plate.label).toContain('R302.6')
    const plateTop = joistTop + T
    for (const s of studs) {
      expect(s.system).toBe('wall-framing')
      expect(s.sourceId).toBe('sep_z')
      expect(s.size).toBe('2x4') // interior partition stock
      expect(Math.abs(s.position[0] - 1)).toBeLessThan(1e-9) // on the wall line
      expect(s.position[1] - s.dims[1] / 2).toBeCloseTo(plateTop, 9)
      // the top a hair under the lowest plane height over the stud's plan
      // rectangle — this wall runs along z, so its ±t/2 faces along z govern
      const z = s.position[2]
      const under = Math.min(
        roofUndersideAt([roof], 1, z - T / 2) as number,
        roofUndersideAt([roof], 1, z + T / 2) as number,
      )
      expect(s.position[1] + s.dims[1] / 2).toBeCloseTo(under - 0.005, 9)
      expect(s.dims[1]).toBeGreaterThanOrEqual(0.15)
      expect(s.label).toContain('R302.6')
    }
    // stations march at the stud spacing from the wall start
    const zs = studs.map((s) => s.position[2]).sort((a, b) => a - b)
    for (let i = 1; i < zs.length; i++) {
      const gap = (zs[i] as number) - (zs[i - 1] as number)
      expect(
        Math.abs(gap / DEFAULT_SPEC.studSpacing - Math.round(gap / DEFAULT_SPEC.studSpacing)),
      ).toBeLessThan(1e-6)
    }
    // none where the plane meets the plate; a station under the ridge fits
    // only if its top clears the ridge board's bottom
    const ridge = roofMembers.find(
      (m) => m.role === 'ridge' && !m.label?.startsWith('Purlin'),
    ) as Member
    for (const s of studs) {
      expect(Math.abs(s.position[2])).toBeLessThan(3 - 0.15 / Math.tan(roof.pitch))
      if (Math.abs(s.position[2]) < ridge.dims[2] / 2 + T / 2) {
        expect(s.position[1] + s.dims[1] / 2).toBeLessThanOrEqual(
          ridge.position[1] - ridge.dims[1] / 2 + 1e-9,
        )
      }
    }
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('carried above the ceiling to the roof deck')
    expect(warnings[0]).toContain(`${studs.length} studs`)
  })

  test('a wall along the ridge line: studs up to the ridge board, tops under it, none on the gable studs', () => {
    const under = wallSlice('sep_ridge', [-4, 0], [4, 0])
    const { members } = frameAtticSeparations([under], [roof], roofMembers, DEFAULT_SPEC)
    const studs = byRole(members, 'stud')
    expect(studs.length).toBeGreaterThan(4)
    const ridge = roofMembers.find(
      (m) => m.role === 'ridge' && !m.label?.startsWith('Purlin'),
    ) as Member
    const ridgeBottom = ridge.position[1] - ridge.dims[1] / 2
    const gableStuds = roofMembers.filter((m) => m.role === 'stud')
    expect(gableStuds.length).toBeGreaterThan(0)
    for (const s of studs) {
      expect(s.position[1] + s.dims[1] / 2).toBeLessThanOrEqual(ridgeBottom + 1e-9)
      // never on a gable-end stud's plan footprint
      for (const g of gableStuds) {
        const d = Math.hypot(g.position[0] - s.position[0], g.position[2] - s.position[2])
        expect(d).toBeGreaterThan(
          Math.max(g.dims[0], g.dims[2]) / 2 + Math.max(s.dims[0], s.dims[2]) / 2 - 1e-9,
        )
      }
    }
  })

  test('a separation on the gable end line is the gable-end infill — nothing added, the gypsum said', () => {
    // the generator's garage hangs off the main's gable end: the separation
    // walls run along x = ±4 of this 8 × 6 gable, where the roof engine
    // already frames gable studs from the plate to the rafters
    const onEnd = wallSlice('sep_end', [4, -2], [4, 1])
    expect(onGableEnd(onEnd, [roof])).toBe(true)
    expect(onGableEnd(across, [roof])).toBe(false)
    // a wall along the end line of a HIP is not a gable end (no infill there):
    // the hip's end plane meets the plate — no attic over that wall, and the
    // engine says so instead of framing nothing silently
    const hip = seg({ id: 'hip', roofType: 'hip' })
    expect(onGableEnd(onEnd, [hip])).toBe(false)
    const hipMembers = frameRoofs([hip], [], DEFAULT_SPEC)
    const hipEnd = frameAtticSeparations(
      [wallSlice('sep_hipend', [3.9, -2], [3.9, 2])],
      [hip],
      hipMembers,
      DEFAULT_SPEC,
    )
    expect(hipEnd.members).toHaveLength(0)
    expect(hipEnd.warnings[0]).toContain(
      'the roof meets the plate along 1 dwelling–garage separation wall',
    )
    const { members, warnings } = frameAtticSeparations([onEnd], [roof], roofMembers, DEFAULT_SPEC)
    expect(members).toHaveLength(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('lies on a gable end')
    expect(warnings[0]).toContain('gable-end studs above the plate are that separation')
  })

  test('a wall outside every roof, a curved wall, or no roof at all frame nothing', () => {
    const outside = wallSlice('sep_out', [6, -1], [6, 1])
    expect(
      frameAtticSeparations([outside], [roof], roofMembers, DEFAULT_SPEC).members,
    ).toHaveLength(0)
    const curved = wallSlice('sep_c', [1, -3], [1, 3], { curved: true })
    expect(frameAtticSeparations([curved], [roof], roofMembers, DEFAULT_SPEC).members).toHaveLength(
      0,
    )
    expect(frameAtticSeparations([across], [], roofMembers, DEFAULT_SPEC).members).toHaveLength(0)
  })

  test('a wall along the ridge axis off the ridge line: studs follow one plane height, purlin stations left open', () => {
    // 10 × 12 gable (purlin fix): a wall along x at z = 3 crosses the purlin
    // line (z = ±run/2 = ±3) — every station is blocked by the purlin
    const big = seg({ width: 10, depth: 12 })
    const bigMembers = frameRoofs([big], [], DEFAULT_SPEC)
    expect(bigMembers.some((m) => m.label?.startsWith('Purlin'))).toBe(true)
    const onPurlin = wallSlice('sep_p', [-5, 3], [5, 3])
    expect(frameAtticSeparations([onPurlin], [big], bigMembers, DEFAULT_SPEC).members).toHaveLength(
      0,
    )
    // …while a wall at z = 1.5 frames a level row of studs (one plane height)
    const clear = wallSlice('sep_clear', [-5, 1.5], [5, 1.5])
    const { members } = frameAtticSeparations([clear], [big], bigMembers, DEFAULT_SPEC)
    const studs = byRole(members, 'stud')
    expect(studs.length).toBeGreaterThan(10)
    const heights = new Set(studs.map((s) => Math.round(s.dims[1] * 1e6)))
    expect(heights.size).toBe(1)
  })
})
