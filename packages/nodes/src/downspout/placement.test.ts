import { expect, test } from 'bun:test'
import { GutterNode } from '@pascal-app/core'
import { downspoutCursorOffset, resolveDownspoutPlacement } from './index'

test('downspout placement snaps along the gutter and persists the fitted offset', () => {
  const gutter = GutterNode.parse({ length: 2 })
  expect(resolveDownspoutPlacement(gutter, 0.37, 0.25)?.offset).toBe(0.25)
  expect(resolveDownspoutPlacement(gutter, 0.37)?.offset).toBe(0.37)
  expect(resolveDownspoutPlacement(gutter, 5)?.offset).toBeLessThan(1)
  expect(resolveDownspoutPlacement(gutter, 0.37, 0.25, true)?.offset).toBe(0.37)
})
test('overlapping outlet placement is rejected unless forced', () => {
  const gutter = GutterNode.parse({ outlets: [{ id: 'existing', offset: 0, diameter: 0.07 }] })
  expect(resolveDownspoutPlacement(gutter, 0.02)?.valid).toBe(false)
  expect(resolveDownspoutPlacement(gutter, 0.3)?.valid).toBe(true)
  expect(resolveDownspoutPlacement(gutter, 0.02, 0, true)?.valid).toBe(true)
})
test('curved gutter cursor offsets round-trip on either bend direction', () => {
  for (const sign of [-1, 1]) {
    const radius = 3
    const offset = 0.7
    const phi = offset / (sign * radius)
    const centerZ = sign * radius
    const radial = 0.05 - centerZ
    const gutter = GutterNode.parse({ arc: { centerX: 0, centerZ, radius } })
    expect(
      downspoutCursorOffset(gutter, -radial * Math.sin(phi), centerZ + radial * Math.cos(phi)),
    ).toBeCloseTo(offset)
  }
})
test('a gutter too short for an outlet has no valid drop', () => {
  expect(resolveDownspoutPlacement(GutterNode.parse({ length: 0.05 }), 0)).toBeNull()
})
