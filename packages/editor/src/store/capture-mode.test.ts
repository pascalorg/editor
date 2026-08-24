import { afterEach, describe, expect, test } from 'bun:test'
import useEditor from './use-editor'

function reset() {
  useEditor.getState().setCaptureMode(false)
  useEditor.getState().setViewMode('3d')
  useEditor.getState().setMode('select')
}
afterEach(reset)

describe('captureMode and isCaptureMode lifecycle in useEditor', () => {
  test('defaults to idle / isCaptureMode false', () => {
    reset()
    expect(useEditor.getState().isCaptureMode).toBe(false)
    expect(useEditor.getState().captureMode.mode).toBe('idle')
  })

  test('entering capture mode via boolean true sets standard mode and forces 3D view', () => {
    useEditor.getState().setViewMode('2d')
    useEditor.getState().setCaptureMode(true)

    expect(useEditor.getState().isCaptureMode).toBe(true)
    expect(useEditor.getState().captureMode.mode).toBe('standard')
    expect(useEditor.getState().viewMode).toBe('3d')
  })

  test('entering capture mode via explicit CaptureMode object works', () => {
    useEditor.getState().setCaptureMode({ mode: 'standard', crop: 'area' })

    expect(useEditor.getState().isCaptureMode).toBe(true)
    expect(useEditor.getState().captureMode).toEqual({ mode: 'standard', crop: 'area' })
  })

  test('exiting capture mode restores prior viewMode when entered from 2D', () => {
    useEditor.getState().setViewMode('2d')
    expect(useEditor.getState().viewMode).toBe('2d')

    useEditor.getState().setCaptureMode(true)
    expect(useEditor.getState().viewMode).toBe('3d')

    useEditor.getState().setCaptureMode(false)
    expect(useEditor.getState().isCaptureMode).toBe(false)
    expect(useEditor.getState().captureMode.mode).toBe('idle')
    expect(useEditor.getState().viewMode).toBe('2d')
  })

  test('exiting capture mode restores prior viewMode when entered from split', () => {
    useEditor.getState().setViewMode('split')
    expect(useEditor.getState().viewMode).toBe('split')

    useEditor.getState().setCaptureMode(true)
    expect(useEditor.getState().viewMode).toBe('3d')

    useEditor.getState().setCaptureMode(false)
    expect(useEditor.getState().isCaptureMode).toBe(false)
    expect(useEditor.getState().captureMode.mode).toBe('idle')
    expect(useEditor.getState().viewMode).toBe('split')
  })

  test('toggling capture mode back and forth behaves idempotently', () => {
    useEditor.getState().setViewMode('3d')
    expect(useEditor.getState().isCaptureMode).toBe(false)

    // Toggle on
    useEditor.getState().setCaptureMode(!useEditor.getState().isCaptureMode)
    expect(useEditor.getState().isCaptureMode).toBe(true)
    expect(useEditor.getState().captureMode.mode).toBe('standard')

    // Toggle off
    useEditor.getState().setCaptureMode(!useEditor.getState().isCaptureMode)
    expect(useEditor.getState().isCaptureMode).toBe(false)
    expect(useEditor.getState().captureMode.mode).toBe('idle')
  })
})
