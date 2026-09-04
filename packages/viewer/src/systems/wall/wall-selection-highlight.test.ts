// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { WallNode } from '@pascal-app/core'
import { resolveSelectionHighlight } from './wall-cutout'

/**
 * The cost this guards is invisible: hoisting the height back out of the
 * thunk changes no pixel and no test result other than these, while putting
 * a full-node-record walk and a slab-polygon rebuild back on every wall in
 * the scene, several times a second, for as long as the camera is moving.
 */
describe('resolveSelectionHighlight', () => {
  const wall = () => WallNode.parse({ start: [0, 0], end: [4, 0], height: 2.5, thickness: 0.1 })

  test('a wall that is not highlighted never derives its effective height', () => {
    let calls = 0
    const result = resolveSelectionHighlight(wall(), false, () => {
      calls++
      return 2.5
    })
    expect(result).toBe(false)
    expect(calls).toBe(0)
  })

  test('a highlighted wall derives the height exactly once', () => {
    let calls = 0
    resolveSelectionHighlight(wall(), true, () => {
      calls++
      return 2.5
    })
    expect(calls).toBe(1)
  })

  test('a highlighted plain wall takes the highlight; a face-banded one paints its own', () => {
    // The behavioural contract that predates the optimisation: bands are the
    // wall's own decoration, so the selection tint must not overpaint them.
    expect(resolveSelectionHighlight(wall(), true, () => 2.5)).toBe(true)

    const banded = WallNode.parse({
      start: [0, 0],
      end: [4, 0],
      height: 2.5,
      thickness: 0.1,
      faceBands: { enabled: true, count: 3, lowerHeight: 0.84, middleHeight: 0.61 },
    })
    const bandedResult = resolveSelectionHighlight(banded, true, () => 2.5)
    expect(bandedResult).toBe(false)
  })
})
