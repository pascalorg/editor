import type { AnyNode, EditorApi, FenceNode, WallNode } from '@pascal-app/core'
import useEditor from '../store/use-editor'

/**
 * Concrete {@link EditorApi} backed by `useEditor`. Descriptors call into
 * editor state through this interface; the editor owns the actual setter
 * names so core stays decoupled.
 *
 * `engageMove` clears any in-progress endpoint drag or curve gesture so
 * the move tool takes over cleanly — mirrors the legacy bookkeeping that
 * lived inside `WallMoveArrowHandle.activateWallMove` / `FenceMoveArrowHandle`.
 */
export function createEditorApi(): EditorApi {
  return {
    engageMove(node: AnyNode) {
      const editor = useEditor.getState()
      // `setMovingNode` is typed against a narrower union than `AnyNode`
      // (every concrete kind enumerated). Descriptors pass any node; the
      // cast lets registry-driven move kinds through without forcing a
      // schema-level type widening.
      editor.setMovingNode(node as Parameters<typeof editor.setMovingNode>[0])
      editor.setMovingWallEndpoint(null)
      editor.setMovingFenceEndpoint(null)
      editor.setCurvingWall(null)
      editor.setCurvingFence(null)
    },
    engageEndpointMove(node: AnyNode, endpoint: 'start' | 'end') {
      const editor = useEditor.getState()
      if (node.type === 'wall') {
        editor.setMovingWallEndpoint({ wall: node as WallNode, endpoint })
      } else if (node.type === 'fence') {
        editor.setMovingFenceEndpoint({ fence: node as FenceNode, endpoint })
      }
    },
  }
}
