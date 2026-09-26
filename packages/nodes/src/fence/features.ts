import { emitter } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'

export function beginFenceFeaturePlacement(kind: 'gate' | 'opening') {
  emitter.emit('tool:cancel')
  const editor = useEditor.getState()
  editor.setPhase('structure')
  editor.setStructureLayer('elements')
  editor.setMode('build')
  editor.setTool('fence')
  editor.setToolDefaults('fence', { featurePlacement: kind })
  useViewer.getState().setSelection({ selectedIds: [] })
}
