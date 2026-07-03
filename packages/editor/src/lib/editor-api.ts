import type {
  AnyNode,
  CableTrayNode,
  ConveyorBeltNode,
  EditorApi,
  FenceNode,
  PipeNode,
  RoadNode,
  SteelBeamNode,
  WallNode,
} from '@pascal-app/core'
import useEditor from '../store/use-editor'

type EditorState = ReturnType<typeof useEditor.getState>
type EndpointEngager = (node: AnyNode, endpoint: 'start' | 'end', editor: EditorState) => void
type CurveEngager = (node: AnyNode, editor: EditorState) => void

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
  pipe: (node, endpoint, editor) =>
    editor.setMovingPipeEndpoint({ pipe: node as PipeNode, endpoint }),
  'cable-tray': (node, endpoint, editor) =>
    editor.setMovingCableTrayEndpoint({
      cableTray: node as CableTrayNode,
      endpoint,
    }),
  'conveyor-belt': (node, endpoint, editor) =>
    editor.setMovingConveyorBeltEndpoint({
      conveyorBelt: node as ConveyorBeltNode,
      endpoint,
    }),
  road: (node, endpoint, editor) =>
    editor.setMovingRoadEndpoint({ road: node as RoadNode, endpoint }),
  'steel-beam': (node, endpoint, editor) =>
    editor.setMovingSteelBeamEndpoint({
      steelBeam: node as SteelBeamNode,
      endpoint,
    }),
}

const curveEngagers: Record<string, CurveEngager> = {
  wall: (node, editor) => editor.setCurvingWall(node as WallNode),
  fence: (node, editor) => editor.setCurvingFence(node as FenceNode),
  pipe: (node, editor) => editor.setCurvingPipe(node as PipeNode),
  'cable-tray': (node, editor) => editor.setCurvingCableTray(node as CableTrayNode),
  road: (node, editor) => editor.setCurvingRoad(node as RoadNode),
  'steel-beam': (node, editor) => editor.setCurvingSteelBeam(node as SteelBeamNode),
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
      endpointEngagers[node.type]?.(node, endpoint, editor)
    },
    engageCurve(node: AnyNode) {
      const editor = useEditor.getState()
      editor.setMovingNode(null)
      clearEndpointAndCurveState(editor)
      curveEngagers[node.type]?.(node, editor)
    },
  }
}
