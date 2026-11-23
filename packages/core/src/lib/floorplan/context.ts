import type { FloorplanGeometry, FloorplanPalette, GeometryContext } from '../../registry/types'
import type { AnyNode, AnyNodeId } from '../../schema'

/** The `def.floorplan` contract every plan host shares: context extensions and geometry metadata. */
export const FLOORPLAN_GEOMETRY_METADATA_KEY = 'pascal:editor/floorplan'
export const FLOORPLAN_CONTEXT_EXTENSION_KEY = 'pascal:editor/floorplan'

export type FloorplanRenderPurpose = 'edit' | 'document'
export type FloorplanMetricNotation = 'meters' | 'millimeters'
/**
 * Display → Measure walls: which finished faces wall dimensions measure to —
 * the interior faces (ID, the room sizes), the exterior faces (OD, the
 * outside size) or both. Read by a selected wall's temporary dimensions in 2D
 * and 3D and by the Expert plan's automatic dimension strings.
 */
export type FloorplanWallDimensionFaces = 'interior' | 'exterior' | 'both'
export const DEFAULT_FLOORPLAN_WALL_DIMENSION_FACES: FloorplanWallDimensionFaces = 'both'

export function normalizeFloorplanWallDimensionFaces(value: unknown): FloorplanWallDimensionFaces {
  return value === 'interior' || value === 'exterior'
    ? value
    : DEFAULT_FLOORPLAN_WALL_DIMENSION_FACES
}
export type FloorplanAnnotationRole =
  | 'automatic-dimension'
  | 'contextual-dimension'
  | 'manual-dimension'
  | 'measurement'
  | 'opening-mark'
  | 'structural-grid'
  | 'column-center'
  | 'room-label'
  /** A room's finish / ceiling-height lines — detail under the name, off in the clean plan. */
  | 'room-detail'
  /** The roof plan proper: outline, ridges, hips, slope arrows. Off over a floor plan unless asked. */
  | 'roof-plan'
  | 'roof-pitch'
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

type FloorplanGeometryMetadata = {
  annotationRole?: FloorplanAnnotationRole
  annotationObstacle?: 'bounds' | 'outline'
  renderPass?: 'overlay'
  /**
   * Annotation text only: the size to print at, in paper points, instead of
   * the size its role implies. Lets a sheet set a room tag's name larger than
   * its number without inventing a role per size.
   */
  textSizePt?: number
}

