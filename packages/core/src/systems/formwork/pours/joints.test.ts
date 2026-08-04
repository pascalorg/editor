import { describe, expect, it } from 'bun:test'
import { WallNode } from '../../../schema/nodes/wall'
import type { CastableElement } from '../coverage/elements'
import { toCastableElement } from '../coverage/elements'
import { jointsForElement } from './joints'

function element(overrides: Partial<Parameters<typeof WallNode.parse>[0]> = {}): CastableElement {
  const wall = WallNode.parse({
    start: [0, 0],
    end: [40, 0],
    thickness: 0.3,
    height: 9,
    formworkType: 'plywood',
    ...overrides,
  })
  const castable = toCastableElement(wall)
  if (!castable) throw new Error('not castable')
  return castable
}

const kinds = (treatments: Array<{ kind: string }>) => treatments.map((t) => t.kind)

describe('unsplit element', () => {
  it('needs no joints', () => {
    expect(jointsForElement(element())).toEqual([])
  })
})

describe('lift joints', () => {
  it('emits one per lift boundary, not one per lift', () => {
    const joints = jointsForElement(element(), { maxLiftHeight: 4 })
    expect(joints).toHaveLength(2)
    expect(joints.map((j) => j.elevation)).toEqual([3, 6])
  })

  it('positions the joint at the base of the lift above it', () => {
    const joints = jointsForElement(element(), { maxLiftHeight: 5 })
    expect(joints[0]?.elevation).toBe(4.5)
    expect(joints[0]?.along).toBeUndefined()
  })

  it('needs bond and continuity, since the lift above bears across it', () => {
    const joints = jointsForElement(element(), { maxLiftHeight: 4 })
    expect(kinds(joints[0]?.treatments ?? [])).toEqual(['roughening', 'starter-bars'])
  })

  it('follows a snapped elevation rather than the uniform one', () => {
    const joints = jointsForElement(element(), {
      maxLiftHeight: 5,
      permittedJointElevations: [4.6],
      jointSnapTolerance: 0.3,
    })
    expect(joints[0]?.elevation).toBe(4.6)
  })
})

describe('pour breaks', () => {
  it('emits one per soft segment cut', () => {
    const joints = jointsForElement(element(), { maxPourLength: 12 })
    expect(joints).toHaveLength(3)
    expect(joints.map((j) => j.along)).toEqual([10, 20, 30])
  })

  it('takes starters but not roughening — a formed face is already keyed', () => {
    const joints = jointsForElement(element(), { maxPourLength: 12 })
    expect(kinds(joints[0]?.treatments ?? [])).toEqual(['starter-bars'])
  })

  it('does not re-emit a hard cut, which already exists as its own node', () => {
    const joints = jointsForElement(element(), {}, [{ along: 15 }])
    expect(joints).toEqual([])
  })

  it('emits only the soft cuts when both kinds are present', () => {
    const joints = jointsForElement(element(), { maxPourLength: 12 }, [{ along: 15 }])
    expect(joints.map((j) => j.along)).not.toContain(15)
    expect(joints).toHaveLength(3)
  })
})

describe('both splits', () => {
  it('emits lift joints and pour breaks together, each once', () => {
    // 3 lifts × 4 segments is 12 units but only 2 + 3 joints: a joint is shared
    // by the units either side of it, so one per boundary rather than per unit.
    const joints = jointsForElement(element(), { maxLiftHeight: 4, maxPourLength: 12 })
    expect(joints.filter((j) => j.elevation !== undefined)).toHaveLength(2)
    expect(joints.filter((j) => j.along !== undefined)).toHaveLength(3)
  })

  it('marks every emitted joint as solver-placed and movable', () => {
    const joints = jointsForElement(element(), { maxLiftHeight: 4, maxPourLength: 12 })
    for (const joint of joints) {
      expect(joint.solverPlaced).toBe(true)
      expect(joint.kind).toBe('construction')
    }
  })

  it('names the host element on every joint', () => {
    const e = element()
    const joints = jointsForElement(e, { maxLiftHeight: 4, maxPourLength: 12 })
    for (const joint of joints) expect(joint.elementIds).toEqual([e.id])
  })
})
