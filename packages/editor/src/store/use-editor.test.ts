import { describe, expect, test } from 'bun:test'
import useEditor from './use-editor'

describe('editor canvas annotation overlays', () => {
  test('can toggle equipment and data binding overlays without changing edit mode', () => {
    useEditor.setState({
      mode: 'select',
      showDataBindingOverlay: false,
      showEquipmentOverlay: false,
      tool: null,
    })

    expect(useEditor.getState().showEquipmentOverlay).toBe(false)
    expect(useEditor.getState().showDataBindingOverlay).toBe(false)

    useEditor.getState().setShowEquipmentOverlay(true)
    useEditor.getState().setShowDataBindingOverlay(true)

    expect(useEditor.getState().showEquipmentOverlay).toBe(true)
    expect(useEditor.getState().showDataBindingOverlay).toBe(true)
    expect(useEditor.getState().mode).toBe('select')
    expect(useEditor.getState().tool).toBeNull()
  })
})
