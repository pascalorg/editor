/**
 * Adversarial verification of roof-framing.ts — endpoint reconstruction.
 * Endpoints = position ± axis·length/2 where axis = Euler[0,ψ,θ]·(1,0,0)
 * (three.js 'XYZ': Rz(θ) then Ry(ψ)).
 */
import { describe, expect, test } from 'bun:test'
import { Euler, Vector3 } from 'three'
import { DEFAULT_SPEC } from '../core/spec'
import type { Member } from '../core/types'
import { extractRoofs, frameRoofs, type RoofSegmentSlice } from './roof-framing'

function axisOf(m: Member): Vector3 {
  const [rx, ry, rz] = m.rotation
  return new Vector3(1, 0, 0).applyEuler(new Euler(rx, ry, rz, 'XYZ'))
}

function endpoints(m: Member): [Vector3, Vector3] {
  const a = axisOf(m).multiplyScalar(m.length / 2)
  const p = new Vector3(...m.position)
  return [p.clone().add(a), p.clone().sub(a)]
}

function seg(overrides: Partial<RoofSegmentSlice> = {}): RoofSegmentSlice {
  return {
    id: 'roofseg_v',
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

describe('verify: gable rafter endpoints land on the tail cut and the ridge face', () => {
  const roof = seg()
  const theta = roof.pitch
  const run = roof.depth / 2
  const baseY = roof.position[1] + roof.wallHeight
  const ridgeY = baseY + run * Math.tan(theta)
  const tipY = baseY - roof.overhang * Math.sin(theta)
  const tipZ = run + roof.overhang * Math.cos(theta)
  // 2x6 rafters bear on the 2x8 ridge FACE (half thickness off center) and
  // the box is inscribed between its plumb cuts: each end pulls back
  // (rd/2)·tanθ along the slope (round-10 interpenetration fixes).
  const rt = 1.5 * 0.0254
  const rd = 5.5 * 0.0254
  const inset = (rd / 2) * Math.tan(theta)
  const faceZ = rt / 2
  const faceY = ridgeY - faceZ * Math.tan(theta)
  const members = frameRoofs([roof], [], DEFAULT_SPEC)
  const rafters = members.filter(
    (m) => m.role === 'rafter' && !m.label?.includes('Barge'),
  )

  test('every common on both slopes spans tail cut → ridge face, inscribed', () => {
    expect(rafters.length).toBeGreaterThan(0)
    // the two dropped gable-end rafters sit one outlooker thickness lower
    const olT = 1.5 * 0.0254
    const xs = rafters.map((r) => r.position[0])
    const xMax = Math.max(...xs.map(Math.abs))
    for (const r of rafters) {
      const dropped = Math.abs(Math.abs(r.position[0]) - xMax) < 1e-9
      const drop = dropped ? olT / Math.cos(theta) : 0
      const [e1, e2] = endpoints(r)
      const ridgeEnd = e1.y > e2.y ? e1 : e2
      const tipEnd = e1.y > e2.y ? e2 : e1
      expect(ridgeEnd.y).toBeCloseTo(faceY - inset * Math.sin(theta) - drop, 6)
      expect(Math.abs(ridgeEnd.z)).toBeCloseTo(faceZ + inset * Math.cos(theta), 6)
      expect(tipEnd.y).toBeCloseTo(tipY + inset * Math.sin(theta) - drop, 6)
      expect(Math.abs(tipEnd.z)).toBeCloseTo(tipZ - inset * Math.cos(theta), 6)
    }
  })
})

describe('verify: hip geometry (alongX = width >= depth)', () => {
  const roof = seg({ roofType: 'hip' }) // 8 × 6 → run 3, ridgeHalf 1
  const theta = roof.pitch
  const run = 3
  const baseY = roof.position[1] + roof.wallHeight
  const ridgeY = baseY + run * Math.tan(theta)
  const members = frameRoofs([roof], [], DEFAULT_SPEC)
  const hips = members.filter((m) => m.role === 'hip')

  test('hip endpoints: corner exact, top pulled clear of the ridge body', () => {
    expect(hips).toHaveLength(4)
    // The top cut bears on the ridge END: pulled down-slope by
    // √2·(ridgeT/2 + hipT/2) + (rd/2)·tan(hipTilt) (round-10 gate).
    const t = 1.5 * 0.0254
    const rd = 5.5 * 0.0254
    const rt = 1.5 * 0.0254
    const hipTilt = Math.atan2(run * Math.tan(theta), run * Math.SQRT2)
    const hipInset = Math.SQRT2 * (rt / 2 + t / 2) + (rd / 2) * Math.tan(hipTilt)
    const planPull = (hipInset * Math.cos(hipTilt)) / Math.SQRT2 // per plan axis
    const cornersSeen = new Set<string>()
    for (const h of hips) {
      const [e1, e2] = endpoints(h)
      const top = e1.y > e2.y ? e1 : e2
      const bot = e1.y > e2.y ? e2 : e1
      // top slid down the 45° diagonal from the ridge end (±1, ridgeY, 0)
      expect(top.y).toBeCloseTo(ridgeY - hipInset * Math.sin(hipTilt), 6)
      expect(Math.abs(top.x)).toBeCloseTo(1 + planPull, 6)
      expect(Math.abs(top.z)).toBeCloseTo(planPull, 6)
      // bottom still lands exactly on its corner (±4, eaveY, ±3)
      expect(bot.y).toBeCloseTo(baseY, 6)
      expect(Math.abs(bot.x)).toBeCloseTo(4, 6)
      expect(Math.abs(bot.z)).toBeCloseTo(3, 6)
      cornersSeen.add(`${Math.sign(bot.x)},${Math.sign(bot.z)}`)
    }
    expect(cornersSeen.size).toBe(4)
  })
})

describe('verify: hip with width < depth (alongX=false branch)', () => {
  const roof = seg({ roofType: 'hip', width: 6, depth: 8 }) // run 3, ridge along Z, ridgeHalf 1
  const theta = roof.pitch
  const run = 3
  const baseY = roof.position[1] + roof.wallHeight
  const ridgeY = baseY + run * Math.tan(theta)
  const tipY = baseY - roof.overhang * Math.sin(theta)
  const tipX = run + roof.overhang * Math.cos(theta)
  const members = frameRoofs([roof], [], DEFAULT_SPEC)

  test('ridge runs along Z at the peak', () => {
    const ridge = members.find((m) => m.role === 'ridge') as Member
    expect(ridge.length).toBeCloseTo(2, 6)
    const a = axisOf(ridge)
    expect(Math.abs(a.z)).toBeCloseTo(1, 6)
  })

  test('hip endpoints: corners exact, tops pulled clear of the ridge (on Z)', () => {
    const hips = members.filter((m) => m.role === 'hip')
    expect(hips).toHaveLength(4)
    const t = 1.5 * 0.0254
    const rd = 5.5 * 0.0254
    const rt = 1.5 * 0.0254
    const hipTilt = Math.atan2(run * Math.tan(theta), run * Math.SQRT2)
    const hipInset = Math.SQRT2 * (rt / 2 + t / 2) + (rd / 2) * Math.tan(hipTilt)
    const planPull = (hipInset * Math.cos(hipTilt)) / Math.SQRT2
    for (const h of hips) {
      const [e1, e2] = endpoints(h)
      const top = e1.y > e2.y ? e1 : e2
      const bot = e1.y > e2.y ? e2 : e1
      expect(top.y).toBeCloseTo(ridgeY - hipInset * Math.sin(hipTilt), 6)
      expect(Math.abs(top.x)).toBeCloseTo(planPull, 6)
      expect(Math.abs(top.z)).toBeCloseTo(1 + planPull, 6)
      expect(bot.y).toBeCloseTo(baseY, 6)
      expect(Math.abs(bot.x)).toBeCloseTo(3, 6)
      expect(Math.abs(bot.z)).toBeCloseTo(4, 6)
    }
  })

  test('common rafters rise from the ±X tail cuts to the ridge face', () => {
    // side-plane commons only — end-plane king commons rise from ±Z by design
    const commons = members.filter((m) => m.role === 'rafter' && !m.label?.includes('hip end'))
    expect(commons.length).toBeGreaterThan(0)
    const rd = 5.5 * 0.0254
    const rt = 1.5 * 0.0254
    const inset = (rd / 2) * Math.tan(theta)
    const faceX = rt / 2
    const faceY = ridgeY - faceX * Math.tan(theta)
    for (const r of commons) {
      const [e1, e2] = endpoints(r)
      const top = e1.y > e2.y ? e1 : e2
      const bot = e1.y > e2.y ? e2 : e1
      // high end inscribed against the ridge face
      expect(top.y).toBeCloseTo(faceY - inset * Math.sin(theta), 6)
      expect(Math.abs(top.x)).toBeCloseTo(faceX + inset * Math.cos(theta), 6)
      // low end at the inscribed tail cut on ±X
      expect(bot.y).toBeCloseTo(tipY + inset * Math.sin(theta), 6)
      expect(Math.abs(bot.x)).toBeCloseTo(tipX - inset * Math.cos(theta), 6)
    }
  })
})

describe('verify: extractRoofs composes a π-rotated roof group + segment rotation', () => {
  const nodes: Record<string, Record<string, unknown>> = {
    level_1: { id: 'level_1', type: 'level', level: 0 },
    roof_pi: {
      id: 'roof_pi',
      type: 'roof',
      parentId: 'level_1',
      position: [10, 1, 5],
      rotation: Math.PI,
      children: ['rseg_pi'],
    },
    rseg_pi: {
      id: 'rseg_pi',
      type: 'roof-segment',
      parentId: 'roof_pi',
      position: [2, 0.5, 3],
      rotation: 0.4,
      roofType: 'gable',
      width: 8,
      depth: 6,
      pitch: 40,
      overhang: 0.3,
      wallHeight: 0.5,
    },
  }

  test('Ry(π) maps (2,·,3) → (−2,·,−3); yaw sums', () => {
    const [r] = extractRoofs(nodes, 'level_1')
    expect(r).toBeDefined()
    const roof = r as RoofSegmentSlice
    expect(roof.position[0]).toBeCloseTo(10 - 2, 6)
    expect(roof.position[1]).toBeCloseTo(1 + 0.5, 6)
    expect(roof.position[2]).toBeCloseTo(5 - 3, 6)
    expect(roof.yaw).toBeCloseTo(Math.PI + 0.4, 6)
  })
})

describe('verify: shed slope matches host (high at −Z, low at +Z)', () => {
  const roof = seg({ roofType: 'shed' })
  const theta = roof.pitch
  const baseY = roof.position[1] + roof.wallHeight
  const rafters = frameRoofs([roof], [], DEFAULT_SPEC).filter((m) => m.role === 'rafter')

  test('rafter plane hits wallHeight at z=+depth/2 and wallHeight+depth·tanθ at z=−depth/2', () => {
    expect(rafters.length).toBeGreaterThan(0)
    for (const r of rafters) {
      const [e1, e2] = endpoints(r)
      const hi = e1.y > e2.y ? e1 : e2
      const lo = e1.y > e2.y ? e2 : e1
      expect(hi.z).toBeLessThan(0) // high side toward −Z, per getRoofSegmentSurfaceY
      expect(lo.z).toBeGreaterThan(0)
      // interpolate the rafter line at the footprint edges
      const slope = (hi.y - lo.y) / (hi.z - lo.z)
      const yAt = (z: number) => lo.y + slope * (z - lo.z)
      expect(yAt(roof.depth / 2)).toBeCloseTo(baseY, 6)
      expect(yAt(-roof.depth / 2)).toBeCloseTo(baseY + roof.depth * Math.tan(theta), 6)
    }
  })
})

describe('verify: collar ties at pitch extremes span between the slope planes', () => {
  for (const deg of [5, 75]) {
    test(`pitch ${deg}° — ties clamp under the ridge and endpoints lie on the planes`, () => {
      const roof = seg({ pitch: (deg * Math.PI) / 180 })
      const theta = roof.pitch
      const run = roof.depth / 2
      const baseY = roof.position[1] + roof.wallHeight
      const rise = run * Math.tan(theta)
      const ridgeY = baseY + rise
      // Round-14: the upper-third line CLAMPS beneath the ridge's bottom
      // face (2x8 ridge for 2x6 rafters) so low pitches never bury the tie.
      const rdd = 7.25 * 0.0254
      const ctD = 3.5 * 0.0254
      const collarY = Math.min(baseY + (2 / 3) * rise, ridgeY - rdd - ctD / 2 - 0.005)
      const ties = frameRoofs([roof], [], DEFAULT_SPEC).filter((m) => m.role === 'collar-tie')
      if (collarY <= baseY + 0.2) {
        // pitch so low the tie has no room — engine skips them entirely
        expect(ties).toHaveLength(0)
        return
      }
      expect(ties.length).toBeGreaterThan(0)
      for (const tie of ties) {
        expect(tie.length).toBeCloseTo((2 * (ridgeY - collarY)) / Math.tan(theta), 6)
        const [e1, e2] = endpoints(tie)
        for (const e of [e1, e2]) {
          expect(e.y).toBeCloseTo(collarY, 6)
          // slope plane at |z|: y = ridgeY − |z|·tanθ — must equal collarY
          expect(ridgeY - Math.abs(e.z) * Math.tan(theta)).toBeCloseTo(collarY, 6)
        }
      }
    })
  }
})
