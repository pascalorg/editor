import { describe, expect, test } from 'bun:test'
import { resolveLevelVisibility } from './level-utils'

const decide = (
  overrides: Partial<Parameters<typeof resolveLevelVisibility>[0]> = {},
): ReturnType<typeof resolveLevelVisibility> =>
  resolveLevelVisibility({
    levelMode: 'stacked',
    hasSelectedLevel: false,
    isSelected: false,
    index: 0,
    selectedIndex: undefined,
    nodeVisible: true,
    ...overrides,
  })

describe('resolveLevelVisibility', () => {
  test('shows every level outside solo mode', () => {
    expect(decide()).toEqual({ visible: true, shadowOnly: false })
    expect(decide({ levelMode: 'exploded', index: 2 })).toEqual({
      visible: true,
      shadowOnly: false,
    })
  })

  test('solo keeps the soloed level, plain-hides the ones below it', () => {
    expect(
      decide({ levelMode: 'solo', hasSelectedLevel: true, isSelected: true, index: 1 }),
    ).toEqual({ visible: true, shadowOnly: false })
    expect(
      decide({ levelMode: 'solo', hasSelectedLevel: true, index: 0, selectedIndex: 1 }),
    ).toEqual({ visible: false, shadowOnly: false })
  })

  test('solo keeps the levels above the soloed one as shadow casters', () => {
    expect(
      decide({ levelMode: 'solo', hasSelectedLevel: true, index: 2, selectedIndex: 1 }),
    ).toEqual({ visible: true, shadowOnly: true })
  })

  test('solo plain-hides everything when the selected level is not registered', () => {
    expect(
      decide({ levelMode: 'solo', hasSelectedLevel: true, index: 2, selectedIndex: undefined }),
    ).toEqual({ visible: false, shadowOnly: false })
  })

  test('a level the author hid is hidden outright, never a shadow caster', () => {
    expect(decide({ nodeVisible: false })).toEqual({ visible: false, shadowOnly: false })
    expect(
      decide({
        levelMode: 'solo',
        hasSelectedLevel: true,
        index: 2,
        selectedIndex: 1,
        nodeVisible: false,
      }),
    ).toEqual({ visible: false, shadowOnly: false })
    expect(
      decide({
        levelMode: 'solo',
        hasSelectedLevel: true,
        isSelected: true,
        index: 1,
        selectedIndex: 1,
        nodeVisible: false,
      }),
    ).toEqual({ visible: false, shadowOnly: false })
  })
})
