import { describe, expect, it } from 'bun:test'
import { WallNode } from '../../../schema/nodes/wall'
import type { CastableElement } from '../coverage/elements'
import { toCastableElement } from '../coverage/elements'
import { splitIntoLifts } from './lifts'

function element(overrides: Partial<Parameters<typeof WallNode.parse>[0]> = {}): CastableElement {
  const wall = WallNode.parse({
    start: [0, 0],
    end: [5, 0],
    thickness: 0.3,
    height: 9,
    formworkType: 'plywood',
    ...overrides,
  })
  const castable = toCastableElement(wall)
  if (!castable) throw new Error('not castable')
  return castable
}

describe('no limit', () => {
  it('yields one lift covering the whole element', () => {
    const lifts = splitIntoLifts(element())
    expect(lifts).toEqual([{ index: 0, baseElevation: 0, topElevation: 9, hasJointBelow: false }])
  })

  it('yields one lift when the element is shorter than the cap', () => {
    const lifts = splitIntoLifts(element({ height: 2.5 }), { maxLiftHeight: 4 })
    expect(lifts).toHaveLength(1)
    expect(lifts[0]?.topElevation).toBe(2.5)
  })
})

describe('uniform split', () => {
  it('divides into the fewest equal lifts that satisfy the cap', () => {
    const lifts = splitIntoLifts(element({ height: 9 }), { maxLiftHeight: 4 })
    expect(lifts.map((l) => l.topElevation - l.baseElevation)).toEqual([3, 3, 3])
  })

  it('gives every lift the same height rather than a short remainder', () => {
    // A greedy 4 + 4 + 1 split would need a third tie grid for a 1 m lift.
    const lifts = splitIntoLifts(element({ height: 9 }), { maxLiftHeight: 4 })
    const heights = new Set(lifts.map((l) => l.topElevation - l.baseElevation))
    expect(heights.size).toBe(1)
  })

  it('marks every lift but the bottom as sitting on a joint', () => {
    const lifts = splitIntoLifts(element({ height: 9 }), { maxLiftHeight: 4 })
    expect(lifts.map((l) => l.hasJointBelow)).toEqual([false, true, true])
  })

  it('leaves no gap between lifts', () => {
    const lifts = splitIntoLifts(element({ height: 10 }), { maxLiftHeight: 3 })
    for (const [index, lift] of lifts.entries()) {
      if (index === 0) continue
      expect(lift.baseElevation).toBe(lifts[index - 1]?.topElevation as number)
    }
  })
})

describe('competing caps', () => {
  it('takes the element cap when it is tighter than the project limit', () => {
    const lifts = splitIntoLifts(element({ height: 9, maxLiftHeight: 2 }), { maxLiftHeight: 4 })
    expect(lifts).toHaveLength(5)
  })

  it('takes the project limit when it is tighter than the element cap', () => {
    const lifts = splitIntoLifts(element({ height: 9, maxLiftHeight: 5 }), { maxLiftHeight: 3 })
    expect(lifts).toHaveLength(3)
  })

  it('applies the element cap with no project limit set', () => {
    const lifts = splitIntoLifts(element({ height: 9, maxLiftHeight: 3 }))
    expect(lifts).toHaveLength(3)
  })
})

describe('snapping to permitted elevations', () => {
  it('moves a joint onto a permitted elevation within tolerance', () => {
    // Uniform would put the joint at 4.5; the slab soffit is at 4.6.
    const lifts = splitIntoLifts(element({ height: 9 }), {
      maxLiftHeight: 5,
      permittedJointElevations: [4.6],
      jointSnapTolerance: 0.3,
    })
    expect(lifts[1]?.baseElevation).toBe(4.6)
    expect(lifts[1]?.snappedTo).toBe(4.6)
  })

  it('leaves the joint where it is when nothing is in reach', () => {
    const lifts = splitIntoLifts(element({ height: 9 }), {
      maxLiftHeight: 5,
      permittedJointElevations: [7],
      jointSnapTolerance: 0.3,
    })
    expect(lifts[1]?.baseElevation).toBe(4.5)
    expect(lifts[1]?.snappedTo).toBeUndefined()
  })

  it('records no snap on the bottom lift, which has no joint below it', () => {
    const lifts = splitIntoLifts(element({ height: 9 }), {
      maxLiftHeight: 5,
      permittedJointElevations: [4.6],
    })
    expect(lifts[0]?.snappedTo).toBeUndefined()
    expect(lifts[0]?.hasJointBelow).toBe(false)
  })

  it('picks the nearest of several permitted elevations', () => {
    const lifts = splitIntoLifts(element({ height: 9 }), {
      maxLiftHeight: 5,
      permittedJointElevations: [4.2, 4.55, 4.8],
      jointSnapTolerance: 0.5,
    })
    expect(lifts[1]?.baseElevation).toBe(4.55)
  })

  it('collapses two joints that snap to the same elevation', () => {
    // 3 + 3 + 3 puts joints at 3 and 6; both are within 0.6 of 3.2, so a naive
    // implementation would emit a zero-height lift between them.
    const lifts = splitIntoLifts(element({ height: 9 }), {
      maxLiftHeight: 3.2,
      permittedJointElevations: [3.2],
      jointSnapTolerance: 3.1,
    })
    for (const lift of lifts) {
      expect(lift.topElevation - lift.baseElevation).toBeGreaterThan(0)
    }
    expect(lifts.map((l) => l.baseElevation)).toEqual([0, 3.2])
  })

  it('drops a joint snapped onto the element top', () => {
    const lifts = splitIntoLifts(element({ height: 9 }), {
      maxLiftHeight: 5,
      permittedJointElevations: [9],
      jointSnapTolerance: 5,
    })
    expect(lifts).toHaveLength(1)
    expect(lifts[0]?.topElevation).toBe(9)
  })
})

describe('degenerate input', () => {
  it('yields one lift for a zero-height element', () => {
    const lifts = splitIntoLifts(element({ height: 0 }), { maxLiftHeight: 1 })
    expect(lifts).toHaveLength(1)
  })

  it('ignores a nonsensical cap rather than dividing forever', () => {
    const lifts = splitIntoLifts(element({ height: 9 }), { maxLiftHeight: 0 })
    expect(lifts).toHaveLength(1)
  })
})
