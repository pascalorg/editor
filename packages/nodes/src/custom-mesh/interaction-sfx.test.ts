import { describe, expect, test } from 'bun:test'
import { customMeshSfx } from './interaction-sfx'

describe('custom mesh interaction SFX', () => {
  test('maps editor actions to distinct established sound cues', () => {
    expect(customMeshSfx('tool-select')).toBe('sfx:menu-click')
    expect(customMeshSfx('component-select')).toBe('sfx:item-pick')
    expect(customMeshSfx('drag-start')).toBe('sfx:item-pick')
    expect(customMeshSfx('move-step')).toBe('sfx:grid-snap')
    expect(customMeshSfx('rotate-step')).toBe('sfx:item-rotate')
    expect(customMeshSfx('resize-step')).toBe('sfx:resize')
    expect(customMeshSfx('operation-start')).toBe('sfx:structure-build-start')
    expect(customMeshSfx('operation-commit')).toBe('sfx:structure-build')
    expect(customMeshSfx('delete')).toBe('sfx:structure-delete')
    expect(customMeshSfx('cancel')).toBe('sfx:menu-click')
    expect(customMeshSfx('finish')).toBe('sfx:item-place')
  })
})
