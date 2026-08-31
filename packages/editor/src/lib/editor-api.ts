import type { AnyNode, EditorApi } from '@pascal-app/core'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import {
  controlPointReshapeScope,
  endpointReshapeScope,
  tangentReshapeScope,
} from './interaction/scope'

/**
 * Concrete {@link EditorApi} backed by `useEditor` + the interaction scope.
 * Descriptors call into editor state through this interface; the editor owns
 * the actual store wiring so core stays decoupled.
 *
 * `engageMove` no longer clears any in-progress endpoint drag or curve gesture:
 * `setMovingNode` begins the `moving` scope, and the scope is single-owner, so
 * it atomically replaces any prior reshape — there is no separate flag to reset.
 */
export function createEditorApi(): EditorApi {
  return {
    engageMove(node: AnyNode) {
      const editor = useEditor.getState()
      editor.setPlacementDragMode(false)
      // `setMovingNode` is typed against a narrower union than `AnyNode`
      // (every concrete kind enumerated). Descriptors pass any node; the
      // cast lets registry-driven move kinds through without forcing a
      // schema-level type widening.
      editor.setMovingNode(node as Parameters<typeof editor.setMovingNode>[0])
    },
    engageMoveDrag(node: AnyNode) {
      const editor = useEditor.getState()
      // Flag drag mode BEFORE mounting the move tool so the coordinator reads
      // it at setup and wires its commit-on-release listener.
      editor.setPlacementDragMode(true)
      editor.setMovingNode(node as Parameters<typeof editor.setMovingNode>[0])
    },
    engageEndpointMove(node: AnyNode, endpoint: 'start' | 'end') {
      // Endpoint reshape is kind-agnostic: the scope carries the node id + which
      // endpoint, and consumers recover the node from the scene. Adding a new
      // endpoint-draggable kind needs no entry here.
      useInteractionScope.getState().begin(endpointReshapeScope(node.id, endpoint))
    },
    engageControlPointMove(node: AnyNode, index: number) {
      useInteractionScope.getState().begin(controlPointReshapeScope(node.id, index))
    },
    engageTangentMove(node: AnyNode, index: number, side: 'in' | 'out') {
      useInteractionScope.getState().begin(tangentReshapeScope(node.id, index, side))
    },
  }
}