type FloorplanContextExtension = {
  automaticDimensions: boolean
  purpose: FloorplanRenderPurpose
  /**
   * Sheet drafting (the Sheets plan viewports): kinds draw the permit-set
   * convention — fixtures as labelled linework, furniture as light outlines,
   * no raster sprites. Only `collectSheetGeometry` sets it; the editor and the
   * read-only viewer never do, so their plans keep today's look.
   */
  drafting: boolean
  /**
   * The editor canvas draws room labels as screen pills over the plan
   * (`RoomLabels2D`), so zones skip their drawn tags and wash there. Exports,
   * sheets and the read-only viewer keep the drawn tags.
   */
  roomLabelOverlay: boolean
  metricNotation: FloorplanMetricNotation
  wallDimensionFaces: FloorplanWallDimensionFaces
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

export function isFloorplanAnnotationObstacleGeometry(geometry: FloorplanGeometry): boolean {
  if (floorplanAnnotationObstacleMode(geometry)) return true
  if (geometry.kind !== 'group') return false
  const hasPlate = geometry.children.some(
    (child) => child.kind === 'rect' || child.kind === 'circle',
  )
  const hasUprightText = geometry.children.some((child) => child.kind === 'text' && child.upright)
  return hasPlate && hasUprightText
}

export function floorplanAnnotationObstacleMode(
  geometry: FloorplanGeometry,
): 'bounds' | 'outline' | '' | undefined {
  const metadata = readFloorplanGeometryMetadata(geometry)
  if (metadata.annotationObstacle) return metadata.annotationObstacle
  switch (metadata.annotationRole) {
    case 'room-label':
      return geometry.kind === 'text' ? 'bounds' : undefined
    case 'column-center':
      return geometry.kind === 'line' || geometry.kind === 'text' ? 'bounds' : undefined
    case 'stair-annotation':
      return geometry.kind === 'polyline' || geometry.kind === 'line' ? 'outline' : 'bounds'
    default:
      return undefined
  }
}

export function createFloorplanContextExtensions(
  values: Partial<FloorplanContextExtension>,
): Readonly<Record<string, unknown>> {
  return {
    [FLOORPLAN_CONTEXT_EXTENSION_KEY]: {
      automaticDimensions: values.automaticDimensions !== false,
      purpose: values.purpose === 'document' ? 'document' : 'edit',
      drafting: values.drafting === true,
      roomLabelOverlay: values.roomLabelOverlay === true,
      metricNotation: values.metricNotation === 'millimeters' ? 'millimeters' : 'meters',
      wallDimensionFaces: normalizeFloorplanWallDimensionFaces(values.wallDimensionFaces),
    } satisfies FloorplanContextExtension,
  }
}

export function readFloorplanContext(ctx: GeometryContext): FloorplanContextExtension {
  const value = ctx.extensions?.[FLOORPLAN_CONTEXT_EXTENSION_KEY]
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const extension = value as Partial<FloorplanContextExtension>
    return {
      automaticDimensions: extension.automaticDimensions !== false,
      purpose: extension.purpose === 'document' ? 'document' : 'edit',
      drafting: extension.drafting === true,
      roomLabelOverlay: extension.roomLabelOverlay === true,
      metricNotation: extension.metricNotation === 'millimeters' ? 'millimeters' : 'meters',
      wallDimensionFaces: normalizeFloorplanWallDimensionFaces(extension.wallDimensionFaces),
    }
  }
  return {
    automaticDimensions: true,
    purpose: 'edit',
    drafting: false,
    roomLabelOverlay: false,
    metricNotation: 'meters',
    wallDimensionFaces: DEFAULT_FLOORPLAN_WALL_DIMENSION_FACES,
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

export type FloorplanViewState = {
  automaticDimensions?: boolean
  selected: boolean
  unit: 'metric' | 'imperial'
  metricNotation?: 'meters' | 'millimeters'
  purpose?: 'edit' | 'document'
  /** Sheet drafting conventions (see `FloorplanContextExtension.drafting`). */
  drafting?: boolean
  /** Room labels drawn as screen pills (see `FloorplanContextExtension.roomLabelOverlay`). */
  roomLabelOverlay?: boolean
  wallDimensionFaces?: FloorplanWallDimensionFaces
  highlighted: boolean
  hovered: boolean
  moving: boolean
  focusedUnitId?: string
  focusedUnitMemberIds?: readonly string[]
  palette: FloorplanPalette | undefined
}

export function buildFloorplanContext(
  node: AnyNode,
  nodes: Record<string, AnyNode>,
  viewState: FloorplanViewState,
  levelData?: unknown,
): GeometryContext {
  const resolve = <N = AnyNode>(id: AnyNodeId): N | undefined => nodes[id] as N | undefined
  const childIds = (node as { children?: AnyNodeId[] }).children
  const children = Array.isArray(childIds)
    ? childIds.map((id) => nodes[id]).filter((child): child is AnyNode => child !== undefined)
    : []
  const parentId = node.parentId as AnyNodeId | null
  const parent = parentId ? (nodes[parentId] ?? null) : null
  let siblings: AnyNode[] = []
  if (parent) {
    const parentChildIds = (parent as { children?: AnyNodeId[] }).children
    siblings = Array.isArray(parentChildIds)
      ? parentChildIds
          .filter((id) => id !== node.id)
          .map((id) => nodes[id])
          .filter((sibling): sibling is AnyNode => sibling?.type === node.type)
      : Object.values(nodes).filter(
          (candidate) =>
            candidate.id !== node.id &&
            candidate.type === node.type &&
            candidate.parentId === node.parentId,
        )
  }

  return {
    resolve,
    children,
    siblings,
    parent,
    levelData,
    sceneNodes: nodes,
    extensions: createFloorplanContextExtensions({
      automaticDimensions: viewState.automaticDimensions,
      metricNotation: viewState.metricNotation ?? 'meters',
      purpose: viewState.purpose ?? 'edit',
      drafting: viewState.drafting === true,
      roomLabelOverlay: viewState.roomLabelOverlay === true,
      wallDimensionFaces: viewState.wallDimensionFaces,
    }),
    viewState: viewState.palette
      ? {
          selected: viewState.selected,
          unit: viewState.unit,
          highlighted: viewState.highlighted,
          hovered: viewState.hovered,
          moving: viewState.moving,
          focusedUnitId: viewState.focusedUnitId,
          focusedUnitMemberIds: viewState.focusedUnitMemberIds,
          palette: viewState.palette,
        }
      : undefined,
  }
}

export function floorplanLayerRank(type: string): number {
  switch (type) {
    case 'zone':
      return 0
    case 'slab':
    case 'ceiling':
      return 1
    default:
      return 2
  }
}
