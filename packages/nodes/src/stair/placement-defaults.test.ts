import { describe, expect, test } from 'bun:test'
import { resolveStairStringerLayout, resolveStairStructure, StairNode } from '@pascal-app/core'
import {
  newStairStructure,
  pickedStairRailingMode,
  surfaceFlightRailingMode,
} from './placement-defaults'

const IN = 0.0254

describe('a new stair', () => {
  test('is built on standard wood stringers unless the tool asks for another structure', () => {
    const structure = newStairStructure()
    expect(structure).toMatchObject({
      type: 'wood-stringers',
      stringerStock: '2x12',
      stringerType: 'cut',
    })
    expect(structure.stringerSpacing).toBeCloseTo(16 * IN, 9)
    // a 1 m stair on it carries four stringers, under 16 in apart
    const layout = resolveStairStringerLayout(
      1,
      resolveStairStructure(StairNode.parse({ structure }))!,
    )
    expect(layout.count).toBe(4)
    expect(layout.spacing).toBeLessThan(16 * IN)
    expect(newStairStructure({ type: 'concrete' }).type).toBe('concrete')
    expect(newStairStructure({ type: 'bamboo' }).type).toBe('wood-stringers')
  })

  test('fitted to a deck or porch, takes railings from four risers or a 30 in drop, unless the tool picks one', () => {
    expect(surfaceFlightRailingMode({ stepCount: 3, totalRise: 21 * IN })).toBe('none')
    expect(surfaceFlightRailingMode({ stepCount: 4, totalRise: 28 * IN })).toBe('both')
    expect(surfaceFlightRailingMode({ stepCount: 3, totalRise: 31 * IN })).toBe('both')
    expect(surfaceFlightRailingMode({ stepCount: 6, totalRise: 42 * IN }, 'left')).toBe('left')
    expect(surfaceFlightRailingMode({ stepCount: 2, totalRise: 14 * IN }, 'both')).toBe('both')
    expect(pickedStairRailingMode('right')).toBe('right')
    expect(pickedStairRailingMode('sideways')).toBeNull()
    expect(pickedStairRailingMode(undefined)).toBeNull()
  })
})
