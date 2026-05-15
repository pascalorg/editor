import { describe, expect, mock, test } from 'bun:test'

mock.module('@pascal-app/core', () => ({
  sceneRegistry: {
    byType: { level: new Set<string>() },
    nodes: new Map<string, { position: { y: number }; visible: boolean }>(),
  },
  useScene: {
    getState: () => ({ nodes: {} }),
  },
}))

const { getLevelTargetY, getNextLevelCumulativeY } = await import(
  '../src/systems/level/level-utils'
)

describe('level vertical offsets', () => {
  test('adds baseElevation to target Y and cumulative stack height', () => {
    const lowerLevel = { baseElevation: 0 }
    const upperLevel = { baseElevation: 1.25 }
    let cumulativeY = 0

    expect(getLevelTargetY(cumulativeY, lowerLevel)).toBe(0)
    cumulativeY = getNextLevelCumulativeY(cumulativeY, 2.5, lowerLevel)

    expect(getLevelTargetY(cumulativeY, upperLevel)).toBe(3.75)
    cumulativeY = getNextLevelCumulativeY(cumulativeY, 2.5, upperLevel)

    expect(cumulativeY).toBe(6.25)
  })
})
