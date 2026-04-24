'use client'

import { Icon } from '@iconify/react'
import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  type CeilingNode,
  buildFloorplanItemEntry,
  buildFloorplanStairEntry as buildSharedFloorplanStairEntry,
  calculateLevelMiters,
  collectLevelDescendants as collectSharedLevelDescendants,
  DoorNode,
  emitter,
  type FenceNode,
  getFloorplanWall as getSharedFloorplanWall,
  type GridEvent,
  type GuideNode,
  getWallChordFrame,
  getWallCurveFrameAt,
  getWallCurveLength,
  getWallMidpointHandlePoint,
  getWallPlanFootprint,
  type FloorplanNodeTransform as SharedFloorplanNodeTransform,
  type ItemNode,
  ItemNode as ItemNodeSchema,
  isCurvedWall,
  type LevelNode,
  loadAssetUrl,
  normalizeWallCurveOffset,
  type Point2D,
  type RoofNode,
  type RoofSegmentNode,
  rotatePlanVector as rotateSharedPlanVector,
  sceneRegistry,
  type SiteNode,
  SlabNode,
  type StairNode,
  StairNode as StairNodeSchema,
  type StairSegmentNode,
  StairSegmentNode as StairSegmentNodeSchema,
  sampleWallCenterline,
  useLiveTransforms,
  useScene,
  type WallNode,
  WindowNode,
  ZoneNode as ZoneNodeSchema,
  type ZoneNode as ZoneNodeType,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Command } from 'lucide-react'
