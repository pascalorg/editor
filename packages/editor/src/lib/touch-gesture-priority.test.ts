import { describe, expect, test } from 'bun:test'
import type { Mode } from '../store/use-editor'
import { editorOwnsOneFingerDrag } from './touch-gesture-priority'

/**
 * One finger on a touch screen is one pointer, so the camera and the editor
 * cannot both have it. These lock which side wins, because the failure is silent:
 * the loser's handlers simply never fire.
 */
describe('editorOwnsOneFingerDrag', () => {
  const ALL_MODES: Mode[] = [
    'select',
    'edit',
    'delete',
    'build',
    'material-paint',
    'terrain-sculpt',
  ]

  test('the camera keeps one finger when nothing is going on', () => {
    expect(editorOwnsOneFingerDrag({ mode: 'select', activeGesture: false })).toBe(false)
  })

  test('both brush modes claim it with no transient gesture at all', () => {
    // The regression: a brush mode arms nothing that the transient terms can see,
    // so before this the camera orbited under a one-finger sculpt or paint drag.
    expect(editorOwnsOneFingerDrag({ mode: 'terrain-sculpt', activeGesture: false })).toBe(true)
    expect(editorOwnsOneFingerDrag({ mode: 'material-paint', activeGesture: false })).toBe(true)
  })

  test('a live gesture claims it in every mode', () => {
    for (const mode of ALL_MODES) {
      expect(editorOwnsOneFingerDrag({ mode, activeGesture: true })).toBe(true)
    }
  })

  test('the non-brush modes leave it to the camera when idle', () => {
    // Asserted as the complement of the brush set rather than a list, so adding a
    // third brush mode cannot quietly land here as "camera wins".
    const idle = ALL_MODES.filter(
      (mode) => !editorOwnsOneFingerDrag({ mode, activeGesture: false }),
    )
    expect(idle).toEqual(['select', 'edit', 'delete', 'build'])
  })
})
