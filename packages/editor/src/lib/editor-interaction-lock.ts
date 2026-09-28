import {
  acquireSceneReadOnlyLease,
  emitter,
  useLiveNodeOverrides,
  useLiveTransforms,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useDeleteConfirmation from '../store/use-delete-confirmation'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'

export function acquireEditorInteractionLock(): () => void {
  // A tool's cancellation may restore its pre-drag values, so let it finish
  // before blocking committed scene writes.
  emitter.emit('tool:cancel')
  useDeleteConfirmation.getState().cancel()
  useEditor.getState().setMode('select')
  useInteractionScope.getState().end()
  useLiveTransforms.getState().clearAll()
  useLiveNodeOverrides.getState().clearAll()
  useViewer.getState().setInputDragging(false)
  return acquireSceneReadOnlyLease()
}
