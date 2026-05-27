import type { AnyNode, EditorApi, FenceNode, WallNode } from '@pascal-app/core'
import useEditor from '../store/use-editor'

type EditorState = ReturnType<typeof useEditor.getState>
type EndpointEngager = (node: AnyNode, endpoint: 'start' | 'end', editor: EditorState) => void

/**
 * Per-kind endpoint-move engagement. Kinds whose 2D endpoint drag
 * needs its own store field (wall ↔ `movingWallEndpoint`, fence ↔
 * `movingFenceEndpoint`) register their bridge here. The dispatcher
 * is a table lookup rather than an `if (type === 'wall')` chain so
 * adding a new endpoint-draggable kind is a one-line entry instead
 * of a new branch. Each entry casts the generic `AnyNode` to its
 * concrete kind — the lookup key already guarantees the type.
 */
const endpointEngagers: Record<string, EndpointEngager> = {
  wall: (node, endpoint, editor) =>
    editor.setMovingWallEndpoint({ wall: node as WallNode, endpoint }),
  fence: (node, endpoint, editor) =>
    editor.setMovingFenceEndpoint({ fence: node as FenceNode, endpoint }),
}

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
      endpointEngagers[node.type]?.(node, endpoint, useEditor.getState())
    },
  }
}
