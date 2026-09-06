/**
 * The seating contract (2026-09-05): a roof segment's origin is the top of the
 * plate and `wallHeight` is 0 — the eave line IS the plate. Every sloped
 * member bears with its BOTTOM face on that plane at the wall line (the rafter
 * sits on the plate, seat cut implied), plate-bound members stay on the plate,
 * and the wall above the plate under a gable, a shed's high side and its
 * raking sides is framed with studs standing on the plate. These tests state
 * the geometry directly; the byte pins in roof-framing.test.ts only say it did
 * not drift.
 */
import { describe, expect, test } from 'bun:test'
import { Euler, Vector3 } from 'three'
import { DEFAULT_SPEC } from '../core/spec'
import type { Member } from '../core/types'
import { LUMBER_CROSS_SECTIONS } from '../lumber'
import { frameRoofs, HURRICANE_TIE_LABEL, type RoofSegmentSlice } from './roof-framing'

const PLATE = 2.7432 // a 9 ft storey: the roof origin sits on its plate
const PITCH = Math.atan(6 / 12)

const seg = (over: Partial<RoofSegmentSlice> = {}): RoofSegmentSlice => ({
  id: 'rseg_seat',
  roofType: 'gable',
  position: [0, PLATE, 0],
  yaw: 0,
  width: 8,
  depth: 6,
  pitch: PITCH,
  overhang: 0.35,
  wallHeight: 0,
  wallThickness: 0.17,
  ...over,
})

const byRole = (members: Member[], role: string) => members.filter((m) => m.role === role)
const euler = (m: Member) => new Euler(m.rotation[0], m.rotation[1], m.rotation[2], 'XYZ')
const axisOf = (m: Member) => new Vector3(1, 0, 0).applyEuler(euler(m))
const upOf = (m: Member) => new Vector3(0, 1, 0).applyEuler(euler(m))

/** Height of a sloped member's BOTTOM face where its plan line crosses `plan` on `axis` (x or z). */
function bottomFaceYAt(m: Member, axis: 'x' | 'z', plan: number): number {
  const a = axisOf(m)
  const c = new Vector3(...m.position).sub(upOf(m).multiplyScalar(m.dims[1] / 2))
  const along = axis === 'x' ? a.x : a.z
  const from = axis === 'x' ? c.x : c.z
  const s = (plan - from) / along
  return c.y + a.y * s
}

describe('seating: sloped members bear bottom-on-plate at the wall line', () => {
  test('gable commons: the bottom face meets the plate at |z| = run on both slopes', () => {
    const roof = seg()
    const rafters = byRole(frameRoofs([roof], [], DEFAULT_SPEC), 'rafter').filter(
      (r) => !r.label?.includes('Barge'),
    )
    expect(rafters.length).toBeGreaterThan(4)
    for (const r of rafters) {
      const side = (r.position[2] as number) > 0 ? 1 : -1
      // dropped gable-end rafters carry the outlooker ladder one 2x4 lower
      const [olT] = LUMBER_CROSS_SECTIONS['2x4']
      const atEnd = Math.abs(Math.abs(r.position[0] as number) - (roof.width / 2 - inchesT())) < 1e-6
      const drop = atEnd ? olT / Math.cos(PITCH) : 0
      expect(bottomFaceYAt(r, 'z', side * (roof.depth / 2))).toBeCloseTo(PLATE - drop, 6)
    }
  })

  test('shed: the bottom face meets the plate at the low eave and the pediment top at the high edge', () => {
    const roof = seg({ roofType: 'shed' })
    const rafters = byRole(frameRoofs([roof], [], DEFAULT_SPEC), 'rafter')
    expect(rafters.length).toBeGreaterThan(4)
    for (const r of rafters) {
      expect(bottomFaceYAt(r, 'z', roof.depth / 2)).toBeCloseTo(PLATE, 6)
      expect(bottomFaceYAt(r, 'z', -roof.depth / 2)).toBeCloseTo(PLATE + roof.depth * Math.tan(PITCH), 6)
    }
  })

  test('hip commons and hips: bottom faces meet the plate at the eave line and the corner', () => {
    const roof = seg({ roofType: 'hip' })
    const members = frameRoofs([roof], [], DEFAULT_SPEC)
    const commons = byRole(members, 'rafter').filter((r) => r.label?.includes('hip common'))
    expect(commons.length).toBeGreaterThan(2)
    for (const r of commons) {
      const side = (r.position[2] as number) > 0 ? 1 : -1
      expect(bottomFaceYAt(r, 'z', side * (roof.depth / 2))).toBeCloseTo(PLATE, 6)
    }
    const hips = byRole(members, 'hip')
    expect(hips).toHaveLength(4)
    for (const h of hips) {
      const sx = (h.position[0] as number) > 0 ? 1 : -1
      // the hip's plan line reaches the footprint corner (±width/2, ±depth/2)
      expect(bottomFaceYAt(h, 'x', sx * (roof.width / 2))).toBeCloseTo(PLATE, 6)
    }
  })

  test('ridge top rides the rafter tops; ceiling joists and hurricane ties stay on the plate', () => {
    const roof = seg()
    const spec = { ...DEFAULT_SPEC, hurricaneTies: true, highWindUplift: true }
    const members = frameRoofs([roof], [], spec)
    const [, rd] = LUMBER_CROSS_SECTIONS[spec.rafterSize]
    const ridge = byRole(members, 'ridge')[0] as Member
    const rise = (roof.depth / 2) * Math.tan(PITCH)
    // rafter top plane apex = plate + plumb depth + rise
    expect((ridge.position[1] as number) + ridge.dims[1] / 2).toBeCloseTo(PLATE + rd / Math.cos(PITCH) + rise, 6)
    const [, cjD] = LUMBER_CROSS_SECTIONS[spec.ceilingJoistSize]
    for (const cj of byRole(members, 'ceiling-joist')) {
      expect((cj.position[1] as number) - cjD / 2).toBeCloseTo(PLATE, 8)
    }
    const ties = members.filter((m) => m.label?.startsWith('hurricane tie'))
    expect(ties.length).toBeGreaterThan(0)
    for (const tie of ties) {
      expect(tie.position[1]).toBeCloseTo(PLATE, 9)
      expect(tie.label).toBe(HURRICANE_TIE_LABEL)
    }
    expect(HURRICANE_TIE_LABEL).toContain('H2.5A')
  })
})