import {
  memo,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { FloorplanActionMenuLayer as Editor2dFloorplanActionMenuLayer } from '../editor-2d/floorplan-action-menu-layer'
import { FloorplanCursorIndicatorOverlay as Editor2dFloorplanCursorIndicatorOverlay } from '../editor-2d/floorplan-cursor-indicator-overlay'
import { FloorplanDraftLayer } from '../editor-2d/renderers/floorplan-draft-layer'
import { FloorplanMarqueeLayer } from '../editor-2d/renderers/floorplan-marquee-layer'
import { sfxEmitter } from '../../lib/sfx-bus'
import { cn } from '../../lib/utils'
import useEditor, { type FloorplanSelectionTool } from '../../store/use-editor'
import {
  getFloorplanHitNodeId,
  getFloorplanSelectionIdsInBounds as getSelectionIdsInBoundsFromTool,
} from '../tools/floorplan/selection-tool'
import { snapToHalf } from '../tools/item/placement-math'
import {
  DEFAULT_STAIR_ATTACHMENT_SIDE,
  DEFAULT_STAIR_FILL_TO_FLOOR,
  DEFAULT_STAIR_HEIGHT,
  DEFAULT_STAIR_LENGTH,
  DEFAULT_STAIR_STEP_COUNT,
  DEFAULT_STAIR_THICKNESS,
  DEFAULT_STAIR_WIDTH,
} from '../tools/stair/stair-defaults'
import { snapFenceDraftPoint } from '../tools/fence/fence-drafting'
import {
  createWallOnCurrentLevel,
  isWallLongEnough,
  snapWallDraftPoint,
  WALL_GRID_STEP,
  type WallPlanPoint,
} from '../tools/wall/wall-drafting'
import { furnishTools } from '../ui/action-menu/furnish-tools'
import { tools as structureTools } from '../ui/action-menu/structure-tools'

import { PALETTE_COLORS } from '../ui/primitives/color-dot'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/primitives/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/primitives/tooltip'
import { NodeActionMenu } from './node-action-menu'

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
const FLOORPLAN_WALL_THICKNESS_SCALE = 1.18
const FLOORPLAN_MIN_VISIBLE_WALL_THICKNESS = 0.13
const FLOORPLAN_MAX_EXTRA_THICKNESS = 0.035
const FLOORPLAN_PANEL_LAYOUT_STORAGE_KEY = 'pascal-editor-floorplan-panel-layout'
const EMPTY_WALL_MITER_DATA = calculateLevelMiters([])
const DEFAULT_BUILDING_POSITION = [0, 0, 0] as const satisfies [number, number, number]
const EDITOR_CURSOR = "url('/cursor.svg') 4 2, default"
const FLOORPLAN_CURSOR_INDICATOR_LINE_HEIGHT = 18
const FLOORPLAN_CURSOR_BADGE_OFFSET_X = 14
const FLOORPLAN_CURSOR_BADGE_OFFSET_Y = 14
const FLOORPLAN_CURSOR_MARKER_CORE_RADIUS = 0.06
const FLOORPLAN_CURSOR_MARKER_GLOW_RADIUS = 0.2
const FLOORPLAN_MARQUEE_OUTLINE_WIDTH = 0.055
const FLOORPLAN_MARQUEE_GLOW_WIDTH = 0.14
const FLOORPLAN_HOVER_TRANSITION = 'opacity 180ms cubic-bezier(0.2, 0, 0, 1)'
const FLOORPLAN_WALL_HIT_STROKE_WIDTH = 18
const FLOORPLAN_WALL_HOVER_GLOW_STROKE_WIDTH = 18
const FLOORPLAN_WALL_HOVER_RING_STROKE_WIDTH = 8
const FLOORPLAN_OPENING_HIT_STROKE_WIDTH = 16
const FLOORPLAN_OPENING_STROKE_WIDTH = 0.05
const FLOORPLAN_OPENING_DETAIL_STROKE_WIDTH = 0.02
const FLOORPLAN_OPENING_DASHED_STROKE_WIDTH = 0.02
const FLOORPLAN_ENDPOINT_HIT_STROKE_WIDTH = 18
const FLOORPLAN_ENDPOINT_HOVER_GLOW_STROKE_WIDTH = 16
const FLOORPLAN_ENDPOINT_HOVER_RING_STROKE_WIDTH = 7
const FLOORPLAN_MARQUEE_DRAG_THRESHOLD_PX = 4
const FLOORPLAN_MEASUREMENT_OFFSET = 0.46
const FLOORPLAN_MEASUREMENT_EXTENSION_OVERSHOOT = 0.08
const FLOORPLAN_MEASUREMENT_LINE_WIDTH = 1.35
const FLOORPLAN_MEASUREMENT_LINE_OUTLINE_WIDTH = 0
const FLOORPLAN_MEASUREMENT_LINE_OPACITY = 0.95
const FLOORPLAN_MEASUREMENT_LINE_OUTLINE_OPACITY = 0
const FLOORPLAN_MEASUREMENT_LABEL_FONT_SIZE = 0.15
const FLOORPLAN_MEASUREMENT_LABEL_OPACITY = 0.98
const FLOORPLAN_MEASUREMENT_LABEL_STROKE_WIDTH = 0
const FLOORPLAN_MEASUREMENT_LABEL_GAP = 0.56
const FLOORPLAN_MEASUREMENT_LABEL_LINE_PADDING = 0.14
const FLOORPLAN_MEASUREMENT_EXTENSION_DASH = '0.08 0.12'
const FLOORPLAN_MEASUREMENT_END_TICK = 0.18
const FLOORPLAN_WALL_OUTER_MEASUREMENT_OFFSET = 0.34
const FLOORPLAN_WALL_INNER_MEASUREMENT_OFFSET = 0.24
const FLOORPLAN_WALL_OUTER_MEASUREMENT_STROKE = 'rgba(59, 130, 246, 0.95)'
const FLOORPLAN_WALL_OUTER_MEASUREMENT_TEXT = 'rgba(37, 99, 235, 0.98)'
const FLOORPLAN_WALL_OUTER_MEASUREMENT_EXTENSION = 'rgba(96, 165, 250, 0.9)'
const FLOORPLAN_WALL_INNER_MEASUREMENT_STROKE = 'rgba(96, 165, 250, 0.95)'
const FLOORPLAN_WALL_INNER_MEASUREMENT_TEXT = 'rgba(59, 130, 246, 0.98)'
const FLOORPLAN_WALL_INNER_MEASUREMENT_EXTENSION = 'rgba(147, 197, 253, 0.9)'
const FLOORPLAN_OPENING_MEASUREMENT_STROKE = 'rgba(249, 115, 22, 0.98)'
const FLOORPLAN_OPENING_MEASUREMENT_TEXT = 'rgba(234, 88, 12, 0.98)'
const FLOORPLAN_OPENING_MEASUREMENT_EXTENSION = 'rgba(251, 146, 60, 0.9)'
const FLOORPLAN_ITEM_CLEARANCE_MAX_DISTANCE = 12
const FLOORPLAN_ITEM_CLEARANCE_MIN_DISTANCE = 0.05
const FLOORPLAN_ITEM_CLEARANCE_EDGE_PARALLEL_THRESHOLD = 0.65
const FLOORPLAN_ACTION_MENU_HORIZONTAL_PADDING = 60
const FLOORPLAN_ACTION_MENU_MIN_ANCHOR_Y = 56
const FLOORPLAN_ACTION_MENU_OFFSET_Y = 10
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
const FLOORPLAN_GUIDE_ROTATION_SNAP_DEGREES = 45
const FLOORPLAN_GUIDE_ROTATION_FINE_SNAP_DEGREES = 1
const FLOORPLAN_SITE_COLOR = '#10b981'
const FLOORPLAN_NODE_FOOTPRINT_STROKE_WIDTH = FLOORPLAN_OPENING_STROKE_WIDTH / 2
const FLOORPLAN_NODE_FOOTPRINT_CROSS_STROKE_WIDTH = FLOORPLAN_NODE_FOOTPRINT_STROKE_WIDTH * 0.7
const FLOORPLAN_STAIR_OUTLINE_BAND_THICKNESS = FLOORPLAN_OPENING_STROKE_WIDTH
const FLOORPLAN_STAIR_OUTLINE_MAX_FRACTION = 0.18
const FLOORPLAN_STAIR_TREAD_BAND_THICKNESS = FLOORPLAN_OPENING_STROKE_WIDTH * 0.82
const FLOORPLAN_STAIR_TREAD_MIN_THICKNESS = FLOORPLAN_OPENING_DETAIL_STROKE_WIDTH * 1.5
const FLOORPLAN_STAIR_ARROW_BAND_THICKNESS = FLOORPLAN_STAIR_TREAD_BAND_THICKNESS
const FLOORPLAN_STAIR_ARROW_HEAD_MIN_SIZE = 0.14
const FLOORPLAN_STAIR_ARROW_HEAD_MAX_SIZE = 0.24
type FloorplanViewport = {
  centerX: number
  centerY: number
  width: number
}

function floorplanViewportEquals(a: FloorplanViewport | null, b: FloorplanViewport | null) {
  if (a === b) return true
  if (!(a && b)) return false
  return a.centerX === b.centerX && a.centerY === b.centerY && a.width === b.width
}

type SvgPoint = {
  x: number
  y: number
}

type PanState = {
  pointerId: number
  clientX: number
  clientY: number
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

type FloorplanMarqueeState = {
  pointerId: number
  startClientX: number
  startClientY: number
  startPlanPoint: WallPlanPoint
  currentPlanPoint: WallPlanPoint
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

const GUIDE_CORNERS = ['nw', 'ne', 'se', 'sw'] as const

type GuideCorner = (typeof GUIDE_CORNERS)[number]

type GuideInteractionMode = 'resize' | 'rotate' | 'translate'

type GuideTransformDraft = {
  guideId: GuideNode['id']
  position: WallPlanPoint
  scale: number
  rotation: number
}

type GuideHandleHintAnchor = {
  x: number
  y: number
  directionX: number
  directionY: number
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

type SlabBoundaryDraft = {
  slabId: SlabNode['id']
  polygon: WallPlanPoint[]
}

type SlabVertexDragState = {
  pointerId: number
  slabId: SlabNode['id']
  vertexIndex: number
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

type ZoneBoundaryDraft = {
  zoneId: ZoneNodeType['id']
  polygon: WallPlanPoint[]
}

type ZoneVertexDragState = {
  pointerId: number
  zoneId: ZoneNodeType['id']
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

type FloorplanNodeTransform = {
  position: Point2D
  rotation: number
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
  item: ItemNode
  points: string
  polygon: Point2D[]
}

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

function getSelectionModifierKeys(event?: { metaKey?: boolean; ctrlKey?: boolean }) {
  return {
    meta: Boolean(event?.metaKey),
    ctrl: Boolean(event?.ctrlKey),
  }
}

function toPoint2D(point: WallPlanPoint): Point2D {
  return { x: point[0], y: point[1] }
}

function toWallPlanPoint(point: Point2D): WallPlanPoint {
  return [point.x, point.y]
}

function toSvgX(value: number): number {
  return -value
}

function toSvgY(value: number): number {
  return -value
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
    rotation: normalizeAngle(-interaction.rotationSvg),
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
    rotation: normalizeAngle(-interaction.rotationSvg),
  }
}

function buildGuideRotationDraft(
  interaction: GuideInteractionState,
  pointerSvg: SvgPoint,
  useFineIncrement: boolean,
): GuideTransformDraft {
  const pointerVector = subtractSvgPoints(pointerSvg, interaction.centerSvg)

  if (pointerVector[0] ** 2 + pointerVector[1] ** 2 <= 1e-6) {
    return {
      guideId: interaction.guideId,
      position: toPlanPointFromSvgPoint(interaction.centerSvg),
      scale: interaction.scale,
      rotation: normalizeAngle(-interaction.rotationSvg),
    }
  }

  const rawRotationSvg =
    Math.atan2(pointerVector[1], pointerVector[0]) - interaction.cornerBaseAngle
  const snappedRotationSvg = snapAngleToIncrement(
    rawRotationSvg,
    useFineIncrement
      ? FLOORPLAN_GUIDE_ROTATION_FINE_SNAP_DEGREES
      : FLOORPLAN_GUIDE_ROTATION_SNAP_DEGREES,
  )

  return {
    guideId: interaction.guideId,
    position: toPlanPointFromSvgPoint(interaction.centerSvg),
    scale: interaction.scale,
    rotation: normalizeAngle(-snappedRotationSvg),
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

function getRaySegmentIntersection(
  origin: Point2D,
  direction: Point2D,
  segmentStart: Point2D,
  segmentEnd: Point2D,
) {
  const segmentVector = {
    x: segmentEnd.x - segmentStart.x,
    y: segmentEnd.y - segmentStart.y,
  }
  const denominator = crossPlanVectors(direction, segmentVector)

  if (Math.abs(denominator) <= 1e-9) {
    return null
  }

  const delta = {
    x: segmentStart.x - origin.x,
    y: segmentStart.y - origin.y,
  }
  const rayDistance = crossPlanVectors(delta, segmentVector) / denominator
  const segmentT = crossPlanVectors(delta, direction) / denominator

  if (rayDistance < 0 || segmentT < 0 || segmentT > 1) {
    return null
  }

  return {
    point: {
      x: origin.x + direction.x * rayDistance,
      y: origin.y + direction.y * rayDistance,
    },
    rayDistance,
  }
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

function formatPolygonPath(points: Point2D[], holes: Point2D[][] = []): string {
  const formatSubpath = (subpathPoints: Point2D[]) => {
    const [firstPoint, ...restPoints] = subpathPoints
    if (!firstPoint) {
      return null
    }

    const firstSvgPoint = toSvgPoint(firstPoint)

    return [
      `M ${firstSvgPoint.x} ${firstSvgPoint.y}`,
      ...restPoints.map((point) => {
        const svgPoint = toSvgPoint(point)
        return `L ${svgPoint.x} ${svgPoint.y}`
      }),
      'Z',
    ].join(' ')
  }

  return [points, ...holes].map(formatSubpath).filter(Boolean).join(' ')
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

function getFloorplanActionMenuPosition(
  points: Point2D[],
  viewBox: { minX: number; minY: number; width: number; height: number },
  surfaceSize: { width: number; height: number },
) {
  if (points.length === 0) {
    return null
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const point of points) {
    const svgPoint = toSvgPoint(point)
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

function interpolatePlanPoint(start: Point2D, end: Point2D, t: number): Point2D {
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  }
}

function getPlanPointDistance(start: Point2D, end: Point2D): number {
  return Math.hypot(end.x - start.x, end.y - start.y)
}

function movePlanPointTowards(start: Point2D, end: Point2D, distance: number): Point2D {
  const totalDistance = getPlanPointDistance(start, end)
  if (totalDistance <= Number.EPSILON || distance <= 0) {
    return start
  }

  return interpolatePlanPoint(start, end, Math.min(1, distance / totalDistance))
}

function getFloorplanStairSegmentCenterLine(polygon: Point2D[]): FloorplanLineSegment | null {
  if (polygon.length < 4) {
    return null
  }

  const [backLeft, backRight, frontRight, frontLeft] = polygon

  return {
    start: interpolatePlanPoint(backLeft!, backRight!, 0.5),
    end: interpolatePlanPoint(frontLeft!, frontRight!, 0.5),
  }
}

function getFloorplanStairInnerPolygon(polygon: Point2D[]): Point2D[] {
  if (polygon.length < 4) {
    return polygon
  }

  const [backLeft, backRight, frontRight, frontLeft] = polygon
  const outerWidth = getPlanPointDistance(backLeft!, backRight!)
  const outerLength = getPlanPointDistance(backLeft!, frontLeft!)
  const widthInset = Math.min(
    FLOORPLAN_STAIR_OUTLINE_BAND_THICKNESS,
    outerWidth * FLOORPLAN_STAIR_OUTLINE_MAX_FRACTION,
  )
  const lengthInset = Math.min(
    FLOORPLAN_STAIR_OUTLINE_BAND_THICKNESS,
    outerLength * FLOORPLAN_STAIR_OUTLINE_MAX_FRACTION,
  )

  const insetBackLeft = movePlanPointTowards(backLeft!, frontLeft!, lengthInset)
  const insetBackRight = movePlanPointTowards(backRight!, frontRight!, lengthInset)
  const insetFrontLeft = movePlanPointTowards(frontLeft!, backLeft!, lengthInset)
  const insetFrontRight = movePlanPointTowards(frontRight!, backRight!, lengthInset)

  const innerPolygon = [
    movePlanPointTowards(insetBackLeft, insetBackRight, widthInset),
    movePlanPointTowards(insetBackRight, insetBackLeft, widthInset),
    movePlanPointTowards(insetFrontRight, insetFrontLeft, widthInset),
    movePlanPointTowards(insetFrontLeft, insetFrontRight, widthInset),
  ]

  const innerWidth = getPlanPointDistance(innerPolygon[0]!, innerPolygon[1]!)
  const innerLength = getPlanPointDistance(innerPolygon[0]!, innerPolygon[3]!)

  return innerWidth > 0.06 && innerLength > 0.06 ? innerPolygon : polygon
}

function getFloorplanStairTreadLines(
  segment: StairSegmentNode,
  innerPolygon: Point2D[],
): FloorplanLineSegment[] {
  if (segment.segmentType !== 'stair' || segment.stepCount <= 1 || innerPolygon.length < 4) {
    return []
  }

  const [backLeft, backRight, frontRight, frontLeft] = innerPolygon
  const treadLines: FloorplanLineSegment[] = []

  for (let stepIndex = 1; stepIndex < segment.stepCount; stepIndex += 1) {
    const t = stepIndex / segment.stepCount
    treadLines.push({
      start: interpolatePlanPoint(backLeft!, frontLeft!, t),
      end: interpolatePlanPoint(backRight!, frontRight!, t),
    })
  }

  return treadLines
}

function getThickPlanLinePolygon(line: FloorplanLineSegment, thickness: number): Point2D[] {
  const dx = line.end.x - line.start.x
  const dy = line.end.y - line.start.y
  const length = Math.hypot(dx, dy)

  if (length <= Number.EPSILON || thickness <= 0) {
    return [line.start, line.end, line.end, line.start]
  }

  const halfThickness = thickness / 2
  const normalX = (-dy / length) * halfThickness
  const normalY = (dx / length) * halfThickness

  return [
    { x: line.start.x + normalX, y: line.start.y + normalY },
    { x: line.end.x + normalX, y: line.end.y + normalY },
    { x: line.end.x - normalX, y: line.end.y - normalY },
    { x: line.start.x - normalX, y: line.start.y - normalY },
  ]
}

function getPolylineBandPolygons(points: Point2D[], thickness: number): FloorplanPolygonEntry[] {
  if (points.length < 2 || thickness <= 0) {
    return []
  }

  const polygons: FloorplanPolygonEntry[] = []

  for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
    const start = points[pointIndex - 1]!
    const end = points[pointIndex]!

    if (getPlanPointDistance(start, end) <= Number.EPSILON) {
      continue
    }

    const polygon = getThickPlanLinePolygon({ start, end }, thickness)
    polygons.push({
      points: formatPolygonPoints(polygon),
      polygon,
    })
  }

  return polygons
}

function getArcPlanPoint(center: Point2D, radius: number, angle: number): Point2D {
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  }
}

function buildSvgArcPath(center: Point2D, radius: number, startAngle: number, endAngle: number) {
  const start = getArcPlanPoint(center, radius, startAngle)
  const end = getArcPlanPoint(center, radius, endAngle)
  const delta = endAngle - startAngle
  const largeArcFlag = Math.abs(delta) > Math.PI ? 1 : 0
  const sweepFlag = delta >= 0 ? 1 : 0

  return `M ${toSvgX(start.x)} ${toSvgY(start.y)} A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${toSvgX(end.x)} ${toSvgY(end.y)}`
}

function buildSvgAnnularSectorPath(
  center: Point2D,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
) {
  const outerStart = getArcPlanPoint(center, outerRadius, startAngle)
  const outerEnd = getArcPlanPoint(center, outerRadius, endAngle)
  const innerEnd = getArcPlanPoint(center, innerRadius, endAngle)
  const innerStart = getArcPlanPoint(center, innerRadius, startAngle)
  const delta = endAngle - startAngle
  const largeArcFlag = Math.abs(delta) > Math.PI ? 1 : 0
  const sweepFlag = delta >= 0 ? 1 : 0
  const reverseSweepFlag = sweepFlag ? 0 : 1

  return [
    `M ${toSvgX(outerStart.x)} ${toSvgY(outerStart.y)}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} ${sweepFlag} ${toSvgX(outerEnd.x)} ${toSvgY(outerEnd.y)}`,
    `L ${toSvgX(innerEnd.x)} ${toSvgY(innerEnd.y)}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} ${reverseSweepFlag} ${toSvgX(innerStart.x)} ${toSvgY(innerStart.y)}`,
    'Z',
  ].join(' ')
}

function getNormalizedFloorplanStairSweepAngle(stair: StairNode) {
  const stairType = stair.stairType ?? 'straight'
  const baseSweepAngle =
    stair.sweepAngle ?? (stairType === 'spiral' ? Math.PI * 2 : Math.PI / 2)

  if (Math.abs(baseSweepAngle) >= Math.PI * 2) {
    return Math.sign(baseSweepAngle || 1) * (Math.PI * 2 - 0.001)
  }

  return baseSweepAngle
}

function getFloorplanCurvedStairHitPolygon(stair: StairNode): Point2D[] {
  const stairType = stair.stairType ?? 'straight'
  const sweepAngle = getNormalizedFloorplanStairSweepAngle(stair)
  const startAngle = stair.rotation - sweepAngle / 2
  const endAngle = startAngle + sweepAngle
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

function buildFloorplanArrowHead(
  point: Point2D,
  angle: number,
  size: number,
): FloorplanPolygonEntry {
  const left = {
    x: point.x - size * Math.cos(angle - Math.PI / 6),
    y: point.y - size * Math.sin(angle - Math.PI / 6),
  }
  const right = {
    x: point.x - size * Math.cos(angle + Math.PI / 6),
    y: point.y - size * Math.sin(angle + Math.PI / 6),
  }

  return {
    points: formatPolygonPoints([point, left, right]),
    polygon: [point, left, right],
  }
}

function getFloorplanStairTreadThickness(segment: StairSegmentNode, innerPolygon: Point2D[]) {
  if (segment.segmentType !== 'stair' || segment.stepCount <= 1 || innerPolygon.length < 4) {
    return 0
  }

  const innerWidth = getPlanPointDistance(innerPolygon[0]!, innerPolygon[1]!)
  const innerLength = getPlanPointDistance(innerPolygon[0]!, innerPolygon[3]!)
  const treadRun = innerLength / Math.max(segment.stepCount, 1)
  return clamp(
    Math.min(FLOORPLAN_STAIR_TREAD_BAND_THICKNESS, innerWidth * 0.12, treadRun * 0.44),
    FLOORPLAN_STAIR_TREAD_MIN_THICKNESS,
    FLOORPLAN_STAIR_TREAD_BAND_THICKNESS,
  )
}

function getFloorplanStairTreadBars(
  segment: StairSegmentNode,
  innerPolygon: Point2D[],
  treadThickness = getFloorplanStairTreadThickness(segment, innerPolygon),
): FloorplanPolygonEntry[] {
  const treadLines = getFloorplanStairTreadLines(segment, innerPolygon)
  if (treadLines.length === 0 || treadThickness <= 0) {
    return []
  }

  return treadLines.map((line) => {
    const polygon = getThickPlanLinePolygon(line, treadThickness)
    return {
      points: formatPolygonPoints(polygon),
      polygon,
    }
  })
}

type FloorplanStairArrowSide = 'back' | 'front' | 'left' | 'right'

function getFloorplanStairSegmentCenterPoint(segment: FloorplanStairSegmentEntry): Point2D | null {
  if (segment.centerLine) {
    return interpolatePlanPoint(segment.centerLine.start, segment.centerLine.end, 0.5)
  }

  if (segment.polygon.length < 4) {
    return null
  }

  const [backLeft, backRight, frontRight, frontLeft] = segment.polygon

  return {
    x: (backLeft!.x + backRight!.x + frontRight!.x + frontLeft!.x) / 4,
    y: (backLeft!.y + backRight!.y + frontRight!.y + frontLeft!.y) / 4,
  }
}

function getFloorplanStairSegmentSidePoint(
  segment: FloorplanStairSegmentEntry,
  side: FloorplanStairArrowSide,
): Point2D | null {
  if (segment.polygon.length < 4) {
    return null
  }

  const [backLeft, backRight, frontRight, frontLeft] = segment.polygon

  switch (side) {
    case 'back':
      return interpolatePlanPoint(backLeft!, backRight!, 0.5)
    case 'front':
      return interpolatePlanPoint(frontLeft!, frontRight!, 0.5)
    case 'left':
      return interpolatePlanPoint(backLeft!, frontLeft!, 0.5)
    case 'right':
      return interpolatePlanPoint(backRight!, frontRight!, 0.5)
  }
}

function getFloorplanStairExitSide(
  nextSegment: StairSegmentNode | undefined,
): FloorplanStairArrowSide {
  if (!nextSegment) {
    return 'front'
  }

  // `attachmentSide` describes the next segment's turn direction. The floorplan transform
  // attaches `left` turns to the previous segment's positive local X edge and `right` turns
  // to the negative local X edge, so the arrow needs to mirror that convention here.
  if (nextSegment.attachmentSide === 'left') {
    return 'right'
  }
  if (nextSegment.attachmentSide === 'right') {
    return 'left'
  }

  return 'front'
}

function appendUniquePlanPoint(points: Point2D[], point: Point2D | null) {
  if (!point) {
    return
  }

  const lastPoint = points[points.length - 1]
  if (lastPoint && getPlanPointDistance(lastPoint, point) <= 0.001) {
    return
  }

  points.push(point)
}

function buildFloorplanStairArrow(
  segments: FloorplanStairSegmentEntry[],
): FloorplanStairArrowEntry | null {
  const rawPoints: Point2D[] = []

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex]!
    const nextSegment = segments[segmentIndex + 1]?.segment
    const entryPoint = getFloorplanStairSegmentSidePoint(segment, 'back')
    const exitPoint = getFloorplanStairSegmentSidePoint(
      segment,
      getFloorplanStairExitSide(nextSegment),
    )

    if (!(entryPoint && exitPoint)) {
      continue
    }

    appendUniquePlanPoint(rawPoints, entryPoint)

    const isStraightSegment = getPlanPointDistance(entryPoint, exitPoint) <= 0.001
    if (isStraightSegment) {
      continue
    }

    const exitSide = getFloorplanStairExitSide(nextSegment)
    if (exitSide === 'front') {
      appendUniquePlanPoint(rawPoints, exitPoint)
      continue
    }

    appendUniquePlanPoint(rawPoints, getFloorplanStairSegmentCenterPoint(segment))
    appendUniquePlanPoint(rawPoints, exitPoint)
  }

  if (rawPoints.length < 2) {
    return null
  }

  const firstPoint = rawPoints[0]!
  const secondPoint = rawPoints[1]!
  const beforeLastPoint = rawPoints[rawPoints.length - 2]!
  const lastPoint = rawPoints[rawPoints.length - 1]!
  const firstLength = getPlanPointDistance(firstPoint, secondPoint)
  const lastLength = getPlanPointDistance(beforeLastPoint, lastPoint)

  if (firstLength <= Number.EPSILON || lastLength <= Number.EPSILON) {
    return null
  }

  const polyline = [
    movePlanPointTowards(firstPoint, secondPoint, Math.min(0.24, firstLength * 0.18)),
    ...rawPoints.slice(1, -1),
    movePlanPointTowards(lastPoint, beforeLastPoint, Math.min(0.3, lastLength * 0.22)),
  ]
  const arrowTailPoint = polyline[polyline.length - 2]
  const arrowTip = polyline[polyline.length - 1]

  if (!(arrowTailPoint && arrowTip)) {
    return null
  }

  const arrowBodyLength = getPlanPointDistance(arrowTailPoint, arrowTip)
  if (arrowBodyLength <= Number.EPSILON) {
    return null
  }

  const arrowHeadLength = clamp(
    arrowBodyLength * 0.72,
    FLOORPLAN_STAIR_ARROW_HEAD_MIN_SIZE,
    FLOORPLAN_STAIR_ARROW_HEAD_MAX_SIZE,
  )
  const arrowHeadBase = movePlanPointTowards(arrowTip, arrowTailPoint, arrowHeadLength)
  const directionX = arrowTip.x - arrowHeadBase.x
  const directionY = arrowTip.y - arrowHeadBase.y
  const directionLength = Math.hypot(directionX, directionY)

  if (directionLength <= Number.EPSILON) {
    return null
  }

  const normalX = -directionY / directionLength
  const normalY = directionX / directionLength
  const arrowHeadHalfWidth = arrowHeadLength * 0.34

  return {
    head: [
      arrowTip,
      {
        x: arrowHeadBase.x + normalX * arrowHeadHalfWidth,
        y: arrowHeadBase.y + normalY * arrowHeadHalfWidth,
      },
      {
        x: arrowHeadBase.x - normalX * arrowHeadHalfWidth,
        y: arrowHeadBase.y - normalY * arrowHeadHalfWidth,
      },
    ],
    polyline,
  }
}

function collectLevelDescendants(levelNode: LevelNode, nodes: Record<string, AnyNode>): AnyNode[] {
  const descendants: AnyNode[] = []
  const stack = [...levelNode.children].reverse() as AnyNodeId[]

  while (stack.length > 0) {
    const nodeId = stack.pop()
    if (!nodeId) {
      continue
    }

    const node = nodes[nodeId]
    if (!node) {
      continue
    }

    descendants.push(node)

    if ('children' in node && Array.isArray(node.children) && node.children.length > 0) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        stack.push(node.children[index] as AnyNodeId)
      }
    }
  }

  return descendants
}

function getItemFloorplanTransform(
  item: ItemNode,
  nodeById: ReadonlyMap<string, AnyNode>,
  cache: Map<string, FloorplanNodeTransform | null>,
): FloorplanNodeTransform | null {
  const cached = cache.get(item.id)
  if (cached !== undefined) {
    return cached
  }

  const localRotation = item.rotation[1] ?? 0
  let result: FloorplanNodeTransform | null = null
  const itemMetadata =
    typeof item.metadata === 'object' && item.metadata !== null && !Array.isArray(item.metadata)
      ? (item.metadata as Record<string, unknown>)
      : null

  if (itemMetadata?.isTransient === true) {
    const live = useLiveTransforms.getState().get(item.id)
    if (live) {
      result = {
        position: {
          x: live.position[0],
          y: live.position[2],
        },
        rotation: live.rotation,
      }

      cache.set(item.id, result)
      return result
    }
  }

  if (item.parentId) {
    const parentNode = nodeById.get(item.parentId as AnyNodeId)

    if (parentNode?.type === 'wall') {
      const wallRotation = -Math.atan2(
        parentNode.end[1] - parentNode.start[1],
        parentNode.end[0] - parentNode.start[0],
      )
      const wallLocalZ =
        item.asset.attachTo === 'wall-side'
          ? ((parentNode.thickness ?? 0.1) / 2) * (item.side === 'back' ? -1 : 1)
          : item.position[2]
      const [offsetX, offsetY] = rotatePlanVector(item.position[0], wallLocalZ, wallRotation)

      result = {
        position: {
          x: parentNode.start[0] + offsetX,
          y: parentNode.start[1] + offsetY,
        },
        rotation: wallRotation + localRotation,
      }
    } else if (parentNode?.type === 'item') {
      const parentTransform = getItemFloorplanTransform(parentNode, nodeById, cache)
      if (parentTransform) {
        const [offsetX, offsetY] = rotatePlanVector(
          item.position[0],
          item.position[2],
          parentTransform.rotation,
        )
        result = {
          position: {
            x: parentTransform.position.x + offsetX,
            y: parentTransform.position.y + offsetY,
          },
          rotation: parentTransform.rotation + localRotation,
        }
      }
    } else {
      result = {
        position: { x: item.position[0], y: item.position[2] },
        rotation: localRotation,
      }
    }
  } else {
    result = {
      position: { x: item.position[0], y: item.position[2] },
      rotation: localRotation,
    }
  }

  cache.set(item.id, result)
  return result
}

type StairSegmentTransform = {
  position: [number, number, number]
  rotation: number
}

function computeFloorplanStairSegmentTransforms(
  segments: StairSegmentNode[],
): StairSegmentTransform[] {
  const transforms: StairSegmentTransform[] = []
  let currentX = 0
  let currentY = 0
  let currentZ = 0
  let currentRotation = 0

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!

    if (index === 0) {
      transforms.push({
        position: [currentX, currentY, currentZ],
        rotation: currentRotation,
      })
      continue
    }

    const previousSegment = segments[index - 1]!
    let attachX = 0
    let attachY = previousSegment.height
    let attachZ = previousSegment.length
    let rotationDelta = 0

    if (segment.attachmentSide === 'left') {
      attachX = previousSegment.width / 2
      attachZ = previousSegment.length / 2
      rotationDelta = Math.PI / 2
    } else if (segment.attachmentSide === 'right') {
      attachX = -previousSegment.width / 2
      attachZ = previousSegment.length / 2
      rotationDelta = -Math.PI / 2
    }

    const [rotatedAttachX, rotatedAttachZ] = rotatePlanVector(attachX, attachZ, currentRotation)
    currentX += rotatedAttachX
    currentY += attachY
    currentZ += rotatedAttachZ
    currentRotation += rotationDelta

    transforms.push({
      position: [currentX, currentY, currentZ],
      rotation: currentRotation,
    })
  }

  return transforms
}

function getFloorplanStairSegmentPolygon(
  stair: StairNode,
  segment: StairSegmentNode,
  transform: StairSegmentTransform,
): Point2D[] {
  const halfWidth = segment.width / 2
  const localCorners: Array<[number, number]> = [
    [-halfWidth, 0],
    [halfWidth, 0],
    [halfWidth, segment.length],
    [-halfWidth, segment.length],
  ]

  return localCorners.map(([localX, localY]) => {
    const [segmentX, segmentY] = rotatePlanVector(localX, localY, transform.rotation)
    const groupX = transform.position[0] + segmentX
    const groupY = transform.position[2] + segmentY
    const [worldOffsetX, worldOffsetY] = rotatePlanVector(groupX, groupY, stair.rotation)

    return {
      x: stair.position[0] + worldOffsetX,
      y: stair.position[2] + worldOffsetY,
    }
  })
}

function buildFloorplanStairEntry(
  stair: StairNode,
  segments: StairSegmentNode[],
): FloorplanStairEntry | null {
  const stairType = stair.stairType ?? 'straight'

  if (segments.length === 0 && stairType === 'straight') {
    return null
  }

  const transforms = computeFloorplanStairSegmentTransforms(segments)
  const segmentEntries = segments.map((segment, index) => {
    const polygon = getFloorplanStairSegmentPolygon(stair, segment, transforms[index]!)
    const centerLine = getFloorplanStairSegmentCenterLine(polygon)
    const innerPolygon = getFloorplanStairInnerPolygon(polygon)
    const treadThickness = getFloorplanStairTreadThickness(segment, innerPolygon)

    return {
      centerLine,
      innerPoints: formatPolygonPoints(innerPolygon),
      innerPolygon,
      segment,
      points: formatPolygonPoints(polygon),
      polygon,
      treadBars: getFloorplanStairTreadBars(segment, innerPolygon, treadThickness),
      treadThickness,
    }
  })
  const hitPolygons =
    stairType === 'straight'
      ? segmentEntries.map(({ polygon }) => polygon)
      : [getFloorplanCurvedStairHitPolygon(stair)]

  return {
    arrow: buildFloorplanStairArrow(segmentEntries),
    hitPolygons,
    stair,
    segments: segmentEntries,
  }
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

function calculatePolygonSnapPoint(
  lastPoint: WallPlanPoint,
  currentPoint: WallPlanPoint,
): WallPlanPoint {
  const [x1, y1] = lastPoint
  const [x, y] = currentPoint
  const dx = x - x1
  const dy = y - y1
  const absDx = Math.abs(dx)
  const absDy = Math.abs(dy)
  const horizontalDist = absDy
  const verticalDist = absDx
  const diagonalDist = Math.abs(absDx - absDy)
  const minDist = Math.min(horizontalDist, verticalDist, diagonalDist)

  if (minDist === diagonalDist) {
    const diagonalLength = Math.min(absDx, absDy)
    return [x1 + Math.sign(dx) * diagonalLength, y1 + Math.sign(dy) * diagonalLength]
  }

  if (minDist === horizontalDist) {
    return [x, y1]
  }

  return [x1, y]
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
  const snappedPoint: WallPlanPoint = [snapToHalf(point[0]), snapToHalf(point[1])]

  if (!(start && angleSnap)) {
    return snappedPoint
  }

  return calculatePolygonSnapPoint(start, snappedPoint)
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

function buildSvgPolylinePath(points: Point2D[]): string | null {
  if (points.length < 2) {
    return null
  }

  return points
    .map((point, index) => {
      const svgPoint = toSvgPoint(point)
      return `${index === 0 ? 'M' : 'L'} ${svgPoint.x} ${svgPoint.y}`
    })
    .join(' ')
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

function pointsEqual(a: WallPlanPoint, b: WallPlanPoint): boolean {
  return a[0] === b[0] && a[1] === b[1]
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

      return pointsEqual(point, otherPoint)
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

type LinearMeasurementOverlay = {
  id: string
  dimensionLineEnd: { x1: number; y1: number; x2: number; y2: number }
  dimensionLineStart: { x1: number; y1: number; x2: number; y2: number }
  extensionStart: { x1: number; y1: number; x2: number; y2: number }
  extensionEnd: { x1: number; y1: number; x2: number; y2: number }
  label: string
  labelX: number
  labelY: number
  labelAngleDeg: number
  extensionStroke?: string
  isSelected?: boolean
  labelFill?: string
  stroke?: string
}

function formatMeasurement(value: number, unit: 'metric' | 'imperial') {
  if (unit === 'imperial') {
    const feet = value * 3.280_84
    const wholeFeet = Math.floor(feet)
    const inches = Math.round((feet - wholeFeet) * 12)
    if (inches === 12) return `${wholeFeet + 1}'0"`
    return `${wholeFeet}'${inches}"`
  }
  return `${Number.parseFloat(value.toFixed(2))}m`
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

function formatArea(areaSqM: number, unit: 'metric' | 'imperial') {
  if (unit === 'imperial') {
    const areaSqFt = areaSqM * 10.763_910_4
    return (
      <>
        {Math.round(areaSqFt).toLocaleString()} ft
        <tspan baselineShift="super" fontSize="0.75em">
          2
        </tspan>
      </>
    )
  }
  return (
    <>
      {Number.parseFloat(areaSqM.toFixed(1))} m
      <tspan baselineShift="super" fontSize="0.75em">
        2
      </tspan>
    </>
  )
}

function FloorplanMeasurementLine({
  palette,
  segment,
  isSelected,
  dashed = false,
  stroke,
}: {
  palette: FloorplanPalette
  segment: { x1: number; y1: number; x2: number; y2: number }
  isSelected?: boolean
  dashed?: boolean
  stroke?: string
}) {
  const lineOpacity = isSelected
    ? FLOORPLAN_MEASUREMENT_LINE_OPACITY
    : FLOORPLAN_MEASUREMENT_LINE_OPACITY * 0.4

  return (
    <>
      <line
        shapeRendering="geometricPrecision"
        stroke={stroke ?? palette.measurementStroke}
        strokeLinecap="round"
        strokeOpacity={lineOpacity}
        strokeWidth={FLOORPLAN_MEASUREMENT_LINE_WIDTH}
        strokeDasharray={dashed ? FLOORPLAN_MEASUREMENT_EXTENSION_DASH : undefined}
        vectorEffect="non-scaling-stroke"
        x1={segment.x1}
        x2={segment.x2}
        y1={segment.y1}
        y2={segment.y2}
      />
    </>
  )
}

function FloorplanMeasurementTick({
  palette,
  x,
  y,
  angleDeg,
  isSelected,
  stroke,
}: {
  palette: FloorplanPalette
  x: number
  y: number
  angleDeg: number
  isSelected?: boolean
  stroke?: string
}) {
  const radians = (angleDeg * Math.PI) / 180
  const nx = -Math.sin(radians)
  const ny = Math.cos(radians)
  const half = FLOORPLAN_MEASUREMENT_END_TICK / 2

  return (
    <line
      shapeRendering="geometricPrecision"
      stroke={stroke ?? palette.measurementStroke}
      strokeLinecap="round"
      strokeOpacity={isSelected ? FLOORPLAN_MEASUREMENT_LINE_OPACITY : FLOORPLAN_MEASUREMENT_LINE_OPACITY * 0.4}
      strokeWidth={FLOORPLAN_MEASUREMENT_LINE_WIDTH}
      vectorEffect="non-scaling-stroke"
      x1={x - nx * half}
      x2={x + nx * half}
      y1={y - ny * half}
      y2={y + ny * half}
    />
  )
}

function getWallMeasurementOverlay(
  wall: WallNode,
  centerX: number,
  centerZ: number,
  unit: 'metric' | 'imperial',
): LinearMeasurementOverlay | null {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = getWallCurveLength(wall)

  if (length < 0.1) {
    return null
  }

  const nx = -dz / length
  const nz = dx / length
  const midX = (wall.start[0] + wall.end[0]) / 2
  const midZ = (wall.start[1] + wall.end[1]) / 2
  const cx = midX - centerX
  const cz = midZ - centerZ
  const dot = cx * nx + cz * nz
  const outX = dot >= 0 ? nx : -nx
  const outZ = dot >= 0 ? nz : -nz
  const label = formatMeasurement(length, unit)
  const dimensionLine = {
    x1: toSvgX(wall.start[0] + outX * FLOORPLAN_MEASUREMENT_OFFSET),
    y1: toSvgY(wall.start[1] + outZ * FLOORPLAN_MEASUREMENT_OFFSET),
    x2: toSvgX(wall.end[0] + outX * FLOORPLAN_MEASUREMENT_OFFSET),
    y2: toSvgY(wall.end[1] + outZ * FLOORPLAN_MEASUREMENT_OFFSET),
  }

  const extensionStart = {
    x1: toSvgX(wall.start[0]),
    y1: toSvgY(wall.start[1]),
    x2: toSvgX(
      wall.start[0] +
        outX * (FLOORPLAN_MEASUREMENT_OFFSET + FLOORPLAN_MEASUREMENT_EXTENSION_OVERSHOOT),
    ),
    y2: toSvgY(
      wall.start[1] +
        outZ * (FLOORPLAN_MEASUREMENT_OFFSET + FLOORPLAN_MEASUREMENT_EXTENSION_OVERSHOOT),
    ),
  }

  const extensionEnd = {
    x1: toSvgX(wall.end[0]),
    y1: toSvgY(wall.end[1]),
    x2: toSvgX(
      wall.end[0] +
        outX * (FLOORPLAN_MEASUREMENT_OFFSET + FLOORPLAN_MEASUREMENT_EXTENSION_OVERSHOOT),
    ),
    y2: toSvgY(
      wall.end[1] +
        outZ * (FLOORPLAN_MEASUREMENT_OFFSET + FLOORPLAN_MEASUREMENT_EXTENSION_OVERSHOOT),
    ),
  }

  const svgDx = dimensionLine.x2 - dimensionLine.x1
  const svgDy = dimensionLine.y2 - dimensionLine.y1
  const svgLength = Math.hypot(svgDx, svgDy)
  let labelAngleDeg = (Math.atan2(svgDy, svgDx) * 180) / Math.PI

  if (labelAngleDeg > 90) {
    labelAngleDeg -= 180
  } else if (labelAngleDeg <= -90) {
    labelAngleDeg += 180
  }

  if (svgLength < 1e-6) {
    return null
  }

  const dirSvgX = svgDx / svgLength
  const dirSvgY = svgDy / svgLength
  const labelGapHalf = Math.min(
    FLOORPLAN_MEASUREMENT_LABEL_GAP / 2,
    Math.max(0, svgLength / 2 - FLOORPLAN_MEASUREMENT_LABEL_LINE_PADDING),
  )
  const labelX = (dimensionLine.x1 + dimensionLine.x2) / 2
  const labelY = (dimensionLine.y1 + dimensionLine.y2) / 2
  const dimensionLineStart = {
    x1: dimensionLine.x1,
    y1: dimensionLine.y1,
    x2: labelX - dirSvgX * labelGapHalf,
    y2: labelY - dirSvgY * labelGapHalf,
  }
  const dimensionLineEnd = {
    x1: labelX + dirSvgX * labelGapHalf,
    y1: labelY + dirSvgY * labelGapHalf,
    x2: dimensionLine.x2,
    y2: dimensionLine.y2,
  }

  return {
    id: `${wall.id}:centerline`,
    dimensionLineEnd,
    dimensionLineStart,
    extensionStart,
    extensionEnd,
    label,
    labelX,
    labelY,
    labelAngleDeg,
  }
}

function getLinearMeasurementOverlay(
  id: string,
  start: Point2D,
  end: Point2D,
  label: string,
  options?: {
    offsetDistance?: number
    offsetVector?: Point2D
  },
): LinearMeasurementOverlay | null {
  const offsetDistance = options?.offsetDistance ?? 0
  const offsetVector = options?.offsetVector
  const offsetStart =
    offsetVector && offsetDistance !== 0
      ? {
          x: start.x + offsetVector.x * offsetDistance,
          y: start.y + offsetVector.y * offsetDistance,
        }
      : start
  const offsetEnd =
    offsetVector && offsetDistance !== 0
      ? {
          x: end.x + offsetVector.x * offsetDistance,
          y: end.y + offsetVector.y * offsetDistance,
        }
      : end
  const dimensionLine = {
    x1: toSvgX(offsetStart.x),
    y1: toSvgY(offsetStart.y),
    x2: toSvgX(offsetEnd.x),
    y2: toSvgY(offsetEnd.y),
  }

  const svgDx = dimensionLine.x2 - dimensionLine.x1
  const svgDy = dimensionLine.y2 - dimensionLine.y1
  const svgLength = Math.hypot(svgDx, svgDy)
  let labelAngleDeg = (Math.atan2(svgDy, svgDx) * 180) / Math.PI

  if (labelAngleDeg > 90) {
    labelAngleDeg -= 180
  } else if (labelAngleDeg <= -90) {
    labelAngleDeg += 180
  }

  if (svgLength < 1e-6) {
    return null
  }

  const dirSvgX = svgDx / svgLength
  const dirSvgY = svgDy / svgLength
  const labelGapHalf = Math.min(
    FLOORPLAN_MEASUREMENT_LABEL_GAP / 2,
    Math.max(0, svgLength / 2 - FLOORPLAN_MEASUREMENT_LABEL_LINE_PADDING),
  )
  const labelX = (dimensionLine.x1 + dimensionLine.x2) / 2
  const labelY = (dimensionLine.y1 + dimensionLine.y2) / 2

  return {
    id,
    dimensionLineStart: {
      x1: dimensionLine.x1,
      y1: dimensionLine.y1,
      x2: labelX - dirSvgX * labelGapHalf,
      y2: labelY - dirSvgY * labelGapHalf,
    },
    dimensionLineEnd: {
      x1: labelX + dirSvgX * labelGapHalf,
      y1: labelY + dirSvgY * labelGapHalf,
      x2: dimensionLine.x2,
      y2: dimensionLine.y2,
    },
    extensionStart: {
      x1: toSvgX(start.x),
      y1: toSvgY(start.y),
      x2: toSvgX(
        offsetVector
          ? start.x +
              offsetVector.x *
                (offsetDistance + FLOORPLAN_MEASUREMENT_EXTENSION_OVERSHOOT)
          : start.x,
      ),
      y2: toSvgY(
        offsetVector
          ? start.y +
              offsetVector.y *
                (offsetDistance + FLOORPLAN_MEASUREMENT_EXTENSION_OVERSHOOT)
          : start.y,
      ),
    },
    extensionEnd: {
      x1: toSvgX(end.x),
      y1: toSvgY(end.y),
      x2: toSvgX(
        offsetVector
          ? end.x +
              offsetVector.x * (offsetDistance + FLOORPLAN_MEASUREMENT_EXTENSION_OVERSHOOT)
          : end.x,
      ),
      y2: toSvgY(
        offsetVector
          ? end.y +
              offsetVector.y * (offsetDistance + FLOORPLAN_MEASUREMENT_EXTENSION_OVERSHOOT)
          : end.y,
      ),
    },
    label,
    labelX,
    labelY,
    labelAngleDeg,
    isSelected: true,
  }
}

type WallFaceLine = {
  start: Point2D
  end: Point2D
}

type WallMeasurementFaceContext = {
  outerFace: WallFaceLine
  innerFace: WallFaceLine
  outwardNormal: Point2D
  inwardNormal: Point2D
}

function getWallFaceLines(polygon: Point2D[], wall: WallNode): { left: WallFaceLine; right: WallFaceLine } | null {
  if (polygon.length < 4 || isCurvedWall(wall)) {
    return null
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

  return {
    left: {
      start: startLeft,
      end: endLeft,
    },
    right: {
      start: startRight,
      end: endRight,
    },
  }
}

function getLineMidpoint(line: WallFaceLine): Point2D {
  return {
    x: (line.start.x + line.end.x) / 2,
    y: (line.start.y + line.end.y) / 2,
  }
}

function getWallMeasurementFaceContext(
  selectedWallEntry: WallPolygonEntry,
  wallPolygons: WallPolygonEntry[],
): WallMeasurementFaceContext | null {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const { wall } of wallPolygons) {
    minX = Math.min(minX, wall.start[0], wall.end[0])
    maxX = Math.max(maxX, wall.start[0], wall.end[0])
    minY = Math.min(minY, wall.start[1], wall.end[1])
    maxY = Math.max(maxY, wall.start[1], wall.end[1])
  }

  const centerX = minX === Number.POSITIVE_INFINITY ? 0 : (minX + maxX) / 2
  const centerY = minY === Number.POSITIVE_INFINITY ? 0 : (minY + maxY) / 2
  const { wall, polygon } = selectedWallEntry
  const faceLines = getWallFaceLines(polygon, wall)

  if (!faceLines) {
    return null
  }

  const dx = wall.end[0] - wall.start[0]
  const dy = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dy)

  if (length < 1e-6) {
    return null
  }

  const wallMidpoint = {
    x: (wall.start[0] + wall.end[0]) / 2,
    y: (wall.start[1] + wall.end[1]) / 2,
  }
  const normal = { x: -dy / length, y: dx / length }
  const fromCenter = {
    x: wallMidpoint.x - centerX,
    y: wallMidpoint.y - centerY,
  }
  const outwardNormal =
    fromCenter.x * normal.x + fromCenter.y * normal.y >= 0
      ? normal
      : { x: -normal.x, y: -normal.y }
  const rightMidpoint = getLineMidpoint(faceLines.right)
  const leftMidpoint = getLineMidpoint(faceLines.left)
  const rightScore =
    (rightMidpoint.x - wallMidpoint.x) * outwardNormal.x +
    (rightMidpoint.y - wallMidpoint.y) * outwardNormal.y
  const leftScore =
    (leftMidpoint.x - wallMidpoint.x) * outwardNormal.x +
    (leftMidpoint.y - wallMidpoint.y) * outwardNormal.y
  const outerFace = rightScore >= leftScore ? faceLines.right : faceLines.left
  const innerFace = outerFace === faceLines.right ? faceLines.left : faceLines.right

  return {
    outerFace,
    innerFace,
    outwardNormal,
    inwardNormal: { x: -outwardNormal.x, y: -outwardNormal.y },
  }
}

function getAdjacentOpeningBounds(
  current: {
    id: OpeningNode['id']
    wallId: WallNode['id']
    startDistance: number
    endDistance: number
  },
  openings: OpeningPolygonEntry[],
) {
  let leftBoundary: number | null = null
  let rightBoundary: number | null = null

  for (const { opening } of openings) {
    if (opening.parentId !== current.wallId || opening.id === current.id) {
      continue
    }

    const startDistance = opening.position[0] - opening.width / 2
    const endDistance = opening.position[0] + opening.width / 2

    if (endDistance <= current.startDistance && (leftBoundary === null || endDistance > leftBoundary)) {
      leftBoundary = endDistance
    }

    if (
      startDistance >= current.endDistance &&
      (rightBoundary === null || startDistance < rightBoundary)
    ) {
      rightBoundary = startDistance
    }
  }

  return {
    leftBoundary,
    rightBoundary,
  }
}

function getSelectedWallMeasurementOverlays(
  selectedWallEntry: WallPolygonEntry,
  wallPolygons: WallPolygonEntry[],
  unit: 'metric' | 'imperial',
): LinearMeasurementOverlay[] {
  const { wall } = selectedWallEntry

  if (isCurvedWall(wall)) {
    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY

    for (const { wall: candidateWall } of wallPolygons) {
      minX = Math.min(minX, candidateWall.start[0], candidateWall.end[0])
      maxX = Math.max(maxX, candidateWall.start[0], candidateWall.end[0])
      minY = Math.min(minY, candidateWall.start[1], candidateWall.end[1])
      maxY = Math.max(maxY, candidateWall.start[1], candidateWall.end[1])
    }

    const centerX = minX === Number.POSITIVE_INFINITY ? 0 : (minX + maxX) / 2
    const centerY = minY === Number.POSITIVE_INFINITY ? 0 : (minY + maxY) / 2
    const overlay = getWallMeasurementOverlay(wall, centerX, centerY, unit)
    return overlay ? [overlay] : []
  }

  const faceContext = getWallMeasurementFaceContext(selectedWallEntry, wallPolygons)
  if (!faceContext) {
    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY

    for (const { wall: candidateWall } of wallPolygons) {
      minX = Math.min(minX, candidateWall.start[0], candidateWall.end[0])
      maxX = Math.max(maxX, candidateWall.start[0], candidateWall.end[0])
      minY = Math.min(minY, candidateWall.start[1], candidateWall.end[1])
      maxY = Math.max(maxY, candidateWall.start[1], candidateWall.end[1])
    }

    const centerX = minX === Number.POSITIVE_INFINITY ? 0 : (minX + maxX) / 2
    const centerY = minY === Number.POSITIVE_INFINITY ? 0 : (minY + maxY) / 2
    const overlay = getWallMeasurementOverlay(wall, centerX, centerY, unit)
    return overlay ? [overlay] : []
  }

  const { outerFace, innerFace, outwardNormal, inwardNormal } = faceContext
  const outerLength = Math.hypot(outerFace.end.x - outerFace.start.x, outerFace.end.y - outerFace.start.y)
  const innerLength = Math.hypot(innerFace.end.x - innerFace.start.x, innerFace.end.y - innerFace.start.y)
  const overlays: LinearMeasurementOverlay[] = []

  if (outerLength >= 0.1) {
    const overlay = getLinearMeasurementOverlay(
      `${wall.id}:outer-face`,
      outerFace.start,
      outerFace.end,
      formatMeasurement(outerLength, unit),
      {
        offsetDistance: FLOORPLAN_WALL_OUTER_MEASUREMENT_OFFSET,
        offsetVector: outwardNormal,
      },
    )

    if (overlay) {
      overlays.push({
        ...overlay,
        extensionStroke: FLOORPLAN_WALL_OUTER_MEASUREMENT_EXTENSION,
        labelFill: FLOORPLAN_WALL_OUTER_MEASUREMENT_TEXT,
        stroke: FLOORPLAN_WALL_OUTER_MEASUREMENT_STROKE,
      })
    }
  }

  if (innerLength >= 0.1) {
    const overlay = getLinearMeasurementOverlay(
      `${wall.id}:inner-face`,
      innerFace.start,
      innerFace.end,
      formatMeasurement(innerLength, unit),
      {
        offsetDistance: FLOORPLAN_WALL_INNER_MEASUREMENT_OFFSET,
        offsetVector: inwardNormal,
      },
    )

    if (overlay) {
      overlays.push({
        ...overlay,
        extensionStroke: FLOORPLAN_WALL_INNER_MEASUREMENT_EXTENSION,
        labelFill: FLOORPLAN_WALL_INNER_MEASUREMENT_TEXT,
        stroke: FLOORPLAN_WALL_INNER_MEASUREMENT_STROKE,
      })
    }
  }

  return overlays
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
  const rotationDeg = (-guide.rotation[1] * 180) / Math.PI

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
        strokeWidth="0.02"
        vectorEffect="non-scaling-stroke"
      />

      <path
        d={majorGridPath}
        fill="none"
        opacity={palette.majorGridOpacity}
        shapeRendering="crispEdges"
        stroke={palette.majorGrid}
        strokeWidth="0.04"
        vectorEffect="non-scaling-stroke"
      />
    </>
  )
})

const FloorplanGuideLayer = memo(function FloorplanGuideLayer({
  guides,
  isInteractive,
  selectedGuideId,
  activeGuideInteractionGuideId,
  activeGuideInteractionMode,
  onGuideSelect,
  onGuideTranslateStart,
}: {
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
          isInteractive={isInteractive}
          isSelected={selectedGuideId === guide.id}
          key={guide.id}
          onGuideSelect={onGuideSelect}
          onGuideTranslateStart={onGuideTranslateStart}
        />
      ))}
    </>
  )
})

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
  const rotationDeg = (-guide.rotation[1] * 180) / Math.PI
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
                      : getGuideResizeCursor(corner, -guide.rotation[1]),
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

const FloorplanGeometryLayer = memo(function FloorplanGeometryLayer({
  canFocusGeometry,
  canSelectGeometry,
  canSelectSlabs,
  canSelectCeilings,
  ceilingPolygons,
  highlightedIdSet,
  hoveredCeilingId,
  hoveredSlabId,
  hoveredOpeningId,
  hoveredWallId,
  isDeleteMode,
  onCeilingDoubleClick,
  onCeilingHoverChange,
  onCeilingSelect,
  onSlabDoubleClick,
  onSlabHoverChange,
  onSlabSelect,
  onOpeningDoubleClick,
  onOpeningHoverChange,
  onOpeningPointerDown,
  onOpeningSelect,
  onWallClick,
  onWallDoubleClick,
  onWallHoverChange,
  openingsPolygons,
  palette,
  selectedIdSet,
  slabPolygons,
  wallPolygons,
  wallSelectionHatchId,
  unit,
}: {
  canFocusGeometry: boolean
  canSelectSlabs: boolean
  canSelectCeilings: boolean
  canSelectGeometry: boolean
  ceilingPolygons: CeilingPolygonEntry[]
  highlightedIdSet: ReadonlySet<string>
  hoveredCeilingId: CeilingNode['id'] | null
  hoveredSlabId: SlabNode['id'] | null
  hoveredOpeningId: OpeningNode['id'] | null
  isDeleteMode: boolean
  onCeilingDoubleClick: (ceiling: CeilingNode) => void
  onCeilingHoverChange: (ceilingId: CeilingNode['id'] | null) => void
  onCeilingSelect: (ceilingId: CeilingNode['id'], event: ReactMouseEvent<SVGElement>) => void
  onSlabDoubleClick: (slab: SlabNode) => void
  onSlabHoverChange: (slabId: SlabNode['id'] | null) => void
  onSlabSelect: (slabId: SlabNode['id'], event: ReactMouseEvent<SVGElement>) => void
  onOpeningDoubleClick: (opening: OpeningNode) => void
  onOpeningHoverChange: (openingId: OpeningNode['id'] | null) => void
  onOpeningPointerDown: (openingId: OpeningNode['id'], event: ReactPointerEvent<SVGElement>) => void
  onOpeningSelect: (openingId: OpeningNode['id'], event: ReactMouseEvent<SVGElement>) => void
  hoveredWallId: WallNode['id'] | null
  onWallClick: (wall: WallNode, event: ReactMouseEvent<SVGElement>) => void
  onWallDoubleClick: (wall: WallNode, event: ReactMouseEvent<SVGElement>) => void
  onWallHoverChange: (wallId: WallNode['id'] | null) => void
  openingsPolygons: OpeningPolygonEntry[]
  palette: FloorplanPalette
  selectedIdSet: ReadonlySet<string>
  slabPolygons: SlabPolygonEntry[]
  wallPolygons: WallPolygonEntry[]
  wallSelectionHatchId: string
  unit: 'metric' | 'imperial'
}) {
  const selectedWallEntries = wallPolygons.filter(({ wall }) => selectedIdSet.has(wall.id))
  const wallMeasurements =
    selectedIdSet.size === 1 && selectedWallEntries.length === 1
      ? getSelectedWallMeasurementOverlays(selectedWallEntries[0]!, wallPolygons, unit)
      : []

  return (
    <>
      {slabPolygons.map(({ slab, polygon, holes, path }) => {
        const isSelected = selectedIdSet.has(slab.id)
        const isHighlighted = highlightedIdSet.has(slab.id)
        const isDeleteHovered = isDeleteMode && hoveredSlabId === slab.id
        const showSelectedSlabStyle = isSelected || isHighlighted
        const slabBorderStroke = isDeleteHovered
          ? palette.deleteStroke
          : showSelectedSlabStyle
            ? palette.selectedSlabStroke
            : palette.slabStroke
        const slabBorderWidth = showSelectedSlabStyle ? '0.065' : '0.05'
        let slabLabel = null

        if (isSelected) {
          const { area, centroid } = getSlabArea(polygon, holes)
          if (area > 0) {
            slabLabel = (
              <text
                dominantBaseline="central"
                fill={palette.measurementStroke}
                fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                fontSize={FLOORPLAN_MEASUREMENT_LABEL_FONT_SIZE}
                fontWeight="600"
                paintOrder="stroke"
                pointerEvents="none"
                stroke={palette.surface}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={FLOORPLAN_MEASUREMENT_LABEL_STROKE_WIDTH}
                style={{ userSelect: 'none' }}
                textAnchor="middle"
                x={toSvgX(centroid.x)}
                y={toSvgY(centroid.y)}
              >
                {formatArea(area, unit)}
              </text>
            )
          }
        }

        return (
          <g key={slab.id}>
            <path
              clipRule="evenodd"
              d={path}
              fill={
                isDeleteHovered
                  ? palette.deleteFill
                  : showSelectedSlabStyle
                    ? palette.selectedSlabFill
                    : palette.slabFill
              }
              fillRule="evenodd"
              onClick={
                canSelectSlabs
                  ? (event) => {
                      event.stopPropagation()
                      onSlabSelect(slab.id, event)
                    }
                  : undefined
              }
              onDoubleClick={
                canFocusGeometry
                  ? (event) => {
                      event.stopPropagation()
                      onSlabDoubleClick(slab)
                    }
                  : undefined
              }
              onPointerEnter={canSelectSlabs ? () => onSlabHoverChange(slab.id) : undefined}
              onPointerLeave={canSelectSlabs ? () => onSlabHoverChange(null) : undefined}
              pointerEvents={canSelectSlabs ? undefined : 'none'}
              style={canSelectSlabs ? { cursor: EDITOR_CURSOR } : undefined}
              stroke="none"
            />
            <path
              clipRule="evenodd"
              d={path}
              fill="none"
              fillRule="evenodd"
              pointerEvents="none"
              stroke={slabBorderStroke}
              strokeLinejoin="round"
              strokeOpacity={isDeleteHovered || isHighlighted ? 0.96 : 0.88}
              strokeWidth={slabBorderWidth}
              vectorEffect="non-scaling-stroke"
            />
            {slabLabel}
          </g>
        )
      })}

      {ceilingPolygons.map(({ ceiling, path }) => {
        const isSelected = selectedIdSet.has(ceiling.id)
        const isHighlighted = highlightedIdSet.has(ceiling.id)
        const isDeleteHovered = isDeleteMode && hoveredCeilingId === ceiling.id
        const showSelectedCeilingStyle = isSelected || isHighlighted
        const ceilingBorderStroke = isDeleteHovered
          ? palette.deleteStroke
          : showSelectedCeilingStyle
            ? palette.selectedCeilingStroke
            : palette.ceilingStroke
        const ceilingBorderWidth = showSelectedCeilingStyle ? '0.065' : '0.05'

        return (
          <g key={ceiling.id}>
            <path
              clipRule="evenodd"
              d={path}
              fill={
                isDeleteHovered
                  ? palette.deleteFill
                  : showSelectedCeilingStyle
                    ? palette.selectedCeilingFill
                    : palette.ceilingFill
              }
              fillRule="evenodd"
              onClick={
                canSelectCeilings
                  ? (event) => {
                      event.stopPropagation()
                      onCeilingSelect(ceiling.id, event)
                    }
                  : undefined
              }
              onDoubleClick={
                canFocusGeometry
                  ? (event) => {
                      event.stopPropagation()
                      onCeilingDoubleClick(ceiling)
                    }
                  : undefined
              }
              onPointerEnter={canSelectCeilings ? () => onCeilingHoverChange(ceiling.id) : undefined}
              onPointerLeave={canSelectCeilings ? () => onCeilingHoverChange(null) : undefined}
              pointerEvents={canSelectCeilings ? undefined : 'none'}
              style={canSelectCeilings ? { cursor: EDITOR_CURSOR } : undefined}
              stroke="none"
            />
            <path
              clipRule="evenodd"
              d={path}
              fill="none"
              fillRule="evenodd"
              pointerEvents="none"
              stroke={ceilingBorderStroke}
              strokeDasharray="0.16 0.12"
              strokeLinejoin="round"
              strokeOpacity={isDeleteHovered || isHighlighted ? 0.96 : 0.88}
              strokeWidth={ceilingBorderWidth}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        )
      })}

      {wallPolygons.map(({ wall, polygon, points }) => {
        const isSelected = selectedIdSet.has(wall.id)
        const isHighlighted = highlightedIdSet.has(wall.id)
        const isHovered = canSelectGeometry && hoveredWallId === wall.id
        const isDeleteHovered = isDeleteMode && isHovered
        const showSelectedWallChrome = isSelected || isHighlighted
        const wallStroke = isDeleteHovered
          ? palette.deleteStroke
          : showSelectedWallChrome
            ? palette.selectedStroke
            : palette.wallStroke

        return (
          <g
            key={wall.id}
            onPointerEnter={canSelectGeometry ? () => onWallHoverChange(wall.id) : undefined}
            onPointerLeave={canSelectGeometry ? () => onWallHoverChange(null) : undefined}
          >
            {canSelectGeometry && (
              <line
                onClick={(event) => {
                  event.stopPropagation()
                  onWallClick(wall, event)
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation()
                  onWallDoubleClick(wall, event)
                }}
                pointerEvents="stroke"
                stroke="transparent"
                strokeLinecap="round"
                strokeWidth={FLOORPLAN_WALL_HIT_STROKE_WIDTH}
                style={{ cursor: EDITOR_CURSOR }}
                vectorEffect="non-scaling-stroke"
                x1={toSvgX(wall.start[0])}
                x2={toSvgX(wall.end[0])}
                y1={toSvgY(wall.start[1])}
                y2={toSvgY(wall.end[1])}
              />
            )}
            <polygon
              fill={
                isDeleteHovered
                  ? palette.deleteWallFill
                  : palette.wallFill
              }
              onClick={
                canSelectGeometry
                  ? (event) => {
                      event.stopPropagation()
                      onWallClick(wall, event)
                    }
                  : undefined
              }
              onDoubleClick={
                canSelectGeometry
                  ? (event) => {
                      event.stopPropagation()
                      onWallDoubleClick(wall, event)
                    }
                  : undefined
              }
              points={points}
              stroke={wallStroke}
              strokeOpacity={1}
              strokeWidth={showSelectedWallChrome ? '1.5' : '1'}
              style={{ cursor: EDITOR_CURSOR }}
              vectorEffect="non-scaling-stroke"
            />
            {isSelected && !isDeleteHovered ? (
              <polygon
                fill={`url(#${wallSelectionHatchId})`}
                opacity={1}
                points={points}
                pointerEvents="none"
              />
            ) : null}
          </g>
        )
      })}

      {openingsPolygons.map(({ opening, polygon, points }) => {
        const isSelected = selectedIdSet.has(opening.id)
        const isSelectionHighlighted = highlightedIdSet.has(opening.id)
        const isHovered = canSelectGeometry && hoveredOpeningId === opening.id
        const isDeleteHovered = isDeleteMode && isHovered
        const centerLine = getOpeningCenterLine(polygon)

        if (opening.type === 'window') {
          if (polygon.length < 4) return null
          if (!centerLine) return null
          const [p1, p2, p3, p4] = polygon
          const tangentDx = p2!.x - p1!.x
          const tangentDy = p2!.y - p1!.y
          const tangentLength = Math.hypot(tangentDx, tangentDy)
          const normalDx = p4!.x - p1!.x
          const normalDy = p4!.y - p1!.y
          const normalLength = Math.hypot(normalDx, normalDy)

          if (tangentLength < 1e-6 || normalLength < 1e-6) return null

          const tangentX = tangentDx / tangentLength
          const tangentY = tangentDy / tangentLength
          const normalX = normalDx / normalLength
          const normalY = normalDy / normalLength
          const tangentInset = Math.min(tangentLength * 0.08, 0.12)
          const normalInset = Math.min(normalLength * 0.22, 0.07)
          const insetInnerStart = {
            x: p1!.x + tangentX * tangentInset + normalX * normalInset,
            y: p1!.y + tangentY * tangentInset + normalY * normalInset,
          }
          const insetInnerEnd = {
            x: p2!.x - tangentX * tangentInset + normalX * normalInset,
            y: p2!.y - tangentY * tangentInset + normalY * normalInset,
          }
          const insetOuterEnd = {
            x: p3!.x - tangentX * tangentInset - normalX * normalInset,
            y: p3!.y - tangentY * tangentInset - normalY * normalInset,
          }
          const insetOuterStart = {
            x: p4!.x + tangentX * tangentInset - normalX * normalInset,
            y: p4!.y + tangentY * tangentInset - normalY * normalInset,
          }
          const centerStart = {
            x: (insetInnerStart.x + insetOuterStart.x) / 2,
            y: (insetInnerStart.y + insetOuterStart.y) / 2,
          }
          const centerEnd = {
            x: (insetInnerEnd.x + insetOuterEnd.x) / 2,
            y: (insetInnerEnd.y + insetOuterEnd.y) / 2,
          }
          const symbolStroke =
            isSelected || isSelectionHighlighted ? '#f97316' : 'rgba(31, 41, 55, 0.92)'
          const symbolFill = 'rgba(255, 255, 255, 0.96)'
          const symbolStrokeWidth = isSelected || isSelectionHighlighted ? '1.9' : '1.25'
          const innerStrokeWidth = isSelected || isSelectionHighlighted ? '1.3' : '0.9'
          const detailStrokeWidth = isSelected || isSelectionHighlighted ? '1.05' : '0.75'
          const markerX = (p1!.x + p2!.x + p3!.x + p4!.x) / 4
          const markerY = (p1!.y + p2!.y + p3!.y + p4!.y) / 4

          return (
            <g
              key={opening.id}
              onClick={
                canSelectGeometry
                  ? (event) => {
                      event.stopPropagation()
                      onOpeningSelect(opening.id, event)
                    }
                  : undefined
              }
              onDoubleClick={
                canFocusGeometry
                  ? (event) => {
                      event.stopPropagation()
                      onOpeningDoubleClick(opening)
                    }
                  : undefined
              }
              onPointerDown={
                canFocusGeometry && isSelected
                  ? (event) => {
                      if (event.button === 0) {
                        onOpeningPointerDown(opening.id, event)
                      }
                    }
                  : undefined
              }
              onPointerEnter={
                canSelectGeometry
                  ? () => {
                      onWallHoverChange(null)
                      onOpeningHoverChange(opening.id)
                    }
                  : undefined
              }
              onPointerLeave={canSelectGeometry ? () => onOpeningHoverChange(null) : undefined}
              style={{ cursor: EDITOR_CURSOR }}
            >
              {canSelectGeometry && (
                <polygon
                  fill="transparent"
                  points={points}
                  pointerEvents="all"
                  stroke="transparent"
                  strokeWidth={FLOORPLAN_OPENING_HIT_STROKE_WIDTH}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              <polygon
                fill={isDeleteHovered ? palette.deleteFill : symbolFill}
                points={points}
                stroke={
                  isDeleteHovered
                    ? palette.deleteStroke
                    : symbolStroke
                }
                strokeOpacity={1}
                strokeWidth={symbolStrokeWidth}
                vectorEffect="non-scaling-stroke"
              />
              <polygon
                fill="none"
                points={formatPolygonPoints([
                  insetInnerStart,
                  insetInnerEnd,
                  insetOuterEnd,
                  insetOuterStart,
                ])}
                stroke={
                  isDeleteHovered
                    ? palette.deleteStroke
                    : symbolStroke
                }
                strokeWidth={innerStrokeWidth}
                vectorEffect="non-scaling-stroke"
              />
              <line
                stroke={isDeleteHovered ? palette.deleteStroke : symbolStroke}
                strokeWidth={detailStrokeWidth}
                vectorEffect="non-scaling-stroke"
                x1={toSvgX(centerStart.x)}
                x2={toSvgX(centerEnd.x)}
                y1={toSvgY(centerStart.y)}
                y2={toSvgY(centerEnd.y)}
              />
              {[0.25, 0.5, 0.75].map((ratio) => {
                const topPoint = {
                  x: insetInnerStart.x + (insetInnerEnd.x - insetInnerStart.x) * ratio,
                  y: insetInnerStart.y + (insetInnerEnd.y - insetInnerStart.y) * ratio,
                }
                const bottomPoint = {
                  x: insetOuterStart.x + (insetOuterEnd.x - insetOuterStart.x) * ratio,
                  y: insetOuterStart.y + (insetOuterEnd.y - insetOuterStart.y) * ratio,
                }
                const midPoint = {
                  x: (topPoint.x + bottomPoint.x) / 2,
                  y: (topPoint.y + bottomPoint.y) / 2,
                }
                const mullionHalf = normalLength * 0.18

                return (
                  <line
                    key={`${opening.id}-mullion-${ratio}`}
                    stroke={isDeleteHovered ? palette.deleteStroke : symbolStroke}
                    strokeWidth={detailStrokeWidth}
                    vectorEffect="non-scaling-stroke"
                    x1={toSvgX(midPoint.x - normalX * mullionHalf)}
                    x2={toSvgX(midPoint.x + normalX * mullionHalf)}
                    y1={toSvgY(midPoint.y - normalY * mullionHalf)}
                    y2={toSvgY(midPoint.y + normalY * mullionHalf)}
                  />
                )
              })}
              {isSelected ? (
                <>
                  <circle
                    cx={toSvgX(markerX)}
                    cy={toSvgY(markerY)}
                    fill="#f97316"
                    r="0.1"
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle
                    cx={toSvgX(markerX)}
                    cy={toSvgY(markerY)}
                    fill="none"
                    r="0.17"
                    stroke="rgba(249, 115, 22, 0.4)"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle
                    cx={toSvgX(markerX)}
                    cy={toSvgY(markerY)}
                    fill="none"
                    r="0.17"
                    stroke="#ffffff"
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                  />
                </>
              ) : null}
            </g>
          )
        }

        if (opening.type === 'door') {
          if (polygon.length < 4) return null
          if (!centerLine) return null
          const [p1, p2, p3, p4] = polygon
          const svgP1 = toSvgPoint(p1!)
          const svgP2 = toSvgPoint(p2!)
          const svgP3 = toSvgPoint(p3!)
          const svgP4 = toSvgPoint(p4!)
          const centerX = (p1!.x + p2!.x + p3!.x + p4!.x) / 4
          const centerY = (p1!.y + p2!.y + p3!.y + p4!.y) / 4
          const cx = toSvgX(centerX)
          const cy = toSvgY(centerY)

          const dirX = svgP2.x - svgP1.x
          const dirY = svgP2.y - svgP1.y
          const len = Math.sqrt(dirX * dirX + dirY * dirY)
          const nx = dirX / len
          const ny = dirY / len

          const px = -ny
          const py = nx

          const hingesSide = opening.hingesSide ?? 'left'
          const swingDirection = opening.swingDirection ?? 'inward'
          const width = opening.width
          const doorColor =
            isSelected || isSelectionHighlighted ? '#f97316' : '#3f3f46'
          const swingColor =
            isSelected || isSelectionHighlighted
              ? 'rgba(249, 115, 22, 0.78)'
              : 'rgba(63, 63, 70, 0.35)'
          const openingFill =
            isSelected || isSelectionHighlighted
              ? 'rgba(249, 115, 22, 0.12)'
              : 'rgba(255, 255, 255, 0.96)'
          const sweepFlag =
            hingesSide === 'left'
              ? swingDirection === 'inward'
                ? 0
                : 1
              : swingDirection === 'inward'
                ? 1
                : 0

          const hx = cx - nx * (width / 2) * (hingesSide === 'left' ? 1 : -1)
          const hy = cy - ny * (width / 2) * (hingesSide === 'left' ? 1 : -1)

          const ox = hx + px * width * (swingDirection === 'inward' ? 1 : -1)
          const oy = hy + py * width * (swingDirection === 'inward' ? 1 : -1)

          const ox2 = cx + nx * (width / 2) * (hingesSide === 'left' ? 1 : -1)
          const oy2 = cy + ny * (width / 2) * (hingesSide === 'left' ? 1 : -1)

          return (
            <g
              key={opening.id}
              onClick={
                canSelectGeometry
                  ? (event) => {
                      event.stopPropagation()
                      onOpeningSelect(opening.id, event)
                    }
                  : undefined
              }
              onDoubleClick={
                canFocusGeometry
                  ? (event) => {
                      event.stopPropagation()
                      onOpeningDoubleClick(opening)
                    }
                  : undefined
              }
              onPointerDown={
                canFocusGeometry && isSelected
                  ? (event) => {
                      if (event.button === 0) {
                        onOpeningPointerDown(opening.id, event)
                      }
                    }
                  : undefined
              }
              onPointerEnter={
                canSelectGeometry
                  ? () => {
                      onWallHoverChange(null)
                      onOpeningHoverChange(opening.id)
                    }
                  : undefined
              }
              onPointerLeave={canSelectGeometry ? () => onOpeningHoverChange(null) : undefined}
              style={{ cursor: EDITOR_CURSOR }}
            >
              {canSelectGeometry && (
                <polygon
                  fill="transparent"
                  points={points}
                  pointerEvents="all"
                  stroke="transparent"
                  strokeWidth={FLOORPLAN_OPENING_HIT_STROKE_WIDTH}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              <polygon
                fill={isDeleteHovered ? palette.deleteFill : openingFill}
                points={points}
                stroke={
                  isDeleteHovered
                    ? palette.deleteStroke
                    : doorColor
                }
                strokeOpacity={1}
                strokeWidth={isSelected || isSelectionHighlighted ? '2.25' : '1.25'}
                vectorEffect="non-scaling-stroke"
              />
              {[centerLine.start, centerLine.end].map((point, index) => {
                const svgPoint = toSvgPoint(point)
                const jambSize = 0.18
                return (
                  <line
                    key={`${opening.id}-jamb-${index}`}
                    stroke={isDeleteHovered ? palette.deleteStroke : doorColor}
                    strokeWidth={isSelected || isSelectionHighlighted ? '2.5' : '1.5'}
                    vectorEffect="non-scaling-stroke"
                    x1={svgPoint.x - px * jambSize * 0.5}
                    x2={svgPoint.x + px * jambSize * 0.5}
                    y1={svgPoint.y - py * jambSize * 0.5}
                    y2={svgPoint.y + py * jambSize * 0.5}
                  />
                )
              })}
              <line
                stroke={isDeleteHovered ? palette.deleteStroke : doorColor}
                strokeWidth={isSelected || isSelectionHighlighted ? '2.5' : '1.75'}
                vectorEffect="non-scaling-stroke"
                x1={hx}
                x2={ox}
                y1={hy}
                y2={oy}
              />
              <path
                d={`M ${ox} ${oy} A ${width} ${width} 0 0 ${sweepFlag} ${ox2} ${oy2}`}
                fill="none"
                stroke={isDeleteHovered ? palette.deleteStroke : swingColor}
                strokeWidth={isSelected || isSelectionHighlighted ? '2' : '1.25'}
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={hx}
                cy={hy}
                fill={isDeleteHovered ? palette.deleteStroke : doorColor}
                r="0.055"
                vectorEffect="non-scaling-stroke"
              />
              {isSelected ? (
                <>
                  <circle
                    cx={cx}
                    cy={cy}
                    fill="#f97316"
                    r="0.1"
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle
                    cx={cx}
                    cy={cy}
                    fill="none"
                    r="0.17"
                    stroke="rgba(249, 115, 22, 0.4)"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle
                    cx={cx}
                    cy={cy}
                    fill="none"
                    r="0.17"
                    stroke="#ffffff"
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                  />
                </>
              ) : null}
            </g>
          )
        }

        return null
      })}

      {wallMeasurements.map((measurement) => (
        <g
          className="wall-dimension"
          key={`measurement-${measurement.id}`}
          pointerEvents="none"
          style={{ userSelect: 'none' }}
        >
          <FloorplanMeasurementLine
            stroke={measurement.extensionStroke}
            isSelected={measurement.isSelected}
            palette={palette}
            segment={measurement.extensionStart}
            dashed
          />
          <FloorplanMeasurementLine
            isSelected={measurement.isSelected}
            palette={palette}
            segment={measurement.dimensionLineStart}
            stroke={measurement.stroke}
          />
          <FloorplanMeasurementLine
            isSelected={measurement.isSelected}
            palette={palette}
            segment={measurement.dimensionLineEnd}
            stroke={measurement.stroke}
          />
          <FloorplanMeasurementLine
            stroke={measurement.extensionStroke}
            isSelected={measurement.isSelected}
            palette={palette}
            segment={measurement.extensionEnd}
            dashed
          />
          <FloorplanMeasurementTick
            angleDeg={measurement.labelAngleDeg}
            isSelected={measurement.isSelected}
            palette={palette}
            stroke={measurement.stroke}
            x={measurement.dimensionLineStart.x1}
            y={measurement.dimensionLineStart.y1}
          />
          <FloorplanMeasurementTick
            angleDeg={measurement.labelAngleDeg}
            isSelected={measurement.isSelected}
            palette={palette}
            stroke={measurement.stroke}
            x={measurement.dimensionLineEnd.x2}
            y={measurement.dimensionLineEnd.y2}
          />
          <text
            dominantBaseline="central"
            fill={measurement.labelFill ?? palette.measurementStroke}
            fillOpacity={
              measurement.isSelected
                ? FLOORPLAN_MEASUREMENT_LABEL_OPACITY
                : FLOORPLAN_MEASUREMENT_LABEL_OPACITY * 0.4
            }
            fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
            fontSize={FLOORPLAN_MEASUREMENT_LABEL_FONT_SIZE}
            fontWeight="600"
            textAnchor="middle"
            transform={`rotate(${measurement.labelAngleDeg} ${measurement.labelX} ${measurement.labelY}) translate(0, -0.04)`}
            x={measurement.labelX}
            y={measurement.labelY}
          >
            {measurement.label}
          </text>
        </g>
      ))}
    </>
  )
})

const FloorplanFenceLayer = memo(function FloorplanFenceLayer({
  canFocusGeometry,
  canSelectGeometry,
  fenceEntries,
  highlightedIdSet,
  hoveredFenceId,
  isDeleteMode,
  onFenceDoubleClick,
  onFenceHoverChange,
  onFenceHoverEnter,
  onFencePointerDown,
  onFenceSelect,
  palette,
  selectedIdSet,
}: {
  canFocusGeometry: boolean
  canSelectGeometry: boolean
  fenceEntries: FloorplanFenceEntry[]
  highlightedIdSet: ReadonlySet<string>
  hoveredFenceId: FenceNode['id'] | null
  isDeleteMode: boolean
  onFenceDoubleClick: (fence: FenceNode, event: ReactMouseEvent<SVGElement>) => void
  onFenceHoverChange: (fenceId: FenceNode['id'] | null) => void
  onFenceHoverEnter: (fenceId: FenceNode['id']) => void
  onFencePointerDown: (fenceId: FenceNode['id'], event: ReactPointerEvent<SVGElement>) => void
  onFenceSelect: (fence: FenceNode, event: ReactMouseEvent<SVGElement>) => void
  palette: FloorplanPalette
  selectedIdSet: ReadonlySet<string>
}) {
  if (fenceEntries.length === 0) {
    return null
  }

  return (
    <>
      {fenceEntries.map(({ fence, markerFrames, path }) => {
        const isSelected = selectedIdSet.has(fence.id)
        const isHighlighted = highlightedIdSet.has(fence.id)
        const isHovered = hoveredFenceId === fence.id
        const isDeleteHovered = isDeleteMode && isHovered
        const isActive = isSelected || isHighlighted
        const showInteractiveChrome = isActive || isHovered
        const fenceStroke = isDeleteHovered
          ? palette.deleteStroke
          : isActive
            ? palette.selectedStroke
            : isHovered
              ? palette.wallHoverStroke
              : '#111827'
        const fenceAccent = fenceStroke
        const fenceUnderlayStroke = isDeleteHovered ? palette.surface : 'rgba(255, 255, 255, 0.98)'
        const fenceGlowStroke = isDeleteHovered
          ? palette.deleteStroke
          : isActive
            ? palette.selectedStroke
            : palette.wallHoverStroke
        const fenceGlowOpacity = isDeleteHovered ? 0.18 : isActive ? 0.22 : isHovered ? 0.14 : 0
        const fenceUnderlayWidth = isActive ? '6.5' : isHovered ? '6' : '5.2'
        const fenceStrokeWidth = isActive ? '2.6' : isHovered ? '2.35' : '2.05'
        const privacyMarkerWidth = clamp(fence.postSize * 0.58, 0.038, 0.068)
        const privacyMarkerHeight = clamp(Math.max(fence.baseHeight * 0.5, fence.postSize * 1.4), 0.1, 0.17)
        const railMarkerRadius = clamp(fence.postSize * 0.52, 0.048, 0.078)
        const slatMarkerHalf = clamp(fence.postSize * 0.42, 0.03, 0.055)
        const markerStrokeWidth = isActive ? '1.65' : '1.35'

        return (
          <g
            key={fence.id}
            onPointerEnter={canSelectGeometry ? () => onFenceHoverEnter(fence.id) : undefined}
            onPointerLeave={canSelectGeometry ? () => onFenceHoverChange(null) : undefined}
          >
            {showInteractiveChrome ? (
              <path
                d={path}
                fill="none"
                pointerEvents="none"
                stroke={fenceGlowStroke}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeOpacity={fenceGlowOpacity}
                strokeWidth={isActive ? '9.5' : '8.2'}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            <path
              d={path}
              fill="none"
              pointerEvents="none"
              stroke={fenceUnderlayStroke}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeOpacity={0.98}
              strokeWidth={fenceUnderlayWidth}
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={path}
              fill="none"
              pointerEvents="none"
              stroke={fenceStroke}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={fenceStrokeWidth}
              vectorEffect="non-scaling-stroke"
            />
            {markerFrames.map(({ angleDeg, point }, markerIndex) => {
              const svgPoint = toSvgPoint(point)

              if (fence.style === 'privacy') {
                return (
                  <g
                    key={`${fence.id}:marker:${markerIndex}`}
                    pointerEvents="none"
                    transform={`translate(${svgPoint.x} ${svgPoint.y}) rotate(${angleDeg})`}
                  >
                    <rect
                      fill={palette.surface}
                      height={privacyMarkerHeight + 0.038}
                      rx="0.014"
                      width={privacyMarkerWidth + 0.032}
                      x={-(privacyMarkerWidth + 0.032) / 2}
                      y={-(privacyMarkerHeight + 0.038) / 2}
                    />
                    <rect
                      fill={fenceAccent}
                      height={privacyMarkerHeight}
                      rx="0.01"
                      width={privacyMarkerWidth}
                      x={-privacyMarkerWidth / 2}
                      y={-privacyMarkerHeight / 2}
                    />
                  </g>
                )
              }

              if (fence.style === 'rail') {
                return (
                  <g key={`${fence.id}:marker:${markerIndex}`} pointerEvents="none">
                    <circle
                      cx={svgPoint.x}
                      cy={svgPoint.y}
                      fill={palette.surface}
                      r={railMarkerRadius + 0.018}
                    />
                    <circle
                      cx={svgPoint.x}
                      cy={svgPoint.y}
                      fill={palette.surface}
                      r={railMarkerRadius}
                      stroke={fenceAccent}
                      strokeWidth={markerStrokeWidth}
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle
                      cx={svgPoint.x}
                      cy={svgPoint.y}
                      fill={fenceAccent}
                      fillOpacity={isActive ? 0.24 : 0.18}
                      r={railMarkerRadius * 0.34}
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                )
              }

              return (
                <g
                  key={`${fence.id}:marker:${markerIndex}`}
                  pointerEvents="none"
                  transform={`translate(${svgPoint.x} ${svgPoint.y}) rotate(${angleDeg})`}
                >
                  <line
                    stroke={palette.surface}
                    strokeLinecap="round"
                    strokeWidth="2.8"
                    vectorEffect="non-scaling-stroke"
                    x1={-slatMarkerHalf}
                    x2={slatMarkerHalf}
                    y1={-slatMarkerHalf}
                    y2={slatMarkerHalf}
                  />
                  <line
                    stroke={palette.surface}
                    strokeLinecap="round"
                    strokeWidth="2.8"
                    vectorEffect="non-scaling-stroke"
                    x1={slatMarkerHalf}
                    x2={-slatMarkerHalf}
                    y1={-slatMarkerHalf}
                    y2={slatMarkerHalf}
                  />
                  <line
                    stroke={fenceAccent}
                    strokeLinecap="round"
                    strokeWidth={markerStrokeWidth}
                    vectorEffect="non-scaling-stroke"
                    x1={-slatMarkerHalf}
                    x2={slatMarkerHalf}
                    y1={-slatMarkerHalf}
                    y2={slatMarkerHalf}
                  />
                  <line
                    stroke={fenceAccent}
                    strokeLinecap="round"
                    strokeWidth={markerStrokeWidth}
                    vectorEffect="non-scaling-stroke"
                    x1={slatMarkerHalf}
                    x2={-slatMarkerHalf}
                    y1={-slatMarkerHalf}
                    y2={slatMarkerHalf}
                  />
                </g>
              )
            })}
            <path
              d={path}
              fill="none"
              onClick={
                canSelectGeometry
                  ? (event) => {
                      event.stopPropagation()
                      onFenceSelect(fence, event)
                    }
                  : undefined
              }
              onDoubleClick={
                canFocusGeometry
                  ? (event) => {
                      event.stopPropagation()
                      onFenceDoubleClick(fence, event)
                    }
                  : undefined
              }
              onPointerDown={
                canSelectGeometry && isSelected
                  ? (event) => {
                      if (event.button === 0) {
                        onFencePointerDown(fence.id, event)
                      }
                    }
                  : undefined
              }
              pointerEvents={canSelectGeometry ? 'stroke' : 'none'}
              stroke="transparent"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={FLOORPLAN_OPENING_HIT_STROKE_WIDTH}
              style={canSelectGeometry ? { cursor: EDITOR_CURSOR } : undefined}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        )
      })}
    </>
  )
})

const FloorplanRoofLayer = memo(function FloorplanRoofLayer({
  highlightedIdSet,
  roofEntries,
  selectedIdSet,
}: {
  highlightedIdSet: ReadonlySet<string>
  roofEntries: FloorplanRoofEntry[]
  selectedIdSet: ReadonlySet<string>
}) {
  if (roofEntries.length === 0) {
    return null
  }

  return (
    <>
      {roofEntries.map(({ roof, segments }) => {
        const roofSelected = selectedIdSet.has(roof.id)
        const roofHighlighted = highlightedIdSet.has(roof.id)
        const hasSelectedSegment = segments.some(({ segment }) => selectedIdSet.has(segment.id))
        const hasHighlightedSegment = segments.some(({ segment }) =>
          highlightedIdSet.has(segment.id),
        )
        const isRoofActive =
          roofSelected || roofHighlighted || hasSelectedSegment || hasHighlightedSegment

        return (
          <g key={roof.id} pointerEvents="none">
            {segments.map(({ points, ridgeLine, segment }) => {
              const isSegmentSelected = selectedIdSet.has(segment.id)
              const isSegmentHighlighted = highlightedIdSet.has(segment.id)
              const isSegmentActive = isSegmentSelected || isSegmentHighlighted

              return (
                <g key={segment.id}>
                  <polygon
                    fill={
                      isSegmentActive
                        ? 'rgba(14, 165, 233, 0.2)'
                        : isRoofActive
                          ? 'rgba(14, 165, 233, 0.14)'
                          : 'rgba(14, 165, 233, 0.08)'
                    }
                    points={points}
                    stroke={
                      isSegmentActive
                        ? '#0369a1'
                        : isRoofActive
                          ? '#0ea5e9'
                          : 'rgba(14, 165, 233, 0.65)'
                    }
                    strokeWidth={isSegmentActive ? '2.25' : isRoofActive ? '1.75' : '1.1'}
                    vectorEffect="non-scaling-stroke"
                  />
                  {ridgeLine ? (
                    <line
                      fill="none"
                      stroke={isSegmentActive ? '#0f172a' : 'rgba(3, 105, 161, 0.75)'}
                      strokeWidth={isSegmentActive ? '2' : '1.4'}
                      vectorEffect="non-scaling-stroke"
                      x1={toSvgX(ridgeLine.start.x)}
                      x2={toSvgX(ridgeLine.end.x)}
                      y1={toSvgY(ridgeLine.start.y)}
                      y2={toSvgY(ridgeLine.end.y)}
                    />
                  ) : null}
                </g>
              )
            })}
          </g>
        )
      })}
    </>
  )
})

const FloorplanNodeLayer = memo(function FloorplanNodeLayer({
  canFocusItems,
  canFocusStairs,
  canSelectItems,
  canSelectStairs,
  highlightedIdSet,
  hoveredItemId,
  hoveredStairId,
  isDeleteMode,
  isFurnishContextActive,
  itemEntries,
  onItemDoubleClick,
  onItemHoverChange,
  onItemHoverEnter,
  onItemPointerDown,
  onItemSelect,
  onStairDoubleClick,
  onStairHoverChange,
  onStairHoverEnter,
  onStairPointerDown,
  onStairSelect,
  palette,
  selectedIdSet,
  stairEntries,
}: {
  canFocusItems: boolean
  canFocusStairs: boolean
  canSelectItems: boolean
  canSelectStairs: boolean
  highlightedIdSet: ReadonlySet<string>
  hoveredItemId: ItemNode['id'] | null
  hoveredStairId: StairNode['id'] | null
  isDeleteMode: boolean
  isFurnishContextActive: boolean
  itemEntries: FloorplanItemEntry[]
  onItemDoubleClick: (item: ItemNode, event: ReactMouseEvent<SVGElement>) => void
  onItemHoverChange: (itemId: ItemNode['id'] | null) => void
  onItemHoverEnter: (itemId: ItemNode['id']) => void
  onItemPointerDown: (itemId: ItemNode['id'], event: ReactPointerEvent<SVGElement>) => void
  onItemSelect: (itemId: ItemNode['id'], event: ReactMouseEvent<SVGElement>) => void
  onStairDoubleClick: (stair: StairNode, event: ReactMouseEvent<SVGElement>) => void
  onStairHoverChange: (stairId: StairNode['id'] | null) => void
  onStairHoverEnter: (stairId: StairNode['id']) => void
  onStairPointerDown: (stairId: StairNode['id'], event: ReactPointerEvent<SVGElement>) => void
  onStairSelect: (stairId: StairNode['id'], event: ReactMouseEvent<SVGElement>) => void
  palette: FloorplanPalette
  selectedIdSet: ReadonlySet<string>
  stairEntries: FloorplanStairEntry[]
}) {
  if (itemEntries.length === 0 && stairEntries.length === 0) {
    return null
  }

  const stairNodes = stairEntries.map(({ arrow, hitPolygons, stair, segments }) => {
    const stairSelected = selectedIdSet.has(stair.id)
    const stairHighlighted = highlightedIdSet.has(stair.id)
    const segmentSelected = segments.some(({ segment }) => selectedIdSet.has(segment.id))
    const segmentHighlighted = segments.some(({ segment }) => highlightedIdSet.has(segment.id))
    const isHovered = hoveredStairId === stair.id
    const isDeleteHovered = isDeleteMode && isHovered
    const isSelectionActive =
      stairSelected || stairHighlighted || segmentSelected || segmentHighlighted
    const stairType = stair.stairType ?? 'straight'
    const normalizedSweepAngle = (() => {
      const baseSweepAngle =
        stair.sweepAngle ?? (stairType === 'spiral' ? Math.PI * 2 : Math.PI / 2)
      if (Math.abs(baseSweepAngle) >= Math.PI * 2) {
        return Math.sign(baseSweepAngle || 1) * (Math.PI * 2 - 0.001)
      }
      return baseSweepAngle
    })()
    const sectorStartAngle = stair.rotation - normalizedSweepAngle / 2
    const sectorEndAngle = sectorStartAngle + normalizedSweepAngle
    const stairCenter = {
      x: stair.position[0],
      y: stair.position[2],
    }
    const innerRadius = Math.max(
      stairType === 'spiral' ? 0.05 : 0.2,
      stair.innerRadius ?? (stairType === 'spiral' ? 0.2 : 0.9),
    )
    const outerRadius = innerRadius + stair.width
    const centerlineRadius = innerRadius + stair.width / 2
    const curvedStroke = isDeleteHovered
      ? palette.deleteStroke
      : isSelectionActive
        ? '#2563eb'
        : 'rgba(31, 41, 55, 0.9)'
    const curvedAccent = isDeleteHovered
      ? palette.deleteStroke
      : isSelectionActive
        ? '#1d4ed8'
        : 'rgba(23, 23, 23, 0.96)'
    const curvedFill = isDeleteHovered
      ? palette.deleteFill
      : isSelectionActive
        ? 'rgba(59, 130, 246, 0.16)'
        : '#ffffff'
    const straightAccent = isDeleteHovered
      ? palette.deleteStroke
      : isSelectionActive
        ? '#1d4ed8'
        : 'rgba(23, 23, 23, 0.96)'
    const straightStroke = isDeleteHovered
      ? palette.deleteStroke
      : isSelectionActive
        ? '#1d4ed8'
        : 'rgba(23, 23, 23, 0.88)'
    const straightTread = isDeleteHovered
      ? palette.deleteStroke
      : isSelectionActive
        ? 'rgba(37, 99, 235, 0.78)'
        : 'rgba(38, 38, 38, 0.62)'
    const straightFill = isDeleteHovered
      ? palette.deleteFill
      : isSelectionActive
        ? 'rgba(59, 130, 246, 0.08)'
        : 'rgba(255, 255, 255, 0.02)'
    const curvedOuterLineWidth = isSelectionActive ? '2' : '1.4'
    const curvedInnerLineWidth = isSelectionActive ? '1.7' : '1.2'
    const stairSymbol =
      stairType === 'spiral' ? (
        <>
          <path
            d={buildSvgAnnularSectorPath(
              stairCenter,
              innerRadius,
              outerRadius,
              sectorStartAngle,
              sectorEndAngle,
            )}
            fill={curvedFill}
            pointerEvents="none"
          />
          <path
            d={buildSvgArcPath(stairCenter, outerRadius, sectorStartAngle, sectorEndAngle)}
            fill="none"
            pointerEvents="none"
            stroke={curvedStroke}
            strokeWidth={curvedOuterLineWidth}
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={buildSvgArcPath(stairCenter, innerRadius, sectorStartAngle, sectorEndAngle)}
            fill="none"
            pointerEvents="none"
            stroke={curvedStroke}
            strokeWidth={curvedInnerLineWidth}
            vectorEffect="non-scaling-stroke"
          />
          {Array.from({ length: Math.max(6, stair.stepCount) }, (_, index) => {
            const stepCount = Math.max(6, stair.stepCount)
            const stepSweep = normalizedSweepAngle / stepCount
            const angle = sectorStartAngle + stepSweep * index
            const innerPoint = getArcPlanPoint(stairCenter, innerRadius, angle)
            const outerPoint = getArcPlanPoint(stairCenter, outerRadius, angle)
            const dashedFromIndex = Math.floor(stepCount * 0.68)

            return (
              <line
                key={`${stair.id}:spiral-step:${index}`}
                pointerEvents="none"
                stroke={index === stepCount - 1 ? curvedAccent : curvedStroke}
                strokeDasharray={index >= dashedFromIndex ? '0.1 0.08' : undefined}
                strokeWidth={index === stepCount - 1 ? '1.8' : '1.15'}
                vectorEffect="non-scaling-stroke"
                x1={toSvgX(innerPoint.x)}
                x2={toSvgX(outerPoint.x)}
                y1={toSvgY(innerPoint.y)}
                y2={toSvgY(outerPoint.y)}
              />
            )
          })}
          <circle
            cx={toSvgX(stairCenter.x)}
            cy={toSvgY(stairCenter.y)}
            fill="#ffffff"
            pointerEvents="none"
            r={Math.max(innerRadius * 0.18, 0.06)}
            stroke={curvedAccent}
            strokeWidth="1.2"
            vectorEffect="non-scaling-stroke"
          />
          {(() => {
            const directionAngle = sectorStartAngle + normalizedSweepAngle * 0.86
            const arrowPoint = getArcPlanPoint(stairCenter, centerlineRadius, directionAngle)
            const tangentAngle =
              directionAngle + (normalizedSweepAngle >= 0 ? Math.PI / 2 : -Math.PI / 2)
            const arrowHead = buildFloorplanArrowHead(
              arrowPoint,
              tangentAngle,
              clamp(stair.width * 0.18, 0.12, 0.18),
            )

            return (
              <polygon
                fill={curvedAccent}
                key={`${stair.id}:spiral-arrow`}
                pointerEvents="none"
                points={arrowHead.points}
              />
            )
          })()}
        </>
      ) : stairType === 'curved' ? (
        <>
          <path
            d={buildSvgAnnularSectorPath(
              stairCenter,
              innerRadius,
              outerRadius,
              sectorStartAngle,
              sectorEndAngle,
            )}
            fill={curvedFill}
            pointerEvents="none"
          />
          <path
            d={buildSvgArcPath(stairCenter, outerRadius, sectorStartAngle, sectorEndAngle)}
            fill="none"
            pointerEvents="none"
            stroke={curvedStroke}
            strokeWidth={curvedOuterLineWidth}
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={buildSvgArcPath(stairCenter, innerRadius, sectorStartAngle, sectorEndAngle)}
            fill="none"
            pointerEvents="none"
            stroke={curvedStroke}
            strokeWidth={curvedInnerLineWidth}
            vectorEffect="non-scaling-stroke"
          />
          {Array.from({ length: Math.max(4, stair.stepCount) + 1 }, (_, index) => {
            const stepCount = Math.max(4, stair.stepCount)
            const stepSweep = normalizedSweepAngle / stepCount
            const angle = sectorStartAngle + stepSweep * index
            const innerPoint = getArcPlanPoint(stairCenter, innerRadius, angle)
            const outerPoint = getArcPlanPoint(stairCenter, outerRadius, angle)

            return (
              <line
                key={`${stair.id}:curved-step:${index}`}
                pointerEvents="none"
                stroke={curvedStroke}
                strokeWidth={index === 0 || index === stepCount ? '1.5' : '1.1'}
                vectorEffect="non-scaling-stroke"
                x1={toSvgX(innerPoint.x)}
                x2={toSvgX(outerPoint.x)}
                y1={toSvgY(innerPoint.y)}
                y2={toSvgY(outerPoint.y)}
              />
            )
          })}
          <path
            d={buildSvgArcPath(
              stairCenter,
              centerlineRadius,
              sectorStartAngle + normalizedSweepAngle / Math.max(4, stair.stepCount) * 0.55,
              sectorEndAngle - normalizedSweepAngle / Math.max(4, stair.stepCount) * 0.55,
            )}
            fill="none"
            pointerEvents="none"
            stroke={curvedAccent}
            strokeDasharray="0.08 0.11"
            strokeWidth="1.1"
            vectorEffect="non-scaling-stroke"
          />
          {(() => {
            const stepCount = Math.max(4, stair.stepCount)
            const stepSweep = normalizedSweepAngle / stepCount
            const arrowAngle = sectorEndAngle - stepSweep * 0.8
            const arrowPoint = getArcPlanPoint(stairCenter, centerlineRadius, arrowAngle)
            const tangentAngle =
              arrowAngle + (normalizedSweepAngle >= 0 ? Math.PI / 2 : -Math.PI / 2)
            const arrowHead = buildFloorplanArrowHead(
              arrowPoint,
              tangentAngle,
              clamp(stair.width * 0.16, 0.1, 0.16),
            )

            return (
              <polygon
                fill={curvedAccent}
                key={`${stair.id}:curved-arrow`}
                pointerEvents="none"
                points={arrowHead.points}
              />
            )
          })()}
        </>
      ) : (
        <>
          {segments.map(({ points, segment, treadBars }) => (
            <g key={segment.id}>
              <polygon
                fill={straightFill}
                pointerEvents="none"
                points={points}
                stroke={straightStroke}
                strokeWidth={isSelectionActive ? '2' : '1.35'}
                vectorEffect="non-scaling-stroke"
              />
              {treadBars.map((treadBar, treadIndex) => (
                <polygon
                  fill={straightTread}
                  key={`${segment.id}:tread:${treadIndex}`}
                  pointerEvents="none"
                  points={segment.segmentType === 'landing' ? '' : treadBar.points}
                />
              ))}
            </g>
          ))}
          {arrow?.polyline && arrow.polyline.length >= 2 && (
            <>
              <polyline
                fill="none"
                points={arrow.polyline.map((point) => `${toSvgX(point.x)},${toSvgY(point.y)}`).join(' ')}
                pointerEvents="none"
                stroke={straightAccent}
                strokeWidth="1.15"
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={toSvgX(arrow.polyline[0]!.x)}
                cy={toSvgY(arrow.polyline[0]!.y)}
                fill={straightAccent}
                pointerEvents="none"
                r="0.045"
              />
              <polygon
                fill={straightAccent}
                points={formatPolygonPoints(arrow.head)}
                pointerEvents="none"
              />
            </>
          )}
        </>
      )

    return (
      <g
        key={stair.id}
        onClick={
          canSelectStairs
            ? (event) => {
                event.stopPropagation()
                onStairSelect(stair.id, event)
              }
            : undefined
        }
        onDoubleClick={
          canFocusStairs
            ? (event) => {
                event.stopPropagation()
                onStairDoubleClick(stair, event)
              }
            : undefined
        }
        onPointerEnter={canSelectStairs ? () => onStairHoverEnter(stair.id) : undefined}
        onPointerLeave={canSelectStairs ? () => onStairHoverChange(null) : undefined}
        onPointerDown={
          canFocusStairs && stairSelected
            ? (event) => {
                if (event.button === 0) {
                  onStairPointerDown(stair.id, event)
                }
              }
            : undefined
        }
        pointerEvents={canSelectStairs ? undefined : 'none'}
        style={canSelectStairs ? { cursor: EDITOR_CURSOR } : undefined}
      >
        {hitPolygons.map((polygon, polygonIndex) => (
          <polygon
            fill="transparent"
            key={`${stair.id}:hit:${polygonIndex}`}
            points={formatPolygonPoints(polygon)}
            pointerEvents={canSelectStairs ? 'all' : 'none'}
            stroke="transparent"
            strokeLinejoin="round"
            strokeWidth={FLOORPLAN_OPENING_HIT_STROKE_WIDTH}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <title>{stair.name || 'Staircase'}</title>
        {stairSymbol}
      </g>
    )
  })

  const itemNodes = itemEntries.map(({ item, points, polygon }) => {
    const isSelected = selectedIdSet.has(item.id)
    const isHighlighted = highlightedIdSet.has(item.id)
    const isHovered = hoveredItemId === item.id
    const isDeleteHovered = isDeleteMode && isHovered
    const isSelectionActive = isSelected || isHighlighted
    const showHighlight = isDeleteHovered || isSelectionActive || isHovered
    const stroke = isDeleteHovered
      ? palette.deleteStroke
      : isSelectionActive
        ? palette.selectedStroke
        : palette.openingStroke
    const highlightStroke = isDeleteHovered
      ? palette.deleteStroke
      : isSelectionActive
        ? palette.selectedStroke
        : palette.wallHoverStroke
    const fill = isDeleteHovered
      ? palette.deleteFill
      : isSelectionActive
        ? palette.selectedFill
        : palette.openingFill
    const crossStrokeOpacity = isDeleteHovered
      ? 0.76
      : isSelectionActive
        ? 0.72
        : isHovered
          ? 0.58
          : 0.52
    const diagonalAStart = polygon[0]
    const diagonalAEnd = polygon[2]
    const diagonalBStart = polygon[1]
    const diagonalBEnd = polygon[3]

    return (
      <g
        key={item.id}
        onClick={
          canSelectItems
            ? (event) => {
                event.stopPropagation()
                onItemSelect(item.id, event)
              }
            : undefined
        }
        onDoubleClick={
          canFocusItems
            ? (event) => {
                event.stopPropagation()
                onItemDoubleClick(item, event)
              }
            : undefined
        }
        onPointerDown={
          canFocusItems && isSelected
            ? (event) => {
                if (event.button === 0) {
                  onItemPointerDown(item.id, event)
                }
              }
            : undefined
        }
        onPointerEnter={canSelectItems ? () => onItemHoverEnter(item.id) : undefined}
        onPointerLeave={canSelectItems ? () => onItemHoverChange(null) : undefined}
        pointerEvents={canSelectItems ? undefined : 'none'}
        style={canSelectItems ? { cursor: EDITOR_CURSOR } : undefined}
      >
        <title>{item.name || item.asset.name}</title>
        <polygon
          fill="none"
          pointerEvents="none"
          points={points}
          stroke={highlightStroke}
          strokeLinejoin="round"
          strokeOpacity={isDeleteHovered || isSelectionActive ? 0.22 : 0.16}
          strokeWidth={FLOORPLAN_WALL_HOVER_GLOW_STROKE_WIDTH}
          style={{
            opacity: showHighlight ? 1 : 0,
            transition: FLOORPLAN_HOVER_TRANSITION,
          }}
          vectorEffect="non-scaling-stroke"
        />
        <polygon
          fill="none"
          pointerEvents="none"
          points={points}
          stroke={highlightStroke}
          strokeLinejoin="round"
          strokeOpacity={isDeleteHovered || isSelectionActive ? 0.6 : 0.48}
          strokeWidth={FLOORPLAN_WALL_HOVER_RING_STROKE_WIDTH}
          style={{
            opacity: showHighlight ? 1 : 0,
            transition: FLOORPLAN_HOVER_TRANSITION,
          }}
          vectorEffect="non-scaling-stroke"
        />
        <polygon
          fill={fill}
          fillOpacity={
            isDeleteHovered
              ? 0.16
              : isSelectionActive
                ? 0.1
                : isHovered
                  ? isFurnishContextActive
                    ? 0.045
                    : 0.03
                  : isFurnishContextActive
                    ? 0.03
                    : 0.015
          }
          points={points}
          stroke={stroke}
          strokeLinejoin="round"
          strokeOpacity={1}
          strokeWidth={FLOORPLAN_NODE_FOOTPRINT_STROKE_WIDTH}
        />
        {diagonalAStart && diagonalAEnd && (
          <line
            pointerEvents="none"
            stroke={stroke}
            strokeLinecap="round"
            strokeOpacity={crossStrokeOpacity}
            strokeWidth={FLOORPLAN_NODE_FOOTPRINT_CROSS_STROKE_WIDTH}
            x1={toSvgX(diagonalAStart.x)}
            x2={toSvgX(diagonalAEnd.x)}
            y1={toSvgY(diagonalAStart.y)}
            y2={toSvgY(diagonalAEnd.y)}
          />
        )}
        {diagonalBStart && diagonalBEnd && (
          <line
            pointerEvents="none"
            stroke={stroke}
            strokeLinecap="round"
            strokeOpacity={crossStrokeOpacity}
            strokeWidth={FLOORPLAN_NODE_FOOTPRINT_CROSS_STROKE_WIDTH}
            x1={toSvgX(diagonalBStart.x)}
            x2={toSvgX(diagonalBEnd.x)}
            y1={toSvgY(diagonalBStart.y)}
            y2={toSvgY(diagonalBEnd.y)}
          />
        )}
      </g>
    )
  })

  return (
    <>{isFurnishContextActive ? [...stairNodes, ...itemNodes] : [...itemNodes, ...stairNodes]}</>
  )
})

const FloorplanSiteLayer = memo(function FloorplanSiteLayer({
  isEditing,
  sitePolygon,
}: {
  isEditing: boolean
  sitePolygon: SitePolygonEntry | null
}) {
  if (!sitePolygon) {
    return null
  }

  return (
    <polygon
      fill={FLOORPLAN_SITE_COLOR}
      fillOpacity={isEditing ? 0.12 : 0.08}
      pointerEvents="none"
      points={sitePolygon.points}
      stroke={FLOORPLAN_SITE_COLOR}
      strokeDasharray={isEditing ? '0.16 0.1' : undefined}
      strokeLinejoin="round"
      strokeOpacity={isEditing ? 0.92 : 0.72}
      strokeWidth={isEditing ? '0.08' : '0.06'}
      vectorEffect="non-scaling-stroke"
    />
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

/** Compute polygon centroid using the shoelace formula */
const polygonCentroid = (polygon: Point2D[]): { x: number; y: number } => {
  let signedArea = 0
  let cx = 0
  let cy = 0

  for (let i = 0; i < polygon.length; i++) {
    const p0 = polygon[i]!
    const p1 = polygon[(i + 1) % polygon.length]!
    const cross = p0.x * p1.y - p1.x * p0.y
    signedArea += cross
    cx += (p0.x + p1.x) * cross
    cy += (p0.y + p1.y) * cross
  }

  signedArea /= 2
  const factor = 1 / (6 * signedArea)
  return { x: cx * factor, y: cy * factor }
}

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
  }, [zone.name])

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

const FloorplanZoneLabelLayer = memo(function FloorplanZoneLabelLayer({
  onLabelHoverChange,
  onZoneLabelClick,
  selectedZoneId,
  svgRef,
  viewBox,
  zonePolygons,
}: {
  onLabelHoverChange: (zoneId: ZoneNodeType['id'] | null) => void
  onZoneLabelClick: (zoneId: ZoneNodeType['id'], event: ReactMouseEvent<SVGElement>) => void
  selectedZoneId: ZoneNodeType['id'] | null
  svgRef: React.RefObject<SVGSVGElement | null>
  viewBox: { minX: number; minY: number; width: number; height: number }
  zonePolygons: ZonePolygonEntry[]
}) {
  const [editingZoneId, setEditingZoneId] = useState<ZoneNodeType['id'] | null>(null)

  // Listen for edit-label events (from 2D label click or external triggers)
  useEffect(() => {
    const handler = (event: { zoneId: string }) => {
      setEditingZoneId(event.zoneId as ZoneNodeType['id'])
    }
    emitter.on('zone:edit-label' as any, handler as any)
    return () => {
      emitter.off('zone:edit-label' as any, handler as any)
    }
  }, [])

  // Clear editing when selection changes away
  useEffect(() => {
    if (editingZoneId && selectedZoneId !== editingZoneId) {
      setEditingZoneId(null)
    }
  }, [selectedZoneId, editingZoneId])

  return (
    <>
      {zonePolygons.map(({ zone, polygon }) => {
        if (polygon.length < 3) return null
        const rawCentroid = polygonCentroid(polygon)
        const centroid = toSvgPoint(rawCentroid)
        const isEditing = editingZoneId === zone.id

        if (isEditing) {
          return (
            <FloorplanZoneLabelInput
              centroid={centroid}
              key={zone.id}
              onDone={() => setEditingZoneId(null)}
              svgRef={svgRef}
              viewBox={viewBox}
              zone={zone}
            />
          )
        }

        return (
          <FloorplanZoneLabel
            centroid={centroid}
            key={zone.id}
            onHoverChange={onLabelHoverChange}
            onLabelClick={onZoneLabelClick}
            zone={zone}
          />
        )
      })}
    </>
  )
})

const FloorplanWallEndpointLayer = memo(function FloorplanWallEndpointLayer({
  endpointHandles,
  hoveredEndpointId,
  onWallEndpointPointerDown,
  onEndpointHoverChange,
  palette,
}: {
  endpointHandles: Array<{
    wall: WallNode
    endpoint: WallEndpoint
    point: WallPlanPoint
    isSelected: boolean
    isActive: boolean
  }>
  onWallEndpointPointerDown: (
    wall: WallNode,
    endpoint: WallEndpoint,
    event: ReactPointerEvent<SVGCircleElement>,
  ) => void
  hoveredEndpointId: string | null
  onEndpointHoverChange: (endpointId: string | null) => void
  palette: FloorplanPalette
}) {
  return (
    <>
      {endpointHandles.map(({ wall, endpoint, point, isSelected, isActive }) => {
        const endpointId = `${wall.id}:${endpoint}`
        const isHovered = hoveredEndpointId === endpointId
        const stroke =
          isSelected || isActive ? palette.endpointHandleActiveStroke : palette.endpointHandleStroke
        const hoverStroke =
          isSelected || isActive
            ? palette.endpointHandleActiveStroke
            : palette.endpointHandleHoverStroke
        const outerRadius = isActive ? 0.18 : isSelected ? 0.16 : 0.14
        const svgPoint = toSvgPlanPoint(point)

        return (
          <g
            key={endpointId}
            onClick={(event) => {
              event.stopPropagation()
            }}
            onPointerEnter={() => onEndpointHoverChange(endpointId)}
            onPointerLeave={() => onEndpointHoverChange(null)}
          >
            <circle
              cx={svgPoint.x}
              cy={svgPoint.y}
              fill="none"
              pointerEvents="none"
              r={outerRadius}
              stroke={hoverStroke}
              strokeOpacity={isActive ? 0.24 : 0.16}
              strokeWidth={FLOORPLAN_ENDPOINT_HOVER_GLOW_STROKE_WIDTH}
              style={{
                opacity: isHovered ? 1 : 0,
                transition: FLOORPLAN_HOVER_TRANSITION,
              }}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={svgPoint.x}
              cy={svgPoint.y}
              fill="none"
              pointerEvents="none"
              r={outerRadius}
              stroke={hoverStroke}
              strokeOpacity={isActive ? 0.72 : 0.52}
              strokeWidth={FLOORPLAN_ENDPOINT_HOVER_RING_STROKE_WIDTH}
              style={{
                opacity: isHovered ? 1 : 0,
                transition: FLOORPLAN_HOVER_TRANSITION,
              }}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={svgPoint.x}
              cy={svgPoint.y}
              fill={isActive ? palette.endpointHandleActiveFill : palette.endpointHandleFill}
              fillOpacity={0.96}
              pointerEvents="none"
              r={outerRadius}
              stroke={stroke}
              strokeWidth="0.05"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={svgPoint.x}
              cy={svgPoint.y}
              fill={stroke}
              pointerEvents="none"
              r={isActive ? 0.08 : 0.06}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={svgPoint.x}
              cy={svgPoint.y}
              fill="transparent"
              onPointerDown={(event) => onWallEndpointPointerDown(wall, endpoint, event)}
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
    </>
  )
})

const FloorplanFenceEndpointLayer = memo(function FloorplanFenceEndpointLayer({
  endpointHandles,
  hoveredEndpointId,
  onEndpointHoverChange,
  onFenceEndpointPointerDown,
  palette,
}: {
  endpointHandles: Array<{
    fence: FenceNode
    endpoint: WallEndpoint
    point: WallPlanPoint
    isActive: boolean
    isSelected: boolean
  }>
  hoveredEndpointId: string | null
  onEndpointHoverChange: (endpointId: string | null) => void
  onFenceEndpointPointerDown: (
    fence: FenceNode,
    endpoint: WallEndpoint,
    event: ReactPointerEvent<SVGCircleElement>,
  ) => void
  palette: FloorplanPalette
}) {
  return (
    <>
      {endpointHandles.map(({ fence, endpoint, point, isSelected, isActive }) => {
        const endpointId = `${fence.id}:${endpoint}`
        const isHovered = hoveredEndpointId === endpointId
        const stroke =
          isSelected || isActive ? palette.endpointHandleActiveStroke : palette.endpointHandleStroke
        const hoverStroke =
          isSelected || isActive
            ? palette.endpointHandleActiveStroke
            : palette.endpointHandleHoverStroke
        const outerRadius = isActive ? 0.18 : isSelected ? 0.16 : 0.14
        const svgPoint = toSvgPlanPoint(point)

        return (
          <g
            key={endpointId}
            onClick={(event) => {
              event.stopPropagation()
            }}
            onPointerEnter={() => onEndpointHoverChange(endpointId)}
            onPointerLeave={() => onEndpointHoverChange(null)}
          >
            <circle
              cx={svgPoint.x}
              cy={svgPoint.y}
              fill="none"
              pointerEvents="none"
              r={outerRadius}
              stroke={hoverStroke}
              strokeOpacity={isActive ? 0.24 : 0.16}
              strokeWidth={FLOORPLAN_ENDPOINT_HOVER_GLOW_STROKE_WIDTH}
              style={{
                opacity: isHovered ? 1 : 0,
                transition: FLOORPLAN_HOVER_TRANSITION,
              }}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={svgPoint.x}
              cy={svgPoint.y}
              fill="none"
              pointerEvents="none"
              r={outerRadius}
              stroke={hoverStroke}
              strokeOpacity={isActive ? 0.72 : 0.52}
              strokeWidth={FLOORPLAN_ENDPOINT_HOVER_RING_STROKE_WIDTH}
              style={{
                opacity: isHovered ? 1 : 0,
                transition: FLOORPLAN_HOVER_TRANSITION,
              }}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={svgPoint.x}
              cy={svgPoint.y}
              fill={isActive ? palette.endpointHandleActiveFill : palette.endpointHandleFill}
              fillOpacity={0.96}
              pointerEvents="none"
              r={outerRadius}
              stroke={stroke}
              strokeWidth="0.05"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={svgPoint.x}
              cy={svgPoint.y}
              fill={stroke}
              pointerEvents="none"
              r={isActive ? 0.08 : 0.06}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={svgPoint.x}
              cy={svgPoint.y}
              fill="transparent"
              onPointerDown={(event) => onFenceEndpointPointerDown(fence, endpoint, event)}
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
    </>
  )
})

const FloorplanWallCurveHandleLayer = memo(function FloorplanWallCurveHandleLayer({
  curveHandles,
  hoveredHandleId,
  onHandleHoverChange,
  onWallCurvePointerDown,
  palette,
}: {
  curveHandles: Array<{
    wall: WallNode
    point: WallPlanPoint
    isActive: boolean
  }>
  hoveredHandleId: string | null
  onHandleHoverChange: (handleId: string | null) => void
  onWallCurvePointerDown: (wall: WallNode, event: ReactPointerEvent<SVGCircleElement>) => void
  palette: FloorplanPalette
}) {
  return (
    <>
      {curveHandles.map(({ wall, point, isActive }) => {
        const handleId = `curve:${wall.id}`
        const isHovered = hoveredHandleId === handleId
        const stroke = palette.curveHandleStroke
        const hoverStroke = palette.curveHandleHoverStroke
        const svgPoint = toSvgPlanPoint(point)
        const radius = isActive ? 0.16 : 0.14

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
              r={radius}
              stroke={hoverStroke}
              strokeOpacity={isActive ? 0.24 : 0.16}
              strokeWidth={FLOORPLAN_ENDPOINT_HOVER_GLOW_STROKE_WIDTH}
              style={{
                opacity: isHovered ? 1 : 0,
                transition: FLOORPLAN_HOVER_TRANSITION,
              }}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={svgPoint.x}
              cy={svgPoint.y}
              fill={palette.curveHandleFill}
              fillOpacity={0.96}
              pointerEvents="none"
              r={radius}
              stroke={stroke}
              strokeWidth="0.05"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={svgPoint.x}
              cy={svgPoint.y}
              fill={stroke}
              pointerEvents="none"
              r={0.05}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={svgPoint.x}
              cy={svgPoint.y}
              fill="transparent"
              onPointerDown={(event) => onWallCurvePointerDown(wall, event)}
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

const FloorplanPolygonHandleLayer = memo(function FloorplanPolygonHandleLayer({
  hoveredHandleId,
  midpointHandles,
  onHandleHoverChange,
  onMidpointPointerDown,
  onVertexDoubleClick,
  onVertexPointerDown,
  palette,
  vertexHandles,
}: {
  vertexHandles: Array<{
    nodeId: string
    vertexIndex: number
    point: WallPlanPoint
    isActive: boolean
  }>
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
    event: ReactPointerEvent<SVGCircleElement>,
  ) => void
  onMidpointPointerDown: (
    nodeId: string,
    edgeIndex: number,
    event: ReactPointerEvent<SVGCircleElement>,
  ) => void
  palette: FloorplanPalette
}) {
  return (
    <>
      {vertexHandles.map(({ nodeId, vertexIndex, point, isActive }) => {
        const handleId = `${nodeId}:vertex:${vertexIndex}`
        const isHovered = hoveredHandleId === handleId
        const stroke = isActive ? palette.endpointHandleActiveStroke : palette.endpointHandleStroke
        const outerRadius = isActive ? 0.15 : 0.13
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
                opacity: isHovered ? 1 : 0,
                transition: FLOORPLAN_HOVER_TRANSITION,
              }}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={svgPoint.x}
              cy={svgPoint.y}
              fill={isActive ? palette.endpointHandleActiveFill : palette.endpointHandleFill}
              fillOpacity={0.96}
              pointerEvents="none"
              r={outerRadius}
              stroke={stroke}
              strokeWidth="0.045"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={svgPoint.x}
              cy={svgPoint.y}
              fill={stroke}
              pointerEvents="none"
              r={isActive ? 0.058 : 0.05}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={svgPoint.x}
              cy={svgPoint.y}
              fill="transparent"
              onDoubleClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onVertexDoubleClick(nodeId, vertexIndex, event as any)
              }}
              onPointerDown={(event) => {
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
        const stroke = isHovered ? palette.endpointHandleHoverStroke : palette.endpointHandleStroke
        const radius = isHovered ? 0.092 : 0.08
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
              r={radius + 0.03}
              stroke={stroke}
              strokeOpacity={0.16}
              strokeWidth={FLOORPLAN_ENDPOINT_HOVER_RING_STROKE_WIDTH}
              style={{
                opacity: isHovered ? 1 : 0,
                transition: FLOORPLAN_HOVER_TRANSITION,
              }}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={svgPoint.x}
              cy={svgPoint.y}
              fill={palette.surface}
              fillOpacity={0.94}
              pointerEvents="none"
              r={radius}
              stroke={stroke}
              strokeOpacity={0.9}
              strokeWidth="0.035"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={svgPoint.x}
              cy={svgPoint.y}
              fill={stroke}
              fillOpacity={0.82}
              pointerEvents="none"
              r="0.028"
              vectorEffect="non-scaling-stroke"
            />
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

type FloorplanSiteKeyHandlerProps = {
  onRestoreGroundLevel: () => void
}

const FloorplanSiteKeyHandler = memo(function FloorplanSiteKeyHandler({
  onRestoreGroundLevel,
}: FloorplanSiteKeyHandlerProps) {
  const isFloorplanHovered = useEditor((state) => state.isFloorplanHovered)
  const phase = useEditor((state) => state.phase)
  const setFloorplanSelectionTool = useEditor((state) => state.setFloorplanSelectionTool)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isEditableTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        Boolean(target?.isContentEditable)

      if (
        isEditableTarget ||
        !isFloorplanHovered ||
        phase !== 'site' ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.key.toLowerCase() !== 'v'
      ) {
        return
      }

      setFloorplanSelectionTool('click')
      onRestoreGroundLevel()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [isFloorplanHovered, onRestoreGroundLevel, phase, setFloorplanSelectionTool])

  return null
})

type FloorplanDuplicateHotkeyProps = {
  hasDuplicatable: boolean
  onDuplicateSelected: () => void
}

const FloorplanDuplicateHotkey = memo(function FloorplanDuplicateHotkey({
  hasDuplicatable,
  onDuplicateSelected,
}: FloorplanDuplicateHotkeyProps) {
  const isFloorplanHovered = useEditor((state) => state.isFloorplanHovered)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'c') {
        return
      }

      if (!(isFloorplanHovered && hasDuplicatable)) {
        return
      }

      const target = event.target as HTMLElement | null
      const isEditableTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        Boolean(target?.isContentEditable)

      if (isEditableTarget) {
        return
      }

      event.preventDefault()
      onDuplicateSelected()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [hasDuplicatable, isFloorplanHovered, onDuplicateSelected])

  return null
})

type FloorplanActionMenuHandler = (event: ReactMouseEvent<HTMLButtonElement>) => void

type FloorplanActionMenuEntry = {
  position: SvgPoint | null
  onDelete: FloorplanActionMenuHandler
  onMove: FloorplanActionMenuHandler
  onDuplicate?: FloorplanActionMenuHandler
}

type FloorplanActionMenuLayerProps = {
  item: FloorplanActionMenuEntry
  wall: FloorplanActionMenuEntry
  fence: FloorplanActionMenuEntry
  slab: FloorplanActionMenuEntry
  ceiling: FloorplanActionMenuEntry
  opening: FloorplanActionMenuEntry
  stair: FloorplanActionMenuEntry
  roof: FloorplanActionMenuEntry
}

const FloorplanActionMenuLayer = memo(function FloorplanActionMenuLayer({
  item,
  wall,
  fence,
  slab,
  ceiling,
  opening,
  stair,
  roof,
}: FloorplanActionMenuLayerProps) {
  const isFloorplanHovered = useEditor((state) => state.isFloorplanHovered)
  const movingNode = useEditor((state) => state.movingNode)
  const movingFenceEndpoint = useEditor((state) => state.movingFenceEndpoint)
  const curvingWall = useEditor((state) => state.curvingWall)
  const curvingFence = useEditor((state) => state.curvingFence)

  if (!isFloorplanHovered || movingNode || movingFenceEndpoint || curvingWall || curvingFence) {
    return null
  }

  const entries: FloorplanActionMenuEntry[] = [
    item,
    wall,
    fence,
    slab,
    ceiling,
    opening,
    stair,
    roof,
  ]

  return (
    <>
      {entries.map((entry, index) =>
        entry.position ? (
          <div
            className="absolute z-30"
            key={index}
            style={{
              left: entry.position.x,
              top: entry.position.y,
              transform: `translate(-50%, calc(-100% - ${FLOORPLAN_ACTION_MENU_OFFSET_Y}px))`,
            }}
          >
            <NodeActionMenu
              onDelete={entry.onDelete}
              onDuplicate={entry.onDuplicate}
              onMove={entry.onMove}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerUp={(event) => event.stopPropagation()}
            />
          </div>
        ) : null,
      )}
    </>
  )
})

type FloorplanCursorIndicatorOverlayProps = {
  cursorPosition: SvgPoint | null
  cursorAnchorPosition: SvgPoint | null
  floorplanSelectionTool: FloorplanSelectionTool
  movingOpeningType: 'door' | 'window' | null
  isPanning: boolean
  cursorColor: string
}

const FloorplanCursorIndicatorOverlay = memo(function FloorplanCursorIndicatorOverlay({
  cursorPosition,
  cursorAnchorPosition,
  floorplanSelectionTool,
  movingOpeningType,
  isPanning,
  cursorColor,
}: FloorplanCursorIndicatorOverlayProps) {
  const mode = useEditor((state) => state.mode)
  const tool = useEditor((state) => state.tool)
  const structureLayer = useEditor((state) => state.structureLayer)
  const catalogCategory = useEditor((state) => state.catalogCategory)

  const activeFloorplanToolConfig = useMemo(() => {
    if (movingOpeningType) {
      return structureTools.find((entry) => entry.id === movingOpeningType) ?? null
    }

    if (mode !== 'build' || !tool) {
      return null
    }

    if (tool === 'item' && catalogCategory) {
      return furnishTools.find((entry) => entry.catalogCategory === catalogCategory) ?? null
    }

    return structureTools.find((entry) => entry.id === tool) ?? null
  }, [catalogCategory, mode, movingOpeningType, tool])

  const indicator = useMemo<FloorplanCursorIndicator | null>(() => {
    if (activeFloorplanToolConfig) {
      return { kind: 'asset', iconSrc: activeFloorplanToolConfig.iconSrc }
    }

    if (mode === 'select' && floorplanSelectionTool === 'marquee' && structureLayer !== 'zones') {
      return { kind: 'icon', icon: 'mdi:select-drag' }
    }

    if (mode === 'delete') {
      return { kind: 'icon', icon: 'mdi:trash-can-outline' }
    }

    return null
  }, [activeFloorplanToolConfig, floorplanSelectionTool, mode, structureLayer])

  const position = mode === 'delete' ? cursorPosition : cursorAnchorPosition

  if (!(indicator && position) || isPanning) {
    return null
  }

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-20"
      style={{ left: position.x, top: position.y }}
    >
      {mode === 'delete' ? (
        <div
          className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/5 bg-zinc-900/95 shadow-[0_8px_16px_-4px_rgba(0,0,0,0.3),0_4px_8px_-4px_rgba(0,0,0,0.2)]"
          style={{
            boxShadow: `0 8px 16px -4px rgba(0,0,0,0.3), 0 4px 8px -4px rgba(0,0,0,0.2), 0 0 18px ${cursorColor}22`,
            transform: `translate(${FLOORPLAN_CURSOR_BADGE_OFFSET_X}px, ${FLOORPLAN_CURSOR_BADGE_OFFSET_Y}px)`,
          }}
        >
          {indicator.kind === 'asset' ? (
            <img
              alt=""
              aria-hidden="true"
              className="h-5 w-5 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
              src={indicator.iconSrc}
            />
          ) : (
            <Icon
              aria-hidden="true"
              className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
              color={cursorColor}
              height={18}
              icon={indicator.icon}
              width={18}
            />
          )}
        </div>
      ) : (
        <>
          <div
            className="absolute top-0 left-1/2 w-px -translate-x-1/2 -translate-y-full"
            style={{
              backgroundColor: cursorColor,
              boxShadow: `0 0 12px ${cursorColor}55`,
              height: FLOORPLAN_CURSOR_INDICATOR_LINE_HEIGHT,
            }}
          />
          <div
            className="absolute top-0 left-1/2 flex h-8 w-8 items-center justify-center rounded-xl border border-white/5 bg-zinc-900/95 shadow-[0_8px_16px_-4px_rgba(0,0,0,0.3),0_4px_8px_-4px_rgba(0,0,0,0.2)]"
            style={{
              transform: `translate(-50%, calc(-100% - ${FLOORPLAN_CURSOR_INDICATOR_LINE_HEIGHT}px))`,
            }}
          >
            {indicator.kind === 'asset' ? (
              <img
                alt=""
                aria-hidden="true"
                className="h-5 w-5 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
                src={indicator.iconSrc}
              />
            ) : (
              <Icon
                aria-hidden="true"
                className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
                color="white"
                height={18}
                icon={indicator.icon}
                width={18}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
})

export function FloorplanPanel() {
  const viewportHostRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const floorplanSceneRef = useRef<SVGGElement>(null)
  const panStateRef = useRef<PanState | null>(null)
  const guideInteractionRef = useRef<GuideInteractionState | null>(null)
  const guideTransformDraftRef = useRef<GuideTransformDraft | null>(null)
  const pendingFenceDragRef = useRef<PendingFenceDragState | null>(null)
  const wallEndpointDragRef = useRef<WallEndpointDragState | null>(null)
  const wallCurveDragRef = useRef<WallCurveDragState | null>(null)
  const siteBoundaryDraftRef = useRef<SiteBoundaryDraft | null>(null)
  const slabBoundaryDraftRef = useRef<SlabBoundaryDraft | null>(null)
  const zoneBoundaryDraftRef = useRef<ZoneBoundaryDraft | null>(null)
  const gestureScaleRef = useRef(1)
  const panelInteractionRef = useRef<PanelInteractionState | null>(null)
  const panelBoundsRef = useRef<ViewportBounds | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const hasUserAdjustedViewportRef = useRef(false)
  const previousLevelIdRef = useRef<string | null>(null)
  const floorplanMarqueeSnapPointRef = useRef<WallPlanPoint | null>(null)
  const levelId = useViewer((state) => state.selection.levelId)
  const buildingId = useViewer((state) => state.selection.buildingId)
  const selectedZoneId = useViewer((state) => state.selection.zoneId)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const previewSelectedIds = useViewer((state) => state.previewSelectedIds)
  const setSelection = useViewer((state) => state.setSelection)
  const setPreviewSelectedIds = useViewer((state) => state.setPreviewSelectedIds)
  const theme = useViewer((state) => state.theme)
  const unit = useViewer((state) => state.unit)
  const showGrid = useViewer((state) => state.showGrid)
  const showGuides = useViewer((state) => state.showGuides)
  const setShowGuides = useViewer((state) => state.setShowGuides)
  const selectedItem = useEditor((state) => state.selectedItem)

  const setFloorplanHovered = useEditor((state) => state.setFloorplanHovered)
  const selectedReferenceId = useEditor((state) => state.selectedReferenceId)
  const setSelectedReferenceId = useEditor((state) => state.setSelectedReferenceId)
  const setMode = useEditor((state) => state.setMode)
  const movingNode = useEditor((state) => state.movingNode)
  const curvingWall = useEditor((state) => state.curvingWall)
  const curvingFence = useEditor((state) => state.curvingFence)
  const phase = useEditor((state) => state.phase)
  const mode = useEditor((state) => state.mode)
  const setPhase = useEditor((state) => state.setPhase)
  const setMovingFenceEndpoint = useEditor((state) => state.setMovingFenceEndpoint)
  const setMovingNode = useEditor((state) => state.setMovingNode)
  const movingFenceEndpoint = useEditor((state) => state.movingFenceEndpoint)
  const structureLayer = useEditor((state) => state.structureLayer)
  const setStructureLayer = useEditor((state) => state.setStructureLayer)
  const setTool = useEditor((state) => state.setTool)
  const tool = useEditor((state) => state.tool)
  const deleteNode = useScene((state) => state.deleteNode)
  const updateNode = useScene((state) => state.updateNode)
  const levelNode = useScene((state) =>
    levelId ? (state.nodes[levelId] as LevelNode | undefined) : undefined,
  )
  const currentBuildingId =
    levelNode?.type === 'level' && levelNode.parentId
      ? (levelNode.parentId as BuildingNode['id'])
      : (buildingId as BuildingNode['id'] | null)
  const buildingRotationY = useScene((state) => {
    if (!currentBuildingId) return 0
    const node = state.nodes[currentBuildingId]
    return node?.type === 'building' ? (node.rotation[1] ?? 0) : 0
  })
  const buildingPosition = useScene((state) => {
    if (!currentBuildingId) {
      return DEFAULT_BUILDING_POSITION
    }

    const node = state.nodes[currentBuildingId]
    return node?.type === 'building'
      ? (node.position as [number, number, number])
      : DEFAULT_BUILDING_POSITION
  })
  const buildingRotationDeg = (buildingRotationY * 180) / Math.PI
  const site = useScene((state) => {
    for (const rootNodeId of state.rootNodeIds) {
      const node = state.nodes[rootNodeId]
      if (node?.type === 'site') {
        return node as SiteNode
      }
    }

    return null
  })
  const floorplanLevels = useScene(
    useShallow((state) => {
      if (!currentBuildingId) {
        return [] as LevelNode[]
      }

      const buildingNode = state.nodes[currentBuildingId]
      if (!buildingNode || buildingNode.type !== 'building') {
        return [] as LevelNode[]
      }

      return buildingNode.children
        .map((childId) => state.nodes[childId])
        .filter((node): node is LevelNode => node?.type === 'level')
        .sort((a, b) => a.level - b.level)
    }),
  )
  const walls = useScene(
    useShallow((state) => {
      if (!levelId) {
        return [] as WallNode[]
      }

      const nextLevelNode = state.nodes[levelId]
      if (!nextLevelNode || nextLevelNode.type !== 'level') {
        return [] as WallNode[]
      }

      return nextLevelNode.children
        .map((childId) => state.nodes[childId])
        .filter((node): node is WallNode => node?.type === 'wall')
    }),
  )
  const openings = useScene(
    useShallow((state) => {
      if (!levelId) {
        return [] as OpeningNode[]
      }

      const nextLevelNode = state.nodes[levelId]
      if (!nextLevelNode || nextLevelNode.type !== 'level') {
        return [] as OpeningNode[]
      }

      const nextWalls = nextLevelNode.children
        .map((childId) => state.nodes[childId])
        .filter((node): node is WallNode => node?.type === 'wall')

      return nextWalls.flatMap((wall) =>
        wall.children
          .map((childId) => state.nodes[childId])
          .filter((node): node is OpeningNode => node?.type === 'window' || node?.type === 'door'),
      )
    }),
  )
  const fences = useScene(
    useShallow((state) => {
      if (!levelId) {
        return [] as FenceNode[]
      }

      const nextLevelNode = state.nodes[levelId]
      if (!nextLevelNode || nextLevelNode.type !== 'level') {
        return [] as FenceNode[]
      }

      return nextLevelNode.children
        .map((childId) => state.nodes[childId])
        .filter((node): node is FenceNode => node?.type === 'fence')
    }),
  )
  const roofs = useScene(
    useShallow((state) => {
      if (!levelId) {
        return [] as RoofNode[]
      }

      const nextLevelNode = state.nodes[levelId]
      if (!nextLevelNode || nextLevelNode.type !== 'level') {
        return [] as RoofNode[]
      }

      return nextLevelNode.children
        .map((childId) => state.nodes[childId])
        .filter((node): node is RoofNode => node?.type === 'roof' && node.visible !== false)
    }),
  )
  const slabs = useScene(
    useShallow((state) => {
      if (!levelId) {
        return [] as SlabNode[]
      }

      const nextLevelNode = state.nodes[levelId]
      if (!nextLevelNode || nextLevelNode.type !== 'level') {
        return [] as SlabNode[]
      }

      return nextLevelNode.children
        .map((childId) => state.nodes[childId])
        .filter((node): node is SlabNode => node?.type === 'slab')
    }),
  )
  const ceilings = useScene(
    useShallow((state) => {
      if (!levelId) {
        return [] as CeilingNode[]
      }

      const nextLevelNode = state.nodes[levelId]
      if (!nextLevelNode || nextLevelNode.type !== 'level') {
        return [] as CeilingNode[]
      }

      return nextLevelNode.children
        .map((childId) => state.nodes[childId])
        .filter((node): node is CeilingNode => node?.type === 'ceiling')
    }),
  )
  const levelGuides = useScene(
    useShallow((state) => {
      if (!levelId) {
        return [] as GuideNode[]
      }

      const nextLevelNode = state.nodes[levelId]
      if (!nextLevelNode || nextLevelNode.type !== 'level') {
        return [] as GuideNode[]
      }

      return nextLevelNode.children
        .map((childId) => state.nodes[childId])
        .filter((node): node is GuideNode => node?.type === 'guide')
    }),
  )
  const zones = useScene(
    useShallow((state) => {
      if (!levelId) {
        return [] as ZoneNodeType[]
      }

      const nextLevelNode = state.nodes[levelId]
      if (!nextLevelNode || nextLevelNode.type !== 'level') {
        return [] as ZoneNodeType[]
      }

      return nextLevelNode.children
        .map((childId) => state.nodes[childId])
        .filter((node): node is ZoneNodeType => node?.type === 'zone')
    }),
  )
  const levelDescendantNodes = useScene(
    useShallow((state) => {
      if (!levelId) {
        return [] as AnyNode[]
      }

      const nextLevelNode = state.nodes[levelId]
      if (!nextLevelNode || nextLevelNode.type !== 'level') {
        return [] as AnyNode[]
      }

      return collectSharedLevelDescendants(nextLevelNode, state.nodes as Record<string, AnyNode>)
    }),
  )

  const [draftStart, setDraftStart] = useState<WallPlanPoint | null>(null)
  const [draftEnd, setDraftEnd] = useState<WallPlanPoint | null>(null)
  const [fenceDraftStart, setFenceDraftStart] = useState<WallPlanPoint | null>(null)
  const [fenceDraftEnd, setFenceDraftEnd] = useState<WallPlanPoint | null>(null)
  const [roofDraftStart, setRoofDraftStart] = useState<WallPlanPoint | null>(null)
  const [roofDraftEnd, setRoofDraftEnd] = useState<WallPlanPoint | null>(null)
  const [ceilingDraftPoints, setCeilingDraftPoints] = useState<WallPlanPoint[]>([])
  const [slabDraftPoints, setSlabDraftPoints] = useState<WallPlanPoint[]>([])
  const [zoneDraftPoints, setZoneDraftPoints] = useState<WallPlanPoint[]>([])
  const [siteBoundaryDraft, setSiteBoundaryDraft] = useState<SiteBoundaryDraft | null>(null)
  const [siteVertexDragState, setSiteVertexDragState] = useState<SiteVertexDragState | null>(null)
  const [slabBoundaryDraft, setSlabBoundaryDraft] = useState<SlabBoundaryDraft | null>(null)
  const [slabVertexDragState, setSlabVertexDragState] = useState<SlabVertexDragState | null>(null)
  const [zoneBoundaryDraft, setZoneBoundaryDraft] = useState<ZoneBoundaryDraft | null>(null)
  const [zoneVertexDragState, setZoneVertexDragState] = useState<ZoneVertexDragState | null>(null)
  const [guideTransformDraft, setGuideTransformDraft] = useState<GuideTransformDraft | null>(null)
  const [cursorPoint, setCursorPoint] = useState<WallPlanPoint | null>(null)
  const [floorplanCursorPosition, setFloorplanCursorPosition] = useState<SvgPoint | null>(null)
  const [wallEndpointDraft, setWallEndpointDraft] = useState<WallEndpointDraft | null>(null)
  const [wallCurveDraft, setWallCurveDraft] = useState<WallCurveDraft | null>(null)
  const [hoveredOpeningId, setHoveredOpeningId] = useState<OpeningNode['id'] | null>(null)
  const [hoveredWallId, setHoveredWallId] = useState<WallNode['id'] | null>(null)
  const [hoveredFenceId, setHoveredFenceId] = useState<FenceNode['id'] | null>(null)
  const [hoveredSlabId, setHoveredSlabId] = useState<SlabNode['id'] | null>(null)
  const [hoveredCeilingId, setHoveredCeilingId] = useState<CeilingNode['id'] | null>(null)
  const [hoveredItemId, setHoveredItemId] = useState<ItemNode['id'] | null>(null)
  const [hoveredStairId, setHoveredStairId] = useState<StairNode['id'] | null>(null)
  const [hoveredZoneId, setHoveredZoneId] = useState<ZoneNodeType['id'] | null>(null)
  const [hoveredEndpointId, setHoveredEndpointId] = useState<string | null>(null)
  const [hoveredWallCurveHandleId, setHoveredWallCurveHandleId] = useState<string | null>(null)
  const [hoveredSiteHandleId, setHoveredSiteHandleId] = useState<string | null>(null)
  const [hoveredSlabHandleId, setHoveredSlabHandleId] = useState<string | null>(null)
  const [hoveredZoneHandleId, setHoveredZoneHandleId] = useState<string | null>(null)
  const [hoveredGuideCorner, setHoveredGuideCorner] = useState<GuideCorner | null>(null)
  const floorplanSelectionTool = useEditor((s) => s.floorplanSelectionTool)
  const setFloorplanSelectionTool = useEditor((s) => s.setFloorplanSelectionTool)
  const [floorplanMarqueeState, setFloorplanMarqueeState] = useState<FloorplanMarqueeState | null>(
    null,
  )
  const [shiftPressed, setShiftPressed] = useState(false)
  const [rotationModifierPressed, setRotationModifierPressed] = useState(false)
  const [movingFloorplanNodeRevision, setMovingFloorplanNodeRevision] = useState(0)
  const [stairBuildPreviewPoint, setStairBuildPreviewPoint] = useState<WallPlanPoint | null>(null)
  const [stairBuildPreviewRotation, setStairBuildPreviewRotation] = useState(0)
  const [isPanning, setIsPanning] = useState(false)
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

  useEffect(() => {
    if (structureLayer === 'zones' && floorplanSelectionTool === 'marquee') {
      setFloorplanSelectionTool('click')
    }
  }, [floorplanSelectionTool, structureLayer])

  useEffect(() => {
    setIsMacPlatform(navigator.platform.toUpperCase().includes('MAC'))
  }, [])

  const sitePolygonEntry = useMemo(() => {
    const polygonPoints = site?.polygon?.points
    if (!(site && polygonPoints)) {
      return null
    }

    const polygon = toFloorplanPolygon(polygonPoints)
    if (polygon.length < 3) {
      return null
    }

    return {
      site,
      polygon,
      points: formatPolygonPoints(polygon),
    }
  }, [site])
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
  const selectedGuideId =
    selectedReferenceId && guideById.has(selectedReferenceId as GuideNode['id'])
      ? (selectedReferenceId as GuideNode['id'])
      : null
  const selectedGuide = useMemo(
    () => displayGuides.find((guide) => guide.id === selectedGuideId) ?? null,
    [displayGuides, selectedGuideId],
  )
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
  const floorplanFenceEntries = useMemo(
    () =>
      fences.flatMap((fence) => {
        const live = useLiveTransforms.getState().get(fence.id)
        const fenceCenterX = (fence.start[0] + fence.end[0]) / 2
        const fenceCenterZ = (fence.start[1] + fence.end[1]) / 2
        const displayFence =
          live
            ? {
                ...fence,
                start: [
                  fence.start[0] + (live.position[0] - fenceCenterX),
                  fence.start[1] + (live.position[2] - fenceCenterZ),
                ] as typeof fence.start,
                end: [
                  fence.end[0] + (live.position[0] - fenceCenterX),
                  fence.end[1] + (live.position[2] - fenceCenterZ),
                ] as typeof fence.end,
              }
            : fence
        const centerline = isCurvedWall(displayFence)
          ? sampleWallCenterline(displayFence, 24)
          : [
              { x: displayFence.start[0], y: displayFence.start[1] },
              { x: displayFence.end[0], y: displayFence.end[1] },
            ]
        const path = buildSvgPolylinePath(centerline)
        if (!path) {
          return []
        }

        const markerFrames = getFloorplanFenceMarkerTs(displayFence).map((t) => {
          const frame = getWallCurveFrameAt(displayFence, t)

          return {
            angleDeg: (Math.atan2(frame.tangent.y, frame.tangent.x) * 180) / Math.PI,
            point: frame.point,
          }
        })

        return [{ fence: displayFence, centerline, markerFrames, path }]
      }),
    [fences, movingFloorplanNodeRevision],
  )
  const wallPolygons = useMemo(
    () =>
      walls.map((wall) => {
        const floorplanWall = floorplanWallById.get(wall.id) ?? getFloorplanWall(wall)
        const polygon = getWallPlanFootprint(floorplanWall, wallMiterData)
        return {
          points: formatPolygonPoints(polygon),
          wall,
          polygon,
        }
      }),
    [floorplanWallById, wallMiterData, walls],
  )
  const displayWallPolygons = useMemo(() => {
    if (!(wallEndpointDraft || wallCurveDraft)) {
      return wallPolygons
    }

    const previewWalls = new Map<WallNode['id'], WallNode>()

    if (wallEndpointDraft) {
      for (const draftUpdate of getWallEndpointDraftUpdates(wallEndpointDraft)) {
        const previewWall = displayWallById.get(draftUpdate.id)
        if (previewWall) {
          previewWalls.set(previewWall.id, previewWall)
        }
      }
    }

    if (wallCurveDraft) {
      const previewWall = displayWallById.get(wallCurveDraft.wallId)
      if (previewWall) {
        previewWalls.set(previewWall.id, previewWall)
      }
    }

    if (previewWalls.size === 0) {
      return wallPolygons
    }

    return wallPolygons.map((entry) =>
      (() => {
        const previewWall = previewWalls.get(entry.wall.id)
        if (!previewWall) {
          return entry
        }

        const previewPolygon = getWallPlanFootprint(
          getFloorplanWall(previewWall),
          EMPTY_WALL_MITER_DATA,
        )

        return {
          wall: previewWall,
          polygon: previewPolygon,
          points: formatPolygonPoints(previewPolygon),
        }
      })(),
    )
  }, [displayWallById, wallCurveDraft, wallEndpointDraft, wallPolygons])

  const openingsPolygons = useMemo(
    () =>
      openings.flatMap((opening) => {
        const wall = displayFloorplanWallById.get(opening.parentId as WallNode['id'])
        if (!wall) return []
        const live = useLiveTransforms.getState().get(opening.id)
        const displayOpening =
          live && (movingNode?.type === 'door' || movingNode?.type === 'window') && movingNode.id === opening.id
            ? ({
                ...opening,
                position: [
                  live.position[0],
                  opening.position[1],
                  live.position[2],
                ] as typeof opening.position,
                rotation: [opening.rotation[0], live.rotation, opening.rotation[2]] as typeof opening.rotation,
              })
            : opening
        const polygon = getOpeningFootprint(wall, displayOpening)
        return [
          {
            opening: displayOpening,
            points: formatPolygonPoints(polygon),
            polygon,
          },
        ]
      }),
    [displayFloorplanWallById, movingFloorplanNodeRevision, movingNode, openings],
  )
  const slabPolygons = useMemo(
    () =>
      slabs.flatMap((slab) => {
        const polygon = toFloorplanPolygon(slab.polygon)
        if (polygon.length < 3) {
          return []
        }

        const holes = (slab.holes ?? [])
          .map((hole) => toFloorplanPolygon(hole))
          .filter((hole) => hole.length >= 3)

        return [
          {
            slab,
            polygon,
            holes,
            path: formatPolygonPath(polygon, holes),
          },
        ]
      }),
    [slabs],
  )
  const displaySlabPolygons = useMemo(() => {
    if (!slabBoundaryDraft) {
      return slabPolygons
    }

    return slabPolygons.map((entry) =>
      entry.slab.id === slabBoundaryDraft.slabId
        ? {
            ...entry,
            polygon: slabBoundaryDraft.polygon.map(toPoint2D),
            path: formatPolygonPath(slabBoundaryDraft.polygon.map(toPoint2D), entry.holes),
          }
        : entry,
    )
  }, [slabBoundaryDraft, slabPolygons])
  const ceilingPolygons = useMemo(
    () =>
      ceilings.flatMap((ceiling) => {
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
      }),
    [ceilings],
  )
  const zonePolygons = useMemo(
    () =>
      zones.flatMap((zone) => {
        const polygon = toFloorplanPolygon(zone.polygon)
        if (polygon.length < 3) {
          return []
        }

        return [
          {
            zone,
            polygon,
            points: formatPolygonPoints(polygon),
          },
        ]
      }),
    [zones],
  )
  const displayZonePolygons = useMemo(() => {
    if (!zoneBoundaryDraft) {
      return zonePolygons
    }

    return zonePolygons.map((entry) =>
      entry.zone.id === zoneBoundaryDraft.zoneId
        ? {
            ...entry,
            polygon: zoneBoundaryDraft.polygon.map(toPoint2D),
            points: formatPolygonPoints(zoneBoundaryDraft.polygon.map(toPoint2D)),
          }
        : entry,
    )
  }, [zoneBoundaryDraft, zonePolygons])
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
  const floorplanItemEntries = useMemo(() => {
    const transformCache = new Map<string, SharedFloorplanNodeTransform | null>()

    return floorplanItems.flatMap((item) => {
      const entry = buildFloorplanItemEntry(item, levelDescendantNodeById, transformCache)
      if (!entry) {
        return []
      }

      return [
        {
          item: entry.item,
          points: formatPolygonPoints(entry.polygon),
          polygon: entry.polygon,
        },
      ]
    })
  }, [cursorPoint, floorplanItems, levelDescendantNodeById, movingFloorplanNodeRevision])
  const floorplanStairEntries = useMemo(
    () =>
      floorplanStairs.flatMap((stair) => {
        const displayStair =
          movingNode?.type === 'stair' && movingNode.id === stair.id
            ? (() => {
                const live = useLiveTransforms.getState().get(stair.id)
                const liveX = cursorPoint?.[0] ?? live?.position[0] ?? stair.position[0]
                const liveZ = cursorPoint?.[1] ?? live?.position[2] ?? stair.position[2]
                const liveRotation = live?.rotation ?? stair.rotation

                return {
                  ...stair,
                  position: [liveX, stair.position[1], liveZ] as StairNode['position'],
                  rotation: liveRotation,
                }
              })()
            : stair
        const segments = (displayStair.children ?? [])
          .map((childId) => levelDescendantNodeById.get(childId as AnyNodeId))
          .filter(
            (node): node is StairSegmentNode =>
              node?.type === 'stair-segment' && node.visible !== false,
          )
        const entry = buildSharedFloorplanStairEntry(displayStair, segments)
        if (!entry) {
          return []
        }
        const hitPolygons =
          (displayStair.stairType ?? 'straight') === 'straight'
            ? entry.segments.map((segmentEntry) => segmentEntry.polygon)
            : [getFloorplanCurvedStairHitPolygon(displayStair)]

        return [
          {
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
          },
        ]
      }),
    [
      cursorPoint,
      floorplanStairs,
      levelDescendantNodeById,
      movingFloorplanNodeRevision,
      movingNode,
    ],
  )
  const floorplanRoofEntries = useMemo(
    () =>
      roofs.flatMap((roof) => {
        const liveRoofTransform =
          movingNode?.type === 'roof' && movingNode.id === roof.id
            ? useLiveTransforms.getState().get(roof.id)
            : null
        const liveRoofPosition = liveRoofTransform
          ? worldToBuildingLocalPlanPoint(
              liveRoofTransform.position,
              buildingPosition,
              buildingRotationY,
            )
          : null
        const displayRoof =
          liveRoofTransform
            ? {
                ...roof,
                position: [
                  liveRoofPosition?.x ?? roof.position[0],
                  roof.position[1],
                  liveRoofPosition?.y ?? roof.position[2],
                ] as RoofNode['position'],
                rotation: liveRoofTransform.rotation,
              }
            : roof
        const segments = (displayRoof.children ?? [])
          .map((childId) => levelDescendantNodeById.get(childId as AnyNodeId))
          .filter(
            (node): node is RoofSegmentNode =>
              node?.type === 'roof-segment' && node.visible !== false,
          )
          .flatMap((segment) => {
            const liveSegmentTransform =
              movingNode?.type === 'roof-segment' && movingNode.id === segment.id
                ? useLiveTransforms.getState().get(segment.id)
                : null
            const worldPositionOverride = liveSegmentTransform
              ? worldToBuildingLocalPlanPoint(
                  liveSegmentTransform.position,
                  buildingPosition,
                  buildingRotationY,
                )
              : undefined
            const polygon = getRoofSegmentPolygon(displayRoof, segment, {
              localRotation: liveSegmentTransform?.rotation,
              worldPositionOverride,
            })

            if (polygon.length < 3) {
              return []
            }

            return [
              {
                segment,
                polygon,
                points: formatPolygonPoints(polygon),
                ridgeLine: getRoofSegmentRidgeLine(displayRoof, segment, {
                  localRotation: liveSegmentTransform?.rotation,
                  worldPositionOverride,
                }),
              },
            ]
          })

        if (segments.length === 0) {
          return []
        }

        return [
          {
            roof: displayRoof,
            center: { x: displayRoof.position[0], y: displayRoof.position[2] },
            segments,
          },
        ]
      }),
    [
      buildingPosition,
      buildingRotationY,
      levelDescendantNodeById,
      movingFloorplanNodeRevision,
      movingNode,
      roofs,
    ],
  )
  const selectedOpeningEntry = useMemo(() => {
    if (selectedIds.length !== 1) {
      return null
    }

    return openingsPolygons.find(({ opening }) => opening.id === selectedIds[0]) ?? null
  }, [openingsPolygons, selectedIds])
  const selectedItemEntry = useMemo(() => {
    if (selectedIds.length !== 1) {
      return null
    }

    return floorplanItemEntries.find(({ item }) => item.id === selectedIds[0]) ?? null
  }, [floorplanItemEntries, selectedIds])
  const selectedItemClearanceMeasurements = useMemo(() => {
    if (!selectedItemEntry) {
      return [] as LinearMeasurementOverlay[]
    }

    const attachTo = selectedItemEntry.item.asset.attachTo
    if (attachTo === 'wall' || attachTo === 'wall-side') {
      return [] as LinearMeasurementOverlay[]
    }

    const polygon = selectedItemEntry.polygon
    if (polygon.length < 4 || displayWallPolygons.length === 0) {
      return [] as LinearMeasurementOverlay[]
    }

    const centroid = polygonCentroid(polygon)

    return polygon.flatMap((startPoint, index) => {
      const endPoint = polygon[(index + 1) % polygon.length]
      if (!endPoint) {
        return []
      }

      const edgeVector = {
        x: endPoint.x - startPoint.x,
        y: endPoint.y - startPoint.y,
      }
      const tangent = normalizePlanVector(edgeVector)
      if (!tangent) {
        return []
      }

      let outwardNormal: Point2D = {
        x: -tangent.y,
        y: tangent.x,
      }
      const midpoint = {
        x: (startPoint.x + endPoint.x) / 2,
        y: (startPoint.y + endPoint.y) / 2,
      }
      const centroidVector = {
        x: midpoint.x - centroid.x,
        y: midpoint.y - centroid.y,
      }

      if (dotPlanVectors(outwardNormal, centroidVector) < 0) {
        outwardNormal = {
          x: -outwardNormal.x,
          y: -outwardNormal.y,
        }
      }

      let bestHit:
        | {
            point: Point2D
            distance: number
          }
        | null = null

      for (const { polygon: wallPolygon } of displayWallPolygons) {
        for (let wallIndex = 0; wallIndex < wallPolygon.length; wallIndex += 1) {
          const wallStart = wallPolygon[wallIndex]
          const wallEnd = wallPolygon[(wallIndex + 1) % wallPolygon.length]
          if (!(wallStart && wallEnd)) {
            continue
          }

          const wallEdgeVector = {
            x: wallEnd.x - wallStart.x,
            y: wallEnd.y - wallStart.y,
          }
          const wallTangent = normalizePlanVector(wallEdgeVector)
          if (!wallTangent) {
            continue
          }

          if (
            Math.abs(dotPlanVectors(tangent, wallTangent)) <
            FLOORPLAN_ITEM_CLEARANCE_EDGE_PARALLEL_THRESHOLD
          ) {
            continue
          }

          const hit = getRaySegmentIntersection(midpoint, outwardNormal, wallStart, wallEnd)
          if (
            !hit ||
            hit.rayDistance < FLOORPLAN_ITEM_CLEARANCE_MIN_DISTANCE ||
            hit.rayDistance > FLOORPLAN_ITEM_CLEARANCE_MAX_DISTANCE
          ) {
            continue
          }

          if (!bestHit || hit.rayDistance < bestHit.distance) {
            bestHit = {
              point: hit.point,
              distance: hit.rayDistance,
            }
          }
        }
      }

      if (!bestHit) {
        return []
      }

      const overlay = getLinearMeasurementOverlay(
        `${selectedItemEntry.item.id}:clearance:${index}`,
        midpoint,
        bestHit.point,
        formatMeasurement(bestHit.distance, unit),
        {
          offsetDistance: FLOORPLAN_MEASUREMENT_OFFSET,
          offsetVector: tangent,
        },
      )

      return overlay ? [overlay] : []
    })
  }, [displayWallPolygons, selectedItemEntry, unit])
  const movingOpeningPlacementMeasurements = useMemo(() => {
    if (!(movingNode?.type === 'door' || movingNode?.type === 'window')) {
      return [] as LinearMeasurementOverlay[]
    }

    const openingEntry = openingsPolygons.find(({ opening }) => opening.id === movingNode.id)
    if (!openingEntry) {
      return [] as LinearMeasurementOverlay[]
    }

    const wallEntry = displayWallPolygons.find(({ wall }) => wall.id === openingEntry.opening.parentId)
    if (!wallEntry || isCurvedWall(wallEntry.wall)) {
      return [] as LinearMeasurementOverlay[]
    }

    const faceContext = getWallMeasurementFaceContext(wallEntry, displayWallPolygons)
    if (!faceContext) {
      return [] as LinearMeasurementOverlay[]
    }

    const wall = wallEntry.wall
    const wallLength = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
    if (wallLength < 1e-6) {
      return [] as LinearMeasurementOverlay[]
    }

    const tangent = normalizePlanVector({
      x: wall.end[0] - wall.start[0],
      y: wall.end[1] - wall.start[1],
    })
    if (!tangent) {
      return [] as LinearMeasurementOverlay[]
    }

    const opening = openingEntry.opening
    const startDistance = opening.position[0] - opening.width / 2
    const endDistance = opening.position[0] + opening.width / 2
    const { leftBoundary, rightBoundary } = getAdjacentOpeningBounds(
      {
        id: opening.id,
        wallId: wall.id,
        startDistance,
        endDistance,
      },
      openingsPolygons,
    )
    const faceOffsetDistance = (wall.thickness ?? 0.1) / 2
    const openingFaceStart = {
      x: wall.start[0] + tangent.x * startDistance + faceContext.outwardNormal.x * faceOffsetDistance,
      y: wall.start[1] + tangent.y * startDistance + faceContext.outwardNormal.y * faceOffsetDistance,
    }
    const openingFaceEnd = {
      x: wall.start[0] + tangent.x * endDistance + faceContext.outwardNormal.x * faceOffsetDistance,
      y: wall.start[1] + tangent.y * endDistance + faceContext.outwardNormal.y * faceOffsetDistance,
    }
    const leftBoundaryPoint =
      leftBoundary === null
        ? faceContext.outerFace.start
        : {
            x: wall.start[0] + tangent.x * leftBoundary + faceContext.outwardNormal.x * faceOffsetDistance,
            y: wall.start[1] + tangent.y * leftBoundary + faceContext.outwardNormal.y * faceOffsetDistance,
          }
    const rightBoundaryPoint =
      rightBoundary === null
        ? faceContext.outerFace.end
        : {
            x: wall.start[0] + tangent.x * rightBoundary + faceContext.outwardNormal.x * faceOffsetDistance,
            y: wall.start[1] + tangent.y * rightBoundary + faceContext.outwardNormal.y * faceOffsetDistance,
          }
    const overlays: LinearMeasurementOverlay[] = []
    const leftDistance = getPlanPointDistance(leftBoundaryPoint, openingFaceStart)

    if (leftDistance >= 0.01) {
      const overlay = getLinearMeasurementOverlay(
        `${opening.id}:placement-left`,
        leftBoundaryPoint,
        openingFaceStart,
        formatMeasurement(leftDistance, unit),
        {
          offsetDistance: FLOORPLAN_WALL_OUTER_MEASUREMENT_OFFSET,
          offsetVector: faceContext.outwardNormal,
        },
      )

      if (overlay) {
        overlays.push({
          ...overlay,
          extensionStroke: FLOORPLAN_OPENING_MEASUREMENT_EXTENSION,
          labelFill: FLOORPLAN_OPENING_MEASUREMENT_TEXT,
          stroke: FLOORPLAN_OPENING_MEASUREMENT_STROKE,
        })
      }
    }

    const rightDistance = getPlanPointDistance(openingFaceEnd, rightBoundaryPoint)

    if (rightDistance >= 0.01) {
      const overlay = getLinearMeasurementOverlay(
        `${opening.id}:placement-right`,
        openingFaceEnd,
        rightBoundaryPoint,
        formatMeasurement(rightDistance, unit),
        {
          offsetDistance: FLOORPLAN_WALL_OUTER_MEASUREMENT_OFFSET,
          offsetVector: faceContext.outwardNormal,
        },
      )

      if (overlay) {
        overlays.push({
          ...overlay,
          extensionStroke: FLOORPLAN_OPENING_MEASUREMENT_EXTENSION,
          labelFill: FLOORPLAN_OPENING_MEASUREMENT_TEXT,
          stroke: FLOORPLAN_OPENING_MEASUREMENT_STROKE,
        })
      }
    }

    return overlays
  }, [displayWallPolygons, movingNode, openingsPolygons, unit])
  const selectedWallEntry = useMemo(() => {
    if (selectedIds.length !== 1) {
      return null
    }

    return displayWallPolygons.find(({ wall }) => wall.id === selectedIds[0]) ?? null
  }, [displayWallPolygons, selectedIds])
  const selectedFenceEntry = useMemo(() => {
    if (selectedIds.length !== 1) {
      return null
    }

    return floorplanFenceEntries.find(({ fence }) => fence.id === selectedIds[0]) ?? null
  }, [floorplanFenceEntries, selectedIds])
  const selectedStairEntry = useMemo(() => {
    if (selectedIds.length !== 1) {
      return null
    }

    return floorplanStairEntries.find(({ stair }) => stair.id === selectedIds[0]) ?? null
  }, [floorplanStairEntries, selectedIds])
  const selectedRoofEntry = useMemo(() => {
    if (selectedIds.length !== 1) {
      return null
    }

    return floorplanRoofEntries.find(({ roof }) => roof.id === selectedIds[0]) ?? null
  }, [floorplanRoofEntries, selectedIds])
  const slabById = useMemo(() => new Map(slabs.map((slab) => [slab.id, slab] as const)), [slabs])
  const zoneById = useMemo(() => new Map(zones.map((zone) => [zone.id, zone] as const)), [zones])
  const selectedSlabEntry = useMemo(() => {
    if (selectedIds.length !== 1) {
      return null
    }

    return displaySlabPolygons.find(({ slab }) => slab.id === selectedIds[0]) ?? null
  }, [displaySlabPolygons, selectedIds])
  const selectedCeilingEntry = useMemo(() => {
    if (selectedIds.length !== 1) {
      return null
    }

    return ceilingPolygons.find(({ ceiling }) => ceiling.id === selectedIds[0]) ?? null
  }, [ceilingPolygons, selectedIds])
  const selectedZoneEntry = useMemo(() => {
    if (!selectedZoneId) {
      return null
    }

    return displayZonePolygons.find(({ zone }) => zone.id === selectedZoneId) ?? null
  }, [displayZonePolygons, selectedZoneId])

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
  const isRoofBuildActive = phase === 'structure' && mode === 'build' && tool === 'roof'
  const isStairBuildActive = phase === 'structure' && mode === 'build' && tool === 'stair'
  const isStairMoveActive = movingNode?.type === 'stair'
  const isRoofMoveActive = movingNode?.type === 'roof' || movingNode?.type === 'roof-segment'
  const isSlabMoveActive = movingNode?.type === 'slab'
  const isCeilingMoveActive = movingNode?.type === 'ceiling'
  const isFenceMoveActive = movingNode?.type === 'fence'
  const isWallMoveActive = movingNode?.type === 'wall'
  const isWallCurveActive = curvingWall?.type === 'wall'
  const isFenceCurveActive = curvingFence?.type === 'fence'
  const isFenceEndpointMoveActive = movingFenceEndpoint !== null
  const isItemPlacementPreviewActive =
    (mode === 'build' && tool === 'item') || movingNode?.type === 'item'
  const isFloorItemBuildActive = mode === 'build' && tool === 'item' && !selectedItem?.attachTo
  const isFloorItemMoveActive = movingNode?.type === 'item' && !movingNode.asset.attachTo
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
    isWallCurveActive ||
    isFenceCurveActive ||
    isFenceEndpointMoveActive ||
    isFloorItemBuildActive ||
    isFloorItemMoveActive
  const floorplanPreviewStairSegment = useMemo(
    () =>
      StairSegmentNodeSchema.parse({
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
      }),
    [],
  )
  const floorplanPreviewStairEntry = useMemo(() => {
    if (!(isStairBuildActive && stairBuildPreviewPoint)) {
      return null
    }

    const previewStair = StairNodeSchema.parse({
      id: 'stair_floorplan_preview',
      name: 'Staircase preview',
      position: [stairBuildPreviewPoint[0], 0, stairBuildPreviewPoint[1]],
      rotation: stairBuildPreviewRotation,
      children: [floorplanPreviewStairSegment.id],
      metadata: { isTransient: true, isFloorplanPreview: true },
    })

    const entry = buildSharedFloorplanStairEntry(previewStair, [floorplanPreviewStairSegment])
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
  }, [
    floorplanPreviewStairSegment,
    isStairBuildActive,
    stairBuildPreviewPoint,
    stairBuildPreviewRotation,
  ])
  const renderedFloorplanStairEntries = useMemo(
    () =>
      floorplanPreviewStairEntry
        ? [...floorplanStairEntries, floorplanPreviewStairEntry]
        : floorplanStairEntries,
    [floorplanPreviewStairEntry, floorplanStairEntries],
  )
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
  const isMarqueeSelectionToolActive =
    mode === 'select' &&
    floorplanSelectionTool === 'marquee' &&
    !movingNode &&
    !movingFenceEndpoint &&
    structureLayer !== 'zones'
  const isDeleteMode = mode === 'delete' && !movingNode
  const canSelectElementFloorplanGeometry =
    mode === 'select' &&
    floorplanSelectionTool === 'click' &&
    !movingNode &&
    !movingFenceEndpoint &&
    structureLayer !== 'zones'
  const canInteractElementFloorplanGeometry = isDeleteMode || canSelectElementFloorplanGeometry
  const canInteractFloorplanSlabs = isDeleteMode || canSelectElementFloorplanGeometry
  const canInteractWithGuides = showGuides && canSelectElementFloorplanGeometry
  const canSelectFloorplanZones =
    mode === 'select' &&
    floorplanSelectionTool === 'click' &&
    !movingNode &&
    !movingFenceEndpoint &&
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
      !movingFenceEndpoint &&
      isFloorplanStructureContextActive) ||
    isDeleteMode
  const canSelectFloorplanItems =
    (mode === 'select' &&
      floorplanSelectionTool === 'click' &&
      !movingNode &&
      !movingFenceEndpoint &&
      isFloorplanItemContextActive) ||
    isDeleteMode
  const canFocusFloorplanStairs =
    mode === 'select' &&
    floorplanSelectionTool === 'click' &&
    !movingNode &&
    !movingFenceEndpoint &&
    isFloorplanStructureContextActive
  const canFocusFloorplanItems =
    mode === 'select' &&
    floorplanSelectionTool === 'click' &&
    !movingNode &&
    !movingFenceEndpoint &&
    isFloorplanItemContextActive
  const visibleSitePolygon = phase === 'site' ? displaySitePolygon : null
  const shouldShowSiteBoundaryHandles = isSiteEditActive && visibleSitePolygon !== null
  const shouldShowPersistentWallEndpointHandles =
    mode === 'select' && !movingNode && !movingFenceEndpoint
  const shouldShowSlabBoundaryHandles =
    mode === 'select' &&
    !movingNode &&
    floorplanSelectionTool === 'click' &&
    selectedSlabEntry !== null
  const shouldShowZoneBoundaryHandles = canSelectFloorplanZones && selectedZoneEntry !== null
  const showZonePolygons = true // Zone polygons always visible (labels always clickable)
  const visibleZonePolygons = displayZonePolygons
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const highlightedFloorplanIdSet = useMemo(
    () => new Set([...selectedIds, ...previewSelectedIds]),
    [previewSelectedIds, selectedIds],
  )
  const activeMarqueeBounds = useMemo(() => {
    if (!floorplanMarqueeState) {
      return null
    }

    return getFloorplanSelectionBounds(
      floorplanMarqueeState.startPlanPoint,
      floorplanMarqueeState.currentPlanPoint,
    )
  }, [floorplanMarqueeState])
  const visibleMarqueeBounds = useMemo(() => {
    if (!(floorplanMarqueeState && activeMarqueeBounds)) {
      return null
    }

    const dragDistance = Math.hypot(
      floorplanMarqueeState.currentPlanPoint[0] - floorplanMarqueeState.startPlanPoint[0],
      floorplanMarqueeState.currentPlanPoint[1] - floorplanMarqueeState.startPlanPoint[1],
    )

    return dragDistance > 0 ? activeMarqueeBounds : null
  }, [activeMarqueeBounds, floorplanMarqueeState])
  const visibleSvgMarqueeBounds = useMemo(() => {
    if (!visibleMarqueeBounds) {
      return null
    }

    return toSvgSelectionBounds(visibleMarqueeBounds)
  }, [visibleMarqueeBounds])
  const wallEndpointHandles = useMemo(() => {
    if (isOpeningPlacementActive || movingNode) {
      return []
    }

    return displayWallPolygons.flatMap(({ wall }) => {
      const isSelected = selectedIdSet.has(wall.id)
      const isVisible =
        shouldShowPersistentWallEndpointHandles ||
        isWallBuildActive ||
        isSelected ||
        wallEndpointDraft?.wallId === wall.id
      if (!isVisible) {
        return []
      }

      return (['start', 'end'] as const).map((endpoint) => ({
        wall,
        endpoint,
        point: endpoint === 'start' ? wall.start : wall.end,
        isSelected,
        isActive: wallEndpointDraft?.wallId === wall.id && wallEndpointDraft.endpoint === endpoint,
      }))
    })
  }, [
    displayWallPolygons,
    isOpeningPlacementActive,
    isWallBuildActive,
    movingNode,
    selectedIdSet,
    shouldShowPersistentWallEndpointHandles,
    wallEndpointDraft,
  ])
  const fenceEndpointHandles = useMemo(() => {
    if (
      isOpeningPlacementActive ||
      movingNode ||
      isFenceCurveActive ||
      mode !== 'select' ||
      floorplanSelectionTool !== 'click' ||
      !selectedFenceEntry
    ) {
      return []
    }

    return (['start', 'end'] as const).map((endpoint) => ({
      fence: selectedFenceEntry.fence,
      endpoint,
      point: endpoint === 'start' ? selectedFenceEntry.fence.start : selectedFenceEntry.fence.end,
      isSelected: true,
      isActive:
        movingFenceEndpoint?.fence.id === selectedFenceEntry.fence.id &&
        movingFenceEndpoint.endpoint === endpoint,
    }))
  }, [
    floorplanSelectionTool,
    isFenceCurveActive,
    isOpeningPlacementActive,
    mode,
    movingFenceEndpoint,
    movingNode,
    selectedFenceEntry,
  ])
  const wallCurveHandles = useMemo(() => {
    if (
      isOpeningPlacementActive ||
      movingNode ||
      mode !== 'select' ||
      floorplanSelectionTool !== 'click' ||
      !selectedWallEntry
    ) {
      return []
    }

    const hasWallChildrenBlockingCurve = (selectedWallEntry.wall.children ?? []).some((childId) => {
      const childNode = levelDescendantNodeById.get(childId as AnyNodeId)
      if (!childNode) {
        return false
      }

      if (childNode.type === 'door' || childNode.type === 'window') {
        return true
      }

      if (childNode.type === 'item') {
        const attachTo = childNode.asset?.attachTo
        return attachTo === 'wall' || attachTo === 'wall-side'
      }

      return false
    })
    if (hasWallChildrenBlockingCurve) {
      return []
    }

    const centerPoint = getWallMidpointHandlePoint(selectedWallEntry.wall)

    return [
      {
        wall: selectedWallEntry.wall,
        point: [centerPoint.x, centerPoint.y] as WallPlanPoint,
        isActive: wallCurveDraft?.wallId === selectedWallEntry.wall.id,
      },
    ]
  }, [
    floorplanSelectionTool,
    isOpeningPlacementActive,
    mode,
    movingNode,
    levelDescendantNodeById,
    selectedWallEntry,
    wallCurveDraft,
  ])
  const slabVertexHandles = useMemo(() => {
    if (!shouldShowSlabBoundaryHandles) {
      return []
    }

    return selectedSlabEntry.polygon.map((point, vertexIndex) => ({
      nodeId: selectedSlabEntry.slab.id,
      vertexIndex,
      point: toWallPlanPoint(point),
      isActive:
        slabVertexDragState?.slabId === selectedSlabEntry.slab.id &&
        slabVertexDragState.vertexIndex === vertexIndex,
    }))
  }, [selectedSlabEntry, shouldShowSlabBoundaryHandles, slabVertexDragState])
  const slabMidpointHandles = useMemo(() => {
    if (!(shouldShowSlabBoundaryHandles && !slabVertexDragState)) {
      return []
    }

    return selectedSlabEntry.polygon.map((point, edgeIndex, polygon) => {
      const nextPoint = polygon[(edgeIndex + 1) % polygon.length]
      return {
        nodeId: selectedSlabEntry.slab.id,
        edgeIndex,
        point: [
          (point.x + (nextPoint?.x ?? point.x)) / 2,
          (point.y + (nextPoint?.y ?? point.y)) / 2,
        ] as WallPlanPoint,
      }
    })
  }, [selectedSlabEntry, shouldShowSlabBoundaryHandles, slabVertexDragState])
  const siteVertexHandles = useMemo(() => {
    if (!(shouldShowSiteBoundaryHandles && visibleSitePolygon)) {
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
  }, [shouldShowSiteBoundaryHandles, siteVertexDragState, visibleSitePolygon])
  const siteMidpointHandles = useMemo(() => {
    if (!(shouldShowSiteBoundaryHandles && visibleSitePolygon && !siteVertexDragState)) {
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
  }, [shouldShowSiteBoundaryHandles, siteVertexDragState, visibleSitePolygon])
  const zoneVertexHandles = useMemo(() => {
    if (!shouldShowZoneBoundaryHandles) {
      return []
    }

    return selectedZoneEntry.polygon.map((point, vertexIndex) => ({
      nodeId: selectedZoneEntry.zone.id,
      vertexIndex,
      point: toWallPlanPoint(point),
      isActive:
        zoneVertexDragState?.zoneId === selectedZoneEntry.zone.id &&
        zoneVertexDragState.vertexIndex === vertexIndex,
    }))
  }, [selectedZoneEntry, shouldShowZoneBoundaryHandles, zoneVertexDragState])
  const zoneMidpointHandles = useMemo(() => {
    if (!(shouldShowZoneBoundaryHandles && !zoneVertexDragState)) {
      return []
    }

    return selectedZoneEntry.polygon.map((point, edgeIndex, polygon) => {
      const nextPoint = polygon[(edgeIndex + 1) % polygon.length]
      return {
        nodeId: selectedZoneEntry.zone.id,
        edgeIndex,
        point: [
          (point.x + (nextPoint?.x ?? point.x)) / 2,
          (point.y + (nextPoint?.y ?? point.y)) / 2,
        ] as WallPlanPoint,
      }
    })
  }, [selectedZoneEntry, shouldShowZoneBoundaryHandles, zoneVertexDragState])

  const draftPolygon = useMemo(() => {
    if (!(levelId && draftStart && draftEnd && isWallLongEnough(draftStart, draftEnd))) {
      return null
    }

    const draftWall = getSharedFloorplanWall(buildDraftWall(levelId, draftStart, draftEnd))
    // Keep the live draft preview cheap; full level-wide mitering here runs on every mouse move.
    return getWallPlanFootprint(draftWall, EMPTY_WALL_MITER_DATA)
  }, [draftEnd, draftStart, levelId])
  const draftPolygonPoints = useMemo(
    () => {
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
    },
    [draftPolygon, isRoofBuildActive, roofDraftEnd, roofDraftStart],
  )
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
  const polygonDraftPolylinePoints = useMemo(() => {
    if (!(isPolygonDraftBuildActive && cursorPoint && activePolygonDraftPoints.length > 0)) {
      return null
    }

    return formatPolygonPoints([...activePolygonDraftPoints.map(toPoint2D), toPoint2D(cursorPoint)])
  }, [activePolygonDraftPoints, cursorPoint, isPolygonDraftBuildActive])
  const polygonDraftPolygonPoints = useMemo(() => {
    if (!(isPolygonDraftBuildActive && cursorPoint && activePolygonDraftPoints.length >= 2)) {
      return null
    }

    return formatPolygonPoints([...activePolygonDraftPoints.map(toPoint2D), toPoint2D(cursorPoint)])
  }, [activePolygonDraftPoints, cursorPoint, isPolygonDraftBuildActive])
  const polygonDraftClosingSegment = useMemo(() => {
    if (!(isPolygonDraftBuildActive && cursorPoint && activePolygonDraftPoints.length >= 2)) {
      return null
    }

    const firstPoint = activePolygonDraftPoints[0]
    if (!firstPoint) {
      return null
    }

    return {
      x1: toSvgX(cursorPoint[0]),
      y1: toSvgY(cursorPoint[1]),
      x2: toSvgX(firstPoint[0]),
      y2: toSvgY(firstPoint[1]),
    }
  }, [activePolygonDraftPoints, cursorPoint, isPolygonDraftBuildActive])

  const svgAspectRatio = surfaceSize.width / surfaceSize.height || 1

  const fittedViewport = useMemo(() => {
    const allPoints = [
      ...(visibleSitePolygon ? visibleSitePolygon.polygon : []),
      ...ceilingPolygons.flatMap((entry) => entry.polygon),
      ...displaySlabPolygons.flatMap((entry) => entry.polygon),
      ...floorplanFenceEntries.flatMap((entry) => entry.centerline),
      ...floorplanItemEntries.flatMap((entry) => entry.polygon),
      ...floorplanRoofEntries.flatMap((entry) =>
        entry.segments.flatMap((segmentEntry) => segmentEntry.polygon),
      ),
      ...floorplanStairEntries.flatMap((entry) => entry.hitPolygons.flat()),
      ...visibleZonePolygons.flatMap((entry) => entry.polygon),
      ...wallPolygons.flatMap((entry) => entry.polygon),
    ]

    if (allPoints.length === 0) {
      return {
        centerX: 0,
        centerY: 0,
        width: Math.max(FALLBACK_VIEW_SIZE, FALLBACK_VIEW_SIZE * svgAspectRatio),
      }
    }

    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY

    for (const point of allPoints) {
      const svgPoint = toSvgPoint(point)
      minX = Math.min(minX, svgPoint.x)
      maxX = Math.max(maxX, svgPoint.x)
      minY = Math.min(minY, svgPoint.y)
      maxY = Math.max(maxY, svgPoint.y)
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
    ceilingPolygons,
    displaySlabPolygons,
    floorplanFenceEntries,
    floorplanItemEntries,
    floorplanRoofEntries,
    floorplanStairEntries,
    svgAspectRatio,
    visibleSitePolygon,
    visibleZonePolygons,
    wallPolygons,
  ])

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

  useEffect(() => {
    const levelChanged = previousLevelIdRef.current !== (levelId ?? null)

    if (levelChanged) {
      previousLevelIdRef.current = levelId ?? null
      hasUserAdjustedViewportRef.current = false
      setViewport((current) => (floorplanViewportEquals(current, fittedViewport) ? current : fittedViewport))
      return
    }

    if (!hasUserAdjustedViewportRef.current) {
      setViewport((current) => (floorplanViewportEquals(current, fittedViewport) ? current : fittedViewport))
    }
  }, [fittedViewport, levelId])

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
    () => Math.max(floorplanWorldUnitsPerPixel, 0.0001),
    [floorplanWorldUnitsPerPixel],
  )
  const selectedOpeningActionMenuPosition = useMemo(
    () =>
      selectedOpeningEntry
        ? getFloorplanActionMenuPosition(selectedOpeningEntry.polygon, viewBox, surfaceSize)
        : null,
    [selectedOpeningEntry, surfaceSize, viewBox],
  )
  const selectedItemActionMenuPosition = useMemo(
    () =>
      selectedItemEntry
        ? getFloorplanActionMenuPosition(selectedItemEntry.polygon, viewBox, surfaceSize)
        : null,
    [selectedItemEntry, surfaceSize, viewBox],
  )
  const selectedSlabActionMenuPosition = useMemo(
    () =>
      selectedSlabEntry
        ? getFloorplanActionMenuPosition(selectedSlabEntry.polygon, viewBox, surfaceSize)
        : null,
    [selectedSlabEntry, surfaceSize, viewBox],
  )
  const selectedCeilingActionMenuPosition = useMemo(
    () =>
      selectedCeilingEntry
        ? getFloorplanActionMenuPosition(selectedCeilingEntry.polygon, viewBox, surfaceSize)
        : null,
    [selectedCeilingEntry, surfaceSize, viewBox],
  )
  const selectedWallActionMenuPosition = useMemo(
    () =>
      selectedWallEntry
        ? getFloorplanActionMenuPosition(selectedWallEntry.polygon, viewBox, surfaceSize)
        : null,
    [selectedWallEntry, surfaceSize, viewBox],
  )
  const selectedFenceActionMenuPosition = useMemo(
    () =>
      selectedFenceEntry
        ? getFloorplanActionMenuPosition(selectedFenceEntry.centerline, viewBox, surfaceSize)
        : null,
    [selectedFenceEntry, surfaceSize, viewBox],
  )
  const selectedStairActionMenuPosition = useMemo(
    () =>
      selectedStairEntry
        ? getFloorplanActionMenuPosition(selectedStairEntry.hitPolygons.flat(), viewBox, surfaceSize)
        : null,
    [selectedStairEntry, surfaceSize, viewBox],
  )
  const selectedRoofActionMenuPosition = useMemo(
    () =>
      selectedRoofEntry
        ? getFloorplanActionMenuPosition(
            selectedRoofEntry.segments.flatMap(({ polygon }) => polygon),
            viewBox,
            surfaceSize,
          )
        : null,
    [selectedRoofEntry, surfaceSize, viewBox],
  )
  const floorplanCursorAnchorPosition = useMemo(() => {
    if (
      cursorPoint &&
      surfaceSize.width > 0 &&
      surfaceSize.height > 0 &&
      viewBox.width > 0 &&
      viewBox.height > 0
    ) {
      const svgPoint = toSvgPlanPoint(cursorPoint)

      if (
        svgPoint.x >= viewBox.minX &&
        svgPoint.x <= viewBox.minX + viewBox.width &&
        svgPoint.y >= viewBox.minY &&
        svgPoint.y <= viewBox.minY + viewBox.height
      ) {
        return {
          x: ((svgPoint.x - viewBox.minX) / viewBox.width) * surfaceSize.width,
          y: ((svgPoint.y - viewBox.minY) / viewBox.height) * surfaceSize.height,
        }
      }
    }

    return floorplanCursorPosition
  }, [cursorPoint, floorplanCursorPosition, surfaceSize.height, surfaceSize.width, viewBox])

  useEffect(() => {
    setHoveredGuideCorner(null)
  }, [selectedGuide?.id])

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

    if (
      handleSvg.x < viewBox.minX ||
      handleSvg.x > viewBox.minX + viewBox.width ||
      handleSvg.y < viewBox.minY ||
      handleSvg.y > viewBox.minY + viewBox.height
    ) {
      return null
    }

    const centerX = ((centerSvg.x - viewBox.minX) / viewBox.width) * surfaceSize.width
    const centerY = ((centerSvg.y - viewBox.minY) / viewBox.height) * surfaceSize.height
    const handleX = ((handleSvg.x - viewBox.minX) / viewBox.width) * surfaceSize.width
    const handleY = ((handleSvg.y - viewBox.minY) / viewBox.height) * surfaceSize.height

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
    selectedGuide,
    selectedGuideDimensions,
    surfaceSize.height,
    surfaceSize.width,
    viewBox,
  ])

  const minViewportWidth = fittedViewport.width * MIN_VIEWPORT_WIDTH_RATIO
  const maxViewportWidth = fittedViewport.width * MAX_VIEWPORT_WIDTH_RATIO

  const palette = useMemo(
    () =>
      theme === 'dark'
        ? {
            surface: '#0a0e1b',
            minorGrid: '#475569',
            majorGrid: '#94a3b8',
            minorGridOpacity: 0.7,
            majorGridOpacity: 0.9,
            slabFill: 'rgba(100, 116, 139, 0.16)',
            slabStroke: 'rgba(148, 163, 184, 0.45)',
            selectedSlabFill: 'rgba(167, 139, 250, 0.14)',
            selectedSlabStroke: '#a78bfa',
            ceilingFill: 'rgba(56, 189, 248, 0.12)',
            ceilingStroke: '#38bdf8',
            selectedCeilingFill: 'rgba(59, 130, 246, 0.16)',
            selectedCeilingStroke: '#2563eb',
            wallFill: '#ffffff',
            wallStroke: 'rgba(31, 41, 55, 0.9)',
            wallInnerStroke: 'rgba(51, 65, 85, 0.72)',
            wallShadow: 'rgba(15, 23, 42, 0.12)',
            wallHoverStroke: '#60a5fa',
            deleteFill: '#f87171',
            deleteStroke: '#ef4444',
            deleteWallFill: '#ef4444',
            deleteWallHoverStroke: '#fca5a5',
            selectedFill: '#fafafa',
            selectedStroke: '#3b82f6',
            draftFill: '#818cf8',
            draftStroke: '#c7d2fe',
            measurementStroke: '#cbd5e1',
            cursor: '#818cf8',
            editCursor: '#8381ed',
            anchor: '#818cf8',
            openingFill: '#0a0e1b',
            openingStroke: '#fafafa',
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
            slabFill: 'rgba(148, 163, 184, 0.22)',
            slabStroke: 'rgba(100, 116, 139, 0.55)',
            selectedSlabFill: 'rgba(167, 139, 250, 0.14)',
            selectedSlabStroke: '#a78bfa',
            ceilingFill: 'rgba(14, 165, 233, 0.12)',
            ceilingStroke: '#0ea5e9',
            selectedCeilingFill: 'rgba(59, 130, 246, 0.16)',
            selectedCeilingStroke: '#2563eb',
            wallFill: '#ffffff',
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
            endpointHandleFill: '#fff7ed',
            endpointHandleStroke: '#c2410c',
            endpointHandleHoverStroke: '#fb923c',
            endpointHandleActiveFill: '#fff7ed',
            endpointHandleActiveStroke: '#f97316',
            curveHandleFill: '#ccfbf1',
            curveHandleStroke: '#0f766e',
            curveHandleHoverStroke: '#14b8a6',
          },
    [theme],
  )
  const wallSelectionHatchId = useMemo(() => `floorplan-wall-selection-hatch-${theme}`, [theme])
  const gridSteps = useMemo(
    () => getVisibleGridSteps(viewBox.width, surfaceSize.width),
    [surfaceSize.width, viewBox.width],
  )

  const minorGridPath = useMemo(
    () =>
      buildGridPath(
        viewBox.minX,
        viewBox.minX + viewBox.width,
        viewBox.minY,
        viewBox.minY + viewBox.height,
        gridSteps.minorStep,
        {
          excludeStep: gridSteps.majorStep,
        },
      ),
    [gridSteps.majorStep, gridSteps.minorStep, viewBox],
  )
  const majorGridPath = useMemo(
    () =>
      buildGridPath(
        viewBox.minX,
        viewBox.minX + viewBox.width,
        viewBox.minY,
        viewBox.minY + viewBox.height,
        gridSteps.majorStep,
      ),
    [gridSteps.majorStep, viewBox],
  )

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
  useEffect(() => {
    siteBoundaryDraftRef.current = siteBoundaryDraft
  }, [siteBoundaryDraft])

  useEffect(() => {
    slabBoundaryDraftRef.current = slabBoundaryDraft
  }, [slabBoundaryDraft])

  useEffect(() => {
    zoneBoundaryDraftRef.current = zoneBoundaryDraft
  }, [zoneBoundaryDraft])

  useEffect(() => {
    guideTransformDraftRef.current = guideTransformDraft
  }, [guideTransformDraft])

  const updateViewport = useCallback((nextViewport: FloorplanViewport) => {
    hasUserAdjustedViewportRef.current = true
    setViewport(nextViewport)
  }, [])

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

      const svgPoint = getSvgPointFromClientPoint(clientX, clientY)
      if (!svgPoint) {
        return
      }

      const currentViewport = viewport ?? fittedViewport
      const currentViewBox = viewBox
      const nextWidth = Math.min(
        maxViewportWidth,
        Math.max(minViewportWidth, currentViewport.width * widthFactor),
      )
      const nextHeight = nextWidth / svgAspectRatio
      const normalizedX = (svgPoint.x - currentViewBox.minX) / currentViewBox.width
      const normalizedY = (svgPoint.y - currentViewBox.minY) / currentViewBox.height
      const nextMinX = svgPoint.x - normalizedX * nextWidth
      const nextMinY = svgPoint.y - normalizedY * nextHeight

      updateViewport({
        centerX: nextMinX + nextWidth / 2,
        centerY: nextMinY + nextHeight / 2,
        width: nextWidth,
      })
    },
    [
      fittedViewport,
      getSvgPointFromClientPoint,
      maxViewportWidth,
      minViewportWidth,
      svgAspectRatio,
      updateViewport,
      viewBox,
      viewport,
    ],
  )

  const clearWallPlacementDraft = useCallback(() => {
    setDraftStart(null)
    setDraftEnd(null)
  }, [])
  const clearFencePlacementDraft = useCallback(() => {
    setFenceDraftStart(null)
    setFenceDraftEnd(null)
  }, [])
  const clearRoofPlacementDraft = useCallback(() => {
    setRoofDraftStart(null)
    setRoofDraftEnd(null)
  }, [])
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
  }, [])
  const clearWallCurveDrag = useCallback(() => {
    wallCurveDragRef.current = null
    setWallCurveDraft(null)
    setHoveredWallCurveHandleId(null)
  }, [])
  const clearSiteBoundaryInteraction = useCallback(() => {
    setSiteVertexDragState(null)
    setSiteBoundaryDraft(null)
    setHoveredSiteHandleId(null)
  }, [])
  const clearSlabBoundaryInteraction = useCallback(() => {
    setSlabVertexDragState(null)
    setSlabBoundaryDraft(null)
    setHoveredSlabHandleId(null)
  }, [])
  const clearZoneBoundaryInteraction = useCallback(() => {
    setZoneVertexDragState(null)
    setZoneBoundaryDraft(null)
    setHoveredZoneHandleId(null)
  }, [])

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
    clearSlabBoundaryInteraction()
    clearZoneBoundaryInteraction()
    setCursorPoint(null)
  }, [
    clearFencePlacementDraft,
    clearCeilingPlacementDraft,
    clearRoofPlacementDraft,
    clearWallCurveDrag,
    clearSiteBoundaryInteraction,
    clearSlabBoundaryInteraction,
    clearSlabPlacementDraft,
    clearZoneBoundaryInteraction,
    clearWallEndpointDrag,
    clearWallPlacementDraft,
    clearZonePlacementDraft,
  ])

  useEffect(() => {
    if (
      isWallBuildActive ||
      isFenceBuildActive ||
      isRoofBuildActive ||
      isPolygonDraftBuildActive
    ) {
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

  const createSlabOnCurrentLevel = useCallback(
    (points: WallPlanPoint[]) => {
      if (!levelId) {
        return null
      }

      const { createNode, nodes } = useScene.getState()
      const slabCount = Object.values(nodes).filter((node) => node.type === 'slab').length
      const slab = SlabNode.parse({
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

  useEffect(() => {
    if (!isStairBuildActive) {
      setStairBuildPreviewPoint(null)
      setStairBuildPreviewRotation(0)
      return
    }

    const handleGridMove = (event: GridEvent) => {
      setStairBuildPreviewPoint(
        getSnappedFloorplanPoint([event.localPosition[0], event.localPosition[2]]),
      )
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
      setMovingFloorplanNodeRevision((current) => current + 1)
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
  }, [isItemPlacementPreviewActive])

  useEffect(() => {
    if (!(movingNode?.type === 'door' || movingNode?.type === 'window')) {
      return
    }

    const movingOpeningId = movingNode.id
    const refreshOpeningPreview = () => {
      setMovingFloorplanNodeRevision((current) => current + 1)
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
  }, [movingNode])

  useEffect(() => {
    if (movingNode?.type !== 'fence') {
      return
    }

    const refreshFencePreview = () => {
      setMovingFloorplanNodeRevision((current) => current + 1)
    }

    refreshFencePreview()

    const unsubscribe = useLiveTransforms.subscribe((state, previousState) => {
      if (state.transforms !== previousState.transforms) {
        refreshFencePreview()
      }
    })

    return unsubscribe
  }, [movingNode])

  useEffect(() => {
    if (!(movingNode?.type === 'roof' || movingNode?.type === 'roof-segment')) {
      return
    }

    const movingRoofNodeId = movingNode.id
    const refreshRoofPreview = () => {
      setMovingFloorplanNodeRevision((current) => current + 1)
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
  }, [movingNode])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isEditableTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        Boolean(target?.isContentEditable)

      if (isEditableTarget) {
        return
      }

      if (event.key === 'Shift') {
        setShiftPressed(true)
      }

      if (isStairBuildActive && (event.key === 'r' || event.key === 'R')) {
        setStairBuildPreviewRotation((current) => current + Math.PI / 4)
      } else if (isStairBuildActive && (event.key === 't' || event.key === 'T')) {
        setStairBuildPreviewRotation((current) => current - Math.PI / 4)
      }

      if (
        (movingNode?.type === 'stair' || movingNode?.type === 'item') &&
        (event.key === 'r' || event.key === 'R' || event.key === 't' || event.key === 'T')
      ) {
        setMovingFloorplanNodeRevision((current) => current + 1)
      }

      setRotationModifierPressed(
        event.key === 'Meta' || event.key === 'Control' || event.metaKey || event.ctrlKey,
      )
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        setShiftPressed(false)
      }

      setRotationModifierPressed(event.metaKey || event.ctrlKey)
    }
    const handleBlur = () => {
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
  }, [isStairBuildActive, movingNode])

  useEffect(() => {
    const handleWindowPointerMove = (event: PointerEvent) => {
      const guideInteraction = guideInteractionRef.current
      if (guideInteraction && event.pointerId === guideInteraction.pointerId) {
        event.preventDefault()

        const svgPoint = getSvgPointFromClientPoint(event.clientX, event.clientY)
        if (!svgPoint) {
          return
        }

        const nextDraft =
          guideInteraction.mode === 'rotate'
            ? buildGuideRotationDraft(guideInteraction, svgPoint, shiftPressed)
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

        const snappedPoint = snapWallDraftPoint({
          point: planPoint,
          walls,
          start: dragState.fixedPoint,
          angleSnap: !shiftPressed,
          ignoreWallIds: [dragState.wallId],
        })

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
      const snappedPoint: WallPlanPoint = shiftPressed
        ? planPoint
        : [snapToHalf(planPoint[0]), snapToHalf(planPoint[1])]
      const rawCurveOffset = -(
        (snappedPoint[0] - chord.midpoint.x) * chord.normal.x +
        (snappedPoint[1] - chord.midpoint.y) * chord.normal.y
      )
      const nextCurveOffset = normalizeWallCurveOffset(
        wall,
        shiftPressed ? rawCurveOffset : snapToHalf(rawCurveOffset),
      )

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
      const nextDraft = svgPoint
        ? interaction.mode === 'rotate'
          ? buildGuideRotationDraft(interaction, svgPoint, shiftPressed)
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
            !(pointsEqual(update.start, currentWall.start) && pointsEqual(update.end, currentWall.end))
          )
        })

        if (commitUpdates.length > 0 && isWallLongEnough(nextDraft.start, nextDraft.end)) {
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
  ])

  useEffect(() => {
    pendingFenceDragRef.current = null
    clearWallEndpointDrag()
    clearWallCurveDrag()
  }, [clearWallCurveDrag, clearWallEndpointDrag, levelId])

  useEffect(() => {
    if (shouldShowSiteBoundaryHandles) {
      return
    }

    clearSiteBoundaryInteraction()
  }, [clearSiteBoundaryInteraction, shouldShowSiteBoundaryHandles])

  useEffect(() => {
    if (shouldShowSlabBoundaryHandles) {
      return
    }

    clearSlabBoundaryInteraction()
  }, [clearSlabBoundaryInteraction, shouldShowSlabBoundaryHandles])

  useEffect(() => {
    if (shouldShowZoneBoundaryHandles) {
      return
    }

    clearZoneBoundaryInteraction()
  }, [clearZoneBoundaryInteraction, shouldShowZoneBoundaryHandles])

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

      setSiteBoundaryDraft((currentDraft) => {
        if (!currentDraft || currentDraft.siteId !== dragState.siteId) {
          return currentDraft
        }

        const currentPoint = currentDraft.polygon[dragState.vertexIndex]
        if (currentPoint && pointsEqual(currentPoint, snappedPoint)) {
          return currentDraft
        }

        sfxEmitter.emit('sfx:grid-snap')

        const nextPolygon = [...currentDraft.polygon]
        nextPolygon[dragState.vertexIndex] = snappedPoint

        return {
          ...currentDraft,
          polygon: nextPolygon,
        }
      })
    }

    const commitSiteVertexDrag = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) {
        return
      }

      const draft = siteBoundaryDraftRef.current
      if (
        draft &&
        site &&
        draft.siteId === site.id &&
        !polygonsEqual(draft.polygon, site.polygon?.points ?? [])
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
            points: draft.polygon,
          },
        })
        sfxEmitter.emit('sfx:structure-build')
      }

      clearSiteBoundaryInteraction()
      setCursorPoint(null)
    }

    const cancelSiteVertexDrag = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) {
        return
      }

      clearSiteBoundaryInteraction()
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
    getPlanPointFromClientPoint,
    site,
    siteVertexDragState,
    updateNode,
  ])

  useEffect(() => {
    const dragState = slabVertexDragState
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

      setSlabBoundaryDraft((currentDraft) => {
        if (!currentDraft || currentDraft.slabId !== dragState.slabId) {
          return currentDraft
        }

        const currentPoint = currentDraft.polygon[dragState.vertexIndex]
        if (currentPoint && pointsEqual(currentPoint, snappedPoint)) {
          return currentDraft
        }

        sfxEmitter.emit('sfx:grid-snap')

        const nextPolygon = [...currentDraft.polygon]
        nextPolygon[dragState.vertexIndex] = snappedPoint

        return {
          ...currentDraft,
          polygon: nextPolygon,
        }
      })
    }

    const commitSlabVertexDrag = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) {
        return
      }

      const draft = slabBoundaryDraftRef.current
      const slab = slabById.get(dragState.slabId)
      if (draft && slab && !polygonsEqual(draft.polygon, slab.polygon)) {
        const suppressClick = (clickEvent: MouseEvent) => {
          clickEvent.stopImmediatePropagation()
          clickEvent.preventDefault()
          window.removeEventListener('click', suppressClick, true)
        }
        window.addEventListener('click', suppressClick, true)
        requestAnimationFrame(() => {
          window.removeEventListener('click', suppressClick, true)
        })

        updateNode(draft.slabId, {
          polygon: draft.polygon,
        })
        sfxEmitter.emit('sfx:structure-build')
      }

      clearSlabBoundaryInteraction()
      setCursorPoint(null)
    }

    const cancelSlabVertexDrag = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) {
        return
      }

      clearSlabBoundaryInteraction()
      setCursorPoint(null)
    }

    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerup', commitSlabVertexDrag)
    window.addEventListener('pointercancel', cancelSlabVertexDrag)

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove)
      window.removeEventListener('pointerup', commitSlabVertexDrag)
      window.removeEventListener('pointercancel', cancelSlabVertexDrag)
    }
  }, [
    clearSlabBoundaryInteraction,
    getPlanPointFromClientPoint,
    slabById,
    slabVertexDragState,
    updateNode,
  ])

  useEffect(() => {
    const dragState = zoneVertexDragState
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

      setZoneBoundaryDraft((currentDraft) => {
        if (!currentDraft || currentDraft.zoneId !== dragState.zoneId) {
          return currentDraft
        }

        const currentPoint = currentDraft.polygon[dragState.vertexIndex]
        if (currentPoint && pointsEqual(currentPoint, snappedPoint)) {
          return currentDraft
        }

        sfxEmitter.emit('sfx:grid-snap')

        const nextPolygon = [...currentDraft.polygon]
        nextPolygon[dragState.vertexIndex] = snappedPoint

        return {
          ...currentDraft,
          polygon: nextPolygon,
        }
      })
    }

    const commitZoneVertexDrag = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) {
        return
      }

      const draft = zoneBoundaryDraftRef.current
      const zone = zoneById.get(dragState.zoneId)
      if (draft && zone && !polygonsEqual(draft.polygon, zone.polygon)) {
        const suppressClick = (clickEvent: MouseEvent) => {
          clickEvent.stopImmediatePropagation()
          clickEvent.preventDefault()
          window.removeEventListener('click', suppressClick, true)
        }
        window.addEventListener('click', suppressClick, true)
        requestAnimationFrame(() => {
          window.removeEventListener('click', suppressClick, true)
        })

        updateNode(draft.zoneId, {
          polygon: draft.polygon,
        })
        sfxEmitter.emit('sfx:structure-build')
      }

      clearZoneBoundaryInteraction()
      setCursorPoint(null)
    }

    const cancelZoneVertexDrag = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) {
        return
      }

      clearZoneBoundaryInteraction()
      setCursorPoint(null)
    }

    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerup', commitZoneVertexDrag)
    window.addEventListener('pointercancel', cancelZoneVertexDrag)

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove)
      window.removeEventListener('pointerup', commitZoneVertexDrag)
      window.removeEventListener('pointercancel', cancelZoneVertexDrag)
    }
  }, [
    clearZoneBoundaryInteraction,
    getPlanPointFromClientPoint,
    updateNode,
    zoneById,
    zoneVertexDragState,
  ])

  useEffect(() => {
    return () => {
      setFloorplanHovered(false)
    }
  }, [setFloorplanHovered])

  const handlePointerDown = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 2) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    panStateRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
    }
    setIsPanning(true)

    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])

  const endPanning = useCallback((event?: ReactPointerEvent<SVGSVGElement>) => {
    if (event && panStateRef.current && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    panStateRef.current = null
    setIsPanning(false)
  }, [])

  const hoveredWallIdRef = useRef<string | null>(null)
  const floorplanGridLocalY = useMemo(() => {
    if (movingNode?.type === 'item') {
      return movingNode.position[1]
    }

    if (levelId) {
      return sceneRegistry.nodes.get(levelId as AnyNodeId)?.position.y ?? 0
    }

    return 0
  }, [levelId, movingNode])
  const floorplanGridWorldY = buildingPosition[1] + floorplanGridLocalY
  const emitFloorplanWallLeave = useCallback((wallId: string | null) => {
    if (!wallId) {
      return
    }

    const wallNode = useScene.getState().nodes[wallId as AnyNodeId]
    if (!wallNode || wallNode.type !== 'wall') {
      return
    }

    emitter.emit('wall:leave', {
      node: wallNode,
      position: [0, 0, 0],
      localPosition: [0, 0, 0],
      stopPropagation: () => {},
    } as any)
  }, [])
  const emitFloorplanGridEvent = useCallback(
    (
      eventType: 'move' | 'click' | 'double-click',
      planPoint: WallPlanPoint,
      nativeEvent: ReactMouseEvent<SVGSVGElement> | ReactPointerEvent<SVGSVGElement>,
    ) => {
      const snappedPoint = getSnappedFloorplanPoint(planPoint)
      const cos = Math.cos(buildingRotationY)
      const sin = Math.sin(buildingRotationY)
      const worldX = buildingPosition[0] + snappedPoint[0] * cos - snappedPoint[1] * sin
      const worldZ = buildingPosition[2] + snappedPoint[0] * sin + snappedPoint[1] * cos

      emitter.emit(`grid:${eventType}` as any, {
        nativeEvent: nativeEvent.nativeEvent as any,
        position: [worldX, floorplanGridWorldY, worldZ],
        localPosition: [snappedPoint[0], floorplanGridLocalY, snappedPoint[1]],
      })

      return snappedPoint
    },
    [buildingPosition, buildingRotationY, floorplanGridLocalY, floorplanGridWorldY],
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (panStateRef.current?.pointerId === event.pointerId) {
        const deltaX = event.clientX - panStateRef.current.clientX
        const deltaY = event.clientY - panStateRef.current.clientY
        const worldPerPixelX = viewBox.width / surfaceSize.width
        const worldPerPixelY = viewBox.height / surfaceSize.height

        updateViewport({
          centerX: (viewport ?? fittedViewport).centerX - deltaX * worldPerPixelX,
          centerY: (viewport ?? fittedViewport).centerY - deltaY * worldPerPixelY,
          width: (viewport ?? fittedViewport).width,
        })

        panStateRef.current = {
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
        }
        setCursorPoint(null)
        return
      }

      if (guideInteractionRef.current?.pointerId === event.pointerId) {
        return
      }

      if (wallEndpointDragRef.current?.pointerId === event.pointerId) {
        return
      }

      if (slabVertexDragState?.pointerId === event.pointerId) {
        return
      }

      if (siteVertexDragState?.pointerId === event.pointerId) {
        return
      }

      if (zoneVertexDragState?.pointerId === event.pointerId) {
        return
      }

      const planPoint = getPlanPointFromClientPoint(event.clientX, event.clientY)
      if (!planPoint) {
        return
      }

      if (isCeilingBuildActive) {
        emitFloorplanGridEvent('move', planPoint, event)

        const snappedPoint = snapPolygonDraftPoint({
          point: planPoint,
          start: ceilingDraftPoints[ceilingDraftPoints.length - 1],
          angleSnap: ceilingDraftPoints.length > 0 && !shiftPressed,
        })

        setCursorPoint((previousPoint) =>
          previousPoint && pointsEqual(previousPoint, snappedPoint) ? previousPoint : snappedPoint,
        )
        return
      }

      if (isRoofBuildActive) {
        const snappedPoint = getSnappedFloorplanPoint(planPoint)
        emitFloorplanGridEvent('move', snappedPoint, event)
        setCursorPoint((previousPoint) =>
          previousPoint && pointsEqual(previousPoint, snappedPoint) ? previousPoint : snappedPoint,
        )

        if (roofDraftStart) {
          setRoofDraftEnd((previousPoint) =>
            previousPoint && pointsEqual(previousPoint, snappedPoint) ? previousPoint : snappedPoint,
          )
        }
        return
      }

      if (isFenceBuildActive) {
        emitFloorplanGridEvent('move', planPoint, event)

        const snappedPoint = snapFenceDraftPoint({
          point: planPoint,
          walls,
          fences,
          start: fenceDraftStart ?? undefined,
          angleSnap: Boolean(fenceDraftStart) && !shiftPressed,
        })

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

      if (isFloorplanGridInteractionActive) {
        const snappedPoint = emitFloorplanGridEvent('move', planPoint, event)
        setCursorPoint((previousPoint) =>
          previousPoint && pointsEqual(previousPoint, snappedPoint) ? previousPoint : snappedPoint,
        )
        return
      }

      if (isPolygonBuildActive) {
        const snappedPoint = snapPolygonDraftPoint({
          point: planPoint,
          start: activePolygonDraftPoints[activePolygonDraftPoints.length - 1],
          angleSnap: activePolygonDraftPoints.length > 0 && !shiftPressed,
        })

        setCursorPoint((previousPoint) => {
          const hasChanged = !(previousPoint && pointsEqual(previousPoint, snappedPoint))
          if (hasChanged && activePolygonDraftPoints.length > 0) {
            sfxEmitter.emit('sfx:grid-snap')
          }
          return snappedPoint
        })
        return
      }

      if (isOpeningPlacementActive) {
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
        } else if (hoveredWallIdRef.current) {
          emitFloorplanWallLeave(hoveredWallIdRef.current)
          hoveredWallIdRef.current = null
        }
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

      const snappedPoint = snapWallDraftPoint({
        point: planPoint,
        walls,
        start: draftStart ?? undefined,
        angleSnap: Boolean(draftStart) && !shiftPressed,
      })

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
      draftStart,
      ceilingDraftPoints,
      emitFloorplanWallLeave,
      emitFloorplanGridEvent,
      fences,
      fenceDraftStart,
      floorplanOpeningLocalY,
      fittedViewport,
      getPlanPointFromClientPoint,
      activePolygonDraftPoints,
      isCeilingBuildActive,
      isFenceBuildActive,
      isFloorplanGridInteractionActive,
      isMarqueeSelectionToolActive,
      isOpeningPlacementActive,
      isPolygonBuildActive,
      isRoofBuildActive,
      isWallBuildActive,
      roofDraftStart,
      siteVertexDragState,
      slabVertexDragState,
      shiftPressed,
      surfaceSize.height,
      surfaceSize.width,
      updateViewport,
      viewBox.height,
      viewBox.width,
      viewport,
      walls,
      zoneVertexDragState,
    ],
  )

  const handleSlabPlacementPoint = useCallback(
    (point: WallPlanPoint) => {
      const lastPoint = slabDraftPoints[slabDraftPoints.length - 1]
      if (lastPoint && pointsEqual(lastPoint, point)) {
        return
      }

      const firstPoint = slabDraftPoints[0]
      if (firstPoint && slabDraftPoints.length >= 3 && isPointNearPlanPoint(point, firstPoint)) {
        createSlabOnCurrentLevel(slabDraftPoints)
        clearDraft()
        return
      }

      setSlabDraftPoints((currentPoints) => [...currentPoints, point])
      setCursorPoint(point)
    },
    [clearDraft, createSlabOnCurrentLevel, slabDraftPoints],
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

      createSlabOnCurrentLevel(nextPoints)
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
      if (
        firstPoint &&
        ceilingDraftPoints.length >= 3 &&
        isPointNearPlanPoint(point, firstPoint)
      ) {
        clearCeilingPlacementDraft()
        return
      }

      setCeilingDraftPoints((currentPoints) => [...currentPoints, point])
      setCursorPoint(point)
    },
    [ceilingDraftPoints, clearCeilingPlacementDraft],
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

      clearCeilingPlacementDraft()
    },
    [ceilingDraftPoints, clearCeilingPlacementDraft],
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

      setZoneDraftPoints((currentPoints) => [...currentPoints, point])
      setCursorPoint(point)
    },
    [clearDraft, createZoneOnCurrentLevel, zoneDraftPoints],
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
        setDraftEnd(point)
        setCursorPoint(point)
        return
      }

      if (!isWallLongEnough(draftStart, point)) {
        return
      }

      createWallOnCurrentLevel(draftStart, point)
      clearDraft()
    },
    [clearDraft, draftStart],
  )

  const handleBackgroundClick = useCallback(
    (event: ReactMouseEvent<SVGSVGElement>) => {
      if (isPolygonBuildActive && event.detail >= 2) {
        return
      }

      const planPoint = getPlanPointFromClientPoint(event.clientX, event.clientY)
      if (!planPoint) {
        return
      }

      if (isOpeningPlacementActive) {
        const closest = findClosestWallPoint(planPoint, walls, {
          canUseWall: (wall) => !isCurvedWall(wall),
        })
        if (closest) {
          const dx = closest.wall.end[0] - closest.wall.start[0]
          const dz = closest.wall.end[1] - closest.wall.start[1]
          const length = Math.sqrt(dx * dx + dz * dz)
          const distance = closest.t * length

          emitter.emit('wall:click', {
            node: closest.wall,
            point: { x: closest.point[0], y: 0, z: closest.point[1] },
            localPosition: [distance, floorplanOpeningLocalY, 0],
            normal: closest.normal,
            stopPropagation: () => {},
          } as any)
        }
        return
      }

      if (isCeilingBuildActive) {
        emitFloorplanGridEvent('click', planPoint, event)

        const snappedPoint = snapPolygonDraftPoint({
          point: planPoint,
          start: ceilingDraftPoints[ceilingDraftPoints.length - 1],
          angleSnap: ceilingDraftPoints.length > 0 && !shiftPressed,
        })

        handleCeilingPlacementPoint(snappedPoint)
        return
      }

      if (isRoofBuildActive) {
        const snappedPoint = getSnappedFloorplanPoint(planPoint)
        emitFloorplanGridEvent('click', snappedPoint, event)
        setCursorPoint(snappedPoint)

        if (!roofDraftStart) {
          setRoofDraftStart(snappedPoint)
          setRoofDraftEnd(snappedPoint)
        } else {
          clearRoofPlacementDraft()
        }
        return
      }

      if (isFenceBuildActive) {
        emitFloorplanGridEvent('click', planPoint, event)

        const snappedPoint = snapFenceDraftPoint({
          point: planPoint,
          walls,
          fences,
          start: fenceDraftStart ?? undefined,
          angleSnap: Boolean(fenceDraftStart) && !shiftPressed,
        })

        setCursorPoint(snappedPoint)

        if (!fenceDraftStart) {
          setFenceDraftStart(snappedPoint)
          setFenceDraftEnd(snappedPoint)
        } else if (getPlanPointDistance(toPoint2D(fenceDraftStart), toPoint2D(snappedPoint)) >= 0.01) {
          clearFencePlacementDraft()
        } else {
          setFenceDraftEnd(snappedPoint)
        }
        return
      }

      if (isFloorplanGridInteractionActive) {
        const snappedPoint = emitFloorplanGridEvent('click', planPoint, event)
        setCursorPoint(snappedPoint)
        return
      }

      if (isPolygonBuildActive) {
        const snappedPoint = snapPolygonDraftPoint({
          point: planPoint,
          start: activePolygonDraftPoints[activePolygonDraftPoints.length - 1],
          angleSnap: activePolygonDraftPoints.length > 0 && !shiftPressed,
        })

        if (isZoneBuildActive) {
          handleZonePlacementPoint(snappedPoint)
        } else {
          handleSlabPlacementPoint(snappedPoint)
        }
        return
      }

      if (canSelectFloorplanZones) {
        const zoneHit = visibleZonePolygons.find(({ polygon }) =>
          isPointInsidePolygon(toPoint2D(planPoint), polygon),
        )
        if (zoneHit) {
          setSelectedReferenceId(null)
          setSelection({ zoneId: zoneHit.zone.id })
          return
        }
      }

      const modifierKeys = getSelectionModifierKeys(event)

      if (canSelectElementFloorplanGeometry) {
        const hitId = getFloorplanHitNodeId({
          point: toPoint2D(planPoint),
          ceilings: ceilingPolygons,
          phase,
          isItemContextActive: isFloorplanItemContextActive,
          items: floorplanItemEntries,
          openings: openingsPolygons,
          roofs: floorplanRoofEntries,
          stairs: floorplanStairEntries,
          walls: displayWallPolygons,
          slabs: displaySlabPolygons,
          openingHitTolerance: floorplanOpeningHitTolerance,
          wallHitTolerance: floorplanWallHitTolerance,
          getOpeningCenterLine,
        })
        if (hitId) {
          const currentSelectedIds = useViewer.getState().selection.selectedIds
          const nextSelectedIds =
            modifierKeys.meta || modifierKeys.ctrl
              ? currentSelectedIds.includes(hitId)
                ? currentSelectedIds.filter((selectedId) => selectedId !== hitId)
                : [...currentSelectedIds, hitId]
              : [hitId]

          if (!(levelId && levelNode) || levelNode.type !== 'level') {
            setSelectedReferenceId(null)
            setSelection({ selectedIds: nextSelectedIds })
          } else {
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
          }
          return
        }
      }

      if (!isWallBuildActive) {
        if (structureLayer === 'zones') {
          setSelectedReferenceId(null)
          setSelection({ zoneId: null })
          // Return to structure select (same as 3D grid click)
          useEditor.getState().setStructureLayer('elements')
          useEditor.getState().setMode('select')
        } else {
          setSelectedReferenceId(null)
          if (!(modifierKeys.meta || modifierKeys.ctrl)) {
            setSelection({ selectedIds: [] })
          }
        }
        return
      }

      const snappedPoint = snapWallDraftPoint({
        point: planPoint,
        walls,
        start: draftStart ?? undefined,
        angleSnap: Boolean(draftStart) && !shiftPressed,
      })

      handleWallPlacementPoint(snappedPoint)
    },
    [
      draftStart,
      ceilingDraftPoints,
      emitFloorplanGridEvent,
      fences,
      fenceDraftStart,
      floorplanOpeningLocalY,
      getPlanPointFromClientPoint,
      activePolygonDraftPoints,
      canSelectElementFloorplanGeometry,
      canSelectFloorplanZones,
      ceilingPolygons,
      displaySlabPolygons,
      displayWallPolygons,
      floorplanItemEntries,
      floorplanOpeningHitTolerance,
      floorplanRoofEntries,
      floorplanStairEntries,
      floorplanWallHitTolerance,
      getOpeningCenterLine,
      handleCeilingPlacementPoint,
      handleSlabPlacementPoint,
      handleZonePlacementPoint,
      handleWallPlacementPoint,
      clearFencePlacementDraft,
      clearRoofPlacementDraft,
      isCeilingBuildActive,
      isFenceBuildActive,
      isFloorplanGridInteractionActive,
      isFloorplanItemContextActive,
      isOpeningPlacementActive,
      isPolygonBuildActive,
      isRoofBuildActive,
      isWallBuildActive,
      isWindowBuildActive,
      isZoneBuildActive,
      levelId,
      levelNode,
      movingOpeningType,
      openingsPolygons,
      phase,
      roofDraftStart,
      setSelectedReferenceId,
      setSelection,
      shiftPressed,
      structureLayer,
      visibleZonePolygons,
      walls,
    ],
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

      const snappedPoint = snapPolygonDraftPoint({
        point: planPoint,
        start: activePolygonDraftPoints[activePolygonDraftPoints.length - 1],
        angleSnap: activePolygonDraftPoints.length > 0 && !shiftPressed,
      })

      if (isCeilingBuildActive) {
        emitFloorplanGridEvent('double-click', planPoint, event)
        handleCeilingPlacementConfirm(snappedPoint)
        return
      }

      if (isZoneBuildActive) {
        handleZonePlacementConfirm(snappedPoint)
      } else {
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
      shiftPressed,
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
    (nextSelectedIds: string[], modifierKeys?: { meta: boolean; ctrl: boolean }) => {
      const shouldAppend = Boolean(modifierKeys?.meta || modifierKeys?.ctrl)

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
    (nodeId: string, modifierKeys?: { meta: boolean; ctrl: boolean }) => {
      const shouldToggle = Boolean(modifierKeys?.meta || modifierKeys?.ctrl)

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

  const getFloorplanHitIdAtPoint = useCallback(
    (planPoint: WallPlanPoint) => {
      const point = toPoint2D(planPoint)
      return getFloorplanHitNodeId({
        point,
        ceilings: ceilingPolygons,
        phase,
        isItemContextActive: isFloorplanItemContextActive,
        items: floorplanItemEntries,
        openings: openingsPolygons,
        roofs: floorplanRoofEntries,
        stairs: floorplanStairEntries,
        walls: displayWallPolygons,
        slabs: displaySlabPolygons,
        openingHitTolerance: floorplanOpeningHitTolerance,
        wallHitTolerance: floorplanWallHitTolerance,
        getOpeningCenterLine,
      })
    },
    [
      ceilingPolygons,
      displaySlabPolygons,
      displayWallPolygons,
      floorplanItemEntries,
      floorplanOpeningHitTolerance,
      floorplanRoofEntries,
      floorplanStairEntries,
      floorplanWallHitTolerance,
      getOpeningCenterLine,
      openingsPolygons,
      phase,
      isFloorplanItemContextActive,
    ],
  )

  const getFloorplanSelectionIdsInBounds = useCallback(
    (bounds: FloorplanSelectionBounds) =>
      getSelectionIdsInBoundsFromTool({
        bounds,
        ceilings: ceilingPolygons,
        phase,
        isItemContextActive: isFloorplanItemContextActive,
        items: floorplanItemEntries,
        walls: displayWallPolygons,
        openings: openingsPolygons,
        roofs: floorplanRoofEntries,
        slabs: displaySlabPolygons,
        stairs: floorplanStairEntries,
      }),
    [
      ceilingPolygons,
      displaySlabPolygons,
      displayWallPolygons,
      floorplanItemEntries,
      floorplanRoofEntries,
      floorplanStairEntries,
      isFloorplanItemContextActive,
      openingsPolygons,
      phase,
    ],
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

  const syncDeleteHoveredId = useCallback(
    (nodeId: string | null) => {
      if (!isDeleteMode) {
        return
      }

      useViewer.getState().setHoveredId(nodeId as AnyNodeId | null)
    },
    [isDeleteMode],
  )

  const handleWallHoverChange = useCallback(
    (wallId: WallNode['id'] | null) => {
      setHoveredWallId(wallId)
      syncDeleteHoveredId(wallId)
    },
    [syncDeleteHoveredId],
  )
  const handleFenceHoverChange = useCallback(
    (fenceId: FenceNode['id'] | null) => {
      setHoveredFenceId(fenceId)
      syncDeleteHoveredId(fenceId)
    },
    [syncDeleteHoveredId],
  )

  const handleOpeningHoverChange = useCallback(
    (openingId: OpeningNode['id'] | null) => {
      setHoveredOpeningId(openingId)
      syncDeleteHoveredId(openingId)
    },
    [syncDeleteHoveredId],
  )

  const handleSlabHoverChange = useCallback(
    (slabId: SlabNode['id'] | null) => {
      setHoveredSlabId(slabId)
      syncDeleteHoveredId(slabId)
    },
    [syncDeleteHoveredId],
  )

  const handleCeilingHoverChange = useCallback(
    (ceilingId: CeilingNode['id'] | null) => {
      setHoveredCeilingId(ceilingId)
      syncDeleteHoveredId(ceilingId)
    },
    [syncDeleteHoveredId],
  )

  const handleItemHoverChange = useCallback(
    (itemId: ItemNode['id'] | null) => {
      setHoveredItemId(itemId)
      syncDeleteHoveredId(itemId)
    },
    [syncDeleteHoveredId],
  )

  const handleStairHoverChange = useCallback(
    (stairId: StairNode['id'] | null) => {
      setHoveredStairId(stairId)
      syncDeleteHoveredId(stairId)
    },
    [syncDeleteHoveredId],
  )

  const handleZoneHoverChange = useCallback(
    (zoneId: ZoneNodeType['id'] | null) => {
      setHoveredZoneId(zoneId)
      syncDeleteHoveredId(zoneId)
    },
    [syncDeleteHoveredId],
  )
  const handleFloorplanItemHoverEnter = useCallback(
    (itemId: ItemNode['id']) => {
      handleFenceHoverChange(null)
      handleOpeningHoverChange(null)
      handleWallHoverChange(null)
      handleSlabHoverChange(null)
      handleCeilingHoverChange(null)
      handleStairHoverChange(null)
      handleZoneHoverChange(null)
      handleItemHoverChange(itemId)
    },
    [
      handleFenceHoverChange,
      handleItemHoverChange,
      handleOpeningHoverChange,
      handleCeilingHoverChange,
      handleSlabHoverChange,
      handleStairHoverChange,
      handleWallHoverChange,
      handleZoneHoverChange,
    ],
  )
  const handleFloorplanFenceHoverEnter = useCallback(
    (fenceId: FenceNode['id']) => {
      handleItemHoverChange(null)
      handleOpeningHoverChange(null)
      handleWallHoverChange(null)
      handleSlabHoverChange(null)
      handleCeilingHoverChange(null)
      handleStairHoverChange(null)
      handleZoneHoverChange(null)
      handleFenceHoverChange(fenceId)
    },
    [
      handleFenceHoverChange,
      handleItemHoverChange,
      handleOpeningHoverChange,
      handleCeilingHoverChange,
      handleSlabHoverChange,
      handleStairHoverChange,
      handleWallHoverChange,
      handleZoneHoverChange,
    ],
  )
  const handleFloorplanStairHoverEnter = useCallback(
    (stairId: StairNode['id']) => {
      handleItemHoverChange(null)
      handleFenceHoverChange(null)
      handleOpeningHoverChange(null)
      handleSlabHoverChange(null)
      handleCeilingHoverChange(null)
      handleWallHoverChange(null)
      handleZoneHoverChange(null)
      handleStairHoverChange(stairId)
    },
    [
      handleFenceHoverChange,
      handleItemHoverChange,
      handleOpeningHoverChange,
      handleCeilingHoverChange,
      handleSlabHoverChange,
      handleStairHoverChange,
      handleWallHoverChange,
      handleZoneHoverChange,
    ],
  )

  const handleWallSelect = useCallback(
    (wall: WallNode) => {
      commitFloorplanSelection([wall.id])
    },
    [commitFloorplanSelection],
  )

  const handleWallClick = useCallback(
    (wall: WallNode, event: ReactMouseEvent<SVGElement>) => {
      const centerX = (wall.start[0] + wall.end[0]) / 2
      const centerZ = (wall.start[1] + wall.end[1]) / 2
      const halfLength = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]) / 2
      const localY = isOpeningPlacementActive ? floorplanOpeningLocalY : 0

      setSelectedReferenceId(null)
      emitter.emit('wall:click', {
        node: wall,
        position: [centerX, 0, centerZ],
        localPosition: [halfLength, localY, 0],
        stopPropagation: () => event.stopPropagation(),
        nativeEvent: event.nativeEvent as any,
      } as any)
    },
    [floorplanOpeningLocalY, isOpeningPlacementActive, setSelectedReferenceId],
  )

  const handleWallDoubleClick = useCallback(
    (wall: WallNode, event: ReactMouseEvent<SVGElement>) => {
      const centerX = (wall.start[0] + wall.end[0]) / 2
      const centerZ = (wall.start[1] + wall.end[1]) / 2
      const halfLength = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]) / 2

      emitter.emit('wall:double-click', {
        node: wall,
        position: [centerX, 0, centerZ],
        localPosition: [halfLength, 0, 0],
        stopPropagation: () => event.stopPropagation(),
        nativeEvent: event.nativeEvent as any,
      } as any)
      emitter.emit('camera-controls:focus', { nodeId: wall.id })
    },
    [],
  )
  const handleFenceClick = useCallback(
    (fence: FenceNode, event: ReactMouseEvent<SVGElement>) => {
      const centerX = (fence.start[0] + fence.end[0]) / 2
      const centerZ = (fence.start[1] + fence.end[1]) / 2
      const halfLength =
        Math.hypot(fence.end[0] - fence.start[0], fence.end[1] - fence.start[1]) / 2

      setSelectedReferenceId(null)
      emitter.emit('fence:click', {
        node: fence,
        position: [centerX, 0, centerZ],
        localPosition: [halfLength, 0, 0],
        stopPropagation: () => event.stopPropagation(),
        nativeEvent: event.nativeEvent as any,
      } as any)
    },
    [setSelectedReferenceId],
  )
  const handleFenceDoubleClick = useCallback((fence: FenceNode, event: ReactMouseEvent<SVGElement>) => {
    const centerX = (fence.start[0] + fence.end[0]) / 2
    const centerZ = (fence.start[1] + fence.end[1]) / 2
    const halfLength =
      Math.hypot(fence.end[0] - fence.start[0], fence.end[1] - fence.start[1]) / 2

    emitter.emit('fence:double-click', {
      node: fence,
      position: [centerX, 0, centerZ],
      localPosition: [halfLength, 0, 0],
      stopPropagation: () => event.stopPropagation(),
      nativeEvent: event.nativeEvent as any,
    } as any)
    emitter.emit('camera-controls:focus', { nodeId: fence.id })
  }, [])
  const emitFloorplanNodeClick = useCallback(
    (
      nodeId:
        | ItemNode['id']
        | OpeningNode['id']
        | SlabNode['id']
        | CeilingNode['id']
        | StairNode['id']
        | ZoneNodeType['id'],
      eventType: 'click' | 'double-click',
      event: ReactMouseEvent<SVGElement>,
    ) => {
      const node = useScene.getState().nodes[nodeId as AnyNodeId]
      if (
        !(
          node &&
          (node.type === 'slab' ||
            node.type === 'ceiling' ||
            node.type === 'door' ||
            node.type === 'window' ||
            node.type === 'item' ||
            node.type === 'stair' ||
            node.type === 'zone')
        )
      ) {
        return
      }

      setSelectedReferenceId(null)
      emitter.emit(
        `${node.type}:${eventType}` as any,
        {
          localPosition: [0, 0, 0],
          nativeEvent: event.nativeEvent as any,
          node,
          position: [0, 0, 0],
          stopPropagation: () => event.stopPropagation(),
        } as any,
      )
    },
    [setSelectedReferenceId],
  )
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
      if (event.button !== 0 || !canInteractWithGuides) {
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
      const rotationSvg = -guide.rotation[1]
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
        ? getGuideRotateCursor(theme === 'dark')
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
    [canInteractWithGuides, handleGuideSelect, theme],
  )
  const handleGuideTranslateStart = useCallback(
    (guide: GuideNode, event: ReactPointerEvent<SVGRectElement>) => {
      if (event.button !== 0 || !canInteractWithGuides || selectedGuideId !== guide.id) {
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
        rotationSvg: -guide.rotation[1],
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
    [canInteractWithGuides, getSvgPointFromClientPoint, selectedGuideId],
  )

  const handleOpeningSelect = useCallback(
    (openingId: OpeningNode['id'], event: ReactMouseEvent<SVGElement>) => {
      emitFloorplanNodeClick(openingId, 'click', event)
    },
    [emitFloorplanNodeClick],
  )
  const handleOpeningPointerDown = useCallback(
    (openingId: OpeningNode['id'], event: ReactPointerEvent<SVGElement>) => {
      if (event.button !== 0) {
        return
      }

      const opening = selectedOpeningEntry?.opening
      if (!opening || opening.id !== openingId) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      // Suppress the click event that follows this pointer interaction so it
      // doesn't re-select or interfere with placement.
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
      setMovingNode(opening)
      setSelection({ selectedIds: [] })
    },
    [selectedOpeningEntry, setMovingNode, setSelection],
  )
  const handleSlabSelect = useCallback(
    (slabId: SlabNode['id'], event: ReactMouseEvent<SVGElement>) => {
      emitFloorplanNodeClick(slabId, 'click', event)
    },
    [emitFloorplanNodeClick],
  )
  const handleCeilingSelect = useCallback(
    (ceilingId: CeilingNode['id'], event: ReactMouseEvent<SVGElement>) => {
      emitFloorplanNodeClick(ceilingId, 'click', event)
    },
    [emitFloorplanNodeClick],
  )
  const handleZoneSelect = useCallback(
    (zoneId: ZoneNodeType['id'], event: ReactMouseEvent<SVGElement>) => {
      emitFloorplanNodeClick(zoneId, 'click', event)
    },
    [emitFloorplanNodeClick],
  )
  const handleItemSelect = useCallback(
    (itemId: ItemNode['id'], event: ReactMouseEvent<SVGElement>) => {
      emitFloorplanNodeClick(itemId, 'click', event)
    },
    [emitFloorplanNodeClick],
  )
  const handleStairSelect = useCallback(
    (stairId: StairNode['id'], event: ReactMouseEvent<SVGElement>) => {
      emitFloorplanNodeClick(stairId, 'click', event)
    },
    [emitFloorplanNodeClick],
  )
  const handleZoneLabelClick = useCallback(
    (zoneId: ZoneNodeType['id'], _event: ReactMouseEvent<SVGElement>) => {
      const currentZoneId = useViewer.getState().selection.zoneId
      if (currentZoneId === zoneId) {
        // Already selected → enter text editing (second click)
        emitter.emit('zone:edit-label' as any, { zoneId })
        return
      }
      // Not selected → select zone + switch to zone mode
      useEditor.getState().setPhase('structure')
      useEditor.getState().setStructureLayer('zones')
      useEditor.getState().setMode('select')
      setSelection({ zoneId })
    },
    [setSelection],
  )
  const handleSlabDoubleClick = useCallback((slab: SlabNode) => {
    emitter.emit('camera-controls:focus', { nodeId: slab.id })
  }, [])
  const handleCeilingDoubleClick = useCallback((ceiling: CeilingNode) => {
    emitter.emit('camera-controls:focus', { nodeId: ceiling.id })
  }, [])
  const handleOpeningDoubleClick = useCallback((opening: OpeningNode) => {
    emitter.emit('camera-controls:focus', { nodeId: opening.id })
  }, [])
  const handleItemDoubleClick = useCallback(
    (item: ItemNode, event: ReactMouseEvent<SVGElement>) => {
      emitFloorplanNodeClick(item.id, 'double-click', event)
      emitter.emit('camera-controls:focus', { nodeId: item.id })
    },
    [emitFloorplanNodeClick],
  )
  const handleItemPointerDown = useCallback(
    (itemId: ItemNode['id'], event: ReactPointerEvent<SVGElement>) => {
      if (event.button !== 0) {
        return
      }

      const item = selectedItemEntry?.item
      if (!item || item.id !== itemId) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      // Suppress the click event that follows this pointer interaction so it
      // doesn't re-select or interfere with placement.
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
      setMovingNode(item)
      setSelection({ selectedIds: [] })
    },
    [selectedItemEntry, setMovingNode, setSelection],
  )
  const handleSelectedItemMove = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()

      const item = selectedItemEntry?.item
      if (!item) {
        return
      }

      sfxEmitter.emit('sfx:item-pick')
      setMovingNode(item)
      setSelection({ selectedIds: [] })
    },
    [selectedItemEntry, setMovingNode, setSelection],
  )
  const duplicateSelectedItem = useCallback(() => {
    const item = selectedItemEntry?.item
    if (!item) {
      return
    }

    sfxEmitter.emit('sfx:item-pick')

    const cloned = structuredClone(item) as Record<string, unknown>
    delete cloned.id
    cloned.metadata = {
      ...(typeof cloned.metadata === 'object' && cloned.metadata !== null ? cloned.metadata : {}),
      isNew: true,
    }
    cloned.children = []

    try {
      const duplicate = ItemNodeSchema.parse(cloned)
      setMovingNode(duplicate)
      setSelection({ selectedIds: [] })
    } catch (error) {
      console.error('Failed to duplicate item', error)
    }
  }, [selectedItemEntry, setMovingNode, setSelection])
  const handleSelectedItemDuplicate = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      duplicateSelectedItem()
    },
    [duplicateSelectedItem],
  )
  const handleSelectedItemDelete = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()

      const item = selectedItemEntry?.item
      if (!item) {
        return
      }

      sfxEmitter.emit('sfx:item-delete')
      deleteNode(item.id as AnyNodeId)
      setSelection({ selectedIds: [] })
    },
    [deleteNode, selectedItemEntry, setSelection],
  )
  const handleSelectedWallMove = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()

      const wall = selectedWallEntry?.wall
      if (!wall) {
        return
      }

      sfxEmitter.emit('sfx:item-pick')
      setMovingNode(wall)
      setSelection({ selectedIds: [] })
    },
    [selectedWallEntry, setMovingNode, setSelection],
  )
  const handleSelectedWallDelete = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()

      const wall = selectedWallEntry?.wall
      if (!wall) {
        return
      }

      sfxEmitter.emit('sfx:item-delete')
      deleteNode(wall.id as AnyNodeId)
      setSelection({ selectedIds: [] })
    },
    [deleteNode, selectedWallEntry, setSelection],
  )
  const handleSelectedSlabMove = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()

      const slab = selectedSlabEntry?.slab
      if (!slab) {
        return
      }

      sfxEmitter.emit('sfx:item-pick')
      setMovingNode(slab)
      setSelection({ selectedIds: [] })
    },
    [selectedSlabEntry, setMovingNode, setSelection],
  )
  const handleSelectedSlabDelete = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()

      const slab = selectedSlabEntry?.slab
      if (!slab) {
        return
      }

      sfxEmitter.emit('sfx:item-delete')
      deleteNode(slab.id as AnyNodeId)
      setSelection({ selectedIds: [] })
    },
    [deleteNode, selectedSlabEntry, setSelection],
  )
  const handleSelectedCeilingMove = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()

      const ceiling = selectedCeilingEntry?.ceiling
      if (!ceiling) {
        return
      }

      sfxEmitter.emit('sfx:item-pick')
      setMovingNode(ceiling)
      setSelection({ selectedIds: [] })
    },
    [selectedCeilingEntry, setMovingNode, setSelection],
  )
  const handleSelectedCeilingDelete = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()

      const ceiling = selectedCeilingEntry?.ceiling
      if (!ceiling) {
        return
      }

      sfxEmitter.emit('sfx:item-delete')
      deleteNode(ceiling.id as AnyNodeId)
      setSelection({ selectedIds: [] })
    },
    [deleteNode, selectedCeilingEntry, setSelection],
  )
  const handleSelectedFenceMove = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()

      const fence = selectedFenceEntry?.fence
      if (!fence) {
        return
      }

      sfxEmitter.emit('sfx:item-pick')
      setMovingNode(fence)
      setSelection({ selectedIds: [] })
    },
    [selectedFenceEntry, setMovingNode, setSelection],
  )
  const handleSelectedFenceDelete = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()

      const fence = selectedFenceEntry?.fence
      if (!fence) {
        return
      }

      sfxEmitter.emit('sfx:item-delete')
      deleteNode(fence.id as AnyNodeId)
      setSelection({ selectedIds: [] })
    },
    [deleteNode, selectedFenceEntry, setSelection],
  )
  const handleFencePointerDown = useCallback(
    (fenceId: FenceNode['id'], event: ReactPointerEvent<SVGElement>) => {
      if (event.button !== 0) {
        return
      }

      const fence = selectedFenceEntry?.fence
      if (!fence || fence.id !== fenceId) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      pendingFenceDragRef.current = {
        pointerId: event.pointerId,
        fenceId,
        startClientX: event.clientX,
        startClientY: event.clientY,
      }
    },
    [selectedFenceEntry],
  )
  const handleFenceEndpointPointerDown = useCallback(
    (fence: FenceNode, endpoint: WallEndpoint, event: ReactPointerEvent<SVGCircleElement>) => {
      if (event.button !== 0) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      pendingFenceDragRef.current = null
      setHoveredEndpointId(null)

      if (mode !== 'select') {
        return
      }

      sfxEmitter.emit('sfx:item-pick')
      setMovingFenceEndpoint({ fence, endpoint })
    },
    [mode, setMovingFenceEndpoint],
  )
  const handleStairDoubleClick = useCallback(
    (stair: StairNode, event: ReactMouseEvent<SVGElement>) => {
      emitFloorplanNodeClick(stair.id, 'double-click', event)
      emitter.emit('camera-controls:focus', { nodeId: stair.id })
    },
    [emitFloorplanNodeClick],
  )
  const handleStairPointerDown = useCallback(
    (stairId: StairNode['id'], event: ReactPointerEvent<SVGElement>) => {
      if (event.button !== 0) {
        return
      }

      const stair = selectedStairEntry?.stair
      if (!stair || stair.id !== stairId) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

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
      setMovingNode(stair)
      setSelection({ selectedIds: [] })
    },
    [selectedStairEntry, setMovingNode, setSelection],
  )
  const handleSelectedOpeningMove = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()

      const opening = selectedOpeningEntry?.opening
      if (!opening) {
        return
      }

      sfxEmitter.emit('sfx:item-pick')
      setMovingNode(opening)
      setSelection({ selectedIds: [] })
    },
    [selectedOpeningEntry, setMovingNode, setSelection],
  )
  const duplicateSelectedOpening = useCallback(() => {
    const opening = selectedOpeningEntry?.opening
    if (!opening?.parentId) {
      return
    }

    sfxEmitter.emit('sfx:item-pick')
    useScene.temporal.getState().pause()

    const cloned = structuredClone(opening) as Record<string, unknown>
    delete cloned.id
    cloned.metadata = {
      ...(typeof cloned.metadata === 'object' && cloned.metadata !== null ? cloned.metadata : {}),
      isNew: true,
    }

    const duplicate = opening.type === 'door' ? DoorNode.parse(cloned) : WindowNode.parse(cloned)

    useScene.getState().createNode(duplicate, opening.parentId as AnyNodeId)
    setMovingNode(duplicate)
    setSelection({ selectedIds: [] })
  }, [selectedOpeningEntry, setMovingNode, setSelection])
  const handleSelectedOpeningDuplicate = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      duplicateSelectedOpening()
    },
    [duplicateSelectedOpening],
  )
  const handleSelectedOpeningDelete = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()

      const opening = selectedOpeningEntry?.opening
      if (!opening) {
        return
      }

      sfxEmitter.emit('sfx:item-delete')
      deleteNode(opening.id as AnyNodeId)
      if (opening.parentId) {
        useScene.getState().dirtyNodes.add(opening.parentId as AnyNodeId)
      }
      setSelection({ selectedIds: [] })
    },
    [deleteNode, selectedOpeningEntry, setSelection],
  )
  const handleSelectedStairMove = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()

      const stair = selectedStairEntry?.stair
      if (!stair) {
        return
      }

      sfxEmitter.emit('sfx:item-pick')
      setMovingNode(stair)
      setSelection({ selectedIds: [] })
    },
    [selectedStairEntry, setMovingNode, setSelection],
  )
  const duplicateSelectedStair = useCallback(() => {
    const stair = selectedStairEntry?.stair
    if (!stair?.parentId) {
      return
    }

    sfxEmitter.emit('sfx:item-pick')
    useScene.temporal.getState().pause()

    const cloned = structuredClone(stair) as Record<string, unknown>
    delete cloned.id
    cloned.metadata = {
      ...(typeof cloned.metadata === 'object' && cloned.metadata !== null ? cloned.metadata : {}),
    }
    delete (cloned.metadata as Record<string, unknown>).isNew

    const nextPosition =
      Array.isArray(cloned.position) && cloned.position.length >= 3
        ? [
            Number(cloned.position[0]) + 1,
            Number(cloned.position[1]),
            Number(cloned.position[2]) + 1,
          ]
        : [stair.position[0] + 1, stair.position[1], stair.position[2] + 1]

    cloned.position = nextPosition

    try {
      const duplicate = StairNodeSchema.parse(cloned)
      const nodesState = useScene.getState().nodes
      const createOps: { node: AnyNode; parentId?: AnyNodeId }[] = [
        { node: duplicate, parentId: stair.parentId as AnyNodeId },
      ]

      for (const childId of stair.children ?? []) {
        const childNode = nodesState[childId]
        if (childNode?.type !== 'stair-segment') {
          continue
        }

        const childClone = structuredClone(childNode) as Record<string, unknown>
        delete childClone.id
        childClone.metadata = {
          ...(typeof childClone.metadata === 'object' && childClone.metadata !== null
            ? childClone.metadata
            : {}),
        }
        delete (childClone.metadata as Record<string, unknown>).isNew

        const childDuplicate = StairSegmentNodeSchema.parse(childClone)
        createOps.push({ node: childDuplicate, parentId: duplicate.id as AnyNodeId })
      }

      useScene.getState().createNodes(createOps)

      setSelection({ selectedIds: [duplicate.id as AnyNodeId] })
    } catch (error) {
      console.error('Failed to duplicate stair', error)
    }
  }, [selectedStairEntry, setSelection])
  const handleSelectedStairDuplicate = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      duplicateSelectedStair()
    },
    [duplicateSelectedStair],
  )
  const handleSelectedStairDelete = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()

      const stair = selectedStairEntry?.stair
      if (!stair) {
        return
      }

      sfxEmitter.emit('sfx:item-delete')
      deleteNode(stair.id as AnyNodeId)
      if (stair.parentId) {
        useScene.getState().dirtyNodes.add(stair.parentId as AnyNodeId)
      }
      setSelection({ selectedIds: [] })
    },
    [deleteNode, selectedStairEntry, setSelection],
  )
  const handleSelectedRoofMove = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()

      const roof = selectedRoofEntry?.roof
      if (!roof) {
        return
      }

      sfxEmitter.emit('sfx:item-pick')
      setMovingNode(roof)
      setSelection({ selectedIds: [] })
    },
    [selectedRoofEntry, setMovingNode, setSelection],
  )
  const handleSelectedRoofDelete = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()

      const roof = selectedRoofEntry?.roof
      if (!roof) {
        return
      }

      sfxEmitter.emit('sfx:item-delete')
      deleteNode(roof.id as AnyNodeId)
      setSelection({ selectedIds: [] })
    },
    [deleteNode, selectedRoofEntry, setSelection],
  )

  const handleWallEndpointPointerDown = useCallback(
    (wall: WallNode, endpoint: WallEndpoint, event: ReactPointerEvent<SVGCircleElement>) => {
      if (event.button !== 0) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      setHoveredEndpointId(null)

      const movingPoint = endpoint === 'start' ? wall.start : wall.end

      if (isWallBuildActive) {
        handleWallPlacementPoint(movingPoint)
        return
      }

      if (mode !== 'select') {
        return
      }

      clearWallPlacementDraft()
      handleWallSelect(wall)

      const fixedPoint = endpoint === 'start' ? wall.end : wall.start
      const originalStart = [...wall.start] as WallPlanPoint
      const originalEnd = [...wall.end] as WallPlanPoint
      const linkedWalls = getLinkedWallSnapshots(walls, wall.id, originalStart, originalEnd)

      wallEndpointDragRef.current = {
        pointerId: event.pointerId,
        wallId: wall.id,
        endpoint,
        fixedPoint,
        currentPoint: movingPoint,
        originalStart,
        originalEnd,
        linkedWalls,
      }

      setWallEndpointDraft(
        buildWallEndpointDraft(wall.id, endpoint, fixedPoint, movingPoint, linkedWalls),
      )
      setCursorPoint(movingPoint)
    },
    [
      clearWallPlacementDraft,
      handleWallPlacementPoint,
      handleWallSelect,
      isWallBuildActive,
      mode,
      walls,
    ],
  )
  const handleWallCurvePointerDown = useCallback(
    (wall: WallNode, event: ReactPointerEvent<SVGCircleElement>) => {
      if (event.button !== 0) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      setHoveredWallCurveHandleId(null)

      if (isWallBuildActive || mode !== 'select') {
        return
      }

      clearWallPlacementDraft()
      handleWallSelect(wall)
      clearWallEndpointDrag()

      const currentCurveOffset = normalizeWallCurveOffset(wall, wall.curveOffset ?? 0)
      wallCurveDragRef.current = {
        pointerId: event.pointerId,
        wallId: wall.id,
        currentCurveOffset,
      }
      setWallCurveDraft({
        wallId: wall.id,
        curveOffset: currentCurveOffset,
      })
      const center = getWallMidpointHandlePoint(wall)
      setCursorPoint([center.x, center.y])
    },
    [clearWallEndpointDrag, clearWallPlacementDraft, handleWallSelect, isWallBuildActive, mode],
  )
  const handleSlabVertexPointerDown = useCallback(
    (slabId: SlabNode['id'], vertexIndex: number, event: ReactPointerEvent<SVGCircleElement>) => {
      if (event.button !== 0) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      setHoveredSlabHandleId(null)

      const slabEntry = displaySlabPolygons.find(({ slab }) => slab.id === slabId)
      const vertexPoint = slabEntry?.polygon[vertexIndex]
      if (!(slabEntry && vertexPoint)) {
        return
      }

      setSlabBoundaryDraft({
        slabId,
        polygon: slabEntry.polygon.map(toWallPlanPoint),
      })
      setSlabVertexDragState({
        pointerId: event.pointerId,
        slabId,
        vertexIndex,
      })
      setCursorPoint(toWallPlanPoint(vertexPoint))
    },
    [displaySlabPolygons],
  )
  const handleSlabVertexDoubleClick = useCallback(
    (slabId: SlabNode['id'], vertexIndex: number, event: ReactPointerEvent<SVGCircleElement>) => {
      if (event.button !== 0) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const slab = slabById.get(slabId)
      if (!(slab && slab.polygon.length > 3)) {
        return
      }

      slabBoundaryDraftRef.current = null
      clearSlabBoundaryInteraction()

      updateNode(slabId, {
        polygon: slab.polygon.filter((_, index) => index !== vertexIndex),
      })
    },
    [clearSlabBoundaryInteraction, slabById, updateNode],
  )
  const handleSlabMidpointPointerDown = useCallback(
    (slabId: SlabNode['id'], edgeIndex: number, event: ReactPointerEvent<SVGCircleElement>) => {
      if (event.button !== 0) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      setHoveredSlabHandleId(null)

      const slabEntry = displaySlabPolygons.find(({ slab }) => slab.id === slabId)
      if (!slabEntry) {
        return
      }

      const basePolygon = slabEntry.polygon.map(toWallPlanPoint)
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

      setSlabBoundaryDraft({
        slabId,
        polygon: nextPolygon,
      })
      setSlabVertexDragState({
        pointerId: event.pointerId,
        slabId,
        vertexIndex: insertIndex,
      })
      setCursorPoint(insertedPoint)
    },
    [displaySlabPolygons],
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

      setSiteBoundaryDraft({
        siteId,
        polygon: displaySitePolygon.polygon.map(toWallPlanPoint),
      })
      setSiteVertexDragState({
        pointerId: event.pointerId,
        siteId,
        vertexIndex,
      })
      setCursorPoint(toWallPlanPoint(vertexPoint))
    },
    [displaySitePolygon],
  )
  const handleSiteVertexDoubleClick = useCallback(
    (siteId: SiteNode['id'], vertexIndex: number, event: ReactPointerEvent<SVGCircleElement>) => {
      if (event.button !== 0) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      if (!(site && site.id === siteId && (site.polygon?.points?.length ?? 0) > 3)) {
        return
      }

      siteBoundaryDraftRef.current = null
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

      setSiteBoundaryDraft({
        siteId,
        polygon: nextPolygon,
      })
      setSiteVertexDragState({
        pointerId: event.pointerId,
        siteId,
        vertexIndex: insertIndex,
      })
      setCursorPoint(insertedPoint)
    },
    [displaySitePolygon],
  )
  const handleZoneVertexPointerDown = useCallback(
    (
      zoneId: ZoneNodeType['id'],
      vertexIndex: number,
      event: ReactPointerEvent<SVGCircleElement>,
    ) => {
      if (event.button !== 0) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      setHoveredZoneHandleId(null)

      const zoneEntry = displayZonePolygons.find(({ zone }) => zone.id === zoneId)
      const vertexPoint = zoneEntry?.polygon[vertexIndex]
      if (!(zoneEntry && vertexPoint)) {
        return
      }

      setZoneBoundaryDraft({
        zoneId,
        polygon: zoneEntry.polygon.map(toWallPlanPoint),
      })
      setZoneVertexDragState({
        pointerId: event.pointerId,
        zoneId,
        vertexIndex,
      })
      setCursorPoint(toWallPlanPoint(vertexPoint))
    },
    [displayZonePolygons],
  )
  const handleZoneVertexDoubleClick = useCallback(
    (
      zoneId: ZoneNodeType['id'],
      vertexIndex: number,
      event: ReactPointerEvent<SVGCircleElement>,
    ) => {
      if (event.button !== 0) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const zone = zoneById.get(zoneId)
      if (!(zone && zone.polygon.length > 3)) {
        return
      }

      zoneBoundaryDraftRef.current = null
      clearZoneBoundaryInteraction()

      updateNode(zoneId, {
        polygon: zone.polygon.filter((_, index) => index !== vertexIndex),
      })
    },
    [clearZoneBoundaryInteraction, updateNode, zoneById],
  )
  const handleZoneMidpointPointerDown = useCallback(
    (zoneId: ZoneNodeType['id'], edgeIndex: number, event: ReactPointerEvent<SVGCircleElement>) => {
      if (event.button !== 0) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      setHoveredZoneHandleId(null)

      const zoneEntry = displayZonePolygons.find(({ zone }) => zone.id === zoneId)
      if (!zoneEntry) {
        return
      }

      const basePolygon = zoneEntry.polygon.map(toWallPlanPoint)
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

      setZoneBoundaryDraft({
        zoneId,
        polygon: nextPolygon,
      })
      setZoneVertexDragState({
        pointerId: event.pointerId,
        zoneId,
        vertexIndex: insertIndex,
      })
      setCursorPoint(insertedPoint)
    },
    [displayZonePolygons],
  )

  const handlePointerLeave = useCallback(() => {
    if (
      !(
        panStateRef.current ||
        wallEndpointDragRef.current ||
        siteVertexDragState ||
        slabVertexDragState ||
        zoneVertexDragState
      )
    ) {
      setCursorPoint(null)
    }
    handleOpeningHoverChange(null)
    handleItemHoverChange(null)
    handleWallHoverChange(null)
    handleSlabHoverChange(null)
    handleCeilingHoverChange(null)
    handleStairHoverChange(null)
    handleZoneHoverChange(null)
    setHoveredEndpointId(null)
    setHoveredSiteHandleId(null)
    setHoveredSlabHandleId(null)
    setHoveredZoneHandleId(null)
    if (hoveredWallIdRef.current) {
      emitFloorplanWallLeave(hoveredWallIdRef.current)
      hoveredWallIdRef.current = null
    }
  }, [
    emitFloorplanWallLeave,
    handleCeilingHoverChange,
    handleItemHoverChange,
    handleOpeningHoverChange,
    handleSlabHoverChange,
    handleStairHoverChange,
    handleWallHoverChange,
    handleZoneHoverChange,
    siteVertexDragState,
    slabVertexDragState,
    zoneVertexDragState,
  ])

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
        !panStateRef.current &&
        !guideInteractionRef.current &&
        !wallEndpointDragRef.current &&
        !siteVertexDragState &&
        !slabVertexDragState &&
        !zoneVertexDragState
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
      siteVertexDragState,
      slabVertexDragState,
      zoneVertexDragState,
    ],
  )

  const handleSvgPointerLeave = useCallback(() => {
    setFloorplanCursorPosition(null)
    setHoveredGuideCorner(null)
    handlePointerLeave()
  }, [handlePointerLeave])

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
      handleItemHoverChange(null)
      handleOpeningHoverChange(null)
      handleWallHoverChange(null)
      handleSlabHoverChange(null)
      handleStairHoverChange(null)
      handleZoneHoverChange(null)
      setHoveredEndpointId(null)
      floorplanMarqueeSnapPointRef.current = snappedPoint
      syncPreviewSelectedIds([])
      setFloorplanMarqueeState({
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
      handleItemHoverChange,
      handleOpeningHoverChange,
      handleSlabHoverChange,
      handleStairHoverChange,
      handleWallHoverChange,
      handleZoneHoverChange,
      syncPreviewSelectedIds,
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

      if (floorplanMarqueeState?.pointerId !== event.pointerId) {
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
        event.clientX - floorplanMarqueeState.startClientX,
        event.clientY - floorplanMarqueeState.startClientY,
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
        const bounds = getFloorplanSelectionBounds(
          floorplanMarqueeState.startPlanPoint,
          snappedPoint,
        )
        syncPreviewSelectedIds(getFloorplanSelectionIdsInBounds(bounds))
      } else {
        syncPreviewSelectedIds([])
      }

      setFloorplanMarqueeState((currentState) => {
        if (!currentState || currentState.pointerId !== event.pointerId) {
          return currentState
        }

        return {
          ...currentState,
          currentPlanPoint: snappedPoint,
        }
      })
    },
    [
      floorplanMarqueeState,
      getFloorplanSelectionIdsInBounds,
      getPlanPointFromClientPoint,
      syncPreviewSelectedIds,
    ],
  )

  const handleMarqueePointerUp = useCallback(
    (event: ReactPointerEvent<SVGRectElement>) => {
      const marqueeState = floorplanMarqueeState
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
        } else if (!(modifierKeys.meta || modifierKeys.ctrl)) {
          commitFloorplanSelection([])
        }
      }

      syncPreviewSelectedIds([])
      setFloorplanMarqueeState(null)
      floorplanMarqueeSnapPointRef.current = null
    },
    [
      addFloorplanSelection,
      commitFloorplanSelection,
      floorplanMarqueeState,
      getFloorplanHitIdAtPoint,
      getFloorplanSelectionIdsInBounds,
      getPlanPointFromClientPoint,
      syncPreviewSelectedIds,
      toggleFloorplanSelection,
    ],
  )

  const handleMarqueePointerCancel = useCallback(
    (event: ReactPointerEvent<SVGRectElement>) => {
      if (floorplanMarqueeState?.pointerId !== event.pointerId) {
        return
      }

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }

      setFloorplanMarqueeState(null)
      setFloorplanCursorPosition(null)
      floorplanMarqueeSnapPointRef.current = null
      syncPreviewSelectedIds([])
      setCursorPoint(null)
    },
    [floorplanMarqueeState?.pointerId, syncPreviewSelectedIds],
  )

  useEffect(() => {
    if (!isMarqueeSelectionToolActive) {
      setFloorplanMarqueeState(null)
      floorplanMarqueeSnapPointRef.current = null
      syncPreviewSelectedIds([])
      if (mode === 'select') {
        setCursorPoint(null)
      }
      return
    }

    setFloorplanCursorPosition(null)
    handleOpeningHoverChange(null)
    handleWallHoverChange(null)
    handleSlabHoverChange(null)
    handleZoneHoverChange(null)
    setHoveredEndpointId(null)
  }, [
    handleOpeningHoverChange,
    handleSlabHoverChange,
    handleWallHoverChange,
    handleZoneHoverChange,
    isMarqueeSelectionToolActive,
    mode,
    syncPreviewSelectedIds,
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
            if (!buildingNode || buildingNode.type !== 'building') {
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
  const hasDuplicatableFloorplanSelection = Boolean(
    selectedItemEntry || selectedOpeningEntry || selectedStairEntry,
  )
  const handleDuplicateFloorplanSelection = useCallback(() => {
    if (selectedOpeningEntry) {
      duplicateSelectedOpening()
      return
    }
    if (selectedItemEntry) {
      duplicateSelectedItem()
      return
    }
    if (selectedStairEntry) {
      duplicateSelectedStair()
    }
  }, [
    duplicateSelectedItem,
    duplicateSelectedOpening,
    duplicateSelectedStair,
    selectedItemEntry,
    selectedOpeningEntry,
    selectedStairEntry,
  ])
  const activeDraftAnchorPoint =
    draftStart ?? fenceDraftStart ?? roofDraftStart ?? activePolygonDraftPoints[0] ?? null
  const floorplanCursorColor =
    mode === 'delete'
      ? palette.deleteStroke
      : wallEndpointDraft
        ? palette.editCursor
        : activeDraftAnchorPoint
          ? palette.draftStroke
          : palette.cursor
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
      <FloorplanDuplicateHotkey
        hasDuplicatable={hasDuplicatableFloorplanSelection}
        onDuplicateSelected={handleDuplicateFloorplanSelection}
      />
      <div className="relative min-h-0 flex-1" ref={viewportHostRef}>
        <Editor2dFloorplanCursorIndicatorOverlay
          cursorAnchorPosition={floorplanCursorAnchorPosition}
          cursorColor={floorplanCursorColor}
          cursorPosition={floorplanCursorPosition}
          floorplanSelectionTool={floorplanSelectionTool}
          indicatorBadgeOffsetX={FLOORPLAN_CURSOR_BADGE_OFFSET_X}
          indicatorBadgeOffsetY={FLOORPLAN_CURSOR_BADGE_OFFSET_Y}
          indicatorLineHeight={FLOORPLAN_CURSOR_INDICATOR_LINE_HEIGHT}
          isPanning={isPanning}
          movingOpeningType={movingOpeningType}
        />
        {showGuides && canInteractWithGuides && selectedGuide && (
          <FloorplanGuideHandleHint
            anchor={guideHandleHintAnchor}
            isDarkMode={theme === 'dark'}
            isMacPlatform={isMacPlatform}
            rotationModifierPressed={rotationModifierPressed}
          />
        )}
        <Editor2dFloorplanActionMenuLayer
          ceiling={{
            position: selectedCeilingActionMenuPosition,
            onDelete: handleSelectedCeilingDelete,
            onMove: handleSelectedCeilingMove,
          }}
          fence={{
            position: selectedFenceActionMenuPosition,
            onDelete: handleSelectedFenceDelete,
            onMove: handleSelectedFenceMove,
          }}
          item={{
            position: selectedItemActionMenuPosition,
            onDelete: handleSelectedItemDelete,
            onDuplicate: handleSelectedItemDuplicate,
            onMove: handleSelectedItemMove,
          }}
          opening={{
            position: selectedOpeningActionMenuPosition,
            onDelete: handleSelectedOpeningDelete,
            onDuplicate: handleSelectedOpeningDuplicate,
            onMove: handleSelectedOpeningMove,
          }}
          roof={{
            position: selectedRoofActionMenuPosition,
            onDelete: handleSelectedRoofDelete,
            onMove: handleSelectedRoofMove,
          }}
          slab={{
            position: selectedSlabActionMenuPosition,
            onDelete: handleSelectedSlabDelete,
            onMove: handleSelectedSlabMove,
          }}
          stair={{
            position: selectedStairActionMenuPosition,
            onDelete: handleSelectedStairDelete,
            onDuplicate: handleSelectedStairDuplicate,
            onMove: handleSelectedStairMove,
          }}
          wall={{
            position: selectedWallActionMenuPosition,
            onDelete: handleSelectedWallDelete,
            onMove: handleSelectedWallMove,
          }}
          offsetY={FLOORPLAN_ACTION_MENU_OFFSET_Y}
        />

        {!levelNode || levelNode.type !== 'level' ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-muted-foreground text-sm">
            Switch to a building level to view and edit the floorplan.
          </div>
        ) : (
          <svg
            className="h-full w-full touch-none"
            onClick={isMarqueeSelectionToolActive ? undefined : handleBackgroundClick}
            onContextMenu={(event) => event.preventDefault()}
            onDoubleClick={isMarqueeSelectionToolActive ? undefined : handleBackgroundDoubleClick}
            onPointerCancel={endPanning}
            onPointerDown={handlePointerDown}
            onPointerLeave={handleSvgPointerLeave}
            onPointerMove={handleSvgPointerMove}
            onPointerUp={endPanning}
            ref={svgRef}
            style={{ cursor: EDITOR_CURSOR }}
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
            </defs>
            <rect
              fill={palette.surface}
              height={viewBox.height}
              width={viewBox.width}
              x={viewBox.minX}
              y={viewBox.minY}
            />

            <g
              ref={floorplanSceneRef}
              transform={buildingRotationDeg !== 0 ? `rotate(${buildingRotationDeg})` : undefined}
            >
              <FloorplanGridLayer
                majorGridPath={majorGridPath}
                minorGridPath={minorGridPath}
                palette={palette}
                showGrid={showGrid}
              />

              <FloorplanGuideLayer
                activeGuideInteractionGuideId={activeGuideInteractionGuideId}
                activeGuideInteractionMode={activeGuideInteractionMode}
                guides={displayGuides}
                isInteractive={canInteractWithGuides}
                onGuideSelect={handleGuideSelect}
                onGuideTranslateStart={handleGuideTranslateStart}
                selectedGuideId={selectedGuideId}
              />

              <FloorplanSiteLayer isEditing={isSiteEditActive} sitePolygon={visibleSitePolygon} />

              <FloorplanGeometryLayer
                canFocusGeometry={canSelectElementFloorplanGeometry}
                canSelectCeilings={canInteractFloorplanSlabs}
                canSelectGeometry={canInteractElementFloorplanGeometry}
                canSelectSlabs={canInteractFloorplanSlabs}
                ceilingPolygons={ceilingPolygons}
                highlightedIdSet={highlightedFloorplanIdSet}
                hoveredCeilingId={hoveredCeilingId}
                hoveredOpeningId={hoveredOpeningId}
                hoveredSlabId={hoveredSlabId}
                hoveredWallId={hoveredWallId}
                isDeleteMode={isDeleteMode}
                onCeilingDoubleClick={handleCeilingDoubleClick}
                onCeilingHoverChange={handleCeilingHoverChange}
                onCeilingSelect={handleCeilingSelect}
                onOpeningDoubleClick={handleOpeningDoubleClick}
                onOpeningHoverChange={handleOpeningHoverChange}
                onOpeningPointerDown={handleOpeningPointerDown}
                onOpeningSelect={handleOpeningSelect}
                onSlabDoubleClick={handleSlabDoubleClick}
                onSlabHoverChange={handleSlabHoverChange}
                onSlabSelect={handleSlabSelect}
                onWallClick={handleWallClick}
                onWallDoubleClick={handleWallDoubleClick}
                onWallHoverChange={handleWallHoverChange}
                openingsPolygons={openingsPolygons}
                palette={palette}
                selectedIdSet={selectedIdSet}
                slabPolygons={displaySlabPolygons}
                unit={unit}
                wallPolygons={displayWallPolygons}
                wallSelectionHatchId={wallSelectionHatchId}
              />

              <FloorplanFenceLayer
                canFocusGeometry={canSelectElementFloorplanGeometry}
                canSelectGeometry={canInteractElementFloorplanGeometry}
                fenceEntries={floorplanFenceEntries}
                highlightedIdSet={highlightedFloorplanIdSet}
                hoveredFenceId={hoveredFenceId}
                isDeleteMode={isDeleteMode}
                onFenceDoubleClick={handleFenceDoubleClick}
                onFenceHoverChange={handleFenceHoverChange}
                onFenceHoverEnter={handleFloorplanFenceHoverEnter}
                onFencePointerDown={handleFencePointerDown}
                onFenceSelect={handleFenceClick}
                palette={palette}
                selectedIdSet={selectedIdSet}
              />

              <FloorplanZoneLayer
                canSelectZones={canInteractFloorplanZones}
                hoveredZoneId={hoveredZoneId}
                isDeleteMode={isDeleteMode}
                onZoneHoverChange={handleZoneHoverChange}
                onZoneSelect={handleZoneSelect}
                palette={palette}
                selectedZoneId={selectedZoneId}
                zonePolygons={visibleZonePolygons}
              />

              <FloorplanNodeLayer
                canFocusItems={canFocusFloorplanItems}
                canFocusStairs={canFocusFloorplanStairs}
                canSelectItems={canSelectFloorplanItems}
                canSelectStairs={canSelectFloorplanStairs}
                highlightedIdSet={highlightedFloorplanIdSet}
                hoveredItemId={hoveredItemId}
                hoveredStairId={hoveredStairId}
                isDeleteMode={isDeleteMode}
                isFurnishContextActive={isFloorplanFurnishContextActive}
                itemEntries={floorplanItemEntries}
                onItemDoubleClick={handleItemDoubleClick}
                onItemHoverChange={handleItemHoverChange}
                onItemHoverEnter={handleFloorplanItemHoverEnter}
                onItemPointerDown={handleItemPointerDown}
                onItemSelect={handleItemSelect}
                onStairDoubleClick={handleStairDoubleClick}
                onStairHoverChange={handleStairHoverChange}
                onStairHoverEnter={handleFloorplanStairHoverEnter}
                onStairPointerDown={handleStairPointerDown}
                onStairSelect={handleStairSelect}
                palette={palette}
                selectedIdSet={selectedIdSet}
                stairEntries={renderedFloorplanStairEntries}
              />

              <FloorplanRoofLayer
                highlightedIdSet={highlightedFloorplanIdSet}
                roofEntries={floorplanRoofEntries}
                selectedIdSet={selectedIdSet}
              />

              {movingOpeningPlacementMeasurements.map((measurement) => (
                <g
                  className="opening-placement-dimension"
                  key={measurement.id}
                  pointerEvents="none"
                  style={{ userSelect: 'none' }}
                >
                  <FloorplanMeasurementLine
                    dashed
                    isSelected={measurement.isSelected}
                    palette={palette}
                    segment={measurement.extensionStart}
                    stroke={measurement.extensionStroke}
                  />
                  <FloorplanMeasurementLine
                    isSelected={measurement.isSelected}
                    palette={palette}
                    segment={measurement.dimensionLineStart}
                    stroke={measurement.stroke}
                  />
                  <FloorplanMeasurementLine
                    isSelected={measurement.isSelected}
                    palette={palette}
                    segment={measurement.dimensionLineEnd}
                    stroke={measurement.stroke}
                  />
                  <FloorplanMeasurementLine
                    dashed
                    isSelected={measurement.isSelected}
                    palette={palette}
                    segment={measurement.extensionEnd}
                    stroke={measurement.extensionStroke}
                  />
                  <FloorplanMeasurementTick
                    angleDeg={measurement.labelAngleDeg}
                    isSelected={measurement.isSelected}
                    palette={palette}
                    stroke={measurement.stroke}
                    x={measurement.dimensionLineStart.x1}
                    y={measurement.dimensionLineStart.y1}
                  />
                  <FloorplanMeasurementTick
                    angleDeg={measurement.labelAngleDeg}
                    isSelected={measurement.isSelected}
                    palette={palette}
                    stroke={measurement.stroke}
                    x={measurement.dimensionLineEnd.x2}
                    y={measurement.dimensionLineEnd.y2}
                  />
                  <text
                    dominantBaseline="central"
                    fill={measurement.labelFill ?? palette.measurementStroke}
                    fillOpacity={FLOORPLAN_MEASUREMENT_LABEL_OPACITY}
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                    fontSize={FLOORPLAN_MEASUREMENT_LABEL_FONT_SIZE}
                    fontWeight="600"
                    textAnchor="middle"
                    transform={`rotate(${measurement.labelAngleDeg} ${measurement.labelX} ${measurement.labelY}) translate(0, -0.04)`}
                    x={measurement.labelX}
                    y={measurement.labelY}
                  >
                    {measurement.label}
                  </text>
                </g>
              ))}

              {selectedItemClearanceMeasurements.map((measurement) => (
                <g
                  className="item-clearance-dimension"
                  key={measurement.id}
                  pointerEvents="none"
                  style={{ userSelect: 'none' }}
                >
                  <FloorplanMeasurementLine
                    dashed
                    isSelected={measurement.isSelected}
                    palette={palette}
                    segment={measurement.extensionStart}
                    stroke={measurement.extensionStroke}
                  />
                  <FloorplanMeasurementLine
                    isSelected={measurement.isSelected}
                    palette={palette}
                    segment={measurement.dimensionLineStart}
                    stroke={measurement.stroke}
                  />
                  <FloorplanMeasurementLine
                    isSelected={measurement.isSelected}
                    palette={palette}
                    segment={measurement.dimensionLineEnd}
                    stroke={measurement.stroke}
                  />
                  <FloorplanMeasurementLine
                    dashed
                    isSelected={measurement.isSelected}
                    palette={palette}
                    segment={measurement.extensionEnd}
                    stroke={measurement.extensionStroke}
                  />
                  <FloorplanMeasurementTick
                    angleDeg={measurement.labelAngleDeg}
                    isSelected={measurement.isSelected}
                    palette={palette}
                    stroke={measurement.stroke}
                    x={measurement.dimensionLineStart.x1}
                    y={measurement.dimensionLineStart.y1}
                  />
                  <FloorplanMeasurementTick
                    angleDeg={measurement.labelAngleDeg}
                    isSelected={measurement.isSelected}
                    palette={palette}
                    stroke={measurement.stroke}
                    x={measurement.dimensionLineEnd.x2}
                    y={measurement.dimensionLineEnd.y2}
                  />
                  <text
                    dominantBaseline="central"
                    fill={measurement.labelFill ?? palette.measurementStroke}
                    fillOpacity={FLOORPLAN_MEASUREMENT_LABEL_OPACITY}
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                    fontSize={FLOORPLAN_MEASUREMENT_LABEL_FONT_SIZE}
                    fontWeight="600"
                    textAnchor="middle"
                    transform={`rotate(${measurement.labelAngleDeg} ${measurement.labelX} ${measurement.labelY}) translate(0, -0.04)`}
                    x={measurement.labelX}
                    y={measurement.labelY}
                  >
                    {measurement.label}
                  </text>
                </g>
              ))}

              {/* Zone labels: always visible so users can click to select zones from any mode */}
              <FloorplanZoneLabelLayer
                onLabelHoverChange={handleZoneHoverChange}
                onZoneLabelClick={handleZoneLabelClick}
                selectedZoneId={selectedZoneId}
                svgRef={svgRef}
                viewBox={viewBox}
                zonePolygons={displayZonePolygons}
              />

              <FloorplanPolygonHandleLayer
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
                vertexHandles={siteVertexHandles}
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

              <FloorplanMarqueeLayer
                bounds={visibleSvgMarqueeBounds}
                cursorColor={palette.cursor}
                glowWidth={FLOORPLAN_MARQUEE_GLOW_WIDTH}
                outlineWidth={FLOORPLAN_MARQUEE_OUTLINE_WIDTH}
              />

              <FloorplanDraftLayer
                anchorFill={palette.anchor}
                draftAnchorPoints={activePolygonDraftPoints.map((point, index) => ({
                  x: toSvgX(point[0]),
                  y: toSvgY(point[1]),
                  isPrimary: index === 0,
                }))}
                draftFill={palette.draftFill}
                draftPolygonPoints={draftPolygonPoints}
                draftStroke={palette.draftStroke}
                linearDraftSegment={fenceDraftSegment}
                polygonDraftClosingSegment={polygonDraftClosingSegment}
                polygonDraftPolygonPoints={polygonDraftPolygonPoints}
                polygonDraftPolylinePoints={polygonDraftPolylinePoints}
              />

              <FloorplanWallEndpointLayer
                endpointHandles={wallEndpointHandles}
                hoveredEndpointId={hoveredEndpointId}
                onEndpointHoverChange={setHoveredEndpointId}
                onWallEndpointPointerDown={handleWallEndpointPointerDown}
                palette={palette}
              />

              <FloorplanFenceEndpointLayer
                endpointHandles={fenceEndpointHandles}
                hoveredEndpointId={hoveredEndpointId}
                onEndpointHoverChange={setHoveredEndpointId}
                onFenceEndpointPointerDown={handleFenceEndpointPointerDown}
                palette={palette}
              />

              <FloorplanWallCurveHandleLayer
                curveHandles={wallCurveHandles}
                hoveredHandleId={hoveredWallCurveHandleId}
                onHandleHoverChange={setHoveredWallCurveHandleId}
                onWallCurvePointerDown={handleWallCurvePointerDown}
                palette={palette}
              />

              <FloorplanPolygonHandleLayer
                hoveredHandleId={hoveredSlabHandleId}
                midpointHandles={slabMidpointHandles}
                onHandleHoverChange={setHoveredSlabHandleId}
                onMidpointPointerDown={(nodeId, edgeIndex, event) =>
                  handleSlabMidpointPointerDown(nodeId as SlabNode['id'], edgeIndex, event)
                }
                onVertexDoubleClick={(nodeId, vertexIndex, event) =>
                  handleSlabVertexDoubleClick(nodeId as SlabNode['id'], vertexIndex, event)
                }
                onVertexPointerDown={(nodeId, vertexIndex, event) =>
                  handleSlabVertexPointerDown(nodeId as SlabNode['id'], vertexIndex, event)
                }
                palette={palette}
                vertexHandles={slabVertexHandles}
              />

              <FloorplanPolygonHandleLayer
                hoveredHandleId={hoveredZoneHandleId}
                midpointHandles={zoneMidpointHandles}
                onHandleHoverChange={setHoveredZoneHandleId}
                onMidpointPointerDown={(nodeId, edgeIndex, event) =>
                  handleZoneMidpointPointerDown(nodeId as ZoneNodeType['id'], edgeIndex, event)
                }
                onVertexDoubleClick={(nodeId, vertexIndex, event) =>
                  handleZoneVertexDoubleClick(nodeId as ZoneNodeType['id'], vertexIndex, event)
                }
                onVertexPointerDown={(nodeId, vertexIndex, event) =>
                  handleZoneVertexPointerDown(nodeId as ZoneNodeType['id'], vertexIndex, event)
                }
                palette={palette}
                vertexHandles={zoneVertexHandles}
              />

              {selectedGuide && showGuides && (
                <FloorplanGuideSelectionOverlay
                  guide={selectedGuide}
                  isDarkMode={theme === 'dark'}
                  onCornerHoverChange={setHoveredGuideCorner}
                  onCornerPointerDown={handleGuideCornerPointerDown}
                  rotationModifierPressed={rotationModifierPressed}
                  showHandles={canInteractWithGuides}
                />
              )}

              {cursorPoint && (
                <g>
                  <circle
                    cx={toSvgX(cursorPoint[0])}
                    cy={toSvgY(cursorPoint[1])}
                    fill={floorplanCursorColor}
                    fillOpacity={0.25}
                    r={FLOORPLAN_CURSOR_MARKER_GLOW_RADIUS}
                  />
                  <circle
                    cx={toSvgX(cursorPoint[0])}
                    cy={toSvgY(cursorPoint[1])}
                    fill={floorplanCursorColor}
                    fillOpacity={0.9}
                    r={FLOORPLAN_CURSOR_MARKER_CORE_RADIUS}
                  />
                </g>
              )}

              {activeDraftAnchorPoint && (
                <circle
                  cx={toSvgX(activeDraftAnchorPoint[0])}
                  cy={toSvgY(activeDraftAnchorPoint[1])}
                  fill={palette.anchor}
                  fillOpacity={0.95}
                  r="0.14"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </g>
          </svg>
        )}
      </div>
    </div>
  )
}
