import { describe, expect, test } from 'bun:test'
import { createFloorplanCursorResolver } from './floorplan-cursor'

describe('createFloorplanCursorResolver', () => {
  test('keeps existing nodes at their original position on the first cursor sample', () => {
    const resolveCursor = createFloorplanCursorResolver({ original: [4, 6] })

    expect(resolveCursor([10, 12])).toEqual([4, 6])
    expect(resolveCursor([11, 14])).toEqual([5, 8])
  })

  test('places fresh nodes absolutely under the cursor', () => {
    const resolveCursor = createFloorplanCursorResolver({
      original: [0, 0],
      metadata: { isNew: true },
    })

    expect(resolveCursor([10, 12])).toEqual([10, 12])
    expect(resolveCursor([11, 14])).toEqual([11, 14])
  })

  test('snaps relative movement without snapping the original position', () => {
    const resolveCursor = createFloorplanCursorResolver({ original: [4.1, 6.1] })
    const snap = (value: number) => Math.round(value / 0.5) * 0.5

    expect(resolveCursor([10.1, 12.1], { snap })).toEqual([4.1, 6.1])
    expect(resolveCursor([10.37, 12.88], { snap })).toEqual([4.6, 7.1])
  })
})
