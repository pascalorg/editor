import { describe, expect, test } from 'bun:test'
import { blockSfx } from './interaction-sfx'

describe('block interaction SFX', () => {
  test('maps editor actions to distinct established sound cues', () => {
    expect(blockSfx('tool-select')).toBe('sfx:menu-click')
    expect(blockSfx('component-select')).toBe('sfx:item-pick')
    expect(blockSfx('drag-start')).toBe('sfx:item-pick')
    expect(blockSfx('move-step')).toBe('sfx:grid-snap')
    expect(blockSfx('rotate-step')).toBe('sfx:item-rotate')
    expect(blockSfx('resize-step')).toBe('sfx:resize')
    expect(blockSfx('operation-start')).toBe('sfx:structure-build-start')
    expect(blockSfx('operation-commit')).toBe('sfx:structure-build')
    expect(blockSfx('delete')).toBe('sfx:structure-delete')
    expect(blockSfx('cancel')).toBe('sfx:menu-click')
    expect(blockSfx('finish')).toBe('sfx:item-place')
  })
})
