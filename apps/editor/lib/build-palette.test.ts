import { afterEach, describe, expect, test } from 'bun:test'
import { emitter } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import {
  activateBuildTool,
  activateSelectMode,
  collectXRBuildPaletteManifest,
  XR_MEP_ITEMS,
} from './build-palette'

describe('build palette actions', () => {
  afterEach(() => {
    useEditor.getState().setMode('select')
  })

  test('cancels the active tool before returning to Select mode', () => {
    const editor = useEditor.getState()
    editor.setPhase('structure')
    editor.setMode('build')
    editor.setTool('door')
    let modeWhenCancelled: string | null = null
    const onCancel = () => {
      modeWhenCancelled = useEditor.getState().mode
    }
    emitter.on('tool:cancel', onCancel)

    try {
      activateSelectMode()
    } finally {
      emitter.off('tool:cancel', onCancel)
    }

    expect(modeWhenCancelled).toBe('build')
    expect(useEditor.getState().mode).toBe('select')
    expect(useEditor.getState().tool).toBeNull()
  })

  test('exposes every XR submenu entry once with Select first', () => {
    const manifest = collectXRBuildPaletteManifest('expert')

    for (const entries of Object.values(manifest)) {
      expect(entries[0]).toBe('select')
      expect(new Set(entries).size).toBe(entries.length)
    }
    expect(manifest.mep.slice(1)).toEqual(XR_MEP_ITEMS.map((entry) => entry.id))
  })

  test('clears selection and exposes the chosen tool defaults', () => {
    useEditor.getState().setToolDefaults('wall', { height: 9 })

    activateBuildTool('wall')

    expect(useEditor.getState().mode).toBe('build')
    expect(useEditor.getState().tool).toBe('wall')
    expect(useEditor.getState().toolDefaults.wall).toBeUndefined()
  })
})
