import { describe, expect, test } from 'bun:test'
import { getDefaultLevelName, getLevelDisplayName } from './level-name'

describe('level names', () => {
  test('an unnamed level reads by its place in the building', () => {
    expect([-2, -1, 0, 1, 2].map(getDefaultLevelName)).toEqual([
      'Basement 2',
      'Basement',
      'Ground floor',
      'Floor 1',
      'Floor 2',
    ])
    expect(getLevelDisplayName({ level: 0 })).toBe('Ground floor')
    expect(getLevelDisplayName({ name: '  ', level: 1 })).toBe('Floor 1')
  })

  test('the "Level N" an older build stamped reads like no name; a real name wins', () => {
    expect(getLevelDisplayName({ name: 'Level 0', level: 0 })).toBe('Ground floor')
    expect(getLevelDisplayName({ name: 'Level 2', level: 2 })).toBe('Floor 2')
    // A "Level N" that does not match its own place was chosen by someone.
    expect(getLevelDisplayName({ name: 'Level 3', level: 1 })).toBe('Level 3')
    expect(getLevelDisplayName({ name: 'Attic', level: 2 })).toBe('Attic')
  })
})