describe('seating: the wall above the plate is framed', () => {
  const studsOf = (members: Member[], what: string) =>
    byRole(members, 'stud').filter((m) => m.label?.startsWith(what))

  test('gable ends: studs at the wall module stand on the plate and stop under the end rafter', () => {
    const roof = seg()
    const spec = { ...DEFAULT_SPEC, detail: '400' as const }
    const members = frameRoofs([roof], [], spec)
    const studs = studsOf(members, 'Gable stud')
    expect(studs.length).toBeGreaterThan(8)
    const [olT] = LUMBER_CROSS_SECTIONS['2x4']
    const run = roof.depth / 2
    for (const s of studs) {
      expect(Math.abs(s.position[0] as number)).toBeCloseTo(roof.width / 2, 9) // in the wall line
      expect((s.position[1] as number) - s.dims[1] / 2).toBeCloseTo(PLATE, 8) // on the plate (positions are nanometre-rounded)
      // top under the dropped end rafter's underside (plumb-cut box inscribed)
      const z = s.position[2] as number
      const underside = PLATE + (run - Math.abs(z)) * Math.tan(PITCH) - olT / Math.cos(PITCH)
      const top = (s.position[1] as number) + s.dims[1] / 2
      expect(top).toBeLessThanOrEqual(underside + 1e-9)
      expect(underside - top).toBeLessThan(0.02)
      expect(s.dims[2]).toBeLessThanOrEqual(roof.wallThickness ?? 1) // fitted to the wall
      expect(s.size).toBe(spec.exteriorStudSize)
    }
  })

  test('shed: pediment studs across the high wall and rake studs up both sides', () => {
    const roof = seg({ roofType: 'shed' })
    const members = frameRoofs([roof], [], DEFAULT_SPEC)
    const pediment = studsOf(members, 'Pediment stud')
    const rake = studsOf(members, 'Rake stud')
    expect(pediment.length).toBeGreaterThan(8)
    expect(rake.length).toBeGreaterThan(8)
    for (const s of pediment) {
      expect(s.position[2]).toBeCloseTo(-roof.depth / 2, 9)
      expect(s.dims[1]).toBeCloseTo(roof.depth * Math.tan(PITCH), 6)
    }
    for (const s of rake) {
      expect(Math.abs(s.position[0] as number)).toBeCloseTo(roof.width / 2, 9)
      const z = s.position[2] as number
      expect(s.dims[1]).toBeCloseTo((roof.depth / 2 - z) * Math.tan(PITCH) - (s.dims[0] / 2) * Math.tan(PITCH), 6)
    }
  })

  test('a pediment past the bearing stud table says so', () => {
    // 8 m deep at 6:12 rises 4 m — past the Table R602.3(5) 10 ft bearing height
    const roof = seg({ roofType: 'shed', depth: 8 })
    const flagged = studsOf(frameRoofs([roof], [], DEFAULT_SPEC), 'Pediment stud').filter((s) => s.flag)
    expect(flagged.length).toBeGreaterThan(0)
    expect(flagged[0]?.flag).toContain('R602.3(5)')
  })

  test('a knee wall is still honoured: wallHeight lifts the whole roof, studs still stand on its plate', () => {
    const knee = 0.5
    const members = frameRoofs([seg({ wallHeight: knee })], [], DEFAULT_SPEC)
    for (const s of studsOf(members, 'Gable stud')) {
      expect((s.position[1] as number) - s.dims[1] / 2).toBeCloseTo(PLATE + knee, 8)
    }
  })
})

function inchesT(): number {
  return LUMBER_CROSS_SECTIONS[DEFAULT_SPEC.rafterSize][0] / 2
}
