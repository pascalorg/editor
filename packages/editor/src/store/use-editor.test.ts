import { describe, expect, test } from 'bun:test'
import useEditor from './use-editor'

describe('editor canvas lens state', () => {
  test('defaults to layout lens and can switch lens without changing edit mode', () => {
    useEditor.setState({ canvasLens: 'layout', mode: 'select', tool: null })

    expect(useEditor.getState().canvasLens).toBe('layout')

    useEditor.getState().setCanvasLens('process')

    expect(useEditor.getState().canvasLens).toBe('process')
    expect(useEditor.getState().mode).toBe('select')
    expect(useEditor.getState().tool).toBeNull()
  })
})
