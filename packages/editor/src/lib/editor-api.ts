import type {
  AnyNode,
  EditorApi,
} from '@pascal-app/core'
import { nodeRegistry } from '@pascal-app/core'
import useEditor from '../store/use-editor'

type EditorState = ReturnType<typeof useEditor.getState>

function endpointTargetKey(kind: string) {
  return kind.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())
}

function endpointTarget(node: AnyNode, endpoint: 'start' | 'end') {
  return {
    [endpointTargetKey(node.type)]: node,
    node,
    endpoint,
  }
}

function clearEndpointAndCurveState(editor: EditorState) {
  editor.setMovingWallEndpoint(null)
  editor.setMovingFenceEndpoint(null)
  editor.setMovingPipeEndpoint(null)
  editor.setMovingCableTrayEndpoint(null)
  editor.setMovingConveyorBeltEndpoint(null)
  editor.setMovingRoadEndpoint(null)
  editor.setMovingSteelBeamEndpoint(null)
  editor.setCurvingWall(null)
  editor.setCurvingFence(null)
  editor.setCurvingPipe(null)
  editor.setCurvingCableTray(null)
  editor.setCurvingRoad(null)
  editor.setCurvingSteelBeam(null)
  editor.setActiveAffordance(null)
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
      editor.setPlacementDragMode(false)
      // `setMovingNode` is typed against a narrower union than `AnyNode`
      // (every concrete kind enumerated). Descriptors pass any node; the
      // cast lets registry-driven move kinds through without forcing a
      // schema-level type widening.
      editor.setMovingNode(node as Parameters<typeof editor.setMovingNode>[0])
      clearEndpointAndCurveState(editor)
    },
    engageMoveDrag(node: AnyNode) {
      const editor = useEditor.getState()
      // Flag drag mode BEFORE mounting the move tool so the coordinator reads
      // it at setup and wires its commit-on-release listener.
      editor.setPlacementDragMode(true)
      editor.setMovingNode(node as Parameters<typeof editor.setMovingNode>[0])
      clearEndpointAndCurveState(editor)
    },
    engageEndpointMove(node: AnyNode, endpoint: 'start' | 'end') {
      const editor = useEditor.getState()
      editor.setMovingNode(null)
      clearEndpointAndCurveState(editor)
      const def = nodeRegistry.get(node.type)
      const affordance = def?.actionMenu?.endpointMove?.affordance ?? 'move-endpoint'
      if (!def?.affordanceTools?.[affordance]) return
      const target = endpointTarget(node, endpoint)
      editor.setActiveAffordance({
        node,
        affordance,
        props: {
          endpoint,
          node,
          target,
        },
      })
    },
    engageCurve(node: AnyNode) {
      const editor = useEditor.getState()
      editor.setMovingNode(null)
      clearEndpointAndCurveState(editor)
      const def = nodeRegistry.get(node.type)
      const affordance = def?.actionMenu?.curve?.affordance ?? 'curve'
      if (!def?.affordanceTools?.[affordance]) return
      editor.setActiveAffordance({
        node,
        affordance,
        props: { node },
      })
    },
  }
}
