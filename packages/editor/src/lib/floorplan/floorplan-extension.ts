import type {
  AnyNode,
  AnyNodeId,
  ConstructionDrawingType,
  FloorplanAnnotationRole,
  FloorplanGeometry,
  FloorplanMetricNotation,
  FloorplanSchedule,
  FloorplanWallDimensionFaces,
  GeometryContext,
  NodeDefinition,
  SceneApi,
} from '@pascal-app/core'
import type { ComponentType } from 'react'
import type { WallSelectionDimension } from '../room-push-dimensions'

export const FLOORPLAN_NODE_EXTENSION_KEY = 'pascal:editor/floorplan'

export type FloorplanToolMode = 'default' | 'expert'
export type FloorplanToolContext = {
  sceneApi: SceneApi
  activeLevelId: AnyNodeId | null
  unit: 'metric' | 'imperial'
  metricNotation: FloorplanMetricNotation
  gridSnapStep: number
  toolDefaults: Readonly<Record<string, unknown>> | null
  selectNode: (id: AnyNodeId) => void
  finishTool: () => void
}

export type FloorplanNodeExtension<N extends AnyNode = AnyNode> = {
  tool?: () => Promise<{ default: ComponentType<FloorplanToolContext> }>
  directDrag?: boolean
  availableModes?: readonly FloorplanToolMode[]
  preferredView?: '2d' | '3d'
  referencedSelectionAnnotationRole?: FloorplanAnnotationRole
  contextualDimensions?: (node: N, ctx: GeometryContext) => FloorplanGeometry | null
  /**
   * A plan hit on this kind selects the node itself, not the room it bounds
   * (3D stays room-first). For thin boundary bands whose rooms are clickable
   * on either side of them.
   */
  planHitSelectsNode?: boolean
  /**
   * Temporary dimensions shown while this node is selected in Select mode,
   * alone or with others, in 2D and 3D (level-local plan points). Its
   * `contextualDimensions` also stay in a multi-selection. Each is typeable:
   * `commitDimensionValue` drives the node so it reads the typed value.
   * Recomputed when the node or its level's rooms change.
   */
  selectionDimensions?: (args: {
    node: N
    nodes: Readonly<Record<AnyNodeId, AnyNode>>
    faces: FloorplanWallDimensionFaces
  }) => readonly WallSelectionDimension[]
  actionMenu?: {
    canCurve?: (args: { node: N; nodes: Readonly<Record<AnyNodeId, AnyNode>> }) => boolean
    /** Buttons the kind adds to the selection's action menu (2D and 3D); each decides its own visibility. */
    actions?: () => Promise<{ default: ComponentType }>
  }
  /**
   * Plan layers mounted while a node of this kind is in a `reshaping` scope of
   * that name (the 2D sibling of `def.affordanceTools[reshape]`).
   */
  reshapeLayers?: Record<string, () => Promise<{ default: ComponentType<FloorplanToolContext> }>>
  /**
   * Nodes the plan treats as one with this node when toggling it out of a
   * selection (a slab and its ceiling share an outline and a click).
   */
  selectionCounterparts?: (args: {
    node: N
    nodes: Readonly<Record<AnyNodeId, AnyNode>>
  }) => AnyNodeId[]
  schedule?: (args: {
    siblings: ReadonlyArray<N>
    nodes: Readonly<Record<string, AnyNode>>
    levelId: AnyNodeId
    unit: 'metric' | 'imperial'
    /** A drafted sheet's schedule: marks match the sheet's tags. */
    drafting?: boolean
  }) => FloorplanSchedule | null
  resolveForDrawing?: (args: {
    node: N
    nodes: Record<string, AnyNode>
    drawingType: ConstructionDrawingType
  }) => AnyNode | null
}

export function getFloorplanNodeExtension(
  definition: NodeDefinition<any> | undefined,
): FloorplanNodeExtension | undefined {
  return definition?.extensions?.[FLOORPLAN_NODE_EXTENSION_KEY] as
    | FloorplanNodeExtension
    | undefined
}
