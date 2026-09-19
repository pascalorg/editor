import { describe, expect, it } from 'bun:test'
import { getWallCurveLength, WallNode } from '@pascal-app/core'
import { buildWallLengthPatch } from './length-patch'

describe('buildWallLengthPatch', () => {
  it('keeps the start and direction when scaling a straight wall', () => {
    const node = WallNode.parse({ start: [2, 3], end: [5, 7] })
    const patch = buildWallLengthPatch(node, 10)
    expect(patch.end?.[0]).toBeCloseTo(8)
    expect(patch.end?.[1]).toBeCloseTo(11)
    expect(patch.curveOffset).toBeUndefined()
    expect(node.end).toEqual([5, 7])
  })

  it('scales the chord and sagitta together to preserve curved shape', () => {
    const node = WallNode.parse({ start: [2, 3], end: [6, 3], curveOffset: -0.5 })
    const length = getWallCurveLength(node)
    const patch = buildWallLengthPatch(node, length * 2)
    expect(patch).toEqual({ end: [10, 3], curveOffset: -1 })
    expect(getWallCurveLength({ ...node, ...patch })).toBeCloseTo(length * 2)
  })

  it('does not produce invalid geometry for zero-length walls or invalid input', () => {
    const node = WallNode.parse({ start: [0, 0], end: [4, 0] })
    for (const length of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(buildWallLengthPatch(node, length)).toEqual({})
    }
    expect(buildWallLengthPatch({ ...node, end: node.start }, 2)).toEqual({})
  })
})
