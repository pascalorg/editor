import { describe, expect, it } from 'bun:test'
import type { Member } from '../core/types'
import { memberAxis, type RoofSegmentSlice } from './roof-framing'
import { clampUnderRoof, UNDER_ROOF_FLAG } from './under-roof'

/** A 4:12 gable, ridge along x, 10 m wide, 8 m deep, plates at 2.74. */
const gable: RoofSegmentSlice = {
  id: 'r1',
  roofType: 'gable',
  position: [0, 2.74, 0],
  yaw: 0,
  width: 10,
  depth: 8,
  pitch: Math.atan(4 / 12),
  overhang: 0.4,
  wallHeight: 0,
}
const PLATE = 2.74

function run(
  y: number,
  from: [number, number],
  to: [number, number],
  h = 0.02,
  label = 'Cold ½" — Lavatory (attic run)',
): Member {
  const dx = to[0] - from[0]
  const dz = to[1] - from[1]
  const length = Math.hypot(dx, dz)
  return {
    system: 'plumbing',
    role: 'pipe-run',
    dims: [length, h, h],
    length,
    position: [(from[0] + to[0]) / 2, y, (from[1] + to[1]) / 2],
    rotation: [0, Math.atan2(-dz, dx), 0],
    material: 'copper',
    sourceId: 'sup-1',
    label,
  }
}
function riser(x: number, z: number, y0: number, y1: number): Member {
  return {
    system: 'plumbing',
    role: 'pipe-run',
    dims: [0.02, y1 - y0, 0.02],
    length: y1 - y0,
    position: [x, (y0 + y1) / 2, z],
    rotation: [0, 0, 0],
    material: 'copper',
    sourceId: 'sup-1',
    label: 'Cold ½" — Lavatory (attic run — down the wall to the stub)',
  }
}
const topOf = (m: Member) => m.position[1] + m.dims[1] / 2
const undersideAt = (z: number) => PLATE + (4 - Math.abs(z)) * (4 / 12)

describe('clampUnderRoof', () => {
  it('leaves a run under the ridge alone', () => {
    const m = run(PLATE + 0.3, [-3, 0], [3, 0], 0.2)
    const r = clampUnderRoof([m], [gable], PLATE)
    expect(r.members).toEqual([m])
    expect(r.lowered).toBe(0)
  })

  it('slopes a run down toward the eave and keeps it under the rafters', () => {
    // a pipe across the slope at plate + 0.15: fine at the centre, into the rafters near z = ±3.9
    const m = run(PLATE + 0.15, [0, -3.9], [0, 3.9])
    const r = clampUnderRoof([m], [gable], PLATE)
    expect(r.lowered).toBe(1)
    expect(r.members.length).toBeGreaterThan(1)
    for (const p of r.members) {
      // every piece's top sits under the underside at both ends (with the gap)
      const ax = memberAxis(p)
      for (const s of [-1, 1]) {
        const z = p.position[2] + ax[2] * (p.length / 2) * s
        const y = p.position[1] + ax[1] * (p.length / 2) * s
        expect(y + p.dims[1] / 2).toBeLessThanOrEqual(undersideAt(z) + 1e-6)
        expect(y - p.dims[1] / 2).toBeGreaterThanOrEqual(PLATE - 1e-6)
      }
      expect(p.flag).toBeUndefined()
    }
    // the pieces chain: consecutive ends meet
    for (let i = 1; i < r.members.length; i++) {
      const a = r.members[i - 1] as Member
      const b = r.members[i] as Member
      const aa = memberAxis(a)
      const ba = memberAxis(b)
      const aEnd = [a.position[1] + (aa[1] * a.length) / 2, a.position[2] + (aa[2] * a.length) / 2]
      const bStart = [
        b.position[1] - (ba[1] * b.length) / 2,
        b.position[2] - (ba[2] * b.length) / 2,
      ]
      expect(aEnd[0]).toBeCloseTo(bStart[0] as number, 6)
      expect(aEnd[1]).toBeCloseTo(bStart[1] as number, 6)
    }
    expect(r.warnings[0]).toMatch(/lowered under the rafters/)
  })

  it('cuts a riser at the underside and flags a trunk that cannot fit', () => {
    const up = riser(0, 3.9, 0.5, PLATE + 0.15)
    const trunk = run(PLATE + 0.3, [-2, 3.9], [2, 3.9], 0.2, 'Trunk 14"×8"')
    const r = clampUnderRoof([up, trunk], [gable], PLATE)
    const cut = r.members[0] as Member
    expect(topOf(cut)).toBeLessThan(undersideAt(3.9))
    expect(topOf(cut)).toBeGreaterThan(PLATE)
    const kept = r.members[1] as Member
    expect(kept.position[1]).toBe(PLATE + 0.3)
    expect(kept.flag).toBe(UNDER_ROOF_FLAG)
    expect(r.clashing).toBe(1)
  })

  it('never touches what passes the roof by design', () => {
    const stack = {
      ...riser(0, 3.9, 0.5, PLATE + 1.2),
      label: '3" DWV stack — through roof (P3103.1)',
    }
    const r = clampUnderRoof([stack], [gable], PLATE)
    expect(r.members).toEqual([stack])
  })

  it('leaves runs off every roof alone', () => {
    const m = run(PLATE + 0.5, [20, 20], [22, 20])
    expect(clampUnderRoof([m], [gable], PLATE).members).toEqual([m])
  })
})
