import type {
  AnyNode,
  AnyNodeId,
  ConstructionDrawingType,
  DrawingSheetNode,
  FloorplanGeometry,
  GeometryContext,
  NodeDefinition,
  SceneApi,
} from '@pascal-app/core'
import type { ComponentType } from 'react'

export const FLOORPLAN_NODE_EXTENSION_KEY = 'pascal:editor/floorplan'
export const FLOORPLAN_GEOMETRY_METADATA_KEY = 'pascal:editor/floorplan'
export const FLOORPLAN_CONTEXT_EXTENSION_KEY = 'pascal:editor/floorplan'

export type FloorplanRenderPurpose = 'edit' | 'document'
export type FloorplanMetricNotation = 'meters' | 'millimeters'
export type FloorplanWallDimensionReference = 'finished-faces' | 'centerline' | 'stud-faces'
export const DEFAULT_FLOORPLAN_WALL_DIMENSION_REFERENCE = 'finished-faces'
export type FloorplanAnnotationRole =
  | 'automatic-dimension'
  | 'manual-dimension'
  | 'measurement'
  | 'opening-mark'
  | 'structural-grid'
  | 'column-center'
  | 'room-label'
  | 'stair-annotation'

export type FloorplanSchedule = {
  id: string
  title: string
  columns: ReadonlyArray<{
    key: string
    label: string
    weight?: number
  }>
  rows: ReadonlyArray<{
    id: string
    cells: Readonly<Record<string, string>>
  }>
  issues?: readonly string[]
}

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
  preferredView?: '2d' | '3d'
  actionMenu?: {
    canCurve?: (args: { node: N; nodes: Readonly<Record<AnyNodeId, AnyNode>> }) => boolean
  }
  resolveDrawingSheet?: (args: {
    node: N
    levelId: AnyNodeId
    drawingType: ConstructionDrawingType
  }) => DrawingSheetNode | null
  schedule?: (args: {
    siblings: ReadonlyArray<N>
    nodes: Readonly<Record<string, AnyNode>>
    levelId: AnyNodeId
    unit: 'metric' | 'imperial'
  }) => FloorplanSchedule | null
  linkedLevelIds?: (node: N) => readonly AnyNodeId[]
  resolveForDrawing?: (args: {
    node: N
    nodes: Record<string, AnyNode>
    drawingType: ConstructionDrawingType
  }) => AnyNode | null
}

type FloorplanGeometryMetadata = {
  annotationRole?: FloorplanAnnotationRole
  annotationObstacle?: 'bounds' | 'outline'
}

type FloorplanContextExtension = {
  purpose: FloorplanRenderPurpose
  metricNotation: FloorplanMetricNotation
  wallDimensionReference: FloorplanWallDimensionReference
}

export function normalizeFloorplanWallDimensionReference(
  value: unknown,
): FloorplanWallDimensionReference {
  return value === 'centerline' || value === 'stud-faces'
    ? value
    : DEFAULT_FLOORPLAN_WALL_DIMENSION_REFERENCE
}

export function getFloorplanNodeExtension(
  definition: NodeDefinition<any> | undefined,
): FloorplanNodeExtension | undefined {
  return definition?.extensions?.[FLOORPLAN_NODE_EXTENSION_KEY] as
    | FloorplanNodeExtension
    | undefined
}

export function floorplanGeometryMetadata(
  values: FloorplanGeometryMetadata,
): Readonly<Record<string, unknown>> {
  return { [FLOORPLAN_GEOMETRY_METADATA_KEY]: values }
}

export function withFloorplanGeometryMetadata<T extends FloorplanGeometry | null>(
  geometry: T,
  values: FloorplanGeometryMetadata,
): T {
  if (!geometry) return geometry
  const existing = readFloorplanGeometryMetadata(geometry)
  return {
    ...geometry,
    metadata: floorplanGeometryMetadata({ ...existing, ...values }),
  } as T
}

export function readFloorplanGeometryMetadata(geometry: unknown): FloorplanGeometryMetadata {
  const metadata = (geometry as { metadata?: Readonly<Record<string, unknown>> } | null)?.metadata
  const value = metadata?.[FLOORPLAN_GEOMETRY_METADATA_KEY]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as FloorplanGeometryMetadata)
    : {}
}

export function createFloorplanContextExtensions(
  values: Partial<FloorplanContextExtension>,
): Readonly<Record<string, unknown>> {
  return {
    [FLOORPLAN_CONTEXT_EXTENSION_KEY]: {
      purpose: values.purpose === 'document' ? 'document' : 'edit',
      metricNotation: values.metricNotation === 'millimeters' ? 'millimeters' : 'meters',
      wallDimensionReference: normalizeFloorplanWallDimensionReference(
        values.wallDimensionReference,
      ),
    } satisfies FloorplanContextExtension,
  }
}

export function readFloorplanContext(ctx: GeometryContext): FloorplanContextExtension {
  const value = ctx.extensions?.[FLOORPLAN_CONTEXT_EXTENSION_KEY]
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const extension = value as Partial<FloorplanContextExtension>
    return {
      purpose: extension.purpose === 'document' ? 'document' : 'edit',
      metricNotation: extension.metricNotation === 'millimeters' ? 'millimeters' : 'meters',
      wallDimensionReference: normalizeFloorplanWallDimensionReference(
        extension.wallDimensionReference,
      ),
    }
  }
  return {
    purpose: 'edit',
    metricNotation: 'meters',
    wallDimensionReference: DEFAULT_FLOORPLAN_WALL_DIMENSION_REFERENCE,
  }
}

export function readFloorplanMetricNotationOverride(
  ctx: GeometryContext,
): FloorplanMetricNotation | undefined {
  const value = ctx.extensions?.[FLOORPLAN_CONTEXT_EXTENSION_KEY]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const metricNotation = (value as { metricNotation?: unknown }).metricNotation
  return metricNotation === 'meters' || metricNotation === 'millimeters'
    ? metricNotation
    : undefined
}
