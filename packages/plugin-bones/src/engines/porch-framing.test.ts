import { describe, expect, test } from 'bun:test'
import { DEFAULT_SPEC } from '../core/spec'
import type { PorchPostSlice, WallSlice } from '../core/types'
import type { RoofSegmentSlice } from './roof-framing'
import { inches } from '../core/units'
import { framePorches } from './porch-framing'

const FT = 0.3048

/** A 20 ft front porch on a raised house: four 6x6 posts on the beam line 2.05 m out from the wall. */
function posts(): PorchPostSlice[] {
  const baseY = -0.4572 // grade, 18 in under the floor
  const coverY = 2.79 // the cover's bearing line (a 9 ft porch ceiling over the 0.05 floor)
  const z = -2.05
  return [-2.9, -0.86, 0.86, 2.9].map((x, i) => ({
    id: `column_${i + 1}`,
    plan: [x, z] as const,
    baseY,
    height: coverY - baseY,
    size: inches(5.5),
    entrance: 'front',
  }))
}

function frontWall(): WallSlice {
  return {
    id: 'wall_front',
    start: [-6, 0],
    end: [6, 0],
    dir: [1, 0],
    thickness: 0.17,
    height: 2.74,
    exterior: true,
    curved: false,
    openings: [],
  } as unknown as WallSlice
}

function cover(attach?: 'high'): RoofSegmentSlice {
  return {
    id: 'rseg_porch',
    roofType: attach ? 'shed' : 'gable',
    position: [0, 2.79, -1.4],
    yaw: attach ? Math.PI / 2 : -Math.PI / 2,
    width: 4.4,
    depth: 6.2,
    pitch: (26.6 * Math.PI) / 180,
    overhang: 0.3,
    wallHeight: 0,
    open: true,
    ...(attach ? { attach } : {}),
  } as RoofSegmentSlice
}

describe('the porch bearing (PlanCrafters porchWall)', () => {
  const frame = framePorches(posts(), [frontWall()], [cover()], DEFAULT_SPEC)
  const beams = frame.members.filter((m) => m.role === 'girder')
  const plates = frame.members.filter((m) => m.role === 'top-plate')
  const framedPosts = frame.members.filter((m) => m.role === 'post')

  test('a 6x8 beam spans post face to post face along the post line, a 2x plate on it, under the bearing line', () => {
    const front = beams.find((m) => m.label?.startsWith('Porch beam'))
    expect(front).toBeDefined()
    expect(front?.size).toBe('6x8')
    expect(front?.length).toBeCloseTo(5.8 + inches(5.5), 6)
    // beam under the plate under the bearing line at 2.79
    const plateT = inches(1.5)
    const beamD = inches(7.25)
    expect(front!.position[1] + beamD / 2).toBeCloseTo(2.79 - plateT, 6)
    const plate = plates.find((m) => m.label?.startsWith('Porch beam plate'))
    expect(plate?.position[1]).toBeCloseTo(2.79 - plateT / 2, 6)
    expect(plate?.length).toBeCloseTo(front!.length, 9)
    expect(front?.label).toContain('3 bays')
    expect(frame.warnings).toEqual([])
  })

  test('each post is a 6x6 from its base to the beam underside', () => {
    expect(framedPosts).toHaveLength(4)
    for (const p of framedPosts) {
      expect(p.size).toBe('6x6')
      const bottom = p.position[1] - p.dims[1] / 2
      const top = p.position[1] + p.dims[1] / 2
      expect(bottom).toBeCloseTo(-0.4572, 6)
      expect(top).toBeCloseTo(2.79 - inches(1.5) - inches(7.25), 6)
    }
  })

  test('a gable cover dying into the house roof gets two side beams from the corner posts to the wall face', () => {
    const sides = beams.filter((m) => m.label?.startsWith('Porch side beam'))
    expect(sides).toHaveLength(2)
    for (const s of sides) {
      // 2.05 m to the wall line less half the wall and half the post
      expect(s.length).toBeCloseTo(2.05 - 0.085 - inches(2.75), 6)
      expect(s.size).toBe('6x8')
    }
  })

  test('a shed cover on a ledger takes no side beams — its rafters bear at the wall', () => {
    const shed = framePorches(posts(), [frontWall()], [cover('high')], DEFAULT_SPEC)
    expect(shed.members.filter((m) => m.label?.startsWith('Porch side beam'))).toHaveLength(0)
    expect(shed.members.filter((m) => m.role === 'girder')).toHaveLength(1)
  })

  test('posts off a straight line, or a single post, frame nothing and say why', () => {
    const bent = posts()
    bent[1] = { ...(bent[1] as PorchPostSlice), plan: [-0.86, -1.0] }
    const r = framePorches(bent, [frontWall()], [cover()], DEFAULT_SPEC)
    expect(r.members).toHaveLength(0)
    expect(r.warnings[0]).toContain('off the beam line')
    const one = framePorches([posts()[0] as PorchPostSlice], [frontWall()], [cover()], DEFAULT_SPEC)
    expect(one.members).toHaveLength(0)
    expect(one.warnings[0]).toContain('one post')
  })

  test('two entrances frame apart', () => {
    const rear = posts().map((p) => ({ ...p, id: `${p.id}_r`, plan: [p.plan[0], 8] as const, entrance: 'rear' }))
    const r = framePorches([...posts(), ...rear], [frontWall()], [cover()], DEFAULT_SPEC)
    expect(r.members.filter((m) => m.role === 'girder' && m.label?.startsWith('Porch beam ')).length).toBe(2)
  })
})
