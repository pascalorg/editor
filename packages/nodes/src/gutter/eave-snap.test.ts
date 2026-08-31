import { describe, expect, test } from 'bun:test'
import { RoofSegmentNode } from '@pascal-app/core'
import { resolveEaveSnap } from './eave-snap'

describe('resolveEaveSnap', () => {
  test('snaps a mansard roof to all four canonical eaves', () => {
    const segment = RoofSegmentNode.parse({ roofType: 'mansard', width: 8, depth: 6 })

    expect(resolveEaveSnap(segment, 3.5, 0).side).toBe('+X')
    expect(resolveEaveSnap(segment, -3.5, 0).side).toBe('-X')
    expect(resolveEaveSnap(segment, 0, 2.5).side).toBe('+Z')
    expect(resolveEaveSnap(segment, 0, -2.5).side).toBe('-Z')
  })

  test('keeps gable snapping on its two eave sides', () => {
    const segment = RoofSegmentNode.parse({ roofType: 'gable', width: 8, depth: 6 })

    expect(resolveEaveSnap(segment, 3.5, 0.1).side).toBe('+Z')
    expect(resolveEaveSnap(segment, -3.5, -0.1).side).toBe('-Z')
  })
})
