import { describe, expect, test } from 'bun:test'
import { getGableRidge, RoofSegmentNode } from '@pascal-app/core'
import { applyGableRidgeEdit, type GableRidgeEdit, type GableRidgeLocks } from './gable-ridge-edit'

const FREE: GableRidgeLocks = { pitches: false, ridge: false }

function gable(extra: Partial<RoofSegmentNode> = {}) {
  return RoofSegmentNode.parse({
    type: 'roof-segment',
    roofType: 'gable',
    width: 10,
    depth: 10,
    wallHeight: 0.8,
    pitch: 25,
    backPitch: 15,
    ridgeOffset: 4,
    ...extra,
  })
}

function edited(node: RoofSegmentNode, edit: GableRidgeEdit, locks = FREE) {
  const update = applyGableRidgeEdit(node, edit, locks)
  return update ? { ...node, ...update } : null
}

describe('gable ridge group', () => {
  test('an angle turns about the fixed ridge; only its own attic wall moves', () => {
    const node = gable()
    const before = getGableRidge(node)!
    const front = getGableRidge(edited(node, { kind: 'pitch', side: 'front', value: 30 })!)!
    expect(front.height).toBeCloseTo(before.height, 9)
    expect(front.offset).toBeCloseTo(4, 9)
    expect(front.frontPitch).toBe(30)
    expect(front.frontWallHeight).toBeLessThan(before.frontWallHeight)
    expect(front.backWallHeight).toBeCloseTo(before.backWallHeight, 9)

    const back = getGableRidge(edited(node, { kind: 'pitch', side: 'back', value: 20 })!)!
    expect(back.height).toBeCloseTo(before.height, 9)
    expect(back.frontWallHeight).toBeCloseTo(before.frontWallHeight, 9)
    expect(back.backWallHeight).toBeLessThan(before.backWallHeight)
  })

  test('raising the ridge lifts the whole roof: angles hold, both attic walls grow', () => {
    const node = gable()
    const before = getGableRidge(node)!
    const after = getGableRidge(edited(node, { kind: 'height', value: before.height + 0.5 })!)!
    expect(after.frontPitch).toBe(25)
    expect(after.backPitch).toBe(15)
    expect(after.frontWallHeight).toBeCloseTo(before.frontWallHeight + 0.5, 9)
    expect(after.backWallHeight).toBeCloseTo(before.backWallHeight + 0.5, 9)
  })

  test('moving the ridge splits the depth anew; one part grows as the other shrinks', () => {
    const node = gable()
    const after = getGableRidge(edited(node, { kind: 'position', side: 'back', value: 5 })!)!
    expect(after.offset).toBeCloseTo(5, 9)
    expect(after.height).toBeCloseTo(getGableRidge(node)!.height, 9)
  })

  test('an attic wall turns its slope while the ridge holds, or lifts the roof with locked angles', () => {
    const node = gable()
    const before = getGableRidge(node)!
    const turned = getGableRidge(edited(node, { kind: 'wall', side: 'back', value: 1 })!)!
    expect(turned.backWallHeight).toBeCloseTo(1, 9)
    expect(turned.height).toBeCloseTo(before.height, 9)

    const lifted = getGableRidge(
      edited(node, { kind: 'wall', side: 'back', value: 1 }, { pitches: true, ridge: false })!,
    )!
    expect(lifted.backWallHeight).toBeCloseTo(1, 9)
    expect(lifted.backPitch).toBe(15)
    expect(lifted.height - before.height).toBeCloseTo(1 - before.backWallHeight, 9)
  })

  test('locks refuse the edits they guard', () => {
    const node = gable()
    expect(
      applyGableRidgeEdit(
        node,
        { kind: 'pitch', side: 'front', value: 30 },
        { pitches: true, ridge: false },
      ),
    ).toBeNull()
    expect(
      applyGableRidgeEdit(node, { kind: 'height', value: 5 }, { pitches: false, ridge: true }),
    ).toBeNull()
    expect(
      applyGableRidgeEdit(
        node,
        { kind: 'wall', side: 'front', value: 1 },
        { pitches: true, ridge: true },
      ),
    ).toBeNull()
  })

  test('the first edit pins a derived ridge where it stood', () => {
    const node = gable({ ridgeOffset: undefined, backPitch: undefined })
    const before = getGableRidge(node)!
    expect(before.offset).toBeCloseTo(5, 9)
    const update = applyGableRidgeEdit(node, { kind: 'pitch', side: 'back', value: 15 }, FREE)!
    expect(update.ridgeOffset).toBeCloseTo(5, 9)
    expect(getGableRidge({ ...node, ...update })!.height).toBeCloseTo(before.height, 9)
  })
})

