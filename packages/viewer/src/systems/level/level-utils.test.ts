import { describe, expect, test } from 'bun:test'
import { resolveLevelVisibility } from './level-utils'

const decide = (
  overrides: Partial<Parameters<typeof resolveLevelVisibility>[0]> = {},
): ReturnType<typeof resolveLevelVisibility> =>
  resolveLevelVisibility({
    levelMode: 'stacked',
    hideAbove: false,
    hasSelectedLevel: false,
    isSelected: false,
    index: 0,
    selectedIndex: undefined,
    nodeVisible: true,
    revealing: false,
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

  test('the level display hides the levels above the selected one as shadow casters', () => {
    const base = { hideAbove: true, hasSelectedLevel: true, selectedIndex: 1 }
    expect(decide({ ...base, index: 2 })).toEqual({ visible: true, shadowOnly: true })
    expect(decide({ ...base, index: 1, isSelected: true })).toEqual({
      visible: true,
      shadowOnly: false,
    })
    expect(decide({ ...base, index: 0 })).toEqual({ visible: true, shadowOnly: false })
    expect(decide({ ...base, index: 2, nodeVisible: false })).toEqual({
      visible: false,
      shadowOnly: false,
    })
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

  test('a level a construction reveal is playing on shows whatever the display hides', () => {
    const above = { hideAbove: true, hasSelectedLevel: true, selectedIndex: 0, index: 1 }
    expect(decide(above)).toEqual({ visible: true, shadowOnly: true })
    expect(decide({ ...above, revealing: true })).toEqual({ visible: true, shadowOnly: false })
    expect(
      decide({
        levelMode: 'solo',
        hasSelectedLevel: true,
        index: 0,
        selectedIndex: 1,
        revealing: true,
      }),
    ).toEqual({ visible: true, shadowOnly: false })
  })

  test('the reveal does not show a level the author hid', () => {
    expect(decide({ nodeVisible: false, revealing: true })).toEqual({
      visible: false,
      shadowOnly: false,
    })
  })
})
