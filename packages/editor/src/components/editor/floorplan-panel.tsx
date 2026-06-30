'use client'

import { Icon } from '@iconify/react'
import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  type CeilingNode,
  CeilingNode as CeilingNodeSchema,
  type ColumnNode,
  calculateLevelMiters,
  DEFAULT_ANGLE_STEP,
  type DoorNode,
  DoorNode as DoorNodeSchema,
  type ElevatorNode,
  emitter,
  type FenceNode,
  type FloorplanGeometry,
  type GeometryContext,
  type GridEvent,
  type GuideNode,
  getRenderableSlabPolygon,
  getWallChordFrame,
  getWallCurveLength,
  getWallPlanFootprint,
  type ItemNode,
  isCurvedWall,
  type LevelNode,
  loadAssetUrl,
  nodeRegistry,
  normalizeWallCurveOffset,
  type Point2D,
  type RoofNode,
  type RoofSegmentNode,
  type SiteNode,
  type SlabNode,
  SlabNode as SlabNodeSchema,
  type SpawnNode,
  type StairNode,
  StairNode as StairNodeSchema,
  type StairSegmentNode,
  StairSegmentNode as StairSegmentNodeSchema,
  sampleWallCenterline,
  sceneRegistry,
  snapPointAlongAngleRay,
  useInteractive,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
  type WallNode,
  WallNode as WallNodeSchema,
  type WindowNode,
  WindowNode as WindowNodeSchema,
  ZoneNode as ZoneNodeSchema,
  type ZoneNode as ZoneNodeType,
} from '@pascal-app/core'
import { useSegmentDraftChain, useWallSnapIndicator } from '@pascal-app/editor'
import { getSceneTheme, useViewer } from '@pascal-app/viewer'
import { Command, Ruler } from 'lucide-react'
import {
  type ComponentProps,
  memo,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { Vector3 } from 'three'
import { useShallow } from 'zustand/react/shallow'
import { resolveCeilingPlanPointSnap } from '../../lib/ceiling-plan-snap'
import {
  alignFloorplanDraftPoint,
  buildFloorplanItemEntry,
  buildFloorplanStairEntry as buildSharedFloorplanStairEntry,
  collectLevelDescendants,
  floorplanLocalToWorldPoint,
  getFloorplanWall as getSharedFloorplanWall,
  rotatePlanVector as rotateSharedPlanVector,
  type FloorplanNodeTransform as SharedFloorplanNodeTransform,
  worldToFloorplanLocalPoint,
} from '../../lib/floorplan'
import { guideEmitter } from '../../lib/guide-events'
import { formatLinearMeasurement, linearUnitToMeters } from '../../lib/measurements'
import { sfxEmitter } from '../../lib/sfx-bus'
import { SITE_BOUNDARY_DRAG_LABEL } from '../../lib/site-boundary'
import { resolveSlabPlanPointSnap } from '../../lib/slab-plan-snap'
import { cn } from '../../lib/utils'
import { snapBuildingLocalToWorldGrid } from '../../lib/world-grid-snap'
import useAlignmentGuides from '../../store/use-alignment-guides'
import type { GuideUiState, NavigationSyncPose } from '../../store/use-editor'
import useEditor, {
  isAngleSnapActive,
  isMagneticSnapActive,
  selectSiteFloorplanContext,
} from '../../store/use-editor'
import { useFloorplanDraftPreview } from '../../store/use-floorplan-draft-preview'
import { useFloorplanMarquee } from '../../store/use-floorplan-marquee'
import useInteractionScope, {
  useActiveHandleDrag,
  useEndpointReshape,
  useIsCurveReshape,
  useMovingNode,
  useReshapingNode,
} from '../../store/use-interaction-scope'
import usePlacementPreview from '../../store/use-placement-preview'
import { useStairBuildPreview } from '../../store/use-stair-build-preview'
import { FloorplanAlignmentGuideLayer } from '../editor-2d/floorplan-alignment-guide-layer'
import { FloorplanCursorIndicatorOverlay as Editor2dFloorplanCursorIndicatorOverlay } from '../editor-2d/floorplan-cursor-indicator-overlay'
import { FloorplanSiteKeyHandler } from '../editor-2d/floorplan-hotkey-handlers'
import { FloorplanRegistryActionMenu } from '../editor-2d/floorplan-registry-action-menu'
import { FloorplanRegistryMoveOverlay } from '../editor-2d/floorplan-registry-move-overlay'
import {
  type FloorplanRenderContextValue,
  FloorplanRenderProvider,
} from '../editor-2d/floorplan-render-context'
import { FloorplanSnapBeaconLayer } from '../editor-2d/floorplan-snap-beacon-layer'
import { FloorplanWallMoveGhostLayer } from '../editor-2d/floorplan-wall-move-ghost-layer'
import { FloorplanDraftLayer } from '../editor-2d/renderers/floorplan-draft-layer'
import { FloorplanGeometryRenderer } from '../editor-2d/renderers/floorplan-geometry-renderer'
import { FloorplanMarqueeLayer } from '../editor-2d/renderers/floorplan-marquee-layer'
import { FloorplanPlacementPreviewLayer } from '../editor-2d/renderers/floorplan-placement-preview-layer'
import { FloorplanRegistryLayer } from '../editor-2d/renderers/floorplan-registry-layer'
import { FloorplanStairLayer } from '../editor-2d/renderers/floorplan-stair-layer'
import { FloorplanVoronoiLayer } from '../editor-2d/renderers/floorplan-voronoi-layer'
import { buildSvgPolylinePath, formatPolygonPath, getArcPlanPoint } from '../editor-2d/svg-paths'
import { snapFenceDraftPoint } from '../tools/fence/fence-drafting'
import { snapToHalf } from '../tools/item/placement-math'
import {
  isBoxSelectPointerSuppressed,
  markBoxSelectHandled,
} from '../tools/select/box-select-state'
import {
  createScreenRectangleSelectionElement,
  hideScreenRectangleSelectionElement,
  intersectScreenRects,
  normalizeScreenRect,
  SCREEN_RECTANGLE_SELECTION_DRAG_THRESHOLD_PX,
  type ScreenRect,
  screenRectFromDomRect,
  screenRectsIntersect,
  updateScreenRectangleSelectionElement,
} from '../tools/select/screen-rectangle-selection'
import { collectSelectableCandidateIds } from '../tools/select/select-candidates'
import {
  formatAngleRadians,
  getAngleArcToSegmentReference,
  getAngleToSegmentReference,
  getSegmentAngleReferenceAtPoint,
} from '../tools/shared/segment-angle'
import {
  DEFAULT_STAIR_ATTACHMENT_SIDE,
  DEFAULT_STAIR_FILL_TO_FLOOR,
  DEFAULT_STAIR_HEIGHT,
  DEFAULT_STAIR_LENGTH,
  DEFAULT_STAIR_STEP_COUNT,
  DEFAULT_STAIR_THICKNESS,
  DEFAULT_STAIR_WIDTH,
} from '../tools/stair/stair-defaults'
import {
  createWallOnCurrentLevel,
  isSegmentLongEnough,
  snapWallDraftPoint,
  snapWallDraftPointDetailed,
  snapPointToGrid as snapWallPointToGrid,
  WALL_GRID_STEP,
  WALL_JOIN_SNAP_RADIUS,
  type WallPlanPoint,
} from '../tools/wall/wall-drafting'

import { PALETTE_COLORS } from '../ui/primitives/color-dot'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/primitives/tooltip'
import { resolveFloorplanBackgroundSelection } from './floorplan-background-selection'
import { useFloorplanBackgroundPlacement } from './use-floorplan-background-placement'
import { useFloorplanHitTesting } from './use-floorplan-hit-testing'
import { useFloorplanSceneData } from './use-floorplan-scene-data'

const FALLBACK_VIEW_SIZE = 12
const FLOORPLAN_PADDING = 2
const MIN_VIEWPORT_WIDTH_RATIO = 0.08
const MAX_VIEWPORT_WIDTH_RATIO = 40
const PANEL_MIN_WIDTH = 420
const PANEL_MIN_HEIGHT = 320
const PANEL_DEFAULT_WIDTH = 560
const PANEL_DEFAULT_HEIGHT = 360
const PANEL_MARGIN = 16
const PANEL_DEFAULT_BOTTOM_OFFSET = 96
const MIN_GRID_SCREEN_SPACING = 12
const GRID_COORDINATE_PRECISION = 6
const MAJOR_GRID_STEP = WALL_GRID_STEP * 2
const FLOORPLAN_MINOR_GRID_STROKE_WIDTH = 0.14
const FLOORPLAN_MAJOR_GRID_STROKE_WIDTH = 0.26
const FLOORPLAN_WALL_THICKNESS_SCALE = 1.18
const FLOORPLAN_MIN_VISIBLE_WALL_THICKNESS = 0.13
const FLOORPLAN_MAX_EXTRA_THICKNESS = 0.035
const FLOORPLAN_PANEL_LAYOUT_STORAGE_KEY = 'pascal-editor-floorplan-panel-layout'
const EMPTY_WALL_MITER_DATA = calculateLevelMiters([])
const EDITOR_CURSOR = "url('/cursor.svg') 4 2, default"
const FLOORPLAN_CURSOR_INDICATOR_LINE_HEIGHT = 18
const FLOORPLAN_CURSOR_BADGE_OFFSET_X = 14
const FLOORPLAN_CURSOR_BADGE_OFFSET_Y = 14
const FLOORPLAN_CURSOR_MARKER_CORE_RADIUS_PX = 3
const FLOORPLAN_CURSOR_MARKER_GLOW_RADIUS_PX = 10
const FLOORPLAN_DRAFT_ANCHOR_RADIUS_PX = 7
const FLOORPLAN_ENDPOINT_HANDLE_RADIUS_PX = 7
const FLOORPLAN_ENDPOINT_HANDLE_SELECTED_RADIUS_PX = 8
const FLOORPLAN_ENDPOINT_HANDLE_ACTIVE_RADIUS_PX = 9
const FLOORPLAN_ENDPOINT_HANDLE_DOT_RADIUS_PX = 3
const FLOORPLAN_ENDPOINT_HANDLE_ACTIVE_DOT_RADIUS_PX = 4
const FLOORPLAN_CURVE_HANDLE_DOT_RADIUS_PX = 3
const FLOORPLAN_POLYGON_VERTEX_RADIUS_PX = 6.5
const FLOORPLAN_POLYGON_VERTEX_ACTIVE_RADIUS_PX = 7.5
const FLOORPLAN_POLYGON_VERTEX_DOT_RADIUS_PX = 2.5
const FLOORPLAN_POLYGON_VERTEX_ACTIVE_DOT_RADIUS_PX = 3
const FLOORPLAN_POLYGON_MIDPOINT_RADIUS_PX = 4
const FLOORPLAN_POLYGON_MIDPOINT_HOVER_RADIUS_PX = 4.6
const FLOORPLAN_POLYGON_MIDPOINT_DOT_RADIUS_PX = 1.8
const FLOORPLAN_POLYGON_EDGE_HIT_STROKE_WIDTH_PX = 30
const FLOORPLAN_POLYGON_EDGE_HOVER_GLOW_STROKE_WIDTH_PX = 12
const FLOORPLAN_POLYGON_EDGE_VISIBLE_STROKE_WIDTH_PX = 4
const FLOORPLAN_MARQUEE_OUTLINE_WIDTH = 0.055
const FLOORPLAN_MARQUEE_GLOW_WIDTH = 0.14
const FLOORPLAN_HOVER_TRANSITION = 'opacity 180ms cubic-bezier(0.2, 0, 0, 1)'
const FLOORPLAN_WALL_HIT_STROKE_WIDTH = 18
const FLOORPLAN_WALL_STROKE_WIDTH = '1'
const FLOORPLAN_OPENING_HIT_STROKE_WIDTH = 16
const noopFloorplanStairHandler = () => {}
const FLOORPLAN_OPENING_STROKE_WIDTH = 0.05
const FLOORPLAN_ENDPOINT_HIT_STROKE_WIDTH = 18
const FLOORPLAN_ENDPOINT_HOVER_GLOW_STROKE_WIDTH = 16
const FLOORPLAN_ENDPOINT_HOVER_RING_STROKE_WIDTH = 7
const FLOORPLAN_MARQUEE_DRAG_THRESHOLD_PX = 4
const FLOORPLAN_ACTION_MENU_HORIZONTAL_PADDING = 60
const FLOORPLAN_ACTION_MENU_MIN_ANCHOR_Y = 56
const FLOORPLAN_DEFAULT_WINDOW_LOCAL_Y = 1.5

// Match the guide plane footprint used in the 3D renderer so the 2D overlay aligns.
const FLOORPLAN_GUIDE_BASE_WIDTH = 10
const FLOORPLAN_GUIDE_MIN_SCALE = 0.01
const FLOORPLAN_GUIDE_HANDLE_SIZE = 0.22
const FLOORPLAN_GUIDE_HANDLE_HIT_RADIUS = 0.3
const FLOORPLAN_GUIDE_SELECTION_STROKE_WIDTH = 0.05
const FLOORPLAN_GUIDE_HANDLE_HINT_OFFSET = 72
const FLOORPLAN_GUIDE_HANDLE_HINT_PADDING_X = 92
const FLOORPLAN_GUIDE_HANDLE_HINT_PADDING_Y = 48
const FLOORPLAN_GUIDE_ROTATION_SNAP_DEGREES = 15
const FLOORPLAN_VIEW_ROTATION_DEG = 90
const FLOORPLAN_ROTATION_DEGREES_PER_PIXEL = 0.35
const FLOORPLAN_VIEW_ANIMATION_TIME_CONSTANT_MS = 90
const FLOORPLAN_VIEW_ANIMATION_EPSILON = 0.0005
const FLOORPLAN_ROTATION_ANIMATION_EPSILON_DEG = 0.01
type FloorplanViewport = {
  centerX: number
  centerY: number
  width: number
}

type FloorplanNavigationViewOptions = {
  smooth?: boolean
  clampViewWidth?: boolean
}

type FloorplanViewAnimationTarget = {
  viewport: FloorplanViewport
  userRotationDeg: number
  lastTimestamp: number | null
}

function floorplanViewportEquals(a: FloorplanViewport | null, b: FloorplanViewport | null) {
  if (a === b) return true
  if (!(a && b)) return false
  return a.centerX === b.centerX && a.centerY === b.centerY && a.width === b.width
}

function floorplanViewportWithinEpsilon(
  a: FloorplanViewport,
  b: FloorplanViewport,
  epsilon: number,
) {
  return (
    Math.abs(a.centerX - b.centerX) < epsilon &&
    Math.abs(a.centerY - b.centerY) < epsilon &&
    Math.abs(a.width - b.width) < epsilon
  )
}

type SvgPoint = {
  x: number
  y: number
}

type PanState = {
  pointerId: number
  clientX: number
  clientY: number
  centerSvg: SvgPoint
}

type FloorplanRotationState = {
  pointerId: number
  startClientX: number
  initialUserRotationDeg: number
  viewportCenterLocal: SvgPoint
}

type FloorplanScreenSelectionState = {
  pointerId: number
  startClientX: number
  startClientY: number
  currentClientX: number
  currentClientY: number
  isDragging: boolean
}

type GestureLikeEvent = Event & {
  clientX?: number
  clientY?: number
  scale?: number
}

type PanelRect = {
  x: number
  y: number
  width: number
  height: number
}

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

type PanelInteractionState = {
  pointerId: number
  startClientX: number
  startClientY: number
  initialRect: PanelRect
  type: 'drag' | 'resize'
  direction?: ResizeDirection
}

type ViewportBounds = {
  width: number
  height: number
}

type OpeningNode = WindowNode | DoorNode

type WallEndpoint = 'start' | 'end'

type FloorplanCursorIndicator =
  | {
      kind: 'asset'
      iconSrc: string
    }
  | {
      kind: 'icon'
      icon: string
    }

type PersistedPanelLayout = {
  rect: PanelRect
  viewport: ViewportBounds
}

type FloorplanSelectionBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

type LinkedWallSnapshot = {
  id: WallNode['id']
  start: WallPlanPoint
  end: WallPlanPoint
}

type WallEndpointDragState = {
  pointerId: number
  wallId: WallNode['id']
  endpoint: WallEndpoint
  fixedPoint: WallPlanPoint
  currentPoint: WallPlanPoint
  originalStart: WallPlanPoint
  originalEnd: WallPlanPoint
  linkedWalls: LinkedWallSnapshot[]
}

type WallCurveDragState = {
  pointerId: number
  wallId: WallNode['id']
  currentCurveOffset: number
}

type PendingFenceDragState = {
  pointerId: number
  fenceId: FenceNode['id']
  startClientX: number
  startClientY: number
}

type ElevatorResizeHandle =
  | 'width-negative'
  | 'width-positive'
  | 'depth-negative'
  | 'depth-positive'

type ElevatorResizeDragState = {
  center: Point2D
  elevatorId: ElevatorNode['id']
  handle: ElevatorResizeHandle
  pointerId: number
  rotation: number
  shaftWallThickness: number
}

const GUIDE_CORNERS = ['nw', 'ne', 'se', 'sw'] as const

type GuideCorner = (typeof GUIDE_CORNERS)[number]

type GuideInteractionMode = 'resize' | 'rotate' | 'translate'

type GuideTransformDraft = {
  guideId: GuideNode['id']
  position: WallPlanPoint
  scale: number
  rotation: number
}

type ReferenceScaleUnit = 'meters' | 'centimeters' | 'feet' | 'inches'

// The in-flight reference-scale measurement. Only the per-CLICK fields live
// here (guide + start anchor); the rubber-band's moving END is the shared
// `useFloorplanDraftPreview.cursorPoint` (set on every move anyway), so it
// never re-renders the panel — `FloorplanReferenceScaleDraftLine` reads it.
type ReferenceScaleDraft = {
  guideId: GuideNode['id']
  start: WallPlanPoint | null
}

type PendingReferenceScale = {
  guideId: GuideNode['id']
  start: WallPlanPoint
  end: WallPlanPoint
  measuredLengthUnits: number
}

type GuideHandleHintAnchor = {
  x: number
  y: number
  directionX: number
  directionY: number
}

function FloorplanCompassButton({
  northRotationDeg,
  onAlignNorth,
}: {
  northRotationDeg: number
  onAlignNorth: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label="Align view to north"
          className="group absolute bottom-3 left-3 z-30 flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-white/85 shadow-sm backdrop-blur-md transition hover:bg-white hover:shadow-md dark:border-white/10 dark:bg-neutral-900/85 dark:hover:bg-neutral-900"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onAlignNorth()
          }}
          onPointerDown={(event) => {
            event.stopPropagation()
          }}
          type="button"
        >
          <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-[#b8b8b8] shadow-inner dark:bg-neutral-700">
            <svg
              aria-hidden="true"
              className="h-6 w-6 transition-transform duration-150 ease-out"
              style={{ transform: `rotate(${northRotationDeg}deg)` }}
              viewBox="0 0 48 48"
            >
              <path d="M24 4.5 31.5 25 24 21.5 16.5 25Z" fill="#f15b5b" />
              <path d="M24 43.5 16.5 23 24 26.5 31.5 23Z" fill="#ffffff" />
            </svg>
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">Align view to north</TooltipContent>
    </Tooltip>
  )
}

type GuideInteractionState = {
  pointerId: number
  guideId: GuideNode['id']
  corner: GuideCorner
  mode: GuideInteractionMode
  aspectRatio: number
  centerSvg: SvgPoint
  oppositeCornerSvg: SvgPoint | null
  pointerOffsetSvg: WallPlanPoint
  rotationSvg: number
  cornerBaseAngle: number
  scale: number
}

type WallEndpointDraft = {
  wallId: WallNode['id']
  endpoint: WallEndpoint
  start: WallPlanPoint
  end: WallPlanPoint
  linkedWalls: LinkedWallSnapshot[]
}

type WallCurveDraft = {
  wallId: WallNode['id']
  curveOffset: number
}

type SiteBoundaryDraft = {
  siteId: SiteNode['id']
  polygon: WallPlanPoint[]
}

type SiteVertexDragState = {
  pointerId: number
  siteId: SiteNode['id']
  vertexIndex: number
}

type WallPolygonEntry = {
  wall: WallNode
  polygon: Point2D[]
  points: string
}

type FloorplanFenceEntry = {
  fence: FenceNode
  centerline: Point2D[]
  markerFrames: Array<{
    angleDeg: number
    point: Point2D
  }>
  path: string
}

type OpeningPolygonEntry = {
  opening: OpeningNode
  polygon: Point2D[]
  points: string
}

type SlabPolygonEntry = {
  slab: SlabNode
  polygon: Point2D[]
  holes: Point2D[][]
  visualPolygon: Point2D[]
  visualHoles: Point2D[][]
  path: string
}

type CeilingPolygonEntry = {
  ceiling: CeilingNode
  polygon: Point2D[]
  holes: Point2D[][]
  path: string
}

type SitePolygonEntry = {
  site: SiteNode
  polygon: Point2D[]
  points: string
}

type ZonePolygonEntry = {
  zone: ZoneNodeType
  polygon: Point2D[]
  points: string
}

type FloorplanLineSegment = {
  start: Point2D
  end: Point2D
}

type FloorplanPolygonEntry = {
  points: string
  polygon: Point2D[]
}

type FloorplanItemEntry = {
  dimensionPolygon: Point2D[]
  item: ItemNode
  points: string
  polygon: Point2D[]
  usesRealMesh: boolean
  // Scene-space center (x, y = plan coords) and rotation in radians, plus the
  // footprint dimensions. Used to place the optional floor-plan image overlay
  // in the correct position, orientation, and size.
  center: Point2D
  rotation: number
  width: number
  depth: number
}

type FloorplanSpawnEntry = {
  spawn: SpawnNode
  position: Point2D
  rotation: number
}

type FloorplanColumnEntry = {
  column: ColumnNode
  points: string
  polygon: Point2D[]
}

type FloorplanElevatorServedLevel = {
  id: LevelNode['id']
  isCurrent: boolean
  isDisabled: boolean
  isQueued: boolean
  isServiceOnly: boolean
  isTarget: boolean
  label: string
}

type FloorplanElevatorEntry = {
  cabCenterLocalY: number
  cabDepth: number
  cabWidth: number
  center: Point2D
  doorStyle: ElevatorNode['doorStyle']
  doorWidth: number
  elevator: ElevatorNode
  frontEdge: FloorplanLineSegment
  frontNormal: Point2D
  isCarOnLevel: boolean
  isQueuedLevel: boolean
  isTargetLevel: boolean
  outerHalfDepth: number
  outerHalfWidth: number
  points: string
  polygon: Point2D[]
  rotation: number
  servedLevels: FloorplanElevatorServedLevel[]
  shaftDepth: number
  shaftWallThickness: number
  shaftWidth: number
}

type ReferenceFloorData = {
  ceilingPolygons: CeilingPolygonEntry[]
  columnEntries: ReferenceFloorColumnEntry[]
  fenceEntries: FloorplanFenceEntry[]
  itemEntries: FloorplanItemEntry[]
  openingPolygons: OpeningPolygonEntry[]
  registryEntries: ReferenceFloorRegistryEntry[]
  slabPolygons: SlabPolygonEntry[]
  wallPolygons: WallPolygonEntry[]
}

type ReferenceFloorColumnEntry = {
  column: ColumnNode
  points: string
  polygon: Point2D[]
}

type ReferenceFloorRegistryEntry = {
  geometry: FloorplanGeometry
  node: AnyNode
}

// Top-level structural kinds drawn on the *reference* (dimmed, below) floor
// via their `def.floorplan` builder, so the symbol is identical to the active
// floor. Walls / columns / slabs / fences / items / openings still have
// bespoke reference rendering above; these five are the registry-driven kinds
// that don't.
//
// This is a deliberate curation, NOT "every kind with a `def.floorplan`":
// ~24 kinds expose one, including children (`roof-segment`, `stair-segment`),
// containers (`level`, `building`), and surfaces (`ceiling`, `zone`) that
// either render through a parent's builder or shouldn't appear as standalone
// reference symbols — auto-deriving would double-draw or clutter the floor.
// The list also can't live on `NodeDefinition`: "reference floor" is an
// editor 2D-view concept that `packages/core` must stay unaware of (see
// wiki/architecture/layers.md). New top-level structural kinds opt in here.
const REFERENCE_REGISTRY_KINDS = new Set<AnyNode['type']>([
  'stair',
  'roof',
  'shelf',
  'spawn',
  'elevator',
])

type FloorplanStairSegmentEntry = {
  centerLine: FloorplanLineSegment | null
  innerPoints: string
  innerPolygon: Point2D[]
  segment: StairSegmentNode
  points: string
  polygon: Point2D[]
  treadBars: FloorplanPolygonEntry[]
  treadThickness: number
}

type FloorplanStairArrowEntry = {
  head: Point2D[]
  polyline: Point2D[]
}

type FloorplanStairEntry = {
  arrow: FloorplanStairArrowEntry | null
  hitPolygons: Point2D[][]
  stair: StairNode
  segments: FloorplanStairSegmentEntry[]
}

type FloorplanRoofSegmentEntry = {
  segment: RoofSegmentNode
  polygon: Point2D[]
  points: string
  ridgeLine: FloorplanLineSegment | null
}

type FloorplanRoofEntry = {
  roof: RoofNode
  center: Point2D
  segments: FloorplanRoofSegmentEntry[]
}

type FloorplanPalette = {
  surface: string
  minorGrid: string
  majorGrid: string
  minorGridOpacity: number
  majorGridOpacity: number
  slabFill: string
  slabStroke: string
  selectedSlabFill: string
  selectedSlabStroke: string
  ceilingFill: string
  ceilingStroke: string
  selectedCeilingFill: string
  selectedCeilingStroke: string
  wallFill: string
  wallStroke: string
  wallInnerStroke: string
  wallShadow: string
  wallHoverStroke: string
  deleteFill: string
  deleteStroke: string
  deleteWallFill: string
  deleteWallHoverStroke: string
  selectedFill: string
  selectedStroke: string
  draftFill: string
  draftStroke: string
  cursor: string
  editCursor: string
  anchor: string
  openingFill: string
  openingStroke: string
  measurementStroke: string
  roofFill: string
  roofActiveFill: string
  roofSelectedFill: string
  roofStroke: string
  roofActiveStroke: string
  roofSelectedStroke: string
  roofRidgeStroke: string
  roofSelectedRidgeStroke: string
  stairFill: string
  stairSelectedFill: string
  stairStroke: string
  stairAccent: string
  stairTread: string
  stairSelectedTread: string
  endpointHandleFill: string
  endpointHandleStroke: string
  endpointHandleHoverStroke: string
  endpointHandleActiveFill: string
  endpointHandleActiveStroke: string
  curveHandleFill: string
  curveHandleStroke: string
  curveHandleHoverStroke: string
}

const resizeCursorByDirection: Record<ResizeDirection, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
  sw: 'nesw-resize',
}

const resizeHandleConfigurations: Array<{
  direction: ResizeDirection
  className: string
}> = [
  {
    direction: 'n',
    className: 'absolute top-0 left-4 right-4 z-20 h-2 cursor-ns-resize',
  },
  {
    direction: 's',
    className: 'absolute right-4 bottom-0 left-4 z-20 h-2 cursor-ns-resize',
  },
  {
    direction: 'e',
    className: 'absolute top-4 right-0 bottom-4 z-20 w-2 cursor-ew-resize',
  },
  {
    direction: 'w',
    className: 'absolute top-4 bottom-4 left-0 z-20 w-2 cursor-ew-resize',
  },
  {
    direction: 'ne',
    className: 'absolute top-0 right-0 z-20 h-4 w-4 cursor-nesw-resize',
  },
  {
    direction: 'nw',
    className: 'absolute top-0 left-0 z-20 h-4 w-4 cursor-nwse-resize',
  },
  {
    direction: 'se',
    className: 'absolute right-0 bottom-0 z-20 h-4 w-4 cursor-nwse-resize',
  },
  {
    direction: 'sw',
    className: 'absolute bottom-0 left-0 z-20 h-4 w-4 cursor-nesw-resize',
  },
]

const guideCornerSigns: Record<GuideCorner, { x: -1 | 1; y: -1 | 1 }> = {
  nw: { x: -1, y: -1 },
  ne: { x: 1, y: -1 },
  se: { x: 1, y: 1 },
  sw: { x: -1, y: 1 },
}

const oppositeGuideCorner: Record<GuideCorner, GuideCorner> = {
  nw: 'se',
  ne: 'sw',
  se: 'nw',
  sw: 'ne',
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function resolveFloorplanViewWidth(
  requestedWidth: number,
  currentWidth: number,
  fittedViewport: FloorplanViewport | null,
  clampViewWidth: boolean,
) {
  if (!(Number.isFinite(requestedWidth) && requestedWidth > 0)) {
    return currentWidth
  }

  if (!clampViewWidth || !fittedViewport) {
    return Math.max(0.001, requestedWidth)
  }

  const minWidth = fittedViewport.width * MIN_VIEWPORT_WIDTH_RATIO
  const maxWidth = fittedViewport.width * MAX_VIEWPORT_WIDTH_RATIO

  return clamp(requestedWidth, Math.min(minWidth, currentWidth), Math.max(maxWidth, currentWidth))
}

function roundPlanMeters(value: number) {
  return Math.round(value * 100) / 100
}

function getElevatorResizeAxis(handle: ElevatorResizeHandle) {
  return handle.startsWith('width') ? 'width' : 'depth'
}

function getElevatorResizeSign(handle: ElevatorResizeHandle) {
  return handle.endsWith('positive') ? 1 : -1
}

function getSelectionModifierKeys(event?: {
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
}) {
  return {
    meta: Boolean(event?.metaKey),
    ctrl: Boolean(event?.ctrlKey),
    shift: Boolean(event?.shiftKey),
  }
}

function collectFloorplanScreenSelectionIds(rect: ScreenRect, svg: SVGSVGElement): string[] {
  const scene = svg.querySelector<SVGGElement>('[data-floorplan-scene]')
  if (!scene) {
    return []
  }

  const candidateIds = collectSelectableCandidateIds()
  if (candidateIds.length === 0) {
    return []
  }

  const candidateIdSet = new Set(candidateIds)
  const hitIds = new Set<string>()
  const baseElementsById = new Map<string, SVGGraphicsElement[]>()
  const fallbackElementsById = new Map<string, SVGGraphicsElement[]>()
  const baseLayer = scene.querySelector('.floorplan-registry-base')

  for (const element of scene.querySelectorAll<SVGGraphicsElement>('[data-node-id]')) {
    const id = element.getAttribute('data-node-id')
    if (!id || !candidateIdSet.has(id)) {
      continue
    }

    const targetMap = baseLayer?.contains(element) ? baseElementsById : fallbackElementsById
    const existing = targetMap.get(id)
    if (existing) {
      existing.push(element)
    } else {
      targetMap.set(id, [element])
    }
  }

  for (const id of candidateIds) {
    const elements = baseElementsById.get(id) ?? fallbackElementsById.get(id) ?? []
    for (const element of elements) {
      const elementRect = element.getBoundingClientRect()
      if (elementRect.width <= 0 && elementRect.height <= 0) {
        continue
      }

      if (screenRectsIntersect(rect, screenRectFromDomRect(elementRect))) {
        hitIds.add(id)
        break
      }
    }
  }

  return candidateIds.filter((id) => hitIds.has(id))
}

function swallowNextFloorplanScreenSelectionClick() {
  const swallowClick = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
    window.removeEventListener('click', swallowClick, true)
  }

  window.addEventListener('click', swallowClick, true)
  window.setTimeout(() => window.removeEventListener('click', swallowClick, true), 200)
}

function toPoint2D(point: WallPlanPoint): Point2D {
  return { x: point[0], y: point[1] }
}

function toWallPlanPoint(point: Point2D): WallPlanPoint {
  return [point.x, point.y]
}

function getFloorplanEdgeNormal(start: WallPlanPoint, end: WallPlanPoint): WallPlanPoint | null {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const length = Math.hypot(dx, dy)
  if (length < 1e-6) {
    return null
  }

  return [-dy / length, dx / length]
}

function moveFloorplanPolygonEdge(
  polygon: WallPlanPoint[],
  edgeIndex: number,
  edgeNormal: WallPlanPoint,
  initialPlanPoint: WallPlanPoint,
  nextPlanPoint: WallPlanPoint,
): WallPlanPoint[] {
  if (polygon.length < 2) {
    return polygon
  }

  const edgeStartIndex = edgeIndex
  const edgeEndIndex = (edgeStartIndex + 1) % polygon.length
  const deltaX = nextPlanPoint[0] - initialPlanPoint[0]
  const deltaY = nextPlanPoint[1] - initialPlanPoint[1]
  const normalDistance = deltaX * edgeNormal[0] + deltaY * edgeNormal[1]

  return polygon.map((point, index) =>
    index === edgeStartIndex || index === edgeEndIndex
      ? [point[0] + edgeNormal[0] * normalDistance, point[1] + edgeNormal[1] * normalDistance]
      : point,
  )
}

function toSvgX(value: number): number {
  return value
}

function toSvgY(value: number): number {
  return value
}

function toSvgPoint(point: Point2D): SvgPoint {
  return {
    x: toSvgX(point.x),
    y: toSvgY(point.y),
  }
}

function toSvgPlanPoint(point: WallPlanPoint): SvgPoint {
  return {
    x: toSvgX(point[0]),
    y: toSvgY(point[1]),
  }
}

function toPlanPointFromSvgPoint(svgPoint: SvgPoint): WallPlanPoint {
  return [toSvgX(svgPoint.x), toSvgY(svgPoint.y)]
}

function getSnappedFloorplanPoint(point: WallPlanPoint): WallPlanPoint {
  return [snapToHalf(point[0]), snapToHalf(point[1])]
}

function rotateVector([x, y]: WallPlanPoint, angle: number): WallPlanPoint {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [x * cos - y * sin, x * sin + y * cos]
}

function addVectorToSvgPoint(point: SvgPoint, [dx, dy]: WallPlanPoint): SvgPoint {
  return {
    x: point.x + dx,
    y: point.y + dy,
  }
}

function subtractSvgPoints(point: SvgPoint, origin: SvgPoint): WallPlanPoint {
  return [point.x - origin.x, point.y - origin.y]
}

function midpointBetweenSvgPoints(start: SvgPoint, end: SvgPoint): SvgPoint {
  return {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  }
}

function getGuideWidth(scale: number) {
  return FLOORPLAN_GUIDE_BASE_WIDTH * scale
}

function getGuideHeight(width: number, aspectRatio: number) {
  return width / aspectRatio
}

function getGuideCenterSvgPoint(guide: GuideNode): SvgPoint {
  return {
    x: toSvgX(guide.position[0]),
    y: toSvgY(guide.position[2]),
  }
}

function getGuideCornerLocalOffset(
  width: number,
  height: number,
  corner: GuideCorner,
): WallPlanPoint {
  const signs = guideCornerSigns[corner]
  return [(width / 2) * signs.x, (height / 2) * signs.y]
}

function getGuideCornerSvgPoint(
  centerSvg: SvgPoint,
  width: number,
  height: number,
  rotationSvg: number,
  corner: GuideCorner,
): SvgPoint {
  return addVectorToSvgPoint(
    centerSvg,
    rotateVector(getGuideCornerLocalOffset(width, height, corner), rotationSvg),
  )
}

function snapAngleToIncrement(angle: number, incrementDegrees: number) {
  const incrementRadians = (incrementDegrees * Math.PI) / 180
  return Math.round(angle / incrementRadians) * incrementRadians
}

function toPositiveAngleDegrees(angle: number) {
  const angleDegrees = (angle * 180) / Math.PI
  return ((angleDegrees % 180) + 180) % 180
}

function getResizeCursorForAngle(angle: number) {
  const normalizedDegrees = toPositiveAngleDegrees(angle)

  if (normalizedDegrees < 22.5 || normalizedDegrees >= 157.5) {
    return 'ew-resize'
  }

  if (normalizedDegrees < 67.5) {
    return 'nwse-resize'
  }

  if (normalizedDegrees < 112.5) {
    return 'ns-resize'
  }

  return 'nesw-resize'
}

function getGuideResizeCursor(corner: GuideCorner, rotationSvg: number) {
  const signs = guideCornerSigns[corner]
  return getResizeCursorForAngle(Math.atan2(signs.y, signs.x) + rotationSvg)
}

function buildCursorUrl(svgMarkup: string, hotspotX: number, hotspotY: number, fallback: string) {
  return `url("data:image/svg+xml,${encodeURIComponent(svgMarkup)}") ${hotspotX} ${hotspotY}, ${fallback}`
}

function getGuideRotateCursor(isDarkMode: boolean) {
  const strokeColor = isDarkMode ? '#ffffff' : '#09090b'
  const outlineColor = isDarkMode ? '#0a0e1b' : '#ffffff'
  const svgMarkup = `
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M7 15.75a6 6 0 1 0 1.9-8.28" stroke="${outlineColor}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M7 5.5v4.5h4.5" stroke="${outlineColor}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M7 15.75a6 6 0 1 0 1.9-8.28" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M7 5.5v4.5h4.5" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `.trim()

  return buildCursorUrl(svgMarkup, 12, 12, 'pointer')
}

function getGuideSvgRotation(rotationY: number) {
  return normalizeAngle(-rotationY)
}

function getGuideSceneRotationFromSvgRotation(rotationSvg: number) {
  return normalizeAngle(-rotationSvg)
}

function buildGuideTranslateDraft(
  interaction: GuideInteractionState,
  pointerSvg: SvgPoint,
): GuideTransformDraft {
  const centerSvg = addVectorToSvgPoint(pointerSvg, [
    -interaction.pointerOffsetSvg[0],
    -interaction.pointerOffsetSvg[1],
  ])

  return {
    guideId: interaction.guideId,
    position: toPlanPointFromSvgPoint(centerSvg),
    scale: interaction.scale,
    rotation: getGuideSceneRotationFromSvgRotation(interaction.rotationSvg),
  }
}

function normalizeAngle(angle: number) {
  let nextAngle = angle

  while (nextAngle <= -Math.PI) {
    nextAngle += Math.PI * 2
  }

  while (nextAngle > Math.PI) {
    nextAngle -= Math.PI * 2
  }

  return nextAngle
}

function areGuideTransformDraftsEqual(
  previousDraft: GuideTransformDraft | null,
  nextDraft: GuideTransformDraft | null,
  epsilon = 1e-6,
) {
  if (previousDraft === nextDraft) {
    return true
  }

  if (!(previousDraft && nextDraft)) {
    return false
  }

  return (
    previousDraft.guideId === nextDraft.guideId &&
    Math.abs(previousDraft.position[0] - nextDraft.position[0]) <= epsilon &&
    Math.abs(previousDraft.position[1] - nextDraft.position[1]) <= epsilon &&
    Math.abs(previousDraft.scale - nextDraft.scale) <= epsilon &&
    Math.abs(previousDraft.rotation - nextDraft.rotation) <= epsilon
  )
}

function doesGuideMatchDraft(guide: GuideNode, draft: GuideTransformDraft, epsilon = 1e-6) {
  return (
    Math.abs(guide.position[0] - draft.position[0]) <= epsilon &&
    Math.abs(guide.position[2] - draft.position[1]) <= epsilon &&
    Math.abs(guide.scale - draft.scale) <= epsilon &&
    Math.abs(normalizeAngle(guide.rotation[1] - draft.rotation)) <= epsilon
  )
}

function transformGuideReferencePoint(
  point: WallPlanPoint,
  guide: GuideNode,
  draft: GuideTransformDraft,
): WallPlanPoint {
  const oldCenterSvg = getGuideCenterSvgPoint(guide)
  const newCenterSvg: SvgPoint = {
    x: toSvgX(draft.position[0]),
    y: toSvgY(draft.position[1]),
  }
  const oldRotationSvg = getGuideSvgRotation(guide.rotation[1])
  const newRotationSvg = getGuideSvgRotation(draft.rotation)
  const oldScale = guide.scale > 0 ? guide.scale : 1
  const newScale = draft.scale > 0 ? draft.scale : oldScale
  const pointSvg = toSvgPlanPoint(point)
  const localUnrotated = rotateVector(subtractSvgPoints(pointSvg, oldCenterSvg), -oldRotationSvg)
  const localScaled: WallPlanPoint = [
    (localUnrotated[0] / oldScale) * newScale,
    (localUnrotated[1] / oldScale) * newScale,
  ]
  const nextSvg = addVectorToSvgPoint(newCenterSvg, rotateVector(localScaled, newRotationSvg))

  return toPlanPointFromSvgPoint(nextSvg)
}

function transformGuideScaleReference(
  guide: GuideNode,
  draft: GuideTransformDraft,
): GuideNode['scaleReference'] {
  const reference = guide.scaleReference
  if (!reference) {
    return reference
  }

  const start = transformGuideReferencePoint(reference.start, guide, draft)
  const end = transformGuideReferencePoint(reference.end, guide, draft)
  const measuredLengthUnits = Math.hypot(end[0] - start[0], end[1] - start[1])

  return {
    ...reference,
    start,
    end,
    measuredLengthUnits,
    metersPerUnit:
      measuredLengthUnits > 0
        ? reference.realLengthMeters / measuredLengthUnits
        : reference.metersPerUnit,
  }
}

function buildGuideResizeDraft(
  interaction: GuideInteractionState,
  pointerSvg: SvgPoint,
): GuideTransformDraft {
  const signs = guideCornerSigns[interaction.corner]
  const minWidth = FLOORPLAN_GUIDE_BASE_WIDTH * FLOORPLAN_GUIDE_MIN_SCALE
  const diagonal = [signs.x * interaction.aspectRatio, signs.y] as WallPlanPoint
  const oppositeCornerSvg = interaction.oppositeCornerSvg ?? interaction.centerSvg
  const relativePointer = rotateVector(
    subtractSvgPoints(pointerSvg, oppositeCornerSvg),
    -interaction.rotationSvg,
  )
  const projectedHeight =
    (relativePointer[0] * diagonal[0] + relativePointer[1] * diagonal[1]) /
    (interaction.aspectRatio ** 2 + 1)
  const width = Math.max(minWidth, projectedHeight * interaction.aspectRatio)
  const height = getGuideHeight(width, interaction.aspectRatio)
  const draggedCornerSvg = addVectorToSvgPoint(
    oppositeCornerSvg,
    rotateVector([signs.x * width, signs.y * height], interaction.rotationSvg),
  )
  const centerSvg = midpointBetweenSvgPoints(oppositeCornerSvg, draggedCornerSvg)

  return {
    guideId: interaction.guideId,
    position: toPlanPointFromSvgPoint(centerSvg),
    scale: width / FLOORPLAN_GUIDE_BASE_WIDTH,
    rotation: getGuideSceneRotationFromSvgRotation(interaction.rotationSvg),
  }
}

function buildGuideRotationDraft(
  interaction: GuideInteractionState,
  pointerSvg: SvgPoint,
  bypassSnap: boolean,
): GuideTransformDraft {
  const pointerVector = subtractSvgPoints(pointerSvg, interaction.centerSvg)

  if (pointerVector[0] ** 2 + pointerVector[1] ** 2 <= 1e-6) {
    return {
      guideId: interaction.guideId,
      position: toPlanPointFromSvgPoint(interaction.centerSvg),
      scale: interaction.scale,
      rotation: getGuideSceneRotationFromSvgRotation(interaction.rotationSvg),
    }
  }

  const rawRotationSvg =
    Math.atan2(pointerVector[1], pointerVector[0]) - interaction.cornerBaseAngle
  const snappedRotationSvg = bypassSnap
    ? rawRotationSvg
    : snapAngleToIncrement(rawRotationSvg, FLOORPLAN_GUIDE_ROTATION_SNAP_DEGREES)

  return {
    guideId: interaction.guideId,
    position: toPlanPointFromSvgPoint(interaction.centerSvg),
    scale: interaction.scale,
    rotation: getGuideSceneRotationFromSvgRotation(snappedRotationSvg),
  }
}

function toSvgSelectionBounds(bounds: FloorplanSelectionBounds) {
  return {
    x: toSvgX(bounds.maxX),
    y: toSvgY(bounds.maxY),
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  }
}

function getFloorplanSelectionBounds(
  start: WallPlanPoint,
  end: WallPlanPoint,
): FloorplanSelectionBounds {
  return {
    minX: Math.min(start[0], end[0]),
    maxX: Math.max(start[0], end[0]),
    minY: Math.min(start[1], end[1]),
    maxY: Math.max(start[1], end[1]),
  }
}

function isPointInsideSelectionBounds(point: Point2D, bounds: FloorplanSelectionBounds) {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  )
}

function isPointInsidePolygon(point: Point2D, polygon: Point2D[]) {
  let isInside = false

  for (
    let currentIndex = 0, previousIndex = polygon.length - 1;
    currentIndex < polygon.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const current = polygon[currentIndex]
    const previous = polygon[previousIndex]

    if (!(current && previous)) {
      continue
    }

    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x

    if (intersects) {
      isInside = !isInside
    }
  }

  return isInside
}

function getLineOrientation(start: Point2D, end: Point2D, point: Point2D) {
  return (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x)
}

function isPointOnSegment(point: Point2D, start: Point2D, end: Point2D) {
  const epsilon = 1e-9

  return (
    Math.abs(getLineOrientation(start, end, point)) <= epsilon &&
    point.x >= Math.min(start.x, end.x) - epsilon &&
    point.x <= Math.max(start.x, end.x) + epsilon &&
    point.y >= Math.min(start.y, end.y) - epsilon &&
    point.y <= Math.max(start.y, end.y) + epsilon
  )
}

function doSegmentsIntersect(
  firstStart: Point2D,
  firstEnd: Point2D,
  secondStart: Point2D,
  secondEnd: Point2D,
) {
  const orientation1 = getLineOrientation(firstStart, firstEnd, secondStart)
  const orientation2 = getLineOrientation(firstStart, firstEnd, secondEnd)
  const orientation3 = getLineOrientation(secondStart, secondEnd, firstStart)
  const orientation4 = getLineOrientation(secondStart, secondEnd, firstEnd)

  const hasProperIntersection =
    ((orientation1 > 0 && orientation2 < 0) || (orientation1 < 0 && orientation2 > 0)) &&
    ((orientation3 > 0 && orientation4 < 0) || (orientation3 < 0 && orientation4 > 0))

  if (hasProperIntersection) {
    return true
  }

  return (
    isPointOnSegment(secondStart, firstStart, firstEnd) ||
    isPointOnSegment(secondEnd, firstStart, firstEnd) ||
    isPointOnSegment(firstStart, secondStart, secondEnd) ||
    isPointOnSegment(firstEnd, secondStart, secondEnd)
  )
}

function doesPolygonIntersectSelectionBounds(polygon: Point2D[], bounds: FloorplanSelectionBounds) {
  if (polygon.length === 0) {
    return false
  }

  if (polygon.some((point) => isPointInsideSelectionBounds(point, bounds))) {
    return true
  }

  const boundsCorners: [Point2D, Point2D, Point2D, Point2D] = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ]

  if (boundsCorners.some((corner) => isPointInsidePolygon(corner, polygon))) {
    return true
  }

  const boundsEdges = [
    [boundsCorners[0], boundsCorners[1]],
    [boundsCorners[1], boundsCorners[2]],
    [boundsCorners[2], boundsCorners[3]],
    [boundsCorners[3], boundsCorners[0]],
  ] as const

  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]
    const end = polygon[(index + 1) % polygon.length]

    if (!(start && end)) {
      continue
    }

    for (const [edgeStart, edgeEnd] of boundsEdges) {
      if (doSegmentsIntersect(start, end, edgeStart, edgeEnd)) {
        return true
      }
    }
  }

  return false
}

function getDistanceToWallSegment(point: Point2D, start: WallPlanPoint, end: WallPlanPoint) {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared <= Number.EPSILON) {
    return Math.hypot(point.x - start[0], point.y - start[1])
  }

  const projection = clamp(
    ((point.x - start[0]) * dx + (point.y - start[1]) * dy) / lengthSquared,
    0,
    1,
  )
  const projectedX = start[0] + dx * projection
  const projectedY = start[1] + dy * projection

  return Math.hypot(point.x - projectedX, point.y - projectedY)
}

function normalizePlanVector(vector: Point2D): Point2D | null {
  const length = Math.hypot(vector.x, vector.y)
  if (length <= 1e-9) {
    return null
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
  }
}

function dotPlanVectors(a: Point2D, b: Point2D) {
  return a.x * b.x + a.y * b.y
}

function crossPlanVectors(a: Point2D, b: Point2D) {
  return a.x * b.y - a.y * b.x
}

function getViewportBounds(): ViewportBounds {
  if (typeof window === 'undefined') {
    return {
      width: PANEL_DEFAULT_WIDTH + PANEL_MARGIN * 2,
      height: PANEL_DEFAULT_HEIGHT + PANEL_MARGIN * 2,
    }
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight,
  }
}

function getPanelSizeLimits(bounds: ViewportBounds) {
  const maxWidth = Math.max(1, bounds.width - PANEL_MARGIN * 2)
  const maxHeight = Math.max(1, bounds.height - PANEL_MARGIN * 2)

  return {
    maxHeight,
    maxWidth,
    minHeight: Math.min(PANEL_MIN_HEIGHT, maxHeight),
    minWidth: Math.min(PANEL_MIN_WIDTH, maxWidth),
  }
}

function constrainPanelRect(rect: PanelRect, bounds: ViewportBounds): PanelRect {
  const { minWidth, maxWidth, minHeight, maxHeight } = getPanelSizeLimits(bounds)
  const width = clamp(rect.width, minWidth, maxWidth)
  const height = clamp(rect.height, minHeight, maxHeight)
  const x = clamp(rect.x, PANEL_MARGIN, Math.max(PANEL_MARGIN, bounds.width - PANEL_MARGIN - width))
  const y = clamp(
    rect.y,
    PANEL_MARGIN,
    Math.max(PANEL_MARGIN, bounds.height - PANEL_MARGIN - height),
  )

  return { x, y, width, height }
}

function getPanelPositionRatios(rect: PanelRect, bounds: ViewportBounds) {
  const availableX = Math.max(bounds.width - rect.width - PANEL_MARGIN * 2, 0)
  const availableY = Math.max(bounds.height - rect.height - PANEL_MARGIN * 2, 0)

  return {
    xRatio: availableX > 0 ? (rect.x - PANEL_MARGIN) / availableX : 0.5,
    yRatio: availableY > 0 ? (rect.y - PANEL_MARGIN) / availableY : 0.5,
  }
}

function adaptPanelRectToBounds(
  rect: PanelRect,
  previousBounds: ViewportBounds,
  nextBounds: ViewportBounds,
): PanelRect {
  const normalizedRect = constrainPanelRect(rect, previousBounds)
  const { xRatio, yRatio } = getPanelPositionRatios(normalizedRect, previousBounds)
  const { minWidth, maxWidth, minHeight, maxHeight } = getPanelSizeLimits(nextBounds)
  const width = clamp(normalizedRect.width, minWidth, maxWidth)
  const height = clamp(normalizedRect.height, minHeight, maxHeight)
  const availableX = Math.max(nextBounds.width - width - PANEL_MARGIN * 2, 0)
  const availableY = Math.max(nextBounds.height - height - PANEL_MARGIN * 2, 0)

  return constrainPanelRect(
    {
      x: PANEL_MARGIN + availableX * xRatio,
      y: PANEL_MARGIN + availableY * yRatio,
      width,
      height,
    },
    nextBounds,
  )
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isValidPanelRect(value: unknown): value is PanelRect {
  return (
    typeof value === 'object' &&
    value !== null &&
    isFiniteNumber((value as PanelRect).x) &&
    isFiniteNumber((value as PanelRect).y) &&
    isFiniteNumber((value as PanelRect).width) &&
    isFiniteNumber((value as PanelRect).height)
  )
}

function isValidViewportBounds(value: unknown): value is ViewportBounds {
  return (
    typeof value === 'object' &&
    value !== null &&
    isFiniteNumber((value as ViewportBounds).width) &&
    isFiniteNumber((value as ViewportBounds).height)
  )
}

function readPersistedPanelLayout(currentBounds: ViewportBounds): PanelRect | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const rawLayout = window.localStorage.getItem(FLOORPLAN_PANEL_LAYOUT_STORAGE_KEY)
    if (!rawLayout) {
      return null
    }

    const parsedLayout = JSON.parse(rawLayout) as Partial<PersistedPanelLayout>
    if (!(isValidPanelRect(parsedLayout.rect) && isValidViewportBounds(parsedLayout.viewport))) {
      return null
    }

    return adaptPanelRectToBounds(parsedLayout.rect, parsedLayout.viewport, currentBounds)
  } catch {
    return null
  }
}

function writePersistedPanelLayout(layout: PersistedPanelLayout) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(FLOORPLAN_PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(layout))
}

function getInitialPanelRect(bounds: ViewportBounds): PanelRect {
  return constrainPanelRect(
    {
      x: bounds.width - PANEL_DEFAULT_WIDTH - PANEL_MARGIN,
      y: bounds.height - PANEL_DEFAULT_HEIGHT - PANEL_DEFAULT_BOTTOM_OFFSET,
      width: PANEL_DEFAULT_WIDTH,
      height: PANEL_DEFAULT_HEIGHT,
    },
    bounds,
  )
}

function movePanelRect(
  initialRect: PanelRect,
  dx: number,
  dy: number,
  bounds: ViewportBounds,
): PanelRect {
  return constrainPanelRect(
    {
      ...initialRect,
      x: initialRect.x + dx,
      y: initialRect.y + dy,
    },
    bounds,
  )
}

function resizePanelRect(
  initialRect: PanelRect,
  direction: ResizeDirection,
  dx: number,
  dy: number,
  bounds: ViewportBounds,
): PanelRect {
  const right = initialRect.x + initialRect.width
  const bottom = initialRect.y + initialRect.height

  let x = initialRect.x
  let y = initialRect.y
  let width = initialRect.width
  let height = initialRect.height

  if (direction.includes('e')) width = initialRect.width + dx
  if (direction.includes('s')) height = initialRect.height + dy
  if (direction.includes('w')) width = initialRect.width - dx
  if (direction.includes('n')) height = initialRect.height - dy

  const maxWidth = Math.max(PANEL_MIN_WIDTH, bounds.width - PANEL_MARGIN * 2)
  const maxHeight = Math.max(PANEL_MIN_HEIGHT, bounds.height - PANEL_MARGIN * 2)
  width = clamp(width, PANEL_MIN_WIDTH, maxWidth)
  height = clamp(height, PANEL_MIN_HEIGHT, maxHeight)

  if (direction.includes('w')) {
    x = right - width
  }
  if (direction.includes('n')) {
    y = bottom - height
  }

  x = clamp(x, PANEL_MARGIN, Math.max(PANEL_MARGIN, bounds.width - PANEL_MARGIN - width))
  y = clamp(y, PANEL_MARGIN, Math.max(PANEL_MARGIN, bounds.height - PANEL_MARGIN - height))

  if (direction.includes('w')) {
    width = right - x
  } else {
    width = Math.min(width, bounds.width - PANEL_MARGIN - x)
  }

  if (direction.includes('n')) {
    height = bottom - y
  } else {
    height = Math.min(height, bounds.height - PANEL_MARGIN - y)
  }

  return constrainPanelRect({ x, y, width, height }, bounds)
}

function formatPolygonPoints(points: Point2D[]): string {
  return points
    .map((point) => {
      const svgPoint = toSvgPoint(point)
      return `${svgPoint.x},${svgPoint.y}`
    })
    .join(' ')
}

function toFloorplanPolygon(points: Array<[number, number]>): Point2D[] {
  return points.map(([x, y]) => ({ x, y }))
}

function rotatePlanVector(x: number, y: number, rotation: number): [number, number] {
  return rotateSharedPlanVector(x, y, rotation)
}

function getPolygonBounds(points: Point2D[]) {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const point of points) {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

function rotateSvgPoint(point: SvgPoint, rotationDegrees: number): SvgPoint {
  if (rotationDegrees === 0) {
    return point
  }

  const radians = (rotationDegrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)

  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  }
}

function radiansToDegrees(angle: number) {
  return (angle * 180) / Math.PI
}

function degreesToRadians(angle: number) {
  return (angle * Math.PI) / 180
}

function nearestEquivalentDegrees(angle: number, reference: number) {
  let nextAngle = angle

  while (nextAngle - reference > 180) {
    nextAngle -= 360
  }

  while (nextAngle - reference < -180) {
    nextAngle += 360
  }

  return nextAngle
}

function floorplanRotationFromCameraAzimuth(azimuth: number, reference: number) {
  return nearestEquivalentDegrees(
    radiansToDegrees(azimuth) - FLOORPLAN_VIEW_ROTATION_DEG,
    reference,
  )
}

function cameraAzimuthFromFloorplanRotation(rotationDeg: number) {
  return degreesToRadians(rotationDeg + FLOORPLAN_VIEW_ROTATION_DEG)
}

function projectSvgPointToSurface(
  svgPoint: SvgPoint,
  viewBox: { minX: number; minY: number; width: number; height: number },
  surfaceSize: { width: number; height: number },
): SvgPoint | null {
  if (
    !(surfaceSize.width > 0 && surfaceSize.height > 0 && viewBox.width > 0 && viewBox.height > 0)
  ) {
    return null
  }

  if (
    svgPoint.x < viewBox.minX ||
    svgPoint.x > viewBox.minX + viewBox.width ||
    svgPoint.y < viewBox.minY ||
    svgPoint.y > viewBox.minY + viewBox.height
  ) {
    return null
  }

  return {
    x: ((svgPoint.x - viewBox.minX) / viewBox.width) * surfaceSize.width,
    y: ((svgPoint.y - viewBox.minY) / viewBox.height) * surfaceSize.height,
  }
}

function getFloorplanActionMenuPosition(
  points: Point2D[],
  viewBox: { minX: number; minY: number; width: number; height: number },
  surfaceSize: { width: number; height: number },
  rotationDegrees = 0,
) {
  if (points.length === 0) {
    return null
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const point of points) {
    const svgPoint = rotateSvgPoint(toSvgPoint(point), rotationDegrees)
    minX = Math.min(minX, svgPoint.x)
    maxX = Math.max(maxX, svgPoint.x)
    minY = Math.min(minY, svgPoint.y)
    maxY = Math.max(maxY, svgPoint.y)
  }

  if (
    !(
      Number.isFinite(minX) &&
      Number.isFinite(maxX) &&
      Number.isFinite(minY) &&
      Number.isFinite(maxY)
    )
  ) {
    return null
  }

  if (
    maxX < viewBox.minX ||
    minX > viewBox.minX + viewBox.width ||
    maxY < viewBox.minY ||
    minY > viewBox.minY + viewBox.height
  ) {
    return null
  }

  const anchorX = (((minX + maxX) / 2 - viewBox.minX) / viewBox.width) * surfaceSize.width
  const anchorY = ((minY - viewBox.minY) / viewBox.height) * surfaceSize.height

  return {
    x: Math.min(
      Math.max(anchorX, FLOORPLAN_ACTION_MENU_HORIZONTAL_PADDING),
      surfaceSize.width - FLOORPLAN_ACTION_MENU_HORIZONTAL_PADDING,
    ),
    y: Math.max(anchorY, FLOORPLAN_ACTION_MENU_MIN_ANCHOR_Y),
  }
}

function getRotatedRectanglePolygon(
  center: Point2D,
  width: number,
  depth: number,
  rotation: number,
): Point2D[] {
  const halfWidth = width / 2
  const halfDepth = depth / 2
  const corners: Array<[number, number]> = [
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [halfWidth, halfDepth],
    [-halfWidth, halfDepth],
  ]

  return corners.map(([localX, localY]) => {
    const [offsetX, offsetY] = rotatePlanVector(localX, localY, rotation)
    return {
      x: center.x + offsetX,
      y: center.y + offsetY,
    }
  })
}

function getColumnPlanFootprint(column: ColumnNode): Point2D[] {
  const center = { x: column.position[0], y: column.position[2] }

  if (
    column.supportStyle === 'a-frame' ||
    column.supportStyle === 'y-frame' ||
    column.supportStyle === 'v-frame' ||
    column.supportStyle === 'x-brace' ||
    column.supportStyle === 'k-brace' ||
    column.supportStyle === 'single-strut' ||
    column.supportStyle === 'tripod' ||
    column.supportStyle === 'trestle' ||
    column.supportStyle === 'portal-frame' ||
    column.supportStyle === 'box-frame'
  ) {
    const width = Math.max(
      column.supportStyle === 'a-frame' ||
        column.supportStyle === 'x-brace' ||
        column.supportStyle === 'k-brace' ||
        column.supportStyle === 'single-strut' ||
        column.supportStyle === 'tripod' ||
        column.supportStyle === 'trestle' ||
        column.supportStyle === 'portal-frame' ||
        column.supportStyle === 'box-frame'
        ? (column.braceBottomSpread ?? 1.2)
        : 0,
      column.braceTopSpread ??
        (column.supportStyle === 'y-frame' ||
        column.supportStyle === 'v-frame' ||
        column.supportStyle === 'x-brace' ||
        column.supportStyle === 'k-brace' ||
        column.supportStyle === 'single-strut' ||
        column.supportStyle === 'tripod' ||
        column.supportStyle === 'trestle' ||
        column.supportStyle === 'portal-frame' ||
        column.supportStyle === 'box-frame'
          ? 1
          : 0),
      (column.braceWidth ?? column.width) * 2,
    )
    const depth = Math.max(
      column.supportStyle === 'tripod' ||
        column.supportStyle === 'trestle' ||
        column.supportStyle === 'box-frame'
        ? (column.braceTopSpread ?? 1)
        : 0,
      column.braceDepth ?? column.depth,
      0.08,
    )
    return getRotatedRectanglePolygon(center, width, depth, column.rotation)
  }

  const shaftWidth =
    column.crossSection === 'round' ||
    column.crossSection === 'octagonal' ||
    column.crossSection === 'sixteen-sided'
      ? column.radius * 2
      : column.width
  const shaftDepth =
    column.crossSection === 'round' ||
    column.crossSection === 'octagonal' ||
    column.crossSection === 'sixteen-sided'
      ? column.radius * 2
      : column.depth
  const width = Math.max(
    shaftWidth,
    column.width * column.baseWidthScale,
    column.width * column.capitalWidthScale,
  )
  const depth = Math.max(
    shaftDepth,
    column.depth * column.baseDepthScale,
    column.depth * column.capitalDepthScale,
  )

  if (column.crossSection === 'square' || column.crossSection === 'rectangular') {
    return getRotatedRectanglePolygon(center, width, depth, column.rotation)
  }

  const segmentCount =
    column.crossSection === 'octagonal' ? 8 : column.crossSection === 'sixteen-sided' ? 16 : 32

  return Array.from({ length: segmentCount }, (_, index) => {
    const angle = (index / segmentCount) * Math.PI * 2
    const localX = Math.cos(angle) * (width / 2)
    const localY = Math.sin(angle) * (depth / 2)
    const [offsetX, offsetY] = rotatePlanVector(localX, localY, column.rotation)

    return {
      x: center.x + offsetX,
      y: center.y + offsetY,
    }
  })
}

function interpolatePlanPoint(start: Point2D, end: Point2D, t: number): Point2D {
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  }
}

function getPlanPointDistance(start: Point2D, end: Point2D): number {
  return Math.hypot(end.x - start.x, end.y - start.y)
}

function getPointToSegmentDistanceSquared(point: Point2D, start: Point2D, end: Point2D): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= Number.EPSILON) {
    return (point.x - start.x) ** 2 + (point.y - start.y) ** 2
  }

  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1)
  const projection = {
    x: start.x + dx * t,
    y: start.y + dy * t,
  }

  return (point.x - projection.x) ** 2 + (point.y - projection.y) ** 2
}

function getClosestPolygonEdgeIndex(point: Point2D, polygon: Point2D[]): number {
  let closestIndex = 0
  let closestDistanceSquared = Number.POSITIVE_INFINITY

  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]
    const end = polygon[(index + 1) % polygon.length]
    if (!(start && end)) {
      continue
    }

    const distanceSquared = getPointToSegmentDistanceSquared(point, start, end)
    if (distanceSquared < closestDistanceSquared) {
      closestDistanceSquared = distanceSquared
      closestIndex = index
    }
  }

  return closestIndex
}

function getClosestPolygonVertexIndex(point: Point2D, polygon: Point2D[]): number {
  let closestIndex = 0
  let closestDistanceSquared = Number.POSITIVE_INFINITY

  for (let index = 0; index < polygon.length; index += 1) {
    const vertex = polygon[index]
    if (!vertex) {
      continue
    }

    const distanceSquared = (point.x - vertex.x) ** 2 + (point.y - vertex.y) ** 2
    if (distanceSquared < closestDistanceSquared) {
      closestDistanceSquared = distanceSquared
      closestIndex = index
    }
  }

  return closestIndex
}

function movePlanPointTowards(start: Point2D, end: Point2D, distance: number): Point2D {
  const totalDistance = getPlanPointDistance(start, end)
  if (totalDistance <= Number.EPSILON || distance <= 0) {
    return start
  }

  return interpolatePlanPoint(start, end, Math.min(1, distance / totalDistance))
}

function getNormalizedFloorplanStairSweepAngle(stair: StairNode) {
  const stairType = stair.stairType ?? 'straight'
  const baseSweepAngle = stair.sweepAngle ?? (stairType === 'spiral' ? Math.PI * 2 : Math.PI / 2)

  if (Math.abs(baseSweepAngle) >= Math.PI * 2) {
    return Math.sign(baseSweepAngle || 1) * (Math.PI * 2 - 0.001)
  }

  return baseSweepAngle
}

function getFloorplanSpiralLandingSweep(stair: StairNode, sweepAngle: number) {
  if (
    (stair.stairType ?? 'straight') !== 'spiral' ||
    (stair.topLandingMode ?? 'none') !== 'integrated'
  ) {
    return 0
  }

  const innerRadius = Math.max(0.05, stair.innerRadius ?? 0.9)
  const width = Math.max(stair.width ?? 1, 0.4)
  const landingDepth = Math.max(0.3, stair.topLandingDepth ?? Math.max(width * 0.9, 0.8))

  return (
    Math.min(Math.PI * 0.75, landingDepth / Math.max(innerRadius + width / 2, 0.1)) *
    Math.sign(sweepAngle || 1)
  )
}

function getFloorplanCurvedStairHitPolygon(stair: StairNode): Point2D[] {
  const stairType = stair.stairType ?? 'straight'
  const sweepAngle = getNormalizedFloorplanStairSweepAngle(stair)
  const startAngle = -stair.rotation - sweepAngle / 2
  const endAngle = startAngle + sweepAngle + getFloorplanSpiralLandingSweep(stair, sweepAngle)
  const center = {
    x: stair.position[0],
    y: stair.position[2],
  }
  const innerRadius = Math.max(
    stairType === 'spiral' ? 0.05 : 0.2,
    stair.innerRadius ?? (stairType === 'spiral' ? 0.2 : 0.9),
  )
  const outerRadius = innerRadius + stair.width
  const outerArcLength = Math.abs(sweepAngle) * outerRadius
  const segmentCount = Math.max(
    24,
    Math.ceil(Math.abs(sweepAngle) / (Math.PI / 24)),
    Math.ceil(outerArcLength / 0.14),
  )
  const outerPoints: Point2D[] = []
  const innerPoints: Point2D[] = []

  for (let index = 0; index <= segmentCount; index += 1) {
    const t = index / segmentCount
    const angle = startAngle + (endAngle - startAngle) * t
    outerPoints.push(getArcPlanPoint(center, outerRadius, angle))
    innerPoints.push(getArcPlanPoint(center, innerRadius, angle))
  }

  return [...outerPoints, ...innerPoints.reverse()]
}

function isPointInsidePolygonWithHoles(
  point: Point2D,
  polygon: Point2D[],
  holes: Point2D[][] = [],
) {
  return (
    isPointInsidePolygon(point, polygon) && !holes.some((hole) => isPointInsidePolygon(point, hole))
  )
}

function isPointNearPlanPoint(a: WallPlanPoint, b: WallPlanPoint, threshold = 0.25) {
  return Math.abs(a[0] - b[0]) < threshold && Math.abs(a[1] - b[1]) < threshold
}

function snapPolygonDraftPoint({
  point,
  start,
  angleSnap,
}: {
  point: WallPlanPoint
  start?: WallPlanPoint
  angleSnap: boolean
}): WallPlanPoint {
  // `snapToHalf`'s default step is 0 in any non-`grid` mode, so the grid branch
  // passes the raw point through for `lines` / `off` (where wall-snap /
  // alignment, run by the caller, takes over) — no explicit bypass needed.
  if (!(start && angleSnap)) {
    return [snapToHalf(point[0]), snapToHalf(point[1])]
  }

  // 15° angle snap from the raw point, with the distance snapped along the
  // ray to the grid step — grid-snapping the point itself would pull the
  // vertex off non-axis rays (and matches the 3D slab / ceiling tools).
  return [
    ...snapPointAlongAngleRay(start, point, DEFAULT_ANGLE_STEP, useEditor.getState().gridSnapStep),
  ]
}

function pointMatchesWallPlanPoint(
  point: Point2D | undefined,
  planPoint: WallPlanPoint,
  epsilon = 1e-6,
): boolean {
  if (!point) {
    return false
  }

  return Math.abs(point.x - planPoint[0]) <= epsilon && Math.abs(point.y - planPoint[1]) <= epsilon
}

function getFloorplanFenceLength(fence: FenceNode) {
  return isCurvedWall(fence)
    ? getWallCurveLength(fence)
    : Math.hypot(fence.end[0] - fence.start[0], fence.end[1] - fence.start[1])
}

function getFloorplanFenceMarkerTs(fence: FenceNode) {
  const fenceLength = getFloorplanFenceLength(fence)
  if (fenceLength <= 0.24) {
    return [0.5]
  }

  const spacing = clamp(
    fence.style === 'privacy' ? fence.postSpacing * 0.72 : fence.postSpacing,
    0.34,
    1.5,
  )
  const inset = clamp(
    Math.max(fence.postSize * 1.25, fence.edgeInset * 10),
    0.18,
    Math.min(0.48, fenceLength * 0.22),
  )
  const usableLength = Math.max(fenceLength - inset * 2, 0)

  if (usableLength <= 0.001) {
    return [0.5]
  }

  const markerCount = Math.max(1, Math.min(24, Math.floor(usableLength / spacing) + 1))
  if (markerCount === 1) {
    return [0.5]
  }

  return Array.from({ length: markerCount }, (_, index) =>
    clamp((inset + (usableLength * index) / (markerCount - 1)) / fenceLength, 0.08, 0.92),
  )
}

function getWallHoverSidePaths(polygon: Point2D[], wall: WallNode): [string, string] | null {
  if (polygon.length < 4) {
    return null
  }

  if (isCurvedWall(wall) && polygon.length >= 6 && polygon.length % 2 === 0) {
    const sidePointCount = polygon.length / 2
    const rightSidePath = buildSvgPolylinePath(polygon.slice(0, sidePointCount))
    const leftSidePath = buildSvgPolylinePath(polygon.slice(sidePointCount).reverse())

    if (!(rightSidePath && leftSidePath)) {
      return null
    }

    return [rightSidePath, leftSidePath]
  }

  const startRight = polygon[0]
  const endRight = polygon[1]
  const hasEndCenterPoint = pointMatchesWallPlanPoint(polygon[2], wall.end)
  const endLeft = polygon[hasEndCenterPoint ? 3 : 2]
  const lastPoint = polygon[polygon.length - 1]
  const hasStartCenterPoint = pointMatchesWallPlanPoint(lastPoint, wall.start)
  const startLeft = polygon[hasStartCenterPoint ? polygon.length - 2 : polygon.length - 1]

  if (!(startRight && endRight && endLeft && startLeft)) {
    return null
  }

  const svgStartRight = toSvgPoint(startRight)
  const svgEndRight = toSvgPoint(endRight)
  const svgStartLeft = toSvgPoint(startLeft)
  const svgEndLeft = toSvgPoint(endLeft)

  const rightSidePath = `M ${svgStartRight.x} ${svgStartRight.y} L ${svgEndRight.x} ${svgEndRight.y}`
  const leftSidePath = `M ${svgStartLeft.x} ${svgStartLeft.y} L ${svgEndLeft.x} ${svgEndLeft.y}`

  return [rightSidePath, leftSidePath]
}

function buildDraftWall(levelId: string, start: WallPlanPoint, end: WallPlanPoint): WallNode {
  return {
    object: 'node',
    id: 'wall_draft' as WallNode['id'],
    type: 'wall',
    name: 'Draft wall',
    parentId: levelId,
    visible: true,
    metadata: {},
    children: [],
    start,
    end,
    frontSide: 'unknown',
    backSide: 'unknown',
  }
}

type DraftWallMeasurement = {
  lengthLabel: string
  midpoint: WallPlanPoint
  direction: WallPlanPoint
  angleLabels: {
    id: string
    label: string
    center: WallPlanPoint
    radius: number
    startAngle: number
    endAngle: number
    midAngle: number
  }[]
}

function FloorplanDraftWallMeasurement({
  measurement,
  measurementStroke,
  labelBackground,
  labelText,
  sceneRotationDeg,
  unitsPerPixel,
}: {
  measurement: DraftWallMeasurement
  measurementStroke: string
  labelBackground: string
  labelText: string
  sceneRotationDeg: number
  unitsPerPixel: number
}) {
  const stroke = measurementStroke
  const labelBg = labelBackground

  const upx = unitsPerPixel
  const fontSize = Math.max(upx * 10, 0.08)
  const padX = upx * 6
  const padY = upx * 3

  // Length plate: rotates to follow the wall direction, but flips 180°
  // when its on-screen orientation would read upside-down (same trick as
  // `floorplan-registry-layer.tsx` for dimension labels).
  const wallAngleDeg =
    (Math.atan2(measurement.direction[1], measurement.direction[0]) * 180) / Math.PI
  let labelAngleDeg = wallAngleDeg
  let screenDeg = wallAngleDeg + sceneRotationDeg
  screenDeg = ((((screenDeg + 180) % 360) + 360) % 360) - 180
  if (screenDeg > 90) labelAngleDeg -= 180
  else if (screenDeg <= -90) labelAngleDeg += 180

  // Push the plate perpendicular to the wall so the dashed footprint
  // stays visible underneath.
  const perpX = -measurement.direction[1]
  const perpY = measurement.direction[0]
  const offset = upx * 18
  const cx = measurement.midpoint[0] + perpX * offset
  const cy = measurement.midpoint[1] + perpY * offset

  const lengthTextWidth = measurement.lengthLabel.length * upx * 6.2
  const lengthPlateW = lengthTextWidth + padX * 2
  const lengthPlateH = fontSize + padY * 2

  const arcSampleCount = 32

  return (
    <g pointerEvents="none">
      <g transform={`translate(${cx} ${cy}) rotate(${labelAngleDeg})`}>
        <rect
          fill={labelBg}
          height={lengthPlateH}
          opacity={0.92}
          rx={upx * 3}
          ry={upx * 3}
          stroke={stroke}
          strokeWidth={upx * 0.5}
          vectorEffect="non-scaling-stroke"
          width={lengthPlateW}
          x={-lengthPlateW / 2}
          y={-lengthPlateH / 2}
        />
        <text
          dominantBaseline="middle"
          fill={labelText}
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontSize={fontSize}
          fontWeight={600}
          textAnchor="middle"
          x={0}
          y={0}
        >
          {measurement.lengthLabel}
        </text>
      </g>

      {measurement.angleLabels.map((arc) => {
        // Sample the arc as a polyline — avoids the SVG arc command's
        // sweep-flag direction quirks across negative/positive sweeps.
        const points: string[] = []
        for (let i = 0; i <= arcSampleCount; i += 1) {
          const t = i / arcSampleCount
          const a = arc.startAngle + (arc.endAngle - arc.startAngle) * t
          const px = arc.center[0] + Math.cos(a) * arc.radius
          const py = arc.center[1] + Math.sin(a) * arc.radius
          points.push(`${px},${py}`)
        }

        const aFontSize = Math.max(upx * 9, 0.075)
        const aPadX = upx * 5
        const aPadY = upx * 2.5
        const aTextWidth = arc.label.length * upx * 6.2
        const aPlateW = aTextWidth + aPadX * 2
        const aPlateH = aFontSize + aPadY * 2

        const labelDist = arc.radius + upx * 16
        const lx = arc.center[0] + Math.cos(arc.midAngle) * labelDist
        const ly = arc.center[1] + Math.sin(arc.midAngle) * labelDist

        return (
          <g key={`draft-angle-${arc.id}`}>
            <polyline
              fill="none"
              points={points.join(' ')}
              stroke={stroke}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeOpacity={0.95}
              strokeWidth={upx * 1.2}
              vectorEffect="non-scaling-stroke"
            />
            <g transform={`translate(${lx} ${ly})`}>
              <rect
                fill={labelBg}
                height={aPlateH}
                opacity={0.92}
                rx={upx * 3}
                ry={upx * 3}
                stroke={stroke}
                strokeWidth={upx * 0.5}
                vectorEffect="non-scaling-stroke"
                width={aPlateW}
                x={-aPlateW / 2}
                y={-aPlateH / 2}
              />
              <text
                dominantBaseline="middle"
                fill={labelText}
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                fontSize={aFontSize}
                fontWeight={600}
                textAnchor="middle"
                x={0}
                y={0}
              >
                {arc.label}
              </text>
            </g>
          </g>
        )
      })}
    </g>
  )
}

function pointsEqual(a: WallPlanPoint, b: WallPlanPoint): boolean {
  return a[0] === b[0] && a[1] === b[1]
}

function isWithinWallJoinSnapRadius(point: WallPlanPoint, firstVertex: WallPlanPoint): boolean {
  const dx = point[0] - firstVertex[0]
  const dz = point[1] - firstVertex[1]

  return dx * dx + dz * dz <= WALL_JOIN_SNAP_RADIUS * WALL_JOIN_SNAP_RADIUS
}

function haveSameIds(currentIds: string[], nextIds: string[]): boolean {
  return (
    currentIds.length === nextIds.length &&
    currentIds.every((currentId, index) => currentId === nextIds[index])
  )
}

function polygonsEqual(a: WallPlanPoint[], b: Array<[number, number]>): boolean {
  return (
    a.length === b.length &&
    a.every((point, index) => {
      const otherPoint = b[index]
      if (!otherPoint) {
        return false
      }

      return Math.abs(point[0] - otherPoint[0]) < 1e-6 && Math.abs(point[1] - otherPoint[1]) < 1e-6
    })
  )
}

function buildWallEndpointDraft(
  wallId: WallNode['id'],
  endpoint: WallEndpoint,
  fixedPoint: WallPlanPoint,
  movingPoint: WallPlanPoint,
  linkedWalls: LinkedWallSnapshot[] = [],
): WallEndpointDraft {
  return {
    wallId,
    endpoint,
    start: endpoint === 'start' ? movingPoint : fixedPoint,
    end: endpoint === 'end' ? movingPoint : fixedPoint,
    linkedWalls,
  }
}

function buildWallWithUpdatedEndpoints(
  wall: WallNode,
  start: WallPlanPoint,
  end: WallPlanPoint,
): WallNode {
  return {
    ...wall,
    start,
    end,
  }
}

function getLinkedWallSnapshots(
  walls: WallNode[],
  wallId: WallNode['id'],
  originalStart: WallPlanPoint,
  originalEnd: WallPlanPoint,
): LinkedWallSnapshot[] {
  return walls
    .filter((wall) => {
      if (wall.id === wallId) {
        return false
      }

      return (
        pointsEqual(wall.start, originalStart) ||
        pointsEqual(wall.start, originalEnd) ||
        pointsEqual(wall.end, originalStart) ||
        pointsEqual(wall.end, originalEnd)
      )
    })
    .map((wall) => ({
      id: wall.id,
      start: [...wall.start] as WallPlanPoint,
      end: [...wall.end] as WallPlanPoint,
    }))
}

function getLinkedWallUpdates(
  linkedWalls: LinkedWallSnapshot[],
  originalStart: WallPlanPoint,
  originalEnd: WallPlanPoint,
  nextStart: WallPlanPoint,
  nextEnd: WallPlanPoint,
): LinkedWallSnapshot[] {
  return linkedWalls.map((wall) => ({
    id: wall.id,
    start: pointsEqual(wall.start, originalStart)
      ? nextStart
      : pointsEqual(wall.start, originalEnd)
        ? nextEnd
        : wall.start,
    end: pointsEqual(wall.end, originalStart)
      ? nextStart
      : pointsEqual(wall.end, originalEnd)
        ? nextEnd
        : wall.end,
  }))
}

function getWallEndpointDraftUpdates(draft: WallEndpointDraft): LinkedWallSnapshot[] {
  return [{ id: draft.wallId, start: draft.start, end: draft.end }, ...draft.linkedWalls]
}

function getFloorplanWallThickness(wall: WallNode): number {
  const baseThickness = wall.thickness ?? 0.1
  const scaledThickness = baseThickness * FLOORPLAN_WALL_THICKNESS_SCALE

  return Math.min(
    baseThickness + FLOORPLAN_MAX_EXTRA_THICKNESS,
    Math.max(baseThickness, scaledThickness, FLOORPLAN_MIN_VISIBLE_WALL_THICKNESS),
  )
}

function getFloorplanWall(wall: WallNode): WallNode {
  return {
    ...wall,
    // Slightly exaggerate thin walls so the 2D blueprint reads clearly without drifting far from BIM.
    thickness: getFloorplanWallThickness(wall),
  }
}

function formatMeasurement(
  value: number,
  unit: 'metric' | 'imperial',
  metersPerUnit: number | null = null,
) {
  const measuredValue = metersPerUnit && metersPerUnit > 0 ? value * metersPerUnit : value
  return formatLinearMeasurement(measuredValue, unit)
}

function formatNumber(value: number, fractionDigits = 2) {
  return Number.parseFloat(value.toFixed(fractionDigits)).toString()
}

function convertReferenceLengthToMeters(value: number, unit: ReferenceScaleUnit) {
  switch (unit) {
    case 'centimeters':
      return value / 100
    case 'feet':
      return linearUnitToMeters(value, 'imperial')
    case 'inches':
      return value * 0.0254
    default:
      return value
  }
}

function getReferenceScaleUnitLabel(unit: ReferenceScaleUnit) {
  switch (unit) {
    case 'centimeters':
      return 'cm'
    case 'feet':
      return 'ft'
    case 'inches':
      return 'in'
    default:
      return 'm'
  }
}

function formatReferenceScaleLabel(value: number, unit: ReferenceScaleUnit) {
  return `${formatNumber(value)} ${getReferenceScaleUnitLabel(unit)}`
}

function getPolygonAreaAndCentroid(polygon: Point2D[]) {
  let cx = 0
  let cy = 0
  let area = 0

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const p1 = polygon[j]!
    const p2 = polygon[i]!
    const f = p1.x * p2.y - p2.x * p1.y
    cx += (p1.x + p2.x) * f
    cy += (p1.y + p2.y) * f
    area += f
  }

  area /= 2

  if (Math.abs(area) < 1e-9) {
    return { area: 0, centroid: polygon[0] ?? { x: 0, y: 0 } }
  }

  cx /= 6 * area
  cy /= 6 * area

  return { area: Math.abs(area), centroid: { x: cx, y: cy } }
}

function getSlabArea(polygon: Point2D[], holes: Point2D[][]) {
  const outer = getPolygonAreaAndCentroid(polygon)
  let totalArea = outer.area
  for (const hole of holes) {
    totalArea -= getPolygonAreaAndCentroid(hole).area
  }
  return { area: Math.max(0, totalArea), centroid: outer.centroid }
}

function formatArea(
  areaSqM: number,
  unit: 'metric' | 'imperial',
  metersPerUnit: number | null = null,
) {
  const scaledAreaSqM =
    metersPerUnit && metersPerUnit > 0 ? areaSqM * metersPerUnit * metersPerUnit : areaSqM

  if (unit === 'imperial') {
    const areaSqFt = scaledAreaSqM * 10.763_910_4
    return (
      <>
        {Math.round(areaSqFt).toLocaleString()}
        <tspan dx="0.12em">ft</tspan>
        <tspan baselineShift="super" fontSize="0.75em">
          2
        </tspan>
      </>
    )
  }
  return (
    <>
      {Number.parseFloat(scaledAreaSqM.toFixed(1))}
      <tspan dx="0.12em">m</tspan>
      <tspan baselineShift="super" fontSize="0.75em">
        2
      </tspan>
    </>
  )
}

function getOpeningFootprint(wall: WallNode, node: WindowNode | DoorNode): Point2D[] {
  const [x1, z1] = wall.start
  const [x2, z2] = wall.end

  const dx = x2 - x1
  const dz = z2 - z1
  const length = Math.sqrt(dx * dx + dz * dz)

  if (length < 1e-9) {
    return []
  }

  const dirX = dx / length
  const dirZ = dz / length

  const perpX = -dirZ
  const perpZ = dirX

  const distance = node.position[0]
  const width = node.width
  const depth = wall.thickness ?? 0.1

  const cx = x1 + dirX * distance
  const cz = z1 + dirZ * distance

  const halfWidth = width / 2
  const halfDepth = depth / 2

  return [
    {
      x: cx - dirX * halfWidth + perpX * halfDepth,
      y: cz - dirZ * halfWidth + perpZ * halfDepth,
    },
    {
      x: cx + dirX * halfWidth + perpX * halfDepth,
      y: cz + dirZ * halfWidth + perpZ * halfDepth,
    },
    {
      x: cx + dirX * halfWidth - perpX * halfDepth,
      y: cz + dirZ * halfWidth - perpZ * halfDepth,
    },
    {
      x: cx - dirX * halfWidth - perpX * halfDepth,
      y: cz - dirZ * halfWidth - perpZ * halfDepth,
    },
  ]
}

function getOpeningCenterLine(polygon: Point2D[]) {
  if (polygon.length < 4) {
    return null
  }

  const [p1, p2, p3, p4] = polygon

  return {
    start: {
      x: (p1!.x + p4!.x) / 2,
      y: (p1!.y + p4!.y) / 2,
    },
    end: {
      x: (p2!.x + p3!.x) / 2,
      y: (p2!.y + p3!.y) / 2,
    },
  }
}

function isOpeningPlanFlipped(rotation: [number, number, number]) {
  const normalized =
    ((((rotation[1] % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) + 1e-6) % (Math.PI * 2)

  return normalized > Math.PI / 2 && normalized < (Math.PI * 3) / 2
}

function getFlippedHingesSide(hingesSide: DoorNode['hingesSide']) {
  return hingesSide === 'left' ? 'right' : 'left'
}

function getFlippedSwingDirection(swingDirection: DoorNode['swingDirection']) {
  return swingDirection === 'inward' ? 'outward' : 'inward'
}

function normalizeGridCoordinate(value: number): number {
  return Number(value.toFixed(GRID_COORDINATE_PRECISION))
}

function isGridAligned(value: number, step: number): boolean {
  if (!(Number.isFinite(step) && step > 0)) {
    return false
  }

  const normalizedValue = normalizeGridCoordinate(value / step)
  return Math.abs(normalizedValue - Math.round(normalizedValue)) < 1e-4
}

// Keep visible grid spacing above a minimum pixel size so zooming stays evenly distributed.
function getVisibleGridSteps(
  viewportWidth: number,
  surfaceWidth: number,
): {
  minorStep: number
  majorStep: number
} {
  const pixelsPerUnit = surfaceWidth / Math.max(viewportWidth, Number.EPSILON)
  let minorStep = WALL_GRID_STEP

  while (minorStep * pixelsPerUnit < MIN_GRID_SCREEN_SPACING) {
    minorStep *= 2
  }

  return {
    minorStep,
    majorStep: Math.max(MAJOR_GRID_STEP, minorStep * 2),
  }
}

function buildGridPath(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  step: number,
  options?: {
    excludeStep?: number
  },
): string {
  if (!(Number.isFinite(step) && step > 0)) {
    return ''
  }

  const commands: string[] = []
  const startXIndex = Math.floor(minX / step)
  const endXIndex = Math.ceil(maxX / step)
  const startYIndex = Math.floor(minY / step)
  const endYIndex = Math.ceil(maxY / step)
  const gridMinX = normalizeGridCoordinate(minX)
  const gridMaxX = normalizeGridCoordinate(maxX)
  const gridMinY = normalizeGridCoordinate(minY)
  const gridMaxY = normalizeGridCoordinate(maxY)

  for (let index = startXIndex; index <= endXIndex; index += 1) {
    const x = index * step
    if (options?.excludeStep && isGridAligned(x, options.excludeStep)) {
      continue
    }

    const gridX = normalizeGridCoordinate(x)
    commands.push(`M ${gridX} ${gridMinY} L ${gridX} ${gridMaxY}`)
  }

  for (let index = startYIndex; index <= endYIndex; index += 1) {
    const y = index * step
    if (options?.excludeStep && isGridAligned(y, options.excludeStep)) {
      continue
    }

    const gridY = normalizeGridCoordinate(y)
    commands.push(`M ${gridMinX} ${gridY} L ${gridMaxX} ${gridY}`)
  }

  return commands.join(' ')
}

function getRotatedViewBoxBounds(
  viewBox: { minX: number; minY: number; width: number; height: number },
  rotationDegrees: number,
) {
  const radians = (-rotationDegrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const corners = [
    { x: viewBox.minX, y: viewBox.minY },
    { x: viewBox.minX + viewBox.width, y: viewBox.minY },
    { x: viewBox.minX + viewBox.width, y: viewBox.minY + viewBox.height },
    { x: viewBox.minX, y: viewBox.minY + viewBox.height },
  ]

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const corner of corners) {
    const x = corner.x * cos - corner.y * sin
    const y = corner.x * sin + corner.y * cos
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }

  return { minX, maxX, minY, maxY }
}

function findClosestWallPoint(
  point: WallPlanPoint,
  walls: WallNode[],
  options?: {
    maxDistance?: number
    canUseWall?: (wall: WallNode) => boolean
  },
): {
  wall: WallNode
  point: WallPlanPoint
  t: number
  normal: [number, number, number]
} | null {
  const maxDistance = options?.maxDistance ?? 0.5
  const canUseWall = options?.canUseWall

  let best: {
    wall: WallNode
    point: WallPlanPoint
    t: number
    normal: [number, number, number]
  } | null = null
  let bestDistSq = maxDistance * maxDistance

  for (const wall of walls) {
    if (canUseWall && !canUseWall(wall)) {
      continue
    }

    const [x1, z1] = wall.start
    const [x2, z2] = wall.end
    const dx = x2 - x1
    const dz = z2 - z1
    const lengthSq = dx * dx + dz * dz
    if (lengthSq < 1e-9) continue

    let t = ((point[0] - x1) * dx + (point[1] - z1) * dz) / lengthSq
    t = Math.max(0, Math.min(1, t))

    const px = x1 + t * dx
    const pz = z1 + t * dz

    const distSq = (point[0] - px) ** 2 + (point[1] - pz) ** 2
    if (distSq < bestDistSq) {
      bestDistSq = distSq
      // Provide an arbitrary front-facing normal so the tool knows it's a valid wall side
      best = { wall, point: [px, pz], t, normal: [0, 0, 1] }
    }
  }

  return best
}

type GuideImageDimensions = {
  width: number
  height: number
}

function useResolvedAssetUrl(url: string) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!url) {
      setResolvedUrl(null)
      return
    }

    let cancelled = false
    setResolvedUrl(null)

    loadAssetUrl(url).then((nextUrl) => {
      if (!cancelled) {
        setResolvedUrl(nextUrl)
      }
    })

    return () => {
      cancelled = true
    }
  }, [url])

  return resolvedUrl
}

function useGuideImageDimensions(url: string | null) {
  const [dimensions, setDimensions] = useState<GuideImageDimensions | null>(null)

  useEffect(() => {
    if (!url) {
      setDimensions(null)
      return
    }

    let cancelled = false
    const image = new globalThis.Image()

    image.onload = () => {
      if (cancelled) {
        return
      }

      const width = image.naturalWidth || image.width
      const height = image.naturalHeight || image.height

      if (!(width > 0 && height > 0)) {
        setDimensions(null)
        return
      }

      setDimensions({ width, height })
    }

    image.onerror = () => {
      if (!cancelled) {
        setDimensions(null)
      }
    }

    image.src = url

    return () => {
      cancelled = true
    }
  }, [url])

  return dimensions
}

function FloorplanGuideImage({
  guide,
  isInteractive,
  isSelected,
  activeInteractionMode,
  onGuideSelect,
  onGuideTranslateStart,
}: {
  guide: GuideNode
  isInteractive: boolean
  isSelected: boolean
  activeInteractionMode: GuideInteractionMode | null
  onGuideSelect: (guideId: GuideNode['id']) => void
  onGuideTranslateStart: (guide: GuideNode, event: ReactPointerEvent<SVGRectElement>) => void
}) {
  const resolvedUrl = useResolvedAssetUrl(guide.url)
  const dimensions = useGuideImageDimensions(resolvedUrl)

  if (!(guide.opacity > 0 && guide.scale > 0 && resolvedUrl && dimensions)) {
    return null
  }

  const aspectRatio = dimensions.width / dimensions.height
  const planWidth = getGuideWidth(guide.scale)
  const planHeight = getGuideHeight(planWidth, aspectRatio)
  const centerX = toSvgX(guide.position[0])
  const centerY = toSvgY(guide.position[2])
  const rotationDeg = (getGuideSvgRotation(guide.rotation[1]) * 180) / Math.PI

  return (
    <g
      opacity={clamp(guide.opacity / 100, 0, 1)}
      transform={`translate(${centerX} ${centerY}) rotate(${rotationDeg})`}
    >
      {isInteractive ? (
        <rect
          fill="transparent"
          height={planHeight}
          onClick={(event) => {
            event.stopPropagation()
            onGuideSelect(guide.id)
          }}
          onPointerDown={(event) => {
            if (event.button === 0) {
              event.stopPropagation()
              if (isSelected) {
                onGuideTranslateStart(guide, event)
              }
            }
          }}
          pointerEvents="all"
          style={{
            cursor:
              isSelected && activeInteractionMode === 'translate'
                ? 'grabbing'
                : isSelected
                  ? 'grab'
                  : 'pointer',
          }}
          width={planWidth}
          x={-planWidth / 2}
          y={-planHeight / 2}
        />
      ) : null}
      <image
        height={planHeight}
        href={resolvedUrl}
        pointerEvents="none"
        preserveAspectRatio="none"
        width={planWidth}
        x={-planWidth / 2}
        y={-planHeight / 2}
      />
    </g>
  )
}

function worldToBuildingLocalPlanPoint(
  worldPosition: [number, number, number],
  buildingOrigin: [number, number, number],
  buildingRotationY: number,
): Point2D {
  const dx = worldPosition[0] - buildingOrigin[0]
  const dz = worldPosition[2] - buildingOrigin[2]
  const cos = Math.cos(buildingRotationY)
  const sin = Math.sin(buildingRotationY)

  return {
    x: dx * cos + dz * sin,
    y: -dx * sin + dz * cos,
  }
}

function getRoofSegmentCenter(
  roof: RoofNode,
  segment: RoofSegmentNode,
  worldPositionOverride?: Point2D,
): Point2D {
  if (worldPositionOverride) {
    return worldPositionOverride
  }

  const cos = Math.cos(roof.rotation)
  const sin = Math.sin(roof.rotation)
  const localX = segment.position[0]
  const localZ = segment.position[2]

  return {
    x: roof.position[0] + localX * cos - localZ * sin,
    y: roof.position[2] + localX * sin + localZ * cos,
  }
}

function getRoofSegmentPolygon(
  roof: RoofNode,
  segment: RoofSegmentNode,
  options?: {
    localRotation?: number
    worldPositionOverride?: Point2D
  },
): Point2D[] {
  const center = getRoofSegmentCenter(roof, segment, options?.worldPositionOverride)
  const rotation = roof.rotation + (options?.localRotation ?? segment.rotation)
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const halfWidth = segment.width / 2
  const halfDepth = segment.depth / 2

  const corners: Array<[number, number]> = [
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [halfWidth, halfDepth],
    [-halfWidth, halfDepth],
  ]

  return corners.map(([x, y]) => ({
    x: center.x + x * cos - y * sin,
    y: center.y + x * sin + y * cos,
  }))
}

function getRoofSegmentRidgeLine(
  roof: RoofNode,
  segment: RoofSegmentNode,
  options?: {
    localRotation?: number
    worldPositionOverride?: Point2D
  },
): FloorplanLineSegment | null {
  if (segment.roofType === 'flat') {
    return null
  }

  const center = getRoofSegmentCenter(roof, segment, options?.worldPositionOverride)
  const rotation = roof.rotation + (options?.localRotation ?? segment.rotation)
  const ridgeAxis =
    segment.roofType === 'gable' || segment.roofType === 'gambrel'
      ? 'x'
      : segment.roofType === 'dutch'
        ? segment.width >= segment.depth
          ? 'x'
          : 'z'
        : 'z'
  const axisAngle = ridgeAxis === 'x' ? rotation : rotation + Math.PI / 2
  const halfSpan = ridgeAxis === 'x' ? segment.width / 2 : segment.depth / 2

  return {
    start: {
      x: center.x - halfSpan * Math.cos(axisAngle),
      y: center.y - halfSpan * Math.sin(axisAngle),
    },
    end: {
      x: center.x + halfSpan * Math.cos(axisAngle),
      y: center.y + halfSpan * Math.sin(axisAngle),
    },
  }
}

const FloorplanGridLayer = memo(function FloorplanGridLayer({
  majorGridPath,
  minorGridPath,
  palette,
  showGrid,
}: {
  majorGridPath: string
  minorGridPath: string
  palette: FloorplanPalette
  showGrid: boolean
}) {
  if (!showGrid) {
    return null
  }

  return (
    <>
      <path
        d={minorGridPath}
        fill="none"
        opacity={palette.minorGridOpacity}
        shapeRendering="crispEdges"
        stroke={palette.minorGrid}
        strokeWidth={FLOORPLAN_MINOR_GRID_STROKE_WIDTH}
        vectorEffect="non-scaling-stroke"
      />

      <path
        d={majorGridPath}
        fill="none"
        opacity={palette.majorGridOpacity}
        shapeRendering="crispEdges"
        stroke={palette.majorGrid}
        strokeWidth={FLOORPLAN_MAJOR_GRID_STROKE_WIDTH}
        vectorEffect="non-scaling-stroke"
      />
    </>
  )
})

const FloorplanGuideLayer = memo(function FloorplanGuideLayer({
  guideUi,
  guides,
  isInteractive,
  selectedGuideId,
  activeGuideInteractionGuideId,
  activeGuideInteractionMode,
  onGuideSelect,
  onGuideTranslateStart,
}: {
  guideUi: Record<string, GuideUiState>
  guides: GuideNode[]
  isInteractive: boolean
  selectedGuideId: GuideNode['id'] | null
  activeGuideInteractionGuideId: GuideNode['id'] | null
  activeGuideInteractionMode: GuideInteractionMode | null
  onGuideSelect: (guideId: GuideNode['id']) => void
  onGuideTranslateStart: (guide: GuideNode, event: ReactPointerEvent<SVGRectElement>) => void
}) {
  if (!guides.length) {
    return null
  }

  const orderedGuides =
    selectedGuideId && guides.some((guide) => guide.id === selectedGuideId)
      ? [
          ...guides.filter((guide) => guide.id !== selectedGuideId),
          guides.find((guide) => guide.id === selectedGuideId)!,
        ]
      : guides

  return (
    <>
      {orderedGuides.map((guide) => (
        <FloorplanGuideImage
          activeInteractionMode={
            activeGuideInteractionGuideId === guide.id ? activeGuideInteractionMode : null
          }
          guide={guide}
          isInteractive={isInteractive && guideUi[guide.id]?.locked !== true}
          isSelected={selectedGuideId === guide.id}
          key={guide.id}
          onGuideSelect={onGuideSelect}
          onGuideTranslateStart={onGuideTranslateStart}
        />
      ))}
    </>
  )
})

function FloorplanReferenceScaleLine({
  end,
  isDraft = false,
  label,
  palette,
  start,
  unitsPerPixel,
}: {
  end: WallPlanPoint
  isDraft?: boolean
  label: string
  palette: FloorplanPalette
  start: WallPlanPoint
  unitsPerPixel: number
}) {
  const x1 = toSvgX(start[0])
  const y1 = toSvgY(start[1])
  const x2 = toSvgX(end[0])
  const y2 = toSvgY(end[1])
  const labelX = (x1 + x2) / 2
  const labelY = (y1 + y2) / 2
  const markerRadius = Math.max(unitsPerPixel * 5, 0.04)
  const labelPaddingX = Math.max(unitsPerPixel * 8, 0.08)
  const labelWidth = Math.max(
    label.length * unitsPerPixel * 7.2 + labelPaddingX * 2,
    unitsPerPixel * 54,
  )

  return (
    <g className={isDraft ? 'reference-scale-draft' : 'reference-scale'} pointerEvents="none">
      <line
        stroke={palette.cursor}
        strokeDasharray="8 6"
        strokeLinecap="round"
        strokeOpacity={isDraft ? 0.95 : 0.9}
        strokeWidth={2.25}
        vectorEffect="non-scaling-stroke"
        x1={x1}
        x2={x2}
        y1={y1}
        y2={y2}
      />
      <circle
        cx={x1}
        cy={y1}
        fill={palette.surface}
        r={markerRadius}
        stroke={palette.cursor}
        strokeWidth={1.75}
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={x2}
        cy={y2}
        fill={palette.surface}
        r={markerRadius}
        stroke={palette.cursor}
        strokeWidth={1.75}
        vectorEffect="non-scaling-stroke"
      />
      <g transform={`translate(${labelX} ${labelY - unitsPerPixel * 14})`}>
        <rect
          fill={palette.surface}
          height={unitsPerPixel * 20}
          opacity={0.94}
          rx={unitsPerPixel * 4}
          stroke={palette.cursor}
          strokeOpacity={0.55}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          width={labelWidth}
          x={-labelWidth / 2}
          y={-unitsPerPixel * 10}
        />
        <text
          dominantBaseline="middle"
          fill={palette.measurementStroke}
          fontSize={Math.max(unitsPerPixel * 11, 0.08)}
          fontWeight={700}
          pointerEvents="none"
          textAnchor="middle"
        >
          {label}
        </text>
      </g>
    </g>
  )
}

function FloorplanReferenceScaleLayer({
  draft,
  guideUi,
  guides,
  palette,
  unit,
  unitsPerPixel,
}: {
  draft: ReferenceScaleDraft | null
  guideUi: Record<string, GuideUiState>
  guides: GuideNode[]
  palette: FloorplanPalette
  unit: 'metric' | 'imperial'
  unitsPerPixel: number
}) {
  const visibleReferences = guides
    .filter((guide) => guideUi[guide.id]?.scaleReferenceVisible !== false)
    .map((guide) => guide.scaleReference)
    .filter((reference): reference is NonNullable<GuideNode['scaleReference']> =>
      Boolean(reference),
    )

  return (
    <>
      {visibleReferences.map((reference, index) => (
        <FloorplanReferenceScaleLine
          end={reference.end}
          key={`${reference.label}-${index}-${reference.start.join(',')}-${reference.end.join(',')}`}
          label={reference.label}
          palette={palette}
          start={reference.start}
          unitsPerPixel={unitsPerPixel}
        />
      ))}
      {draft?.start && (
        <FloorplanReferenceScaleDraftLine
          palette={palette}
          start={draft.start}
          unit={unit}
          unitsPerPixel={unitsPerPixel}
        />
      )}
    </>
  )
}

// The live reference-scale rubber-band — split out of the layer so it can
// subscribe to the shared cursor store for its moving END. A per-move cursor
// update re-renders ONLY this line, never FloorplanPanel; the START anchor +
// render config arrive as props (set per click, never per move).
function FloorplanReferenceScaleDraftLine({
  palette,
  start,
  unit,
  unitsPerPixel,
}: {
  palette: FloorplanPalette
  start: WallPlanPoint
  unit: 'metric' | 'imperial'
  unitsPerPixel: number
}) {
  const cursor = useFloorplanDraftPreview((s) => s.cursorPoint)
  if (!cursor) {
    return null
  }

  return (
    <FloorplanReferenceScaleLine
      end={cursor}
      isDraft
      label={`Ref ${formatMeasurement(
        Math.hypot(cursor[0] - start[0], cursor[1] - start[1]),
        unit,
      )}`}
      palette={palette}
      start={start}
      unitsPerPixel={unitsPerPixel}
    />
  )
}

function FloorplanGuideSelectionOverlay({
  guide,
  isDarkMode,
  rotationModifierPressed,
  showHandles,
  onCornerHoverChange,
  onCornerPointerDown,
}: {
  guide: GuideNode | null
  isDarkMode: boolean
  rotationModifierPressed: boolean
  showHandles: boolean
  onCornerHoverChange: (corner: GuideCorner | null) => void
  onCornerPointerDown: (
    guide: GuideNode,
    dimensions: GuideImageDimensions,
    corner: GuideCorner,
    event: ReactPointerEvent<SVGCircleElement>,
  ) => void
}) {
  const resolvedUrl = useResolvedAssetUrl(guide?.url ?? '')
  const dimensions = useGuideImageDimensions(resolvedUrl)

  if (!(guide && guide.opacity > 0 && guide.scale > 0 && resolvedUrl && dimensions)) {
    return null
  }

  const aspectRatio = dimensions.width / dimensions.height
  const planWidth = getGuideWidth(guide.scale)
  const planHeight = getGuideHeight(planWidth, aspectRatio)
  const centerX = toSvgX(guide.position[0])
  const centerY = toSvgY(guide.position[2])
  const rotationDeg = (getGuideSvgRotation(guide.rotation[1]) * 180) / Math.PI
  const selectionStroke = isDarkMode ? '#ffffff' : '#09090b'
  const handleFill = isDarkMode ? '#ffffff' : '#09090b'
  const handleStroke = isDarkMode ? '#0a0e1b' : '#ffffff'

  return (
    <g transform={`translate(${centerX} ${centerY}) rotate(${rotationDeg})`}>
      <rect
        fill="none"
        height={planHeight}
        pointerEvents="none"
        stroke={selectionStroke}
        strokeDasharray="none"
        strokeLinejoin="round"
        strokeWidth={FLOORPLAN_GUIDE_SELECTION_STROKE_WIDTH}
        vectorEffect="non-scaling-stroke"
        width={planWidth}
        x={-planWidth / 2}
        y={-planHeight / 2}
      />

      {showHandles
        ? GUIDE_CORNERS.map((corner) => {
            const [x, y] = getGuideCornerLocalOffset(planWidth, planHeight, corner)

            return (
              <g key={corner}>
                <rect
                  fill={handleFill}
                  height={FLOORPLAN_GUIDE_HANDLE_SIZE}
                  pointerEvents="none"
                  rx={FLOORPLAN_GUIDE_HANDLE_SIZE * 0.22}
                  ry={FLOORPLAN_GUIDE_HANDLE_SIZE * 0.22}
                  stroke={handleStroke}
                  strokeWidth="0.04"
                  vectorEffect="non-scaling-stroke"
                  width={FLOORPLAN_GUIDE_HANDLE_SIZE}
                  x={x - FLOORPLAN_GUIDE_HANDLE_SIZE / 2}
                  y={y - FLOORPLAN_GUIDE_HANDLE_SIZE / 2}
                />
                <circle
                  cx={x}
                  cy={y}
                  fill="transparent"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  onPointerDown={(event) => onCornerPointerDown(guide, dimensions, corner, event)}
                  onPointerEnter={() => onCornerHoverChange(corner)}
                  onPointerLeave={() => onCornerHoverChange(null)}
                  pointerEvents="all"
                  r={FLOORPLAN_GUIDE_HANDLE_HIT_RADIUS}
                  stroke="transparent"
                  strokeWidth={FLOORPLAN_GUIDE_HANDLE_HIT_RADIUS * 2}
                  style={{
                    cursor: rotationModifierPressed
                      ? getGuideRotateCursor(isDarkMode)
                      : getGuideResizeCursor(corner, getGuideSvgRotation(guide.rotation[1])),
                  }}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )
          })
        : null}
    </g>
  )
}

function FloorplanGuideHandleHint({
  anchor,
  isDarkMode,
  isMacPlatform,
  rotationModifierPressed,
}: {
  anchor: GuideHandleHintAnchor | null
  isDarkMode: boolean
  isMacPlatform: boolean
  rotationModifierPressed: boolean
}) {
  if (!anchor) {
    return null
  }

  const primaryToneClass = isDarkMode
    ? 'text-white drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.5)]'
    : 'text-[#09090b] drop-shadow-[0_1px_1.5px_rgba(255,255,255,0.8)]'

  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none absolute z-20 select-none', primaryToneClass)}
      style={{
        left: anchor.x,
        top: anchor.y,
        transform: `translate(calc(-50% + ${anchor.directionX * 12}px), calc(-50% + ${anchor.directionY * 12}px))`,
      }}
    >
      <div className="flex flex-col gap-0.5">
        <div
          className={cn(
            'flex items-center gap-1.5 transition-opacity duration-150',
            rotationModifierPressed ? 'opacity-40' : 'opacity-100',
          )}
        >
          <span className="font-medium text-[11px] lowercase leading-none">resize</span>
          <Icon
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0"
            color="currentColor"
            icon="ph:mouse-left-click-fill"
          />
        </div>

        <div
          className={cn(
            'flex items-center gap-1.5 transition-opacity duration-150',
            rotationModifierPressed ? 'opacity-100' : 'opacity-40',
          )}
        >
          <span className="font-medium text-[11px] lowercase leading-none">rotate</span>
          {isMacPlatform ? (
            <Command aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
          ) : (
            <span className="font-mono text-[10px] uppercase leading-none">ctrl</span>
          )}
          <Icon
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0"
            color="currentColor"
            icon="ph:mouse-left-click-fill"
          />
        </div>
      </div>
    </div>
  )
}

const FloorplanReferenceFloorLayer = memo(function FloorplanReferenceFloorLayer({
  data,
  opacity,
}: {
  data: ReferenceFloorData | null
  opacity: number
}) {
  if (!data) {
    return null
  }

  const clampedOpacity = clamp(opacity, 0.1, 0.8)

  return (
    <g opacity={clampedOpacity} pointerEvents="none">
      {data.slabPolygons.map(({ path, slab }) => (
        <path
          d={path}
          fill="rgba(100, 116, 139, 0.14)"
          fillRule="evenodd"
          key={slab.id}
          stroke="rgba(100, 116, 139, 0.45)"
          strokeWidth={1.2}
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {data.ceilingPolygons.map(({ ceiling, path }) => (
        <path
          d={path}
          fill="rgba(245, 158, 11, 0.06)"
          fillRule="evenodd"
          key={ceiling.id}
          stroke="rgba(245, 158, 11, 0.28)"
          strokeDasharray="6 4"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {data.wallPolygons.map(({ polygon, points, wall }) =>
        polygon.length >= 3 ? (
          <polygon
            fill="rgba(100, 116, 139, 0.18)"
            key={wall.id}
            points={points}
            stroke="rgba(71, 85, 105, 0.7)"
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          />
        ) : null,
      )}

      {data.fenceEntries.map(({ fence, path }) => (
        <path
          d={path}
          fill="none"
          key={fence.id}
          stroke="rgba(71, 85, 105, 0.65)"
          strokeDasharray="5 4"
          strokeLinecap="round"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {data.columnEntries.map(({ column, points }) => (
        <polygon
          fill="rgba(124, 58, 237, 0.12)"
          key={column.id}
          points={points}
          stroke="rgba(88, 28, 135, 0.55)"
          strokeWidth={1.1}
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {data.openingPolygons.map(({ opening, points }) => (
        <polygon
          fill="rgba(255, 255, 255, 0.72)"
          key={opening.id}
          points={points}
          stroke="rgba(51, 65, 85, 0.72)"
          strokeWidth={1.1}
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {data.itemEntries.map(({ item, points }) => (
        <polygon
          fill="rgba(71, 85, 105, 0.12)"
          key={item.id}
          points={points}
          stroke="rgba(71, 85, 105, 0.5)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {data.registryEntries.map(({ node, geometry }) => (
        <FloorplanGeometryRenderer geometry={geometry} key={node.id} />
      ))}
    </g>
  )
})

const FloorplanSiteLayer = memo(function FloorplanSiteLayer({
  isHighlighted,
  palette,
  sitePolygon,
}: {
  isHighlighted: boolean
  palette: FloorplanPalette
  sitePolygon: SitePolygonEntry | null
}) {
  if (!sitePolygon) {
    return null
  }

  const stroke = isHighlighted ? palette.cursor : palette.measurementStroke
  const dashLength = isHighlighted ? 8 : 7
  const gapLength = isHighlighted ? 5 : 6
  const strokeWidth = isHighlighted ? 2.2 : 1.5
  const contrastStrokeWidth = isHighlighted ? 4.2 : 3.4
  const dashPattern = `${dashLength} ${gapLength}`

  return (
    <>
      <polygon
        fill="none"
        pointerEvents="none"
        points={sitePolygon.points}
        stroke={palette.surface}
        strokeDasharray={dashPattern}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity={isHighlighted ? 0.72 : 0.82}
        strokeWidth={contrastStrokeWidth}
        vectorEffect="non-scaling-stroke"
      />
      <polygon
        fill="none"
        pointerEvents="none"
        points={sitePolygon.points}
        stroke={stroke}
        strokeDasharray={dashPattern}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity={isHighlighted ? 0.98 : 0.78}
        strokeWidth={strokeWidth}
        vectorEffect="non-scaling-stroke"
      />
    </>
  )
})

const FloorplanSiteEdgeLabelLayer = memo(function FloorplanSiteEdgeLabelLayer({
  labelBackground,
  labelText,
  palette,
  sceneRotationDeg,
  shouldShow,
  sitePolygon,
  unit,
  unitsPerPixel,
}: {
  labelBackground: string
  labelText: string
  palette: FloorplanPalette
  sceneRotationDeg: number
  shouldShow: boolean
  sitePolygon: SitePolygonEntry | null
  unit: 'metric' | 'imperial'
  unitsPerPixel: number
}) {
  if (!(shouldShow && sitePolygon && sitePolygon.polygon.length >= 2)) {
    return null
  }

  const upx = unitsPerPixel
  const fontSize = Math.max(upx * 10, 0.08)
  const padX = upx * 6
  const padY = upx * 3
  const minWidth = upx * 38
  const labelOffset = upx * 18
  const centroid = sitePolygon.polygon.reduce(
    (acc, point) => ({
      x: acc.x + point.x / sitePolygon.polygon.length,
      y: acc.y + point.y / sitePolygon.polygon.length,
    }),
    { x: 0, y: 0 },
  )
  const edges = sitePolygon.polygon.flatMap((start, edgeIndex, polygon) => {
    const end = polygon[(edgeIndex + 1) % polygon.length]
    if (!end) {
      return []
    }

    const dx = end.x - start.x
    const dy = end.y - start.y
    const length = Math.hypot(dx, dy)
    if (length < 1e-6) {
      return []
    }

    const midX = (start.x + end.x) / 2
    const midY = (start.y + end.y) / 2
    let normalX = -dy / length
    let normalY = dx / length
    if (normalX * (midX - centroid.x) + normalY * (midY - centroid.y) < 0) {
      normalX = -normalX
      normalY = -normalY
    }

    let labelAngleDeg = (Math.atan2(dy, dx) * 180) / Math.PI
    let screenDeg = labelAngleDeg + sceneRotationDeg
    screenDeg = ((((screenDeg + 180) % 360) + 360) % 360) - 180
    if (screenDeg > 90) {
      labelAngleDeg -= 180
    } else if (screenDeg <= -90) {
      labelAngleDeg += 180
    }

    const label = formatMeasurement(length, unit)
    const width = Math.max(label.length * upx * 6.4 + padX * 2, minWidth)
    const height = fontSize + padY * 2

    return [
      {
        edgeIndex,
        height,
        label,
        labelAngleDeg,
        labelX: midX + normalX * labelOffset,
        labelY: midY + normalY * labelOffset,
        width,
      },
    ]
  })

  return (
    <g pointerEvents="none">
      {edges.map(({ edgeIndex, height, label, labelAngleDeg, labelX, labelY, width }) => (
        <g
          key={`site-edge-label-${edgeIndex}`}
          transform={`translate(${labelX} ${labelY}) rotate(${labelAngleDeg})`}
        >
          <rect
            fill={labelBackground}
            height={height}
            opacity={0.94}
            rx={upx * 3}
            ry={upx * 3}
            stroke={palette.cursor}
            strokeOpacity={0.58}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            width={width}
            x={-width / 2}
            y={-height / 2}
          />
          <text
            dominantBaseline="middle"
            fill={labelText}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            fontSize={fontSize}
            fontWeight={700}
            textAnchor="middle"
            x={0}
            y={0}
          >
            {label}
          </text>
        </g>
      ))}
    </g>
  )
})

const FloorplanZoneLayer = memo(function FloorplanZoneLayer({
  canSelectZones,
  hoveredZoneId,
  isDeleteMode,
  onZoneHoverChange,
  onZoneSelect,
  palette,
  selectedZoneId,
  zonePolygons,
}: {
  canSelectZones: boolean
  hoveredZoneId: ZoneNodeType['id'] | null
  isDeleteMode: boolean
  onZoneHoverChange: (zoneId: ZoneNodeType['id'] | null) => void
  onZoneSelect: (zoneId: ZoneNodeType['id'], event: ReactMouseEvent<SVGElement>) => void
  palette: FloorplanPalette
  selectedZoneId: ZoneNodeType['id'] | null
  zonePolygons: ZonePolygonEntry[]
}) {
  return (
    <>
      {zonePolygons.map(({ zone, points }) => {
        const isSelected = selectedZoneId === zone.id
        const isHovered = hoveredZoneId === zone.id
        const isDeleteHovered = isDeleteMode && isHovered

        return (
          <g key={zone.id}>
            <polygon
              fill={isDeleteHovered ? palette.deleteFill : zone.color}
              fillOpacity={isDeleteHovered ? 0.22 : isSelected ? 0.28 : 0.16}
              pointerEvents="none"
              points={points}
              stroke={
                isDeleteHovered
                  ? palette.deleteStroke
                  : isSelected
                    ? palette.selectedStroke
                    : zone.color
              }
              strokeLinejoin="round"
              strokeOpacity={isDeleteHovered || isSelected ? 0.96 : 0.72}
              strokeWidth={isDeleteHovered || isSelected ? '0.08' : '0.05'}
              vectorEffect="non-scaling-stroke"
            />
            {canSelectZones && (
              <polygon
                fill="none"
                onClick={(event) => {
                  event.stopPropagation()
                  onZoneSelect(zone.id, event)
                }}
                onPointerEnter={() => onZoneHoverChange(zone.id)}
                onPointerLeave={() => onZoneHoverChange(null)}
                pointerEvents="stroke"
                points={points}
                stroke="transparent"
                strokeLinejoin="round"
                strokeWidth={FLOORPLAN_WALL_HIT_STROKE_WIDTH}
                style={{ cursor: EDITOR_CURSOR }}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </g>
        )
      })}
    </>
  )
})

const FLOORPLAN_ZONE_LABEL_FONT_SIZE = 0.2

function FloorplanZoneLabelInput({
  centroid,
  svgRef,
  viewBox,
  zone,
  onDone,
}: {
  centroid: { x: number; y: number }
  svgRef: React.RefObject<SVGSVGElement | null>
  viewBox: { minX: number; minY: number; width: number; height: number }
  zone: ZoneNodeType
  onDone: () => void
}) {
  const updateNode = useScene((s) => s.updateNode)
  const [value, setValue] = useState(zone.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [])

  const save = useCallback(() => {
    const trimmed = value.trim()
    if (trimmed && trimmed !== zone.name) {
      updateNode(zone.id, { name: trimmed })
    }
    onDone()
  }, [value, zone.id, zone.name, updateNode, onDone])

  // Convert SVG coordinates to screen pixel position
  const svgEl = svgRef.current
  if (!svgEl) return null
  const rect = svgEl.getBoundingClientRect()
  const screenX = ((centroid.x - viewBox.minX) / viewBox.width) * rect.width + rect.left
  const screenY = ((centroid.y - viewBox.minY) / viewBox.height) * rect.height + rect.top

  return createPortal(
    <input
      onBlur={save}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          save()
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          onDone()
        }
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      ref={inputRef}
      style={{
        position: 'fixed',
        left: screenX,
        top: screenY,
        transform: 'translate(-50%, -50%)',
        border: 'none',
        borderBottom: `1px solid ${zone.color}`,
        background: 'transparent',
        color: 'white',
        textShadow: `-1px -1px 0 ${zone.color}, 1px -1px 0 ${zone.color}, -1px 1px 0 ${zone.color}, 1px 1px 0 ${zone.color}`,
        outline: 'none',
        textAlign: 'center',
        fontSize: '14px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: '2px 4px',
        margin: 0,
        zIndex: 100,
        width: `${Math.max((value || zone.name || '').length + 2, 6)}ch`,
      }}
      type="text"
      value={value}
    />,
    document.body,
  )
}

// Pencil icon as an SVG path (Lucide pencil simplified), rendered relative to the label
const PENCIL_ICON_SIZE = FLOORPLAN_ZONE_LABEL_FONT_SIZE * 0.6

function FloorplanZoneLabel({
  centroid,
  onHoverChange,
  onLabelClick,
  zone,
}: {
  centroid: { x: number; y: number }
  onHoverChange: (zoneId: ZoneNodeType['id'] | null) => void
  onLabelClick: (zoneId: ZoneNodeType['id'], event: ReactMouseEvent<SVGElement>) => void
  zone: ZoneNodeType
}) {
  const [hovered, setHovered] = useState(false)
  const textRef = useRef<SVGTextElement>(null)
  const [textWidth, setTextWidth] = useState(0)
  const mode = useEditor((s) => s.mode)
  const deleteNode = useScene((s) => s.deleteNode)
  const setSelection = useViewer((s) => s.setSelection)

  useEffect(() => {
    if (textRef.current) {
      setTextWidth(textRef.current.getComputedTextLength())
    }
  }, [])

  const isDeleteMode = mode === 'delete'

  return (
    <g
      cursor="pointer"
      onClick={(e) => {
        e.stopPropagation()
        if (isDeleteMode) {
          sfxEmitter.emit('sfx:structure-delete')
          deleteNode(zone.id as AnyNodeId)
          setSelection({ zoneId: null })
          return
        }
        onLabelClick(zone.id, e)
      }}
      onPointerEnter={() => {
        setHovered(true)
        onHoverChange(zone.id)
      }}
      onPointerLeave={() => {
        setHovered(false)
        onHoverChange(null)
      }}
      pointerEvents="auto"
      style={{ userSelect: 'none' }}
    >
      <text
        dominantBaseline="central"
        fill={isDeleteMode && hovered ? '#fecaca' : 'white'}
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize={FLOORPLAN_ZONE_LABEL_FONT_SIZE}
        fontWeight="500"
        paintOrder="stroke"
        ref={textRef}
        stroke={isDeleteMode && hovered ? '#dc2626' : zone.color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={FLOORPLAN_ZONE_LABEL_FONT_SIZE * 0.35}
        textAnchor="middle"
        x={centroid.x}
        y={centroid.y}
      >
        {zone.name}
      </text>
      {/* Pencil icon — visible on hover */}
      {hovered && textWidth > 0 && (
        <g
          transform={`translate(${centroid.x + textWidth / 2 + PENCIL_ICON_SIZE * 0.5}, ${centroid.y - PENCIL_ICON_SIZE / 2})`}
        >
          <g transform={`scale(${PENCIL_ICON_SIZE / 24})`}>
            <path
              d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
              fill="none"
              paintOrder="stroke"
              stroke={zone.color}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={3}
            />
            <path
              d="m15 5 4 4"
              fill="none"
              stroke={zone.color}
              strokeLinecap="round"
              strokeWidth={3}
            />
          </g>
        </g>
      )}
    </g>
  )
}

const FloorplanPolygonHandleLayer = memo(function FloorplanPolygonHandleLayer({
  edgeHandles = [],
  hoveredHandleId,
  midpointStyle = 'default',
  midpointHandles,
  onEdgePointerDown,
  onHandleHoverChange,
  onMidpointPointerDown,
  onVertexDoubleClick,
  onVertexPointerDown,
  palette,
  unitsPerPixel,
  vertexHandles,
}: {
  edgeHandles?: Array<{
    nodeId: string
    edgeIndex: number
    start: WallPlanPoint
    end: WallPlanPoint
    isActive?: boolean
  }>
  vertexHandles: Array<{
    nodeId: string
    vertexIndex: number
    point: WallPlanPoint
    isActive: boolean
  }>
  midpointStyle?: 'default' | 'add'
  midpointHandles: Array<{
    nodeId: string
    edgeIndex: number
    point: WallPlanPoint
  }>
  hoveredHandleId: string | null
  onHandleHoverChange: (handleId: string | null) => void
  onVertexPointerDown: (
    nodeId: string,
    vertexIndex: number,
    event: ReactPointerEvent<SVGCircleElement>,
  ) => void
  onVertexDoubleClick: (
    nodeId: string,
    vertexIndex: number,
    event: ReactPointerEvent<SVGCircleElement> | ReactMouseEvent<SVGCircleElement>,
  ) => void
  onMidpointPointerDown: (
    nodeId: string,
    edgeIndex: number,
    event: ReactPointerEvent<SVGCircleElement>,
  ) => void
  onEdgePointerDown?: (
    nodeId: string,
    edgeIndex: number,
    event: ReactPointerEvent<SVGLineElement>,
  ) => void
  palette: FloorplanPalette
  unitsPerPixel: number
}) {
  const vertexPointerDoubleClickRef = useRef<string | null>(null)

  return (
    <>
      {edgeHandles.map(({ nodeId, edgeIndex, start, end, isActive }) => {
        const handleId = `${nodeId}:edge:${edgeIndex}`
        const isHovered = hoveredHandleId === handleId
        const startSvg = toSvgPlanPoint(start)
        const endSvg = toSvgPlanPoint(end)
        const visibleStroke = isActive || isHovered ? palette.cursor : palette.measurementStroke

        return (
          <g
            key={handleId}
            onClick={(event) => {
              event.stopPropagation()
            }}
            onPointerEnter={() => onHandleHoverChange(handleId)}
            onPointerLeave={() => onHandleHoverChange(null)}
          >
            <line
              pointerEvents="none"
              stroke={visibleStroke}
              strokeLinecap="round"
              strokeOpacity={0.18}
              strokeWidth={FLOORPLAN_POLYGON_EDGE_HOVER_GLOW_STROKE_WIDTH_PX}
              style={{
                opacity: isHovered || isActive ? 1 : 0,
                transition: FLOORPLAN_HOVER_TRANSITION,
              }}
              vectorEffect="non-scaling-stroke"
              x1={startSvg.x}
              x2={endSvg.x}
              y1={startSvg.y}
              y2={endSvg.y}
            />
            <line
              pointerEvents="none"
              stroke={visibleStroke}
              strokeLinecap="round"
              strokeOpacity={isActive ? 0.95 : 0.82}
              strokeWidth={FLOORPLAN_POLYGON_EDGE_VISIBLE_STROKE_WIDTH_PX}
              style={{
                opacity: isHovered || isActive ? 1 : 0,
                transition: FLOORPLAN_HOVER_TRANSITION,
              }}
              vectorEffect="non-scaling-stroke"
              x1={startSvg.x}
              x2={endSvg.x}
              y1={startSvg.y}
              y2={endSvg.y}
            />
            <line
              onPointerDown={
                onEdgePointerDown
                  ? (event) => onEdgePointerDown(nodeId, edgeIndex, event)
                  : undefined
              }
              pointerEvents="stroke"
              stroke="transparent"
              strokeLinecap="round"
              strokeWidth={FLOORPLAN_POLYGON_EDGE_HIT_STROKE_WIDTH_PX}
              style={{ cursor: EDITOR_CURSOR }}
              vectorEffect="non-scaling-stroke"
              x1={startSvg.x}
              x2={endSvg.x}
              y1={startSvg.y}
              y2={endSvg.y}
            />
          </g>
        )
      })}

      {vertexHandles.map(({ nodeId, vertexIndex, point, isActive }) => {
        const handleId = `${nodeId}:vertex:${vertexIndex}`
        const isHovered = hoveredHandleId === handleId
        const hoveredEdgePrefix = `${nodeId}:edge:`
        const hoveredMidpointPrefix = `${nodeId}:midpoint:`
        const hoveredEdgeIndex = hoveredHandleId?.startsWith(hoveredEdgePrefix)
          ? Number(hoveredHandleId.slice(hoveredEdgePrefix.length))
          : hoveredHandleId?.startsWith(hoveredMidpointPrefix)
            ? Number(hoveredHandleId.slice(hoveredMidpointPrefix.length))
            : null
        const isNearHoveredEdge =
          Number.isInteger(hoveredEdgeIndex) &&
          hoveredEdgeIndex !== null &&
          (vertexIndex === hoveredEdgeIndex ||
            vertexIndex === (hoveredEdgeIndex + 1) % vertexHandles.length)
        const stroke =
          isActive || isHovered || isNearHoveredEdge ? palette.cursor : palette.measurementStroke
        const handleOpacity = isActive || isHovered || isNearHoveredEdge ? 1 : 0
        const outerRadius =
          (isActive
            ? FLOORPLAN_POLYGON_VERTEX_ACTIVE_RADIUS_PX
            : FLOORPLAN_POLYGON_VERTEX_RADIUS_PX) * unitsPerPixel
        const dotRadius =
          (isActive
            ? FLOORPLAN_POLYGON_VERTEX_ACTIVE_DOT_RADIUS_PX
            : FLOORPLAN_POLYGON_VERTEX_DOT_RADIUS_PX) * unitsPerPixel
        const svgPoint = toSvgPlanPoint(point)

        return (
          <g
            key={handleId}
            onClick={(event) => {
              event.stopPropagation()
            }}
            onPointerEnter={() => onHandleHoverChange(handleId)}
            onPointerLeave={() => onHandleHoverChange(null)}
          >
            <circle
              cx={svgPoint.x}
              cy={svgPoint.y}
              fill="none"
              pointerEvents="none"
              r={outerRadius}
              stroke={stroke}
              strokeOpacity={0.18}
              strokeWidth={FLOORPLAN_ENDPOINT_HOVER_GLOW_STROKE_WIDTH}
              style={{
                opacity: handleOpacity,
                transition: FLOORPLAN_HOVER_TRANSITION,
              }}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={svgPoint.x}
              cy={svgPoint.y}
              fill={isActive ? palette.endpointHandleActiveFill : palette.endpointHandleFill}
              fillOpacity={0.96 * handleOpacity}
              pointerEvents="none"
              r={outerRadius}
              stroke={stroke}
              strokeOpacity={handleOpacity}
              strokeWidth="0.045"
              style={{ transition: FLOORPLAN_HOVER_TRANSITION }}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={svgPoint.x}
              cy={svgPoint.y}
              fill={stroke}
              fillOpacity={handleOpacity}
              pointerEvents="none"
              r={dotRadius}
              style={{ transition: FLOORPLAN_HOVER_TRANSITION }}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={svgPoint.x}
              cy={svgPoint.y}
              fill="transparent"
              onDoubleClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                if (vertexPointerDoubleClickRef.current === handleId) {
                  vertexPointerDoubleClickRef.current = null
                  return
                }

                onVertexDoubleClick(nodeId, vertexIndex, event)
              }}
              onPointerDown={(event) => {
                if (event.button === 0 && event.detail >= 2) {
                  vertexPointerDoubleClickRef.current = handleId
                  window.setTimeout(() => {
                    if (vertexPointerDoubleClickRef.current === handleId) {
                      vertexPointerDoubleClickRef.current = null
                    }
                  }, 400)
                  onVertexDoubleClick(nodeId, vertexIndex, event)
                  return
                }

                onVertexPointerDown(nodeId, vertexIndex, event)
              }}
              pointerEvents="all"
              r={outerRadius}
              stroke="transparent"
              strokeWidth={FLOORPLAN_ENDPOINT_HIT_STROKE_WIDTH}
              style={{ cursor: EDITOR_CURSOR }}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        )
      })}

      {midpointHandles.map(({ nodeId, edgeIndex, point }) => {
        const handleId = `${nodeId}:midpoint:${edgeIndex}`
        const isHovered = hoveredHandleId === handleId
        const isEdgeHovered = hoveredHandleId === `${nodeId}:edge:${edgeIndex}`
        const isVisible = isHovered || isEdgeHovered
        const isAddHandle = midpointStyle === 'add'
        const stroke = isAddHandle
          ? '#111827'
          : isVisible
            ? palette.cursor
            : palette.measurementStroke
        const radius =
          (isAddHandle
            ? isHovered
              ? FLOORPLAN_POLYGON_VERTEX_ACTIVE_RADIUS_PX
              : FLOORPLAN_POLYGON_VERTEX_RADIUS_PX
            : isHovered
              ? FLOORPLAN_POLYGON_MIDPOINT_HOVER_RADIUS_PX
              : FLOORPLAN_POLYGON_MIDPOINT_RADIUS_PX) * unitsPerPixel
        const dotRadius = isAddHandle ? 0 : FLOORPLAN_POLYGON_MIDPOINT_DOT_RADIUS_PX * unitsPerPixel
        const plusHalfLength = 3 * unitsPerPixel
        const svgPoint = toSvgPlanPoint(point)

        return (
          <g
            key={handleId}
            onClick={(event) => {
              event.stopPropagation()
            }}
            onPointerEnter={() => onHandleHoverChange(handleId)}
            onPointerLeave={() => onHandleHoverChange(null)}
          >
            <circle
              cx={svgPoint.x}
              cy={svgPoint.y}
              fill="none"
              pointerEvents="none"
              r={radius + 2 * unitsPerPixel}
              stroke={stroke}
              strokeOpacity={0.16}
              strokeWidth={FLOORPLAN_ENDPOINT_HOVER_RING_STROKE_WIDTH}
              style={{
                opacity: isVisible ? 1 : 0,
                transition: FLOORPLAN_HOVER_TRANSITION,
              }}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={svgPoint.x}
              cy={svgPoint.y}
              fill={isAddHandle ? '#ffffff' : palette.surface}
              fillOpacity={isVisible ? (isAddHandle ? 1 : 0.94) : 0}
              pointerEvents="none"
              r={radius}
              stroke={stroke}
              strokeOpacity={isVisible ? 0.9 : 0}
              strokeWidth={isAddHandle ? '1.4' : '0.035'}
              style={{ transition: FLOORPLAN_HOVER_TRANSITION }}
              vectorEffect="non-scaling-stroke"
            />
            {isAddHandle ? (
              <>
                <line
                  pointerEvents="none"
                  stroke="#111827"
                  strokeOpacity={isVisible ? 1 : 0}
                  strokeLinecap="round"
                  strokeWidth="1.6"
                  style={{ transition: FLOORPLAN_HOVER_TRANSITION }}
                  vectorEffect="non-scaling-stroke"
                  x1={svgPoint.x - plusHalfLength}
                  x2={svgPoint.x + plusHalfLength}
                  y1={svgPoint.y}
                  y2={svgPoint.y}
                />
                <line
                  pointerEvents="none"
                  stroke="#111827"
                  strokeOpacity={isVisible ? 1 : 0}
                  strokeLinecap="round"
                  strokeWidth="1.6"
                  style={{ transition: FLOORPLAN_HOVER_TRANSITION }}
                  vectorEffect="non-scaling-stroke"
                  x1={svgPoint.x}
                  x2={svgPoint.x}
                  y1={svgPoint.y - plusHalfLength}
                  y2={svgPoint.y + plusHalfLength}
                />
              </>
            ) : (
              <circle
                cx={svgPoint.x}
                cy={svgPoint.y}
                fill={stroke}
                fillOpacity={isVisible ? 0.82 : 0}
                pointerEvents="none"
                r={dotRadius}
                style={{ transition: FLOORPLAN_HOVER_TRANSITION }}
                vectorEffect="non-scaling-stroke"
              />
            )}
            <circle
              cx={svgPoint.x}
              cy={svgPoint.y}
              fill="transparent"
              onPointerDown={(event) => onMidpointPointerDown(nodeId, edgeIndex, event)}
              pointerEvents="all"
              r={radius}
              stroke="transparent"
              strokeWidth={FLOORPLAN_ENDPOINT_HIT_STROKE_WIDTH}
              style={{ cursor: EDITOR_CURSOR }}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        )
      })}
    </>
  )
})

// Static segment for the in-flight stair build preview. No per-render
// dependency (the geometry only moves / rotates), so it lives at module scope
// instead of a `useMemo`.
const FLOORPLAN_PREVIEW_STAIR_SEGMENT = StairSegmentNodeSchema.parse({
  id: 'sseg_floorplan_preview',
  segmentType: 'stair',
  width: DEFAULT_STAIR_WIDTH,
  length: DEFAULT_STAIR_LENGTH,
  height: DEFAULT_STAIR_HEIGHT,
  stepCount: DEFAULT_STAIR_STEP_COUNT,
  attachmentSide: DEFAULT_STAIR_ATTACHMENT_SIDE,
  fillToFloor: DEFAULT_STAIR_FILL_TO_FLOOR,
  thickness: DEFAULT_STAIR_THICKNESS,
  position: [0, 0, 0],
  metadata: { isTransient: true, isFloorplanPreview: true },
})

const EMPTY_FLOORPLAN_ID_SET: ReadonlySet<string> = new Set()

type FloorplanStairLayerPalette = ComponentProps<typeof FloorplanStairLayer>['palette']

// Leaf layer for the stair tool's in-flight 2D build preview. Subscribes to the
// `useStairBuildPreview` store directly so a per-`grid:move` point update (or an
// R/T rotation) re-renders ONLY this tiny layer — never the ~120-220ms
// `FloorplanPanel`. This mirrors how column / elevator placement stays smooth by
// routing preview state through a store + leaf. Committed stairs render through
// `FloorplanRegistryLayer`; this layer is non-interactive (noop handlers, empty
// hit sets), so it never participates in hover / select.
function FloorplanStairBuildPreviewLayer({
  palette,
  isDeleteMode,
}: {
  palette: FloorplanStairLayerPalette
  isDeleteMode: boolean
}) {
  const phase = useEditor((s) => s.phase)
  const mode = useEditor((s) => s.mode)
  const tool = useEditor((s) => s.tool)
  const point = useStairBuildPreview((s) => s.point)
  const rotation = useStairBuildPreview((s) => s.rotation)
  const isActive = phase === 'structure' && mode === 'build' && tool === 'stair'

  const previewEntry = useMemo(() => {
    if (!(isActive && point)) {
      return null
    }
    const previewStair = StairNodeSchema.parse({
      id: 'stair_floorplan_preview',
      name: 'Staircase preview',
      position: [point[0], 0, point[1]],
      rotation,
      children: [FLOORPLAN_PREVIEW_STAIR_SEGMENT.id],
      metadata: { isTransient: true, isFloorplanPreview: true },
    })
    const entry = buildSharedFloorplanStairEntry(previewStair, [FLOORPLAN_PREVIEW_STAIR_SEGMENT])
    if (!entry) {
      return null
    }
    const hitPolygons =
      (previewStair.stairType ?? 'straight') === 'straight'
        ? entry.segments.map((segmentEntry) => segmentEntry.polygon)
        : [getFloorplanCurvedStairHitPolygon(previewStair)]

    return {
      ...entry,
      hitPolygons,
      segments: entry.segments.map((segmentEntry) => ({
        ...segmentEntry,
        innerPoints: formatPolygonPoints(segmentEntry.innerPolygon),
        points: formatPolygonPoints(segmentEntry.polygon),
        treadBars: segmentEntry.treadBars.map((polygon) => ({
          points: formatPolygonPoints(polygon),
          polygon,
        })),
      })),
    }
  }, [isActive, point, rotation])

  if (!previewEntry) {
    return null
  }

  return (
    <FloorplanStairLayer
      canFocusStairs={false}
      canSelectStairs={false}
      cursor={EDITOR_CURSOR}
      highlightedIdSet={EMPTY_FLOORPLAN_ID_SET}
      hitStrokeWidth={FLOORPLAN_OPENING_HIT_STROKE_WIDTH}
      hoveredStairId={null}
      isDeleteMode={isDeleteMode}
      onStairDoubleClick={noopFloorplanStairHandler}
      onStairHoverChange={noopFloorplanStairHandler}
      onStairHoverEnter={noopFloorplanStairHandler}
      onStairPointerDown={noopFloorplanStairHandler}
      onStairSelect={noopFloorplanStairHandler}
      palette={palette}
      selectedIdSet={EMPTY_FLOORPLAN_ID_SET}
      stairEntries={[previewEntry]}
    />
  )
}

// Leaf overlay for the cursor-following draft preview: the cursor crosshair plus
// the live polygon-draft edge (slab / zone / ceiling). Subscribes to
// `useFloorplanDraftPreview.cursorPoint` directly so a per-`grid:move` cursor
// update re-renders ONLY this tiny layer — never the (~120-220ms) FloorplanPanel.
// Everything else it needs is per-click panel state (the committed draft points)
// passed as props, so it re-renders on click via the parent and on move via the
// store. SVG mirrors the cursor-driven branches of `FloorplanDraftLayer`.
function FloorplanDraftCursorLayer({
  activePolygonDraftPoints,
  isPolygonDraftBuildActive,
  cursorColor,
  draftFill,
  draftStroke,
  polygonDraftStroke,
  unitsPerPixel,
}: {
  activePolygonDraftPoints: WallPlanPoint[]
  isPolygonDraftBuildActive: boolean
  cursorColor: string
  draftFill: string
  draftStroke: string
  polygonDraftStroke: string | undefined
  unitsPerPixel: number
}) {
  const cursorPoint = useFloorplanDraftPreview((s) => s.cursorPoint)
  const activeStroke = polygonDraftStroke ?? draftStroke
  const strokeWidth = polygonDraftStroke ? FLOORPLAN_WALL_STROKE_WIDTH : '0.08'

  const polygon = useMemo(() => {
    if (!(isPolygonDraftBuildActive && cursorPoint && activePolygonDraftPoints.length >= 2)) {
      return null
    }
    return formatPolygonPoints([...activePolygonDraftPoints.map(toPoint2D), toPoint2D(cursorPoint)])
  }, [activePolygonDraftPoints, cursorPoint, isPolygonDraftBuildActive])

  const polyline = useMemo(() => {
    if (!(isPolygonDraftBuildActive && cursorPoint && activePolygonDraftPoints.length > 0)) {
      return null
    }
    return formatPolygonPoints([...activePolygonDraftPoints.map(toPoint2D), toPoint2D(cursorPoint)])
  }, [activePolygonDraftPoints, cursorPoint, isPolygonDraftBuildActive])

  const closingSegment = useMemo(() => {
    const firstPoint = activePolygonDraftPoints[0]
    if (
      !(isPolygonDraftBuildActive && cursorPoint && activePolygonDraftPoints.length >= 2) ||
      !firstPoint
    ) {
      return null
    }
    return {
      x1: toSvgX(cursorPoint[0]),
      y1: toSvgY(cursorPoint[1]),
      x2: toSvgX(firstPoint[0]),
      y2: toSvgY(firstPoint[1]),
    }
  }, [activePolygonDraftPoints, cursorPoint, isPolygonDraftBuildActive])

  return (
    <>
      {polygon && <polygon fill={draftFill} fillOpacity={0.2} points={polygon} stroke="none" />}

      {polyline && (
        <polyline
          fill="none"
          points={polyline}
          stroke={activeStroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      )}

      {closingSegment && (
        <line
          stroke={activeStroke}
          strokeDasharray="0.16 0.1"
          strokeLinecap="round"
          strokeOpacity={0.75}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
          x1={closingSegment.x1}
          x2={closingSegment.x2}
          y1={closingSegment.y1}
          y2={closingSegment.y2}
        />
      )}

      {cursorPoint && (
        <g>
          <circle
            cx={toSvgX(cursorPoint[0])}
            cy={toSvgY(cursorPoint[1])}
            fill={cursorColor}
            fillOpacity={0.25}
            r={FLOORPLAN_CURSOR_MARKER_GLOW_RADIUS_PX * unitsPerPixel}
          />
          <circle
            cx={toSvgX(cursorPoint[0])}
            cy={toSvgY(cursorPoint[1])}
            fill={cursorColor}
            fillOpacity={0.9}
            r={FLOORPLAN_CURSOR_MARKER_CORE_RADIUS_PX * unitsPerPixel}
          />
        </g>
      )}
    </>
  )
}

// Leaf overlay for the marquee (box-select) rectangle. Subscribes to the
// marquee store's moving corner so a per-move drag re-renders ONLY this layer,
// never the (~120-220ms) FloorplanPanel. The bounds math is pure (the
// module-scope `getFloorplanSelectionBounds` / `toSvgSelectionBounds`); the
// cursor colour is the one bit of panel config, passed as a prop.
function FloorplanMarqueeOverlay({ cursorColor }: { cursorColor: string }) {
  const drag = useFloorplanMarquee((s) => s.drag)
  const bounds = useMemo(() => {
    if (!drag) {
      return null
    }
    const dragDistance = Math.hypot(
      drag.currentPlanPoint[0] - drag.startPlanPoint[0],
      drag.currentPlanPoint[1] - drag.startPlanPoint[1],
    )
    if (dragDistance <= 0) {
      return null
    }
    return toSvgSelectionBounds(
      getFloorplanSelectionBounds(drag.startPlanPoint, drag.currentPlanPoint),
    )
  }, [drag])

  return (
    <FloorplanMarqueeLayer
      bounds={bounds}
      cursorColor={cursorColor}
      glowWidth={FLOORPLAN_MARQUEE_GLOW_WIDTH}
      outlineWidth={FLOORPLAN_MARQUEE_OUTLINE_WIDTH}
    />
  )
}

// Thin subscriber wrapper for the coordinate-badge overlay: reads the hot
// screen-space cursor position from the draft store so a per-`pointermove`
// update re-renders only the badge, not FloorplanPanel. The remaining props
// (tool / mode / colour) are per-interaction panel state passed through — they
// change rarely, never per move.
function FloorplanCursorIndicator(
  props: Omit<ComponentProps<typeof Editor2dFloorplanCursorIndicatorOverlay>, 'cursorPosition'>,
) {
  const cursorPosition = useFloorplanDraftPreview((s) => s.cursorPosition)
  return <Editor2dFloorplanCursorIndicatorOverlay {...props} cursorPosition={cursorPosition} />
}

// Leaf overlay for the live wall / fence / roof draft segment (the directional
// draws). It subscribes to the per-move END points in the draft store so a
// `grid:move` re-renders ONLY this layer, not FloorplanPanel; the per-click
// START points + render config arrive as props. Owns the draft polygon (wall +
// roof rect), the fence segment line, and the wall length/angle measurement —
// the cursor-following pieces the shared `FloorplanDraftLayer` no longer carries.
function FloorplanLinearDraftLayer({
  levelId,
  wallDraftStart,
  fenceDraftStart,
  roofDraftStart,
  isWallBuildActive,
  isFenceBuildActive,
  isRoofBuildActive,
  walls,
  unit,
  draftFill,
  draftStroke,
  measurementStroke,
  isDark,
  unitsPerPixel,
  sceneRotationDeg,
}: {
  levelId: string | null
  wallDraftStart: WallPlanPoint | null
  fenceDraftStart: WallPlanPoint | null
  roofDraftStart: WallPlanPoint | null
  isWallBuildActive: boolean
  isFenceBuildActive: boolean
  isRoofBuildActive: boolean
  walls: WallNode[]
  unit: 'metric' | 'imperial'
  draftFill: string
  draftStroke: string
  measurementStroke: string
  isDark: boolean
  unitsPerPixel: number
  sceneRotationDeg: number
}) {
  const wallDraftEnd = useFloorplanDraftPreview((s) => s.wallDraftEnd)
  const fenceDraftEnd = useFloorplanDraftPreview((s) => s.fenceDraftEnd)
  const roofDraftEnd = useFloorplanDraftPreview((s) => s.roofDraftEnd)

  const draftPolygon = useMemo(() => {
    if (
      !(
        levelId &&
        wallDraftStart &&
        wallDraftEnd &&
        isSegmentLongEnough(wallDraftStart, wallDraftEnd)
      )
    ) {
      return null
    }
    const draftWall = getSharedFloorplanWall(buildDraftWall(levelId, wallDraftStart, wallDraftEnd))
    // Keep the live draft preview cheap; full level-wide mitering here runs on every mouse move.
    return getWallPlanFootprint(draftWall, EMPTY_WALL_MITER_DATA)
  }, [levelId, wallDraftStart, wallDraftEnd])

  const draftPolygonPoints = useMemo(() => {
    if (isRoofBuildActive && roofDraftStart && roofDraftEnd) {
      const minX = Math.min(roofDraftStart[0], roofDraftEnd[0])
      const maxX = Math.max(roofDraftStart[0], roofDraftEnd[0])
      const minY = Math.min(roofDraftStart[1], roofDraftEnd[1])
      const maxY = Math.max(roofDraftStart[1], roofDraftEnd[1])

      if (Math.abs(maxX - minX) >= 1e-6 || Math.abs(maxY - minY) >= 1e-6) {
        return formatPolygonPoints([
          { x: minX, y: minY },
          { x: maxX, y: minY },
          { x: maxX, y: maxY },
          { x: minX, y: maxY },
        ])
      }
    }
    return draftPolygon ? formatPolygonPoints(draftPolygon) : null
  }, [draftPolygon, isRoofBuildActive, roofDraftEnd, roofDraftStart])

  const fenceDraftSegment = useMemo(() => {
    if (!(isFenceBuildActive && fenceDraftStart && fenceDraftEnd)) {
      return null
    }
    if (getPlanPointDistance(toPoint2D(fenceDraftStart), toPoint2D(fenceDraftEnd)) < 1e-6) {
      return null
    }
    return {
      x1: toSvgX(fenceDraftStart[0]),
      y1: toSvgY(fenceDraftStart[1]),
      x2: toSvgX(fenceDraftEnd[0]),
      y2: toSvgY(fenceDraftEnd[1]),
    }
  }, [fenceDraftEnd, fenceDraftStart, isFenceBuildActive])

  // Live length + angle feedback for the wall draft — parity with the 3D
  // `WallTool`, ported to 2D plan space.
  const draftWallMeasurement = useMemo(() => {
    if (
      !(
        isWallBuildActive &&
        wallDraftStart &&
        wallDraftEnd &&
        isSegmentLongEnough(wallDraftStart, wallDraftEnd)
      )
    ) {
      return null
    }

    const dx = wallDraftEnd[0] - wallDraftStart[0]
    const dy = wallDraftEnd[1] - wallDraftStart[1]
    const length = Math.hypot(dx, dy)

    const draftFromStart: WallPlanPoint = [dx, dy]
    const draftFromEnd: WallPlanPoint = [-dx, -dy]
    const endpoints = [
      { id: 'start', point: wallDraftStart, draftVector: draftFromStart },
      { id: 'end', point: wallDraftEnd, draftVector: draftFromEnd },
    ] as const

    type AngleLabel = {
      id: string
      label: string
      center: WallPlanPoint
      radius: number
      startAngle: number
      endAngle: number
      midAngle: number
    }

    const angleLabels: AngleLabel[] = []
    for (const endpoint of endpoints) {
      const connectedWall = walls.find((wall) =>
        Boolean(getSegmentAngleReferenceAtPoint(endpoint.point, wall)),
      )
      if (!connectedWall) continue
      const ref = getSegmentAngleReferenceAtPoint(endpoint.point, connectedWall)
      if (!ref) continue

      const angle = getAngleToSegmentReference(endpoint.draftVector, ref)
      if (angle === null) continue
      const arc = getAngleArcToSegmentReference(endpoint.draftVector, ref)
      if (!arc || arc.angle < 0.01) continue

      const refLen = Math.hypot(ref.vector[0], ref.vector[1])
      const radius = Math.max(0.32, Math.min(0.72, Math.min(length, refLen) * 0.28))

      angleLabels.push({
        id: endpoint.id,
        label: formatAngleRadians(angle),
        center: endpoint.point,
        radius,
        startAngle: arc.startAngle,
        endAngle: arc.endAngle,
        midAngle: arc.midAngle,
      })
    }

    return {
      lengthLabel: formatMeasurement(length, unit),
      midpoint: [
        (wallDraftStart[0] + wallDraftEnd[0]) / 2,
        (wallDraftStart[1] + wallDraftEnd[1]) / 2,
      ] as WallPlanPoint,
      direction: [dx / length, dy / length] as WallPlanPoint,
      angleLabels,
    }
  }, [isWallBuildActive, unit, wallDraftEnd, wallDraftStart, walls])

  return (
    <>
      <FloorplanDraftLayer
        anchorFill={draftStroke}
        draftAnchorPoints={EMPTY_DRAFT_ANCHOR_POINTS}
        draftFill={draftFill}
        draftPolygonPoints={draftPolygonPoints}
        draftStroke={draftStroke}
        linearDraftSegment={fenceDraftSegment}
        polygonDraftClosingSegment={null}
        polygonDraftPolygonPoints={null}
        polygonDraftPolylinePoints={null}
        unitsPerPixel={unitsPerPixel}
      />

      {draftWallMeasurement && (
        <FloorplanDraftWallMeasurement
          labelBackground={isDark ? '#0f172a' : '#ffffff'}
          labelText={isDark ? '#e2e8f0' : '#171717'}
          measurement={draftWallMeasurement}
          measurementStroke={measurementStroke}
          sceneRotationDeg={sceneRotationDeg}
          unitsPerPixel={unitsPerPixel}
        />
      )}
    </>
  )
}

const EMPTY_DRAFT_ANCHOR_POINTS: Array<{ x: number; y: number; isPrimary: boolean }> = []

export function FloorplanPanel({
  /**
   * Element to portal the compass button into. The 2D/3D navigation poses stay
   * in sync (`navigationSyncPose`), so hosting the compass on the always-visible
   * viewer-area container keeps it correct — needle and align-to-north alike —
   * in 2d, 3d, and split modes, while this panel itself may be display:none.
   */
  compassHost,
}: {
  compassHost?: HTMLElement | null
}) {
  const viewportHostRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const floorplanSceneRef = useRef<SVGGElement>(null)
  const floorplanContentRef = useRef<SVGGElement>(null)
  const panStateRef = useRef<PanState | null>(null)
  const floorplanRotationStateRef = useRef<FloorplanRotationState | null>(null)
  const floorplanSpacePanPressedRef = useRef(false)
  const floorplanNavigationClickSuppressedRef = useRef(false)
  const guideInteractionRef = useRef<GuideInteractionState | null>(null)
  const guideTransformDraftRef = useRef<GuideTransformDraft | null>(null)
  const pendingFenceDragRef = useRef<PendingFenceDragState | null>(null)
  const wallEndpointDragRef = useRef<WallEndpointDragState | null>(null)
  const wallCurveDragRef = useRef<WallCurveDragState | null>(null)
  const siteBoundaryDraftRef = useRef<SiteBoundaryDraft | null>(null)
  const gestureScaleRef = useRef(1)
  const panelInteractionRef = useRef<PanelInteractionState | null>(null)
  const panelBoundsRef = useRef<ViewportBounds | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const hasUserAdjustedViewportRef = useRef(false)
  const previousLevelIdRef = useRef<string | null>(null)
  const floorplanMarqueeSnapPointRef = useRef<WallPlanPoint | null>(null)
  const floorplanScreenSelectionRef = useRef<FloorplanScreenSelectionState | null>(null)
  const floorplanScreenSelectionElementRef = useRef<HTMLDivElement | null>(null)
  const floorplanScreenSelectionOwnsInputDraggingRef = useRef(false)
  const latestFloorplanUserRotationDegRef = useRef(0)
  const latestViewportRef = useRef<FloorplanViewport | null>(null)
  const latestFittedViewportRef = useRef<FloorplanViewport | null>(null)
  const floorplanViewAnimationFrameRef = useRef<number | null>(null)
  const floorplanViewAnimationTargetRef = useRef<FloorplanViewAnimationTarget | null>(null)
  const latestNavigationSyncPoseRef = useRef<NavigationSyncPose | null>(
    useEditor.getState().navigationSyncPose,
  )
  const levelId = useViewer((state) => state.selection.levelId)
  const buildingId = useViewer((state) => state.selection.buildingId)
  const selectedZoneId = useViewer((state) => state.selection.zoneId)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const previewSelectedIds = useViewer((state) => state.previewSelectedIds)
  const setSelection = useViewer((state) => state.setSelection)
  const setPreviewSelectedIds = useViewer((state) => state.setPreviewSelectedIds)
  const isDark = useViewer((state) => getSceneTheme(state.sceneTheme).appearance === 'dark')
  const unit = useViewer((state) => state.unit)
  const showGrid = useViewer((state) => state.showGrid)
  const showGuides = useViewer((state) => state.showGuides)
  const setShowGuides = useViewer((state) => state.setShowGuides)
  const selectedItem = useEditor((state) => state.selectedItem)

  const setFloorplanHovered = useEditor((state) => state.setFloorplanHovered)
  // Panel is permanently mounted and toggled via `display: none` in
  // editor/index.tsx — subscribing here lets us re-fit the viewport when
  // the user closes and re-opens the 2D editor instead of restoring the
  // stale viewport from before they closed it.
  const isFloorplanOpen = useEditor((state) => state.isFloorplanOpen)
  // Mirror for callbacks that fire outside React's render (the per-frame
  // navigation-pose subscriber): when the 2D panel is hidden (`display:none` in
  // 3D mode) it must NOT re-render on every camera-zoom frame.
  const isFloorplanOpenRef = useRef(isFloorplanOpen)
  isFloorplanOpenRef.current = isFloorplanOpen
  const selectedReferenceId = useEditor((state) => state.selectedReferenceId)
  const setSelectedReferenceId = useEditor((state) => state.setSelectedReferenceId)
  const setMode = useEditor((state) => state.setMode)
  const movingNode = useMovingNode()
  const isCurveReshape = useIsCurveReshape()
  const endpointReshape = useEndpointReshape()
  const reshapingNode = useReshapingNode()
  const phase = useEditor((state) => state.phase)
  const mode = useEditor((state) => state.mode)
  const activeHandleDrag = useActiveHandleDrag()
  const setPhase = useEditor((state) => state.setPhase)
  const setMovingNode = useEditor((state) => state.setMovingNode)
  const structureLayer = useEditor((state) => state.structureLayer)
  const setStructureLayer = useEditor((state) => state.setStructureLayer)
  const setTool = useEditor((state) => state.setTool)
  const tool = useEditor((state) => state.tool)
  const deleteNode = useScene((state) => state.deleteNode)
  const updateNode = useScene((state) => state.updateNode)
  const {
    buildingPosition,
    buildingRotationY,
    ceilings,
    currentBuildingId,
    fences,
    floorplanLevels,
    levelDescendantNodes,
    levelGuides,
    levelNode,
    openings,
    roofs,
    site,
    slabs,
    spawns,
    walls,
    zones,
  } = useFloorplanSceneData({ buildingId, levelId })
  // When only a building is selected (or we're mid-drag on a building),
  // the FloorplanRegistryLayer falls back to that building's level 0
  // (or lowest level) and renders it dimmed as context. We let the SVG
  // mount in that case so the dimmed-floor render path is reachable
  // instead of swapping in the "Switch to a building level" message.
  //
  // `currentBuildingId` covers both the user-selected building and the
  // building inferred from a selected level. During a building move the
  // `movingNode` carries the building's id even if the explicit
  // selection has been cleared as part of the move handoff.
  const movingBuildingId =
    movingNode && nodeRegistry.get(movingNode.type)?.capabilities?.floorplanLevelContainer
      ? movingNode.id
      : null
  const ambientBuildingId = currentBuildingId ?? movingBuildingId
  const hasAmbientBuildingLevel = useScene((state) => {
    if (levelId || !ambientBuildingId) return false
    const building = state.nodes[ambientBuildingId]
    if (building?.type !== 'building') return false
    return building.children.some((cid) => state.nodes[cid]?.type === 'level')
  })
  const elevators = useScene(
    useShallow((state) => {
      const building = currentBuildingId ? state.nodes[currentBuildingId] : null
      if (building?.type !== 'building') {
        return [] as ElevatorNode[]
      }

      return building.children.flatMap((childId) => {
        const node = state.nodes[childId]
        return node?.type === 'elevator' && node.visible !== false ? [node] : []
      })
    }),
  )
  const [floorplanUserRotationDeg, setFloorplanUserRotationDeg] = useState(0)
  const buildingRotationDeg = (buildingRotationY * 180) / Math.PI
  const floorplanSceneRotationDeg =
    FLOORPLAN_VIEW_ROTATION_DEG + floorplanUserRotationDeg - buildingRotationDeg
  latestFloorplanUserRotationDegRef.current = floorplanUserRotationDeg

  // Draft START points stay in panel state (set per click). The live END points
  // are the per-move hot values — they live in `useFloorplanDraftPreview` so a
  // `grid:move` re-renders only `FloorplanLinearDraftLayer`, not this panel.
  // Shims keep the `setXDraftEnd(value | prev => …)` call sites unchanged.
  const [draftStart, setDraftStart] = useState<WallPlanPoint | null>(null)
  const [wallChainFirstVertex, setWallChainFirstVertex] = useState<WallPlanPoint | null>(null)
  const setDraftEnd = useCallback(
    (next: WallPlanPoint | null | ((prev: WallPlanPoint | null) => WallPlanPoint | null)) => {
      const store = useFloorplanDraftPreview.getState()
      store.setWallDraftEnd(typeof next === 'function' ? next(store.wallDraftEnd) : next)
    },
    [],
  )
  const [fenceDraftStart, setFenceDraftStart] = useState<WallPlanPoint | null>(null)
  const setFenceDraftEnd = useCallback(
    (next: WallPlanPoint | null | ((prev: WallPlanPoint | null) => WallPlanPoint | null)) => {
      const store = useFloorplanDraftPreview.getState()
      store.setFenceDraftEnd(typeof next === 'function' ? next(store.fenceDraftEnd) : next)
    },
    [],
  )
  const [roofDraftStart, setRoofDraftStart] = useState<WallPlanPoint | null>(null)
  const setRoofDraftEnd = useCallback(
    (next: WallPlanPoint | null | ((prev: WallPlanPoint | null) => WallPlanPoint | null)) => {
      const store = useFloorplanDraftPreview.getState()
      store.setRoofDraftEnd(typeof next === 'function' ? next(store.roofDraftEnd) : next)
    },
    [],
  )
  const [ceilingDraftPoints, setCeilingDraftPoints] = useState<WallPlanPoint[]>([])
  const [slabDraftPoints, setSlabDraftPoints] = useState<WallPlanPoint[]>([])
  const [zoneDraftPoints, setZoneDraftPoints] = useState<WallPlanPoint[]>([])
  const [siteBoundaryDraft, setSiteBoundaryDraft] = useState<SiteBoundaryDraft | null>(null)
  const [siteVertexDragState, setSiteVertexDragState] = useState<SiteVertexDragState | null>(null)
  const [guideTransformDraft, setGuideTransformDraft] = useState<GuideTransformDraft | null>(null)
  const [referenceScaleDraft, setReferenceScaleDraft] = useState<ReferenceScaleDraft | null>(null)
  const [pendingReferenceScale, setPendingReferenceScale] = useState<PendingReferenceScale | null>(
    null,
  )
  const [referenceScaleValue, setReferenceScaleValue] = useState('1')
  const [referenceScaleUnit, setReferenceScaleUnit] = useState<ReferenceScaleUnit>(
    unit === 'imperial' ? 'feet' : 'meters',
  )
  // The cursor point is the hottest 2D state — every build/edit tool republishes
  // it on `grid:move`. It lives in `useFloorplanDraftPreview` (not panel state)
  // so a per-move update re-renders only `FloorplanDraftCursorLayer`, not this
  // ~200ms panel. This shim keeps the `setCursorPoint(value)` /
  // `setCursorPoint(prev => …)` call sites (and their snap-SFX side effects)
  // unchanged while routing the write to the store; reads go through the store.
  const setCursorPoint = useCallback(
    (next: WallPlanPoint | null | ((prev: WallPlanPoint | null) => WallPlanPoint | null)) => {
      const store = useFloorplanDraftPreview.getState()
      const value = typeof next === 'function' ? next(store.cursorPoint) : next
      store.setCursorPoint(value)
    },
    [],
  )
  // The coordinate-badge cursor position is set on every SVG `pointermove` while
  // a build/select tool is active — the single hottest 2D update. It lives in
  // `useFloorplanDraftPreview` (not panel state) so a move re-renders only the
  // badge leaf, not this panel. Shim preserves the existing call sites (value +
  // functional-updater forms) while routing the write to the store.
  const setFloorplanCursorPosition = useCallback(
    (next: SvgPoint | null | ((prev: SvgPoint | null) => SvgPoint | null)) => {
      const store = useFloorplanDraftPreview.getState()
      const value = typeof next === 'function' ? next(store.cursorPosition) : next
      store.setCursorPosition(value)
    },
    [],
  )
  const [wallEndpointDraft, setWallEndpointDraft] = useState<WallEndpointDraft | null>(null)
  const [wallCurveDraft, setWallCurveDraft] = useState<WallCurveDraft | null>(null)
  const [hoveredOpeningId, setHoveredOpeningId] = useState<OpeningNode['id'] | null>(null)
  const [hoveredWallId, setHoveredWallId] = useState<WallNode['id'] | null>(null)
  const [hoveredFenceId, setHoveredFenceId] = useState<FenceNode['id'] | null>(null)
  const [hoveredSlabId, setHoveredSlabId] = useState<SlabNode['id'] | null>(null)
  const [hoveredCeilingId, setHoveredCeilingId] = useState<CeilingNode['id'] | null>(null)
  const [hoveredItemId, setHoveredItemId] = useState<ItemNode['id'] | null>(null)
  const [hoveredSpawnId, setHoveredSpawnId] = useState<SpawnNode['id'] | null>(null)
  const [hoveredStairId, setHoveredStairId] = useState<StairNode['id'] | null>(null)
  const [hoveredElevatorId, setHoveredElevatorId] = useState<ElevatorNode['id'] | null>(null)
  const [elevatorResizeDragState, setElevatorResizeDragState] =
    useState<ElevatorResizeDragState | null>(null)
  const [hoveredZoneId, setHoveredZoneId] = useState<ZoneNodeType['id'] | null>(null)
  const [hoveredEndpointId, setHoveredEndpointId] = useState<string | null>(null)
  const [hoveredWallCurveHandleId, setHoveredWallCurveHandleId] = useState<string | null>(null)
  const [hoveredSiteHandleId, setHoveredSiteHandleId] = useState<string | null>(null)
  const [hoveredSlabHandleId, setHoveredSlabHandleId] = useState<string | null>(null)
  const [hoveredCeilingHandleId, setHoveredCeilingHandleId] = useState<string | null>(null)
  const [hoveredZoneHandleId, setHoveredZoneHandleId] = useState<string | null>(null)
  const [hoveredGuideCorner, setHoveredGuideCorner] = useState<GuideCorner | null>(null)
  const floorplanSelectionTool = useEditor((s) => s.floorplanSelectionTool)
  const setFloorplanSelectionTool = useEditor((s) => s.setFloorplanSelectionTool)
  const showReferenceFloor = useEditor((s) => s.showReferenceFloor)
  const referenceFloorOffset = useEditor((s) => s.referenceFloorOffset)
  const referenceFloorOpacity = useEditor((s) => s.referenceFloorOpacity)
  const guideUi = useEditor((s) => s.guideUi)
  const setGuideLocked = useEditor((s) => s.setGuideLocked)
  const setGuideScaleReferenceVisible = useEditor((s) => s.setGuideScaleReferenceVisible)
  const clearGuideUi = useEditor((s) => s.clearGuideUi)
  const [shiftPressed, setShiftPressed] = useState(false)
  const [rotationModifierPressed, setRotationModifierPressed] = useState(false)
  const [movingFloorplanNodeRevision, setMovingFloorplanNodeRevision] = useState(0)
  const movingFloorplanNodeRefreshFrameRef = useRef<number | null>(null)
  const elevatorIds = useMemo(() => elevators.map((elevator) => elevator.id), [elevators])
  const elevatorRuntimeKey = useInteractive(
    useCallback(
      (state) =>
        elevatorIds
          .map((elevatorId) => {
            const runtime = state.elevators[elevatorId]
            if (!runtime) {
              return `${elevatorId}:`
            }

            return [
              elevatorId,
              runtime.currentLevelId ?? '',
              runtime.targetLevelId ?? '',
              runtime.phase,
              runtime.queue.join(','),
            ].join(':')
          })
          .join('|'),
      [elevatorIds],
    ),
  )
  const elevatorLiveOverrideKey = useLiveNodeOverrides(
    useCallback(
      (state) =>
        elevatorIds
          .map((elevatorId) => {
            const overrides = state.overrides.get(elevatorId)
            if (!overrides) {
              return `${elevatorId}:`
            }

            return [
              elevatorId,
              overrides.width ?? '',
              overrides.depth ?? '',
              overrides.shaftWidth ?? '',
              overrides.shaftDepth ?? '',
              overrides.shaftWallThickness ?? '',
            ].join(':')
          })
          .join('|'),
      [elevatorIds],
    ),
  )
  const siteLivePolygon = useLiveNodeOverrides(
    useCallback(
      (state) => {
        if (!site?.id) {
          return null
        }

        return (state.overrides.get(site.id)?.polygon as SiteNode['polygon'] | undefined) ?? null
      },
      [site?.id],
    ),
  )
  const [isSpacePanPressed, setIsSpacePanPressed] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const [isRotatingFloorplan, setIsRotatingFloorplan] = useState(false)
  const [isDraggingPanel, setIsDraggingPanel] = useState(false)
  const [isMacPlatform, setIsMacPlatform] = useState(true)
  const [activeResizeDirection, setActiveResizeDirection] = useState<ResizeDirection | null>(null)
  const [panelRect, setPanelRect] = useState<PanelRect>({
    x: PANEL_MARGIN,
    y: PANEL_MARGIN,
    width: PANEL_DEFAULT_WIDTH,
    height: PANEL_DEFAULT_HEIGHT,
  })

  const [isPanelReady, setIsPanelReady] = useState(false)
  const [surfaceSize, setSurfaceSize] = useState({ width: 1, height: 1 })
  const [viewport, setViewport] = useState<FloorplanViewport | null>(null)
  latestViewportRef.current = viewport
  // Tight bbox of the painted floor-plan scene (the rotation `<g>`'s
  // children), read via SVG `getBBox()` after each render. The legacy
  // polygon arrays (`wallPolygons`, `displaySlabPolygons`, etc.) are now
  // empty stubs because rendering moved to the registry layer, so
  // measuring the DOM is how `fittedViewport` learns where content lives.
  const [measuredSceneBBox, setMeasuredSceneBBox] = useState<{
    x: number
    y: number
    width: number
    height: number
  } | null>(null)

  useEffect(() => {
    if (structureLayer === 'zones' && floorplanSelectionTool === 'marquee') {
      setFloorplanSelectionTool('click')
    }
  }, [floorplanSelectionTool, setFloorplanSelectionTool, structureLayer])

  useEffect(() => {
    setIsMacPlatform(navigator.platform.toUpperCase().includes('MAC'))
  }, [])

  const scheduleMovingFloorplanNodeRefresh = useCallback(() => {
    if (movingFloorplanNodeRefreshFrameRef.current !== null) {
      return
    }

    movingFloorplanNodeRefreshFrameRef.current = window.requestAnimationFrame(() => {
      movingFloorplanNodeRefreshFrameRef.current = null
      setMovingFloorplanNodeRevision((current) => current + 1)
    })
  }, [])

  useEffect(
    () => () => {
      if (movingFloorplanNodeRefreshFrameRef.current !== null) {
        window.cancelAnimationFrame(movingFloorplanNodeRefreshFrameRef.current)
        movingFloorplanNodeRefreshFrameRef.current = null
      }
    },
    [],
  )

  const sitePolygonEntry = useMemo(() => {
    const polygonPoints = siteLivePolygon?.points ?? site?.polygon?.points
    if (!(site && polygonPoints)) {
      return null
    }

    const polygon = polygonPoints.map(([x, z]) =>
      worldToFloorplanLocalPoint(x, z, buildingPosition, buildingRotationY),
    )
    if (polygon.length < 3) {
      return null
    }

    return {
      site,
      polygon,
      points: formatPolygonPoints(polygon),
    }
  }, [buildingPosition, buildingRotationY, site, siteLivePolygon])
  const displaySitePolygon = useMemo(() => {
    if (!sitePolygonEntry) {
      return null
    }

    if (!(siteBoundaryDraft && siteBoundaryDraft.siteId === sitePolygonEntry.site.id)) {
      return sitePolygonEntry
    }

    const polygon = siteBoundaryDraft.polygon.map(toPoint2D)

    return {
      ...sitePolygonEntry,
      polygon,
      points: formatPolygonPoints(polygon),
    }
  }, [siteBoundaryDraft, sitePolygonEntry])
  const siteBoundaryWorldPolygon = useCallback(
    (polygon: WallPlanPoint[]) =>
      polygon.map((point) => {
        const worldPoint = floorplanLocalToWorldPoint(point, buildingPosition, buildingRotationY)
        return [worldPoint.x, worldPoint.z] as [number, number]
      }),
    [buildingPosition, buildingRotationY],
  )
  const setSiteBoundaryLivePreview = useCallback(
    (siteId: SiteNode['id'], polygon: WallPlanPoint[]) => {
      useLiveNodeOverrides.getState().set(siteId, {
        polygon: {
          type: 'polygon',
          points: siteBoundaryWorldPolygon(polygon),
        },
      })
    },
    [siteBoundaryWorldPolygon],
  )
  const clearSiteBoundaryLivePreview = useCallback((siteId: SiteNode['id']) => {
    useLiveNodeOverrides.getState().clearFields(siteId, ['polygon'])
  }, [])
  const movingOpeningType =
    movingNode?.type === 'door' || movingNode?.type === 'window' ? movingNode.type : null

  const visibleGuides = useMemo<GuideNode[]>(() => {
    if (!showGuides) {
      return []
    }

    return levelGuides.filter((guide) => guide.visible !== false)
  }, [levelGuides, showGuides])
  const guideById = useMemo(
    () => new Map(levelGuides.map((guide) => [guide.id, guide] as const)),
    [levelGuides],
  )
  const displayGuides = useMemo<GuideNode[]>(() => {
    if (!guideTransformDraft) {
      return visibleGuides
    }

    return visibleGuides.map((guide) =>
      guide.id === guideTransformDraft.guideId
        ? {
            ...guide,
            position: [
              guideTransformDraft.position[0],
              guide.position[1],
              guideTransformDraft.position[1],
            ] as [number, number, number],
            rotation: [guide.rotation[0], guideTransformDraft.rotation, guide.rotation[2]] as [
              number,
              number,
              number,
            ],
            scale: guideTransformDraft.scale,
          }
        : guide,
    )
  }, [guideTransformDraft, visibleGuides])
  const isGuideTraceVisible = displayGuides.some((guide) => guide.opacity > 0 && guide.scale > 0)
  const selectedGuideId =
    selectedReferenceId && guideById.has(selectedReferenceId as GuideNode['id'])
      ? (selectedReferenceId as GuideNode['id'])
      : null
  const selectedGuide = useMemo(
    () =>
      displayGuides.find((guide) => guide.id === selectedGuideId) ??
      (selectedGuideId ? (guideById.get(selectedGuideId) ?? null) : null),
    [displayGuides, guideById, selectedGuideId],
  )
  const calibratedMeasurementGuide = useMemo(() => {
    if (
      selectedGuide?.scaleReference &&
      selectedGuide.scaleReference.metersPerUnit > 0 &&
      selectedGuide.visible !== false
    ) {
      return selectedGuide
    }

    return (
      visibleGuides.find(
        (guide) => guide.scaleReference && guide.scaleReference.metersPerUnit > 0,
      ) ?? null
    )
  }, [selectedGuide, visibleGuides])
  const calibratedMetersPerUnit = calibratedMeasurementGuide?.scaleReference?.metersPerUnit ?? null
  const selectedGuideResolvedUrl = useResolvedAssetUrl(selectedGuide?.url ?? '')
  const selectedGuideDimensions = useGuideImageDimensions(selectedGuideResolvedUrl)
  const activeGuideInteractionGuideId = guideTransformDraft
    ? (guideInteractionRef.current?.guideId ?? null)
    : null
  const activeGuideInteractionMode = guideTransformDraft
    ? (guideInteractionRef.current?.mode ?? null)
    : null
  const floorplanWalls = useMemo(() => walls.map(getFloorplanWall), [walls])
  const wallMiterData = useMemo(() => calculateLevelMiters(floorplanWalls), [floorplanWalls])
  const wallById = useMemo(() => new Map(walls.map((wall) => [wall.id, wall] as const)), [walls])
  const floorplanWallById = useMemo(
    () => new Map(floorplanWalls.map((wall) => [wall.id, wall] as const)),
    [floorplanWalls],
  )
  const displayWallById = useMemo(() => {
    if (!(wallEndpointDraft || wallCurveDraft)) {
      return wallById
    }

    const nextWallById = new Map(wallById)

    if (wallEndpointDraft) {
      for (const draftUpdate of getWallEndpointDraftUpdates(wallEndpointDraft)) {
        const wall = nextWallById.get(draftUpdate.id)
        if (!wall) {
          continue
        }

        nextWallById.set(
          wall.id,
          buildWallWithUpdatedEndpoints(wall, draftUpdate.start, draftUpdate.end),
        )
      }
    }

    if (wallCurveDraft) {
      const wall = nextWallById.get(wallCurveDraft.wallId)
      if (wall) {
        nextWallById.set(wall.id, { ...wall, curveOffset: wallCurveDraft.curveOffset })
      }
    }

    return nextWallById
  }, [wallById, wallCurveDraft, wallEndpointDraft])
  const displayFloorplanWallById = useMemo(() => {
    if (!(wallEndpointDraft || wallCurveDraft)) {
      return floorplanWallById
    }

    const nextFloorplanWallById = new Map(floorplanWallById)
    let hasPreviewWalls = false

    if (wallEndpointDraft) {
      for (const draftUpdate of getWallEndpointDraftUpdates(wallEndpointDraft)) {
        const previewWall = displayWallById.get(draftUpdate.id)
        if (!previewWall) {
          continue
        }

        nextFloorplanWallById.set(previewWall.id, getFloorplanWall(previewWall))
        hasPreviewWalls = true
      }
    }

    if (wallCurveDraft) {
      const previewWall = displayWallById.get(wallCurveDraft.wallId)
      if (previewWall) {
        nextFloorplanWallById.set(previewWall.id, getFloorplanWall(previewWall))
        hasPreviewWalls = true
      }
    }

    return hasPreviewWalls ? nextFloorplanWallById : floorplanWallById
  }, [displayWallById, floorplanWallById, wallCurveDraft, wallEndpointDraft])
  // Fence is fully registry-driven (`def.floorplan` + `buildFenceFloorplan`).
  // The legacy entry list is permanently empty; kept as a typed stable
  // reference so downstream prop sites stay typed without each having to
  // declare its own `[]`.
  const floorplanFenceEntries = useMemo<FloorplanFenceEntry[]>(() => [], [])
  // Wall is fully registry-driven. Empty stable arrays for the legacy
  // entry lists; consumers' map / iteration paths become no-ops.
  const wallPolygons = useMemo<WallPolygonEntry[]>(() => [], [])
  const displayWallPolygons = useMemo<WallPolygonEntry[]>(() => [], [])

  // Doors + windows fully registry-driven via `def.floorplan`.
  const openingsPolygons = useMemo<OpeningPolygonEntry[]>(() => [], [])
  // Slab + ceiling fully registry-driven via `def.floorplan`. Same
  // empty-stable-array pattern.
  const slabPolygons = useMemo<SlabPolygonEntry[]>(() => [], [])
  const displaySlabPolygons = useMemo<SlabPolygonEntry[]>(() => [], [])
  const ceilingPolygons = useMemo<CeilingPolygonEntry[]>(() => [], [])
  const displayCeilingPolygons = useMemo<CeilingPolygonEntry[]>(() => [], [])
  // Ceilings on the active level, projected to 2D polygons for hit-testing
  // ceiling-item placement clicks/moves. The legacy `ceilingPolygons` above
  // is intentionally empty (ceilings render via the registry layer); this
  // memo is the placement-side counterpart, separate from rendering.
  const ceilingHitEntries = useMemo(
    () =>
      ceilings.map((ceiling) => ({
        ceiling,
        polygon: toFloorplanPolygon(ceiling.polygon),
        holes: (ceiling.holes ?? [])
          .map((hole) => toFloorplanPolygon(hole))
          .filter((hole) => hole.length >= 3),
      })),
    [ceilings],
  )
  // Zone fully registry-driven via `def.floorplan`.
  const zonePolygons = useMemo<ZonePolygonEntry[]>(() => [], [])
  const displayZonePolygons = useMemo<ZonePolygonEntry[]>(() => [], [])
  // Column fully registry-driven via `def.floorplan`.
  const floorplanColumnEntries = useMemo<FloorplanColumnEntry[]>(() => [], [])
  const levelDescendantNodeById = useMemo(
    () => new Map(levelDescendantNodes.map((node) => [node.id, node] as const)),
    [levelDescendantNodes],
  )
  const floorplanItems = useMemo(
    () =>
      levelDescendantNodes.filter(
        (node): node is ItemNode =>
          node.type === 'item' &&
          node.visible !== false &&
          node.asset.category !== 'door' &&
          node.asset.category !== 'window',
      ),
    [levelDescendantNodes],
  )
  const floorplanStairs = useMemo(
    () =>
      levelDescendantNodes.filter(
        (node): node is StairNode => node.type === 'stair' && node.visible !== false,
      ),
    [levelDescendantNodes],
  )
  // Spawn + item fully registry-driven.
  const floorplanSpawnEntries = useMemo<FloorplanSpawnEntry[]>(() => [], [])
  const floorplanItemEntries = useMemo<FloorplanItemEntry[]>(() => [], [])
  // Elevator fully registry-driven via `def.floorplan`.
  const floorplanElevatorEntries = useMemo<FloorplanElevatorEntry[]>(() => [], [])
  const referenceFloorLevel = useMemo(() => {
    if (!(showReferenceFloor && levelNode)) {
      return null
    }

    const lowerLevels = floorplanLevels
      .filter((floorLevel) => floorLevel.id !== levelNode.id && floorLevel.level < levelNode.level)
      .sort((a, b) => b.level - a.level)

    return lowerLevels[referenceFloorOffset - 1] ?? lowerLevels[0] ?? null
  }, [floorplanLevels, levelNode, referenceFloorOffset, showReferenceFloor])
  const referenceFloorDescendants = useScene(
    useShallow((state) => {
      if (!referenceFloorLevel) {
        return [] as AnyNode[]
      }

      return collectLevelDescendants(
        referenceFloorLevel,
        state.nodes as Record<string, AnyNode>,
      ).filter((node) => node.visible !== false)
    }),
  )
  const referenceFloorData = useMemo<ReferenceFloorData | null>(() => {
    if (!referenceFloorLevel) {
      return null
    }

    const children = referenceFloorDescendants.filter(
      (node) => node.parentId === referenceFloorLevel.id,
    )
    const referenceWalls = children.filter((node): node is WallNode => node.type === 'wall')
    const referenceFences = children.filter((node): node is FenceNode => node.type === 'fence')
    const referenceColumns = children.filter((node): node is ColumnNode => node.type === 'column')
    const referenceSlabs = children.filter((node): node is SlabNode => node.type === 'slab')
    const referenceCeilings = children.filter(
      (node): node is CeilingNode => node.type === 'ceiling',
    )
    const referenceDescendants = referenceFloorDescendants
    const referenceDescendantById = new Map(referenceDescendants.map((node) => [node.id, node]))

    const referenceFloorplanWalls = referenceWalls.map(getFloorplanWall)
    const referenceWallMiterData = calculateLevelMiters(referenceFloorplanWalls)
    const referenceFloorplanWallById = new Map(
      referenceFloorplanWalls.map((wall) => [wall.id, wall] as const),
    )

    const wallPolygons = referenceWalls.map((wall) => {
      const floorplanWall = referenceFloorplanWallById.get(wall.id) ?? getFloorplanWall(wall)
      const polygon = getWallPlanFootprint(floorplanWall, referenceWallMiterData)

      return {
        points: formatPolygonPoints(polygon),
        polygon,
        wall,
      }
    })

    const openingPolygons = referenceDescendants.flatMap((node) => {
      if (!(node.type === 'door' || node.type === 'window')) {
        return []
      }

      const wall = referenceFloorplanWallById.get(node.parentId as WallNode['id'])
      if (!wall) {
        return []
      }

      const polygon = getOpeningFootprint(wall, node)
      return [
        {
          opening: node,
          points: formatPolygonPoints(polygon),
          polygon,
        },
      ]
    })

    const slabPolygons = referenceSlabs.flatMap((slab) => {
      const polygon = toFloorplanPolygon(slab.polygon)
      if (polygon.length < 3) {
        return []
      }

      const holes = (slab.holes ?? [])
        .map((hole) => toFloorplanPolygon(hole))
        .filter((hole) => hole.length >= 3)
      const visualPolygon = toFloorplanPolygon(getRenderableSlabPolygon(slab))
      const visualHoles = holes

      return [
        {
          slab,
          polygon,
          holes,
          visualPolygon,
          visualHoles,
          path: formatPolygonPath(visualPolygon, visualHoles),
        },
      ]
    })

    const ceilingPolygons = referenceCeilings.flatMap((ceiling) => {
      const polygon = toFloorplanPolygon(ceiling.polygon)
      if (polygon.length < 3) {
        return []
      }

      const holes = (ceiling.holes ?? [])
        .map((hole) => toFloorplanPolygon(hole))
        .filter((hole) => hole.length >= 3)

      return [
        {
          ceiling,
          polygon,
          holes,
          path: formatPolygonPath(polygon, holes),
        },
      ]
    })

    const fenceEntries = referenceFences.flatMap((fence) => {
      const centerline = isCurvedWall(fence)
        ? sampleWallCenterline(fence, 24)
        : [
            { x: fence.start[0], y: fence.start[1] },
            { x: fence.end[0], y: fence.end[1] },
          ]
      const path = buildSvgPolylinePath(centerline)
      if (!path) {
        return []
      }

      return [{ fence, centerline, markerFrames: [], path }]
    })

    const columnEntries = referenceColumns.flatMap((column) => {
      const polygon = getColumnPlanFootprint(column)
      if (polygon.length < 3) {
        return []
      }

      return [
        {
          column,
          points: formatPolygonPoints(polygon),
          polygon,
        },
      ]
    })

    // Render reference-floor stairs and roofs through the SAME registry
    // builders the active level uses (`def.floorplan` → `buildStairFloorplan`
    // / `buildRoofFloorplan`), so the symbol is pixel-identical to a stair /
    // roof on the current floor. These are the only registry-driven kinds
    // the legacy reference layer doesn't already collect manually.
    // `viewState` is omitted so each builder emits its unselected appearance
    // (no selection chrome / resize handles). Both the reference layer and
    // the registry renderer draw in the same plan-meter space
    // (`toSvgX`/`toSvgY` are identity), so the geometry composes directly.
    const registryEntries = referenceDescendants.flatMap<ReferenceFloorRegistryEntry>((node) => {
      if (!REFERENCE_REGISTRY_KINDS.has(node.type)) {
        return []
      }

      const builder = nodeRegistry.get(node.type)?.floorplan
      if (!builder) {
        return []
      }

      // Each builder walks its own segment children (stair-segment /
      // roof-segment) and filters by type. Pass them in stored `children`
      // order — stair-segment transforms are cumulative, so order matters.
      const childIds = (node as { children?: AnyNodeId[] }).children ?? []
      const children = childIds.flatMap((childId) => {
        const child = referenceDescendantById.get(childId)
        return child ? [child] : []
      })
      const ctx: GeometryContext = {
        resolve: (rid) => referenceDescendantById.get(rid) as never,
        children,
        siblings: [],
        parent: referenceFloorLevel,
        viewState: undefined,
      }
      const geometry = builder(node, ctx)
      if (!geometry) {
        return []
      }

      return [{ geometry, node }]
    })

    const transformCache = new Map<string, SharedFloorplanNodeTransform | null>()
    const itemEntries = referenceDescendants.flatMap((node) => {
      if (
        !(
          node.type === 'item' &&
          node.asset.category !== 'door' &&
          node.asset.category !== 'window'
        )
      ) {
        return []
      }

      const entry = buildFloorplanItemEntry(node, referenceDescendantById, transformCache)
      if (!entry) {
        return []
      }

      return [
        {
          dimensionPolygon: entry.dimensionPolygon,
          item: entry.item,
          points: formatPolygonPoints(entry.polygon),
          polygon: entry.polygon,
          usesRealMesh: entry.usesRealMesh,
          center: entry.center,
          rotation: entry.rotation,
          width: entry.width,
          depth: entry.depth,
        },
      ]
    })

    return {
      ceilingPolygons,
      columnEntries,
      fenceEntries,
      itemEntries,
      openingPolygons,
      registryEntries,
      slabPolygons,
      wallPolygons,
    }
  }, [referenceFloorDescendants, referenceFloorLevel])
  // Pending-mesh check was a flag the legacy active-level item entries
  // raised when their polygon was the dimension fallback (waiting for
  // the GLB to load to produce a tighter convex hull). Items are now
  // registry-rendered, so the active-level entry list is always empty
  // and this flag is permanently false.
  const hasPendingItemMeshFootprints = false
  // Stair fully registry-driven via `def.floorplan` (the parent walks
  // its `stair-segment` children inside `buildStairFloorplan` to handle
  // the cumulative-transform chain). `FloorplanRegistryLayer` renders
  // the result; this legacy list stays empty.
  const floorplanStairEntries = useMemo<FloorplanStairEntry[]>(() => [], [])
  // Roof / roof-segment fully registry-driven via def.floorplan.
  const floorplanRoofEntries = useMemo<FloorplanRoofEntry[]>(() => [], [])
  // Slab / ceiling / zone are registry-driven; the polygon-handle, hole
  // editor, and boundary-edit affordances live on `def.floorplanAffordances`.
  // These legacy lookups stay as null stubs so the hole-editing fallbacks
  // that still reference them compile cleanly.
  const selectedSlabEntry = null as SlabPolygonEntry | null
  const selectedCeilingEntry = null as CeilingPolygonEntry | null
  const selectedZoneEntry = null as ZonePolygonEntry | null
  const slabById = useMemo(() => new Map(slabs.map((slab) => [slab.id, slab] as const)), [slabs])
  const zoneById = useMemo(() => new Map(zones.map((zone) => [zone.id, zone] as const)), [zones])
  const ceilingById = useMemo(
    () => new Map(ceilings.map((ceiling) => [ceiling.id, ceiling] as const)),
    [ceilings],
  )

  const isSiteEditActive = phase === 'site'
  const isWallBuildActive = phase === 'structure' && mode === 'build' && tool === 'wall'
  const isSlabBuildActive = phase === 'structure' && mode === 'build' && tool === 'slab'
  const isCeilingBuildActive = phase === 'structure' && mode === 'build' && tool === 'ceiling'
  const isZoneBuildActive = phase === 'structure' && mode === 'build' && tool === 'zone'
  const isDoorBuildActive = phase === 'structure' && mode === 'build' && tool === 'door'
  const isWindowBuildActive = phase === 'structure' && mode === 'build' && tool === 'window'
  const isPolygonBuildActive = isSlabBuildActive || isZoneBuildActive
  const isPolygonDraftBuildActive = isPolygonBuildActive || isCeilingBuildActive
  const isOpeningBuildActive = isDoorBuildActive || isWindowBuildActive
  const isOpeningMoveActive = movingOpeningType !== null
  const isOpeningPlacementActive = isOpeningBuildActive || isOpeningMoveActive
  const isFenceBuildActive = phase === 'structure' && mode === 'build' && tool === 'fence'
  const fenceContinuation = useEditor((state) => state.continuationByContext.fence)
  const isRoofBuildActive = phase === 'structure' && mode === 'build' && tool === 'roof'
  const isStairBuildActive = phase === 'structure' && mode === 'build' && tool === 'stair'
  const isStairMoveActive = movingNode?.type === 'stair'
  const isRoofMoveActive = movingNode?.type === 'roof' || movingNode?.type === 'roof-segment'
  const isSlabMoveActive = movingNode?.type === 'slab'
  const isCeilingMoveActive = movingNode?.type === 'ceiling'
  const isFenceMoveActive = movingNode?.type === 'fence'
  const isWallMoveActive = movingNode?.type === 'wall'
  const isSpawnMoveActive = movingNode?.type === 'spawn'
  const isElevatorMoveActive = movingNode?.type === 'elevator'
  const isWallCurveActive = isCurveReshape && reshapingNode?.type === 'wall'
  const isFenceCurveActive = isCurveReshape && reshapingNode?.type === 'fence'
  const isFenceEndpointMoveActive = endpointReshape !== null && reshapingNode?.type === 'fence'
  const isItemPlacementPreviewActive =
    (mode === 'build' && tool === 'item') || movingNode?.type === 'item'
  const isFloorItemBuildActive = mode === 'build' && tool === 'item' && !selectedItem?.attachTo
  const isFloorItemMoveActive = movingNode?.type === 'item' && !movingNode.asset.attachTo
  // Ceiling-attached items (lights, fans). The 3D viewer drives these via
  // `ceiling:enter/move/click` raycast events on the ceiling mesh; the 2D
  // floor plan has no such mesh, so we synthesise the same events when the
  // cursor is over a ceiling polygon. Without this the placement system
  // never transitions out of `surface: 'floor'` and the draft sits at floor
  // height while the 2D cursor moves freely — what the user perceived as
  // "2D and 3D positions are out of sync".
  const isCeilingItemBuildActive =
    mode === 'build' && tool === 'item' && selectedItem?.attachTo === 'ceiling'
  const isCeilingItemMoveActive =
    movingNode?.type === 'item' && movingNode.asset.attachTo === 'ceiling'
  const isCeilingItemPlacementActive = isCeilingItemBuildActive || isCeilingItemMoveActive
  // Any registry-driven kind whose tool is currently active. Lets the floor
  // plan emit `grid:click` / `grid:move` events to that kind's placement tool
  // (shelf today; future Phase 5 kinds the moment they register a `tool`).
  // Independent of whether the kind has a `def.floorplan` builder — placement
  // works as long as the kind's tool subscribes to the emitter.
  const isRegistryToolBuildActive = mode === 'build' && tool != null && nodeRegistry.has(tool)
  const isFloorplanGridInteractionActive =
    isFenceBuildActive ||
    isRoofBuildActive ||
    isCeilingBuildActive ||
    isStairBuildActive ||
    isStairMoveActive ||
    isRoofMoveActive ||
    isSlabMoveActive ||
    isCeilingMoveActive ||
    isFenceMoveActive ||
    isWallMoveActive ||
    isSpawnMoveActive ||
    isElevatorMoveActive ||
    isWallCurveActive ||
    isFenceCurveActive ||
    isFenceEndpointMoveActive ||
    isFloorItemBuildActive ||
    isFloorItemMoveActive ||
    isRegistryToolBuildActive
  const floorplanOpeningLocalY = useMemo(() => {
    if (movingNode?.type === 'door' || movingNode?.type === 'window') {
      return snapToHalf(movingNode.position[1])
    }

    if (isWindowBuildActive) {
      // Floorplan is top-down, so new windows need an explicit wall-local height.
      return snapToHalf(FLOORPLAN_DEFAULT_WINDOW_LOCAL_Y)
    }

    return 0
  }, [isWindowBuildActive, movingNode])
  // Float the faithful door/window symbol at the cursor while it isn't over a
  // wall (the off-wall placement ghost), by publishing a transient opening on a
  // synthetic wall to `usePlacementPreview` — `FloorplanPlacementPreviewLayer`
  // renders it through the real `def.floorplan` builder (swing arc / panes), so
  // it reads as a real door/window, not a bare rectangle. Off any wall there's
  // no orientation to inherit, so the synthetic wall runs along plan-X.
  const showOpeningGhost = useCallback(
    (planPoint: WallPlanPoint) => {
      const isDoor = movingOpeningType === 'door' || (isDoorBuildActive && !movingOpeningType)
      // Synthetic wall centred at the cursor; the opening sits at its midpoint.
      const half =
        (isDoor
          ? movingNode?.type === 'door'
            ? movingNode.width
            : 0.9
          : movingNode?.type === 'window'
            ? movingNode.width
            : 1.5) /
          2 +
        0.5
      const wall = WallNodeSchema.parse({
        start: [planPoint[0] - half, planPoint[1]],
        end: [planPoint[0] + half, planPoint[1]],
        thickness: 0.1,
      })
      // Clone the moving opening (carries width / type / hinge / swing) onto the
      // synthetic wall, or parse a default for build mode. position[0] = the
      // along-wall midpoint so the symbol centres on the cursor.
      const base =
        movingNode?.type === 'door' || movingNode?.type === 'window'
          ? { ...movingNode }
          : isDoor
            ? DoorNodeSchema.parse({})
            : WindowNodeSchema.parse({})
      const ghost = {
        ...base,
        parentId: wall.id,
        wallId: wall.id,
        roofSegmentId: undefined,
        roofFace: undefined,
        position: [half, floorplanOpeningLocalY, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
      } as AnyNode
      usePlacementPreview.getState().set(ghost, wall)
    },
    [floorplanOpeningLocalY, isDoorBuildActive, movingNode, movingOpeningType],
  )
  // Drop the floating opening ghost whenever opening placement ends (commit,
  // tool change, mode switch, cancel) or the active level changes, so a stale
  // ghost never lingers on the wrong level.
  useEffect(() => {
    if (!isOpeningPlacementActive) usePlacementPreview.getState().clear()
  }, [isOpeningPlacementActive])
  // biome-ignore lint/correctness/useExhaustiveDependencies: `levelId` is an intentional re-run trigger; the effect drops the placement ghost when the active level changes.
  useEffect(() => {
    usePlacementPreview.getState().clear()
  }, [levelId])
  const isMarqueeSelectionToolActive =
    mode === 'select' &&
    floorplanSelectionTool === 'marquee' &&
    !movingNode &&
    !isFenceEndpointMoveActive &&
    structureLayer !== 'zones'
  const isScreenSelectionToolActive =
    mode === 'select' &&
    floorplanSelectionTool === 'click' &&
    (phase === 'structure' || phase === 'furnish') &&
    !movingNode &&
    !isFenceEndpointMoveActive &&
    !referenceScaleDraft &&
    !pendingReferenceScale
  const isDeleteMode = mode === 'delete' && !movingNode
  const canSelectElementFloorplanGeometry =
    mode === 'select' &&
    floorplanSelectionTool === 'click' &&
    !movingNode &&
    !isFenceEndpointMoveActive &&
    structureLayer !== 'zones'
  const canInteractElementFloorplanGeometry = isDeleteMode || canSelectElementFloorplanGeometry
  const canInteractFloorplanSlabs = isDeleteMode || canSelectElementFloorplanGeometry
  const canInteractWithGuides =
    showGuides &&
    canSelectElementFloorplanGeometry &&
    !referenceScaleDraft &&
    !pendingReferenceScale
  const canSelectFloorplanZones =
    mode === 'select' &&
    floorplanSelectionTool === 'click' &&
    !movingNode &&
    !isFenceEndpointMoveActive &&
    structureLayer === 'zones'
  const canInteractFloorplanZones = isDeleteMode || canSelectFloorplanZones
  const isFloorplanStructureContextActive = phase === 'structure' && structureLayer !== 'zones'
  const isFloorplanFurnishContextActive = phase === 'furnish'
  const isFloorplanItemContextActive =
    isFloorplanFurnishContextActive || isFloorplanStructureContextActive
  const canSelectFloorplanStairs =
    (mode === 'select' &&
      floorplanSelectionTool === 'click' &&
      !movingNode &&
      !isFenceEndpointMoveActive &&
      isFloorplanStructureContextActive) ||
    isDeleteMode
  const canSelectFloorplanElevators = canSelectFloorplanStairs
  const canSelectFloorplanSpawns = canSelectFloorplanStairs
  const canSelectFloorplanItems =
    (mode === 'select' &&
      floorplanSelectionTool === 'click' &&
      !movingNode &&
      !isFenceEndpointMoveActive &&
      isFloorplanItemContextActive) ||
    isDeleteMode
  const canFocusFloorplanStairs =
    mode === 'select' &&
    floorplanSelectionTool === 'click' &&
    !movingNode &&
    !isFenceEndpointMoveActive &&
    isFloorplanStructureContextActive
  const canFocusFloorplanSpawns = canFocusFloorplanStairs
  const canFocusFloorplanItems =
    mode === 'select' &&
    floorplanSelectionTool === 'click' &&
    !movingNode &&
    !isFenceEndpointMoveActive &&
    isFloorplanItemContextActive
  const visibleSitePolygon = displaySitePolygon
  const canUseSiteBoundaryVertexHandles =
    visibleSitePolygon !== null && (isSiteEditActive || mode === 'select')
  const isSiteBoundaryHighlighted = isSiteEditActive || siteVertexDragState !== null
  const shouldShowSiteEdgeLabels =
    Boolean(visibleSitePolygon) &&
    activeHandleDrag?.nodeId === visibleSitePolygon?.site.id &&
    activeHandleDrag?.label === SITE_BOUNDARY_DRAG_LABEL
  const visibleZonePolygons = displayZonePolygons
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const highlightedFloorplanIdSet = useMemo(
    () => new Set([...selectedIds, ...previewSelectedIds]),
    [previewSelectedIds, selectedIds],
  )
  const siteVertexHandles = useMemo(() => {
    if (!(canUseSiteBoundaryVertexHandles && visibleSitePolygon)) {
      return []
    }

    return visibleSitePolygon.polygon.map((point, vertexIndex) => ({
      nodeId: visibleSitePolygon.site.id,
      vertexIndex,
      point: toWallPlanPoint(point),
      isActive:
        siteVertexDragState?.siteId === visibleSitePolygon.site.id &&
        siteVertexDragState.vertexIndex === vertexIndex,
    }))
  }, [canUseSiteBoundaryVertexHandles, siteVertexDragState, visibleSitePolygon])
  const siteEdgeHandles = useMemo(() => {
    if (!(canUseSiteBoundaryVertexHandles && visibleSitePolygon && !siteVertexDragState)) {
      return []
    }

    return visibleSitePolygon.polygon.map((point, edgeIndex, polygon) => {
      const nextPoint = polygon[(edgeIndex + 1) % polygon.length]
      return {
        nodeId: visibleSitePolygon.site.id,
        edgeIndex,
        start: toWallPlanPoint(point),
        end: toWallPlanPoint(nextPoint ?? point),
      }
    })
  }, [canUseSiteBoundaryVertexHandles, siteVertexDragState, visibleSitePolygon])
  const siteMidpointHandles = useMemo(() => {
    if (!(canUseSiteBoundaryVertexHandles && visibleSitePolygon && !siteVertexDragState)) {
      return []
    }

    return visibleSitePolygon.polygon.map((point, edgeIndex, polygon) => {
      const nextPoint = polygon[(edgeIndex + 1) % polygon.length]
      return {
        nodeId: visibleSitePolygon.site.id,
        edgeIndex,
        point: [
          (point.x + (nextPoint?.x ?? point.x)) / 2,
          (point.y + (nextPoint?.y ?? point.y)) / 2,
        ] as WallPlanPoint,
      }
    })
  }, [canUseSiteBoundaryVertexHandles, siteVertexDragState, visibleSitePolygon])

  // The live wall / fence / roof draft preview (polygon + fence segment + wall
  // measurement) moved into `FloorplanLinearDraftLayer`, which reads the per-
  // move END points from the draft store so it re-renders per move without
  // re-rendering this panel.
  const activePolygonDraftPoints = useMemo(() => {
    if (isCeilingBuildActive) {
      return ceilingDraftPoints
    }

    if (isZoneBuildActive) {
      return zoneDraftPoints
    }

    if (isSlabBuildActive) {
      return slabDraftPoints
    }

    return [] as WallPlanPoint[]
  }, [
    ceilingDraftPoints,
    isCeilingBuildActive,
    isSlabBuildActive,
    isZoneBuildActive,
    slabDraftPoints,
    zoneDraftPoints,
  ])
  // The cursor-following polygon-draft preview (slab / zone / ceiling) moved into
  // `FloorplanDraftCursorLayer`, which reads the live cursor from the draft store
  // so it re-renders per move without re-rendering this panel.

  const svgAspectRatio = surfaceSize.width / surfaceSize.height || 1

  const fittedViewport = useMemo(() => {
    // Collect bounds from the legacy polygon arrays first. Most are empty
    // stubs (rendering moved to the registry layer), but we still honor
    // anything that does emit points so the fit is correct during the
    // brief window before `measuredSceneBBox` is populated.
    const legacyPoints = [
      ...(visibleSitePolygon ? visibleSitePolygon.polygon : []),
      ...displayCeilingPolygons.flatMap((entry) => entry.polygon),
      ...displaySlabPolygons.flatMap((entry) => entry.polygon),
      ...floorplanElevatorEntries.flatMap((entry) => entry.polygon),
      ...floorplanFenceEntries.flatMap((entry) => entry.centerline),
      ...floorplanItemEntries.flatMap((entry) => entry.polygon),
      ...floorplanRoofEntries.flatMap((entry) =>
        entry.segments.flatMap((segmentEntry) => segmentEntry.polygon),
      ),
      ...floorplanStairEntries.flatMap((entry) => entry.hitPolygons.flat()),
      ...visibleZonePolygons.flatMap((entry) => entry.polygon),
      ...wallPolygons.flatMap((entry) => entry.polygon),
    ]

    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY

    for (const point of legacyPoints) {
      const svgPoint = rotateSvgPoint(toSvgPoint(point), floorplanSceneRotationDeg)
      minX = Math.min(minX, svgPoint.x)
      maxX = Math.max(maxX, svgPoint.x)
      minY = Math.min(minY, svgPoint.y)
      maxY = Math.max(maxY, svgPoint.y)
    }

    // Fold in the DOM-measured bbox of the registry-driven scene. `getBBox`
    // returns coords in the rotation group's pre-transform space, so we
    // rotate the four corners to land in viewBox coords before bbox'ing.
    if (measuredSceneBBox && measuredSceneBBox.width >= 0 && measuredSceneBBox.height >= 0) {
      const { x, y, width: w, height: h } = measuredSceneBBox
      const corners = [
        rotateSvgPoint({ x, y }, floorplanSceneRotationDeg),
        rotateSvgPoint({ x: x + w, y }, floorplanSceneRotationDeg),
        rotateSvgPoint({ x, y: y + h }, floorplanSceneRotationDeg),
        rotateSvgPoint({ x: x + w, y: y + h }, floorplanSceneRotationDeg),
      ]
      for (const corner of corners) {
        minX = Math.min(minX, corner.x)
        maxX = Math.max(maxX, corner.x)
        minY = Math.min(minY, corner.y)
        maxY = Math.max(maxY, corner.y)
      }
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
      return {
        centerX: 0,
        centerY: 0,
        width: Math.max(FALLBACK_VIEW_SIZE, FALLBACK_VIEW_SIZE * svgAspectRatio),
      }
    }

    const rawWidth = maxX - minX
    const rawHeight = maxY - minY
    const paddedWidth = rawWidth + FLOORPLAN_PADDING * 2
    const paddedHeight = rawHeight + FLOORPLAN_PADDING * 2
    const width = Math.max(FALLBACK_VIEW_SIZE, paddedWidth, paddedHeight * svgAspectRatio)
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2

    return {
      centerX,
      centerY,
      width,
    }
  }, [
    displayCeilingPolygons,
    displaySlabPolygons,
    floorplanElevatorEntries,
    floorplanFenceEntries,
    floorplanItemEntries,
    floorplanRoofEntries,
    floorplanSceneRotationDeg,
    floorplanStairEntries,
    measuredSceneBBox,
    svgAspectRatio,
    visibleSitePolygon,
    visibleZonePolygons,
    wallPolygons,
  ])
  latestFittedViewportRef.current = fittedViewport

  // Measure the painted floor-plan scene after each render. `getBBox()`
  // gives us the tight bounds of whatever the registry layer emitted,
  // even for kinds whose legacy entry arrays are empty stubs. Bail out
  // when nothing has painted (empty group throws in some browsers).
  // We measure the content-only sub-group (not the full scene group) to
  // exclude the grid layer, whose extent tracks the viewBox and would
  // otherwise create a measure→fit→measure update loop.
  useLayoutEffect(() => {
    const el = floorplanContentRef.current
    if (!el) return
    let bbox: { x: number; y: number; width: number; height: number }
    try {
      const measured = el.getBBox()
      bbox = {
        x: measured.x,
        y: measured.y,
        width: measured.width,
        height: measured.height,
      }
    } catch {
      return
    }
    if (bbox.width <= 0 && bbox.height <= 0) return
    setMeasuredSceneBBox((prev) => {
      if (
        prev &&
        prev.x === bbox.x &&
        prev.y === bbox.y &&
        prev.width === bbox.width &&
        prev.height === bbox.height
      ) {
        return prev
      }
      return bbox
    })
  })

  const applyFloorplanNavigationState = useCallback(
    (nextViewport: FloorplanViewport, userRotationDeg: number) => {
      hasUserAdjustedViewportRef.current = true
      latestFloorplanUserRotationDegRef.current = userRotationDeg
      latestViewportRef.current = nextViewport
      setFloorplanUserRotationDeg((current) =>
        current === userRotationDeg ? current : userRotationDeg,
      )
      setViewport((current) =>
        floorplanViewportEquals(current, nextViewport) ? current : nextViewport,
      )
    },
    [],
  )

  const stopFloorplanViewAnimation = useCallback(() => {
    if (floorplanViewAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(floorplanViewAnimationFrameRef.current)
      floorplanViewAnimationFrameRef.current = null
    }
    floorplanViewAnimationTargetRef.current = null
  }, [])

  const animateFloorplanNavigationState = useCallback(
    (nextViewport: FloorplanViewport, userRotationDeg: number) => {
      floorplanViewAnimationTargetRef.current = {
        viewport: nextViewport,
        userRotationDeg,
        lastTimestamp: floorplanViewAnimationTargetRef.current?.lastTimestamp ?? null,
      }

      if (floorplanViewAnimationFrameRef.current !== null) {
        return
      }

      const step = (timestamp: number) => {
        const target = floorplanViewAnimationTargetRef.current
        if (!target) {
          floorplanViewAnimationFrameRef.current = null
          return
        }

        const currentViewport = latestViewportRef.current ?? target.viewport
        const currentRotationDeg = latestFloorplanUserRotationDegRef.current
        const deltaMs = target.lastTimestamp === null ? 16.67 : timestamp - target.lastTimestamp
        target.lastTimestamp = timestamp
        const alpha = 1 - Math.exp(-deltaMs / FLOORPLAN_VIEW_ANIMATION_TIME_CONSTANT_MS)
        const targetRotationDeg = nearestEquivalentDegrees(
          target.userRotationDeg,
          currentRotationDeg,
        )
        const nextRotationDeg =
          currentRotationDeg + (targetRotationDeg - currentRotationDeg) * alpha
        const animatedViewport = {
          centerX:
            currentViewport.centerX + (target.viewport.centerX - currentViewport.centerX) * alpha,
          centerY:
            currentViewport.centerY + (target.viewport.centerY - currentViewport.centerY) * alpha,
          width: currentViewport.width + (target.viewport.width - currentViewport.width) * alpha,
        }

        const isComplete =
          floorplanViewportWithinEpsilon(
            animatedViewport,
            target.viewport,
            FLOORPLAN_VIEW_ANIMATION_EPSILON,
          ) &&
          Math.abs(targetRotationDeg - nextRotationDeg) < FLOORPLAN_ROTATION_ANIMATION_EPSILON_DEG

        if (isComplete) {
          applyFloorplanNavigationState(target.viewport, targetRotationDeg)
          floorplanViewAnimationTargetRef.current = null
          floorplanViewAnimationFrameRef.current = null
          return
        }

        applyFloorplanNavigationState(animatedViewport, nextRotationDeg)
        floorplanViewAnimationFrameRef.current = window.requestAnimationFrame(step)
      }

      floorplanViewAnimationFrameRef.current = window.requestAnimationFrame(step)
    },
    [applyFloorplanNavigationState],
  )

  const applyFloorplanNavigationView = useCallback(
    (
      localCenter: SvgPoint,
      userRotationDeg: number,
      viewWidth?: number,
      options?: FloorplanNavigationViewOptions,
    ) => {
      const currentViewport = latestViewportRef.current ?? latestFittedViewportRef.current
      if (!currentViewport) {
        return
      }

      const nextSceneRotationDeg =
        FLOORPLAN_VIEW_ROTATION_DEG + userRotationDeg - buildingRotationDeg
      const centerSvg = rotateSvgPoint(localCenter, nextSceneRotationDeg)
      const fitted = latestFittedViewportRef.current
      const nextWidth = resolveFloorplanViewWidth(
        viewWidth ?? currentViewport.width,
        currentViewport.width,
        fitted,
        options?.clampViewWidth !== false,
      )

      const nextViewport = {
        centerX: centerSvg.x,
        centerY: centerSvg.y,
        width: nextWidth,
      }

      if (options?.smooth) {
        animateFloorplanNavigationState(nextViewport, userRotationDeg)
      } else {
        stopFloorplanViewAnimation()
        applyFloorplanNavigationState(nextViewport, userRotationDeg)
      }
    },
    [
      animateFloorplanNavigationState,
      applyFloorplanNavigationState,
      buildingRotationDeg,
      stopFloorplanViewAnimation,
    ],
  )

  const smoothFloorplanNavigationView = useCallback(
    (localCenter: SvgPoint, userRotationDeg: number, viewWidth?: number) => {
      applyFloorplanNavigationView(localCenter, userRotationDeg, viewWidth, { smooth: true })
    },
    [applyFloorplanNavigationView],
  )

  useEffect(() => {
    return () => {
      stopFloorplanViewAnimation()
    }
  }, [stopFloorplanViewAnimation])

  const syncFloorplanViewportToNavigationPose = useCallback(
    (pose: NavigationSyncPose) => {
      // Skip the viewport sync while the 2D panel is hidden (3D mode). It writes
      // React state (`setViewport`) that re-renders the whole floorplan SVG, so
      // doing it every camera-zoom frame for an invisible panel was a needless
      // per-frame stall. The catch-up effect below re-syncs on reopen.
      if (!isFloorplanOpenRef.current) {
        return
      }
      if (floorplanRotationStateRef.current) {
        return
      }

      const nextUserRotationDeg = floorplanRotationFromCameraAzimuth(
        pose.azimuth,
        latestFloorplanUserRotationDegRef.current,
      )
      const localCenter = worldToFloorplanLocalPoint(
        pose.target[0],
        pose.target[2],
        buildingPosition,
        buildingRotationY,
      )

      applyFloorplanNavigationView(localCenter, nextUserRotationDeg, pose.viewWidth, {
        clampViewWidth: false,
      })
    },
    [applyFloorplanNavigationView, buildingPosition, buildingRotationY],
  )

  useEffect(() => {
    const pose = useEditor.getState().navigationSyncPose
    if (!pose) {
      return
    }

    latestNavigationSyncPoseRef.current = pose
    if (pose.source === '3d') {
      // Re-runs when the panel reopens (`isFloorplanOpen`) so the viewport
      // catches up to the camera after the per-frame sync was skipped while
      // hidden; a no-op while closed (the sync early-returns).
      syncFloorplanViewportToNavigationPose(pose)
    }
  }, [syncFloorplanViewportToNavigationPose])

  useEffect(() => {
    return useEditor.subscribe((state) => {
      const pose = state.navigationSyncPose
      if (!pose || latestNavigationSyncPoseRef.current?.revision === pose.revision) {
        return
      }

      latestNavigationSyncPoseRef.current = pose

      if (pose.source === '3d') {
        syncFloorplanViewportToNavigationPose(pose)
      }
    })
  }, [syncFloorplanViewportToNavigationPose])

  useEffect(() => {
    const host = viewportHostRef.current
    if (!host) {
      return
    }

    const updateSize = () => {
      const rect = host.getBoundingClientRect()
      setSurfaceSize({
        width: Math.max(rect.width, 1),
        height: Math.max(rect.height, 1),
      })
    }

    updateSize()

    const resizeObserver = new ResizeObserver(updateSize)
    resizeObserver.observe(host)
    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  // Track actual container position and size for SVG coordinate transforms
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => {
      const rect = el.getBoundingClientRect()
      setPanelRect({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      })
      setIsPanelReady(true)
    }
    const observer = new ResizeObserver(update)
    observer.observe(el)
    window.addEventListener('resize', update)
    update()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  // Reset to auto-fit each time the 2D editor re-opens. The panel stays
  // mounted across close/open (hidden via `display: none`), so without
  // this the user's last pan/zoom — and any stale `measuredSceneBBox`
  // captured before they closed it — would survive and the reopened
  // editor would show the same off-screen viewport instead of fitting
  // to the current scene.
  useEffect(() => {
    if (!isFloorplanOpen) {
      stopFloorplanViewAnimation()
      floorplanSpacePanPressedRef.current = false
      panStateRef.current = null
      floorplanRotationStateRef.current = null
      setIsSpacePanPressed(false)
      setIsPanning(false)
      setIsRotatingFloorplan(false)
      return
    }
    setMeasuredSceneBBox(null)

    if (!latestNavigationSyncPoseRef.current) {
      stopFloorplanViewAnimation()
      hasUserAdjustedViewportRef.current = false
      latestFloorplanUserRotationDegRef.current = 0
      latestViewportRef.current = null
      setFloorplanUserRotationDeg(0)
      setViewport(null)
    }
  }, [isFloorplanOpen, stopFloorplanViewAnimation])

  useEffect(() => {
    const levelChanged = previousLevelIdRef.current !== (levelId ?? null)

    if (levelChanged) {
      previousLevelIdRef.current = levelId ?? null
      if (!latestNavigationSyncPoseRef.current) {
        stopFloorplanViewAnimation()
        hasUserAdjustedViewportRef.current = false
        latestFloorplanUserRotationDegRef.current = 0
        latestViewportRef.current = null
        setFloorplanUserRotationDeg(0)
        setViewport(null)
      }
      return
    }

    // While the cursor drives live geometry (items, drafts, moves), `fittedViewport` changes every
    // pointermove. Syncing `viewport` here would call setState in a tight loop (max update depth).
    // `cursorPoint` now lives in the draft store; read it non-reactively (this
    // effect only re-runs when `fittedViewport` / the other transient signals
    // change, and the viewport never refits mid-draft because scene data is
    // stable then — so a live store read is sufficient and correct).
    const transientFloorplanFit =
      useFloorplanDraftPreview.getState().cursorPoint != null ||
      movingNode != null ||
      endpointReshape != null ||
      isCurveReshape ||
      siteVertexDragState != null ||
      isPolygonDraftBuildActive

    if (!(hasUserAdjustedViewportRef.current || transientFloorplanFit)) {
      setViewport((current) =>
        floorplanViewportEquals(current, fittedViewport) ? current : fittedViewport,
      )
    }
  }, [
    endpointReshape,
    fittedViewport,
    isCurveReshape,
    isPolygonDraftBuildActive,
    levelId,
    movingNode,
    siteVertexDragState,
    stopFloorplanViewAnimation,
  ])

  const viewBox = useMemo(() => {
    const currentViewport = viewport ?? fittedViewport
    const width = currentViewport.width
    const height = width / svgAspectRatio

    return {
      minX: currentViewport.centerX - width / 2,
      minY: currentViewport.centerY - height / 2,
      width,
      height,
    }
  }, [fittedViewport, svgAspectRatio, viewport])
  const floorplanWorldUnitsPerPixel = useMemo(() => {
    const widthUnitsPerPixel = viewBox.width / Math.max(surfaceSize.width, 1)
    const heightUnitsPerPixel = viewBox.height / Math.max(surfaceSize.height, 1)

    return (widthUnitsPerPixel + heightUnitsPerPixel) / 2
  }, [surfaceSize.height, surfaceSize.width, viewBox.height, viewBox.width])
  const floorplanWallHitTolerance = useMemo(
    () => floorplanWorldUnitsPerPixel * (FLOORPLAN_WALL_HIT_STROKE_WIDTH / 2),
    [floorplanWorldUnitsPerPixel],
  )
  const floorplanOpeningHitTolerance = useMemo(
    () => floorplanWorldUnitsPerPixel * (FLOORPLAN_OPENING_HIT_STROKE_WIDTH / 2),
    [floorplanWorldUnitsPerPixel],
  )
  const wallSelectionHatchSpacing = useMemo(
    () => Math.max(floorplanWorldUnitsPerPixel * 12, 0.0001),
    [floorplanWorldUnitsPerPixel],
  )
  const wallSelectionHatchStrokeWidth = useMemo(
    () => Math.max(floorplanWorldUnitsPerPixel * 0.25, 0.0001),
    [floorplanWorldUnitsPerPixel],
  )
  const slabSelectionHatchStrokeWidth = useMemo(
    () => Math.max(floorplanWorldUnitsPerPixel * 0.55, 0.0001),
    [floorplanWorldUnitsPerPixel],
  )
  useEffect(() => {
    setHoveredGuideCorner(null)
  }, [])

  useEffect(() => {
    if (!(selectedGuide && showGuides && canInteractWithGuides)) {
      setHoveredGuideCorner(null)
    }
  }, [canInteractWithGuides, selectedGuide, showGuides])

  const guideHandleHintAnchor = useMemo<GuideHandleHintAnchor | null>(() => {
    if (
      !(
        hoveredGuideCorner &&
        selectedGuide &&
        selectedGuideDimensions &&
        surfaceSize.width > 0 &&
        surfaceSize.height > 0 &&
        viewBox.width > 0 &&
        viewBox.height > 0
      )
    ) {
      return null
    }

    const aspectRatio = selectedGuideDimensions.width / selectedGuideDimensions.height
    if (!(aspectRatio > 0)) {
      return null
    }

    const planWidth = getGuideWidth(selectedGuide.scale)
    const planHeight = getGuideHeight(planWidth, aspectRatio)
    const centerSvg = getGuideCenterSvgPoint(selectedGuide)
    const handleSvg = getGuideCornerSvgPoint(
      centerSvg,
      planWidth,
      planHeight,
      -selectedGuide.rotation[1],
      hoveredGuideCorner,
    )

    const centerPosition = projectSvgPointToSurface(
      rotateSvgPoint(centerSvg, floorplanSceneRotationDeg),
      viewBox,
      surfaceSize,
    )
    const handlePosition = projectSvgPointToSurface(
      rotateSvgPoint(handleSvg, floorplanSceneRotationDeg),
      viewBox,
      surfaceSize,
    )

    if (!(centerPosition && handlePosition)) {
      return null
    }

    const centerX = centerPosition.x
    const centerY = centerPosition.y
    const handleX = handlePosition.x
    const handleY = handlePosition.y

    let directionX = handleX - centerX
    let directionY = handleY - centerY
    const directionLength = Math.hypot(directionX, directionY)

    if (directionLength > 0.001) {
      directionX /= directionLength
      directionY /= directionLength
    } else {
      directionX = 1
      directionY = 0
    }

    const minX = Math.min(FLOORPLAN_GUIDE_HANDLE_HINT_PADDING_X, surfaceSize.width / 2)
    const maxX = Math.max(surfaceSize.width - FLOORPLAN_GUIDE_HANDLE_HINT_PADDING_X, minX)
    const minY = Math.min(FLOORPLAN_GUIDE_HANDLE_HINT_PADDING_Y, surfaceSize.height / 2)
    const maxY = Math.max(surfaceSize.height - FLOORPLAN_GUIDE_HANDLE_HINT_PADDING_Y, minY)

    return {
      x: clamp(handleX + directionX * FLOORPLAN_GUIDE_HANDLE_HINT_OFFSET, minX, maxX),
      y: clamp(handleY + directionY * FLOORPLAN_GUIDE_HANDLE_HINT_OFFSET, minY, maxY),
      directionX,
      directionY,
    }
  }, [
    hoveredGuideCorner,
    floorplanSceneRotationDeg,
    selectedGuide,
    selectedGuideDimensions,
    surfaceSize,
    surfaceSize.height,
    surfaceSize.width,
    viewBox,
  ])

  const palette = useMemo(
    () =>
      isDark
        ? {
            surface: '#0a0e1b',
            minorGrid: '#334155',
            majorGrid: '#64748b',
            minorGridOpacity: 0.62,
            majorGridOpacity: 0.86,
            slabFill: 'rgba(51, 65, 85, 0.48)',
            slabStroke: 'rgba(203, 213, 225, 0.82)',
            selectedSlabFill: 'rgba(59, 130, 246, 0.14)',
            selectedSlabStroke: '#93c5fd',
            ceilingFill: 'rgba(15, 23, 42, 0.18)',
            ceilingStroke: 'rgba(226, 232, 240, 0.74)',
            selectedCeilingFill: 'rgba(59, 130, 246, 0.16)',
            selectedCeilingStroke: '#93c5fd',
            wallFill: '#d8dee9',
            wallStroke: '#f8fafc',
            wallInnerStroke: 'rgba(148, 163, 184, 0.82)',
            wallShadow: 'rgba(0, 0, 0, 0.42)',
            wallHoverStroke: '#7dd3fc',
            deleteFill: '#f87171',
            deleteStroke: '#ef4444',
            deleteWallFill: '#ef4444',
            deleteWallHoverStroke: '#fca5a5',
            selectedFill: '#eff6ff',
            selectedStroke: '#60a5fa',
            draftFill: '#818cf8',
            draftStroke: '#c7d2fe',
            measurementStroke: '#e2e8f0',
            cursor: '#818cf8',
            editCursor: '#8381ed',
            anchor: '#818cf8',
            openingFill: '#0a0e1b',
            openingStroke: '#f8fafc',
            roofFill: 'rgba(56, 189, 248, 0.16)',
            roofActiveFill: 'rgba(56, 189, 248, 0.24)',
            roofSelectedFill: 'rgba(147, 197, 253, 0.28)',
            roofStroke: 'rgba(125, 211, 252, 0.82)',
            roofActiveStroke: '#38bdf8',
            roofSelectedStroke: '#93c5fd',
            roofRidgeStroke: 'rgba(186, 230, 253, 0.84)',
            roofSelectedRidgeStroke: '#eff6ff',
            stairFill: 'rgba(226, 232, 240, 0.12)',
            stairSelectedFill: 'rgba(96, 165, 250, 0.18)',
            stairStroke: '#e2e8f0',
            stairAccent: '#f8fafc',
            stairTread: 'rgba(226, 232, 240, 0.68)',
            stairSelectedTread: 'rgba(147, 197, 253, 0.86)',
            endpointHandleFill: '#fff7ed',
            endpointHandleStroke: '#c2410c',
            endpointHandleHoverStroke: '#fb923c',
            endpointHandleActiveFill: '#fff7ed',
            endpointHandleActiveStroke: '#f97316',
            curveHandleFill: '#ccfbf1',
            curveHandleStroke: '#0f766e',
            curveHandleHoverStroke: '#14b8a6',
          }
        : {
            surface: '#ffffff',
            minorGrid: '#94a3b8',
            majorGrid: '#475569',
            minorGridOpacity: 0.7,
            majorGridOpacity: 0.9,
            slabFill: '#f6f6f6',
            slabStroke: '#9e9e9e',
            selectedSlabFill: 'rgba(59, 130, 246, 0.14)',
            selectedSlabStroke: '#3b82f6',
            ceilingFill: '#f6f6f6',
            ceilingStroke: '#9e9e9e',
            selectedCeilingFill: 'rgba(59, 130, 246, 0.16)',
            selectedCeilingStroke: '#2563eb',
            wallFill: '#1f2937',
            wallStroke: 'rgba(31, 41, 55, 0.9)',
            wallInnerStroke: 'rgba(71, 85, 105, 0.58)',
            wallShadow: 'rgba(15, 23, 42, 0.1)',
            wallHoverStroke: '#60a5fa',
            deleteFill: '#fca5a5',
            deleteStroke: '#dc2626',
            deleteWallFill: '#ef4444',
            deleteWallHoverStroke: '#f87171',
            selectedFill: '#ffffff',
            selectedStroke: '#3b82f6',
            draftFill: '#6366f1',
            draftStroke: '#4338ca',
            measurementStroke: '#334155',
            cursor: '#6366f1',
            editCursor: '#8381ed',
            anchor: '#4338ca',
            openingFill: '#ffffff',
            openingStroke: '#171717',
            roofFill: 'rgba(14, 165, 233, 0.08)',
            roofActiveFill: 'rgba(14, 165, 233, 0.14)',
            roofSelectedFill: 'rgba(14, 165, 233, 0.2)',
            roofStroke: 'rgba(14, 165, 233, 0.65)',
            roofActiveStroke: '#0ea5e9',
            roofSelectedStroke: '#0369a1',
            roofRidgeStroke: 'rgba(3, 105, 161, 0.75)',
            roofSelectedRidgeStroke: '#0f172a',
            stairFill: 'rgba(255, 255, 255, 0.02)',
            stairSelectedFill: 'rgba(59, 130, 246, 0.08)',
            stairStroke: 'rgba(23, 23, 23, 0.88)',
            stairAccent: 'rgba(23, 23, 23, 0.96)',
            stairTread: 'rgba(38, 38, 38, 0.62)',
            stairSelectedTread: 'rgba(37, 99, 235, 0.78)',
            endpointHandleFill: '#fff7ed',
            endpointHandleStroke: '#c2410c',
            endpointHandleHoverStroke: '#fb923c',
            endpointHandleActiveFill: '#fff7ed',
            endpointHandleActiveStroke: '#f97316',
            curveHandleFill: '#ccfbf1',
            curveHandleStroke: '#0f766e',
            curveHandleHoverStroke: '#14b8a6',
          },
    [isDark],
  )
  const wallSelectionHatchId = useMemo(() => `floorplan-wall-selection-hatch-${isDark}`, [isDark])
  // Subset of the legacy palette surfaced to registry-driven kinds via
  // <FloorplanRenderProvider>. Mirrors `FloorplanPalette` in `@pascal-app/
  // core` — keep slot names + meanings in sync.
  const floorplanRegistryPalette = useMemo<FloorplanRenderContextValue['palette']>(
    () => ({
      selectedStroke: palette.selectedStroke,
      selectedFill: palette.selectedFill,
      selectedHatch: palette.selectedStroke,
      wallHoverStroke: palette.wallHoverStroke,
      endpointHandleFill: palette.endpointHandleFill,
      endpointHandleStroke: palette.endpointHandleStroke,
      endpointHandleHoverStroke: palette.endpointHandleHoverStroke,
      endpointHandleActiveFill: palette.endpointHandleActiveFill,
      endpointHandleActiveStroke: palette.endpointHandleActiveStroke,
      curveHandleFill: palette.curveHandleFill,
      curveHandleStroke: palette.curveHandleStroke,
      curveHandleHoverStroke: palette.curveHandleHoverStroke,
      measurementStroke: palette.measurementStroke,
      measurementLabelBackground: isDark ? '#0f172a' : '#ffffff',
      measurementLabelText: isDark ? '#e2e8f0' : '#171717',
    }),
    [palette, isDark],
  )
  const slabSelectionHatchId = useMemo(() => `floorplan-slab-selection-hatch-${isDark}`, [isDark])
  const gridSteps = useMemo(
    () => getVisibleGridSteps(viewBox.width, surfaceSize.width),
    [surfaceSize.width, viewBox.width],
  )
  const gridBounds = useMemo(
    () => getRotatedViewBoxBounds(viewBox, floorplanSceneRotationDeg),
    [floorplanSceneRotationDeg, viewBox],
  )

  const minorGridPath = useMemo(
    () =>
      buildGridPath(
        gridBounds.minX,
        gridBounds.maxX,
        gridBounds.minY,
        gridBounds.maxY,
        gridSteps.minorStep,
        {
          excludeStep: gridSteps.majorStep,
        },
      ),
    [gridBounds, gridSteps.majorStep, gridSteps.minorStep],
  )
  const majorGridPath = useMemo(
    () =>
      buildGridPath(
        gridBounds.minX,
        gridBounds.maxX,
        gridBounds.minY,
        gridBounds.maxY,
        gridSteps.majorStep,
      ),
    [gridBounds, gridSteps.majorStep],
  )
  const floorplanUnitsPerPixel = viewBox.width / Math.max(surfaceSize.width, 1)

  useEffect(() => {
    setReferenceScaleUnit(unit === 'imperial' ? 'feet' : 'meters')
  }, [unit])

  const startReferenceScaleForGuide = useCallback(
    (guideId: GuideNode['id']) => {
      const guide = guideById.get(guideId)
      if (!guide) {
        return
      }

      setReferenceScaleDraft({
        guideId: guide.id,
        start: null,
      })
      setPendingReferenceScale(null)
      setMode('select')
      setFloorplanSelectionTool('click')
      setShowGuides(true)
      setSelection({ selectedIds: [], zoneId: null })
      setSelectedReferenceId(guide.id)
    },
    [
      guideById,
      setFloorplanSelectionTool,
      setMode,
      setSelectedReferenceId,
      setSelection,
      setShowGuides,
    ],
  )

  useEffect(() => {
    const handleSetReferenceScale = (payload: { guideId?: GuideNode['id'] }) => {
      if (payload.guideId) {
        startReferenceScaleForGuide(payload.guideId)
      }
    }

    guideEmitter.on('guide:set-reference-scale', handleSetReferenceScale)
    return () => {
      guideEmitter.off('guide:set-reference-scale', handleSetReferenceScale)
    }
  }, [startReferenceScaleForGuide])

  useEffect(() => {
    const handleCancel = () => {
      setReferenceScaleDraft(null)
      setPendingReferenceScale(null)
    }

    guideEmitter.on('guide:cancel-reference-scale', handleCancel)
    return () => {
      guideEmitter.off('guide:cancel-reference-scale', handleCancel)
    }
  }, [])

  useEffect(() => {
    const handleDeleted = (payload: { guideId?: GuideNode['id'] }) => {
      if (!payload.guideId) {
        return
      }

      setReferenceScaleDraft((current) => (current?.guideId === payload.guideId ? null : current))
      setPendingReferenceScale((current) => (current?.guideId === payload.guideId ? null : current))
      clearGuideUi(payload.guideId)
    }

    guideEmitter.on('guide:deleted', handleDeleted)
    return () => {
      guideEmitter.off('guide:deleted', handleDeleted)
    }
  }, [clearGuideUi])

  const handleReferenceScaleConfirm = useCallback(() => {
    if (!pendingReferenceScale) {
      return
    }

    const guide = guideById.get(pendingReferenceScale.guideId)
    if (!guide) {
      setPendingReferenceScale(null)
      return
    }

    const displayLength = Number(referenceScaleValue)
    if (!(displayLength > 0)) {
      return
    }

    const realLengthMeters = convertReferenceLengthToMeters(displayLength, referenceScaleUnit)
    const requestedScaleFactor = realLengthMeters / pendingReferenceScale.measuredLengthUnits
    const currentGuideScale = guide.scale > 0 ? guide.scale : 1
    const nextGuideScale = Math.max(
      currentGuideScale * requestedScaleFactor,
      FLOORPLAN_GUIDE_MIN_SCALE,
    )
    const appliedScaleFactor = nextGuideScale / currentGuideScale
    const scaledEnd: WallPlanPoint = [
      pendingReferenceScale.start[0] +
        (pendingReferenceScale.end[0] - pendingReferenceScale.start[0]) * appliedScaleFactor,
      pendingReferenceScale.start[1] +
        (pendingReferenceScale.end[1] - pendingReferenceScale.start[1]) * appliedScaleFactor,
    ]
    const scaledMeasuredLengthUnits = Math.hypot(
      scaledEnd[0] - pendingReferenceScale.start[0],
      scaledEnd[1] - pendingReferenceScale.start[1],
    )
    const nextGuidePosition: GuideNode['position'] = [
      pendingReferenceScale.start[0] +
        (guide.position[0] - pendingReferenceScale.start[0]) * appliedScaleFactor,
      guide.position[1],
      pendingReferenceScale.start[1] +
        (guide.position[2] - pendingReferenceScale.start[1]) * appliedScaleFactor,
    ]
    const metersPerUnit =
      scaledMeasuredLengthUnits > 0 ? realLengthMeters / scaledMeasuredLengthUnits : 1

    updateNode(
      pendingReferenceScale.guideId as AnyNodeId,
      {
        position: nextGuidePosition,
        scale: nextGuideScale,
        scaleReference: {
          start: pendingReferenceScale.start,
          end: scaledEnd,
          realLengthMeters,
          measuredLengthUnits: scaledMeasuredLengthUnits,
          metersPerUnit,
          label: formatReferenceScaleLabel(displayLength, referenceScaleUnit),
        },
      } as Partial<GuideNode>,
    )
    setGuideLocked(pendingReferenceScale.guideId, true)
    setGuideScaleReferenceVisible(pendingReferenceScale.guideId, true)
    setSelectedReferenceId(pendingReferenceScale.guideId)
    setPendingReferenceScale(null)
  }, [
    guideById,
    pendingReferenceScale,
    referenceScaleUnit,
    referenceScaleValue,
    setGuideLocked,
    setGuideScaleReferenceVisible,
    setSelectedReferenceId,
    updateNode,
  ])

  const getSvgPointFromClientPoint = useCallback(
    (clientX: number, clientY: number): SvgPoint | null => {
      const svg = svgRef.current
      const target = floorplanSceneRef.current ?? svg
      const ctm = target?.getScreenCTM()
      if (!(svg && ctm)) {
        return null
      }

      const screenPoint = svg.createSVGPoint()
      screenPoint.x = clientX
      screenPoint.y = clientY
      const transformedPoint = screenPoint.matrixTransform(ctm.inverse())

      return { x: transformedPoint.x, y: transformedPoint.y }
    },
    [],
  )

  const getPlanPointFromClientPoint = useCallback(
    (clientX: number, clientY: number): WallPlanPoint | null => {
      const svgPoint = getSvgPointFromClientPoint(clientX, clientY)
      if (!svgPoint) {
        return null
      }

      if (!floorplanSceneRef.current && buildingRotationY !== 0) {
        const [unrotX, unrotY] = rotatePlanVector(svgPoint.x, svgPoint.y, -buildingRotationY)
        return toPlanPointFromSvgPoint({ x: unrotX, y: unrotY })
      }

      return toPlanPointFromSvgPoint(svgPoint)
    },
    [getSvgPointFromClientPoint, buildingRotationY],
  )

  const previewElevatorResize = useCallback(
    (dragState: ElevatorResizeDragState, planPoint: WallPlanPoint) => {
      const localDeltaX = planPoint[0] - dragState.center.x
      const localDeltaY = planPoint[1] - dragState.center.y
      const [localX, localY] = rotatePlanVector(localDeltaX, localDeltaY, -dragState.rotation)
      const axis = getElevatorResizeAxis(dragState.handle)
      const sign = getElevatorResizeSign(dragState.handle)
      const localDistance = sign * (axis === 'width' ? localX : localY)
      const nextOuterSize = Math.max(0.1, localDistance) * 2

      if (axis === 'width') {
        const nextShaftWidth = roundPlanMeters(
          Math.max(0.8, nextOuterSize - dragState.shaftWallThickness * 2),
        )
        const nextCabWidth = nextShaftWidth
        useLiveNodeOverrides
          .getState()
          .set(dragState.elevatorId, { shaftWidth: nextShaftWidth, width: nextCabWidth })
        setCursorPoint(planPoint)
        return { shaftWidth: nextShaftWidth, width: nextCabWidth } satisfies Partial<ElevatorNode>
      }

      const nextShaftDepth = roundPlanMeters(
        Math.max(0.8, nextOuterSize - dragState.shaftWallThickness * 2),
      )
      const nextCabDepth = nextShaftDepth
      useLiveNodeOverrides
        .getState()
        .set(dragState.elevatorId, { depth: nextCabDepth, shaftDepth: nextShaftDepth })
      setCursorPoint(planPoint)
      return { depth: nextCabDepth, shaftDepth: nextShaftDepth } satisfies Partial<ElevatorNode>
    },
    [setCursorPoint],
  )

  const handleElevatorResizePointerDown = useCallback(
    (
      entry: FloorplanElevatorEntry,
      handle: ElevatorResizeHandle,
      event: ReactPointerEvent<SVGCircleElement>,
    ) => {
      if (event.button !== 0 || mode !== 'select') {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      setHoveredElevatorId(null)
      setSelection({ selectedIds: [entry.elevator.id] })

      setElevatorResizeDragState({
        center: entry.center,
        elevatorId: entry.elevator.id,
        handle,
        pointerId: event.pointerId,
        rotation: entry.rotation,
        shaftWallThickness: entry.shaftWallThickness,
      })
    },
    [mode, setSelection],
  )

  const handleElevatorResizePointerMove = useCallback(
    (event: ReactPointerEvent<SVGCircleElement>) => {
      const dragState = elevatorResizeDragState
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return
      }

      const planPoint = getPlanPointFromClientPoint(event.clientX, event.clientY)
      if (!planPoint) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      previewElevatorResize(dragState, planPoint)
    },
    [elevatorResizeDragState, getPlanPointFromClientPoint, previewElevatorResize],
  )

  const handleElevatorResizePointerUp = useCallback(
    (event: ReactPointerEvent<SVGCircleElement>) => {
      const dragState = elevatorResizeDragState
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return
      }

      const planPoint = getPlanPointFromClientPoint(event.clientX, event.clientY)
      const updates = planPoint ? previewElevatorResize(dragState, planPoint) : {}

      event.preventDefault()
      event.stopPropagation()
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }

      useLiveNodeOverrides.getState().clear(dragState.elevatorId)
      if (Object.keys(updates).length > 0) {
        updateNode(dragState.elevatorId as AnyNodeId, updates)
      }
      setElevatorResizeDragState(null)
      setCursorPoint(null)
    },
    [
      elevatorResizeDragState,
      getPlanPointFromClientPoint,
      previewElevatorResize,
      updateNode,
      setCursorPoint,
    ],
  )

  useEffect(() => {
    siteBoundaryDraftRef.current = siteBoundaryDraft
  }, [siteBoundaryDraft])

  useEffect(() => {
    guideTransformDraftRef.current = guideTransformDraft
  }, [guideTransformDraft])

  const floorplanGridLocalY = useMemo(() => {
    if (movingNode?.type === 'item' || movingNode?.type === 'spawn') {
      return movingNode.position[1]
    }

    if (levelId) {
      return sceneRegistry.nodes.get(levelId as AnyNodeId)?.position.y ?? 0
    }

    return 0
  }, [levelId, movingNode])
  const floorplanGridWorldY = buildingPosition[1] + floorplanGridLocalY
  const publishFloorplanNavigationPose = useCallback(
    (localCenter: SvgPoint, userRotationDeg: number, viewWidth?: number) => {
      const currentViewport = latestViewportRef.current ?? latestFittedViewportRef.current
      const resolvedViewWidth = viewWidth ?? currentViewport?.width
      if (!(resolvedViewWidth && resolvedViewWidth > 0)) {
        return
      }

      const worldCenter = floorplanLocalToWorldPoint(
        localCenter,
        buildingPosition,
        buildingRotationY,
      )
      const targetY = latestNavigationSyncPoseRef.current?.target[1] ?? floorplanGridWorldY

      useEditor.getState().publishNavigationSyncPose({
        source: '2d',
        target: [worldCenter.x, targetY, worldCenter.z],
        azimuth: cameraAzimuthFromFloorplanRotation(userRotationDeg),
        viewWidth: resolvedViewWidth,
      })
    },
    [buildingPosition, buildingRotationY, floorplanGridWorldY],
  )

  const alignFloorplanViewToNorth = useCallback(() => {
    const currentViewport = latestViewportRef.current ?? latestFittedViewportRef.current
    if (!currentViewport) {
      return
    }

    const currentUserRotationDeg = latestFloorplanUserRotationDegRef.current
    const currentSceneRotationDeg =
      FLOORPLAN_VIEW_ROTATION_DEG + currentUserRotationDeg - buildingRotationDeg
    const localCenter = rotateSvgPoint(
      {
        x: currentViewport.centerX,
        y: currentViewport.centerY,
      },
      -currentSceneRotationDeg,
    )
    const nextUserRotationDeg = nearestEquivalentDegrees(0, currentUserRotationDeg)

    smoothFloorplanNavigationView(localCenter, nextUserRotationDeg, currentViewport.width)
    publishFloorplanNavigationPose(localCenter, nextUserRotationDeg, currentViewport.width)
  }, [buildingRotationDeg, publishFloorplanNavigationPose, smoothFloorplanNavigationView])

  const clearGuideInteraction = useCallback(() => {
    guideInteractionRef.current = null
    guideTransformDraftRef.current = null
    setGuideTransformDraft(null)
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  }, [])

  const finishPanelInteraction = useCallback(() => {
    panelInteractionRef.current = null
    setIsDraggingPanel(false)
    setActiveResizeDirection(null)
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  }, [])

  const beginPanelInteraction = useCallback((interaction: PanelInteractionState) => {
    panelInteractionRef.current = interaction
    if (interaction.type === 'drag') {
      setIsDraggingPanel(true)
      setActiveResizeDirection(null)
      document.body.style.cursor = 'grabbing'
    } else if (interaction.direction) {
      setIsDraggingPanel(false)
      setActiveResizeDirection(interaction.direction)
      document.body.style.cursor = resizeCursorByDirection[interaction.direction]
    }

    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const interaction = panelInteractionRef.current
      if (!interaction || event.pointerId !== interaction.pointerId) {
        return
      }

      event.preventDefault()

      const dx = event.clientX - interaction.startClientX
      const dy = event.clientY - interaction.startClientY
      const bounds = getViewportBounds()

      const nextRect =
        interaction.type === 'drag'
          ? movePanelRect(interaction.initialRect, dx, dy, bounds)
          : resizePanelRect(interaction.initialRect, interaction.direction ?? 'se', dx, dy, bounds)

      setPanelRect(nextRect)
    }

    const handlePointerUp = (event: PointerEvent) => {
      const interaction = panelInteractionRef.current
      if (!interaction || event.pointerId !== interaction.pointerId) {
        return
      }

      finishPanelInteraction()
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [finishPanelInteraction])

  useEffect(() => {
    return () => {
      finishPanelInteraction()
    }
  }, [finishPanelInteraction])

  useEffect(() => {
    const interaction = guideInteractionRef.current
    if (interaction && !guideById.has(interaction.guideId)) {
      clearGuideInteraction()
    }
  }, [clearGuideInteraction, guideById])

  useEffect(() => {
    if (!canInteractWithGuides) {
      clearGuideInteraction()
    }
  }, [canInteractWithGuides, clearGuideInteraction])

  useEffect(() => {
    return () => {
      clearGuideInteraction()
    }
  }, [clearGuideInteraction])

  const handlePanelDragStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return
      }

      const target = event.target as HTMLElement | null
      if (target?.closest('[data-floorplan-panel-control="true"]')) {
        return
      }

      event.preventDefault()

      beginPanelInteraction({
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        initialRect: panelRect,
        type: 'drag',
      })
    },
    [beginPanelInteraction, panelRect],
  )

  const handleResizeStart = useCallback(
    (direction: ResizeDirection, event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      beginPanelInteraction({
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        initialRect: panelRect,
        type: 'resize',
        direction,
      })
    },
    [beginPanelInteraction, panelRect],
  )

  const zoomViewportAtClientPoint = useCallback(
    (clientX: number, clientY: number, widthFactor: number) => {
      if (!Number.isFinite(widthFactor) || widthFactor <= 0) {
        return
      }

      // `getSvgPointFromClientPoint` resolves to the rotation group's
      // local coords (pre-rotation). The viewBox lives in the outer
      // SVG space (post-rotation), so apply the scene rotation here
      // before using the point as a zoom anchor — otherwise a rotated
      // scene zooms around the wrong location instead of the cursor.
      const localPoint = getSvgPointFromClientPoint(clientX, clientY)
      if (!localPoint) {
        return
      }
      const svgPoint = rotateSvgPoint(localPoint, floorplanSceneRotationDeg)

      const currentViewport = viewport ?? fittedViewport
      const currentViewBox = viewBox
      const nextWidth = resolveFloorplanViewWidth(
        currentViewport.width * widthFactor,
        currentViewport.width,
        fittedViewport,
        true,
      )
      const nextHeight = nextWidth / svgAspectRatio
      const normalizedX = (svgPoint.x - currentViewBox.minX) / currentViewBox.width
      const normalizedY = (svgPoint.y - currentViewBox.minY) / currentViewBox.height
      const nextMinX = svgPoint.x - normalizedX * nextWidth
      const nextMinY = svgPoint.y - normalizedY * nextHeight

      const nextCenterSvg: SvgPoint = {
        x: nextMinX + nextWidth / 2,
        y: nextMinY + nextHeight / 2,
      }
      const localCenter = rotateSvgPoint(nextCenterSvg, -floorplanSceneRotationDeg)

      smoothFloorplanNavigationView(
        localCenter,
        latestFloorplanUserRotationDegRef.current,
        nextWidth,
      )
      publishFloorplanNavigationPose(
        localCenter,
        latestFloorplanUserRotationDegRef.current,
        nextWidth,
      )
    },
    [
      fittedViewport,
      floorplanSceneRotationDeg,
      getSvgPointFromClientPoint,
      publishFloorplanNavigationPose,
      smoothFloorplanNavigationView,
      svgAspectRatio,
      viewBox,
      viewport,
    ],
  )

  const clearWallPlacementDraft = useCallback(() => {
    setDraftStart(null)
    setWallChainFirstVertex(null)
    setDraftEnd(null)
    useSegmentDraftChain.getState().clear('wall')
  }, [setDraftEnd])
  const clearFencePlacementDraft = useCallback(() => {
    setFenceDraftStart(null)
    setFenceDraftEnd(null)
  }, [setFenceDraftEnd])
  const clearRoofPlacementDraft = useCallback(() => {
    setRoofDraftStart(null)
    setRoofDraftEnd(null)
  }, [setRoofDraftEnd])
  const clearCeilingPlacementDraft = useCallback(() => {
    setCeilingDraftPoints([])
  }, [])
  const clearSlabPlacementDraft = useCallback(() => {
    setSlabDraftPoints([])
  }, [])
  const clearZonePlacementDraft = useCallback(() => {
    setZoneDraftPoints([])
  }, [])

  const clearWallEndpointDrag = useCallback(() => {
    wallEndpointDragRef.current = null
    setWallEndpointDraft(null)
    setHoveredEndpointId(null)
    useWallSnapIndicator.getState().clear()
  }, [])
  const clearWallCurveDrag = useCallback(() => {
    wallCurveDragRef.current = null
    setWallCurveDraft(null)
    setHoveredWallCurveHandleId(null)
  }, [])
  const clearSiteBoundaryInteraction = useCallback(() => {
    const draft = siteBoundaryDraftRef.current
    if (draft) {
      clearSiteBoundaryLivePreview(draft.siteId)
      const scope = useInteractionScope.getState().scope
      const activeHandleDrag =
        scope.kind === 'handle-drag' ? { nodeId: scope.nodeId, label: scope.handle } : null
      if (
        activeHandleDrag?.nodeId === draft.siteId &&
        activeHandleDrag.label === SITE_BOUNDARY_DRAG_LABEL
      ) {
        useInteractionScope.getState().endIf((sc) => sc.kind === 'handle-drag')
      }
    }

    siteBoundaryDraftRef.current = null
    setSiteVertexDragState(null)
    setSiteBoundaryDraft(null)
    setHoveredSiteHandleId(null)
  }, [clearSiteBoundaryLivePreview])
  const exitSiteEditingToSelect = useCallback(() => {
    setPhase('structure')
    setStructureLayer('elements')
    setMode('select')
  }, [setMode, setPhase, setStructureLayer])

  const clearDraft = useCallback(() => {
    clearWallPlacementDraft()
    clearFencePlacementDraft()
    clearRoofPlacementDraft()
    clearCeilingPlacementDraft()
    clearSlabPlacementDraft()
    clearZonePlacementDraft()
    clearWallEndpointDrag()
    clearWallCurveDrag()
    clearSiteBoundaryInteraction()
    setCursorPoint(null)
    // Drop any Figma-style alignment guide a draft branch left behind so it
    // doesn't linger after the tool deactivates / Esc / draft reset.
    useAlignmentGuides.getState().clear()
    useWallSnapIndicator.getState().clear()
  }, [
    clearFencePlacementDraft,
    clearCeilingPlacementDraft,
    clearRoofPlacementDraft,
    clearWallCurveDrag,
    clearSiteBoundaryInteraction,
    clearSlabPlacementDraft,
    clearWallEndpointDrag,
    clearWallPlacementDraft,
    clearZonePlacementDraft,
    setCursorPoint,
  ])

  useEffect(() => {
    if (isWallBuildActive || isFenceBuildActive || isRoofBuildActive || isPolygonDraftBuildActive) {
      return
    }

    clearDraft()
  }, [
    clearDraft,
    isFenceBuildActive,
    isPolygonDraftBuildActive,
    isRoofBuildActive,
    isWallBuildActive,
  ])

  useEffect(() => {
    const handleCancel = () => {
      clearDraft()
    }

    emitter.on('tool:cancel', handleCancel)
    return () => {
      emitter.off('tool:cancel', handleCancel)
    }
  }, [clearDraft])

  const createZoneOnCurrentLevel = useCallback(
    (points: WallPlanPoint[]) => {
      if (!levelId) {
        return null
      }

      const { createNode, nodes } = useScene.getState()
      const zoneCount = Object.values(nodes).filter((node) => node.type === 'zone').length
      const zone = ZoneNodeSchema.parse({
        color: PALETTE_COLORS[zoneCount % PALETTE_COLORS.length],
        name: `Zone ${zoneCount + 1}`,
        polygon: points.map(([x, z]) => [x, z] as [number, number]),
      })

      createNode(zone, levelId)
      sfxEmitter.emit('sfx:structure-build')
      setSelection({ zoneId: zone.id })
      return zone.id
    },
    [levelId, setSelection],
  )

  // Slab / ceiling are normally committed by their 3D registry tools (which
  // accumulate the same `grid:click` vertices the panel emits). That path is
  // dead in 2D-only view — the 3D canvas is `display:none`, so the tool never
  // commits. These local committers (mirroring `createZoneOnCurrentLevel`, and
  // the tools' own `commitSlab/CeilingDrawing`) are called ONLY in 2D-only view
  // so split / 3D keep their single-owner tool commit (no double-create).
  const createSlabOnCurrentLevel = useCallback(
    (points: WallPlanPoint[]) => {
      if (!levelId) {
        return null
      }
      const { createNode, nodes } = useScene.getState()
      const slabCount = Object.values(nodes).filter((node) => node.type === 'slab').length
      const defaults = useEditor.getState().toolDefaults.slab ?? {}
      const slab = SlabNodeSchema.parse({
        ...defaults,
        name: `Slab ${slabCount + 1}`,
        polygon: points.map(([x, z]) => [x, z] as [number, number]),
      })
      createNode(slab, levelId)
      sfxEmitter.emit('sfx:structure-build')
      setSelection({ selectedIds: [slab.id] })
      return slab.id
    },
    [levelId, setSelection],
  )

  const createCeilingOnCurrentLevel = useCallback(
    (points: WallPlanPoint[]) => {
      if (!levelId) {
        return null
      }
      const { createNode, nodes } = useScene.getState()
      const ceilingCount = Object.values(nodes).filter((node) => node.type === 'ceiling').length
      const defaults = useEditor.getState().toolDefaults.ceiling ?? {}
      const ceiling = CeilingNodeSchema.parse({
        ...defaults,
        name: `Ceiling ${ceilingCount + 1}`,
        polygon: points.map(([x, z]) => [x, z] as [number, number]),
      })
      createNode(ceiling, levelId)
      sfxEmitter.emit('sfx:structure-build')
      setSelection({ selectedIds: [ceiling.id] })
      return ceiling.id
    },
    [levelId, setSelection],
  )

  useEffect(() => {
    if (!isStairBuildActive) {
      useStairBuildPreview.getState().reset()
      return
    }

    const handleGridMove = (event: GridEvent) => {
      // Publish to the dedicated store (deduped on the snapped point), NOT panel
      // state: the stair preview lives in `FloorplanStairBuildPreviewLayer`, so a
      // per-move update re-renders only that tiny leaf instead of this entire
      // (~200ms) panel — the same pattern that keeps column/elevator smooth.
      useStairBuildPreview
        .getState()
        .setPoint(getSnappedFloorplanPoint([event.localPosition[0], event.localPosition[2]]))
    }

    emitter.on('grid:move', handleGridMove)

    return () => {
      emitter.off('grid:move', handleGridMove)
    }
  }, [isStairBuildActive])

  useEffect(() => {
    if (!isItemPlacementPreviewActive) {
      return
    }

    const refreshFloorplanItemPreview = () => {
      scheduleMovingFloorplanNodeRefresh()
    }

    emitter.on('grid:move', refreshFloorplanItemPreview)
    emitter.on('wall:enter', refreshFloorplanItemPreview as any)
    emitter.on('wall:move', refreshFloorplanItemPreview as any)
    emitter.on('wall:leave', refreshFloorplanItemPreview as any)
    emitter.on('ceiling:enter', refreshFloorplanItemPreview as any)
    emitter.on('ceiling:move', refreshFloorplanItemPreview as any)
    emitter.on('ceiling:leave', refreshFloorplanItemPreview as any)
    emitter.on('item:enter', refreshFloorplanItemPreview as any)
    emitter.on('item:move', refreshFloorplanItemPreview as any)
    emitter.on('item:leave', refreshFloorplanItemPreview as any)

    return () => {
      emitter.off('grid:move', refreshFloorplanItemPreview)
      emitter.off('wall:enter', refreshFloorplanItemPreview as any)
      emitter.off('wall:move', refreshFloorplanItemPreview as any)
      emitter.off('wall:leave', refreshFloorplanItemPreview as any)
      emitter.off('ceiling:enter', refreshFloorplanItemPreview as any)
      emitter.off('ceiling:move', refreshFloorplanItemPreview as any)
      emitter.off('ceiling:leave', refreshFloorplanItemPreview as any)
      emitter.off('item:enter', refreshFloorplanItemPreview as any)
      emitter.off('item:move', refreshFloorplanItemPreview as any)
      emitter.off('item:leave', refreshFloorplanItemPreview as any)
    }
  }, [isItemPlacementPreviewActive, scheduleMovingFloorplanNodeRefresh])

  useEffect(() => {
    if (!hasPendingItemMeshFootprints) {
      return
    }

    scheduleMovingFloorplanNodeRefresh()
  }, [scheduleMovingFloorplanNodeRefresh])

  // Subscribe to the live-transforms store so rotation/position changes that
  // *don't* go through pointer events still refresh the floorplan — e.g. R/T
  // keyboard rotation during placement updates `useLiveTransforms` but emits
  // no grid:move, so without this the floorplan was stale until the user
  // moved the cursor.
  useEffect(() => {
    if (!isItemPlacementPreviewActive) return
    const unsubscribe = useLiveTransforms.subscribe((state, prev) => {
      if (state.transforms !== prev.transforms) {
        scheduleMovingFloorplanNodeRefresh()
      }
    })
    return unsubscribe
  }, [isItemPlacementPreviewActive, scheduleMovingFloorplanNodeRefresh])

  useEffect(() => {
    if (!(movingNode?.type === 'door' || movingNode?.type === 'window')) {
      return
    }

    const movingOpeningId = movingNode.id
    const refreshOpeningPreview = () => {
      scheduleMovingFloorplanNodeRefresh()
    }

    refreshOpeningPreview()

    const unsubscribe = useLiveTransforms.subscribe((state, previousState) => {
      const nextTransform = state.transforms.get(movingOpeningId)
      const previousTransform = previousState.transforms.get(movingOpeningId)

      if (nextTransform !== previousTransform) {
        refreshOpeningPreview()
      }
    })

    return unsubscribe
  }, [movingNode, scheduleMovingFloorplanNodeRefresh])

  useEffect(() => {
    if (movingNode?.type !== 'fence') {
      return
    }

    const movingFence = fences.find((fence) => fence.id === movingNode.id)
    const watchedFenceIds = new Set<FenceNode['id']>([movingNode.id])

    if (movingFence) {
      for (const fence of fences) {
        if (fence.id === movingFence.id) {
          continue
        }

        if (
          pointsEqual(fence.start, movingFence.start) ||
          pointsEqual(fence.start, movingFence.end) ||
          pointsEqual(fence.end, movingFence.start) ||
          pointsEqual(fence.end, movingFence.end)
        ) {
          watchedFenceIds.add(fence.id)
        }
      }
    }

    const refreshFencePreview = () => {
      scheduleMovingFloorplanNodeRefresh()
    }

    refreshFencePreview()

    const unsubscribe = useLiveTransforms.subscribe((state, previousState) => {
      for (const fenceId of watchedFenceIds) {
        if (state.transforms.get(fenceId) !== previousState.transforms.get(fenceId)) {
          refreshFencePreview()
          break
        }
      }
    })

    return unsubscribe
  }, [fences, movingNode, scheduleMovingFloorplanNodeRefresh])

  useEffect(() => {
    if (!(movingNode?.type === 'roof' || movingNode?.type === 'roof-segment')) {
      return
    }

    const movingRoofNodeId = movingNode.id
    const refreshRoofPreview = () => {
      scheduleMovingFloorplanNodeRefresh()
    }

    refreshRoofPreview()

    const unsubscribe = useLiveTransforms.subscribe((state, previousState) => {
      const nextTransform = state.transforms.get(movingRoofNodeId)
      const previousTransform = previousState.transforms.get(movingRoofNodeId)

      if (nextTransform !== previousTransform) {
        refreshRoofPreview()
      }
    })

    return unsubscribe
  }, [movingNode, scheduleMovingFloorplanNodeRefresh])

  useEffect(() => {
    if (movingNode?.type !== 'spawn') {
      return
    }

    const movingSpawnId = movingNode.id
    const refreshSpawnPreview = () => {
      scheduleMovingFloorplanNodeRefresh()
    }

    refreshSpawnPreview()

    const unsubscribe = useLiveTransforms.subscribe((state, previousState) => {
      const nextTransform = state.transforms.get(movingSpawnId)
      const previousTransform = previousState.transforms.get(movingSpawnId)

      if (nextTransform !== previousTransform) {
        refreshSpawnPreview()
      }
    })

    return unsubscribe
  }, [movingNode, scheduleMovingFloorplanNodeRefresh])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isEditableTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        Boolean(target?.isContentEditable)

      if (isEditableTarget) {
        return
      }

      if (event.code === 'Space' && isFloorplanOpen) {
        event.preventDefault()
        floorplanSpacePanPressedRef.current = true
        setIsSpacePanPressed(true)
      }

      if (event.key === 'Shift') {
        setShiftPressed(true)
      }

      if (isStairBuildActive && (event.key === 'r' || event.key === 'R')) {
        useStairBuildPreview.getState().rotateBy(Math.PI / 4)
      } else if (isStairBuildActive && (event.key === 't' || event.key === 'T')) {
        useStairBuildPreview.getState().rotateBy(-Math.PI / 4)
      }

      if (
        (movingNode?.type === 'stair' ||
          movingNode?.type === 'item' ||
          movingNode?.type === 'spawn') &&
        (event.key === 'r' || event.key === 'R' || event.key === 't' || event.key === 'T')
      ) {
        setMovingFloorplanNodeRevision((current) => current + 1)
      }

      setRotationModifierPressed(
        event.key === 'Meta' || event.key === 'Control' || event.metaKey || event.ctrlKey,
      )
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        floorplanSpacePanPressedRef.current = false
        setIsSpacePanPressed(false)
      }

      if (event.key === 'Shift') {
        setShiftPressed(false)
      }

      setRotationModifierPressed(event.metaKey || event.ctrlKey)
    }
    const handleBlur = () => {
      floorplanSpacePanPressedRef.current = false
      setIsSpacePanPressed(false)
      setShiftPressed(false)
      setRotationModifierPressed(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [isFloorplanOpen, isStairBuildActive, movingNode])

  useEffect(() => {
    const handleWindowPointerMove = (event: PointerEvent) => {
      const guideInteraction = guideInteractionRef.current
      if (guideInteraction && event.pointerId === guideInteraction.pointerId) {
        event.preventDefault()

        const svgPoint = getSvgPointFromClientPoint(event.clientX, event.clientY)
        if (!svgPoint) {
          return
        }

        const bypassSnap = shiftPressed || event.shiftKey
        const nextDraft =
          guideInteraction.mode === 'rotate'
            ? buildGuideRotationDraft(guideInteraction, svgPoint, bypassSnap)
            : guideInteraction.mode === 'translate'
              ? buildGuideTranslateDraft(guideInteraction, svgPoint)
              : buildGuideResizeDraft(guideInteraction, svgPoint)

        if (areGuideTransformDraftsEqual(guideTransformDraftRef.current, nextDraft)) {
          return
        }

        guideTransformDraftRef.current = nextDraft
        setGuideTransformDraft(nextDraft)
        return
      }

      const pendingFenceDrag = pendingFenceDragRef.current
      if (pendingFenceDrag && event.pointerId === pendingFenceDrag.pointerId) {
        const dragDistance = Math.hypot(
          event.clientX - pendingFenceDrag.startClientX,
          event.clientY - pendingFenceDrag.startClientY,
        )

        if (dragDistance < FLOORPLAN_MARQUEE_DRAG_THRESHOLD_PX) {
          return
        }

        pendingFenceDragRef.current = null

        const fenceNode = useScene.getState().nodes[pendingFenceDrag.fenceId as AnyNodeId]
        if (!(fenceNode && fenceNode.type === 'fence')) {
          return
        }

        const suppressClick = (clickEvent: MouseEvent) => {
          clickEvent.stopImmediatePropagation()
          clickEvent.preventDefault()
          window.removeEventListener('click', suppressClick, true)
        }
        window.addEventListener('click', suppressClick, true)
        requestAnimationFrame(() => {
          window.removeEventListener('click', suppressClick, true)
        })

        sfxEmitter.emit('sfx:item-pick')
        setMovingNode(fenceNode)
        setSelection({ selectedIds: [] })
        return
      }

      const dragState = wallEndpointDragRef.current
      if (dragState && event.pointerId === dragState.pointerId) {
        event.preventDefault()

        const planPoint = getPlanPointFromClientPoint(event.clientX, event.clientY)
        if (!planPoint) {
          return
        }

        // Wall endpoint move: snapping follows the active mode; there is no
        // held-key bypass.
        const snapResult = snapWallDraftPointDetailed({
          point: planPoint,
          walls,
          ignoreWallIds: [dragState.wallId],
          magnetic: isMagneticSnapActive(),
        })
        const snappedPoint = snapResult.point
        // Magnetic beacon at the endpoint when it locked onto existing geometry.
        useWallSnapIndicator
          .getState()
          .set(
            snapResult.snap
              ? { x: snappedPoint[0], z: snappedPoint[1], kind: snapResult.snap }
              : null,
          )

        if (pointsEqual(dragState.currentPoint, snappedPoint)) {
          return
        }

        dragState.currentPoint = snappedPoint
        setCursorPoint(snappedPoint)
        setWallEndpointDraft((previousDraft) => {
          const primaryDraft = buildWallEndpointDraft(
            dragState.wallId,
            dragState.endpoint,
            dragState.fixedPoint,
            snappedPoint,
          )
          const linkedWallUpdates = getLinkedWallUpdates(
            dragState.linkedWalls,
            dragState.originalStart,
            dragState.originalEnd,
            primaryDraft.start,
            primaryDraft.end,
          )
          const nextDraft = buildWallEndpointDraft(
            dragState.wallId,
            dragState.endpoint,
            dragState.fixedPoint,
            snappedPoint,
            linkedWallUpdates,
          )

          if (
            !(
              previousDraft &&
              pointsEqual(previousDraft.start, nextDraft.start) &&
              pointsEqual(previousDraft.end, nextDraft.end)
            )
          ) {
            sfxEmitter.emit('sfx:grid-snap')
          }

          return nextDraft
        })
        return
      }

      const curveDragState = wallCurveDragRef.current
      if (!curveDragState || event.pointerId !== curveDragState.pointerId) {
        return
      }

      event.preventDefault()

      const planPoint = getPlanPointFromClientPoint(event.clientX, event.clientY)
      const wall = wallById.get(curveDragState.wallId)
      if (!(planPoint && wall)) {
        return
      }

      const chord = getWallChordFrame(wall)
      const snappedPoint: WallPlanPoint = [snapToHalf(planPoint[0]), snapToHalf(planPoint[1])]
      const rawCurveOffset = -(
        (snappedPoint[0] - chord.midpoint.x) * chord.normal.x +
        (snappedPoint[1] - chord.midpoint.y) * chord.normal.y
      )
      const nextCurveOffset = normalizeWallCurveOffset(wall, snapToHalf(rawCurveOffset))

      if (curveDragState.currentCurveOffset === nextCurveOffset) {
        return
      }

      curveDragState.currentCurveOffset = nextCurveOffset
      setWallCurveDraft({ wallId: wall.id, curveOffset: nextCurveOffset })
      setCursorPoint(snappedPoint)
      sfxEmitter.emit('sfx:grid-snap')
    }

    const commitGuideInteraction = (event: PointerEvent) => {
      const interaction = guideInteractionRef.current
      if (!interaction || event.pointerId !== interaction.pointerId) {
        return
      }

      event.preventDefault()

      const guide = guideById.get(interaction.guideId)
      if (!guide) {
        clearGuideInteraction()
        return
      }

      const svgPoint = getSvgPointFromClientPoint(event.clientX, event.clientY)
      const bypassSnap = shiftPressed || event.shiftKey
      const nextDraft = svgPoint
        ? interaction.mode === 'rotate'
          ? buildGuideRotationDraft(interaction, svgPoint, bypassSnap)
          : interaction.mode === 'translate'
            ? buildGuideTranslateDraft(interaction, svgPoint)
            : buildGuideResizeDraft(interaction, svgPoint)
        : guideTransformDraftRef.current

      if (nextDraft && !doesGuideMatchDraft(guide, nextDraft)) {
        updateNode(guide.id, {
          position: [nextDraft.position[0], guide.position[1], nextDraft.position[1]] as [
            number,
            number,
            number,
          ],
          rotation: [guide.rotation[0], nextDraft.rotation, guide.rotation[2]] as [
            number,
            number,
            number,
          ],
          scale: nextDraft.scale,
          scaleReference: transformGuideScaleReference(guide, nextDraft),
        })
      }

      clearGuideInteraction()
    }

    const cancelGuideInteraction = (event: PointerEvent) => {
      const interaction = guideInteractionRef.current
      if (!interaction || event.pointerId !== interaction.pointerId) {
        return
      }

      clearGuideInteraction()
    }

    const commitWallEndpointDrag = (event: PointerEvent) => {
      const dragState = wallEndpointDragRef.current
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return
      }

      const wall = wallById.get(dragState.wallId)
      if (wall) {
        const primaryDraft = buildWallEndpointDraft(
          dragState.wallId,
          dragState.endpoint,
          dragState.fixedPoint,
          dragState.currentPoint,
        )
        const nextDraft = buildWallEndpointDraft(
          dragState.wallId,
          dragState.endpoint,
          dragState.fixedPoint,
          dragState.currentPoint,
          getLinkedWallUpdates(
            dragState.linkedWalls,
            dragState.originalStart,
            dragState.originalEnd,
            primaryDraft.start,
            primaryDraft.end,
          ),
        )
        const commitUpdates = getWallEndpointDraftUpdates(nextDraft).filter((update) => {
          const currentWall = wallById.get(update.id)
          return (
            currentWall &&
            !(
              pointsEqual(update.start, currentWall.start) &&
              pointsEqual(update.end, currentWall.end)
            )
          )
        })

        if (commitUpdates.length > 0 && isSegmentLongEnough(nextDraft.start, nextDraft.end)) {
          useScene.getState().updateNodes(
            commitUpdates.map((update) => ({
              id: update.id as AnyNodeId,
              data: {
                start: update.start,
                end: update.end,
              },
            })),
          )
          sfxEmitter.emit('sfx:structure-build')
        }
      }

      clearWallEndpointDrag()
      setCursorPoint(null)
    }

    const commitWallCurveDrag = (event: PointerEvent) => {
      const dragState = wallCurveDragRef.current
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return
      }

      const wall = wallById.get(dragState.wallId)
      if (wall) {
        const nextCurveOffset = normalizeWallCurveOffset(wall, dragState.currentCurveOffset)
        const currentCurveOffset = normalizeWallCurveOffset(wall, wall.curveOffset ?? 0)
        if (nextCurveOffset !== currentCurveOffset) {
          updateNode(wall.id, { curveOffset: nextCurveOffset })
          sfxEmitter.emit('sfx:structure-build')
        }
      }

      clearWallCurveDrag()
      setCursorPoint(null)
    }

    const cancelWallEndpointDrag = (event: PointerEvent) => {
      const dragState = wallEndpointDragRef.current
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return
      }

      clearWallEndpointDrag()
      setCursorPoint(null)
    }

    const cancelWallCurveDrag = (event: PointerEvent) => {
      const dragState = wallCurveDragRef.current
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return
      }

      clearWallCurveDrag()
      setCursorPoint(null)
    }

    const clearPendingFenceDrag = (event: PointerEvent) => {
      const pendingFenceDrag = pendingFenceDragRef.current
      if (!pendingFenceDrag || event.pointerId !== pendingFenceDrag.pointerId) {
        return
      }

      pendingFenceDragRef.current = null
    }

    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerup', clearPendingFenceDrag)
    window.addEventListener('pointercancel', clearPendingFenceDrag)
    window.addEventListener('pointerup', commitGuideInteraction)
    window.addEventListener('pointercancel', cancelGuideInteraction)
    window.addEventListener('pointerup', commitWallEndpointDrag)
    window.addEventListener('pointercancel', cancelWallEndpointDrag)
    window.addEventListener('pointerup', commitWallCurveDrag)
    window.addEventListener('pointercancel', cancelWallCurveDrag)

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove)
      window.removeEventListener('pointerup', clearPendingFenceDrag)
      window.removeEventListener('pointercancel', clearPendingFenceDrag)
      window.removeEventListener('pointerup', commitGuideInteraction)
      window.removeEventListener('pointercancel', cancelGuideInteraction)
      window.removeEventListener('pointerup', commitWallEndpointDrag)
      window.removeEventListener('pointercancel', cancelWallEndpointDrag)
      window.removeEventListener('pointerup', commitWallCurveDrag)
      window.removeEventListener('pointercancel', cancelWallCurveDrag)
    }
  }, [
    clearWallCurveDrag,
    clearGuideInteraction,
    clearWallEndpointDrag,
    getSvgPointFromClientPoint,
    guideById,
    getPlanPointFromClientPoint,
    setMovingNode,
    setSelection,
    shiftPressed,
    updateNode,
    wallById,
    walls,
    setCursorPoint,
  ])

  useEffect(() => {
    pendingFenceDragRef.current = null
    clearWallEndpointDrag()
    clearWallCurveDrag()
  }, [clearWallCurveDrag, clearWallEndpointDrag])

  useEffect(() => {
    if (canUseSiteBoundaryVertexHandles) {
      return
    }

    clearSiteBoundaryInteraction()
  }, [canUseSiteBoundaryVertexHandles, clearSiteBoundaryInteraction])

  useEffect(() => {
    const dragState = siteVertexDragState
    if (!dragState) {
      return
    }

    const handleWindowPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) {
        return
      }

      event.preventDefault()

      const planPoint = getPlanPointFromClientPoint(event.clientX, event.clientY)
      if (!planPoint) {
        return
      }

      const snappedPoint: WallPlanPoint = [snapToHalf(planPoint[0]), snapToHalf(planPoint[1])]
      setCursorPoint(snappedPoint)

      const currentDraft = siteBoundaryDraftRef.current
      if (!currentDraft || currentDraft.siteId !== dragState.siteId) {
        return
      }

      const currentPoint = currentDraft.polygon[dragState.vertexIndex]
      if (currentPoint && pointsEqual(currentPoint, snappedPoint)) {
        return
      }

      sfxEmitter.emit('sfx:grid-snap')

      const nextPolygon = [...currentDraft.polygon]
      nextPolygon[dragState.vertexIndex] = snappedPoint
      const nextDraft = {
        ...currentDraft,
        polygon: nextPolygon,
      }
      siteBoundaryDraftRef.current = nextDraft
      setSiteBoundaryDraft(nextDraft)
      setSiteBoundaryLivePreview(dragState.siteId, nextPolygon)
    }

    const commitSiteVertexDrag = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) {
        return
      }

      const draft = siteBoundaryDraftRef.current
      const worldPolygon = draft ? siteBoundaryWorldPolygon(draft.polygon) : null
      if (
        draft &&
        worldPolygon &&
        site &&
        draft.siteId === site.id &&
        !polygonsEqual(worldPolygon, site.polygon?.points ?? [])
      ) {
        const suppressClick = (clickEvent: MouseEvent) => {
          clickEvent.stopImmediatePropagation()
          clickEvent.preventDefault()
          window.removeEventListener('click', suppressClick, true)
        }
        window.addEventListener('click', suppressClick, true)
        requestAnimationFrame(() => {
          window.removeEventListener('click', suppressClick, true)
        })

        updateNode(draft.siteId, {
          polygon: {
            type: 'polygon',
            points: worldPolygon,
          },
        })
        sfxEmitter.emit('sfx:structure-build')
      }

      clearSiteBoundaryInteraction()
      exitSiteEditingToSelect()
      setCursorPoint(null)
    }

    const cancelSiteVertexDrag = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) {
        return
      }

      clearSiteBoundaryInteraction()
      exitSiteEditingToSelect()
      setCursorPoint(null)
    }

    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerup', commitSiteVertexDrag)
    window.addEventListener('pointercancel', cancelSiteVertexDrag)

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove)
      window.removeEventListener('pointerup', commitSiteVertexDrag)
      window.removeEventListener('pointercancel', cancelSiteVertexDrag)
    }
  }, [
    clearSiteBoundaryInteraction,
    exitSiteEditingToSelect,
    getPlanPointFromClientPoint,
    setSiteBoundaryLivePreview,
    site,
    siteBoundaryWorldPolygon,
    siteVertexDragState,
    updateNode,
    setCursorPoint,
  ])

  useEffect(() => {
    return () => {
      setFloorplanHovered(false)
    }
  }, [setFloorplanHovered])

  const handleNavigationPointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (event.button === 1 || (event.button === 0 && floorplanSpacePanPressedRef.current)) {
        event.preventDefault()
        event.stopPropagation()

        floorplanNavigationClickSuppressedRef.current = true
        const currentViewport = viewport ?? fittedViewport
        panStateRef.current = {
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          centerSvg: {
            x: currentViewport.centerX,
            y: currentViewport.centerY,
          },
        }
        setIsPanning(true)
        setCursorPoint(null)
        setFloorplanCursorPosition(null)

        event.currentTarget.setPointerCapture(event.pointerId)
        return
      }

      if (event.button !== 2) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const currentViewport = viewport ?? fittedViewport
      const viewportCenterLocal = rotateSvgPoint(
        { x: currentViewport.centerX, y: currentViewport.centerY },
        -floorplanSceneRotationDeg,
      )

      floorplanRotationStateRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        initialUserRotationDeg: floorplanUserRotationDeg,
        viewportCenterLocal,
      }
      setIsRotatingFloorplan(true)
      setCursorPoint(null)
      setFloorplanCursorPosition(null)

      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [
      fittedViewport,
      floorplanSceneRotationDeg,
      floorplanUserRotationDeg,
      viewport,
      setFloorplanCursorPosition,
      setCursorPoint,
    ],
  )

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (event.button === 0) {
        if (!isScreenSelectionToolActive || event.defaultPrevented) {
          return
        }

        const target = event.target instanceof Element ? event.target : null
        if (target?.closest('[data-node-id]')) {
          return
        }

        const viewer = useViewer.getState()
        if (
          viewer.cameraDragging ||
          viewer.inputDragging ||
          isBoxSelectPointerSuppressed(event.nativeEvent)
        ) {
          return
        }

        floorplanScreenSelectionRef.current = {
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          currentClientX: event.clientX,
          currentClientY: event.clientY,
          isDragging: false,
        }
        setPreviewSelectedIds([])
        return
      }
    },
    [isScreenSelectionToolActive, setPreviewSelectedIds],
  )

  const endFloorplanNavigation = useCallback((event?: ReactPointerEvent<SVGSVGElement>) => {
    if (
      event &&
      (panStateRef.current || floorplanRotationStateRef.current) &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    panStateRef.current = null
    floorplanRotationStateRef.current = null
    setIsPanning(false)
    setIsRotatingFloorplan(false)

    window.setTimeout(() => {
      floorplanNavigationClickSuppressedRef.current = false
    }, 0)
  }, [])

  const hoveredWallIdRef = useRef<string | null>(null)
  const hoveredCeilingIdRef = useRef<string | null>(null)
  const emitFloorplanWallLeave = useCallback((wallId: string | null) => {
    if (!wallId) {
      return
    }

    const wallNode = useScene.getState().nodes[wallId as AnyNodeId]
    if (wallNode?.type !== 'wall') {
      return
    }

    emitter.emit('wall:leave', {
      node: wallNode,
      position: [0, 0, 0],
      localPosition: [0, 0, 0],
      stopPropagation: () => {},
    } as any)
  }, [])
  // Emits `planPoint` unchanged — callers own snapping. Re-quantizing here
  // (the old behaviour) destroyed magnetic corner / midpoint snaps the draft
  // branches had already resolved, desyncing the 2D pipeline from the 3D
  // tools that subscribe to these grid events.
  const emitFloorplanGridEvent = useCallback(
    (
      eventType: 'move' | 'click' | 'double-click',
      planPoint: WallPlanPoint,
      nativeEvent: ReactMouseEvent<SVGSVGElement> | ReactPointerEvent<SVGSVGElement>,
    ) => {
      const cos = Math.cos(buildingRotationY)
      const sin = Math.sin(buildingRotationY)
      const worldX = buildingPosition[0] + planPoint[0] * cos + planPoint[1] * sin
      const worldZ = buildingPosition[2] - planPoint[0] * sin + planPoint[1] * cos

      emitter.emit(`grid:${eventType}` as any, {
        nativeEvent: nativeEvent.nativeEvent as any,
        position: [worldX, floorplanGridWorldY, worldZ],
        localPosition: [planPoint[0], floorplanGridLocalY, planPoint[1]],
      })
    },
    [buildingPosition, buildingRotationY, floorplanGridLocalY, floorplanGridWorldY],
  )

  // Build a synthetic `CeilingEvent` from a 2D plan point so the placement
  // coordinator's existing ceiling handlers (which expect the same payload
  // shape the 3D raycaster produces) can drive a ceiling-attached item
  // placement from the floor plan. Returns null if the ceiling mesh isn't
  // registered yet — the placement strategy needs `event.object` for the
  // ceiling-local↔world transform.
  const buildFloorplanCeilingEventPayload = useCallback(
    (
      ceiling: CeilingNode,
      planPoint: WallPlanPoint,
      nativeEvent?: ReactMouseEvent<SVGSVGElement> | ReactPointerEvent<SVGSVGElement>,
    ) => {
      const ceilingMesh = sceneRegistry.nodes.get(ceiling.id as AnyNodeId)
      if (!ceilingMesh) return null

      const cos = Math.cos(buildingRotationY)
      const sin = Math.sin(buildingRotationY)
      const worldX = buildingPosition[0] + planPoint[0] * cos + planPoint[1] * sin
      const worldZ = buildingPosition[2] - planPoint[0] * sin + planPoint[1] * cos
      const worldY = ceilingMesh.getWorldPosition(new Vector3()).y
      const localVec = ceilingMesh.worldToLocal(new Vector3(worldX, worldY, worldZ))

      return {
        node: ceiling,
        position: [worldX, worldY, worldZ] as [number, number, number],
        localPosition: [localVec.x, localVec.y, localVec.z] as [number, number, number],
        normal: [0, -1, 0] as [number, number, number],
        object: ceilingMesh,
        stopPropagation: () => {},
        nativeEvent: nativeEvent?.nativeEvent,
      }
    },
    [buildingPosition, buildingRotationY],
  )

  const emitFloorplanCeilingLeave = useCallback((ceilingId: string | null) => {
    if (!ceilingId) return
    const ceilingNode = useScene.getState().nodes[ceilingId as AnyNodeId]
    if (ceilingNode?.type !== 'ceiling') return

    emitter.emit('ceiling:leave', {
      node: ceilingNode,
      position: [0, 0, 0],
      localPosition: [0, 0, 0],
      normal: [0, -1, 0],
      stopPropagation: () => {},
    } as any)
  }, [])

  // Clear the hovered-ceiling tracker whenever placement mode ends, so we
  // don't carry a stale ceiling id into the next placement session.
  useEffect(() => {
    if (!isCeilingItemPlacementActive && hoveredCeilingIdRef.current) {
      hoveredCeilingIdRef.current = null
    }
  }, [isCeilingItemPlacementActive])

  const findCeilingAtPlanPoint = useCallback(
    (planPoint: WallPlanPoint): CeilingNode | null => {
      if (ceilingHitEntries.length === 0) return null
      const point: Point2D = { x: planPoint[0], y: planPoint[1] }
      for (const entry of ceilingHitEntries) {
        if (isPointInsidePolygonWithHoles(point, entry.polygon, entry.holes)) {
          return entry.ceiling
        }
      }
      return null
    },
    [ceilingHitEntries],
  )

  // Route a 2D plan point through ceiling enter/move/leave events when a
  // ceiling-attached item is being placed. Returns true when the panel
  // should stop further pointer-move processing (we either emitted a
  // ceiling event or are between ceilings).
  const handleCeilingItemPlacementMove = useCallback(
    (planPoint: WallPlanPoint, nativeEvent: ReactPointerEvent<SVGSVGElement>): boolean => {
      if (!isCeilingItemPlacementActive) return false

      const ceiling = findCeilingAtPlanPoint(planPoint)
      if (!ceiling) {
        if (hoveredCeilingIdRef.current) {
          emitFloorplanCeilingLeave(hoveredCeilingIdRef.current)
          hoveredCeilingIdRef.current = null
        }
        return true
      }

      const payload = buildFloorplanCeilingEventPayload(ceiling, planPoint, nativeEvent)
      if (!payload) return true

      if (hoveredCeilingIdRef.current !== ceiling.id) {
        if (hoveredCeilingIdRef.current) {
          emitFloorplanCeilingLeave(hoveredCeilingIdRef.current)
        }
        hoveredCeilingIdRef.current = ceiling.id
        emitter.emit('ceiling:enter', payload as any)
      } else {
        emitter.emit('ceiling:move', payload as any)
      }
      return true
    },
    [
      buildFloorplanCeilingEventPayload,
      emitFloorplanCeilingLeave,
      findCeilingAtPlanPoint,
      isCeilingItemPlacementActive,
    ],
  )

  // Click counterpart — used by the background placement click handler.
  // Returns true if the click was a valid ceiling-item placement.
  const handleCeilingItemPlacementClick = useCallback(
    (planPoint: WallPlanPoint, nativeEvent: ReactMouseEvent<SVGSVGElement>): boolean => {
      if (!isCeilingItemPlacementActive) return false
      const ceiling = findCeilingAtPlanPoint(planPoint)
      if (!ceiling) return true

      // Ensure the placement state has entered the ceiling surface; the
      // user can click without a prior move (e.g. fresh placement after
      // selecting the asset from the catalog).
      if (hoveredCeilingIdRef.current !== ceiling.id) {
        const enterPayload = buildFloorplanCeilingEventPayload(ceiling, planPoint, nativeEvent)
        if (!enterPayload) return true
        if (hoveredCeilingIdRef.current) {
          emitFloorplanCeilingLeave(hoveredCeilingIdRef.current)
        }
        hoveredCeilingIdRef.current = ceiling.id
        emitter.emit('ceiling:enter', enterPayload as any)
      }

      const clickPayload = buildFloorplanCeilingEventPayload(ceiling, planPoint, nativeEvent)
      if (!clickPayload) return true
      emitter.emit('ceiling:click', clickPayload as any)
      return true
    },
    [
      buildFloorplanCeilingEventPayload,
      emitFloorplanCeilingLeave,
      findCeilingAtPlanPoint,
      isCeilingItemPlacementActive,
    ],
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const rotationState = floorplanRotationStateRef.current
      if (rotationState?.pointerId === event.pointerId) {
        event.preventDefault()
        event.stopPropagation()

        const angleDeltaDeg =
          (rotationState.startClientX - event.clientX) * FLOORPLAN_ROTATION_DEGREES_PER_PIXEL
        const nextUserRotationDeg = rotationState.initialUserRotationDeg + angleDeltaDeg

        smoothFloorplanNavigationView(rotationState.viewportCenterLocal, nextUserRotationDeg)
        publishFloorplanNavigationPose(rotationState.viewportCenterLocal, nextUserRotationDeg)
        setCursorPoint(null)
        return
      }

      if (panStateRef.current?.pointerId === event.pointerId) {
        event.preventDefault()
        event.stopPropagation()

        const deltaX = event.clientX - panStateRef.current.clientX
        const deltaY = event.clientY - panStateRef.current.clientY
        const worldPerPixelX = viewBox.width / surfaceSize.width
        const worldPerPixelY = viewBox.height / surfaceSize.height

        const nextCenterSvg = {
          x: panStateRef.current.centerSvg.x - deltaX * worldPerPixelX,
          y: panStateRef.current.centerSvg.y - deltaY * worldPerPixelY,
        }
        const currentUserRotationDeg = latestFloorplanUserRotationDegRef.current
        const currentSceneRotationDeg =
          FLOORPLAN_VIEW_ROTATION_DEG + currentUserRotationDeg - buildingRotationDeg
        const localCenter = rotateSvgPoint(nextCenterSvg, -currentSceneRotationDeg)

        smoothFloorplanNavigationView(localCenter, currentUserRotationDeg)
        publishFloorplanNavigationPose(localCenter, currentUserRotationDeg)

        panStateRef.current = {
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          centerSvg: nextCenterSvg,
        }
        setCursorPoint(null)
        return
      }

      if (guideInteractionRef.current?.pointerId === event.pointerId) {
        return
      }

      if (elevatorResizeDragState?.pointerId === event.pointerId) {
        return
      }

      if (wallEndpointDragRef.current?.pointerId === event.pointerId) {
        return
      }

      if (siteVertexDragState?.pointerId === event.pointerId) {
        return
      }

      const planPoint = getPlanPointFromClientPoint(event.clientX, event.clientY)
      if (!planPoint) {
        return
      }

      if (referenceScaleDraft) {
        emitFloorplanGridEvent('move', getSnappedFloorplanPoint(planPoint), event)

        // The rubber-band's moving end IS this cursor point — the draft-line
        // leaf reads it from the store, so no per-move panel-state write.
        setCursorPoint((previousPoint) =>
          previousPoint && pointsEqual(previousPoint, planPoint) ? previousPoint : planPoint,
        )
        return
      }

      if (isCeilingBuildActive) {
        // Polygon vertex snapping is governed by the active snapping mode (the
        // chip on the right): `grid` quantizes via `snapToHalf` (whose step is
        // 0 — i.e. off — in any non-grid mode), `angles` locks to 15° rays from
        // the previous vertex, `lines` pulls onto wall corners / alignment
        // guides, `off` is free. Alignment follows the magnetic snap mode.
        const angleSnap = ceilingDraftPoints.length > 0 && isAngleSnapActive()
        const fallbackPoint = snapPolygonDraftPoint({
          point: planPoint,
          start: ceilingDraftPoints[ceilingDraftPoints.length - 1],
          angleSnap,
        })
        const snappedPoint = resolveCeilingPlanPointSnap({
          rawPoint: planPoint,
          fallbackPoint,
          levelId,
          align: !angleSnap,
        }).point

        emitFloorplanGridEvent('move', snappedPoint, event)
        setCursorPoint((previousPoint) =>
          previousPoint && pointsEqual(previousPoint, snappedPoint) ? previousPoint : snappedPoint,
        )
        return
      }

      if (isRoofBuildActive) {
        // Roof is placed as a footprint (no directional draw → polygon context:
        // grid / lines / off, no angle lock). Mode-driven, matching the chip:
        // `grid` quantizes via `getSnappedFloorplanPoint` (step 0 in non-grid
        // modes), `lines` pulls onto alignment, `off` is free.
        const snappedPoint = alignFloorplanDraftPoint(getSnappedFloorplanPoint(planPoint), {
          bypass: !isMagneticSnapActive(),
        })
        emitFloorplanGridEvent('move', snappedPoint, event)
        setCursorPoint((previousPoint) =>
          previousPoint && pointsEqual(previousPoint, snappedPoint) ? previousPoint : snappedPoint,
        )

        if (roofDraftStart) {
          setRoofDraftEnd((previousPoint) =>
            previousPoint && pointsEqual(previousPoint, snappedPoint)
              ? previousPoint
              : snappedPoint,
          )
        }
        return
      }

      if (isFenceBuildActive) {
        // Fence draft: grid snap (+ existing-wall/fence endpoint snap), then
        // Figma alignment — same endpoint-wins precedence as the wall branch.
        // While a draft is open the segment locks to 15° rays from its start.
        // Snapping is governed by the snapping mode (`'off'` is the bypass);
        // there is no Shift hold-to-bypass. Alignment follows the magnetic snap
        // mode, not Alt (continuation is cycled through the HUD / C).
        const fenceAngleSnap = fenceDraftStart !== null && isAngleSnapActive()
        const fenceSnapped = snapFenceDraftPoint({
          point: planPoint,
          walls,
          fences,
          start: fenceDraftStart ?? undefined,
          angleSnap: fenceAngleSnap,
          magnetic: isMagneticSnapActive(),
        })
        const fenceGridBase = snapWallPointToGrid(planPoint)
        const fenceLocked =
          fenceSnapped[0] !== fenceGridBase[0] || fenceSnapped[1] !== fenceGridBase[1]
        let snappedPoint = fenceSnapped
        if (fenceLocked || fenceAngleSnap) useAlignmentGuides.getState().clear()
        else
          snappedPoint = alignFloorplanDraftPoint(fenceSnapped, {
            // Alignment is a line snap (pulls onto existing corners/edges) —
            // suppress it whenever magnetic snap is off (`'off'` / `'angles'`).
            bypass: !isMagneticSnapActive(),
          })

        emitFloorplanGridEvent('move', snappedPoint, event)
        setCursorPoint((previousPoint) =>
          previousPoint && pointsEqual(previousPoint, snappedPoint) ? previousPoint : snappedPoint,
        )

        if (fenceDraftStart) {
          setFenceDraftEnd((previousEnd) =>
            previousEnd && pointsEqual(previousEnd, snappedPoint) ? previousEnd : snappedPoint,
          )
        }
        return
      }

      // Slab / zone polygon build — local draft state + grid emit, same
      // reordering rationale as `handleBackgroundPlacementClick`: must
      // run BEFORE the `isFloorplanGridInteractionActive` catch-all so
      // the local polygon-draft state actually updates as the cursor
      // moves (the catch-all would otherwise swallow the move event).
      if (isPolygonBuildActive) {
        // Mode-driven (matches the chip): `grid` quantizes (`snapToHalf`'s step
        // is 0 in non-grid modes), `angles` locks 15° rays from the previous
        // vertex, `lines` snaps onto wall corners / alignment guides, `off` is
        // free. Alignment follows the magnetic snap mode.
        const angleSnap = activePolygonDraftPoints.length > 0 && isAngleSnapActive()
        const fallbackPoint = snapPolygonDraftPoint({
          point: planPoint,
          start: activePolygonDraftPoints[activePolygonDraftPoints.length - 1],
          angleSnap,
        })
        let snappedPoint = fallbackPoint
        if (isSlabBuildActive) {
          snappedPoint = resolveSlabPlanPointSnap({
            rawPoint: planPoint,
            fallbackPoint,
            levelId,
            align: !angleSnap,
          }).point
        } else if (angleSnap) {
          useAlignmentGuides.getState().clear()
        } else {
          snappedPoint = alignFloorplanDraftPoint(fallbackPoint, {
            bypass: !isMagneticSnapActive(),
          })
        }

        // Emit `grid:move` so the registry-driven slab tool also tracks
        // the cursor (its 3D preview needs it).
        emitFloorplanGridEvent('move', snappedPoint, event)

        setCursorPoint((previousPoint) => {
          const hasChanged = !(previousPoint && pointsEqual(previousPoint, snappedPoint))
          if (hasChanged && activePolygonDraftPoints.length > 0) {
            sfxEmitter.emit('sfx:grid-snap')
          }
          return snappedPoint
        })
        return
      }

      // Opening placement (door / window build, plus door / window move)
      // must run before the registry catch-all: door & window are
      // registered kinds, so `isRegistryToolBuildActive` is true during
      // their build mode and the catch-all would otherwise emit
      // `grid:move` and return — never emitting the `wall:enter` /
      // `wall:move` events the door / window placement tools listen for.
      // Same reason `handleBackgroundPlacementClick` runs its opening
      // branch before its grid catch-all.
      //
      // Only the pure BUILD case (a door/window tool armed with no
      // `movingNode`) drives placement through these synthesized `wall:*`
      // events. When a door/window `movingNode` is set — the community
      // preset / catalog flow — `FloorplanRegistryMoveOverlay` owns 2D
      // placement end-to-end via `def.floorplanMoveTarget` (faithful symbol,
      // plan-space snap, single-undo commit, R-flip). Running both at once
      // made them fight (R-flip overwritten on the next move, click-commit
      // dropped), so the move case is excluded here.
      if (isOpeningBuildActive && !isOpeningMoveActive) {
        const closest = findClosestWallPoint(planPoint, walls, {
          canUseWall: (wall) => !isCurvedWall(wall),
        })
        if (closest) {
          const dx = closest.wall.end[0] - closest.wall.start[0]
          const dz = closest.wall.end[1] - closest.wall.start[1]
          const length = Math.sqrt(dx * dx + dz * dz)
          const distance = closest.t * length

          const wallEvent = {
            node: closest.wall,
            point: { x: closest.point[0], y: 0, z: closest.point[1] },
            localPosition: [distance, floorplanOpeningLocalY, 0] as [number, number, number],
            normal: closest.normal,
            stopPropagation: () => {},
          }

          if (hoveredWallIdRef.current !== closest.wall.id) {
            if (hoveredWallIdRef.current) {
              emitFloorplanWallLeave(hoveredWallIdRef.current)
            }
            hoveredWallIdRef.current = closest.wall.id
            emitter.emit('wall:enter', wallEvent as any)
          } else {
            emitter.emit('wall:move', wallEvent as any)
          }
          // Snapped to a wall — the real on-wall draft is the preview; drop
          // the loose free-follow ghost.
          usePlacementPreview.getState().clear()
        } else {
          if (hoveredWallIdRef.current) {
            emitFloorplanWallLeave(hoveredWallIdRef.current)
            hoveredWallIdRef.current = null
          }
          // Off any wall — float the FAITHFUL door/window symbol (swing arc /
          // panes) following the cursor, not a bare rectangle. The glyph
          // builder needs a wall for `ctx.parent`, so we publish the opening on
          // a SYNTHETIC wall segment centred at the cursor (plan-X aligned) to
          // `usePlacementPreview`; `FloorplanPlacementPreviewLayer` renders it
          // through the real `def.floorplan` builder.
          const snappedPoint = getSnappedFloorplanPoint(planPoint)
          showOpeningGhost(snappedPoint)
        }
        return
      }

      // Ceiling-attached item placement. Same shape as the opening branch
      // above: synthesise the surface events the placement coordinator
      // already listens for (ceiling:enter / move / leave) instead of
      // routing through `grid:move`, which would otherwise be processed
      // by the floor strategy and drop the item to floor height.
      if (isCeilingItemPlacementActive) {
        const snappedPoint = getSnappedFloorplanPoint(planPoint)
        setCursorPoint((previousPoint) =>
          previousPoint && pointsEqual(previousPoint, snappedPoint) ? previousPoint : snappedPoint,
        )
        handleCeilingItemPlacementMove(snappedPoint, event)
        return
      }

      // Registry-driven catch-all for kinds without bespoke 2D handling
      // (shelf, etc.). Must run AFTER the opening branch above (door /
      // window are also registered kinds, but need wall events — see
      // comment there). Wall build skips this so its own branch below
      // updates local `draftEnd` state alongside the registry tool.
      //
      // A door/window MOVE (community preset) is owned by
      // `FloorplanRegistryMoveOverlay`; `isRegistryToolBuildActive` is true
      // for it (build mode + a registered `door`/`window` tool), so without
      // this exclusion the catch-all would emit `grid:move` and re-drive the
      // 3D MoveDoorTool's free-follow, fighting the overlay again.
      if (!isWallBuildActive && !isOpeningMoveActive && isFloorplanGridInteractionActive) {
        const snappedPoint = getSnappedFloorplanPoint(planPoint)
        emitFloorplanGridEvent('move', snappedPoint, event)
        setCursorPoint((previousPoint) =>
          previousPoint && pointsEqual(previousPoint, snappedPoint) ? previousPoint : snappedPoint,
        )
        return
      }

      if (isMarqueeSelectionToolActive) {
        setCursorPoint((previousPoint) => {
          const snappedPoint = getSnappedFloorplanPoint(planPoint)
          return previousPoint && pointsEqual(previousPoint, snappedPoint)
            ? previousPoint
            : snappedPoint
        })
        return
      }

      if (!isWallBuildActive) {
        setCursorPoint(null)
        return
      }

      // Wall draft: grid + magnetic snap, then Figma-style alignment.
      // While a draft is open the segment locks to 15° rays from its start.
      // Snapping is governed by the snapping mode (`'off'` is the bypass);
      // there is no Shift hold-to-bypass.
      const wallAngleSnap = draftStart !== null && isAngleSnapActive()
      const wallSnap = snapWallDraftPointDetailed({
        point: planPoint,
        walls,
        start: draftStart ?? undefined,
        angleSnap: wallAngleSnap,
        magnetic: isMagneticSnapActive(),
      })
      const wallSnapped = wallSnap.point
      // Locked onto existing geometry (corner / midpoint / crossing / edge) →
      // that snap wins, so skip Figma alignment and stand the beacon there.
      const lockedToWall = wallSnap.snap !== null
      let snappedPoint = wallSnapped
      if (lockedToWall) {
        useAlignmentGuides.getState().clear()
      } else {
        snappedPoint = alignFloorplanDraftPoint(wallSnapped, {
          applySnap: !wallAngleSnap,
          // Alignment is a line snap (pulls onto existing corners/edges) —
          // suppress it whenever magnetic snap is off (`'off'` / `'angles'`).
          bypass: !isMagneticSnapActive(),
        })
      }
      useWallSnapIndicator
        .getState()
        .set(wallSnap.snap ? { x: snappedPoint[0], z: snappedPoint[1], kind: wallSnap.snap } : null)

      // Emit `grid:move` so the registry-driven wall tool's 3D preview
      // tracks the cursor. The local draftEnd update below is what
      // drives the 2D draft polygon — both views update in parallel.
      emitFloorplanGridEvent('move', snappedPoint, event)
      setCursorPoint(snappedPoint)

      if (!draftStart) {
        return
      }

      setDraftEnd((previousEnd) => {
        if (
          !previousEnd ||
          previousEnd[0] !== snappedPoint[0] ||
          previousEnd[1] !== snappedPoint[1]
        ) {
          sfxEmitter.emit('sfx:grid-snap')
        }

        return snappedPoint
      })
    },
    [
      buildingRotationDeg,
      draftStart,
      ceilingDraftPoints,
      emitFloorplanWallLeave,
      emitFloorplanGridEvent,
      fences,
      fenceDraftStart,
      floorplanOpeningLocalY,
      getPlanPointFromClientPoint,
      activePolygonDraftPoints,
      handleCeilingItemPlacementMove,
      isCeilingBuildActive,
      isCeilingItemPlacementActive,
      isFenceBuildActive,
      isFloorplanGridInteractionActive,
      isMarqueeSelectionToolActive,
      isOpeningBuildActive,
      isOpeningMoveActive,
      // The off-wall opening ghost is published through this memoised
      // callback, whose glyph (door swing-arc vs window panes) is bound to
      // `isDoorBuildActive`. It must be a dependency or a door→window tool
      // switch (which changes none of the other listed deps) would keep the
      // stale closure and float a door symbol while the window tool is armed.
      showOpeningGhost,
      isPolygonBuildActive,
      isRoofBuildActive,
      isSlabBuildActive,
      isWallBuildActive,
      levelId,
      publishFloorplanNavigationPose,
      smoothFloorplanNavigationView,
      referenceScaleDraft,
      roofDraftStart,
      elevatorResizeDragState,
      siteVertexDragState,
      surfaceSize.height,
      surfaceSize.width,
      viewBox.height,
      viewBox.width,
      walls,
      setCursorPoint,
      setDraftEnd,
      setRoofDraftEnd,
      setFenceDraftEnd,
    ],
  )

  // Slab creation is owned by the registry-driven slab tool (parity with
  // ceiling): the click/double-click that closes the polygon is forwarded as
  // a grid event, and the 3D tool commits the node. These 2D handlers only
  // maintain the draft-preview state and clear it on close — they must NOT
  // create a node themselves, or every slab would be built twice.
  const handleSlabPlacementPoint = useCallback(
    (point: WallPlanPoint) => {
      const lastPoint = slabDraftPoints[slabDraftPoints.length - 1]
      if (lastPoint && pointsEqual(lastPoint, point)) {
        return
      }

      const firstPoint = slabDraftPoints[0]
      if (firstPoint && slabDraftPoints.length >= 3 && isPointNearPlanPoint(point, firstPoint)) {
        // 2D-only view: the 3D tool can't commit, so close the polygon here.
        if (useEditor.getState().viewMode === '2d') {
          createSlabOnCurrentLevel(slabDraftPoints)
        }
        clearDraft()
        return
      }

      setSlabDraftPoints((currentPoints) => [...currentPoints, point])
      setCursorPoint(point)
    },
    [clearDraft, createSlabOnCurrentLevel, slabDraftPoints, setCursorPoint],
  )
  const handleSlabPlacementConfirm = useCallback(
    (point?: WallPlanPoint) => {
      const firstPoint = slabDraftPoints[0]
      const lastPoint = slabDraftPoints[slabDraftPoints.length - 1]

      let nextPoints = slabDraftPoints
      if (point) {
        const isClosingExistingPolygon = Boolean(
          firstPoint && slabDraftPoints.length >= 3 && isPointNearPlanPoint(point, firstPoint),
        )
        const isDuplicatePoint = Boolean(lastPoint && pointsEqual(lastPoint, point))

        if (!(isClosingExistingPolygon || isDuplicatePoint)) {
          nextPoints = [...slabDraftPoints, point]
        }
      }

      if (nextPoints.length < 3) {
        return
      }

      // 2D-only view: the 3D tool can't commit, so create the slab here.
      if (useEditor.getState().viewMode === '2d') {
        createSlabOnCurrentLevel(nextPoints)
      }
      clearDraft()
    },
    [clearDraft, createSlabOnCurrentLevel, slabDraftPoints],
  )
  const handleCeilingPlacementPoint = useCallback(
    (point: WallPlanPoint) => {
      const lastPoint = ceilingDraftPoints[ceilingDraftPoints.length - 1]
      if (lastPoint && pointsEqual(lastPoint, point)) {
        return
      }

      const firstPoint = ceilingDraftPoints[0]
      if (firstPoint && ceilingDraftPoints.length >= 3 && isPointNearPlanPoint(point, firstPoint)) {
        if (useEditor.getState().viewMode === '2d') {
          createCeilingOnCurrentLevel(ceilingDraftPoints)
        }
        clearCeilingPlacementDraft()
        return
      }

      setCeilingDraftPoints((currentPoints) => [...currentPoints, point])
      setCursorPoint(point)
    },
    [ceilingDraftPoints, clearCeilingPlacementDraft, createCeilingOnCurrentLevel, setCursorPoint],
  )
  const handleCeilingPlacementConfirm = useCallback(
    (point?: WallPlanPoint) => {
      const firstPoint = ceilingDraftPoints[0]
      const lastPoint = ceilingDraftPoints[ceilingDraftPoints.length - 1]

      let nextPoints = ceilingDraftPoints
      if (point) {
        const isClosingExistingPolygon = Boolean(
          firstPoint && ceilingDraftPoints.length >= 3 && isPointNearPlanPoint(point, firstPoint),
        )
        const isDuplicatePoint = Boolean(lastPoint && pointsEqual(lastPoint, point))

        if (!(isClosingExistingPolygon || isDuplicatePoint)) {
          nextPoints = [...ceilingDraftPoints, point]
        }
      }

      if (nextPoints.length < 3) {
        return
      }

      if (useEditor.getState().viewMode === '2d') {
        createCeilingOnCurrentLevel(nextPoints)
      }
      clearCeilingPlacementDraft()
    },
    [ceilingDraftPoints, clearCeilingPlacementDraft, createCeilingOnCurrentLevel],
  )
  const handleZonePlacementPoint = useCallback(
    (point: WallPlanPoint) => {
      const lastPoint = zoneDraftPoints[zoneDraftPoints.length - 1]
      if (lastPoint && pointsEqual(lastPoint, point)) {
        return
      }

      const firstPoint = zoneDraftPoints[0]
      if (firstPoint && zoneDraftPoints.length >= 3 && isPointNearPlanPoint(point, firstPoint)) {
        createZoneOnCurrentLevel(zoneDraftPoints)
        clearDraft()
        return
      }

      // Every non-closing vertex is a "start" tick; closing the polygon above
      // creates the zone and fires the structure-build (end) cue.
      sfxEmitter.emit('sfx:structure-build-start')
      setZoneDraftPoints((currentPoints) => [...currentPoints, point])
      setCursorPoint(point)
    },
    [clearDraft, createZoneOnCurrentLevel, zoneDraftPoints, setCursorPoint],
  )
  const handleZonePlacementConfirm = useCallback(
    (point?: WallPlanPoint) => {
      const firstPoint = zoneDraftPoints[0]
      const lastPoint = zoneDraftPoints[zoneDraftPoints.length - 1]

      let nextPoints = zoneDraftPoints
      if (point) {
        const isClosingExistingPolygon = Boolean(
          firstPoint && zoneDraftPoints.length >= 3 && isPointNearPlanPoint(point, firstPoint),
        )
        const isDuplicatePoint = Boolean(lastPoint && pointsEqual(lastPoint, point))

        if (!(isClosingExistingPolygon || isDuplicatePoint)) {
          nextPoints = [...zoneDraftPoints, point]
        }
      }

      if (nextPoints.length < 3) {
        return
      }

      createZoneOnCurrentLevel(nextPoints)
      clearDraft()
    },
    [clearDraft, createZoneOnCurrentLevel, zoneDraftPoints],
  )

  const handleWallPlacementPoint = useCallback(
    (point: WallPlanPoint) => {
      if (!draftStart) {
        setDraftStart(point)
        setWallChainFirstVertex(point)
        setDraftEnd(point)
        setCursorPoint(point)
        return
      }

      if (!isSegmentLongEnough(draftStart, point)) {
        return
      }

      // The 3D wall tool's `grid:click` listener
      // (`packages/nodes/src/wall/tool.tsx`) owns the wall-create
      // call. `emitFloorplanGridEvent('click', …)` in
      // `useFloorplanBackgroundPlacement` fires it synchronously
      // just before this callback runs, so by the time we get here
      // the wall already exists in the scene. Committing here as
      // well used to double-create walls whenever the two snap
      // pipelines resolved endpoints ≥1e-6 apart (the duplicate
      // check compares exact endpoints).
      //
      // That 3D path is dead in 2D-only view — the canvas is
      // `display:none`, so the tool never commits. Mirror the slab /
      // ceiling 2D-only committers: create locally here, gated on the
      // view, so split / 3D keep their single-owner tool commit.
      const createdWall =
        useEditor.getState().viewMode === '2d' ? createWallOnCurrentLevel(draftStart, point) : null

      // Chain the next segment from the resolved commit endpoint (it may
      // have corner-snapped or split-adjusted): the wall we just made in
      // 2D-only, otherwise the 3D tool's published chain start. Both views
      // then draft from the same start.
      const publishedNextStart = useSegmentDraftChain.getState().wall
      const nextStart: WallPlanPoint = createdWall
        ? (createdWall.end as WallPlanPoint)
        : (publishedNextStart ?? point)

      if (
        useEditor.getState().getContinuation('wall') === 'single' ||
        (wallChainFirstVertex && isWithinWallJoinSnapRadius(nextStart, wallChainFirstVertex))
      ) {
        clearWallPlacementDraft()
        setCursorPoint(null)
        return
      }

      setDraftStart(nextStart)
      setDraftEnd(nextStart)
      setCursorPoint(nextStart)
    },
    [clearWallPlacementDraft, draftStart, wallChainFirstVertex, setDraftEnd, setCursorPoint],
  )
  const { getFloorplanHitIdAtPoint, getFloorplanSelectionIdsInBounds } = useFloorplanHitTesting({
    ceilingPolygons: displayCeilingPolygons,
    columnPolygons: floorplanColumnEntries,
    displaySlabPolygons,
    displayWallPolygons,
    floorplanElevatorEntries,
    floorplanItemEntries,
    floorplanOpeningHitTolerance,
    floorplanRoofEntries,
    floorplanStairEntries,
    floorplanWallHitTolerance,
    getOpeningCenterLine,
    isFloorplanItemContextActive,
    openingsPolygons,
    phase,
    toPoint2D,
  })
  // Wall-commit snap for the placement hook. Mirrors the move-preview branch:
  // it honours the Magnetic snap toggle so a click never snaps to geometry the
  // preview didn't (keeps 2D commit consistent with the preview and with 3D).
  const snapWallDraftPointMagnetic = useCallback(
    (args: {
      point: WallPlanPoint
      walls: WallNode[]
      start?: WallPlanPoint
      angleSnap?: boolean
      bypassSnap?: boolean
      step?: number
    }) => snapWallDraftPoint({ ...args, magnetic: isMagneticSnapActive() }),
    [],
  )
  const { handleBackgroundPlacementClick } = useFloorplanBackgroundPlacement({
    activePolygonDraftPoints,
    ceilingDraftPoints,
    clearFencePlacementDraft,
    clearRoofPlacementDraft,
    clearWallPlacementDraft,
    emitFloorplanGridEvent,
    fenceDraftStart,
    fences,
    findClosestWallPoint,
    floorplanOpeningLocalY,
    getSnappedFloorplanPoint,
    handleCeilingItemPlacementClick,
    handleCeilingPlacementPoint,
    handleSlabPlacementPoint,
    handleWallPlacementPoint,
    handleZonePlacementPoint,
    isCeilingBuildActive,
    isCeilingItemPlacementActive,
    isFenceBuildActive,
    // Exclude the door/window MOVE case: `isRegistryToolBuildActive` makes the
    // grid catch-all true for it, but the overlay owns its commit (its own
    // pointerup). Letting the catch-all emit `grid:click` here would consume
    // the commit click and fight the overlay.
    isFloorplanGridInteractionActive: isFloorplanGridInteractionActive && !isOpeningMoveActive,
    // Only the pure-build opening case (tool armed, no movingNode) commits via
    // the synthesized `wall:click`; the move case (community preset) is owned
    // by FloorplanRegistryMoveOverlay, which commits on its own pointerup.
    isOpeningPlacementActive: isOpeningBuildActive && !isOpeningMoveActive,
    isPolygonBuildActive,
    isRoofBuildActive,
    isSlabBuildActive,
    isWallBuildActive,
    isZoneBuildActive,
    levelId,
    roofDraftStart,
    setCursorPoint,
    setFenceDraftEnd,
    setFenceDraftStart,
    setRoofDraftEnd,
    setRoofDraftStart,
    snapPolygonDraftPoint,
    snapWallDraftPoint: snapWallDraftPointMagnetic,
    toPoint2D,
    walls,
    // World-axis grid snap so drafts land on the visible grid even
    // when the active building is rotated. The helper resolves the
    // active building's pose internally; this hook stays oblivious to
    // building rotation / position.
    worldGridSnap: snapBuildingLocalToWorldGrid,
  })

  const handleBackgroundClick = useCallback(
    (event: ReactMouseEvent<SVGSVGElement>) => {
      if (isPolygonBuildActive && event.detail >= 2) {
        return
      }

      const planPoint = getPlanPointFromClientPoint(event.clientX, event.clientY)
      if (!planPoint) {
        return
      }

      if (referenceScaleDraft) {
        event.preventDefault()
        event.stopPropagation()

        emitFloorplanGridEvent('click', getSnappedFloorplanPoint(planPoint), event)

        if (!referenceScaleDraft.start) {
          setReferenceScaleDraft({
            ...referenceScaleDraft,
            start: planPoint,
          })
          setCursorPoint(planPoint)
          return
        }

        const measuredLengthUnits = Math.hypot(
          planPoint[0] - referenceScaleDraft.start[0],
          planPoint[1] - referenceScaleDraft.start[1],
        )

        if (measuredLengthUnits < 1e-6) {
          return
        }

        setPendingReferenceScale({
          guideId: referenceScaleDraft.guideId,
          start: referenceScaleDraft.start,
          end: planPoint,
          measuredLengthUnits,
        })
        setReferenceScaleValue(formatNumber(measuredLengthUnits, 2))
        setReferenceScaleUnit(unit === 'imperial' ? 'feet' : 'meters')
        setReferenceScaleDraft(null)
        setCursorPoint(null)
        return
      }

      if (handleBackgroundPlacementClick(planPoint, event, draftStart)) {
        return
      }

      const modifierKeys = getSelectionModifierKeys(event)

      const backgroundSelection = resolveFloorplanBackgroundSelection({
        canSelectElementFloorplanGeometry,
        canSelectFloorplanZones,
        currentSelectedIds: useViewer.getState().selection.selectedIds,
        getFloorplanHitIdAtPoint,
        isWallBuildActive,
        modifierKeys,
        planPoint,
        structureLayer,
        toPoint2D,
        visibleZonePolygons,
      })

      if (backgroundSelection.handled) {
        setSelectedReferenceId(null)

        if (backgroundSelection.kind === 'select-zone') {
          setSelection({ zoneId: backgroundSelection.zoneId })
          return
        }

        if (backgroundSelection.kind === 'select-elements') {
          if (!(levelId && levelNode) || levelNode.type !== 'level') {
            setSelection({ selectedIds: backgroundSelection.selectedIds })
          } else {
            const { selection } = useViewer.getState()
            const nodes = useScene.getState().nodes
            const updates: Parameters<typeof setSelection>[0] = {
              selectedIds: backgroundSelection.selectedIds,
            }

            if (levelId !== selection.levelId) {
              updates.levelId = levelId
            }

            const parentNode = levelNode.parentId ? nodes[levelNode.parentId as AnyNodeId] : null
            if (parentNode?.type === 'building' && parentNode.id !== selection.buildingId) {
              updates.buildingId = parentNode.id
            }

            setSelection(updates)
          }
          return
        }

        if (backgroundSelection.kind === 'clear-zones') {
          setSelection({ zoneId: null })
          // Return to structure select (same as 3D grid click)
          useEditor.getState().setStructureLayer('elements')
          useEditor.getState().setMode('select')
          return
        }

        if (!backgroundSelection.preserveSelection) {
          setSelection({ selectedIds: [] })
        }
        return
      }
    },
    [
      draftStart,
      getPlanPointFromClientPoint,
      handleBackgroundPlacementClick,
      canSelectElementFloorplanGeometry,
      canSelectFloorplanZones,
      isPolygonBuildActive,
      isWallBuildActive,
      levelId,
      levelNode,
      referenceScaleDraft,
      setSelectedReferenceId,
      setSelection,
      structureLayer,
      getFloorplanHitIdAtPoint,
      unit,
      visibleZonePolygons,
      emitFloorplanGridEvent,
      setCursorPoint,
    ],
  )
  const handleSvgClick = useCallback(
    (event: ReactMouseEvent<SVGSVGElement>) => {
      if (floorplanNavigationClickSuppressedRef.current) {
        event.preventDefault()
        event.stopPropagation()
        floorplanNavigationClickSuppressedRef.current = false
        return
      }

      handleBackgroundClick(event)
    },
    [handleBackgroundClick],
  )
  const handleBackgroundDoubleClick = useCallback(
    (event: ReactMouseEvent<SVGSVGElement>) => {
      if (!(isPolygonDraftBuildActive && !isRoofBuildActive)) {
        return
      }

      const planPoint = getPlanPointFromClientPoint(event.clientX, event.clientY)
      if (!planPoint) {
        return
      }

      const angleSnap = activePolygonDraftPoints.length > 0 && isAngleSnapActive()
      const fallbackPoint = snapPolygonDraftPoint({
        point: planPoint,
        start: activePolygonDraftPoints[activePolygonDraftPoints.length - 1],
        angleSnap,
      })

      if (isCeilingBuildActive) {
        const snappedPoint = resolveCeilingPlanPointSnap({
          rawPoint: planPoint,
          fallbackPoint,
          levelId,
          align: !angleSnap,
        }).point
        emitFloorplanGridEvent('double-click', snappedPoint, event)
        handleCeilingPlacementConfirm(snappedPoint)
        return
      }

      if (isZoneBuildActive) {
        handleZonePlacementConfirm(fallbackPoint)
      } else {
        const snappedPoint = resolveSlabPlanPointSnap({
          rawPoint: planPoint,
          fallbackPoint,
          levelId,
          align: !angleSnap,
        }).point
        // Slab is registry-driven: forward the double-click so the 3D tool
        // commits the node (zone has no registry tool, so it commits locally).
        emitFloorplanGridEvent('double-click', snappedPoint, event)
        handleSlabPlacementConfirm(snappedPoint)
      }
    },
    [
      activePolygonDraftPoints,
      emitFloorplanGridEvent,
      handleCeilingPlacementConfirm,
      getPlanPointFromClientPoint,
      handleSlabPlacementConfirm,
      handleZonePlacementConfirm,
      isCeilingBuildActive,
      isPolygonDraftBuildActive,
      isRoofBuildActive,
      isZoneBuildActive,
      levelId,
    ],
  )

  const commitFloorplanSelection = useCallback(
    (nextSelectedIds: string[]) => {
      if (!(levelId && levelNode) || levelNode.type !== 'level') {
        setSelectedReferenceId(null)
        setSelection({ selectedIds: nextSelectedIds })
        return
      }

      const { selection } = useViewer.getState()
      const nodes = useScene.getState().nodes
      const updates: Parameters<typeof setSelection>[0] = {
        selectedIds: nextSelectedIds,
      }

      if (levelId !== selection.levelId) {
        updates.levelId = levelId
      }

      const parentNode = levelNode.parentId ? nodes[levelNode.parentId as AnyNodeId] : null
      if (parentNode?.type === 'building' && parentNode.id !== selection.buildingId) {
        updates.buildingId = parentNode.id
      }

      setSelectedReferenceId(null)
      setSelection(updates)
    },
    [levelId, levelNode, setSelectedReferenceId, setSelection],
  )

  const addFloorplanSelection = useCallback(
    (
      nextSelectedIds: string[],
      modifierKeys?: { meta: boolean; ctrl: boolean; shift: boolean },
    ) => {
      const shouldAppend = Boolean(modifierKeys?.meta || modifierKeys?.ctrl || modifierKeys?.shift)

      if (shouldAppend) {
        if (nextSelectedIds.length === 0) {
          return
        }

        const currentSelectedIds = useViewer.getState().selection.selectedIds
        commitFloorplanSelection(Array.from(new Set([...currentSelectedIds, ...nextSelectedIds])))
        return
      }

      commitFloorplanSelection(nextSelectedIds)
    },
    [commitFloorplanSelection],
  )

  const toggleFloorplanSelection = useCallback(
    (nodeId: string, modifierKeys?: { meta: boolean; ctrl: boolean; shift: boolean }) => {
      const shouldToggle = Boolean(modifierKeys?.meta || modifierKeys?.ctrl || modifierKeys?.shift)

      if (shouldToggle) {
        const currentSelectedIds = useViewer.getState().selection.selectedIds
        commitFloorplanSelection(
          currentSelectedIds.includes(nodeId)
            ? currentSelectedIds.filter((selectedId) => selectedId !== nodeId)
            : [...currentSelectedIds, nodeId],
        )
        return
      }

      commitFloorplanSelection([nodeId])
    },
    [commitFloorplanSelection],
  )

  const syncPreviewSelectedIds = useCallback(
    (nextSelectedIds: string[]) => {
      const currentPreviewSelectedIds = useViewer.getState().previewSelectedIds
      if (haveSameIds(currentPreviewSelectedIds, nextSelectedIds)) {
        return
      }

      setPreviewSelectedIds(nextSelectedIds)
    },
    [setPreviewSelectedIds],
  )

  const resetFloorplanScreenSelection = useCallback(() => {
    floorplanScreenSelectionRef.current = null
    hideScreenRectangleSelectionElement(floorplanScreenSelectionElementRef.current)
    syncPreviewSelectedIds([])

    if (floorplanScreenSelectionOwnsInputDraggingRef.current) {
      useViewer.getState().setInputDragging(false)
      floorplanScreenSelectionOwnsInputDraggingRef.current = false
    }
  }, [syncPreviewSelectedIds])

  const commitFloorplanScreenSelection = useCallback(
    (nextSelectedIds: string[], event: PointerEvent) => {
      const modifierKeys = getSelectionModifierKeys(event)
      const shouldAppend = modifierKeys.meta || modifierKeys.ctrl || modifierKeys.shift

      setSelectedReferenceId(null)

      if (phase === 'structure' && structureLayer === 'zones') {
        if (nextSelectedIds.length > 0) {
          setSelection({ zoneId: nextSelectedIds[0] as ZoneNodeType['id'] })
        } else if (!shouldAppend) {
          setSelection({ zoneId: null })
        }
        return
      }

      addFloorplanSelection(nextSelectedIds, modifierKeys)
    },
    [addFloorplanSelection, phase, setSelectedReferenceId, setSelection, structureLayer],
  )

  useEffect(() => {
    const element = createScreenRectangleSelectionElement()
    document.body.appendChild(element)
    floorplanScreenSelectionElementRef.current = element

    return () => {
      element.remove()
      floorplanScreenSelectionElementRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!isScreenSelectionToolActive) {
      resetFloorplanScreenSelection()
    }
  }, [isScreenSelectionToolActive, resetFloorplanScreenSelection])

  useEffect(() => {
    const updateDrag = (event: PointerEvent) => {
      const state = floorplanScreenSelectionRef.current
      if (!state || event.pointerId !== state.pointerId) {
        return
      }

      const viewer = useViewer.getState()
      if (
        !isScreenSelectionToolActive ||
        isBoxSelectPointerSuppressed(event) ||
        viewer.cameraDragging ||
        (viewer.inputDragging && !floorplanScreenSelectionOwnsInputDraggingRef.current)
      ) {
        markBoxSelectHandled()
        resetFloorplanScreenSelection()
        return
      }

      state.currentClientX = event.clientX
      state.currentClientY = event.clientY

      const dragDistance = Math.hypot(
        state.currentClientX - state.startClientX,
        state.currentClientY - state.startClientY,
      )

      if (!state.isDragging && dragDistance >= SCREEN_RECTANGLE_SELECTION_DRAG_THRESHOLD_PX) {
        state.isDragging = true
        floorplanScreenSelectionOwnsInputDraggingRef.current = true
        useViewer.getState().setInputDragging(true)
        markBoxSelectHandled()

        try {
          svgRef.current?.setPointerCapture(event.pointerId)
        } catch {}
      }

      if (!state.isDragging) {
        return
      }

      event.preventDefault()

      const svg = svgRef.current
      const element = floorplanScreenSelectionElementRef.current
      if (!(svg && element)) {
        resetFloorplanScreenSelection()
        return
      }

      const rect = normalizeScreenRect(
        state.startClientX,
        state.startClientY,
        state.currentClientX,
        state.currentClientY,
      )
      const clampedRect = intersectScreenRects(
        rect,
        screenRectFromDomRect(svg.getBoundingClientRect()),
      )

      if (!clampedRect) {
        hideScreenRectangleSelectionElement(element)
        syncPreviewSelectedIds([])
        return
      }

      updateScreenRectangleSelectionElement(element, clampedRect)
      syncPreviewSelectedIds(collectFloorplanScreenSelectionIds(clampedRect, svg))
    }

    const finishDrag = (event: PointerEvent) => {
      const state = floorplanScreenSelectionRef.current
      if (!state || event.pointerId !== state.pointerId) {
        return
      }

      if (
        isBoxSelectPointerSuppressed(event) ||
        (useViewer.getState().inputDragging &&
          !floorplanScreenSelectionOwnsInputDraggingRef.current)
      ) {
        markBoxSelectHandled()
        resetFloorplanScreenSelection()
        return
      }

      if (state.isDragging) {
        event.preventDefault()
        event.stopPropagation()
        markBoxSelectHandled()

        const svg = svgRef.current
        const rect = normalizeScreenRect(
          state.startClientX,
          state.startClientY,
          event.clientX,
          event.clientY,
        )
        const clampedRect = svg
          ? intersectScreenRects(rect, screenRectFromDomRect(svg.getBoundingClientRect()))
          : null
        const ids = svg && clampedRect ? collectFloorplanScreenSelectionIds(clampedRect, svg) : []

        commitFloorplanScreenSelection(ids, event)
        swallowNextFloorplanScreenSelectionClick()
      }

      try {
        svgRef.current?.releasePointerCapture(event.pointerId)
      } catch {}

      resetFloorplanScreenSelection()
    }

    const cancelDrag = (event: PointerEvent) => {
      const state = floorplanScreenSelectionRef.current
      if (!state || event.pointerId !== state.pointerId) {
        return
      }

      resetFloorplanScreenSelection()
    }

    window.addEventListener('pointermove', updateDrag, { passive: false })
    window.addEventListener('pointerup', finishDrag)
    window.addEventListener('pointercancel', cancelDrag)

    return () => {
      window.removeEventListener('pointermove', updateDrag)
      window.removeEventListener('pointerup', finishDrag)
      window.removeEventListener('pointercancel', cancelDrag)
      resetFloorplanScreenSelection()
    }
  }, [
    commitFloorplanScreenSelection,
    isScreenSelectionToolActive,
    resetFloorplanScreenSelection,
    syncPreviewSelectedIds,
  ])

  const handleGuideSelect = useCallback(
    (guideId: GuideNode['id']) => {
      setSelectedReferenceId(guideId)
      setSelection({ selectedIds: [], zoneId: null })
    },
    [setSelectedReferenceId, setSelection],
  )
  const handleGuideCornerPointerDown = useCallback(
    (
      guide: GuideNode,
      dimensions: GuideImageDimensions,
      corner: GuideCorner,
      event: ReactPointerEvent<SVGCircleElement>,
    ) => {
      if (event.button !== 0 || !canInteractWithGuides || guideUi[guide.id]?.locked === true) {
        return
      }

      const aspectRatio = dimensions.width / dimensions.height
      if (!(aspectRatio > 0)) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      setHoveredGuideCorner(null)
      handleGuideSelect(guide.id)

      const centerSvg = getGuideCenterSvgPoint(guide)
      const rotationSvg = getGuideSvgRotation(guide.rotation[1])
      const width = getGuideWidth(guide.scale)
      const height = getGuideHeight(width, aspectRatio)
      const [cornerOffsetX, cornerOffsetY] = getGuideCornerLocalOffset(width, height, corner)
      const shouldRotate = event.ctrlKey || event.metaKey

      guideInteractionRef.current = {
        pointerId: event.pointerId,
        guideId: guide.id,
        corner,
        mode: shouldRotate ? 'rotate' : 'resize',
        aspectRatio,
        centerSvg,
        oppositeCornerSvg: shouldRotate
          ? null
          : getGuideCornerSvgPoint(
              centerSvg,
              width,
              height,
              rotationSvg,
              oppositeGuideCorner[corner],
            ),
        pointerOffsetSvg: [0, 0],
        rotationSvg,
        cornerBaseAngle: Math.atan2(cornerOffsetY, cornerOffsetX),
        scale: guide.scale,
      }

      document.body.style.userSelect = 'none'
      document.body.style.cursor = shouldRotate
        ? getGuideRotateCursor(isDark)
        : getGuideResizeCursor(corner, rotationSvg)

      const nextDraft: GuideTransformDraft = {
        guideId: guide.id,
        position: [guide.position[0], guide.position[2]],
        scale: guide.scale,
        rotation: guide.rotation[1],
      }

      guideTransformDraftRef.current = nextDraft
      setGuideTransformDraft(nextDraft)
    },
    [canInteractWithGuides, guideUi, handleGuideSelect, isDark],
  )
  const handleGuideTranslateStart = useCallback(
    (guide: GuideNode, event: ReactPointerEvent<SVGRectElement>) => {
      if (
        event.button !== 0 ||
        !canInteractWithGuides ||
        selectedGuideId !== guide.id ||
        guideUi[guide.id]?.locked === true
      ) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const svgPoint = getSvgPointFromClientPoint(event.clientX, event.clientY)
      if (!svgPoint) {
        return
      }

      const centerSvg = getGuideCenterSvgPoint(guide)

      guideInteractionRef.current = {
        pointerId: event.pointerId,
        guideId: guide.id,
        corner: 'nw',
        mode: 'translate',
        aspectRatio: 1,
        centerSvg,
        oppositeCornerSvg: null,
        pointerOffsetSvg: subtractSvgPoints(svgPoint, centerSvg),
        rotationSvg: getGuideSvgRotation(guide.rotation[1]),
        cornerBaseAngle: 0,
        scale: guide.scale,
      }

      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'grabbing'

      const nextDraft: GuideTransformDraft = {
        guideId: guide.id,
        position: [guide.position[0], guide.position[2]],
        scale: guide.scale,
        rotation: guide.rotation[1],
      }

      guideTransformDraftRef.current = nextDraft
      setGuideTransformDraft(nextDraft)
    },
    [canInteractWithGuides, getSvgPointFromClientPoint, guideUi, selectedGuideId],
  )

  const handleSiteVertexPointerDown = useCallback(
    (siteId: SiteNode['id'], vertexIndex: number, event: ReactPointerEvent<SVGCircleElement>) => {
      if (event.button !== 0) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      setHoveredSiteHandleId(null)

      if (!(displaySitePolygon && displaySitePolygon.site.id === siteId)) {
        return
      }

      const vertexPoint = displaySitePolygon.polygon[vertexIndex]
      if (!vertexPoint) {
        return
      }

      if (useEditor.getState().phase !== 'site') {
        useEditor.setState({ catalogCategory: null, mode: 'select', phase: 'site', tool: null })
      }
      selectSiteFloorplanContext()

      const nextDraft = {
        siteId,
        polygon: displaySitePolygon.polygon.map(toWallPlanPoint),
      }
      siteBoundaryDraftRef.current = nextDraft
      setSiteBoundaryDraft(nextDraft)
      setSiteBoundaryLivePreview(siteId, nextDraft.polygon)
      useInteractionScope
        .getState()
        .begin({ kind: 'handle-drag', nodeId: siteId, handle: SITE_BOUNDARY_DRAG_LABEL })
      setSiteVertexDragState({
        pointerId: event.pointerId,
        siteId,
        vertexIndex,
      })
      setCursorPoint(toWallPlanPoint(vertexPoint))
    },
    [displaySitePolygon, setSiteBoundaryLivePreview, setCursorPoint],
  )
  const handleSiteVertexDoubleClick = useCallback(
    (
      siteId: SiteNode['id'],
      vertexIndex: number,
      event: ReactPointerEvent<SVGCircleElement> | ReactMouseEvent<SVGCircleElement>,
    ) => {
      if (event.button !== 0) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      if (!(site && site.id === siteId && (site.polygon?.points?.length ?? 0) > 3)) {
        return
      }

      clearSiteBoundaryInteraction()

      updateNode(siteId, {
        polygon: {
          type: 'polygon',
          points: site.polygon.points.filter((_, index) => index !== vertexIndex),
        },
      })
    },
    [clearSiteBoundaryInteraction, site, updateNode],
  )
  const handleSiteMidpointPointerDown = useCallback(
    (siteId: SiteNode['id'], edgeIndex: number, event: ReactPointerEvent<SVGCircleElement>) => {
      if (event.button !== 0) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      setHoveredSiteHandleId(null)

      if (!(displaySitePolygon && displaySitePolygon.site.id === siteId)) {
        return
      }

      const basePolygon = displaySitePolygon.polygon.map(toWallPlanPoint)
      const startPoint = basePolygon[edgeIndex]
      const endPoint = basePolygon[(edgeIndex + 1) % basePolygon.length]
      if (!(startPoint && endPoint)) {
        return
      }

      const insertedPoint: WallPlanPoint = [
        (startPoint[0] + endPoint[0]) / 2,
        (startPoint[1] + endPoint[1]) / 2,
      ]
      const insertIndex = edgeIndex + 1
      const nextPolygon = [
        ...basePolygon.slice(0, insertIndex),
        insertedPoint,
        ...basePolygon.slice(insertIndex),
      ]

      if (useEditor.getState().phase !== 'site') {
        useEditor.setState({ catalogCategory: null, mode: 'select', phase: 'site', tool: null })
      }
      selectSiteFloorplanContext()

      const nextDraft = {
        siteId,
        polygon: nextPolygon,
      }
      siteBoundaryDraftRef.current = nextDraft
      setSiteBoundaryDraft(nextDraft)
      setSiteBoundaryLivePreview(siteId, nextPolygon)
      useInteractionScope
        .getState()
        .begin({ kind: 'handle-drag', nodeId: siteId, handle: SITE_BOUNDARY_DRAG_LABEL })
      setSiteVertexDragState({
        pointerId: event.pointerId,
        siteId,
        vertexIndex: insertIndex,
      })
      setCursorPoint(insertedPoint)
    },
    [displaySitePolygon, setSiteBoundaryLivePreview, setCursorPoint],
  )

  const handlePointerLeave = useCallback(() => {
    if (
      !(
        panStateRef.current ||
        floorplanRotationStateRef.current ||
        wallEndpointDragRef.current ||
        siteVertexDragState
      )
    ) {
      setCursorPoint(null)
    }
    setHoveredSiteHandleId(null)
    if (hoveredWallIdRef.current) {
      emitFloorplanWallLeave(hoveredWallIdRef.current)
      hoveredWallIdRef.current = null
    }
  }, [emitFloorplanWallLeave, siteVertexDragState, setCursorPoint])

  // Lightweight flag that mirrors the conditions under which
  // FloorplanCursorIndicatorOverlay renders — used to gate cursor-position
  // tracking. Derived locally here (rather than duplicating the overlay's full
  // useMemos) so this handler doesn't need to know about catalogCategory.
  const hasFloorplanCursorIndicator =
    Boolean(movingOpeningType) ||
    (mode === 'build' && tool !== null) ||
    (mode === 'select' && floorplanSelectionTool === 'marquee' && structureLayer !== 'zones') ||
    mode === 'delete'

  const handleSvgPointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (
        hasFloorplanCursorIndicator &&
        !isSpacePanPressed &&
        !panStateRef.current &&
        !floorplanRotationStateRef.current &&
        !guideInteractionRef.current &&
        !elevatorResizeDragState &&
        !wallEndpointDragRef.current &&
        !siteVertexDragState
      ) {
        const rect = event.currentTarget.getBoundingClientRect()
        const nextPosition = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        }
        setFloorplanCursorPosition((currentPosition) =>
          currentPosition &&
          currentPosition.x === nextPosition.x &&
          currentPosition.y === nextPosition.y
            ? currentPosition
            : nextPosition,
        )
      } else {
        setFloorplanCursorPosition((currentPosition) =>
          currentPosition === null ? currentPosition : null,
        )
      }

      handlePointerMove(event)
    },
    [
      handlePointerMove,
      hasFloorplanCursorIndicator,
      isSpacePanPressed,
      elevatorResizeDragState,
      siteVertexDragState,
      setFloorplanCursorPosition,
    ],
  )

  const handleSvgPointerLeave = useCallback(() => {
    setFloorplanCursorPosition(null)
    setHoveredGuideCorner(null)
    handlePointerLeave()
  }, [handlePointerLeave, setFloorplanCursorPosition])

  const handleMarqueePointerDown = useCallback(
    (event: ReactPointerEvent<SVGRectElement>) => {
      if (event.button !== 0) {
        return
      }

      const planPoint = getPlanPointFromClientPoint(event.clientX, event.clientY)
      if (!planPoint) {
        return
      }
      const snappedPoint = getSnappedFloorplanPoint(planPoint)

      event.preventDefault()
      event.stopPropagation()
      const rect = svgRef.current?.getBoundingClientRect()
      if (rect) {
        setFloorplanCursorPosition({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        })
      }
      setCursorPoint(snappedPoint)
      floorplanMarqueeSnapPointRef.current = snappedPoint
      syncPreviewSelectedIds([])
      useFloorplanMarquee.getState().begin({
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPlanPoint: snappedPoint,
        currentPlanPoint: snappedPoint,
      })

      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [
      getPlanPointFromClientPoint,
      syncPreviewSelectedIds,
      setFloorplanCursorPosition,
      setCursorPoint,
    ],
  )

  const handleMarqueePointerMove = useCallback(
    (event: ReactPointerEvent<SVGRectElement>) => {
      const rect = svgRef.current?.getBoundingClientRect()
      if (rect) {
        setFloorplanCursorPosition({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        })
      }

      const marquee = useFloorplanMarquee.getState().drag
      if (marquee?.pointerId !== event.pointerId) {
        return
      }

      const planPoint = getPlanPointFromClientPoint(event.clientX, event.clientY)
      if (!planPoint) {
        return
      }
      const snappedPoint = getSnappedFloorplanPoint(planPoint)

      event.preventDefault()
      event.stopPropagation()
      setCursorPoint(snappedPoint)

      const dragDistance = Math.hypot(
        event.clientX - marquee.startClientX,
        event.clientY - marquee.startClientY,
      )

      if (
        dragDistance >= FLOORPLAN_MARQUEE_DRAG_THRESHOLD_PX &&
        floorplanMarqueeSnapPointRef.current &&
        !pointsEqual(floorplanMarqueeSnapPointRef.current, snappedPoint)
      ) {
        sfxEmitter.emit('sfx:grid-snap')
      }
      floorplanMarqueeSnapPointRef.current = snappedPoint

      if (dragDistance >= FLOORPLAN_MARQUEE_DRAG_THRESHOLD_PX) {
        const bounds = getFloorplanSelectionBounds(marquee.startPlanPoint, snappedPoint)
        syncPreviewSelectedIds(getFloorplanSelectionIdsInBounds(bounds))
      } else {
        syncPreviewSelectedIds([])
      }

      // Advances the moving corner in the marquee store — re-renders only the
      // marquee overlay leaf, never this panel.
      useFloorplanMarquee.getState().setCurrent(snappedPoint)
    },
    [
      getFloorplanSelectionIdsInBounds,
      getPlanPointFromClientPoint,
      syncPreviewSelectedIds,
      setFloorplanCursorPosition,
      setCursorPoint,
    ],
  )

  const handleMarqueePointerUp = useCallback(
    (event: ReactPointerEvent<SVGRectElement>) => {
      const marqueeState = useFloorplanMarquee.getState().drag
      if (!marqueeState || marqueeState.pointerId !== event.pointerId) {
        return
      }

      const rawEndPlanPoint =
        getPlanPointFromClientPoint(event.clientX, event.clientY) ?? marqueeState.currentPlanPoint
      const endPlanPoint = getSnappedFloorplanPoint(rawEndPlanPoint)
      const modifierKeys = getSelectionModifierKeys(event)
      const dragDistance = Math.hypot(
        event.clientX - marqueeState.startClientX,
        event.clientY - marqueeState.startClientY,
      )

      event.preventDefault()
      event.stopPropagation()

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }

      if (dragDistance >= FLOORPLAN_MARQUEE_DRAG_THRESHOLD_PX) {
        const bounds = getFloorplanSelectionBounds(marqueeState.startPlanPoint, endPlanPoint)
        const nextSelectedIds = getFloorplanSelectionIdsInBounds(bounds)
        addFloorplanSelection(nextSelectedIds, modifierKeys)
      } else {
        const hitId = getFloorplanHitIdAtPoint(rawEndPlanPoint)

        if (hitId) {
          toggleFloorplanSelection(hitId, modifierKeys)
        } else if (!(modifierKeys.meta || modifierKeys.ctrl || modifierKeys.shift)) {
          commitFloorplanSelection([])
        }
      }

      syncPreviewSelectedIds([])
      useFloorplanMarquee.getState().reset()
      floorplanMarqueeSnapPointRef.current = null
    },
    [
      addFloorplanSelection,
      commitFloorplanSelection,
      getFloorplanHitIdAtPoint,
      getFloorplanSelectionIdsInBounds,
      getPlanPointFromClientPoint,
      syncPreviewSelectedIds,
      toggleFloorplanSelection,
    ],
  )

  const handleMarqueePointerCancel = useCallback(
    (event: ReactPointerEvent<SVGRectElement>) => {
      if (useFloorplanMarquee.getState().drag?.pointerId !== event.pointerId) {
        return
      }

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }

      useFloorplanMarquee.getState().reset()
      setFloorplanCursorPosition(null)
      floorplanMarqueeSnapPointRef.current = null
      syncPreviewSelectedIds([])
      setCursorPoint(null)
    },
    [syncPreviewSelectedIds, setFloorplanCursorPosition, setCursorPoint],
  )

  useEffect(() => {
    if (!isMarqueeSelectionToolActive) {
      useFloorplanMarquee.getState().reset()
      floorplanMarqueeSnapPointRef.current = null
      syncPreviewSelectedIds([])
      if (mode === 'select') {
        setCursorPoint(null)
      }
      return
    }

    setFloorplanCursorPosition(null)
  }, [
    isMarqueeSelectionToolActive,
    mode,
    syncPreviewSelectedIds,
    setFloorplanCursorPosition,
    setCursorPoint,
  ])

  useEffect(() => {
    if (mode !== 'delete') {
      useViewer.getState().setHoveredId(null)
    }
  }, [mode])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) {
      return
    }

    const getFallbackClientPoint = () => {
      const rect = svg.getBoundingClientRect()
      return {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }
    }

    const handleNativeWheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()

      const widthFactor = Math.exp(event.deltaY * (event.ctrlKey ? 0.003 : 0.0015))
      zoomViewportAtClientPoint(event.clientX, event.clientY, widthFactor)
    }

    const handleGestureStart = (event: Event) => {
      const gestureEvent = event as GestureLikeEvent
      gestureScaleRef.current = gestureEvent.scale ?? 1
      event.preventDefault()
      event.stopPropagation()
    }

    const handleGestureChange = (event: Event) => {
      const gestureEvent = event as GestureLikeEvent
      const nextScale = gestureEvent.scale ?? 1
      const previousScale = gestureScaleRef.current || 1
      const widthFactor = previousScale / nextScale
      const fallbackClientPoint = getFallbackClientPoint()

      zoomViewportAtClientPoint(
        gestureEvent.clientX ?? fallbackClientPoint.clientX,
        gestureEvent.clientY ?? fallbackClientPoint.clientY,
        widthFactor,
      )

      gestureScaleRef.current = nextScale
      event.preventDefault()
      event.stopPropagation()
    }

    const handleGestureEnd = (event: Event) => {
      gestureScaleRef.current = 1
      event.preventDefault()
      event.stopPropagation()
    }

    svg.addEventListener('wheel', handleNativeWheel, { passive: false })
    svg.addEventListener('gesturestart', handleGestureStart, {
      passive: false,
    })
    svg.addEventListener('gesturechange', handleGestureChange, {
      passive: false,
    })
    svg.addEventListener('gestureend', handleGestureEnd, { passive: false })

    return () => {
      svg.removeEventListener('wheel', handleNativeWheel)
      svg.removeEventListener('gesturestart', handleGestureStart)
      svg.removeEventListener('gesturechange', handleGestureChange)
      svg.removeEventListener('gestureend', handleGestureEnd)
    }
  }, [zoomViewportAtClientPoint])

  const restoreGroundLevelStructureSelection = useCallback(() => {
    const sceneNodes = useScene.getState().nodes
    const nextBuildingId =
      currentBuildingId ??
      site?.children
        .map((child) => (typeof child === 'string' ? sceneNodes[child as AnyNodeId] : child))
        .find((node): node is BuildingNode => node?.type === 'building')?.id ??
      null

    const nextGroundLevelId =
      nextBuildingId && nextBuildingId === currentBuildingId
        ? (floorplanLevels.find((level) => level.level === 0)?.id ??
          floorplanLevels[0]?.id ??
          (levelNode?.type === 'level' ? levelNode.id : null))
        : (() => {
            if (!nextBuildingId) {
              return null
            }

            const buildingNode = sceneNodes[nextBuildingId]
            if (buildingNode?.type !== 'building') {
              return null
            }

            const buildingLevels = buildingNode.children
              .map((child) => (typeof child === 'string' ? sceneNodes[child as AnyNodeId] : child))
              .filter((node): node is LevelNode => node?.type === 'level')
              .sort((a, b) => a.level - b.level)

            return (
              buildingLevels.find((level) => level.level === 0)?.id ?? buildingLevels[0]?.id ?? null
            )
          })()

    setPhase('structure')
    setStructureLayer('elements')
    setMode('select')

    const nextSelection: Parameters<typeof setSelection>[0] = {
      selectedIds: [],
      zoneId: null,
    }

    if (nextBuildingId) {
      nextSelection.buildingId = nextBuildingId
    }

    if (nextGroundLevelId) {
      nextSelection.levelId = nextGroundLevelId
    }

    setSelection(nextSelection)
  }, [
    currentBuildingId,
    floorplanLevels,
    levelNode,
    setMode,
    setPhase,
    setSelection,
    setStructureLayer,
    site,
  ])
  const activeDraftAnchorPoint =
    referenceScaleDraft?.start ??
    draftStart ??
    fenceDraftStart ??
    roofDraftStart ??
    activePolygonDraftPoints[0] ??
    null
  const floorplanCursorColor =
    mode === 'delete'
      ? palette.deleteStroke
      : wallEndpointDraft
        ? palette.editCursor
        : activeDraftAnchorPoint
          ? palette.draftStroke
          : palette.cursor
  const floorplanNavigationCursor =
    isPanning || isRotatingFloorplan ? 'grabbing' : isSpacePanPressed ? 'grab' : null
  const isFloorplanNavigationOverlayVisible = isSpacePanPressed || isPanning || isRotatingFloorplan
  const pendingReferenceDisplayLength = Number(referenceScaleValue)
  const pendingReferenceRealLengthMeters =
    pendingReferenceScale && pendingReferenceDisplayLength > 0
      ? convertReferenceLengthToMeters(pendingReferenceDisplayLength, referenceScaleUnit)
      : null
  const pendingReferenceMetersPerUnit =
    pendingReferenceScale && pendingReferenceRealLengthMeters
      ? pendingReferenceRealLengthMeters / pendingReferenceScale.measuredLengthUnits
      : null
  const pendingReferenceImageScaleFactor =
    pendingReferenceScale && pendingReferenceRealLengthMeters
      ? pendingReferenceRealLengthMeters / pendingReferenceScale.measuredLengthUnits
      : null
  const referenceScaleInputError =
    referenceScaleValue.trim() === ''
      ? 'Enter the real length of the line.'
      : pendingReferenceDisplayLength > 0
        ? null
        : 'Length must be greater than 0.'
  return (
    <div
      className="pointer-events-auto flex h-full w-full flex-col overflow-hidden bg-background/95"
      onPointerEnter={() => setFloorplanHovered(true)}
      onPointerLeave={() => {
        setFloorplanHovered(false)
        setFloorplanCursorPosition(null)
      }}
      ref={containerRef}
    >
      <FloorplanSiteKeyHandler onRestoreGroundLevel={restoreGroundLevelStructureSelection} />
      <div className="relative min-h-0 flex-1" ref={viewportHostRef}>
        <FloorplanCursorIndicator
          cursorColor={floorplanCursorColor}
          floorplanSelectionTool={floorplanSelectionTool}
          indicatorBadgeOffsetX={FLOORPLAN_CURSOR_BADGE_OFFSET_X}
          indicatorBadgeOffsetY={FLOORPLAN_CURSOR_BADGE_OFFSET_Y}
          indicatorLineHeight={FLOORPLAN_CURSOR_INDICATOR_LINE_HEIGHT}
          isPanning={isPanning || isRotatingFloorplan}
          movingOpeningType={movingOpeningType}
        />
        {showGuides && canInteractWithGuides && selectedGuide && (
          <FloorplanGuideHandleHint
            anchor={guideHandleHintAnchor}
            isDarkMode={isDark}
            isMacPlatform={isMacPlatform}
            rotationModifierPressed={rotationModifierPressed}
          />
        )}
        {/* Floating Move / Duplicate / Delete buttons for registered
            kinds. All kinds are registry-driven now, so this is the
            only action menu the floor plan mounts. */}
        <FloorplanRegistryActionMenu />

        {(levelNode?.type === 'level' || hasAmbientBuildingLevel) &&
          (compassHost ? (
            createPortal(
              <FloorplanCompassButton
                northRotationDeg={floorplanUserRotationDeg}
                onAlignNorth={alignFloorplanViewToNorth}
              />,
              compassHost,
            )
          ) : (
            <FloorplanCompassButton
              northRotationDeg={floorplanUserRotationDeg}
              onAlignNorth={alignFloorplanViewToNorth}
            />
          ))}

        {referenceScaleDraft && (
          <div className="pointer-events-none absolute top-3 left-1/2 z-30 -translate-x-1/2 rounded-md border bg-background/95 px-3 py-2 text-center text-sm shadow-sm">
            {referenceScaleDraft.start
              ? 'Click the end of the known distance'
              : 'Click the start of a known distance'}
          </div>
        )}

        {pendingReferenceScale && (
          <form
            className="absolute top-1/2 left-1/2 z-40 w-[22rem] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-background/95 p-3.5 text-foreground shadow-2xl backdrop-blur-md"
            onSubmit={(event) => {
              event.preventDefault()
              handleReferenceScaleConfirm()
            }}
          >
            <div className="mb-3 flex items-start gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border bg-white/5">
                <Ruler className="h-4 w-4 text-foreground/80" />
              </div>
              <div className="min-w-0">
                <div className="font-medium text-sm">Set overlay scale</div>
                <div className="mt-0.5 text-muted-foreground text-xs leading-4">
                  Enter the real-world length of the line you just drew. The image will resize to
                  match it.
                </div>
              </div>
            </div>

            <div className="mb-3 rounded-xl border border-border/70 bg-white/5 px-3 py-2">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
                Drawn line
              </div>
              <div className="mt-1 font-medium text-sm">
                {formatMeasurement(pendingReferenceScale.measuredLengthUnits, unit)}
              </div>
            </div>

            <label className="block">
              <span className="mb-1.5 block font-medium text-muted-foreground text-xs">
                Real length
              </span>
              <div className="grid grid-cols-[1fr_8.25rem] gap-2">
                <input
                  aria-invalid={Boolean(referenceScaleInputError)}
                  className={cn(
                    'h-9 rounded-lg border bg-background px-3 text-sm outline-none transition focus:border-foreground/40',
                    referenceScaleInputError ? 'border-destructive/60' : 'border-border',
                  )}
                  inputMode="decimal"
                  onBlur={() => {
                    const value = Number(referenceScaleValue)
                    if (!(value > 0)) {
                      setReferenceScaleValue('0.0001')
                    }
                  }}
                  onChange={(event) => setReferenceScaleValue(event.target.value)}
                  step="any"
                  type="number"
                  value={referenceScaleValue}
                />
                <select
                  className="h-9 rounded-lg border border-border bg-background px-2 text-sm outline-none transition focus:border-foreground/40"
                  onChange={(event) =>
                    setReferenceScaleUnit(event.target.value as ReferenceScaleUnit)
                  }
                  value={referenceScaleUnit}
                >
                  <option value="meters">Meters</option>
                  <option value="centimeters">Centimeters</option>
                  <option value="feet">Feet</option>
                  <option value="inches">Inches</option>
                </select>
              </div>
              <span
                className={cn(
                  'mt-1.5 block text-xs',
                  referenceScaleInputError ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {referenceScaleInputError ??
                  'Any decimal works. Use the known real length, not the drawn value.'}
              </span>
            </label>

            <div className="mt-3 rounded-lg bg-muted/45 px-3 py-2 text-muted-foreground text-xs">
              {pendingReferenceImageScaleFactor
                ? `Image will scale ${formatNumber(pendingReferenceImageScaleFactor, 3)}x from the first point.`
                : 'Enter a length greater than 0.'}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="h-8 rounded-lg border border-border px-3 font-medium text-muted-foreground text-xs transition hover:bg-white/8 hover:text-foreground"
                onClick={() => setPendingReferenceScale(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="h-8 rounded-lg bg-foreground px-3 font-medium text-background text-xs transition hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!pendingReferenceMetersPerUnit}
                type="submit"
              >
                Save Scale
              </button>
            </div>
          </form>
        )}

        {levelNode?.type !== 'level' && !hasAmbientBuildingLevel ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-muted-foreground text-sm">
            Switch to a building level to view and edit the floorplan.
          </div>
        ) : isFloorplanOpen ? (
          // The panel stays mounted in 3D mode (display:none) to keep the
          // portalled compass + viewport state warm, but the heavy 2D scene
          // (registry layer → one InteractiveGeometry per node, geometry
          // renderer, handle layers) must NOT render/reconcile while hidden —
          // otherwise every scene/selection change in pure 3D re-rendered the
          // whole floorplan tree (profiler: 150–200ms on a wall-endpoint drag).
          // `isFloorplanOpen` is `viewMode !== '3d'`, so this still renders fully
          // in both 2D and split. Viewport state lives on the still-mounted
          // panel, so pan/zoom is preserved across the toggle.
          <svg
            className="h-full w-full touch-none"
            onClick={isMarqueeSelectionToolActive ? undefined : handleSvgClick}
            onContextMenu={(event) => event.preventDefault()}
            onDoubleClick={isMarqueeSelectionToolActive ? undefined : handleBackgroundDoubleClick}
            onPointerCancel={endFloorplanNavigation}
            onPointerDown={handlePointerDown}
            onPointerDownCapture={handleNavigationPointerDown}
            onPointerLeave={handleSvgPointerLeave}
            onPointerMove={handleSvgPointerMove}
            onPointerUp={endFloorplanNavigation}
            ref={svgRef}
            style={{
              cursor:
                floorplanNavigationCursor ?? (referenceScaleDraft ? 'crosshair' : EDITOR_CURSOR),
            }}
            viewBox={`${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`}
          >
            <defs>
              <pattern
                height={wallSelectionHatchSpacing}
                id={wallSelectionHatchId}
                patternUnits="userSpaceOnUse"
                width={wallSelectionHatchSpacing}
              >
                <line
                  stroke={palette.selectedStroke}
                  strokeOpacity={1}
                  strokeWidth={wallSelectionHatchStrokeWidth}
                  x1="0"
                  x2={wallSelectionHatchSpacing}
                  y1="0"
                  y2={wallSelectionHatchSpacing}
                />
              </pattern>
              <pattern
                height={wallSelectionHatchSpacing}
                id={slabSelectionHatchId}
                patternUnits="userSpaceOnUse"
                width={wallSelectionHatchSpacing}
              >
                <line
                  stroke={palette.selectedStroke}
                  strokeOpacity={0.78}
                  strokeWidth={slabSelectionHatchStrokeWidth}
                  x1="0"
                  x2={wallSelectionHatchSpacing}
                  y1="0"
                  y2={wallSelectionHatchSpacing}
                />
              </pattern>
            </defs>
            <rect
              fill={palette.surface}
              height={viewBox.height}
              width={viewBox.width}
              x={viewBox.minX}
              y={viewBox.minY}
            />

            <g
              data-floorplan-scene=""
              ref={floorplanSceneRef}
              transform={
                floorplanSceneRotationDeg !== 0 ? `rotate(${floorplanSceneRotationDeg})` : undefined
              }
            >
              <FloorplanGridLayer
                majorGridPath={majorGridPath}
                minorGridPath={minorGridPath}
                palette={palette}
                showGrid={showGrid}
              />

              {/* Dev-only: draw each wall's opening-snap hit area (the
                  capsule of points within the snap radius of its centerline).
                  Gated on the developer-menu toggle. Painted right after the
                  grid so the translucent capsules sit under the wall / opening
                  glyphs. */}
              <FloorplanVoronoiLayer />

              <FloorplanReferenceFloorLayer
                data={referenceFloorData}
                opacity={referenceFloorOpacity}
              />

              <FloorplanGuideLayer
                activeGuideInteractionGuideId={activeGuideInteractionGuideId}
                activeGuideInteractionMode={activeGuideInteractionMode}
                guides={displayGuides}
                guideUi={guideUi}
                isInteractive={canInteractWithGuides}
                onGuideSelect={handleGuideSelect}
                onGuideTranslateStart={handleGuideTranslateStart}
                selectedGuideId={selectedGuideId}
              />

              {/* Stair is fully registry-driven for committed nodes
                  (`def.floorplan` on the stair kind). The only thing left for
                  this view is the in-flight build preview, which lives outside
                  the scene graph (so `FloorplanRegistryLayer` can't see it).
                  `FloorplanStairBuildPreviewLayer` owns it as a leaf that
                  subscribes to the `useStairBuildPreview` store directly, so a
                  per-`grid:move` cursor update re-renders only that tiny layer
                  rather than this whole panel. */}
              <FloorplanStairBuildPreviewLayer isDeleteMode={isDeleteMode} palette={palette} />

              <FloorplanReferenceScaleLayer
                draft={referenceScaleDraft}
                guides={displayGuides}
                guideUi={guideUi}
                palette={palette}
                unit={unit}
                unitsPerPixel={floorplanUnitsPerPixel}
              />

              {isMarqueeSelectionToolActive && (
                <rect
                  fill="transparent"
                  height={viewBox.height}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  onDoubleClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  onPointerCancel={handleMarqueePointerCancel}
                  onPointerDown={handleMarqueePointerDown}
                  onPointerMove={handleMarqueePointerMove}
                  onPointerUp={handleMarqueePointerUp}
                  style={{ cursor: EDITOR_CURSOR }}
                  width={viewBox.width}
                  x={viewBox.minX}
                  y={viewBox.minY}
                />
              )}

              {/* Registry-driven floor-plan layer. Iterates kinds whose
                  NodeDefinition supplies a `floorplan` builder and renders
                  their SVG via <FloorplanGeometryRenderer>. Sits above the
                  legacy inline content so newly-registered kinds (shelf
                  today) overlay on top until their inline equivalent is
                  removed in their Phase 5 migration PR.

                  Wrapped in <FloorplanRenderProvider> so registry-driven
                  kinds receive the same themed palette / units-per-pixel
                  the legacy layers compute. The hatch pattern id is the
                  legacy wall hatch — kinds that opt into selection hatch
                  fills reuse this <defs> pattern via fill="url(...)". */}
              <FloorplanRenderProvider
                hatchPatternId={wallSelectionHatchId}
                palette={floorplanRegistryPalette}
                sceneRotationDeg={floorplanSceneRotationDeg}
                unitsPerPixel={floorplanUnitsPerPixel}
              >
                {/* Wrapped in a measured `<g>` so `fittedViewport` can
                    fit to just the painted node geometry — measuring the
                    whole rotation group would include the grid layer,
                    whose extent is derived from the current viewBox and
                    would create a measure→fit→measure loop. */}
                <g ref={floorplanContentRef}>
                  <FloorplanRegistryLayer />
                  {/* Faint footprint ghost of the node being placed by a
                      registry placement tool (e.g. column), following the
                      cursor. The 3D mesh preview is hidden in 2D, so this is
                      the only placement visual in the floor plan. See
                      `floorplan-placement-preview-layer.tsx`. */}
                  <FloorplanPlacementPreviewLayer />
                  {/* Bridge-wall ghost previews painted on top of the
                      registry layer (drag-time only); cleared by the
                      wall move's `commit()` so real bridges replace
                      them without a frame of overlap. See
                      `floorplan-wall-move-ghost-layer.tsx`. */}
                  <FloorplanWallMoveGhostLayer />
                </g>
              </FloorplanRenderProvider>
              {/* Cursor-driven placement ghost for movingNode when the
                  active kind is registry-driven. Renders via a portal
                  into the floor-plan scene <g> (the data-floorplan-scene
                  attribute below); see floorplan-registry-move-overlay.tsx. */}
              <FloorplanRegistryMoveOverlay />

              {/* Figma-style alignment guides published by the move
                  overlay during a free-translate drag. Sits above the
                  registry layer so the red lines and distance pills
                  paint on top of node geometry. */}
              <FloorplanAlignmentGuideLayer />

              <FloorplanSiteLayer
                isHighlighted={isSiteBoundaryHighlighted}
                palette={palette}
                sitePolygon={visibleSitePolygon}
              />

              <FloorplanPolygonHandleLayer
                edgeHandles={siteEdgeHandles}
                hoveredHandleId={hoveredSiteHandleId}
                midpointHandles={siteMidpointHandles}
                onHandleHoverChange={setHoveredSiteHandleId}
                onMidpointPointerDown={(nodeId, edgeIndex, event) =>
                  handleSiteMidpointPointerDown(nodeId as SiteNode['id'], edgeIndex, event)
                }
                onVertexDoubleClick={(nodeId, vertexIndex, event) =>
                  handleSiteVertexDoubleClick(nodeId as SiteNode['id'], vertexIndex, event)
                }
                onVertexPointerDown={(nodeId, vertexIndex, event) =>
                  handleSiteVertexPointerDown(nodeId as SiteNode['id'], vertexIndex, event)
                }
                palette={palette}
                unitsPerPixel={floorplanUnitsPerPixel}
                vertexHandles={siteVertexHandles}
              />

              <FloorplanSiteEdgeLabelLayer
                labelBackground={isDark ? '#0f172a' : '#ffffff'}
                labelText={isDark ? '#e2e8f0' : '#171717'}
                palette={palette}
                sceneRotationDeg={floorplanSceneRotationDeg}
                shouldShow={shouldShowSiteEdgeLabels}
                sitePolygon={visibleSitePolygon}
                unit={unit}
                unitsPerPixel={floorplanUnitsPerPixel}
              />

              {/* "Magnetic" wall-snap beacon — per-kind glyph at the active
                  draft / endpoint-move snap point. Same store + coord space as
                  the alignment guides. */}
              <FloorplanSnapBeaconLayer />

              <FloorplanMarqueeOverlay cursorColor={palette.cursor} />

              {/* This shared layer now carries only the per-CLICK draft anchors
                  (reference-scale start + committed polygon vertices). The
                  cursor-following draft geometry moved to the leaves below
                  (`FloorplanLinearDraftLayer` for wall/fence/roof,
                  `FloorplanDraftCursorLayer` for polygon previews), which read
                  the live END points from the draft store so a per-move update
                  never re-renders this panel. */}
              <FloorplanDraftLayer
                anchorFill={palette.anchor}
                draftAnchorPoints={[
                  ...(referenceScaleDraft?.start
                    ? [
                        {
                          x: toSvgX(referenceScaleDraft.start[0]),
                          y: toSvgY(referenceScaleDraft.start[1]),
                          isPrimary: true,
                        },
                      ]
                    : []),
                  ...activePolygonDraftPoints.map((point, index) => ({
                    x: toSvgX(point[0]),
                    y: toSvgY(point[1]),
                    isPrimary: index === 0,
                  })),
                ]}
                draftFill={palette.draftFill}
                draftPolygonPoints={null}
                draftStroke={palette.draftStroke}
                linearDraftSegment={null}
                polygonDraftClosingSegment={null}
                polygonDraftPolygonPoints={null}
                polygonDraftPolylinePoints={null}
                unitsPerPixel={floorplanUnitsPerPixel}
              />

              <FloorplanLinearDraftLayer
                draftFill={palette.draftFill}
                draftStroke={palette.draftStroke}
                fenceDraftStart={fenceDraftStart}
                isDark={isDark}
                isFenceBuildActive={isFenceBuildActive}
                isRoofBuildActive={isRoofBuildActive}
                isWallBuildActive={isWallBuildActive}
                levelId={levelId}
                measurementStroke={palette.measurementStroke}
                roofDraftStart={roofDraftStart}
                sceneRotationDeg={floorplanSceneRotationDeg}
                unit={unit}
                unitsPerPixel={floorplanUnitsPerPixel}
                wallDraftStart={draftStart}
                walls={walls}
              />

              {/* Wall / fence endpoint, wall curve, slab / ceiling /
                  zone vertex+midpoint+edge handles are all driven by the
                  registry's `def.floorplanAffordances` and rendered as
                  part of `FloorplanRegistryLayer`. The legacy handle
                  layers that lived here received empty handle arrays
                  post-migration and rendered nothing. */}

              {selectedGuide && showGuides && (
                <FloorplanGuideSelectionOverlay
                  guide={selectedGuide}
                  isDarkMode={isDark}
                  onCornerHoverChange={setHoveredGuideCorner}
                  onCornerPointerDown={handleGuideCornerPointerDown}
                  rotationModifierPressed={rotationModifierPressed}
                  showHandles={canInteractWithGuides && guideUi[selectedGuide.id]?.locked !== true}
                />
              )}

              <FloorplanDraftCursorLayer
                activePolygonDraftPoints={activePolygonDraftPoints}
                cursorColor={floorplanCursorColor}
                draftFill={palette.draftFill}
                draftStroke={palette.draftStroke}
                isPolygonDraftBuildActive={isPolygonDraftBuildActive}
                polygonDraftStroke={
                  isSlabBuildActive || isCeilingBuildActive ? palette.wallStroke : undefined
                }
                unitsPerPixel={floorplanUnitsPerPixel}
              />

              {activeDraftAnchorPoint && (
                <circle
                  cx={toSvgX(activeDraftAnchorPoint[0])}
                  cy={toSvgY(activeDraftAnchorPoint[1])}
                  fill={palette.anchor}
                  fillOpacity={0.95}
                  r={FLOORPLAN_DRAFT_ANCHOR_RADIUS_PX * floorplanUnitsPerPixel}
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </g>
            {isFloorplanNavigationOverlayVisible && (
              <rect
                fill="transparent"
                height={viewBox.height}
                pointerEvents="all"
                style={{ cursor: floorplanNavigationCursor ?? 'grab' }}
                width={viewBox.width}
                x={viewBox.minX}
                y={viewBox.minY}
              />
            )}
          </svg>
        ) : null}
      </div>
    </div>
  )
}