describe('gable ridge heights per slope', () => {
  test('raising one slope’s ridge steps it; the other ridge and both pitches hold', () => {
    const node = gable()
    const before = getGableRidge(node)!
    const back = getGableRidge(
      edited(node, { kind: 'height', side: 'back', value: before.height + 1.2 })!,
    )!
    expect(back.step).toBeCloseTo(1.2, 9)
    expect(back.height).toBeCloseTo(before.height, 9)
    expect(back.backHeight).toBeCloseTo(before.height + 1.2, 9)
    expect(back.backPitch).toBe(15)
    expect(back.backWallHeight).toBeCloseTo(before.backWallHeight + 1.2, 9)
    expect(back.frontWallHeight).toBeCloseTo(before.frontWallHeight, 9)

    const front = getGableRidge(
      edited(node, { kind: 'height', side: 'front', value: before.height - 0.7 })!,
    )!
    expect(front.height).toBeCloseTo(before.height - 0.7, 9)
    expect(front.backHeight).toBeCloseTo(before.height, 9)
    expect(front.step).toBeCloseTo(0.7, 9)
    expect(front.frontPitch).toBe(25)
  })

  test('back to equal heights is one ridge again', () => {
    const node = gable({ ridgeStep: 0.8 })
    const ridge = getGableRidge(node)!
    const update = applyGableRidgeEdit(
      node,
      { kind: 'height', side: 'back', value: ridge.height + 0.001 },
      FREE,
    )!
    expect(update.ridgeStep).toBe(0)
  })

  test('a stepped ridge moves and lifts as a whole and keeps its step', () => {
    const node = gable({ ridgeStep: 0.8 })
    const before = getGableRidge(node)!
    const moved = getGableRidge(edited(node, { kind: 'position', side: 'front', value: 5 })!)!
    expect(moved.height).toBeCloseTo(before.height, 9)
    expect(moved.backHeight).toBeCloseTo(before.backHeight, 9)
    const lifted = getGableRidge(edited(node, { kind: 'height', value: before.height + 0.5 })!)!
    expect(lifted.backHeight).toBeCloseTo(before.backHeight + 0.5, 9)
  })

  test('an attic wall on the higher side turns its slope about its own ridge', () => {
    const node = gable({ ridgeStep: 0.8 })
    const before = getGableRidge(node)!
    const after = getGableRidge(
      edited(node, { kind: 'wall', side: 'back', value: before.backWallHeight + 0.3 })!,
    )!
    expect(after.backHeight).toBeCloseTo(before.backHeight, 9)
    expect(after.backWallHeight).toBeCloseTo(before.backWallHeight + 0.3, 6)
    expect(after.backPitch).toBeLessThan(15)

    const locked = getGableRidge(
      edited(
        node,
        { kind: 'wall', side: 'back', value: before.backWallHeight + 0.3 },
        { pitches: true, ridge: false },
      )!,
    )!
    expect(locked.backWallHeight).toBeCloseTo(before.backWallHeight + 0.3, 9)
    expect(locked.step).toBeCloseTo(0.8, 9)
  })
})
