import { afterEach, describe, expect, test } from 'bun:test'
import useEditor, { normalizePersistedEditorUiState } from './use-editor'

function resetToolMode() {
  useEditor.getState().setPhase('structure')
  useEditor.getState().setStructureLayer('elements')
  useEditor.getState().armToolMode({ mode: 'select' })
  useEditor.getState().setActivePaintMaterial(null)
}

afterEach(resetToolMode)

describe('ToolMode transition', () => {
  test('choosing a paint swatch while selected arms material paint', () => {
    useEditor.getState().armToolMode({ mode: 'select' })
    useEditor.getState().armMaterialPaint({
      materialPreset: 'library:test-paint',
      sourceTarget: 'wall',
    })

    expect(useEditor.getState().toolMode).toEqual({ mode: 'material-paint' })
    expect(useEditor.getState().mode).toBe('material-paint')
    expect(useEditor.getState().tool).toBeNull()
    expect(useEditor.getState().activePaintMaterial?.materialPreset).toBe('library:test-paint')
  })

  test('leaving build clears the materialized tool', () => {
    useEditor.getState().armToolMode({ mode: 'build', tool: 'wall' })
    useEditor.getState().armToolMode({ mode: 'select' })

    expect(useEditor.getState().toolMode).toEqual({ mode: 'select' })
    expect(useEditor.getState().mode).toBe('select')
    expect(useEditor.getState().tool).toBeNull()
  })

  test('the setMode compatibility wrapper elects a default build tool', () => {
    useEditor.getState().setMode('build')

    expect(useEditor.getState().toolMode).toEqual({ mode: 'build', tool: 'wall' })
    expect(useEditor.getState().mode).toBe('build')
    expect(useEditor.getState().tool).toBe('wall')
  })

  test('setTool enters build and null exits it', () => {
    useEditor.getState().armToolMode({ mode: 'select' })
    useEditor.getState().setTool('slab')

    expect(useEditor.getState().toolMode).toEqual({ mode: 'build', tool: 'slab' })
    expect(useEditor.getState().mode).toBe('build')
    expect(useEditor.getState().tool).toBe('slab')

    useEditor.getState().setTool(null)
    expect(useEditor.getState().toolMode).toEqual({ mode: 'select' })
    expect(useEditor.getState().tool).toBeNull()
  })
})

describe('persisted ToolMode normalization', () => {
  test('elects a default for build with a null tool', () => {
    const state = normalizePersistedEditorUiState({
      phase: 'structure',
      toolMode: { mode: 'build', tool: null as never },
      mode: 'select',
      tool: 'slab',
      structureLayer: 'elements',
    })

    expect(state.toolMode).toEqual({ mode: 'build', tool: 'wall' })
    expect(state.mode).toBe('build')
    expect(state.tool).toBe('wall')
  })

  test('clears a persisted tool from a non-build mode', () => {
    const state = normalizePersistedEditorUiState({
      phase: 'structure',
      toolMode: { mode: 'select' },
      mode: 'build',
      tool: 'wall',
      structureLayer: 'elements',
    })

    expect(state.toolMode).toEqual({ mode: 'select' })
    expect(state.mode).toBe('select')
    expect(state.tool).toBeNull()
  })
})
