'use client'

import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  getItemMoveVisualState,
  getScaledDimensions,
  type ItemMoveVisualState,
  ItemNode,
  type LevelNode,
  resolveLevelId,
  sceneRegistry,
  setItemMoveVisualState as setItemMoveVisualMetadata,
  spatialGridManager,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { ITEM_DELETE_FADE_OUT_MS, useViewer } from '@pascal-app/viewer'
import { addAfterEffect, useFrame, useLoader, useThree } from '@react-three/fiber'
import { Suspense, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AdditiveBlending,
  Box3,
  BufferGeometry,
    CanvasTexture,
    CatmullRomCurve3,
    Color,
    type Curve,
    CurvePath,
    DoubleSide,
    FileLoader,
    Float32BufferAttribute,
    Group,
    LineBasicMaterial,
    LineCurve3,
    type Material,
    MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PerspectiveCamera,
  QuadraticBezierCurve3,
  Quaternion,
  Raycaster,
  RepeatWrapping,
  type Scene,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { color, float, mix, uniform, uv } from 'three/tsl'
import { MeshBasicNodeMaterial, RenderTarget } from 'three/webgpu'
import { useShallow } from 'zustand/react/shallow'
import {
  buildNavigationGraph,
  findClosestNavigationCell,
  findNavigationPath,
  getNavigationDoorTransitions,
  getNavigationPathWorldPoints,
  getNavigationPointBlockers,
  isNavigationPointSupported,
  NAVIGATION_AGENT_RADIUS,
  type NavigationDoorTransition,
  type NavigationGraph,
  type NavigationPathResult,
  simplifyNavigationPath,
} from '../../lib/navigation'
import {
  measureNavigationPerf,
  mergeNavigationPerfMeta,
  recordNavigationPerfMark,
  recordNavigationPerfSample,
  resetNavigationPerf,
} from '../../lib/navigation-performance'
import {
  getPascalTruckIntroReleaseDurationMs,
  PASCAL_TRUCK_ASSET,
  PASCAL_TRUCK_ASSET_ID,
  PASCAL_TRUCK_ENTRY_CLIP_DURATION_SECONDS,
  PASCAL_TRUCK_ENTRY_CLIP_NAME,
  PASCAL_TRUCK_ENTRY_MAX_STEP_MS,
  PASCAL_TRUCK_ENTRY_REAR_EDGE_INSET,
  PASCAL_TRUCK_ENTRY_REAR_TRAVEL_DISTANCE,
  PASCAL_TRUCK_ENTRY_RELEASE_BLEND_RESPONSE,
  PASCAL_TRUCK_ENTRY_REVEAL_DURATION_MS,
  PASCAL_TRUCK_ENTRY_REVEAL_TRAVEL_RATIO,
  PASCAL_TRUCK_ENTRY_TRAVEL_END_PROGRESS,
  PASCAL_TRUCK_ITEM_NODE_ID,
  PASCAL_TRUCK_REAR_LOCAL_X_SIGN,
} from '../../lib/pascal-truck'
import { sfxEmitter } from '../../lib/sfx-bus'
import useEditor from '../../store/use-editor'
import useNavigation, {
  type NavigationItemDeleteRequest,
  type NavigationItemMoveController,
  type NavigationItemMoveRequest,
  type NavigationQueuedTask,
  type NavigationItemRepairRequest,
  type NavigationRobotMode,
  navigationEmitter,
  requestNavigationItemDelete,
} from '../../store/use-navigation'
import navigationVisualsStore, { useNavigationVisuals } from '../../store/use-navigation-visuals'
import { stripTransient } from '../tools/item/placement-math'
import { getActiveNavigationDoorIds, NavigationDoorSystem } from './navigation-door-system'

function appendTaskModeTrace(_type: string, _payload: Record<string, unknown> = {}) {}
import type { NavigationRobotMaterialDebugMode } from './navigation-robot'
import { NavigationRobot, type NavigationRobotToolInteractionPhase } from './navigation-robot'
import { WalkableSurfaceOverlay } from './walkable-surface-overlay'

const PATH_CURVE_OFFSET_Y = 0.92
const ACTOR_HOVER_Y = 0.16
const ACTOR_SPEED_SCALE = 0.75
const ACTOR_RUN_SPEED_RATIO = 2.5
const ACTOR_WALK_ANIMATION_SPEED_SCALE = ACTOR_SPEED_SCALE * 1.3
const ACTOR_RUN_ANIMATION_SPEED_SCALE = 1.05
const ACTOR_COLLISION_RADIUS = NAVIGATION_AGENT_RADIUS
const ACTOR_DOOR_COLLISION_HEIGHT = 0.9
const ACTOR_WALK_MAX_SPEED = 1.9 * ACTOR_SPEED_SCALE
const ACTOR_RUN_MAX_SPEED = ACTOR_WALK_MAX_SPEED * ACTOR_RUN_SPEED_RATIO
const ACTOR_WALK_ACCELERATION = 2.8 * ACTOR_SPEED_SCALE
const ACTOR_RUN_ACCELERATION = 3.6 * ACTOR_SPEED_SCALE
const ACTOR_WALK_DECELERATION = 3.2 * ACTOR_SPEED_SCALE
const ACTOR_RUN_DECELERATION = 4.1 * ACTOR_SPEED_SCALE
const ACTOR_LOCOMOTION_BLEND_SPEED = Math.max(0.24, ACTOR_WALK_MAX_SPEED * 0.22)
const PASCAL_TRUCK_ENTRY_RELEASE_DURATION_MS = getPascalTruckIntroReleaseDurationMs()
const NAVIGATION_SYSTEM_ACTOR_DEBUG_ID = 'pascal-navigation-actor'
const ACTOR_TURN_RESPONSE = 12
const ACTOR_REPATH_SPEED_RETENTION = 0.82
const TRAJECTORY_CURVATURE_SAMPLE_STEP = 0.18
const TRAJECTORY_CURVATURE_WINDOW_DISTANCE = 0.36
const TRAJECTORY_SMALL_RADIUS_THRESHOLD = 1.8
const TRAJECTORY_RUN_LOOKAHEAD_DISTANCE = 2
const TRAJECTORY_RUN_MIN_SECTION_LENGTH = 2
const TRAJECTORY_RUN_ACCELERATION_DISTANCE = 0.85
const TRAJECTORY_RUN_DECELERATION_DISTANCE = 0.95
const MAX_REACHABLE_TARGET_SNAP_DISTANCE = 1.4
const SPAWN_SUPPORT_RADIUS_CELLS = 2
const PATH_STATIC_PREVIEW_MODE = false
const PATH_RENDER_MAIN_RADIUS = 0.045
const PATH_RENDER_STATIC_PREVIEW_MAIN_RADIUS = 0.06
const PATH_STATIC_PREVIEW_FADE_SEGMENT_COUNT = 24
const PATH_RENDER_MAIN_RADIAL_SEGMENTS = 12
const PATH_RENDER_SEGMENT_LENGTH = 0.18
const PATH_RENDER_FADE_START_DISTANCE = 0.5
const PATH_RENDER_FADE_END_DISTANCE = 1.5
const PATH_RENDER_THREAD_WIDTH = 0.04
const PATH_RENDER_THREAD_COLOR = '#b9ff9d'
const PATH_RENDER_ORBITS_ENABLED = false
const PATH_MAIN_HIGHLIGHT_ALPHA = 0.68
const TOOL_CONE_CAMERA_SURFACE_EPSILON = 0.035
const PATH_MAIN_HIGHLIGHT_FEATHER = 0.18
const PATH_MAIN_HIGHLIGHT_LENGTH = 0.32
const PATH_RENDER_ORBIT_OFFSET = 0.06
const PATH_RENDER_ORBIT_VERTICAL_SCALE = 0.42
const PATH_RENDER_ORBIT_RIBBON_WIDTH = 0.044
const PATH_RENDER_ORBIT_RIBBON_TWIST_COUNT = 1.5
const PATH_RENDER_ORBIT_WAVE_COUNT = 2.35
const PATH_RENDER_ORBIT_PHASE_SPEED = 0.38
const PATH_RENDER_ORBIT_EDGE_FADE_DISTANCE = 0.7
const PATH_RENDER_ORBIT_ALPHA_WAVE_COUNT = 2.8
const PATH_RENDER_ORBIT_ALPHA_WAVE_SPEED = 1.8
const PATH_RENDER_ORBIT_ALPHA_MIN = 0.76
const PATH_RENDER_ORBIT_ALPHA_MAX = 1
const PATH_MIN_CORNER_RADIUS = 0.05
const PATH_MAX_CORNER_RADIUS = 0.18
const PATH_SUPPORT_SAMPLE_STEP = 0.08
const STRAIGHT_PATH_DOT_THRESHOLD = 0.999
const MIN_CURVE_SEGMENT_LENGTH = 0.02
const ACTOR_POSITION_PUBLISH_DISTANCE = 0.14
const ACTOR_POSITION_PUBLISH_INTERVAL_MS = 180
const DOOR_COLLISION_ACTIVE_EPSILON = 0.02
const TASK_SOURCE_SHIELD_MESH_URL = '/meshes/scifi-shield/mesh_shield_1.obj'
const TASK_SOURCE_SHIELD_EDGE_COLOR_MULTIPLIER = 0.48
const TASK_SOURCE_SHIELD_OPACITY = 0.94
const TASK_SOURCE_SHIELD_SCALE_MULTIPLIER = 1.1
const TASK_SOURCE_SHIELD_SECONDARY_SCALE_MULTIPLIER = 1.03
const TASK_SOURCE_SHIELD_SPIN_SPEED = 0.336
const TASK_SOURCE_SHIELD_VERTICAL_OFFSET_MULTIPLIER = 0.5
const TASK_SOURCE_SHIELD_FADE_IN_MS = 1000

const configureTaskSourceShieldTextLoader = (loader: FileLoader<unknown>) => {
  loader.setResponseType('text')
}

const stripTaskSourceShieldLineRecords = (objSource: string) =>
  objSource
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('l '))
    .join('\n')

const stripTaskSourceShieldFaceRecords = (objSource: string) =>
  objSource
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('f '))
    .join('\n')

useLoader.preload(FileLoader, TASK_SOURCE_SHIELD_MESH_URL, configureTaskSourceShieldTextLoader)

function isNavigationDebugEnabled() {
  return false
}
const NAVIGATION_AUDIT_DIAGNOSTICS_ENABLED = false
const NAVIGATION_FRAME_TRACE_ENABLED = false
// Keep the actor back far enough for the proof-scene cone handoff to read.
const ITEM_MOVE_APPROACH_STANDOFF = 1.25
const ITEM_MOVE_APPROACH_MARGIN = Math.max(
  ITEM_MOVE_APPROACH_STANDOFF,
  NAVIGATION_AGENT_RADIUS + 0.06,
)
const ITEM_MOVE_APPROACH_MAX_SNAP_DISTANCE = 1.45
const ITEM_MOVE_PICKUP_DURATION_MS = 760
const ITEM_MOVE_DROP_DURATION_MS = 820
const ITEM_INTERACTION_GESTURE_DURATION_SCALE = 0.5
const ITEM_MOVE_ROBOT_HEIGHT_ESTIMATE = 1.82
const ITEM_MOVE_CARRY_HEAD_CLEARANCE = 0.26
const ITEM_MOVE_CARRY_ITEM_HEIGHT_SCALE = 0.16
const ITEM_MOVE_CARRY_ITEM_HEIGHT_MAX = 0.26
const ITEM_MOVE_CARRY_FORWARD_DISTANCE = 0.5
const ITEM_MOVE_CARRY_WOBBLE_LATERAL = 0.035
const ITEM_MOVE_CARRY_WOBBLE_VERTICAL = 0.028
const ITEM_MOVE_CARRY_WOBBLE_SPEED = 0.0024
const ITEM_MOVE_PICKUP_ARC_HEIGHT = 0.42
const ITEM_MOVE_DROP_SETTLE_DURATION_MS = 34
const ITEM_MOVE_COMMIT_DEFER_DELAY_MS = 180
const ITEM_MOVE_COMMIT_IDLE_TIMEOUT_MS = 1200
const ITEM_MOVE_PREVIEW_PLAN_CACHE_MAX_ENTRIES = 24
const ITEM_MOVE_PREVIEW_PLAN_DEBOUNCE_MS = 0
const NAVIGATION_POST_WARMUP_CAMERA_STABLE_MS = 180
const NAVIGATION_TOOL_CONE_MOVE_COLOR = '#52e8ff'
const NAVIGATION_TOOL_CONE_COPY_COLOR = '#22c55e'
const NAVIGATION_TOOL_CONE_DELETE_COLOR = '#ef4444'
const NAVIGATION_TOOL_CONE_REPAIR_COLOR = '#c2bb00'
const TASK_QUEUE_INACTIVE_ACTION_SHIELD_OPACITY = 0.45
const ITEM_MOVE_GESTURE_CLIP_OPTIONS = [
  {
    clipName: 'Checkout_Gesture',
    durationSeconds: 6.4666666984558105,
  },
] as const
const STATIC_SHADOW_SCENE_WARMUP_FRAMES = 240
const STATIC_SHADOW_DYNAMIC_SETTLE_FRAMES = 18
const NAVIGATION_GRAPH_CACHE_MAX_ENTRIES = 8

function isDebugMovableItem(
  node: ItemNode,
  nodes: Record<string, ItemNode | LevelNode | { type?: string }>,
) {
  if (node.asset.attachTo || node.asset.category === 'door' || node.asset.category === 'window') {
    return false
  }

  const metadata =
    typeof node.metadata === 'object' && node.metadata !== null && !Array.isArray(node.metadata)
      ? (node.metadata as Record<string, unknown>)
      : null
  if (metadata?.isTransient === true) {
    return false
  }

  const parentNode = node.parentId ? nodes[node.parentId] : null
  return parentNode?.type !== 'item'
}

type NavigationItemMoveApproach = {
  cellIndex: number
  world: [number, number, number]
}

type NavigationItemFootprintBounds = {
  maxX: number
  maxZ: number
  minX: number
  minZ: number
}

type NavigationItemMovePlan = {
  controller: NavigationItemMoveController
  dropGesture: NavigationItemMoveGesture
  exitPath: NavigationPrecomputedExitPath | null
  pickupGesture: NavigationItemMoveGesture
  request: NavigationItemMoveRequest
  sourceApproach: NavigationItemMoveApproach
  sourcePath: NavigationPathResult
  targetApproach: NavigationItemMoveApproach
  targetPath: NavigationPathResult
  targetPlanningGraph: NavigationGraph
}

type NavigationPrecomputedExitPath = {
  destinationCellIndex: number | null
  pathResult: NavigationPathResult
  planningGraph: NavigationGraph
  targetWorldPosition: [number, number, number]
}

type PendingPascalTruckExitRequest = {
  allowQueuedTasks: boolean
  requiredTaskLoopToken: number | null
}

type TaskQueueSourceMarkerSpec = {
  color: string
  dimensions: [number, number, number]
  isActive: boolean
  kind: 'copy' | 'delete' | 'move' | 'repair'
  opacity: number
  position: [number, number, number]
  taskId: string
}

function isNavigationCopyItemMoveRequest(request: NavigationItemMoveRequest | null) {
  return Boolean(request?.visualItemId && request.visualItemId !== request.itemId)
}

function getNavigationQueuedTaskVisualKind(task: NavigationQueuedTask) {
  if (task.kind !== 'move') {
    return task.kind
  }

  return isNavigationCopyItemMoveRequest(task.request) ? 'copy' : 'move'
}

function getTaskQueueSourceMarkerSpecs(
  taskQueue: NavigationQueuedTask[],
  activeTaskId: string | null,
  enabled: boolean,
  robotMode: NavigationRobotMode | null,
): TaskQueueSourceMarkerSpec[] {
  if (!(enabled && robotMode === 'task')) {
    return []
  }

  return taskQueue.flatMap((task) => {
    const taskVisualKind = getNavigationQueuedTaskVisualKind(task)
    const color =
      taskVisualKind === 'copy'
        ? NAVIGATION_TOOL_CONE_COPY_COLOR
        : taskVisualKind === 'delete'
          ? NAVIGATION_TOOL_CONE_DELETE_COLOR
          : taskVisualKind === 'repair'
            ? NAVIGATION_TOOL_CONE_REPAIR_COLOR
            : taskVisualKind === 'move'
              ? NAVIGATION_TOOL_CONE_MOVE_COLOR
              : null
    if (color === null) {
      return []
    }

    const request = task.request
    const position = getRenderedFloorItemPosition(
      request.levelId,
      request.sourcePosition,
      request.itemDimensions,
      request.sourceRotation,
    )

    return [
      {
        color,
        dimensions: [...request.itemDimensions] as [number, number, number],
        isActive: task.taskId === activeTaskId,
        kind: taskVisualKind,
        opacity: task.taskId === activeTaskId ? 1 : TASK_QUEUE_INACTIVE_ACTION_SHIELD_OPACITY,
        position,
        taskId: task.taskId,
      },
    ]
  })
}

function roundWarmupCameraValue(value: number) {
  return Math.round(value * 20) / 20
}

type ResolvedNavigationItemMovePlan = Pick<
  NavigationItemMovePlan,
  | 'exitPath'
  | 'sourceApproach'
  | 'sourcePath'
  | 'targetApproach'
  | 'targetPath'
  | 'targetPlanningGraph'
>

type NavigationItemMovePreviewPlan = ResolvedNavigationItemMovePlan & {
  cacheKey: string
}

type NavigationItemMoveSequence = NavigationItemMovePlan & {
  pickupCarryVisualStartedAt: number | null
  dropStartedAt: number | null
  dropStartPosition: [number, number, number] | null
  dropSettledAt: number | null
  pickupStartedAt: number | null
  pickupTransferStartedAt: number | null
  sourceDisplayPosition: [number, number, number]
  stage: 'drop-settle' | 'drop-transfer' | 'pickup-transfer' | 'to-source' | 'to-target'
  taskId: string | null
  targetDisplayPosition: [number, number, number]
  targetRotationY: number
}

type NavigationItemDeleteSequence = {
  deleteStartedAt: number | null
  gesture: NavigationItemMoveGesture
  request: NavigationItemDeleteRequest
  sourceApproach: NavigationItemMoveApproach
  stage: 'delete-transfer' | 'to-source'
  taskId: string | null
}

type NavigationItemRepairSequence = {
  gesture: NavigationItemMoveGesture
  repairStartedAt: number | null
  request: NavigationItemRepairRequest
  sourceApproach: NavigationItemMoveApproach
  stage: 'repair-transfer' | 'to-source'
  taskId: string | null
}

type NavigationSceneSnapshot = ReturnType<typeof buildNavigationSceneSnapshot>

type ItemMoveFrameTraceSample = {
  at: number
  ghostId: string | null
  ghostLivePosition: [number, number, number] | null
  ghostLocalPosition: [number, number, number] | null
  ghostNodePosition: [number, number, number] | null
  ghostWorldDeltaYFromStart: number | null
  ghostWorldDeltaZFromStart: number | null
  ghostWorldPosition: [number, number, number] | null
  sourceId: string | null
  sourceLivePosition: [number, number, number] | null
  sourceLocalPosition: [number, number, number] | null
  sourceNodePosition: [number, number, number] | null
  sourceWorldDeltaYFromStart: number | null
  sourceWorldDeltaZFromStart: number | null
  sourceWorldPosition: [number, number, number] | null
  stage: string | null
}

type TrajectoryShaderHandle = {
  uniforms: Record<string, { value: number }>
}

type TrajectoryMaterialUniforms = {
  uTrajectoryAlphaEnabled: { value: number }
  uTrajectoryAlphaMax: { value: number }
  uTrajectoryAlphaMin: { value: number }
  uTrajectoryAlphaPhase: { value: number }
  uTrajectoryAlphaWaveCount: { value: number }
  uTrajectoryAlphaWaveSpeed: { value: number }
  uTrajectoryEndFadeLength: { value: number }
  uTrajectoryFrontFadeLength: { value: number }
  uTrajectoryReveal: { value: number }
  uTrajectoryTime: { value: number }
  uTrajectoryVisibleStart: { value: number }
}

type TrajectoryMaterialHandle = MeshBasicMaterial & {
  userData: MeshBasicMaterial['userData'] & {
    trajectoryUniforms?: TrajectoryMaterialUniforms
  }
}

type TrajectoryThreadMaterial = MeshBasicNodeMaterial & {
  userData: MeshBasicNodeMaterial['userData'] & {
    uFadeLength: { value: number }
    uOpaque: { value: number }
    uReveal: { value: number }
    uVisibleStart: { value: number }
  }
}

type RendererShadowMap = {
  autoUpdate?: boolean
  enabled?: boolean
  needsUpdate?: boolean
}
type PathRenderSegment = {
  centerT: number
  endT: number
  geometry: TubeGeometry
  material: MeshBasicMaterial
  startT: number
}

type OrbitRibbonVisualState = {
  alphaMax: number
  alphaMin: number
  alphaPhase: number
  alphaWaveCount: number
  alphaWaveSpeed: number
  time: number
}

type TrajectoryCurvatureSectionKind = 'high' | 'low'

type TrajectoryCurvatureSection = {
  endDistance: number
  kind: TrajectoryCurvatureSectionKind
  minRadius: number
  startDistance: number
}

type TrajectoryMotionProfile = {
  sections: TrajectoryCurvatureSection[]
  totalLength: number
}

type TrajectoryMotionState = {
  runBlend: number
  section: TrajectoryCurvatureSection | null
  sectionKind: TrajectoryCurvatureSectionKind
}

type ActorLocomotionState = {
  moveBlend: number
  runBlend: number
  runTimeScale: number
  sectionKind: TrajectoryCurvatureSectionKind
  walkTimeScale: number
}

type ActorForcedClipState = {
  clipName: string
  holdLastFrame: boolean
  loop: 'once' | 'repeat'
  paused: boolean
  revealProgress: number
  seekTime: number | null
  timeScale: number
}

type NavigationItemMoveGesture = (typeof ITEM_MOVE_GESTURE_CLIP_OPTIONS)[number]

type NavigationRobotForcedClipPlayback = {
  clipName: string
  holdLastFrame?: boolean
  loop?: 'once' | 'repeat'
  revealFromStart?: boolean
  stabilizeRootMotion?: boolean
  timeScale?: number
}

type ActorMotionState = {
  debugTransitionPreview?: {
    releasedClipName: string
    releasedClipTime: number
    releasedClipWeight: number
  } | null
  destinationCellIndex: number | null
  distance: number
  forcedClip: ActorForcedClipState | null
  locomotion: ActorLocomotionState
  moving: boolean
  rootMotionOffset: [number, number, number]
  speed: number
  visibilityRevealProgress?: number | null
}

type PascalTruckIntroState = {
  animationElapsedMs: number
  animationStarted: boolean
  endPosition: [number, number, number]
  finalCellIndex: number | null
  handoffPending: boolean
  revealElapsedMs: number
  revealStarted: boolean
  rotationY: number
  startPosition: [number, number, number]
}

type PascalTruckExitState = {
  endPosition: [number, number, number]
  fadeElapsedMs: number
  finalCellIndex: number | null
  rotationY: number
  stage: 'fade' | 'to-truck'
  startPosition: [number, number, number]
}

function getPolygonCentroid(points: Array<[number, number]>) {
  if (points.length === 0) {
    return null
  }

  let area = 0
  let centroidX = 0
  let centroidY = 0

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]

    if (!(current && next)) {
      continue
    }

    const cross = current[0] * next[1] - next[0] * current[1]
    area += cross
    centroidX += (current[0] + next[0]) * cross
    centroidY += (current[1] + next[1]) * cross
  }

  if (Math.abs(area) <= Number.EPSILON) {
    const [sumX, sumY] = points.reduce(
      (accumulator, [x, y]) => [accumulator[0] + x, accumulator[1] + y],
      [0, 0],
    )
    return [sumX / points.length, sumY / points.length] as [number, number]
  }

  return [centroidX / (3 * area), centroidY / (3 * area)] as [number, number]
}

function cross2D(origin: Vector2, pointA: Vector2, pointB: Vector2) {
  return (
    (pointA.x - origin.x) * (pointB.y - origin.y) - (pointA.y - origin.y) * (pointB.x - origin.x)
  )
}

function computeProjectedHull2D(points: Vector2[]) {
  if (points.length < 3) {
    return points
  }

  const sorted = [...points].sort((pointA, pointB) => {
    if (Math.abs(pointA.x - pointB.x) > 1e-6) {
      return pointA.x - pointB.x
    }
    return pointA.y - pointB.y
  })
  const uniquePoints = sorted.filter((point, index) => {
    if (index === 0) {
      return true
    }
    const previousPoint = sorted[index - 1]
    if (!previousPoint) {
      return true
    }
    return Math.abs(point.x - previousPoint.x) > 1e-6 || Math.abs(point.y - previousPoint.y) > 1e-6
  })

  if (uniquePoints.length < 3) {
    return uniquePoints
  }

  const lowerHull: Vector2[] = []
  for (const point of uniquePoints) {
    while (lowerHull.length >= 2) {
      const previous = lowerHull[lowerHull.length - 1]
      const beforePrevious = lowerHull[lowerHull.length - 2]
      if (!(previous && beforePrevious)) {
        break
      }
      if (cross2D(beforePrevious, previous, point) <= 0) {
        lowerHull.pop()
        continue
      }
      break
    }
    lowerHull.push(point)
  }

  const upperHull: Vector2[] = []
  for (let index = uniquePoints.length - 1; index >= 0; index -= 1) {
    const point = uniquePoints[index]
    if (!point) {
      continue
    }
    while (upperHull.length >= 2) {
      const previous = upperHull[upperHull.length - 1]
      const beforePrevious = upperHull[upperHull.length - 2]
      if (!(previous && beforePrevious)) {
        break
      }
      if (cross2D(beforePrevious, previous, point) <= 0) {
        upperHull.pop()
        continue
      }
      break
    }
    upperHull.push(point)
  }

  lowerHull.pop()
  upperHull.pop()

  return [...lowerHull, ...upperHull]
}

function getDistanceToSegment2D(point: Vector2, segmentStart: Vector2, segmentEnd: Vector2) {
  const segmentVector = segmentEnd.clone().sub(segmentStart)
  const segmentLengthSq = segmentVector.lengthSq()
  if (segmentLengthSq <= Number.EPSILON) {
    return point.distanceTo(segmentStart)
  }

  const pointVector = point.clone().sub(segmentStart)
  const projectedT = MathUtils.clamp(pointVector.dot(segmentVector) / segmentLengthSq, 0, 1)
  return point.distanceTo(segmentStart.clone().add(segmentVector.multiplyScalar(projectedT)))
}

function isPointInsidePolygon2D(point: Vector2, polygon: Vector2[]) {
  if (polygon.length < 3) {
    return false
  }

  let inside = false
  for (
    let index = 0, previousIndex = polygon.length - 1;
    index < polygon.length;
    previousIndex = index, index += 1
  ) {
    const current = polygon[index]
    const previous = polygon[previousIndex]
    if (!(current && previous)) {
      continue
    }

    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y || 1e-6) +
          current.x
    if (intersects) {
      inside = !inside
    }
  }

  return inside
}

function isObjectVisibleInHierarchy(target: Object3D | null) {
  let current: Object3D | null = target
  while (current) {
    if (!current.visible) {
      return false
    }
    current = current.parent
  }
  return true
}

function isVector3Tuple(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
  )
}

function getToolConeTargetSurfaceHit(
  target: Object3D | null,
  worldPoint: [number, number, number],
  cameraPosition: Vector3,
) {
  if (!target) {
    return null
  }

  const rayDirection = new Vector3(worldPoint[0], worldPoint[1], worldPoint[2]).sub(cameraPosition)
  const targetDistance = rayDirection.length()
  if (!(targetDistance > 1e-5)) {
    return null
  }

  rayDirection.multiplyScalar(1 / targetDistance)
  const raycaster = new Raycaster(cameraPosition, rayDirection, 0.001, targetDistance + 0.25)
  const hit = raycaster
    .intersectObject(target, true)
    .find(
      (intersection) =>
        !hasNavigationApproachTargetExclusion(intersection.object) &&
        isObjectVisibleInHierarchy(intersection.object),
    )
  if (!hit) {
    return {
      relation: 'no-hit' as const,
      surfaceDistanceDelta: null,
      surfaceMeshName: null,
      surfacePoint: null,
    }
  }

  const surfaceDistanceDelta = Math.abs(targetDistance - hit.distance)
  return {
    relation:
      surfaceDistanceDelta <= TOOL_CONE_CAMERA_SURFACE_EPSILON
        ? ('visible' as const)
        : ('occluded' as const),
    surfaceDistanceDelta,
    surfaceMeshName: hit.object.name || null,
    surfacePoint: [hit.point.x, hit.point.y, hit.point.z] as [number, number, number],
  }
}

function toLevelNodeId(levelId: string | null | undefined): LevelNode['id'] | null {
  return typeof levelId === 'string' && levelId.startsWith('level_')
    ? (levelId as LevelNode['id'])
    : null
}

function getNavigationPointKey(point: [number, number, number] | Vector3) {
  const x = point instanceof Vector3 ? point.x : point[0]
  const y = point instanceof Vector3 ? point.y : point[1]
  const z = point instanceof Vector3 ? point.z : point[2]
  return `${x.toFixed(4)}:${y.toFixed(4)}:${z.toFixed(4)}`
}

function smoothPathWithinCorridor(points: Vector3[], protectedPointKeys?: Set<string>) {
  if (points.length <= 2) {
    return points.map((point) => point.clone())
  }

  const simplifiedPoints = [points[0]?.clone()].filter((point): point is Vector3 => Boolean(point))

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = simplifiedPoints[simplifiedPoints.length - 1]
    const current = points[index]
    const next = points[index + 1]

    if (!(previous && current && next)) {
      continue
    }

    if (protectedPointKeys?.has(getNavigationPointKey(current))) {
      simplifiedPoints.push(current.clone())
      continue
    }

    if (previous.distanceToSquared(current) <= Number.EPSILON) {
      continue
    }

    if (current.distanceToSquared(next) <= Number.EPSILON) {
      continue
    }

    const incomingDirection = current.clone().sub(previous).normalize()
    const outgoingDirection = next.clone().sub(current).normalize()

    if (incomingDirection.dot(outgoingDirection) >= STRAIGHT_PATH_DOT_THRESHOLD) {
      continue
    }

    simplifiedPoints.push(current.clone())
  }

  const finalPoint = points[points.length - 1]
  const lastSimplifiedPoint = simplifiedPoints[simplifiedPoints.length - 1]
  if (
    finalPoint &&
    (!lastSimplifiedPoint || lastSimplifiedPoint.distanceToSquared(finalPoint) > Number.EPSILON)
  ) {
    simplifiedPoints.push(finalPoint.clone())
  }

  return simplifiedPoints
}

function isLineSegmentSupported(
  start: Vector3,
  end: Vector3,
  isPointSupported?: (point: Vector3) => boolean,
) {
  if (!isPointSupported) {
    return true
  }

  const segmentLength = start.distanceTo(end)
  const sampleCount = Math.max(2, Math.ceil(segmentLength / PATH_SUPPORT_SAMPLE_STEP))
  const samplePoint = new Vector3()

  for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
    samplePoint.lerpVectors(start, end, sampleIndex / sampleCount)
    if (!isPointSupported(samplePoint)) {
      return false
    }
  }

  return true
}

function isCurveSegmentSupported(
  curve: Curve<Vector3>,
  isPointSupported?: (point: Vector3) => boolean,
) {
  if (!isPointSupported) {
    return true
  }

  const sampleCount = Math.max(3, Math.ceil(curve.getLength() / PATH_SUPPORT_SAMPLE_STEP))
  const samplePoint = new Vector3()

  for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
    curve.getPointAt(sampleIndex / sampleCount, samplePoint)
    if (!isPointSupported(samplePoint)) {
      return false
    }
  }

  return true
}

function buildRoundedPathCurve(points: Vector3[], isPointSupported?: (point: Vector3) => boolean) {
  if (points.length < 2) {
    return null
  }

  const curvePath = new CurvePath<Vector3>()
  let currentPathPoint = points[0]?.clone()

  if (!currentPathPoint) {
    return null
  }

  const appendLineSegment = (start: Vector3, end: Vector3) => {
    if (start.distanceToSquared(end) <= MIN_CURVE_SEGMENT_LENGTH * MIN_CURVE_SEGMENT_LENGTH) {
      return true
    }

    if (!isLineSegmentSupported(start, end, isPointSupported)) {
      return false
    }

    curvePath.add(new LineCurve3(start.clone(), end.clone()))
    return true
  }

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]
    const corner = points[index]
    const next = points[index + 1]

    if (!(previous && corner && next)) {
      continue
    }

    const incomingVector = corner.clone().sub(previous)
    const outgoingVector = next.clone().sub(corner)
    const incomingLength = incomingVector.length()
    const outgoingLength = outgoingVector.length()

    if (incomingLength <= Number.EPSILON || outgoingLength <= Number.EPSILON) {
      continue
    }

    const incomingDirection = incomingVector.clone().divideScalar(incomingLength)
    const outgoingDirection = outgoingVector.clone().divideScalar(outgoingLength)
    const turnDot = MathUtils.clamp(incomingDirection.dot(outgoingDirection), -1, 1)

    if (turnDot >= STRAIGHT_PATH_DOT_THRESHOLD) {
      if (!appendLineSegment(currentPathPoint, corner)) {
        return null
      }
      currentPathPoint = corner.clone()
      continue
    }

    const turnAngle = Math.acos(turnDot)
    const cornerRadius = Math.min(
      PATH_MAX_CORNER_RADIUS,
      incomingLength * 0.4,
      outgoingLength * 0.4,
    )

    if (turnAngle <= 0.08 || cornerRadius < PATH_MIN_CORNER_RADIUS) {
      if (!appendLineSegment(currentPathPoint, corner)) {
        return null
      }
      currentPathPoint = corner.clone()
      continue
    }

    let appliedCurve = false
    let candidateRadius = cornerRadius

    while (candidateRadius >= PATH_MIN_CORNER_RADIUS) {
      const entryPoint = corner.clone().addScaledVector(incomingDirection, -candidateRadius)
      const exitPoint = corner.clone().addScaledVector(outgoingDirection, candidateRadius)
      const candidateCurve = new QuadraticBezierCurve3(
        entryPoint.clone(),
        corner.clone(),
        exitPoint.clone(),
      )

      if (
        !isLineSegmentSupported(currentPathPoint, entryPoint, isPointSupported) ||
        !isCurveSegmentSupported(candidateCurve, isPointSupported)
      ) {
        candidateRadius *= 0.5
        continue
      }

      if (!appendLineSegment(currentPathPoint, entryPoint)) {
        return null
      }
      curvePath.add(candidateCurve)
      currentPathPoint = exitPoint
      appliedCurve = true
      break
    }

    if (!appliedCurve) {
      if (!appendLineSegment(currentPathPoint, corner)) {
        return null
      }
      currentPathPoint = corner.clone()
    }
  }

  const finalPoint = points[points.length - 1]
  if (finalPoint && currentPathPoint) {
    if (!appendLineSegment(currentPathPoint, finalPoint)) {
      return null
    }
  }

  return curvePath.curves.length > 0 ? curvePath : null
}

function buildPathCurve(
  points: Vector3[],
  doorTransitions: NavigationDoorTransition[],
  isPointSupported?: (point: Vector3) => boolean,
) {
  if (points.length < 2) {
    return null
  }
  const curvePath = new CurvePath<Vector3>()

  const appendLineSegment = (start: Vector3, end: Vector3) => {
    if (start.distanceToSquared(end) <= MIN_CURVE_SEGMENT_LENGTH * MIN_CURVE_SEGMENT_LENGTH) {
      return true
    }

    if (!isLineSegmentSupported(start, end, isPointSupported)) {
      return false
    }

    curvePath.add(new LineCurve3(start.clone(), end.clone()))
    return true
  }

  const appendSpan = (spanPoints: Vector3[]) => {
    if (spanPoints.length < 2) {
      return true
    }

    const spanStart = spanPoints[0]
    const spanEnd = spanPoints[spanPoints.length - 1]
    if (!(spanStart && spanEnd)) {
      return true
    }

    if (spanPoints.length === 2) {
      return appendLineSegment(spanStart, spanEnd)
    }

    const spline = new CatmullRomCurve3(
      spanPoints.map((point) => point.clone()),
      false,
      'centripetal',
    )
    if (isCurveSegmentSupported(spline, isPointSupported)) {
      curvePath.add(spline)
      return true
    }

    const roundedSpanCurve = buildRoundedPathCurve(spanPoints, isPointSupported)
    if (roundedSpanCurve) {
      for (const curve of roundedSpanCurve.curves) {
        curvePath.add(curve)
      }
      return true
    }

    for (let index = 0; index < spanPoints.length - 1; index += 1) {
      const start = spanPoints[index]
      const end = spanPoints[index + 1]
      if (!(start && end && appendLineSegment(start, end))) {
        return false
      }
    }

    return true
  }

  if (doorTransitions.length === 0) {
    return appendSpan(points) && curvePath.curves.length > 0 ? curvePath : null
  }

  const findPointIndex = (target: [number, number, number], startIndex: number): number | null => {
    const targetKey = getNavigationPointKey(target)
    for (let index = startIndex; index < points.length; index += 1) {
      const point = points[index]
      if (point && getNavigationPointKey(point) === targetKey) {
        return index
      }
    }
    return null
  }

  const doorRuns: Array<{ endIndex: number; startIndex: number }> = []
  let searchIndex = 0
  for (const transition of doorTransitions) {
    const approachIndex = findPointIndex(transition.approachWorld, searchIndex)
    if (approachIndex === null) {
      continue
    }

    const entryIndex = findPointIndex(transition.entryWorld, approachIndex)
    const worldIndex = entryIndex === null ? null : findPointIndex(transition.world, entryIndex)
    const exitIndex = worldIndex === null ? null : findPointIndex(transition.exitWorld, worldIndex)
    const departureIndex =
      exitIndex === null ? null : findPointIndex(transition.departureWorld, exitIndex)

    if (
      entryIndex === null ||
      worldIndex === null ||
      exitIndex === null ||
      departureIndex === null
    ) {
      continue
    }

    doorRuns.push({
      endIndex: departureIndex,
      startIndex: approachIndex,
    })
    searchIndex = departureIndex
  }

  if (doorRuns.length === 0) {
    return appendSpan(points) && curvePath.curves.length > 0 ? curvePath : null
  }

  let cursor = 0

  for (const doorRun of doorRuns) {
    const spanStartIndex = Math.max(cursor, doorRun.startIndex - 1)
    if (spanStartIndex > cursor) {
      const leadingSpanPoints = points.slice(cursor, spanStartIndex + 1)
      if (!appendSpan(leadingSpanPoints)) {
        return null
      }
    }

    const spanEndIndex = Math.min(points.length - 1, doorRun.endIndex + 1)
    const doorSpanPoints = points.slice(spanStartIndex, spanEndIndex + 1)
    if (!appendSpan(doorSpanPoints)) {
      return null
    }

    cursor = spanEndIndex
  }

  if (cursor < points.length - 1) {
    const trailingSpanPoints = points.slice(cursor)
    if (!appendSpan(trailingSpanPoints)) {
      return null
    }
  }

  return curvePath.curves.length > 0 ? curvePath : null
}

function buildPolylineCurve(points: Vector3[]) {
  if (points.length < 2) {
    return null
  }

  const curvePath = new CurvePath<Vector3>()

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]
    const end = points[index + 1]

    if (!(start && end)) {
      continue
    }

    if (start.distanceToSquared(end) <= MIN_CURVE_SEGMENT_LENGTH * MIN_CURVE_SEGMENT_LENGTH) {
      continue
    }

    curvePath.add(new LineCurve3(start.clone(), end.clone()))
  }

  return curvePath.curves.length > 0 ? curvePath : null
}

function estimateCurveRadiusAtDistance(
  curve: Curve<Vector3>,
  totalLength: number,
  distance: number,
) {
  if (totalLength <= Number.EPSILON) {
    return Number.POSITIVE_INFINITY
  }

  const sampleStart = Math.max(0, distance - TRAJECTORY_CURVATURE_WINDOW_DISTANCE)
  const sampleEnd = Math.min(totalLength, distance + TRAJECTORY_CURVATURE_WINDOW_DISTANCE)
  const sampleSpan = sampleEnd - sampleStart
  if (sampleSpan <= Number.EPSILON) {
    return Number.POSITIVE_INFINITY
  }

  const startT = MathUtils.clamp(sampleStart / totalLength, 0, 1)
  const endT = MathUtils.clamp(sampleEnd / totalLength, 0, 1)
  const startTangent = curve.getTangentAt(startT, new Vector3()).normalize()
  const endTangent = curve.getTangentAt(endT, new Vector3()).normalize()
  const turnAngle = Math.acos(MathUtils.clamp(startTangent.dot(endTangent), -1, 1))

  if (turnAngle <= 1e-4) {
    return Number.POSITIVE_INFINITY
  }

  return sampleSpan / turnAngle
}

function buildTrajectoryMotionProfile(
  curve: Curve<Vector3> | null,
  totalLength: number,
): TrajectoryMotionProfile | null {
  if (!(curve && totalLength > Number.EPSILON)) {
    return null
  }

  const intervalCount = Math.max(1, Math.ceil(totalLength / TRAJECTORY_CURVATURE_SAMPLE_STEP))
  const intervalLength = totalLength / intervalCount
  const sections: TrajectoryCurvatureSection[] = []

  for (let intervalIndex = 0; intervalIndex < intervalCount; intervalIndex += 1) {
    const startDistance = intervalIndex * intervalLength
    const endDistance =
      intervalIndex === intervalCount - 1 ? totalLength : (intervalIndex + 1) * intervalLength
    const midpointDistance = (startDistance + endDistance) * 0.5
    const radius = estimateCurveRadiusAtDistance(curve, totalLength, midpointDistance)
    const kind: TrajectoryCurvatureSectionKind =
      radius < TRAJECTORY_SMALL_RADIUS_THRESHOLD ? 'high' : 'low'
    const previousSection = sections[sections.length - 1]

    if (previousSection?.kind === kind) {
      previousSection.endDistance = endDistance
      previousSection.minRadius = Math.min(previousSection.minRadius, radius)
      continue
    }

    sections.push({
      endDistance,
      kind,
      minRadius: radius,
      startDistance,
    })
  }

  return {
    sections,
    totalLength,
  }
}

function getTrajectoryMotionState(
  profile: TrajectoryMotionProfile | null,
  distance: number,
): TrajectoryMotionState {
  if (!(profile && profile.sections.length > 0)) {
    return {
      runBlend: 0,
      section: null,
      sectionKind: 'high',
    }
  }

  const clampedDistance = MathUtils.clamp(distance, 0, profile.totalLength)
  const section =
    profile.sections.find(
      (candidate) =>
        clampedDistance >= candidate.startDistance && clampedDistance <= candidate.endDistance,
    ) ?? profile.sections[profile.sections.length - 1]!

  if (section.kind === 'high') {
    return {
      runBlend: 0,
      section,
      sectionKind: section.kind,
    }
  }

  const sectionLength = section.endDistance - section.startDistance
  if (sectionLength < TRAJECTORY_RUN_MIN_SECTION_LENGTH) {
    return {
      runBlend: 0,
      section,
      sectionKind: section.kind,
    }
  }

  const distanceSinceStart = clampedDistance - section.startDistance
  const distanceUntilEnd = section.endDistance - clampedDistance
  const accelerationBlend = smoothstep01(distanceSinceStart / TRAJECTORY_RUN_ACCELERATION_DISTANCE)
  const lookaheadBlend = smoothstep01(
    (distanceUntilEnd -
      (TRAJECTORY_RUN_LOOKAHEAD_DISTANCE - TRAJECTORY_RUN_DECELERATION_DISTANCE)) /
      TRAJECTORY_RUN_DECELERATION_DISTANCE,
  )

  return {
    runBlend: Math.min(accelerationBlend, lookaheadBlend),
    section,
    sectionKind: section.kind,
  }
}

function createActorLocomotionState(
  sectionKind: TrajectoryCurvatureSectionKind = 'high',
): ActorLocomotionState {
  return {
    moveBlend: 0,
    runBlend: 0,
    runTimeScale: ACTOR_RUN_ANIMATION_SPEED_SCALE,
    sectionKind,
    walkTimeScale: ACTOR_WALK_ANIMATION_SPEED_SCALE,
  }
}

function createActorMotionState(): ActorMotionState {
  return {
    debugTransitionPreview: null,
    destinationCellIndex: null,
    distance: 0,
    forcedClip: null,
    locomotion: createActorLocomotionState(),
    moving: false,
    rootMotionOffset: [0, 0, 0],
    speed: 0,
    visibilityRevealProgress: null,
  }
}

function getRandomItemMoveGesture(): NavigationItemMoveGesture {
  const randomIndex = Math.floor(Math.random() * ITEM_MOVE_GESTURE_CLIP_OPTIONS.length)
  return ITEM_MOVE_GESTURE_CLIP_OPTIONS[randomIndex] ?? ITEM_MOVE_GESTURE_CLIP_OPTIONS[0]
}

function getItemInteractionGestureDurationMs(gesture: NavigationItemMoveGesture) {
  return gesture.durationSeconds * 1000 * ITEM_INTERACTION_GESTURE_DURATION_SCALE
}

function getNavigationItemMoveVisualItemId(request: NavigationItemMoveRequest) {
  return request.visualItemId ?? request.itemId
}

function getNavigationItemMoveCommitTargetId(request: NavigationItemMoveRequest) {
  if (isNavigationCopyItemMoveRequest(request)) {
    return request.targetPreviewItemId ?? request.visualItemId ?? request.itemId
  }

  return request.itemId
}

function shouldDelayPickupCarryUntilCheckoutComplete(request: NavigationItemMoveRequest) {
  return true
}

function createNavigationItemMoveFallbackController(
  request: NavigationItemMoveRequest,
): NavigationItemMoveController {
  const visualItemId = getNavigationItemMoveVisualItemId(request)

  return {
    itemId: request.itemId,
    beginCarry: () => {
      if (isNavigationCopyItemMoveRequest(request)) {
        const sourceRotationY = request.sourceRotation[1] ?? 0
        useLiveTransforms.getState().set(visualItemId, {
          position: [...request.sourcePosition] as [number, number, number],
          rotation: sourceRotationY,
        })
        appendTaskModeTrace('navigation.copyCarrySeededFromSource', {
          itemId: request.itemId,
          sourcePosition: request.sourcePosition,
          sourceRotationY,
          visualItemId,
        })
      }
      navigationVisualsStore.getState().setItemMoveVisualState(visualItemId, 'carried')
    },
    cancel: () => {
      navigationVisualsStore.getState().setItemMoveVisualState(visualItemId, null)
      navigationVisualsStore.getState().setNodeVisibilityOverride(visualItemId, null)
      useLiveTransforms.getState().clear(visualItemId)
    },
    commit: (finalUpdate, finalCarryTransform) => {
      const sceneState = useScene.getState()
      const viewerState = useViewer.getState()
      const commitTargetId = getNavigationItemMoveCommitTargetId(request)
      const commitTargetNode = sceneState.nodes[commitTargetId as AnyNodeId]

      if (commitTargetNode?.type === 'item') {
        sceneState.updateNode(commitTargetId as AnyNodeId, {
          ...finalUpdate,
          metadata: setItemMoveVisualMetadata(
            stripTransient(commitTargetNode.metadata),
            null,
          ) as ItemNode['metadata'],
          visible: true,
        })
      } else if (request.itemId !== commitTargetId) {
        return
      } else {
        const sourceNode = sceneState.nodes[request.itemId as AnyNodeId]
        if (sourceNode?.type !== 'item') {
          return
        }

        sceneState.updateNode(request.itemId as AnyNodeId, {
          ...finalUpdate,
          metadata: setItemMoveVisualMetadata(
            stripTransient(sourceNode.metadata),
            null,
          ) as ItemNode['metadata'],
          visible: true,
        })
      }

      if (finalCarryTransform) {
        useLiveTransforms.getState().set(visualItemId, finalCarryTransform)
      }
      navigationVisualsStore.getState().setItemMoveVisualState(visualItemId, null)
      navigationVisualsStore.getState().setNodeVisibilityOverride(visualItemId, null)
      useLiveTransforms.getState().clear(visualItemId)
      clearPersistentItemMoveVisualState(visualItemId)
    },
    updateCarryTransform: (position, rotationY) => {
      useLiveTransforms.getState().set(visualItemId, {
        position,
        rotation: rotationY,
      })
    },
  }
}

function clearPersistentItemMoveVisualState(itemId: string | null | undefined) {
  if (!itemId) {
    return
  }

  const node = useScene.getState().nodes[itemId as AnyNode['id']]
  if (node?.type !== 'item') {
    return
  }

  if (getItemMoveVisualState(node.metadata) === null) {
    return
  }

  useScene.getState().updateNode(itemId as AnyNode['id'], {
    metadata: setItemMoveVisualMetadata(node.metadata, null) as ItemNode['metadata'],
  })
}

function setPersistentItemMoveVisualState(
  itemId: string | null | undefined,
  state: ItemMoveVisualState | null,
) {
  if (!itemId) {
    return
  }

  const node = useScene.getState().nodes[itemId as AnyNode['id']]
  if (node?.type !== 'item') {
    return
  }

  if (getItemMoveVisualState(node.metadata) === state) {
    return
  }

  useScene.getState().updateNode(itemId as AnyNode['id'], {
    metadata: setItemMoveVisualMetadata(node.metadata, state) as ItemNode['metadata'],
  })
}

function removeTransientNavigationPreviewNode(itemId: string | null | undefined) {
  if (!itemId) {
    return
  }

  const node = useScene.getState().nodes[itemId as AnyNode['id']]
  if (node?.type !== 'item') {
    return
  }

  const metadata =
    typeof node.metadata === 'object' && node.metadata !== null && !Array.isArray(node.metadata)
      ? (node.metadata as Record<string, unknown>)
      : null
  if (metadata?.isTransient !== true) {
    return
  }

  appendTaskModeTrace('navigation.removeTransientPreviewNode', {
    itemId,
  })
  useScene.getState().deleteNode(itemId as AnyNode['id'])
}

function ensureQueuedNavigationMoveGhostNode(request: NavigationItemMoveRequest) {
  const previewId = request.targetPreviewItemId
  const targetPosition = request.finalUpdate.position
  if (!previewId || !targetPosition) {
    appendTaskModeTrace('navigation.ensureQueuedGhostSkipped', {
      itemId: request.itemId,
      previewId: previewId ?? null,
      reason: !previewId ? 'missing-preview-id' : 'missing-target-position',
    })
    return null
  }

  const sceneState = useScene.getState()
  const sourceNode = sceneState.nodes[request.itemId as AnyNode['id']]
  if (sourceNode?.type !== 'item') {
    appendTaskModeTrace('navigation.ensureQueuedGhostSkipped', {
      itemId: request.itemId,
      previewId,
      reason: 'missing-source-node',
    })
    return null
  }

  const targetRotation = request.finalUpdate.rotation ?? request.sourceRotation
  const targetParentId =
    (typeof request.finalUpdate.parentId === 'string'
      ? request.finalUpdate.parentId
      : request.levelId ?? sourceNode.parentId) ?? null
  if (!targetParentId) {
    appendTaskModeTrace('navigation.ensureQueuedGhostSkipped', {
      itemId: request.itemId,
      previewId,
      reason: 'missing-target-parent',
    })
    return null
  }

  const previewMetadata = {
    ...stripTransient(sourceNode.metadata),
    isTransient: true,
  } as ItemNode['metadata']
  const nextMetadata = setItemMoveVisualMetadata(
    previewMetadata,
    'destination-ghost',
  ) as ItemNode['metadata']
  const existingPreviewNode = sceneState.nodes[previewId as AnyNode['id']]
  if (existingPreviewNode?.type === 'item') {
    sceneState.updateNode(previewId as AnyNode['id'], {
      metadata: nextMetadata,
      parentId: targetParentId,
      position: [...targetPosition] as [number, number, number],
      rotation: [...targetRotation] as [number, number, number],
      side: sourceNode.side,
      visible: true,
    })
    appendTaskModeTrace('navigation.ensureQueuedGhostUpdated', {
      itemId: request.itemId,
      previewId,
      targetParentId,
    })
    return previewId
  }

  const previewNode = ItemNode.parse({
    asset: sourceNode.asset,
    id: previewId,
    metadata: nextMetadata,
    name: sourceNode.name,
    parentId: targetParentId,
    position: [...targetPosition] as [number, number, number],
    rotation: [...targetRotation] as [number, number, number],
    scale: [...sourceNode.scale] as [number, number, number],
    side: sourceNode.side,
    visible: true,
  })

  sceneState.createNode(previewNode, targetParentId as AnyNodeId)
  appendTaskModeTrace('navigation.ensureQueuedGhostCreated', {
    itemId: request.itemId,
    previewId,
    targetParentId,
  })
  return previewId
}

function TaskQueueSourceMarker({ marker }: { marker: TaskQueueSourceMarkerSpec }) {
  const [fallbackWidth, fallbackHeight, fallbackDepth] = marker.dimensions
  const shieldText = useLoader(
    FileLoader,
    TASK_SOURCE_SHIELD_MESH_URL,
    configureTaskSourceShieldTextLoader,
  ) as string
  const { shieldEdgeObject, shieldFaceObject } = useMemo(
    () => ({
      shieldEdgeObject: new OBJLoader().parse(stripTaskSourceShieldFaceRecords(shieldText)) as Group,
      shieldFaceObject: new OBJLoader().parse(stripTaskSourceShieldLineRecords(shieldText)) as Group,
    }),
    [shieldText],
  )
  const fadeStartedAtMsRef = useRef<number | null>(null)
  const primaryShieldGroupRef = useRef<Group>(null)
  const secondaryShieldGroupRef = useRef<Group>(null)
  const lineMaterial = useMemo(() => {
    return new LineBasicMaterial({
      color: new Color(marker.color).multiplyScalar(TASK_SOURCE_SHIELD_EDGE_COLOR_MULTIPLIER),
      depthTest: true,
      depthWrite: false,
      opacity: 0,
      toneMapped: false,
      transparent: true,
    })
  }, [marker.color])
  const meshMaterial = useMemo(() => {
    return new MeshBasicMaterial({
      color: marker.color,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      opacity: 0,
      side: DoubleSide,
      toneMapped: false,
      transparent: true,
    })
  }, [marker.color])
  const {
    baseRadius,
    primaryShieldModel,
    secondaryShieldModel,
    shieldCenter,
    shieldHeight,
    targetRadius,
  } = useMemo(() => {
    const boundsSource = shieldFaceObject.clone(true) as Group
    const bounds = new Box3().setFromObject(boundsSource)
    const center = bounds.getCenter(new Vector3())
    const size = bounds.getSize(new Vector3())
    const fittedRadius = Math.max(fallbackWidth, fallbackHeight, fallbackDepth) / 2
    const fittedCenter = new Vector3(0, fallbackHeight / 2, 0)

    const materializeShieldModel = () => {
      const clone = new Group()
      const faceClone = shieldFaceObject.clone(true) as Group
      faceClone.position.sub(center)
      faceClone.traverse((child) => {
        if (!(child as Mesh).isMesh) {
          return
        }

        const mesh = child as Mesh
        mesh.castShadow = false
        mesh.frustumCulled = false
        mesh.material = meshMaterial
        mesh.receiveShadow = false
        mesh.renderOrder = 3
        mesh.userData.pascalExcludeFromOutline = true
      })
      clone.add(faceClone)

      const edgeClone = shieldEdgeObject.clone(true) as Group
      edgeClone.position.sub(center)
      edgeClone.traverse((child) => {
        const lineChild = child as typeof child & {
          isLine?: boolean
          isLineLoop?: boolean
          isLineSegments?: boolean
          material?: unknown
        }
        if (!(lineChild.isLine || lineChild.isLineLoop || lineChild.isLineSegments)) {
          return
        }

        child.frustumCulled = false
        child.renderOrder = 4
        child.userData.pascalExcludeFromOutline = true
        lineChild.material = lineMaterial
      })
      clone.add(edgeClone)

      return clone
    }

    return {
      baseRadius: Math.max(size.x, size.y, size.z) / 2,
      primaryShieldModel: materializeShieldModel(),
      secondaryShieldModel: materializeShieldModel(),
      shieldCenter: [fittedCenter.x, fittedCenter.y, fittedCenter.z] as [number, number, number],
      shieldHeight: size.y,
      targetRadius: fittedRadius * TASK_SOURCE_SHIELD_SCALE_MULTIPLIER,
    }
  }, [
    fallbackDepth,
    fallbackHeight,
    fallbackWidth,
    lineMaterial,
    meshMaterial,
    shieldEdgeObject,
    shieldFaceObject,
  ])

  useEffect(() => {
    fadeStartedAtMsRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now()
  }, [marker.taskId])

  useEffect(() => {
    return () => {
      lineMaterial.dispose()
      meshMaterial.dispose()
    }
  }, [lineMaterial, meshMaterial])

  useFrame((_, delta) => {
    const fadeStartedAtMs = fadeStartedAtMsRef.current
    if (fadeStartedAtMs === null) {
      return
    }

    const fadeProgress = MathUtils.clamp(
      ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - fadeStartedAtMs) /
        TASK_SOURCE_SHIELD_FADE_IN_MS,
      0,
      1,
    )
    const nextVisibility = 1 - (1 - fadeProgress) ** 2
    lineMaterial.opacity = TASK_SOURCE_SHIELD_OPACITY * marker.opacity * nextVisibility
    meshMaterial.opacity = TASK_SOURCE_SHIELD_OPACITY * marker.opacity * nextVisibility

    if (primaryShieldGroupRef.current) {
      primaryShieldGroupRef.current.rotation.y += delta * TASK_SOURCE_SHIELD_SPIN_SPEED
    }

    if (secondaryShieldGroupRef.current) {
      secondaryShieldGroupRef.current.rotation.y -= delta * TASK_SOURCE_SHIELD_SPIN_SPEED
    }
  })

  const shieldScale = baseRadius > Number.EPSILON ? targetRadius / baseRadius : 1
  const primaryShieldScale: [number, number, number] = [shieldScale * 1.1, shieldScale, shieldScale * 1.1]
  const secondaryShieldScale: [number, number, number] = [
    shieldScale * 1.1 * TASK_SOURCE_SHIELD_SECONDARY_SCALE_MULTIPLIER,
    shieldScale * TASK_SOURCE_SHIELD_SECONDARY_SCALE_MULTIPLIER,
    shieldScale * 1.1 * TASK_SOURCE_SHIELD_SECONDARY_SCALE_MULTIPLIER,
  ]
  const primaryShieldYOffset =
    shieldHeight * shieldScale * TASK_SOURCE_SHIELD_VERTICAL_OFFSET_MULTIPLIER
  const secondaryShieldYOffset =
    shieldHeight *
    shieldScale *
    TASK_SOURCE_SHIELD_SECONDARY_SCALE_MULTIPLIER *
    TASK_SOURCE_SHIELD_VERTICAL_OFFSET_MULTIPLIER

  return (
    <group position={marker.position} userData={{ pascalExcludeFromToolConeTarget: true }}>
      <group
        position={[shieldCenter[0], shieldCenter[1] + primaryShieldYOffset, shieldCenter[2]]}
        ref={primaryShieldGroupRef}
        scale={primaryShieldScale}
      >
        <primitive object={primaryShieldModel} />
      </group>
      <group
        position={[shieldCenter[0], shieldCenter[1] - secondaryShieldYOffset, shieldCenter[2]]}
        ref={secondaryShieldGroupRef}
        scale={secondaryShieldScale}
      >
        <primitive object={secondaryShieldModel} />
      </group>
    </group>
  )
}

function hasSupportedNavigationSegment(
  graph: NavigationGraph,
  startPoint: [number, number, number],
  endPoint: [number, number, number],
  componentId: number | null,
) {
  const distance = Math.hypot(
    endPoint[0] - startPoint[0],
    endPoint[1] - startPoint[1],
    endPoint[2] - startPoint[2],
  )
  const sampleCount = Math.max(2, Math.ceil(distance / Math.max(graph.cellSize * 0.45, 0.08)))

  for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
    const t = sampleIndex / sampleCount
    const samplePoint: [number, number, number] = [
      MathUtils.lerp(startPoint[0], endPoint[0], t),
      MathUtils.lerp(startPoint[1], endPoint[1], t),
      MathUtils.lerp(startPoint[2], endPoint[2], t),
    ]

    if (!isNavigationPointSupported(graph, samplePoint, componentId)) {
      return false
    }
  }

  return true
}

function createNavigationItemMovePlanCacheKey(
  request: NavigationItemMoveRequest,
  actorStartCellIndex: number,
  graphSnapshotKey: string | null,
  buildingId: string | null,
) {
  return JSON.stringify({
    actorStartCellIndex,
    buildingId,
    graphSnapshotKey,
    itemId: request.itemId,
    sourcePosition: request.sourcePosition,
    sourceRotation: request.sourceRotation,
    targetPosition: request.finalUpdate.position ?? null,
    targetPreviewItemId: request.targetPreviewItemId ?? null,
    targetRotation: request.finalUpdate.rotation ?? null,
    visualItemId: request.visualItemId ?? null,
  })
}

function findClosestSupportedNavigationCell(
  graph: NavigationGraph,
  point: [number, number, number],
  preferredLevelId?: LevelNode['id'] | null,
  componentId?: number | null,
) {
  return measureNavigationPerf('navigation.findClosestSupportedCellMs', () => {
    const fallbackCellIndex = findClosestNavigationCell(graph, point, preferredLevelId, componentId)
    const targetLevelId = preferredLevelId ?? null
    const targetComponentId = componentId ?? null
    const [x, y, z] = point
    const gridX = Math.round((x - graph.cellSize / 2) / graph.cellSize)
    const gridY = Math.round((z - graph.cellSize / 2) / graph.cellSize)
    let bestCellIndex: number | null = null
    let bestDistanceSquared = Number.POSITIVE_INFINITY

    const updateBestCell = (cellIndex: number | null | undefined) => {
      if (cellIndex === null || cellIndex === undefined) {
        return false
      }

      const cell = graph.cells[cellIndex]
      if (!cell) {
        return false
      }

      if (targetLevelId && cell.levelId !== targetLevelId) {
        return false
      }

      const candidateComponentId = graph.componentIdByCell[cell.cellIndex] ?? null
      if (
        targetComponentId !== null &&
        targetComponentId !== undefined &&
        candidateComponentId !== targetComponentId
      ) {
        return false
      }

      if (!hasSupportedNavigationSegment(graph, cell.center, point, candidateComponentId)) {
        return false
      }

      const dx = cell.center[0] - x
      const dy = (cell.center[1] - y) * 1.5
      const dz = cell.center[2] - z
      const distanceSquared = dx * dx + dy * dy + dz * dz
      if (distanceSquared < bestDistanceSquared) {
        bestDistanceSquared = distanceSquared
        bestCellIndex = cell.cellIndex
        return true
      }

      return false
    }

    if (updateBestCell(fallbackCellIndex)) {
      return bestCellIndex
    }

    const seenCellIndices = new Set<number>()
    if (fallbackCellIndex !== null) {
      seenCellIndices.add(fallbackCellIndex)
    }

    const nearbySearchRadiusCells = 4
    for (let radius = 0; radius <= nearbySearchRadiusCells; radius += 1) {
      for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
        for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
          if (Math.max(Math.abs(offsetX), Math.abs(offsetY)) !== radius) {
            continue
          }

          const candidateIndices = graph.cellIndicesByKey.get(
            `${gridX + offsetX},${gridY + offsetY}`,
          )
          if (!candidateIndices) {
            continue
          }

          for (const candidateIndex of candidateIndices) {
            if (seenCellIndices.has(candidateIndex)) {
              continue
            }

            seenCellIndices.add(candidateIndex)
            updateBestCell(candidateIndex)
          }
        }
      }

      if (bestCellIndex !== null) {
        return bestCellIndex
      }
    }

    return fallbackCellIndex
  })
}

function findClosestCurveProgress(curve: Curve<Vector3>, target: Vector3, sampleCount: number) {
  const samplePoint = new Vector3()
  let closestT = 0
  let closestDistanceSq = Number.POSITIVE_INFINITY

  for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
    const t = sampleCount <= 0 ? 0 : sampleIndex / sampleCount
    curve.getPointAt(t, samplePoint)
    const distanceSq = samplePoint.distanceToSquared(target)
    if (distanceSq < closestDistanceSq) {
      closestDistanceSq = distanceSq
      closestT = t
    }
  }

  return closestT
}

function buildOrbitPathCurve(baseCurve: Curve<Vector3>, sampleCount: number, phaseOffset: number) {
  const orbitPoints: Vector3[] = []
  const worldUp = new Vector3(0, 1, 0)
  const fallbackSide = new Vector3(1, 0, 0)

  for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
    const t = sampleCount > 0 ? sampleIndex / sampleCount : 0
    const point = baseCurve.getPointAt(t, new Vector3())
    const tangent = baseCurve.getTangentAt(Math.min(0.999, t + 0.0001), new Vector3()).normalize()
    const side = new Vector3().crossVectors(worldUp, tangent)

    if (side.lengthSq() <= Number.EPSILON) {
      side.copy(fallbackSide)
    } else {
      side.normalize()
      fallbackSide.copy(side)
    }

    const normal = new Vector3().crossVectors(tangent, side).normalize()
    const waveAngle = t * Math.PI * 2 * PATH_RENDER_ORBIT_WAVE_COUNT + phaseOffset
    const offset = side
      .clone()
      .multiplyScalar(Math.cos(waveAngle) * PATH_RENDER_ORBIT_OFFSET)
      .add(
        normal
          .clone()
          .multiplyScalar(
            Math.sin(waveAngle) * PATH_RENDER_ORBIT_OFFSET * PATH_RENDER_ORBIT_VERTICAL_SCALE,
          ),
      )

    orbitPoints.push(point.add(offset))
  }

  return orbitPoints.length >= 2 ? new CatmullRomCurve3(orbitPoints, false, 'centripetal') : null
}

function buildRibbonPathGeometry(
  curve: Curve<Vector3>,
  segmentCount: number,
  width: number,
  twistOffset = 0,
) {
  if (segmentCount < 1 || width <= Number.EPSILON) {
    return null
  }

  const geometry = new BufferGeometry()
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const halfWidth = width * 0.5
  const worldUp = new Vector3(0, 1, 0)
  const fallbackSide = new Vector3(1, 0, 0)
  const point = new Vector3()
  const tangent = new Vector3()
  const side = new Vector3()
  const normal = new Vector3()
  const ribbonAxis = new Vector3()

  for (let sampleIndex = 0; sampleIndex <= segmentCount; sampleIndex += 1) {
    const t = segmentCount > 0 ? sampleIndex / segmentCount : 0
    curve.getPointAt(t, point)
    curve.getTangentAt(Math.min(0.999, t + 0.0001), tangent).normalize()
    side.crossVectors(worldUp, tangent)

    if (side.lengthSq() <= Number.EPSILON) {
      side.copy(fallbackSide)
    } else {
      side.normalize()
      fallbackSide.copy(side)
    }

    normal.crossVectors(tangent, side).normalize()

    const twistAngle = t * Math.PI * 2 * PATH_RENDER_ORBIT_RIBBON_TWIST_COUNT + twistOffset
    ribbonAxis
      .copy(side)
      .multiplyScalar(Math.cos(twistAngle))
      .addScaledVector(normal, Math.sin(twistAngle))
      .normalize()

    positions.push(
      point.x + ribbonAxis.x * halfWidth,
      point.y + ribbonAxis.y * halfWidth,
      point.z + ribbonAxis.z * halfWidth,
      point.x - ribbonAxis.x * halfWidth,
      point.y - ribbonAxis.y * halfWidth,
      point.z - ribbonAxis.z * halfWidth,
    )
    uvs.push(t, 0, t, 1)

    if (sampleIndex >= segmentCount) {
      continue
    }

    const baseIndex = sampleIndex * 2
    indices.push(
      baseIndex,
      baseIndex + 1,
      baseIndex + 2,
      baseIndex + 1,
      baseIndex + 3,
      baseIndex + 2,
    )
  }

  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

function buildFlatPathRibbonGeometry(curve: Curve<Vector3>, segmentCount: number, width: number) {
  if (segmentCount < 1 || width <= Number.EPSILON) {
    return null
  }

  const geometry = new BufferGeometry()
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const halfWidth = width * 0.5
  const worldUp = new Vector3(0, 1, 0)
  const fallbackSide = new Vector3(1, 0, 0)
  const point = new Vector3()
  const tangent = new Vector3()
  const side = new Vector3()

  for (let sampleIndex = 0; sampleIndex <= segmentCount; sampleIndex += 1) {
    const t = segmentCount > 0 ? sampleIndex / segmentCount : 0
    curve.getPointAt(t, point)
    curve.getTangentAt(Math.min(0.999, t + 0.0001), tangent).normalize()
    side.crossVectors(worldUp, tangent)

    if (side.lengthSq() <= Number.EPSILON) {
      side.copy(fallbackSide)
    } else {
      side.normalize()
      fallbackSide.copy(side)
    }

    positions.push(
      point.x + side.x * halfWidth,
      point.y,
      point.z + side.z * halfWidth,
      point.x - side.x * halfWidth,
      point.y,
      point.z - side.z * halfWidth,
    )
    uvs.push(t, 0, t, 1)

    if (sampleIndex >= segmentCount) {
      continue
    }

    const baseIndex = sampleIndex * 2
    indices.push(
      baseIndex,
      baseIndex + 1,
      baseIndex + 2,
      baseIndex + 1,
      baseIndex + 3,
      baseIndex + 2,
    )
  }

  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

function populateOrbitRibbonGeometry(
  geometry: BufferGeometry,
  baseCurve: Curve<Vector3>,
  segmentCount: number,
  width: number,
  orbitPhase: number,
  visualState?: OrbitRibbonVisualState,
) {
  if (segmentCount < 1 || width <= Number.EPSILON) {
    return false
  }

  const vertexCount = (segmentCount + 1) * 2
  const positionCount = vertexCount * 3
  const uvCount = vertexCount * 2
  const colorCount = vertexCount * 3
  const indexCount = segmentCount * 6
  const halfWidth = width * 0.5
  const worldUp = new Vector3(0, 1, 0)
  const fallbackSide = new Vector3(1, 0, 0)
  const point = new Vector3()
  const tangent = new Vector3()
  const side = new Vector3()
  const normal = new Vector3()
  const offsetPoint = new Vector3()
  const ribbonAxis = new Vector3()

  const currentPositionAttribute = geometry.getAttribute('position')
  const positionAttribute =
    currentPositionAttribute instanceof Float32BufferAttribute &&
    currentPositionAttribute.array.length === positionCount
      ? currentPositionAttribute
      : new Float32BufferAttribute(new Float32Array(positionCount), 3)
  const currentUvAttribute = geometry.getAttribute('uv')
  const uvAttribute =
    currentUvAttribute instanceof Float32BufferAttribute &&
    currentUvAttribute.array.length === uvCount
      ? currentUvAttribute
      : new Float32BufferAttribute(new Float32Array(uvCount), 2)
  const currentColorAttribute = geometry.getAttribute('color')
  const colorAttribute =
    currentColorAttribute instanceof Float32BufferAttribute &&
    currentColorAttribute.array.length === colorCount
      ? currentColorAttribute
      : new Float32BufferAttribute(new Float32Array(colorCount), 3)
  const positions = positionAttribute.array as Float32Array
  const uvs = uvAttribute.array as Float32Array
  const colors = colorAttribute.array as Float32Array

  for (let sampleIndex = 0; sampleIndex <= segmentCount; sampleIndex += 1) {
    const t = segmentCount > 0 ? sampleIndex / segmentCount : 0
    baseCurve.getPointAt(t, point)
    baseCurve.getTangentAt(Math.min(0.999, t + 0.0001), tangent).normalize()
    side.crossVectors(worldUp, tangent)

    if (side.lengthSq() <= Number.EPSILON) {
      side.copy(fallbackSide)
    } else {
      side.normalize()
      fallbackSide.copy(side)
    }

    normal.crossVectors(tangent, side).normalize()

    const waveAngle = t * Math.PI * 2 * PATH_RENDER_ORBIT_WAVE_COUNT + orbitPhase
    offsetPoint
      .copy(point)
      .addScaledVector(side, Math.cos(waveAngle) * PATH_RENDER_ORBIT_OFFSET)
      .addScaledVector(
        normal,
        Math.sin(waveAngle) * PATH_RENDER_ORBIT_OFFSET * PATH_RENDER_ORBIT_VERTICAL_SCALE,
      )

    const twistAngle = t * Math.PI * 2 * PATH_RENDER_ORBIT_RIBBON_TWIST_COUNT + orbitPhase
    ribbonAxis
      .copy(side)
      .multiplyScalar(Math.cos(twistAngle))
      .addScaledVector(normal, Math.sin(twistAngle))
      .normalize()

    const positionOffset = sampleIndex * 6
    positions[positionOffset] = offsetPoint.x + ribbonAxis.x * halfWidth
    positions[positionOffset + 1] = offsetPoint.y + ribbonAxis.y * halfWidth
    positions[positionOffset + 2] = offsetPoint.z + ribbonAxis.z * halfWidth
    positions[positionOffset + 3] = offsetPoint.x - ribbonAxis.x * halfWidth
    positions[positionOffset + 4] = offsetPoint.y - ribbonAxis.y * halfWidth
    positions[positionOffset + 5] = offsetPoint.z - ribbonAxis.z * halfWidth

    const uvOffset = sampleIndex * 4
    uvs[uvOffset] = t
    uvs[uvOffset + 1] = 0
    uvs[uvOffset + 2] = t
    uvs[uvOffset + 3] = 1

    const alphaWave =
      visualState === undefined
        ? 0
        : MathUtils.lerp(
            visualState.alphaMin,
            visualState.alphaMax,
            0.5 +
              0.5 *
                Math.sin(
                  t * Math.PI * 2 * visualState.alphaWaveCount -
                    visualState.time * visualState.alphaWaveSpeed +
                    visualState.alphaPhase,
                ),
          )
    const brightness = visualState === undefined ? 0 : MathUtils.clamp(alphaWave, 0, 1)
    const colorOffset = sampleIndex * 6
    colors[colorOffset] = brightness
    colors[colorOffset + 1] = brightness
    colors[colorOffset + 2] = brightness
    colors[colorOffset + 3] = brightness
    colors[colorOffset + 4] = brightness
    colors[colorOffset + 5] = brightness
  }

  if (geometry.index?.count !== indexCount) {
    const indices: number[] = []
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      const baseIndex = segmentIndex * 2
      indices.push(
        baseIndex,
        baseIndex + 1,
        baseIndex + 2,
        baseIndex + 1,
        baseIndex + 3,
        baseIndex + 2,
      )
    }
    geometry.setIndex(indices)
  }

  if (geometry.getAttribute('position') !== positionAttribute) {
    geometry.setAttribute('position', positionAttribute)
  }
  if (geometry.getAttribute('uv') !== uvAttribute) {
    geometry.setAttribute('uv', uvAttribute)
  }
  if (geometry.getAttribute('color') !== colorAttribute) {
    geometry.setAttribute('color', colorAttribute)
  }

  positionAttribute.needsUpdate = true
  uvAttribute.needsUpdate = true
  colorAttribute.needsUpdate = true
  geometry.computeBoundingSphere()
  return true
}

function buildOrbitRibbonGeometry(
  baseCurve: Curve<Vector3>,
  segmentCount: number,
  width: number,
  orbitPhase: number,
) {
  const geometry = new BufferGeometry()
  return populateOrbitRibbonGeometry(geometry, baseCurve, segmentCount, width, orbitPhase)
    ? geometry
    : null
}

function buildPathRenderSegments(
  baseCurve: Curve<Vector3>,
  tubularSegments: number,
  radius: number,
) {
  const segmentCount = Math.max(
    PATH_STATIC_PREVIEW_FADE_SEGMENT_COUNT,
    Math.ceil(tubularSegments / 2),
  )
  const curveSampleCount = Math.max(3, Math.ceil(tubularSegments / segmentCount) + 1)
  const tubeSegmentCount = Math.max(3, Math.ceil(tubularSegments / segmentCount))
  const segments: PathRenderSegment[] = []

  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    const startT = segmentIndex / segmentCount
    const endT = (segmentIndex + 1) / segmentCount
    const points: Vector3[] = []

    for (let sampleIndex = 0; sampleIndex <= curveSampleCount; sampleIndex += 1) {
      const t = MathUtils.lerp(startT, endT, sampleIndex / curveSampleCount)
      points.push(baseCurve.getPointAt(t))
    }

    if (points.length < 2) {
      continue
    }

    const segmentCurve =
      points.length >= 3
        ? new CatmullRomCurve3(points, false, 'centripetal')
        : new LineCurve3(points[0]!, points[points.length - 1]!)
    const material = new MeshBasicMaterial({
      color: new Color('#000000'),
      depthTest: false,
      depthWrite: false,
      opacity: 0,
      side: DoubleSide,
      transparent: true,
    })

    material.toneMapped = false

    segments.push({
      centerT: (startT + endT) * 0.5,
      endT,
      geometry: new TubeGeometry(
        segmentCurve,
        tubeSegmentCount,
        radius,
        PATH_RENDER_MAIN_RADIAL_SEGMENTS,
        false,
      ),
      material,
      startT,
    })
  }

  return segments
}

function updateIndexedGeometryDrawRange(
  geometry: BufferGeometry | null,
  segmentCount: number,
  clipStart: number,
  indexStridePerSegment: number,
) {
  const indexCount = geometry?.index?.count
  if (!geometry || indexCount === undefined) {
    return
  }

  const clampedStart = MathUtils.clamp(clipStart, 0, 1)
  const startSegment = Math.min(segmentCount, Math.floor(clampedStart * segmentCount))
  const startIndex = Math.min(indexCount, startSegment * indexStridePerSegment)
  geometry.setDrawRange(startIndex, Math.max(0, indexCount - startIndex))
}

function createTrajectoryThreadMaterial() {
  const visibleStart = uniform(0)
  const fadeLength = uniform(1)
  const reveal = uniform(1)
  const opaque = uniform(0)
  const fadeRange = fadeLength.max(float(0.0001))
  const fadeOpacity = uv().x.sub(visibleStart).div(fadeRange).clamp(0, 1)
  const material = new MeshBasicNodeMaterial({
    colorNode: color(PATH_RENDER_THREAD_COLOR),
    depthTest: false,
    depthWrite: false,
    opacityNode: mix(fadeOpacity, float(1), opaque).mul(reveal),
    side: DoubleSide,
    transparent: true,
    userData: {
      uFadeLength: fadeLength,
      uOpaque: opaque,
      uReveal: reveal,
      uVisibleStart: visibleStart,
    },
  })
  material.alphaTest = 0.001
  material.fog = false
  material.toneMapped = false
  return material as TrajectoryThreadMaterial
}

function configureTrajectoryMaterial(
  material: MeshBasicMaterial,
  shaderRef: { current: TrajectoryShaderHandle | null },
  options: {
    alphaEnabled?: boolean
    alphaMax?: number
    alphaMin?: number
    alphaPhase?: number
    alphaWaveCount?: number
    alphaWaveSpeed?: number
    discardHidden?: boolean
    endFadeLength?: number
    frontFadeLength: number
    programKey: string
  },
) {
  material.defines = {
    ...(material.defines ?? {}),
    USE_UV: '',
  }
  const trajectoryMaterial = material as TrajectoryMaterialHandle
  const trajectoryUniforms = trajectoryMaterial.userData.trajectoryUniforms ?? {
    uTrajectoryAlphaEnabled: { value: options.alphaEnabled ? 1 : 0 },
    uTrajectoryAlphaMax: { value: options.alphaMax ?? 1 },
    uTrajectoryAlphaMin: { value: options.alphaMin ?? 1 },
    uTrajectoryAlphaPhase: { value: options.alphaPhase ?? 0 },
    uTrajectoryAlphaWaveCount: { value: options.alphaWaveCount ?? 0 },
    uTrajectoryAlphaWaveSpeed: { value: options.alphaWaveSpeed ?? 0 },
    uTrajectoryEndFadeLength: { value: options.endFadeLength ?? 0 },
    uTrajectoryFrontFadeLength: { value: options.frontFadeLength },
    uTrajectoryReveal: { value: 0 },
    uTrajectoryTime: { value: 0 },
    uTrajectoryVisibleStart: { value: 0 },
  }
  trajectoryMaterial.userData.trajectoryUniforms = trajectoryUniforms
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTrajectoryReveal = trajectoryUniforms.uTrajectoryReveal
    shader.uniforms.uTrajectoryVisibleStart = trajectoryUniforms.uTrajectoryVisibleStart
    shader.uniforms.uTrajectoryFrontFadeLength = trajectoryUniforms.uTrajectoryFrontFadeLength
    shader.uniforms.uTrajectoryEndFadeLength = trajectoryUniforms.uTrajectoryEndFadeLength
    shader.uniforms.uTrajectoryTime = trajectoryUniforms.uTrajectoryTime
    shader.uniforms.uTrajectoryAlphaEnabled = trajectoryUniforms.uTrajectoryAlphaEnabled
    shader.uniforms.uTrajectoryAlphaMin = trajectoryUniforms.uTrajectoryAlphaMin
    shader.uniforms.uTrajectoryAlphaMax = trajectoryUniforms.uTrajectoryAlphaMax
    shader.uniforms.uTrajectoryAlphaWaveCount = trajectoryUniforms.uTrajectoryAlphaWaveCount
    shader.uniforms.uTrajectoryAlphaWaveSpeed = trajectoryUniforms.uTrajectoryAlphaWaveSpeed
    shader.uniforms.uTrajectoryAlphaPhase = trajectoryUniforms.uTrajectoryAlphaPhase

    shaderRef.current = shader as unknown as TrajectoryShaderHandle
    shader.fragmentShader =
      `
uniform float uTrajectoryReveal;
uniform float uTrajectoryVisibleStart;
uniform float uTrajectoryFrontFadeLength;
uniform float uTrajectoryEndFadeLength;
uniform float uTrajectoryTime;
uniform float uTrajectoryAlphaEnabled;
uniform float uTrajectoryAlphaMin;
uniform float uTrajectoryAlphaMax;
uniform float uTrajectoryAlphaWaveCount;
uniform float uTrajectoryAlphaWaveSpeed;
uniform float uTrajectoryAlphaPhase;
` +
      shader.fragmentShader.replace(
        '#include <alphamap_fragment>',
        `#include <alphamap_fragment>
float pathU = clamp(vUv.x, 0.0, 1.0);
float frontFade = uTrajectoryFrontFadeLength <= 0.0001
  ? (pathU >= uTrajectoryVisibleStart ? 1.0 : 0.0)
  : uTrajectoryVisibleStart >= 0.9999
  ? 0.0
  : clamp(
      (pathU - uTrajectoryVisibleStart) / max(uTrajectoryFrontFadeLength, 0.0001),
      0.0,
      1.0
    );
float endFade = uTrajectoryEndFadeLength <= 0.0001
  ? 1.0
  : 1.0 - smoothstep(max(0.0, 1.0 - uTrajectoryEndFadeLength), 1.0, pathU);
float alphaWave = mix(
  1.0,
  mix(
    uTrajectoryAlphaMin,
    uTrajectoryAlphaMax,
    0.5 + 0.5 * sin(
      pathU * 6.28318530718 * uTrajectoryAlphaWaveCount -
      uTrajectoryTime * uTrajectoryAlphaWaveSpeed +
      uTrajectoryAlphaPhase
    )
  ),
  uTrajectoryAlphaEnabled
);
float trajectoryAlpha = uTrajectoryReveal * frontFade * endFade * alphaWave;
diffuseColor.a *= trajectoryAlpha;
${options.discardHidden ? 'if (pathU < uTrajectoryVisibleStart || diffuseColor.a <= 0.001) { discard; }' : ''}
`,
      )
  }
  material.customProgramCacheKey = () => options.programKey
  return material
}

function updateTrajectoryMaterialUniforms(
  target: TrajectoryMaterialUniforms | TrajectoryShaderHandle | null,
  values: {
    endFadeLength?: number
    frontFadeLength?: number
    reveal: number
    time: number
    visibleStart: number
  },
) {
  if (!target) {
    return
  }

  const uniforms = 'uniforms' in target ? target.uniforms : target
  const revealUniform = uniforms.uTrajectoryReveal
  const visibleStartUniform = uniforms.uTrajectoryVisibleStart
  const timeUniform = uniforms.uTrajectoryTime
  const frontFadeUniform = uniforms.uTrajectoryFrontFadeLength
  const endFadeUniform = uniforms.uTrajectoryEndFadeLength

  if (revealUniform) {
    revealUniform.value = values.reveal
  }
  if (visibleStartUniform) {
    visibleStartUniform.value = values.visibleStart
  }
  if (timeUniform) {
    timeUniform.value = values.time
  }
  if (values.frontFadeLength !== undefined && frontFadeUniform) {
    frontFadeUniform.value = values.frontFadeLength
  }
  if (values.endFadeLength !== undefined && endFadeUniform) {
    endFadeUniform.value = values.endFadeLength
  }
}

function buildPathHighlightTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 16

  const context = canvas.getContext('2d')
  if (!context) {
    return null
  }

  const gradient = context.createLinearGradient(0, 0, canvas.width, 0)
  const highlightStart = Math.max(0, 0.5 - PATH_MAIN_HIGHLIGHT_LENGTH * 0.5)
  const highlightEnd = Math.min(1, 0.5 + PATH_MAIN_HIGHLIGHT_LENGTH * 0.5)
  const feather = PATH_MAIN_HIGHLIGHT_FEATHER * 0.5

  gradient.addColorStop(0, 'rgba(0,0,0,0)')
  gradient.addColorStop(Math.max(0, highlightStart - feather), 'rgba(0,0,0,0)')
  gradient.addColorStop(highlightStart, 'rgba(255,255,255,1)')
  gradient.addColorStop(highlightEnd, 'rgba(255,255,255,1)')
  gradient.addColorStop(Math.min(1, highlightEnd + feather), 'rgba(0,0,0,0)')
  gradient.addColorStop(1, 'rgba(0,0,0,0)')

  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = gradient
  context.fillRect(0, 0, canvas.width, canvas.height)

  const texture = new CanvasTexture(canvas)
  texture.wrapS = RepeatWrapping
  texture.repeat.x = 1
  texture.offset.x = 0
  texture.needsUpdate = true
  return texture
}

function getShortestAngleDelta(currentAngle: number, targetAngle: number) {
  return Math.atan2(Math.sin(targetAngle - currentAngle), Math.cos(targetAngle - currentAngle))
}

function getTurnSpeedFactor(yawDelta: number) {
  const normalizedTurn = Math.min(1, Math.abs(yawDelta) / (Math.PI * 0.9))
  return normalizedTurn >= 0.92 ? 0 : 1 - normalizedTurn * normalizedTurn
}

type RuntimeDoorAnimationState = {
  closedPosition?: [number, number, number]
  closedRotation?: [number, number, number]
  localBounds?: {
    max: [number, number, number]
    min: [number, number, number]
  }
  openPosition?: [number, number, number]
  openRotation?: [number, number, number]
  style?: 'overhead' | 'swing'
}

type ActiveDoorLeafCollisionShape = {
  doorId: string
  maxY: number
  minY: number
  polygonXZ: Array<[number, number]>
  style: 'overhead' | 'swing' | null
}

type ActiveDoorLeafCollisionShapeCacheEntry = {
  doorId: string
  localBoundsMax: [number, number, number]
  localBoundsMin: [number, number, number]
  matrixWorldElements: Float32Array
  shape: ActiveDoorLeafCollisionShape
  style: 'overhead' | 'swing' | null
}

type NavigationPathCollisionAudit = {
  blockedObstacleIds: string[]
  blockedSampleCount: number
  blockedWallIds: string[]
}

const EMPTY_NAVIGATION_PATH_COLLISION_AUDIT: NavigationPathCollisionAudit = {
  blockedObstacleIds: [],
  blockedSampleCount: 0,
  blockedWallIds: [],
}

const doorCollisionCornerScratch = Array.from({ length: 4 }, () => new Vector3())
const doorCollisionPointScratch = new Vector3()
const doorCollisionVerticalMaxScratch = new Vector3()
const doorCollisionVerticalMinScratch = new Vector3()
const activeDoorLeafCollisionShapeCache = new WeakMap<
  Object3D,
  ActiveDoorLeafCollisionShapeCacheEntry
>()

function getDoorAnimationActivity(
  leafPivot: Object3D,
  animationState: RuntimeDoorAnimationState | undefined,
) {
  const closedRotation = animationState?.closedRotation ?? [0, 0, 0]
  const closedPosition = animationState?.closedPosition ?? [
    leafPivot.position.x,
    leafPivot.position.y,
    leafPivot.position.z,
  ]

  return Math.max(
    Math.abs(leafPivot.rotation.x - closedRotation[0]!),
    Math.abs(leafPivot.rotation.y - closedRotation[1]!),
    Math.abs(leafPivot.rotation.z - closedRotation[2]!),
    Math.abs(leafPivot.position.x - closedPosition[0]!),
    Math.abs(leafPivot.position.y - closedPosition[1]!),
    Math.abs(leafPivot.position.z - closedPosition[2]!),
  )
}

function hasMatchingDoorCollisionShapeCache(
  cacheEntry: ActiveDoorLeafCollisionShapeCacheEntry,
  doorId: string,
  matrixWorldElements: ArrayLike<number>,
  animationState: RuntimeDoorAnimationState,
) {
  const localBounds = animationState.localBounds
  if (
    !localBounds ||
    cacheEntry.doorId !== doorId ||
    cacheEntry.style !== (animationState.style ?? null)
  ) {
    return false
  }

  const { max, min } = localBounds
  if (
    cacheEntry.localBoundsMin[0] !== min[0] ||
    cacheEntry.localBoundsMin[1] !== min[1] ||
    cacheEntry.localBoundsMin[2] !== min[2] ||
    cacheEntry.localBoundsMax[0] !== max[0] ||
    cacheEntry.localBoundsMax[1] !== max[1] ||
    cacheEntry.localBoundsMax[2] !== max[2]
  ) {
    return false
  }

  for (let index = 0; index < 16; index += 1) {
    if (cacheEntry.matrixWorldElements[index] !== matrixWorldElements[index]) {
      return false
    }
  }

  return true
}

function writeDoorCollisionMatrixWorld(
  target: Float32Array,
  matrixWorldElements: ArrayLike<number>,
) {
  for (let index = 0; index < 16; index += 1) {
    target[index] = matrixWorldElements[index] ?? 0
  }
}

function buildActiveDoorLeafCollisionShape(
  doorId: string,
  leafPivot: Object3D,
  animationState: RuntimeDoorAnimationState,
): ActiveDoorLeafCollisionShape | null {
  const localBounds = animationState.localBounds
  if (!localBounds) {
    return null
  }

  const { min, max } = localBounds
  const midY = (min[1] + max[1]) / 2
  const corners = [
    [min[0], midY, min[2]],
    [min[0], midY, max[2]],
    [max[0], midY, max[2]],
    [max[0], midY, min[2]],
  ] as const
  const polygonXZ: Array<[number, number]> = []

  doorCollisionVerticalMinScratch.set(0, min[1], 0).applyMatrix4(leafPivot.matrixWorld)
  doorCollisionVerticalMaxScratch.set(0, max[1], 0).applyMatrix4(leafPivot.matrixWorld)

  for (let cornerIndex = 0; cornerIndex < corners.length; cornerIndex += 1) {
    const corner = corners[cornerIndex]
    const worldPoint = doorCollisionCornerScratch[cornerIndex]
    if (!(corner && worldPoint)) {
      continue
    }

    worldPoint.set(corner[0], corner[1], corner[2]).applyMatrix4(leafPivot.matrixWorld)
    polygonXZ.push([worldPoint.x, worldPoint.z])
  }

  return {
    doorId,
    maxY: Math.max(doorCollisionVerticalMinScratch.y, doorCollisionVerticalMaxScratch.y),
    minY: Math.min(doorCollisionVerticalMinScratch.y, doorCollisionVerticalMaxScratch.y),
    polygonXZ,
    style: animationState.style ?? null,
  }
}

function getActiveDoorLeafCollisionShapes(doorIds: readonly string[]) {
  if (doorIds.length === 0) {
    return []
  }

  const activeShapes: ActiveDoorLeafCollisionShape[] = []
  const activeDoorIds = getActiveNavigationDoorIds()

  if (activeDoorIds.size === 0) {
    return activeShapes
  }

  for (const doorId of doorIds) {
    if (!activeDoorIds.has(doorId)) {
      continue
    }

    const doorRoot = sceneRegistry.nodes.get(doorId)
    const leafPivot = doorRoot?.getObjectByName('door-leaf-pivot')
    const animationState = leafPivot?.userData.navigationDoor as
      | RuntimeDoorAnimationState
      | undefined

    if (!leafPivot || !animationState?.localBounds) {
      continue
    }

    if (getDoorAnimationActivity(leafPivot, animationState) <= DOOR_COLLISION_ACTIVE_EPSILON) {
      continue
    }

    leafPivot.updateWorldMatrix(true, false)
    const matrixWorldElements = leafPivot.matrixWorld.elements
    const cachedShape = activeDoorLeafCollisionShapeCache.get(leafPivot)

    if (
      cachedShape &&
      hasMatchingDoorCollisionShapeCache(cachedShape, doorId, matrixWorldElements, animationState)
    ) {
      activeShapes.push(cachedShape.shape)
      continue
    }

    const shape = buildActiveDoorLeafCollisionShape(doorId, leafPivot, animationState)
    if (!shape) {
      continue
    }

    const nextCacheEntry: ActiveDoorLeafCollisionShapeCacheEntry = cachedShape ?? {
      doorId,
      localBoundsMax: [...animationState.localBounds.max] as [number, number, number],
      localBoundsMin: [...animationState.localBounds.min] as [number, number, number],
      matrixWorldElements: new Float32Array(16),
      shape,
      style: animationState.style ?? null,
    }

    nextCacheEntry.doorId = doorId
    nextCacheEntry.localBoundsMin[0] = animationState.localBounds.min[0]
    nextCacheEntry.localBoundsMin[1] = animationState.localBounds.min[1]
    nextCacheEntry.localBoundsMin[2] = animationState.localBounds.min[2]
    nextCacheEntry.localBoundsMax[0] = animationState.localBounds.max[0]
    nextCacheEntry.localBoundsMax[1] = animationState.localBounds.max[1]
    nextCacheEntry.localBoundsMax[2] = animationState.localBounds.max[2]
    nextCacheEntry.shape = shape
    nextCacheEntry.style = animationState.style ?? null
    writeDoorCollisionMatrixWorld(nextCacheEntry.matrixWorldElements, matrixWorldElements)
    activeDoorLeafCollisionShapeCache.set(leafPivot, nextCacheEntry)
    activeShapes.push(shape)
  }

  return activeShapes
}

function isPointInsidePolygonXZ(
  pointX: number,
  pointZ: number,
  polygonXZ: Array<[number, number]>,
) {
  let inside = false

  for (let index = 0; index < polygonXZ.length; index += 1) {
    const current = polygonXZ[index]
    const next = polygonXZ[(index + 1) % polygonXZ.length]
    if (!(current && next)) {
      continue
    }

    const intersects =
      current[1] > pointZ !== next[1] > pointZ &&
      pointX <
        ((next[0] - current[0]) * (pointZ - current[1])) / (next[1] - current[1]) + current[0]

    if (intersects) {
      inside = !inside
    }
  }

  return inside
}

function getPointToSegmentDistanceSqXZ(
  pointX: number,
  pointZ: number,
  start: [number, number],
  end: [number, number],
) {
  const segmentX = end[0] - start[0]
  const segmentZ = end[1] - start[1]
  const segmentLengthSq = segmentX * segmentX + segmentZ * segmentZ
  if (segmentLengthSq <= Number.EPSILON) {
    return (pointX - start[0]) * (pointX - start[0]) + (pointZ - start[1]) * (pointZ - start[1])
  }

  const projection = Math.max(
    0,
    Math.min(
      1,
      ((pointX - start[0]) * segmentX + (pointZ - start[1]) * segmentZ) / segmentLengthSq,
    ),
  )
  const closestX = start[0] + segmentX * projection
  const closestZ = start[1] + segmentZ * projection

  return (pointX - closestX) * (pointX - closestX) + (pointZ - closestZ) * (pointZ - closestZ)
}

function circleIntersectsDoorShapeXZ(
  pointX: number,
  pointZ: number,
  radius: number,
  shape: ActiveDoorLeafCollisionShape,
) {
  if (isPointInsidePolygonXZ(pointX, pointZ, shape.polygonXZ)) {
    return true
  }

  for (let index = 0; index < shape.polygonXZ.length; index += 1) {
    const current = shape.polygonXZ[index]
    const next = shape.polygonXZ[(index + 1) % shape.polygonXZ.length]
    if (!(current && next)) {
      continue
    }

    if (getPointToSegmentDistanceSqXZ(pointX, pointZ, current, next) <= radius * radius) {
      return true
    }
  }

  return false
}

function getBlockingDoorIdsForPoint(
  point: Vector3,
  activeDoorShapes: ActiveDoorLeafCollisionShape[],
) {
  const candidateNavigationY = point.y - PATH_CURVE_OFFSET_Y
  const blockingDoorIds: string[] = []

  for (const shape of activeDoorShapes) {
    if (
      shape.minY > candidateNavigationY + ACTOR_DOOR_COLLISION_HEIGHT ||
      shape.maxY < candidateNavigationY
    ) {
      continue
    }

    if (circleIntersectsDoorShapeXZ(point.x, point.z, ACTOR_COLLISION_RADIUS, shape)) {
      blockingDoorIds.push(shape.doorId)
    }
  }

  return blockingDoorIds
}

function getPointBlockersForCurve(
  graph: NonNullable<ReturnType<typeof buildNavigationGraph>>,
  point: Vector3,
  componentId: number | null,
) {
  const cellIndex = findClosestNavigationCell(graph, [point.x, point.y, point.z], null, componentId)
  const levelId = cellIndex !== null ? (graph.cells[cellIndex]?.levelId ?? null) : null
  return getNavigationPointBlockers(graph, [point.x, point.y, point.z], levelId)
}

function auditNavigationCurveCollisions(
  graph: NonNullable<ReturnType<typeof buildNavigationGraph>> | null,
  curve: Curve<Vector3> | null,
  componentId: number | null,
): NavigationPathCollisionAudit {
  if (!(graph && curve)) {
    return EMPTY_NAVIGATION_PATH_COLLISION_AUDIT
  }

  const sampleCount = Math.max(2, Math.ceil(curve.getLength() / PATH_SUPPORT_SAMPLE_STEP))
  const blockedWallIds = new Set<string>()
  const blockedObstacleIds = new Set<string>()
  const samplePoint = new Vector3()
  let blockedSampleCount = 0
  const collectAllBlockedSamples = NAVIGATION_AUDIT_DIAGNOSTICS_ENABLED

  for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
    curve.getPointAt(sampleIndex / sampleCount, samplePoint)
    const blockers = getPointBlockersForCurve(graph, samplePoint, componentId)
    if (blockers.wallIds.length === 0 && blockers.obstacleIds.length === 0) {
      continue
    }

    blockedSampleCount += 1
    for (const wallId of blockers.wallIds) {
      blockedWallIds.add(wallId)
    }
    for (const obstacleId of blockers.obstacleIds) {
      blockedObstacleIds.add(obstacleId)
    }

    if (!collectAllBlockedSamples) {
      break
    }
  }

  return {
    blockedObstacleIds: [...blockedObstacleIds],
    blockedSampleCount,
    blockedWallIds: [...blockedWallIds],
  }
}

function getPickableNavigationObjects() {
  return [...sceneRegistry.byType.slab, ...sceneRegistry.byType.stair]
    .map((nodeId) => sceneRegistry.nodes.get(nodeId))
    .filter((object): object is Object3D => Boolean(object))
}

function getNavigationOccluderObjects() {
  return [
    ...sceneRegistry.byType.item,
    ...sceneRegistry.byType.wall,
    ...sceneRegistry.byType.window,
    ...sceneRegistry.byType.door,
    ...sceneRegistry.byType.ceiling,
    ...sceneRegistry.byType.roof,
    ...sceneRegistry.byType['roof-segment'],
  ]
    .map((nodeId) => sceneRegistry.nodes.get(nodeId))
    .filter((object): object is Object3D => Boolean(object))
}

function objectBelongsToRoots(object: Object3D, roots: Set<Object3D>) {
  let current: Object3D | null = object
  while (current) {
    if (roots.has(current)) {
      return true
    }
    current = current.parent
  }
  return false
}

function getRepresentativeCellIndex(
  graph: NonNullable<ReturnType<typeof buildNavigationGraph>>,
  indices: number[],
) {
  if (indices.length === 0) {
    return null
  }

  let centroidX = 0
  let centroidY = 0
  let centroidZ = 0

  for (const index of indices) {
    const cell = graph.cells[index]
    if (!cell) {
      continue
    }

    centroidX += cell.center[0]
    centroidY += cell.center[1]
    centroidZ += cell.center[2]
  }

  centroidX /= indices.length
  centroidY /= indices.length
  centroidZ /= indices.length

  let bestIndex = indices[0] ?? null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const index of indices) {
    const cell = graph.cells[index]
    if (!cell) {
      continue
    }

    const distance = Math.hypot(
      cell.center[0] - centroidX,
      cell.center[1] - centroidY,
      cell.center[2] - centroidZ,
    )

    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  }

  return bestIndex
}

function getSpawnSupportScore(
  graph: NonNullable<ReturnType<typeof buildNavigationGraph>>,
  cellIndex: number,
) {
  const cell = graph.cells[cellIndex]
  if (!cell) {
    return Number.NEGATIVE_INFINITY
  }

  const componentId = graph.componentIdByCell[cellIndex] ?? -1
  let supportScore = 0

  for (
    let offsetX = -SPAWN_SUPPORT_RADIUS_CELLS;
    offsetX <= SPAWN_SUPPORT_RADIUS_CELLS;
    offsetX += 1
  ) {
    for (
      let offsetY = -SPAWN_SUPPORT_RADIUS_CELLS;
      offsetY <= SPAWN_SUPPORT_RADIUS_CELLS;
      offsetY += 1
    ) {
      const candidateIndices =
        graph.cellIndicesByKey.get(`${cell.gridX + offsetX},${cell.gridY + offsetY}`) ?? []

      for (const candidateIndex of candidateIndices) {
        if (candidateIndex === cellIndex) {
          continue
        }

        const candidate = graph.cells[candidateIndex]
        if (!candidate || candidate.levelId !== cell.levelId) {
          continue
        }

        if ((graph.componentIdByCell[candidateIndex] ?? -1) !== componentId) {
          continue
        }

        const distance = Math.hypot(offsetX, offsetY)
        supportScore += 1 / (1 + distance)
      }
    }
  }

  return supportScore
}

function getBestSpawnCellIndex(
  graph: NonNullable<ReturnType<typeof buildNavigationGraph>>,
  indices: number[],
) {
  if (indices.length === 0) {
    return null
  }

  const representativeCellIndex = getRepresentativeCellIndex(graph, indices)
  const representativeCell =
    representativeCellIndex !== null ? graph.cells[representativeCellIndex] : null

  let bestIndex = indices[0] ?? null
  let bestSupportScore = Number.NEGATIVE_INFINITY
  let bestCentroidDistance = Number.POSITIVE_INFINITY

  for (const index of indices) {
    const cell = graph.cells[index]
    if (!cell) {
      continue
    }

    const supportScore = getSpawnSupportScore(graph, index)
    const centroidDistance = representativeCell
      ? Math.hypot(
          cell.center[0] - representativeCell.center[0],
          cell.center[1] - representativeCell.center[1],
          cell.center[2] - representativeCell.center[2],
        )
      : 0

    if (
      supportScore > bestSupportScore + Number.EPSILON ||
      (Math.abs(supportScore - bestSupportScore) <= Number.EPSILON &&
        centroidDistance < bestCentroidDistance)
    ) {
      bestIndex = index
      bestSupportScore = supportScore
      bestCentroidDistance = centroidDistance
    }
  }

  return bestIndex
}

function getInitialActorCellIndex(
  graph: NonNullable<ReturnType<typeof buildNavigationGraph>>,
  preferredLevelId?: LevelNode['id'] | null,
) {
  if (preferredLevelId) {
    const levelIndices = graph.cellsByLevel.get(preferredLevelId) ?? []
    const levelIndicesByComponent = new Map<number, number[]>()

    for (const index of levelIndices) {
      const componentId = graph.componentIdByCell[index] ?? -1
      const bucket = levelIndicesByComponent.get(componentId)
      if (bucket) {
        bucket.push(index)
      } else {
        levelIndicesByComponent.set(componentId, [index])
      }
    }

    const dominantLevelComponent = [...levelIndicesByComponent.values()].sort(
      (left, right) => right.length - left.length,
    )[0]

    if (dominantLevelComponent?.length) {
      return getBestSpawnCellIndex(graph, dominantLevelComponent)
    }
  }

  const largestComponent = graph.components[graph.largestComponentId] ?? []
  return getBestSpawnCellIndex(graph, largestComponent)
}

function buildPascalTruckIntroState(
  graph: NavigationGraph,
  sceneNodes: Record<string, AnyNode>,
  preferredLevelId: LevelNode['id'] | null,
): Omit<
  PascalTruckIntroState,
  'animationElapsedMs' | 'animationStarted' | 'handoffPending' | 'revealElapsedMs' | 'revealStarted'
> | null {
  return measureNavigationPerf('navigation.pascalTruckIntroPlanMs', () => {
    const truckNodeCandidate =
      sceneNodes[PASCAL_TRUCK_ITEM_NODE_ID] ??
      Object.values(sceneNodes).find(
        (node) => node?.type === 'item' && node.asset?.id === PASCAL_TRUCK_ASSET_ID,
      )

    if (!(truckNodeCandidate?.type === 'item' && Array.isArray(truckNodeCandidate.position))) {
      return null
    }

    const truckLevelId = toLevelNodeId(resolveLevelId(truckNodeCandidate, sceneNodes))
    if (preferredLevelId && truckLevelId && truckLevelId !== preferredLevelId) {
      return null
    }

    const position = truckNodeCandidate.position as [number, number, number]
    const rotation = Array.isArray(truckNodeCandidate.rotation)
      ? (truckNodeCandidate.rotation as [number, number, number])
      : [0, 0, 0]
    const scale = Array.isArray(truckNodeCandidate.scale)
      ? (truckNodeCandidate.scale as [number, number, number])
      : [1, 1, 1]
    const candidateDimensions = truckNodeCandidate.asset?.dimensions
    const dimensions: [number, number, number] = Array.isArray(candidateDimensions)
      ? (candidateDimensions as [number, number, number])
      : ((PASCAL_TRUCK_ASSET.dimensions as [number, number, number] | undefined) ?? [
          4.42, 2.5, 2.28,
        ])

    const yaw = rotation[1] ?? 0
    const length = Math.abs(dimensions[0] * (scale[0] ?? 1))
    const rearLocalStartX =
      PASCAL_TRUCK_REAR_LOCAL_X_SIGN * (length * 0.5 - PASCAL_TRUCK_ENTRY_REAR_EDGE_INSET)
    const rearLocalEndX =
      rearLocalStartX + PASCAL_TRUCK_REAR_LOCAL_X_SIGN * PASCAL_TRUCK_ENTRY_REAR_TRAVEL_DISTANCE
    const truckRearDirection = new Vector3(PASCAL_TRUCK_REAR_LOCAL_X_SIGN, 0, 0)
      .applyAxisAngle(new Vector3(0, 1, 0), yaw)
      .normalize()
    const startOffset = new Vector3(rearLocalStartX, 0, 0).applyAxisAngle(new Vector3(0, 1, 0), yaw)
    const endOffset = new Vector3(rearLocalEndX, 0, 0).applyAxisAngle(new Vector3(0, 1, 0), yaw)
    const startPlanarPoint: [number, number, number] = [
      position[0] + startOffset.x,
      position[1],
      position[2] + startOffset.z,
    ]
    const endPlanarPoint: [number, number, number] = [
      position[0] + endOffset.x,
      position[1],
      position[2] + endOffset.z,
    ]
    const resolvedLevelId = preferredLevelId ?? truckLevelId ?? null
    const endGroundPoint: [number, number, number] = [
      endPlanarPoint[0],
      position[1],
      endPlanarPoint[2],
    ]
    const startGroundPoint: [number, number, number] = [
      startPlanarPoint[0],
      position[1],
      startPlanarPoint[2],
    ]
    const finalCellIndex =
      measureNavigationPerf('navigation.pascalTruckIntroEndCellMs', () =>
        findClosestSupportedNavigationCell(
          graph,
          endGroundPoint,
          resolvedLevelId ?? undefined,
          null,
        ),
      ) ??
      measureNavigationPerf('navigation.pascalTruckIntroStartCellMs', () =>
        findClosestSupportedNavigationCell(
          graph,
          startGroundPoint,
          resolvedLevelId ?? undefined,
          null,
        ),
      )
    const groundY =
      finalCellIndex !== null
        ? (graph.cells[finalCellIndex]?.center[1] ?? position[1])
        : position[1]

    return {
      endPosition: [endPlanarPoint[0], groundY + ACTOR_HOVER_Y, endPlanarPoint[2]],
      finalCellIndex,
      rotationY: Math.atan2(truckRearDirection.x, truckRearDirection.z),
      startPosition: [startPlanarPoint[0], groundY + ACTOR_HOVER_Y, startPlanarPoint[2]],
    }
  })
}

function findItemMoveApproach(
  graph: NavigationGraph,
  {
    dimensions,
    footprintBounds,
    levelId,
    position,
    rotation,
  }: {
    position: [number, number, number]
    rotation: [number, number, number]
    dimensions: [number, number, number]
    footprintBounds?: NavigationItemFootprintBounds | null
    levelId: string | null
  },
  componentId: number | null,
  startCellIndex: number | null,
  referenceWorld?: [number, number, number] | null,
) {
  const yaw = rotation[1] ?? 0
  const [width, , depth] = dimensions
  const [x, y, z] = position
  const forwardX = Math.sin(yaw)
  const forwardZ = Math.cos(yaw)
  const rightX = Math.cos(yaw)
  const rightZ = -Math.sin(yaw)
  const sourceBounds = footprintBounds ?? {
    maxX: width / 2,
    maxZ: depth / 2,
    minX: -width / 2,
    minZ: -depth / 2,
  }
  const expandedMinX = sourceBounds.minX - ITEM_MOVE_APPROACH_MARGIN
  const expandedMaxX = sourceBounds.maxX + ITEM_MOVE_APPROACH_MARGIN
  const expandedMinZ = sourceBounds.minZ - ITEM_MOVE_APPROACH_MARGIN
  const expandedMaxZ = sourceBounds.maxZ + ITEM_MOVE_APPROACH_MARGIN
  const expandedMidX = (expandedMinX + expandedMaxX) * 0.5
  const expandedMidZ = (expandedMinZ + expandedMaxZ) * 0.5
  const candidateLevelId = toLevelNodeId(levelId)
  const candidatePoints: Array<{ penalty: number; world: [number, number, number] }> = []
  const pathCostByCellIndex = new Map<number, number>()
  const seenCandidateKeys = new Set<string>()
  const localToWorld = (localX: number, localZ: number): [number, number, number] => [
    x + rightX * localX + forwardX * localZ,
    y,
    z + rightZ * localX + forwardZ * localZ,
  ]
  const worldToLocal = (world: [number, number, number]) => {
    const dx = world[0] - x
    const dz = world[2] - z
    return {
      x: dx * rightX + dz * rightZ,
      z: dx * forwardX + dz * forwardZ,
    }
  }
  const addCandidate = (localX: number, localZ: number, penalty: number) => {
    const clampedLocalX = MathUtils.clamp(localX, expandedMinX, expandedMaxX)
    const clampedLocalZ = MathUtils.clamp(localZ, expandedMinZ, expandedMaxZ)
    const key = `${clampedLocalX.toFixed(3)}:${clampedLocalZ.toFixed(3)}`
    if (seenCandidateKeys.has(key)) {
      return
    }

    seenCandidateKeys.add(key)
    candidatePoints.push({
      penalty,
      world: localToWorld(clampedLocalX, clampedLocalZ),
    })
  }
  const sampleEdge = (
    startLocal: [number, number],
    endLocal: [number, number],
    penalty: number,
  ) => {
    const edgeLength = Math.hypot(endLocal[0] - startLocal[0], endLocal[1] - startLocal[1])
    const stepCount = Math.max(1, Math.ceil(edgeLength / 0.24))
    for (let stepIndex = 0; stepIndex <= stepCount; stepIndex += 1) {
      const t = stepCount === 0 ? 0 : stepIndex / stepCount
      addCandidate(
        MathUtils.lerp(startLocal[0], endLocal[0], t),
        MathUtils.lerp(startLocal[1], endLocal[1], t),
        penalty,
      )
    }
  }
  const getClosestPerimeterLocalPoint = (world: [number, number, number]) => {
    const local = worldToLocal(world)
    let localX = MathUtils.clamp(local.x, expandedMinX, expandedMaxX)
    let localZ = MathUtils.clamp(local.z, expandedMinZ, expandedMaxZ)
    const insideX = local.x > expandedMinX && local.x < expandedMaxX
    const insideZ = local.z > expandedMinZ && local.z < expandedMaxZ

    if (insideX && insideZ) {
      const distanceToLeft = Math.abs(local.x - expandedMinX)
      const distanceToRight = Math.abs(expandedMaxX - local.x)
      const distanceToBack = Math.abs(local.z - expandedMinZ)
      const distanceToFront = Math.abs(expandedMaxZ - local.z)
      const nearestEdgeDistance = Math.min(
        distanceToLeft,
        distanceToRight,
        distanceToBack,
        distanceToFront,
      )

      if (nearestEdgeDistance === distanceToLeft) {
        localX = expandedMinX
      } else if (nearestEdgeDistance === distanceToRight) {
        localX = expandedMaxX
      } else if (nearestEdgeDistance === distanceToBack) {
        localZ = expandedMinZ
      } else {
        localZ = expandedMaxZ
      }
    } else if (insideX) {
      localZ = local.z < expandedMidZ ? expandedMinZ : expandedMaxZ
    } else if (insideZ) {
      localX = local.x < expandedMidX ? expandedMinX : expandedMaxX
    }

    return [localX, localZ] as [number, number]
  }

  if (referenceWorld) {
    const [closestLocalX, closestLocalZ] = getClosestPerimeterLocalPoint(referenceWorld)
    addCandidate(closestLocalX, closestLocalZ, 0)
    const tangentOffset = 0.24
    const verticalEdgeDistance = Math.min(
      Math.abs(closestLocalX - expandedMinX),
      Math.abs(expandedMaxX - closestLocalX),
    )
    const horizontalEdgeDistance = Math.min(
      Math.abs(closestLocalZ - expandedMinZ),
      Math.abs(expandedMaxZ - closestLocalZ),
    )
    if (verticalEdgeDistance <= horizontalEdgeDistance) {
      addCandidate(closestLocalX, closestLocalZ - tangentOffset, 0.01)
      addCandidate(closestLocalX, closestLocalZ + tangentOffset, 0.01)
    } else {
      addCandidate(closestLocalX - tangentOffset, closestLocalZ, 0.01)
      addCandidate(closestLocalX + tangentOffset, closestLocalZ, 0.01)
    }
  }

  sampleEdge([expandedMinX, expandedMaxZ], [expandedMaxX, expandedMaxZ], 0.02)
  sampleEdge([expandedMaxX, expandedMaxZ], [expandedMaxX, expandedMinZ], 0.02)
  sampleEdge([expandedMaxX, expandedMinZ], [expandedMinX, expandedMinZ], 0.02)
  sampleEdge([expandedMinX, expandedMinZ], [expandedMinX, expandedMaxZ], 0.02)

  let best: { approach: NavigationItemMoveApproach; score: number } | null = null

  for (const candidate of candidatePoints) {
    const cellIndex = findClosestNavigationCell(
      graph,
      candidate.world,
      candidateLevelId ?? undefined,
      componentId,
    )
    if (cellIndex === null) {
      continue
    }

    const cell = graph.cells[cellIndex]
    if (!cell) {
      continue
    }

    const snapDistance = Math.hypot(
      cell.center[0] - candidate.world[0],
      (cell.center[1] - candidate.world[1]) * 1.5,
      cell.center[2] - candidate.world[2],
    )
    if (snapDistance > ITEM_MOVE_APPROACH_MAX_SNAP_DISTANCE) {
      continue
    }

    let pathCost = pathCostByCellIndex.get(cellIndex)
    if (pathCost === undefined) {
      const pathResult =
        startCellIndex !== null ? findNavigationPath(graph, startCellIndex, cellIndex) : null
      if (!pathResult) {
        continue
      }

      pathCost = pathResult.cost
      pathCostByCellIndex.set(cellIndex, pathCost)
    }

    const referenceDistance = referenceWorld
      ? Math.hypot(
          candidate.world[0] - referenceWorld[0],
          (candidate.world[1] - referenceWorld[1]) * 1.5,
          candidate.world[2] - referenceWorld[2],
        )
      : 0
    const score = pathCost + snapDistance * 0.8 + referenceDistance * 0.05 + candidate.penalty
    if (!best || score < best.score) {
      best = {
        approach: {
          cellIndex,
          world: [...cell.center] as [number, number, number],
        },
        score,
      }
    }
  }

  return best?.approach ?? null
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

function smoothstep01(t: number) {
  const clampedT = clamp01(t)
  return clampedT * clampedT * (3 - 2 * clampedT)
}

function getLeadingTransferProgress(t: number) {
  return smoothstep01(1 - (1 - clamp01(t)) ** 2)
}

function getTrailingTransferProgress(t: number) {
  return smoothstep01(clamp01(t) ** 2)
}

function lerpNumber(start: number, end: number, t: number) {
  return start + (end - start) * t
}

function interpolateYaw(start: number, end: number, t: number) {
  return start + getShortestAngleDelta(start, end) * t
}

function quadraticBezierNumber(start: number, control: number, end: number, t: number) {
  const inverseT = 1 - t
  return inverseT * inverseT * start + 2 * inverseT * t * control + t * t * end
}

function getCarryAnchorPosition(
  actorPosition: [number, number, number],
  actorRotationY: number,
  itemDimensions: [number, number, number],
  now: number,
  wobbleEnabled: boolean,
) {
  const itemHeightOffset = Math.min(
    itemDimensions[1] * ITEM_MOVE_CARRY_ITEM_HEIGHT_SCALE,
    ITEM_MOVE_CARRY_ITEM_HEIGHT_MAX,
  )
  const carryHeight = Math.max(
    actorPosition[1] + 0.18,
    actorPosition[1] +
      ITEM_MOVE_ROBOT_HEIGHT_ESTIMATE +
      ITEM_MOVE_CARRY_HEAD_CLEARANCE +
      itemHeightOffset,
  )
  const forwardX = Math.sin(actorRotationY)
  const forwardZ = Math.cos(actorRotationY)
  const rightX = Math.cos(actorRotationY)
  const rightZ = -Math.sin(actorRotationY)
  const lateralOffset = wobbleEnabled
    ? Math.sin(now * ITEM_MOVE_CARRY_WOBBLE_SPEED) * ITEM_MOVE_CARRY_WOBBLE_LATERAL
    : 0
  const verticalOffset = wobbleEnabled
    ? Math.cos(now * ITEM_MOVE_CARRY_WOBBLE_SPEED * 0.82) * ITEM_MOVE_CARRY_WOBBLE_VERTICAL
    : 0

  return {
    position: [
      actorPosition[0] + forwardX * ITEM_MOVE_CARRY_FORWARD_DISTANCE + rightX * lateralOffset,
      carryHeight + verticalOffset,
      actorPosition[2] + forwardZ * ITEM_MOVE_CARRY_FORWARD_DISTANCE + rightZ * lateralOffset,
    ] as [number, number, number],
  }
}

function getPickupTransferTransform(
  actorPosition: [number, number, number],
  actorRotationY: number,
  itemDimensions: [number, number, number],
  sourcePosition: [number, number, number],
  sourceRotationY: number,
  now: number,
  progress: number,
) {
  const carryAnchor = getCarryAnchorPosition(
    actorPosition,
    actorRotationY,
    itemDimensions,
    now,
    false,
  )
  const horizontalProgress = getTrailingTransferProgress(progress)
  const verticalProgress = getLeadingTransferProgress(progress)
  const raisedHeight =
    Math.max(
      sourcePosition[1],
      carryAnchor.position[1],
      actorPosition[1] + ITEM_MOVE_ROBOT_HEIGHT_ESTIMATE + ITEM_MOVE_CARRY_HEAD_CLEARANCE,
    ) +
    ITEM_MOVE_PICKUP_ARC_HEIGHT +
    Math.min(itemDimensions[1] * 0.08, 0.12)

  return {
    position: [
      lerpNumber(sourcePosition[0], carryAnchor.position[0], horizontalProgress),
      quadraticBezierNumber(
        sourcePosition[1],
        raisedHeight,
        carryAnchor.position[1],
        verticalProgress,
      ),
      lerpNumber(sourcePosition[2], carryAnchor.position[2], horizontalProgress),
    ] as [number, number, number],
    rotationY: sourceRotationY,
  }
}

function getDropTransferTransform(
  startPosition: [number, number, number],
  targetPosition: [number, number, number],
  sourceRotationY: number,
  targetRotationY: number,
  progress: number,
) {
  const horizontalProgress = getLeadingTransferProgress(progress)
  const verticalProgress = getTrailingTransferProgress(progress)
  const rotationProgress = smoothstep01(progress)
  return {
    position: [
      lerpNumber(startPosition[0], targetPosition[0], horizontalProgress),
      lerpNumber(startPosition[1], targetPosition[1], verticalProgress),
      lerpNumber(startPosition[2], targetPosition[2], horizontalProgress),
    ] as [number, number, number],
    rotationY: interpolateYaw(sourceRotationY, targetRotationY, rotationProgress),
  }
}

function getRenderedFloorItemPosition(
  levelId: string | null,
  position: [number, number, number],
  itemDimensions: [number, number, number],
  rotation: [number, number, number],
) {
  const resolvedLevelId = toLevelNodeId(levelId)
  if (!resolvedLevelId) {
    return position
  }

  const slabElevation = spatialGridManager.getSlabElevationForItem(
    resolvedLevelId,
    position,
    itemDimensions,
    rotation,
  )

  return [position[0], position[1] + slabElevation, position[2]] as [number, number, number]
}

function hasNavigationApproachTargetExclusion(target: Object3D | null) {
  let current: Object3D | null = target
  while (current) {
    if (
      typeof current.userData === 'object' &&
      current.userData !== null &&
      current.userData.pascalExcludeFromToolConeTarget === true
    ) {
      return true
    }
    current = current.parent
  }
  return false
}

function extractObjectLocalFootprintBounds(
  root: Object3D | null,
): NavigationItemFootprintBounds | null {
  if (!root) {
    return null
  }

  root.updateWorldMatrix(true, true)

  const rotationOnlyWorldMatrix = new Matrix4()
  const rotationOnlyWorldInverse = new Matrix4()
  const rootWorldPosition = new Vector3()
  const rootWorldQuaternion = new Quaternion()
  root.matrixWorld.decompose(rootWorldPosition, rootWorldQuaternion, new Vector3())
  rotationOnlyWorldMatrix.compose(rootWorldPosition, rootWorldQuaternion, new Vector3(1, 1, 1))
  rotationOnlyWorldInverse.copy(rotationOnlyWorldMatrix).invert()

  const scratchLocalPoint = new Vector3()
  const scratchWorldPoint = new Vector3()
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY

  root.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh || !mesh.geometry || hasNavigationApproachTargetExclusion(mesh)) {
      return
    }

    const positionAttribute = mesh.geometry.getAttribute('position')
    if (!positionAttribute) {
      return
    }

    for (let index = 0; index < positionAttribute.count; index += 1) {
      scratchLocalPoint.fromBufferAttribute(positionAttribute, index)
      scratchWorldPoint.copy(scratchLocalPoint).applyMatrix4(mesh.matrixWorld)
      scratchLocalPoint.copy(scratchWorldPoint).applyMatrix4(rotationOnlyWorldInverse)

      if (!Number.isFinite(scratchLocalPoint.x) || !Number.isFinite(scratchLocalPoint.z)) {
        continue
      }

      minX = Math.min(minX, scratchLocalPoint.x)
      maxX = Math.max(maxX, scratchLocalPoint.x)
      minZ = Math.min(minZ, scratchLocalPoint.z)
      maxZ = Math.max(maxZ, scratchLocalPoint.z)
    }
  })

  if (![minX, maxX, minZ, maxZ].every((value) => Number.isFinite(value))) {
    return null
  }

  return {
    maxX,
    maxZ,
    minX,
    minZ,
  }
}

function isTransientNavigationNode(node: AnyNode | null | undefined) {
  const metadata =
    typeof node?.metadata === 'object' && node.metadata !== null && !Array.isArray(node.metadata)
      ? (node.metadata as Record<string, unknown>)
      : null
  return metadata?.isTransient === true
}

function buildNavigationSceneSnapshot(
  nodes: Record<string, AnyNode>,
  rootNodeIds: string[],
  ignoredNodeIds: string[] = [],
): {
  key: string
  nodes: Record<string, AnyNode>
  rootNodeIds: string[]
} {
  const ignoredNodeIdSet = new Set(ignoredNodeIds)
  const transientNodeIds = new Set<string>()

  for (const [nodeId, node] of Object.entries(nodes)) {
    if (ignoredNodeIdSet.has(nodeId) || isTransientNavigationNode(node)) {
      transientNodeIds.add(nodeId)
    }
  }

  const snapshotNodes: Record<string, AnyNode> = {}
  const orderedSnapshotNodes: AnyNode[] = []
  const orderedSnapshotKeyNodes: AnyNode[] = []

  const getSnapshotKeyNode = (node: AnyNode) => {
    if (!('metadata' in node)) {
      return node
    }

    const { metadata: _metadata, ...snapshotKeyNode } = node
    return snapshotKeyNode as AnyNode
  }

  for (const nodeId of Object.keys(nodes).sort()) {
    if (transientNodeIds.has(nodeId)) {
      continue
    }

    const node = nodes[nodeId]
    if (!node) {
      continue
    }

    let snapshotNode = node
    const childIds = (node as { children?: string[] }).children
    if (Array.isArray(childIds)) {
      const filteredChildren = childIds.filter((childId) => !transientNodeIds.has(childId))
      if (filteredChildren.length !== childIds.length) {
        snapshotNode = { ...node, children: filteredChildren } as AnyNode
      }
    }

    snapshotNodes[nodeId] = snapshotNode
    orderedSnapshotNodes.push(snapshotNode)
    orderedSnapshotKeyNodes.push(getSnapshotKeyNode(snapshotNode))
  }

  const snapshotRootNodeIds = rootNodeIds.filter((nodeId) => !transientNodeIds.has(nodeId))
  const effectiveIgnoredNodeIds = [...ignoredNodeIdSet]
    .filter((nodeId) => {
      const node = nodes[nodeId]
      return Boolean(node) && !isTransientNavigationNode(node)
    })
    .sort()

  return {
    key: JSON.stringify({
      ignoredNodeIds: effectiveIgnoredNodeIds,
      nodes: orderedSnapshotKeyNodes,
      rootNodeIds: snapshotRootNodeIds,
    }),
    nodes: snapshotNodes,
    rootNodeIds: snapshotRootNodeIds,
  }
}

export function NavigationSystem() {
  const {
    activeTaskId,
    advanceTaskQueue,
    enabled,
    followRobotEnabled,
    itemDeleteRequest,
    itemMoveControllers,
    itemMoveLocked,
    itemMoveRequest,
    itemRepairRequest,
    queueRestartToken,
    robotMode,
    removeQueuedTask,
    requestItemDelete,
    requestItemMove,
    requestItemRepair,
    setActorAvailable,
    setActorWorldPosition,
    setItemMoveLocked,
    taskQueue,
    taskLoopSettledToken,
    taskLoopToken,
    walkableOverlayVisible,
  } = useNavigation(
    useShallow((state) => ({
      activeTaskId: state.activeTaskId,
      advanceTaskQueue: state.advanceTaskQueue,
      enabled: state.enabled,
      followRobotEnabled: state.followRobotEnabled,
      itemDeleteRequest: state.itemDeleteRequest,
      itemMoveControllers: state.itemMoveControllers,
      itemMoveLocked: state.itemMoveLocked,
      itemMoveRequest: state.itemMoveRequest,
      itemRepairRequest: state.itemRepairRequest,
      queueRestartToken: state.queueRestartToken,
      robotMode: state.robotMode,
      removeQueuedTask: state.removeQueuedTask,
      requestItemDelete: state.requestItemDelete,
      requestItemMove: state.requestItemMove,
      requestItemRepair: state.requestItemRepair,
      setActorAvailable: state.setActorAvailable,
      setActorWorldPosition: state.setActorWorldPosition,
      setItemMoveLocked: state.setItemMoveLocked,
      taskQueue: state.taskQueue,
      taskLoopSettledToken: state.taskLoopSettledToken,
      taskLoopToken: state.taskLoopToken,
      walkableOverlayVisible: state.walkableOverlayVisible,
    })),
  )
  const headItemMoveController = useMemo(() => {
    if (!itemMoveRequest) {
      return null
    }

    // Task-mode execution must not depend on live move-tool component state.
    // Once a task is queued, run it from the frozen request payload so later
    // queued tasks cannot inherit stale controller closures from earlier items.
    if (robotMode === 'task') {
      return createNavigationItemMoveFallbackController(itemMoveRequest)
    }

    return (
      itemMoveControllers[itemMoveRequest.itemId] ??
      createNavigationItemMoveFallbackController(itemMoveRequest)
    )
  }, [itemMoveControllers, itemMoveRequest, robotMode])
  const activeToolConeColor = itemDeleteRequest
    ? NAVIGATION_TOOL_CONE_DELETE_COLOR
    : itemRepairRequest
      ? NAVIGATION_TOOL_CONE_REPAIR_COLOR
      : itemMoveRequest
        ? isNavigationCopyItemMoveRequest(itemMoveRequest)
          ? NAVIGATION_TOOL_CONE_COPY_COLOR
          : NAVIGATION_TOOL_CONE_MOVE_COLOR
        : NAVIGATION_TOOL_CONE_MOVE_COLOR
  const itemMoveControllerCount = useMemo(
    () => Object.keys(itemMoveControllers).length,
    [itemMoveControllers],
  )
  const movingItemNode = useEditor((state) =>
    state.movingNode?.type === 'item' ? (state.movingNode as ItemNode) : null,
  )
  const movingItemId = movingItemNode?.id ?? null
  const selection = useViewer((state) => state.selection)
  const itemMovePreview = useNavigationVisuals((state) => state.itemMovePreview)
  const cameraDragging = useViewer((state) => state.cameraDragging)
  const navigationPostWarmupRequestToken = useNavigationVisuals(
    (state) => state.navigationPostWarmupRequestToken,
  )
  const navigationPostWarmupCompletedToken = useNavigationVisuals(
    (state) => state.navigationPostWarmupCompletedToken,
  )
  const { camera, gl, scene, set: setThreeState } = useThree()
  const canvasSize = useThree((state) => state.size)
  const sceneState = useScene(
    useShallow((state) => ({
      nodes: state.nodes as Record<string, any>,
      rootNodeIds: state.rootNodeIds as string[],
    })),
  )
  const activeDoorCollisionCandidateIds = useMemo(
    () =>
      Object.values(sceneState.nodes)
        .filter(
          (
            node,
          ): node is
            | { asset?: { category?: string }; id: string; type: 'door' }
            | { asset?: { category?: string }; id: string; type: 'item' } =>
            node?.type === 'door' || (node?.type === 'item' && node.asset?.category === 'door'),
        )
        .map((node) => node.id),
    [sceneState.nodes],
  )

  const actorPointRef = useRef(new Vector3())
  const actorTangentRef = useRef(new Vector3())
  const actorTangentAheadRef = useRef(new Vector3())
  const actorFallbackPointRef = useRef(new Vector3())
  const navigationRuntimeActive = enabled || walkableOverlayVisible
  const [releasedNavigationItemId, setReleasedNavigationItemId] = useState<string | null>(null)
  const [pendingTaskGraphSyncKey, setPendingTaskGraphSyncKey] = useState<string | null>(null)
  const navigationSceneSnapshotCacheRef = useRef<{
    ignoredItemId: string | null
    nodes: Record<string, AnyNode>
    rootNodeIds: string[]
    snapshot: NavigationSceneSnapshot
  } | null>(null)
  const stableNavigationSceneSnapshotRef = useRef<NavigationSceneSnapshot | null>(null)
  const navigationIgnoredItemId = releasedNavigationItemId
  const itemMovePreviewActive = Boolean(movingItemId && !itemMoveLocked)

  const navigationSceneSnapshot = useMemo(() => {
    const buildCachedSnapshot = () => {
      const cachedSnapshot = navigationSceneSnapshotCacheRef.current
      if (
        cachedSnapshot &&
        cachedSnapshot.nodes === sceneState.nodes &&
        cachedSnapshot.rootNodeIds === sceneState.rootNodeIds &&
        cachedSnapshot.ignoredItemId === navigationIgnoredItemId
      ) {
        return cachedSnapshot.snapshot
      }

      const nextSnapshot = measureNavigationPerf('navigation.sceneSnapshotMs', () =>
        buildNavigationSceneSnapshot(
          sceneState.nodes,
          sceneState.rootNodeIds,
          navigationIgnoredItemId ? [navigationIgnoredItemId] : [],
        ),
      )
      navigationSceneSnapshotCacheRef.current = {
        ignoredItemId: navigationIgnoredItemId,
        nodes: sceneState.nodes,
        rootNodeIds: sceneState.rootNodeIds,
        snapshot: nextSnapshot,
      }
      return nextSnapshot
    }

    if (itemMovePreviewActive && stableNavigationSceneSnapshotRef.current) {
      return stableNavigationSceneSnapshotRef.current
    }

    const nextSnapshot = buildCachedSnapshot()
    if (!itemMovePreviewActive) {
      stableNavigationSceneSnapshotRef.current = nextSnapshot
    }
    return nextSnapshot
  }, [itemMovePreviewActive, navigationIgnoredItemId, sceneState.nodes, sceneState.rootNodeIds])
  const graphCacheRef = useRef(
    new Map<
      string,
      {
        graph: NavigationGraph | null
      }
    >(),
  )
  const navigationGraphWarmWorkerRef = useRef<Worker | null>(null)
  const navigationGraphWarmRequestIdRef = useRef(0)
  const navigationGraphWarmPendingKeyRef = useRef<string | null>(null)
  const navigationGraphWarmPendingRequestsRef = useRef(
    new Map<number, { cacheKey: string; requestedAtMs: number }>(),
  )
  const prewarmedGraphCacheKeyRef = useRef<string | null>(null)
  const [prewarmedGraphState, setPrewarmedGraphState] = useState<NavigationGraph | null>(null)
  const [prewarmedGraphStateKey, setPrewarmedGraphStateKey] = useState<string | null>(null)
  const getNavigationGraphCacheKey = useCallback(
    (snapshot: NavigationSceneSnapshot) => {
      const buildingId = selection.buildingId ?? null
      return `${buildingId ?? 'null'}::${snapshot.key}`
    },
    [selection.buildingId],
  )
  const getCachedNavigationGraphForSnapshot = useCallback(
    (snapshot: NavigationSceneSnapshot, perfMetricName: string) => {
      const graphCacheKey = getNavigationGraphCacheKey(snapshot)
      const cachedGraph = graphCacheRef.current.get(graphCacheKey)
      if (cachedGraph) {
        graphCacheRef.current.delete(graphCacheKey)
        graphCacheRef.current.set(graphCacheKey, cachedGraph)
        return cachedGraph.graph
      }

      const nextGraph = measureNavigationPerf(perfMetricName, () =>
        buildNavigationGraph(snapshot.nodes, snapshot.rootNodeIds, selection.buildingId),
      )
      graphCacheRef.current.set(graphCacheKey, {
        graph: nextGraph,
      })
      while (graphCacheRef.current.size > NAVIGATION_GRAPH_CACHE_MAX_ENTRIES) {
        const oldestKey = graphCacheRef.current.keys().next().value
        if (oldestKey === undefined) {
          break
        }
        graphCacheRef.current.delete(oldestKey)
      }

      return nextGraph
    },
    [getNavigationGraphCacheKey, selection.buildingId],
  )
  useEffect(() => {
    if (typeof Worker === 'undefined') {
      navigationGraphWarmWorkerRef.current = null
      return
    }

    const worker = new Worker(
      new URL('../../workers/navigation-graph-worker.ts', import.meta.url),
      {
        type: 'module',
      },
    )
    worker.onmessage = (event) => {
      const data = event.data as {
        error?: string
        graph?: NavigationGraph | null
        requestId?: number
      } | null
      const requestId = typeof data?.requestId === 'number' ? data.requestId : null
      if (requestId === null) {
        return
      }

      const pendingRequest = navigationGraphWarmPendingRequestsRef.current.get(requestId)
      if (!pendingRequest) {
        return
      }

      navigationGraphWarmPendingRequestsRef.current.delete(requestId)
      if (navigationGraphWarmPendingKeyRef.current === pendingRequest.cacheKey) {
        navigationGraphWarmPendingKeyRef.current = null
      }

      if (typeof data?.error === 'string' && data.error.length > 0) {
        recordNavigationPerfMark('navigation.graphWarmWorkerError', {
          cacheKey: pendingRequest.cacheKey,
          error: data.error,
        })
        return
      }

      const nextGraph = data?.graph ?? null
      graphCacheRef.current.set(pendingRequest.cacheKey, {
        graph: nextGraph,
      })
      while (graphCacheRef.current.size > NAVIGATION_GRAPH_CACHE_MAX_ENTRIES) {
        const oldestKey = graphCacheRef.current.keys().next().value
        if (oldestKey === undefined) {
          break
        }
        graphCacheRef.current.delete(oldestKey)
      }

      recordNavigationPerfSample(
        'navigation.graphWarmWorkerRoundTripMs',
        performance.now() - pendingRequest.requestedAtMs,
        {
          cacheKey: pendingRequest.cacheKey,
        },
      )

      if (prewarmedGraphCacheKeyRef.current === pendingRequest.cacheKey) {
        setPrewarmedGraphState(nextGraph)
        setPrewarmedGraphStateKey(pendingRequest.cacheKey)
      }
    }
    navigationGraphWarmWorkerRef.current = worker

    return () => {
      navigationGraphWarmPendingRequestsRef.current.clear()
      navigationGraphWarmPendingKeyRef.current = null
      navigationGraphWarmWorkerRef.current = null
      worker.terminate()
    }
  }, [])

  const shouldSyncPrewarmGraph =
    prewarmedGraphState === null ||
    itemMovePreviewActive ||
    itemMoveRequest !== null ||
    itemDeleteRequest !== null ||
    itemRepairRequest !== null

  useEffect(() => {
    if (!navigationSceneSnapshot) {
      navigationGraphWarmPendingKeyRef.current = null
      navigationGraphWarmPendingRequestsRef.current.clear()
      prewarmedGraphCacheKeyRef.current = null
      setPrewarmedGraphState(null)
      setPrewarmedGraphStateKey(null)
      return
    }

    const nextCacheKey = getNavigationGraphCacheKey(navigationSceneSnapshot)
    const cachedGraph = graphCacheRef.current.get(nextCacheKey)?.graph ?? null
    if (cachedGraph) {
      navigationGraphWarmPendingKeyRef.current = null
      prewarmedGraphCacheKeyRef.current = nextCacheKey
      setPrewarmedGraphState(cachedGraph)
      setPrewarmedGraphStateKey(nextCacheKey)
      return
    }

    if (shouldSyncPrewarmGraph || !navigationGraphWarmWorkerRef.current) {
      const nextGraph = getCachedNavigationGraphForSnapshot(
        navigationSceneSnapshot,
        'navigation.graphWarmBuildMs',
      )
      navigationGraphWarmPendingKeyRef.current = null
      prewarmedGraphCacheKeyRef.current = nextCacheKey
      setPrewarmedGraphState(nextGraph)
      setPrewarmedGraphStateKey(nextCacheKey)
      return
    }

    if (navigationGraphWarmPendingKeyRef.current === nextCacheKey) {
      return
    }

    const requestId = ++navigationGraphWarmRequestIdRef.current
    navigationGraphWarmPendingKeyRef.current = nextCacheKey
    navigationGraphWarmPendingRequestsRef.current.set(requestId, {
      cacheKey: nextCacheKey,
      requestedAtMs: performance.now(),
    })
    recordNavigationPerfMark('navigation.graphWarmWorkerRequest', {
      cacheKey: nextCacheKey,
      requestId,
    })
    navigationGraphWarmWorkerRef.current.postMessage({
      buildingId: selection.buildingId ?? null,
      nodes: navigationSceneSnapshot.nodes,
      requestId,
      rootNodeIds: navigationSceneSnapshot.rootNodeIds,
    })
    prewarmedGraphCacheKeyRef.current = nextCacheKey
  }, [
    getCachedNavigationGraphForSnapshot,
    getNavigationGraphCacheKey,
    navigationSceneSnapshot,
    shouldSyncPrewarmGraph,
    selection.buildingId,
  ])

  const prewarmedGraph = prewarmedGraphState
  const currentNavigationGraphCacheKey = navigationSceneSnapshot
    ? getNavigationGraphCacheKey(navigationSceneSnapshot)
    : null
  const navigationGraphCurrent =
    currentNavigationGraphCacheKey !== null &&
    prewarmedGraphStateKey !== null &&
    prewarmedGraphStateKey === currentNavigationGraphCacheKey
  const taskQueueGraphSettled =
    robotMode !== 'task' ||
    pendingTaskGraphSyncKey === null ||
    (navigationGraphCurrent && navigationSceneSnapshot?.key === pendingTaskGraphSyncKey)
  const taskLoopSceneSettled = robotMode !== 'task' || taskLoopSettledToken === taskLoopToken
  const taskQueuePlanningReady = taskQueueGraphSettled && taskLoopSceneSettled
  const previousTaskQueuePlanningReadyRef = useRef(taskQueuePlanningReady)
  const graph = useMemo(
    () => (navigationRuntimeActive ? prewarmedGraph : null),
    [navigationRuntimeActive, prewarmedGraph],
  )
  const buildItemMoveTargetSceneSnapshot = useCallback(
    (request: NavigationItemMoveRequest) =>
      measureNavigationPerf('navigation.itemMoveTargetSceneSnapshotMs', () => {
        const sourceNode = sceneState.nodes[request.itemId]
        const targetPosition = request.finalUpdate.position
        const targetRotation = request.finalUpdate.rotation

        if (
          sourceNode?.type !== 'item' ||
          !targetPosition ||
          !targetRotation ||
          !Array.isArray(targetPosition) ||
          !Array.isArray(targetRotation)
        ) {
          return buildNavigationSceneSnapshot(sceneState.nodes, sceneState.rootNodeIds)
        }

        const snapshotNodes: Record<string, AnyNode> = { ...sceneState.nodes }
        const targetParentId =
          typeof request.finalUpdate.parentId === 'string'
            ? request.finalUpdate.parentId
            : (request.levelId ?? sourceNode.parentId)

        const updateParentChildren = (
          parentId: string | null | undefined,
          transform: (children: string[]) => string[],
        ) => {
          if (!parentId) {
            return
          }

          const parentNode = snapshotNodes[parentId]
          const parentChildren = (parentNode as { children?: string[] } | undefined)?.children
          if (!(parentNode && Array.isArray(parentChildren))) {
            return
          }

          snapshotNodes[parentId] = {
            ...parentNode,
            children: transform(parentChildren),
          } as AnyNode
        }

        if (isNavigationCopyItemMoveRequest(request)) {
          const plannedCopyId = `__navigation-planned-copy__:${request.itemId}` as ItemNode['id']
          snapshotNodes[plannedCopyId] = {
            ...sourceNode,
            id: plannedCopyId,
            metadata: setItemMoveVisualMetadata(sourceNode.metadata, null) as ItemNode['metadata'],
            parentId: targetParentId,
            position: [...targetPosition] as [number, number, number],
            rotation: [...targetRotation] as [number, number, number],
          } as ItemNode as AnyNode

          updateParentChildren(targetParentId, (children) =>
            children.includes(plannedCopyId) ? children : [...children, plannedCopyId],
          )
        } else {
          const sourceParentId = sourceNode.parentId
          snapshotNodes[sourceNode.id] = {
            ...sourceNode,
            metadata: setItemMoveVisualMetadata(sourceNode.metadata, null) as ItemNode['metadata'],
            parentId: targetParentId,
            position: [...targetPosition] as [number, number, number],
            rotation: [...targetRotation] as [number, number, number],
          } as ItemNode as AnyNode

          if (sourceParentId !== targetParentId) {
            updateParentChildren(sourceParentId, (children) =>
              children.filter((childId) => childId !== sourceNode.id),
            )
            updateParentChildren(targetParentId, (children) =>
              children.includes(sourceNode.id) ? children : [...children, sourceNode.id],
            )
          }
        }

        return buildNavigationSceneSnapshot(snapshotNodes, sceneState.rootNodeIds)
      }),
    [sceneState.nodes, sceneState.rootNodeIds],
  )
  const cacheItemMovePreviewPlan = useCallback((plan: NavigationItemMovePreviewPlan) => {
    const previewPlanCache = itemMovePreviewPlanCacheRef.current
    previewPlanCache.delete(plan.cacheKey)
    previewPlanCache.set(plan.cacheKey, plan)
    while (previewPlanCache.size > ITEM_MOVE_PREVIEW_PLAN_CACHE_MAX_ENTRIES) {
      const oldestKey = previewPlanCache.keys().next().value
      if (oldestKey === undefined) {
        break
      }
      previewPlanCache.delete(oldestKey)
    }
  }, [])
  const cancelItemMovePreviewPlanWarmup = useCallback(() => {
    if (itemMovePreviewPlanWarmTimeoutRef.current !== null) {
      window.clearTimeout(itemMovePreviewPlanWarmTimeoutRef.current)
      itemMovePreviewPlanWarmTimeoutRef.current = null
    }
  }, [])
  const resolveItemMovePlan = useCallback(
    (
      request: NavigationItemMoveRequest,
      actorStartCellIndex: number,
      actorNavigationPoint: [number, number, number] | null,
      actorComponentIdOverride: number | null,
      {
        recordFallbackMeta = true,
        targetGraphPerfMetricName = 'navigation.itemMoveTargetGraphBuildMs',
      }: {
        recordFallbackMeta?: boolean
        targetGraphPerfMetricName?: string
      } = {},
    ): ResolvedNavigationItemMovePlan | null => {
      if (!graph) {
        return null
      }

      const nearestLiveActorCellIndexWithoutComponentFilter =
        actorNavigationPoint !== null
          ? findClosestNavigationCell(
              graph,
              actorNavigationPoint,
              selection.levelId ?? toLevelNodeId(request.levelId) ?? undefined,
              null,
            )
          : null

      const targetPosition = request.finalUpdate.position
      const targetRotation = request.finalUpdate.rotation ?? request.sourceRotation
      if (!targetPosition || !targetRotation) {
        return null
      }

      const sourceFootprintBounds = extractObjectLocalFootprintBounds(
        sceneRegistry.nodes.get(request.itemId) ?? null,
      )

      const sourceApproach = findItemMoveApproach(
        graph,
        {
          dimensions: request.itemDimensions,
          footprintBounds: sourceFootprintBounds,
          levelId: request.levelId,
          position: request.sourcePosition,
          rotation: request.sourceRotation,
        },
        actorComponentIdOverride,
        actorStartCellIndex,
        actorNavigationPoint,
      )
      if (!sourceApproach) {
        return null
      }

      const sourcePath = findNavigationPath(graph, actorStartCellIndex, sourceApproach.cellIndex)
      if (!sourcePath) {
        return null
      }

      const targetPlanningSnapshot = buildItemMoveTargetSceneSnapshot(request)
      const targetPlanningGraph = getCachedNavigationGraphForSnapshot(
        targetPlanningSnapshot,
        targetGraphPerfMetricName,
      )
      if (!targetPlanningGraph) {
        return null
      }

      const releasedSourceCellIndex = findClosestNavigationCell(
        targetPlanningGraph,
        sourceApproach.world,
        toLevelNodeId(request.levelId),
        null,
      )
      if (releasedSourceCellIndex === null) {
        return null
      }

      const targetApproach = findItemMoveApproach(
        targetPlanningGraph,
        {
          dimensions: request.itemDimensions,
          footprintBounds: sourceFootprintBounds,
          levelId: request.levelId,
          position: targetPosition,
          rotation: targetRotation,
        },
        null,
        releasedSourceCellIndex,
        sourceApproach.world,
      )
      if (!targetApproach) {
        return null
      }

      const targetPath = findNavigationPath(
        targetPlanningGraph,
        releasedSourceCellIndex,
        targetApproach.cellIndex,
      )
      if (!targetPath) {
        return null
      }

      const usedDerivedTargetGraph = false
      let usedTargetGraphFallback = false

      let exitPath: NavigationPrecomputedExitPath | null = null
      const exitPlan = pascalTruckIntroPlanRef.current
      if (exitPlan && targetApproach && targetPlanningGraph) {
        const exitTargetWorldPosition: [number, number, number] = [
          exitPlan.endPosition[0],
          exitPlan.endPosition[1] - ACTOR_HOVER_Y,
          exitPlan.endPosition[2],
        ]
        const exitTargetLevelId =
          exitPlan.finalCellIndex !== null
            ? (toLevelNodeId(targetPlanningGraph.cells[exitPlan.finalCellIndex]?.levelId) ??
              selection.levelId ??
              null)
            : (selection.levelId ?? null)
        const exitTargetCellIndex = findClosestNavigationCell(
          targetPlanningGraph,
          exitTargetWorldPosition,
          exitTargetLevelId ?? undefined,
          null,
        )
        if (exitTargetCellIndex !== null) {
          const exitPathResult = findNavigationPath(
            targetPlanningGraph,
            targetApproach.cellIndex,
            exitTargetCellIndex,
          )
          if (exitPathResult) {
            exitPath = {
              destinationCellIndex: exitTargetCellIndex,
              pathResult: exitPathResult,
              planningGraph: targetPlanningGraph,
              targetWorldPosition: exitTargetWorldPosition,
            }
          }
        }
      }

      if (recordFallbackMeta) {
        mergeNavigationPerfMeta({
          navigationItemMoveUsedDerivedTargetGraph: usedDerivedTargetGraph,
          navigationItemMoveUsedTargetGraphFallback: usedTargetGraphFallback,
        })
      }

      lastItemMovePlanDebugRef.current = {
        actorComponentIdOverride,
        actorNavigationPoint,
        actorStartCellIndexWithoutComponentFilter: nearestLiveActorCellIndexWithoutComponentFilter,
        actorStartCellCenter: graph.cells[actorStartCellIndex]?.center ?? null,
        actorStartCellIndex,
        exitPath:
          exitPath === null
            ? null
            : {
                destinationCellCenter:
                  exitPath.destinationCellIndex !== null
                    ? (exitPath.planningGraph.cells[exitPath.destinationCellIndex]?.center ?? null)
                    : null,
                destinationCellIndex: exitPath.destinationCellIndex,
                indices: [...exitPath.pathResult.indices],
                planningGraphCellCount: exitPath.planningGraph.cells.length,
                targetWorldPosition: exitPath.targetWorldPosition,
              },
        graphCellCount: graph.cells.length,
        request: {
          finalPosition: targetPosition,
          finalRotation: targetRotation,
          itemId: request.itemId,
          levelId: request.levelId,
          sourcePosition: request.sourcePosition,
          sourceRotation: request.sourceRotation,
        },
        releasedSourceCellCenter:
          targetPlanningGraph.cells[releasedSourceCellIndex]?.center ?? null,
        releasedSourceCellIndex,
        sourceApproach: {
          cellCenter: graph.cells[sourceApproach.cellIndex]?.center ?? null,
          cellIndex: sourceApproach.cellIndex,
          world: sourceApproach.world,
        },
        sourcePath: {
          indices: [...sourcePath.indices],
          length: sourcePath.indices.length,
        },
        targetApproach: {
          cellCenter: targetPlanningGraph.cells[targetApproach.cellIndex]?.center ?? null,
          cellIndex: targetApproach.cellIndex,
          world: targetApproach.world,
        },
        targetPath: {
          indices: [...targetPath.indices],
          length: targetPath.indices.length,
        },
        liveGraphCacheKey: prewarmedGraphStateKey,
        liveGraphCurrent: navigationGraphCurrent,
        navigationSceneSnapshotKey: navigationSceneSnapshot?.key ?? null,
        targetPlanningGraphCellCount: targetPlanningGraph.cells.length,
        targetPlanningSnapshotKey: targetPlanningSnapshot.key,
        usedDerivedTargetGraph,
        usedTargetGraphFallback,
      }

      return {
        exitPath,
        sourceApproach,
        sourcePath,
        targetApproach,
        targetPath,
        targetPlanningGraph,
      }
    },
    [
      buildItemMoveTargetSceneSnapshot,
      getCachedNavigationGraphForSnapshot,
      graph,
      navigationGraphCurrent,
      navigationSceneSnapshot?.key,
      prewarmedGraphStateKey,
      selection.levelId,
    ],
  )

  useEffect(() => {
    if (previousTaskQueuePlanningReadyRef.current === taskQueuePlanningReady) {
      return
    }

    previousTaskQueuePlanningReadyRef.current = taskQueuePlanningReady
    appendTaskModeTrace('navigation.taskQueuePlanningReadyChanged', {
      pendingTaskGraphSyncKey,
      taskLoopSceneSettled,
      taskQueueGraphSettled,
      taskQueuePlanningReady,
    })
  }, [
    pendingTaskGraphSyncKey,
    taskLoopSceneSettled,
    taskQueueGraphSettled,
    taskQueuePlanningReady,
  ])

  useEffect(() => {
    if (!enabled || robotMode !== 'task') {
      taskLoopBaselineSnapshotKeyRef.current = null
      pendingTaskLoopGraphSyncTokenRef.current = null
      setPendingTaskGraphSyncKey(null)
      return
    }

    if (taskLoopBaselineSnapshotKeyRef.current === null && navigationSceneSnapshot?.key) {
      taskLoopBaselineSnapshotKeyRef.current = navigationSceneSnapshot.key
    }

    if (pendingTaskGraphSyncKey !== null && navigationGraphCurrent) {
      setPendingTaskGraphSyncKey(null)
    }
  }, [
    enabled,
    navigationGraphCurrent,
    navigationSceneSnapshot?.key,
    pendingTaskGraphSyncKey,
    robotMode,
  ])

  useEffect(() => {
    if (taskLoopToken === taskLoopSettledToken) {
      return
    }

    if (!enabled || robotMode !== 'task') {
      useNavigation.getState().setTaskLoopSettledToken(taskLoopToken)
      return
    }

    const baselineSnapshotKey =
      taskLoopBaselineSnapshotKeyRef.current ?? navigationSceneSnapshot?.key ?? null
    if (!baselineSnapshotKey) {
      return
    }

    taskLoopBaselineSnapshotKeyRef.current = baselineSnapshotKey
    if (navigationGraphCurrent && navigationSceneSnapshot?.key === baselineSnapshotKey) {
      if (pendingTaskGraphSyncKey !== null) {
        setPendingTaskGraphSyncKey(null)
      }
      return
    }

    if (pendingTaskGraphSyncKey !== baselineSnapshotKey) {
      setPendingTaskGraphSyncKey(baselineSnapshotKey)
    }
  }, [
    enabled,
    navigationGraphCurrent,
    navigationSceneSnapshot?.key,
    pendingTaskGraphSyncKey,
    robotMode,
    taskLoopSettledToken,
    taskLoopToken,
  ])

  useEffect(() => {
    mergeNavigationPerfMeta({
      navigationCellCount: graph?.cells.length ?? 0,
      navigationComponentCount: graph?.components.length ?? 0,
      navigationDoorBridgeEdgeCount: graph?.doorBridgeEdgeCount ?? 0,
      navigationLargestComponentSize: graph?.largestComponentSize ?? 0,
      navigationStairSurfaceCount: graph?.stairSurfaceCount ?? 0,
      navigationStairTransitionEdgeCount: graph?.stairTransitionEdgeCount ?? 0,
      navigationWalkableCellCount: graph?.walkableCellCount ?? 0,
    })
  }, [graph])

  useEffect(() => {
    const removeAfterEffect = addAfterEffect(() => {
      mergeNavigationPerfMeta({
        navigationRenderCalls: gl.info.render.calls,
        navigationRenderLines: gl.info.render.lines,
        navigationRenderPoints: gl.info.render.points,
        navigationRenderTriangles: gl.info.render.triangles,
      })
    })

    return removeAfterEffect
  }, [gl])

  useEffect(() => {
    if (!NAVIGATION_AUDIT_DIAGNOSTICS_ENABLED) {
      return
    }

    const renderer = gl as typeof gl & {
      backend?: {
        __pascalOriginalCreateProgram?: (program: unknown) => unknown
        __pascalOriginalCreateRenderPipeline?: (
          renderObject: unknown,
          promises?: unknown,
        ) => unknown
        __pascalProfilePatched?: boolean
        createProgram?: (program: unknown) => unknown
        createRenderPipeline?: (renderObject: unknown, promises?: unknown) => unknown
        device?: {
          __pascalOriginalCreatePipelineLayout?: (descriptor: unknown) => unknown
          __pascalOriginalCreateRenderPipeline?: (descriptor: unknown) => unknown
          __pascalOriginalCreateRenderPipelineAsync?: (descriptor: unknown) => Promise<unknown>
          __pascalOriginalCreateShaderModule?: (descriptor: unknown) => unknown
          __pascalProfilePatched?: boolean
          createPipelineLayout?: (descriptor: unknown) => unknown
          createRenderPipeline?: (descriptor: unknown) => unknown
          createRenderPipelineAsync?: (descriptor: unknown) => Promise<unknown>
          createShaderModule?: (descriptor: unknown) => unknown
        } | null
      } | null
      _pipelines?: {
        __pascalOriginalGetForRender?: (renderObject: unknown, promises?: unknown) => unknown
        __pascalProfilePatched?: boolean
        _needsRenderUpdate?: (renderObject: unknown) => boolean
        get?: (renderObject: unknown) => { pipeline?: Record<string, unknown> } | undefined
        getForRender?: (renderObject: unknown, promises?: unknown) => unknown
      }
    }
    const backend = renderer.backend
    const pipelines = renderer._pipelines
    const device = backend?.device
    if (
      !backend ||
      !pipelines ||
      !device ||
      typeof pipelines.getForRender !== 'function' ||
      typeof backend.createProgram !== 'function' ||
      typeof backend.createRenderPipeline !== 'function' ||
      typeof device.createShaderModule !== 'function' ||
      typeof device.createPipelineLayout !== 'function' ||
      typeof device.createRenderPipeline !== 'function' ||
      backend.__pascalProfilePatched ||
      pipelines.__pascalProfilePatched
    ) {
      return
    }

    type RenderObjectDiagnostic = {
      geometry?: { type?: string } | null
      getNodeBuilderState?: () => { fragmentShader?: string; vertexShader?: string } | null
      material?: {
        id?: number
        name?: string
        side?: number
        transparent?: boolean
        type?: string
      } | null
      object?: {
        id?: number
        isSkinnedMesh?: boolean
        morphTargetInfluences?: unknown
        name?: string
        type?: string
      } | null
      pipeline?: {
        cacheKey?: string
        fragmentProgram?: { id?: number; name?: string } | null
        vertexProgram?: { id?: number; name?: string } | null
      } | null
    }
    type ProgramDiagnostic = {
      code?: string
      id?: number
      name?: string
      stage?: string
    }

    const compileContextStack: Array<Record<string, unknown>> = []
    const getCurrentCompileContext = () => {
      const currentContext = compileContextStack[compileContextStack.length - 1]
      return currentContext ? { ...currentContext } : null
    }
    const withCompileContext = <T,>(meta: Record<string, unknown>, run: () => T) => {
      compileContextStack.push(meta)
      try {
        return run()
      } finally {
        compileContextStack.pop()
      }
    }
    const buildObjectHierarchyPath = (object: Object3D | null) => {
      if (!object) {
        return null
      }

      const segments: string[] = []
      let current: Object3D | null = object
      while (current) {
        const label =
          current.name && current.name.length > 0 ? current.name : current.type || 'Object3D'
        segments.push(label)
        current = current.parent
      }

      return segments.reverse().join(' > ')
    }

    const buildRenderObjectPerfMeta = (
      renderObject: unknown,
      extraMeta?: Record<string, unknown>,
    ) => {
      const renderObjectRecord = renderObject as RenderObjectDiagnostic
      const object = (renderObjectRecord.object ?? null) as
        | (Object3D & {
            castShadow?: boolean
            frustumCulled?: boolean
            isSkinnedMesh?: boolean
            morphTargetInfluences?: unknown
            receiveShadow?: boolean
          })
        | null
      const material = renderObjectRecord.material ?? null
      const geometry = renderObjectRecord.geometry ?? null
      const pipeline = renderObjectRecord.pipeline ?? null
      const objectId = typeof object?.id === 'number' ? object.id : null
      const nodeBuilderState =
        typeof renderObjectRecord.getNodeBuilderState === 'function'
          ? renderObjectRecord.getNodeBuilderState()
          : null
      return {
        actorRelated: objectId !== null ? actorObjectIdSetRef.current.has(objectId) : null,
        cacheKey:
          typeof pipeline?.cacheKey === 'string' && pipeline.cacheKey.length > 0
            ? pipeline.cacheKey
            : null,
        fragmentProgramId:
          typeof pipeline?.fragmentProgram?.id === 'number' ? pipeline.fragmentProgram.id : null,
        fragmentProgramName: pipeline?.fragmentProgram?.name ?? null,
        fragmentShaderLength:
          typeof nodeBuilderState?.fragmentShader === 'string'
            ? nodeBuilderState.fragmentShader.length
            : null,
        geometryType: geometry?.type ?? null,
        materialId: typeof material?.id === 'number' ? material.id : null,
        materialName: material?.name || null,
        materialSide: typeof material?.side === 'number' ? material.side : null,
        materialTransparent:
          typeof material?.transparent === 'boolean' ? material.transparent : null,
        materialType: material?.type ?? null,
        objectCastShadow: typeof object?.castShadow === 'boolean' ? object.castShadow : null,
        objectExcludedFromOutline: object?.userData?.pascalExcludeFromOutline === true,
        objectExcludedFromToolReveal: object?.userData?.pascalExcludeFromToolReveal === true,
        objectFrustumCulled:
          typeof object?.frustumCulled === 'boolean' ? object.frustumCulled : null,
        objectHierarchyPath: buildObjectHierarchyPath(object),
        objectId,
        objectLayersMask:
          object?.layers && typeof object.layers.mask === 'number' ? object.layers.mask : null,
        objectName: object?.name || null,
        objectReceiveShadow:
          typeof object?.receiveShadow === 'boolean' ? object.receiveShadow : null,
        objectRenderOrder: typeof object?.renderOrder === 'number' ? object.renderOrder : null,
        objectSkinned: object?.isSkinnedMesh === true,
        objectType: object?.type ?? null,
        objectUsesMorphTargets: Array.isArray(object?.morphTargetInfluences),
        objectVisible: typeof object?.visible === 'boolean' ? object.visible : null,
        ...(extraMeta ?? {}),
        vertexProgramId:
          typeof pipeline?.vertexProgram?.id === 'number' ? pipeline.vertexProgram.id : null,
        vertexProgramName: pipeline?.vertexProgram?.name ?? null,
        vertexShaderLength:
          typeof nodeBuilderState?.vertexShader === 'string'
            ? nodeBuilderState.vertexShader.length
            : null,
      }
    }
    const buildProgramPerfMeta = (program: unknown, extraMeta?: Record<string, unknown>) => {
      const programRecord = program as ProgramDiagnostic
      return {
        codeLength: typeof programRecord.code === 'string' ? programRecord.code.length : null,
        programId: typeof programRecord.id === 'number' ? programRecord.id : null,
        programName: programRecord.name || null,
        programStage: programRecord.stage || null,
        ...(extraMeta ?? {}),
      }
    }
    const recordCreateSample = (
      name: string,
      startTimeMs: number,
      meta: Record<string, unknown> | null,
    ) => {
      recordNavigationPerfSample(name, performance.now() - startTimeMs, meta ?? undefined)
    }

    const originalGetForRender = pipelines.getForRender.bind(pipelines)
    const originalCreateProgram = backend.createProgram.bind(backend)
    const originalBackendCreateRenderPipeline = backend.createRenderPipeline.bind(backend)
    const originalCreateShaderModule = device.createShaderModule.bind(device)
    const originalCreatePipelineLayout = device.createPipelineLayout.bind(device)
    const originalDeviceCreateRenderPipeline = device.createRenderPipeline.bind(device)
    const originalCreateRenderPipelineAsync =
      typeof device.createRenderPipelineAsync === 'function'
        ? device.createRenderPipelineAsync.bind(device)
        : null
    const lastActorPipelineSignatureByObjectId = new Map<number, string>()
    pipelines.__pascalOriginalGetForRender = originalGetForRender
    backend.__pascalOriginalCreateProgram = originalCreateProgram
    backend.__pascalOriginalCreateRenderPipeline = originalBackendCreateRenderPipeline
    device.__pascalOriginalCreateShaderModule = originalCreateShaderModule
    device.__pascalOriginalCreatePipelineLayout = originalCreatePipelineLayout
    device.__pascalOriginalCreateRenderPipeline = originalDeviceCreateRenderPipeline
    if (originalCreateRenderPipelineAsync) {
      device.__pascalOriginalCreateRenderPipelineAsync = originalCreateRenderPipelineAsync
    }
    backend.__pascalProfilePatched = true
    device.__pascalProfilePatched = true
    pipelines.__pascalProfilePatched = true

    backend.createProgram = (program: unknown) => {
      const programMeta = buildProgramPerfMeta(program, {
        ...(getCurrentCompileContext() ?? {}),
        contextKind: 'backend-create-program',
      })
      return withCompileContext(programMeta, () => {
        const startTimeMs = performance.now()
        const result = originalCreateProgram(program)
        recordCreateSample('navigation.webgpu.backendCreateProgramMs', startTimeMs, programMeta)
        return result
      })
    }

    backend.createRenderPipeline = (renderObject: unknown, promises?: unknown) => {
      const renderMeta = buildRenderObjectPerfMeta(renderObject, {
        contextKind: 'backend-create-render-pipeline',
      })
      return withCompileContext(renderMeta, () => {
        const startTimeMs = performance.now()
        const result = originalBackendCreateRenderPipeline(renderObject, promises)
        recordCreateSample(
          'navigation.webgpu.backendCreateRenderPipelineMs',
          startTimeMs,
          renderMeta,
        )
        return result
      })
    }

    device.createShaderModule = (descriptor: unknown) => {
      const descriptorRecord = descriptor as {
        code?: string
        label?: string
      } | null
      const currentContext = getCurrentCompileContext()
      const startTimeMs = performance.now()
      const result = originalCreateShaderModule(descriptor)
      recordCreateSample('navigation.webgpu.deviceCreateShaderModuleMs', startTimeMs, {
        ...(currentContext ?? {}),
        contextKind: 'device-create-shader-module',
        descriptorLabel: descriptorRecord?.label ?? null,
        descriptorShaderCodeLength:
          typeof descriptorRecord?.code === 'string' ? descriptorRecord.code.length : null,
      })
      return result
    }

    device.createPipelineLayout = (descriptor: unknown) => {
      const descriptorRecord = descriptor as {
        bindGroupLayouts?: unknown[]
        label?: string
      } | null
      const currentContext = getCurrentCompileContext()
      const startTimeMs = performance.now()
      const result = originalCreatePipelineLayout(descriptor)
      recordCreateSample('navigation.webgpu.deviceCreatePipelineLayoutMs', startTimeMs, {
        ...(currentContext ?? {}),
        bindGroupLayoutCount: Array.isArray(descriptorRecord?.bindGroupLayouts)
          ? descriptorRecord.bindGroupLayouts.length
          : null,
        contextKind: 'device-create-pipeline-layout',
        descriptorLabel: descriptorRecord?.label ?? null,
      })
      return result
    }

    device.createRenderPipeline = (descriptor: unknown) => {
      const descriptorRecord = descriptor as {
        fragment?: { targets?: unknown[] } | null
        label?: string
        multisample?: { count?: number } | null
        primitive?: { topology?: string } | null
      } | null
      const currentContext = getCurrentCompileContext()
      const startTimeMs = performance.now()
      const result = originalDeviceCreateRenderPipeline(descriptor)
      recordCreateSample('navigation.webgpu.deviceCreateRenderPipelineMs', startTimeMs, {
        ...(currentContext ?? {}),
        contextKind: 'device-create-render-pipeline',
        descriptorLabel: descriptorRecord?.label ?? null,
        primitiveTopology: descriptorRecord?.primitive?.topology ?? null,
        renderTargetCount: Array.isArray(descriptorRecord?.fragment?.targets)
          ? descriptorRecord.fragment.targets.length
          : null,
        sampleCount:
          typeof descriptorRecord?.multisample?.count === 'number'
            ? descriptorRecord.multisample.count
            : null,
      })
      return result
    }

    if (originalCreateRenderPipelineAsync) {
      device.createRenderPipelineAsync = async (descriptor: unknown) => {
        const descriptorRecord = descriptor as {
          fragment?: { targets?: unknown[] } | null
          label?: string
          multisample?: { count?: number } | null
          primitive?: { topology?: string } | null
        } | null
        const currentContext = getCurrentCompileContext()
        const startTimeMs = performance.now()
        try {
          return await originalCreateRenderPipelineAsync(descriptor)
        } finally {
          recordCreateSample('navigation.webgpu.deviceCreateRenderPipelineAsyncMs', startTimeMs, {
            ...(currentContext ?? {}),
            contextKind: 'device-create-render-pipeline-async',
            descriptorLabel: descriptorRecord?.label ?? null,
            primitiveTopology: descriptorRecord?.primitive?.topology ?? null,
            renderTargetCount: Array.isArray(descriptorRecord?.fragment?.targets)
              ? descriptorRecord.fragment.targets.length
              : null,
            sampleCount:
              typeof descriptorRecord?.multisample?.count === 'number'
                ? descriptorRecord.multisample.count
                : null,
          })
        }
      }
    }

    pipelines.getForRender = (renderObject: unknown, promises?: unknown) => {
      const pipelineProbe = pipelines as typeof pipelines & {
        get: (renderObject: unknown) => { pipeline?: Record<string, unknown> } | undefined
      }
      const dataBefore =
        typeof pipelineProbe.get === 'function' ? (pipelineProbe.get(renderObject) ?? null) : null
      const hadPipeline = Boolean(dataBefore?.pipeline)
      const requiredUpdate =
        typeof pipelines._needsRenderUpdate === 'function'
          ? pipelines._needsRenderUpdate(renderObject)
          : null

      const result = withCompileContext(
        buildRenderObjectPerfMeta(renderObject, {
          contextKind: 'pipelines-get-for-render',
        }),
        () => originalGetForRender(renderObject, promises),
      )

      const dataAfter =
        typeof pipelineProbe.get === 'function' ? (pipelineProbe.get(renderObject) ?? null) : null
      const createdPipeline = !hadPipeline && Boolean(dataAfter?.pipeline)
      const updatedPipeline =
        hadPipeline &&
        Boolean(dataBefore?.pipeline) &&
        Boolean(dataAfter?.pipeline) &&
        dataBefore?.pipeline !== dataAfter?.pipeline

      if (createdPipeline || updatedPipeline || requiredUpdate === true) {
        const renderObjectRecord = renderObject as RenderObjectDiagnostic
        const object = renderObjectRecord.object ?? null
        const objectId = typeof object?.id === 'number' ? object.id : null
        const material = renderObjectRecord.material ?? null
        if (material?.name === 'ShadowMaterial') {
          return result
        }
        const pipeline = (dataAfter?.pipeline ?? null) as {
          cacheKey?: string
          fragmentProgram?: { id?: number }
          vertexProgram?: { id?: number }
        } | null
        const pipelineEvent = createdPipeline ? 'created' : updatedPipeline ? 'updated' : 'refresh'
        const signature = JSON.stringify({
          cacheKey:
            typeof pipeline?.cacheKey === 'string' && pipeline.cacheKey.length > 0
              ? pipeline.cacheKey
              : null,
          fragmentProgramId:
            typeof pipeline?.fragmentProgram?.id === 'number' ? pipeline.fragmentProgram.id : null,
          materialId: typeof material?.id === 'number' ? material.id : null,
          objectId,
          pipelineEvent,
          vertexProgramId:
            typeof pipeline?.vertexProgram?.id === 'number' ? pipeline.vertexProgram.id : null,
        })
        const signatureKey = objectId ?? -1
        if (lastActorPipelineSignatureByObjectId.get(signatureKey) === signature) {
          return result
        }
        lastActorPipelineSignatureByObjectId.set(signatureKey, signature)
        recordNavigationPerfMark(
          'navigation.renderPipelineCreate',
          buildRenderObjectPerfMeta(renderObject, {
            pipelineEvent,
          }),
        )
      }

      return result
    }

    return () => {
      if (renderer.backend?.__pascalOriginalCreateProgram) {
        renderer.backend.createProgram = renderer.backend.__pascalOriginalCreateProgram
      }
      if (renderer.backend?.__pascalOriginalCreateRenderPipeline) {
        renderer.backend.createRenderPipeline =
          renderer.backend.__pascalOriginalCreateRenderPipeline
      }
      if (renderer.backend?.device?.__pascalOriginalCreateShaderModule) {
        renderer.backend.device.createShaderModule =
          renderer.backend.device.__pascalOriginalCreateShaderModule
      }
      if (renderer.backend?.device?.__pascalOriginalCreatePipelineLayout) {
        renderer.backend.device.createPipelineLayout =
          renderer.backend.device.__pascalOriginalCreatePipelineLayout
      }
      if (renderer.backend?.device?.__pascalOriginalCreateRenderPipeline) {
        renderer.backend.device.createRenderPipeline =
          renderer.backend.device.__pascalOriginalCreateRenderPipeline
      }
      if (renderer.backend?.device?.__pascalOriginalCreateRenderPipelineAsync) {
        renderer.backend.device.createRenderPipelineAsync =
          renderer.backend.device.__pascalOriginalCreateRenderPipelineAsync
      }
      if (renderer.backend) {
        delete renderer.backend.__pascalOriginalCreateProgram
        delete renderer.backend.__pascalOriginalCreateRenderPipeline
        delete renderer.backend.__pascalProfilePatched
      }
      if (renderer.backend?.device) {
        delete renderer.backend.device.__pascalOriginalCreateShaderModule
        delete renderer.backend.device.__pascalOriginalCreatePipelineLayout
        delete renderer.backend.device.__pascalOriginalCreateRenderPipeline
        delete renderer.backend.device.__pascalOriginalCreateRenderPipelineAsync
        delete renderer.backend.device.__pascalProfilePatched
      }
      if (
        renderer._pipelines &&
        typeof renderer._pipelines.__pascalOriginalGetForRender === 'function'
      ) {
        renderer._pipelines.getForRender = renderer._pipelines.__pascalOriginalGetForRender
      }
      if (renderer._pipelines) {
        delete renderer._pipelines.__pascalOriginalGetForRender
        delete renderer._pipelines.__pascalProfilePatched
      }
    }
  }, [gl])

  const [actorCellIndex, setActorCellIndex] = useState<number | null>(null)
  const [actorMoving, setActorMoving] = useState(false)
  const [pathIndices, setPathIndices] = useState<number[]>([])
  const [pathAnchorWorldPosition, setPathAnchorWorldPosition] = useState<
    [number, number, number] | null
  >(null)
  const [pathTargetWorldPosition, setPathTargetWorldPosition] = useState<
    [number, number, number] | null
  >(null)
  const [pathGraphOverride, setPathGraphOverride] = useState<NavigationGraph | null>(null)
  const pathGraph = pathGraphOverride ?? graph

  const actorGroupRef = useRef<Group>(null)
  const actorObjectIdSetRef = useRef<Set<number>>(new Set())
  const debugDoorTransitionsRef = useRef<NavigationDoorTransition[]>([])
  const debugPathCurveRef = useRef<Curve<Vector3> | null>(null)
  const trajectoryDebugOpaqueRef = useRef(false)
  const trajectoryDebugDistanceRef = useRef<number | null>(null)
  const trajectoryDebugModeRef = useRef<'fade' | 'hidden' | 'live' | 'opaque'>('live')
  const trajectoryDebugPauseRef = useRef(false)
  const basePathShaderRef = useRef<TrajectoryShaderHandle | null>(null)
  const highlightPathShaderRef = useRef<TrajectoryShaderHandle | null>(null)
  const orbitPathShaderARef = useRef<TrajectoryShaderHandle | null>(null)
  const orbitPathShaderBRef = useRef<TrajectoryShaderHandle | null>(null)
  const lastItemMovePlanDebugRef = useRef<Record<string, unknown> | null>(null)
  const lastCommittedPathDebugRef = useRef<Record<string, unknown> | null>(null)
  const lastPublishedActorPositionRef = useRef<[number, number, number] | null>(null)
  const lastPublishedActorPositionAtRef = useRef(0)
  const raycasterRef = useRef(new Raycaster())
  const pointerRef = useRef(new Vector2())
  const motionRef = useRef<ActorMotionState>(createActorMotionState())
  const motionWriteSourceRef = useRef<string>('initial')
  const pendingMotionRef = useRef<{
    destinationCellIndex: number | null
    moving: boolean
    speed: number
  } | null>(null)
  const doorCollisionStateRef = useRef<{
    blocked: boolean
    doorIds: string[]
  }>({
    blocked: false,
    doorIds: [],
  })
  const itemDeleteSequenceRef = useRef<NavigationItemDeleteSequence | null>(null)
  const itemMoveSequenceRef = useRef<NavigationItemMoveSequence | null>(null)
  const itemMovePreviewPlanRef = useRef<NavigationItemMovePreviewPlan | null>(null)
  const itemMovePreviewPlanCacheRef = useRef(new Map<string, NavigationItemMovePreviewPlan>())
  const itemMovePreviewPlanWarmTimeoutRef = useRef<number | null>(null)
  const itemRepairSequenceRef = useRef<NavigationItemRepairSequence | null>(null)
  const itemMoveStageHistoryRef = useRef<Array<{ at: number; stage: string | null }>>([])
  const itemMoveTraceCooldownFramesRef = useRef(0)
  const itemMoveTraceGhostBaselineRef = useRef<[number, number, number] | null>(null)
  const itemMoveTraceSourceBaselineRef = useRef<[number, number, number] | null>(null)
  const itemMoveTraceSourceIdRef = useRef<string | null>(null)
  const itemMoveFrameTraceRef = useRef<ItemMoveFrameTraceSample[]>([])
  const carriedVisualItemIdRef = useRef<string | null>(null)
  const pascalTruckIntroPlanRef = useRef<ReturnType<typeof buildPascalTruckIntroState>>(null)
  const toolInteractionPhaseRef = useRef<NavigationRobotToolInteractionPhase | null>(null)
  const toolInteractionTargetItemIdRef = useRef<string | null>(null)
  const actorPositionInitializedRef = useRef(false)
  const actorRobotDebugStateRef = useRef<Record<string, unknown> | null>(null)
  const introAnimationTraceCaptureActiveRef = useRef(false)
  const pascalTruckIntroRef = useRef<PascalTruckIntroState | null>(null)
  const pascalTruckExitRef = useRef<PascalTruckExitState | null>(null)
  const pascalTruckIntroPendingSettlePositionRef = useRef<[number, number, number] | null>(null)
  const shadowControllerRef = useRef({
    currentAutoUpdate: null as boolean | null,
    currentEnabled: null as boolean | null,
    dynamicSettleFrames: STATIC_SHADOW_SCENE_WARMUP_FRAMES,
    lastDynamicUpdateAtMs: 0,
  })
  const actorRenderVisibleOverrideRef = useRef<boolean | null>(null)
  const robotSkinnedMeshVisibleOverrideRef = useRef<boolean | null>(null)
  const robotStaticMeshVisibleOverrideRef = useRef<boolean | null>(null)
  const robotToolAttachmentsVisibleOverrideRef = useRef<boolean | null>(null)
  const robotMaterialDebugModeOverrideRef = useRef<NavigationRobotMaterialDebugMode | null>(null)
  const shadowMapOverrideEnabledRef = useRef<boolean | null>(null)
  const [itemMoveForcedClipPlayback, setItemMoveForcedClipPlayback] =
    useState<NavigationRobotForcedClipPlayback | null>(null)
  const [introAnimationDebugActive, setIntroAnimationDebugActive] = useState(false)
  const [pascalTruckIntroActive, setPascalTruckIntroActive] = useState(false)
  const [pascalTruckExitActive, setPascalTruckExitActive] = useState(false)
  const [pascalTruckIntroCompleted, setPascalTruckIntroCompleted] = useState(false)
  const [pascalTruckIntroTaskReady, setPascalTruckIntroTaskReady] = useState(false)
  const [actorRobotWarmupReady, setActorRobotWarmupReady] = useState(false)
  const [toolCarryItemId, setToolCarryItemId] = useState<string | null>(null)
  const pascalTruckIntroTaskReadyTimeoutRef = useRef<number | null>(null)
  const pascalTruckIntroPostWarmupTokenRef = useRef<number | null>(null)
  const navigationPostWarmupCameraPositionRef = useRef(new Vector3())
  const navigationPostWarmupCameraQuaternionRef = useRef(new Quaternion())
  const navigationPostWarmupPendingCameraSignatureRef = useRef<string | null>(null)
  const navigationPostWarmupPendingCameraSinceRef = useRef(0)
  const navigationPostWarmupCameraSignatureRef = useRef('uninitialized')
  const [navigationPostWarmupCameraSignature, setNavigationPostWarmupCameraSignature] =
    useState('uninitialized')
  const pendingPascalTruckExitRef = useRef<PendingPascalTruckExitRequest | null>(null)
  const precomputedPascalTruckExitRef = useRef<NavigationPrecomputedExitPath | null>(null)
  const deferredItemMoveCommitFrameRef = useRef<number | null>(null)
  const deferredItemMoveCommitIdleRef = useRef<number | null>(null)
  const deferredItemMoveCommitTimeoutRef = useRef<number | null>(null)
  const previousRobotModeRef = useRef<NavigationRobotMode | null>(robotMode)
  const processedQueueRestartTokenRef = useRef(queueRestartToken)
  const taskLoopBaselineSnapshotKeyRef = useRef<string | null>(null)
  const taskQueueSyncedMoveVisualStatesRef = useRef<Partial<Record<string, ItemMoveVisualState>>>({})
  const taskQueueSyncedDeleteIdsRef = useRef<Set<string>>(new Set())
  const taskQueueSyncedRepairIdsRef = useRef<Set<string>>(new Set())
  const taskQueueSyncedActionShieldKindsRef = useRef<
    Partial<Record<string, 'copy' | 'delete' | 'move' | 'repair'>>
  >({})
  const taskQueueSyncedActionShieldOpacitiesRef = useRef<Partial<Record<string, number>>>({})
  const debugPascalTruckIntroAttemptCountRef = useRef(0)
  const debugPascalTruckIntroStartCountRef = useRef(0)
  const shouldForceContinuousFrames =
    enabled &&
    robotMode !== null &&
    (pascalTruckIntroActive ||
      pascalTruckExitActive ||
      actorMoving ||
      taskQueue.length > 0 ||
      itemMoveRequest !== null ||
      itemDeleteRequest !== null ||
      itemRepairRequest !== null)

  useEffect(() => {
    setThreeState({ frameloop: shouldForceContinuousFrames ? 'always' : 'demand' })
  }, [setThreeState, shouldForceContinuousFrames])

  const clearNavigationItemMoveVisualResidue = useCallback(
    (request: NavigationItemMoveRequest | null) => {
      const viewerState = useViewer.getState()
      const navigationVisuals = navigationVisualsStore.getState()
      const preview = navigationVisuals.itemMovePreview
      const previewSelectedIds = [...viewerState.previewSelectedIds]
      const visualIdsToClear = new Set<string>()
      const preserveLiveTransformIds = new Set<string>()
      const removedTransientPreviewIds: string[] = []

      for (const previewId of previewSelectedIds) {
        if (previewId) {
          visualIdsToClear.add(previewId)
        }
      }

      if (request) {
        visualIdsToClear.add(request.itemId)
        visualIdsToClear.add(getNavigationItemMoveVisualItemId(request))
        if (request.targetPreviewItemId) {
          visualIdsToClear.add(request.targetPreviewItemId)
        }
        preserveLiveTransformIds.add(request.itemId)
        preserveLiveTransformIds.add(getNavigationItemMoveVisualItemId(request))
      }

      if (
        preview &&
        (!request ||
          preview.sourceItemId === request.itemId ||
          preview.id === request.targetPreviewItemId ||
          preview.id === getNavigationItemMoveVisualItemId(request))
      ) {
        visualIdsToClear.add(preview.id)
        visualIdsToClear.add(preview.sourceItemId)
        navigationVisuals.setItemMovePreview(null)
      }

      if (previewSelectedIds.length > 0) {
        viewerState.setPreviewSelectedIds([])
      }

      if (carriedVisualItemIdRef.current) {
        visualIdsToClear.add(carriedVisualItemIdRef.current)
      }

      for (const visualId of visualIdsToClear) {
        if (!visualId) {
          continue
        }

        navigationVisuals.setItemMoveVisualState(visualId, null)
        navigationVisuals.setNodeVisibilityOverride(visualId, null)
        if (!preserveLiveTransformIds.has(visualId)) {
          useLiveTransforms.getState().clear(visualId)
        }
        clearPersistentItemMoveVisualState(visualId)
      }

      if (request) {
        clearPersistentItemMoveVisualState(request.itemId)
        clearPersistentItemMoveVisualState(request.visualItemId)
        if (request.targetPreviewItemId) {
          const previewNode = useScene.getState().nodes[request.targetPreviewItemId as AnyNodeId]
          const previewMetadata =
            previewNode &&
            typeof previewNode.metadata === 'object' &&
            previewNode.metadata !== null &&
            !Array.isArray(previewNode.metadata)
              ? (previewNode.metadata as Record<string, unknown>)
              : null
          if (previewMetadata?.isTransient === true) {
            removedTransientPreviewIds.push(request.targetPreviewItemId)
            useScene.getState().deleteNode(request.targetPreviewItemId as AnyNodeId)
          }
        }
      }

      appendTaskModeTrace('navigation.clearItemMoveVisualResidue', {
        itemId: request?.itemId ?? null,
        removedTransientPreviewIds,
        visualIdsCleared: [...visualIdsToClear],
      })
    },
    [],
  )

  const resetTaskQueueVisuals = useCallback(() => {
    const viewerState = useViewer.getState()
    const navigationState = useNavigation.getState()
    appendTaskModeTrace('navigation.resetTaskQueueVisualsStart', {
      activeTaskId: navigationState.activeTaskId,
      queueLength: navigationState.taskQueue.length,
    })
    if (viewerState.previewSelectedIds.length > 0) {
      viewerState.setPreviewSelectedIds([])
    }
    viewerState.setHoveredId(null)
    viewerState.outliner.selectedObjects.length = 0
    viewerState.outliner.hoveredObjects.length = 0

    const queuedMoveRequests = navigationState.taskQueue
      .filter((task): task is Extract<(typeof navigationState.taskQueue)[number], { kind: 'move' }> => task.kind === 'move')
      .map((task) => task.request)
    const moveRequestsToClear = navigationState.itemMoveRequest
      ? [...queuedMoveRequests, navigationState.itemMoveRequest]
      : queuedMoveRequests

    for (const request of moveRequestsToClear) {
      const visualIds = new Set<string>()
      visualIds.add(request.itemId)
      visualIds.add(getNavigationItemMoveVisualItemId(request))
      if (request.visualItemId) {
        visualIds.add(request.visualItemId)
      }
      if (request.targetPreviewItemId) {
        visualIds.add(request.targetPreviewItemId)
      }

      for (const visualId of visualIds) {
        navigationVisualsStore.getState().setItemMoveVisualState(visualId, null)
        navigationVisualsStore.getState().setNodeVisibilityOverride(visualId, null)
        useLiveTransforms.getState().clear(visualId)
        clearPersistentItemMoveVisualState(visualId)
        removeTransientNavigationPreviewNode(visualId)
      }
    }

    clearNavigationItemMoveVisualResidue(null)
    navigationVisualsStore.getState().resetTaskQueueVisuals()
    taskQueueSyncedMoveVisualStatesRef.current = {}
    taskQueueSyncedDeleteIdsRef.current = new Set()
    taskQueueSyncedRepairIdsRef.current = new Set()
    taskQueueSyncedActionShieldKindsRef.current = {}
    taskQueueSyncedActionShieldOpacitiesRef.current = {}
    appendTaskModeTrace('navigation.resetTaskQueueVisualsComplete', {
      activeTaskId: navigationState.activeTaskId,
      queueLength: navigationState.taskQueue.length,
    })
  }, [clearNavigationItemMoveVisualResidue])

  const getTaskModeSnapshot = useCallback(
    (label = 'snapshot') => {
      const navigationState = useNavigation.getState()
      const visualState = navigationVisualsStore.getState()
      const sceneNodes = useScene.getState().nodes as Record<string, AnyNode>
      const relevantIds = new Set<string>()
      const queueTasks = navigationState.taskQueue.map((task) => {
        const derivedKind = getNavigationQueuedTaskVisualKind(task)
        const moveRequest = task.kind === 'move' ? task.request : null
        const sourceId = task.request.itemId
        const previewId = moveRequest?.targetPreviewItemId ?? null
        const visualId = moveRequest?.visualItemId ?? null

        relevantIds.add(sourceId)
        if (previewId) {
          relevantIds.add(previewId)
        }
        if (visualId && visualId !== sourceId) {
          relevantIds.add(visualId)
        }

        return {
          derivedKind,
          itemId: sourceId,
          previewId,
          sourcePosition: task.request.sourcePosition,
          taskId: task.taskId,
          visualId,
        }
      })

      const nodeSummaries = Array.from(relevantIds).map((id) => {
        const node = sceneNodes[id]
        const metadata =
          node &&
          typeof node === 'object' &&
          'metadata' in node &&
          typeof node.metadata === 'object' &&
          node.metadata !== null &&
          !Array.isArray(node.metadata)
            ? (node.metadata as Record<string, unknown>)
            : null

        return {
          actionShieldKind: visualState.actionShieldKinds[id] ?? null,
          actionShieldOpacity: visualState.actionShieldOpacities[id] ?? null,
          id,
          isTransient: metadata?.isTransient === true,
          liveTransform: useLiveTransforms.getState().get(id) ?? null,
          nodeType: node?.type ?? null,
          sceneVisible:
            node && typeof node === 'object' && 'visible' in node ? ((node as ItemNode).visible ?? null) : null,
          viewerVisibilityOverride: visualState.nodeVisibilityOverrides[id] ?? null,
          visualState:
            visualState.itemMoveVisualStates[id] ??
            (node?.type === 'item' ? getItemMoveVisualState(node.metadata) : null),
        }
      })

      return {
        activeTaskId: navigationState.activeTaskId,
        actorAvailable: navigationState.actorAvailable,
        actorCellIndex,
        actorMoving,
        itemMoveSequenceStage: itemMoveSequenceRef.current?.stage ?? null,
        label,
        nodeSummaries,
        pascalTruckExitActive,
        pascalTruckIntroActive: Boolean(pascalTruckIntroRef.current),
        pascalTruckIntroCompleted,
        pascalTruckIntroTaskReady,
        pendingMotion:
          pendingMotionRef.current === null
            ? null
            : {
                destinationCellIndex: pendingMotionRef.current.destinationCellIndex,
                moving: pendingMotionRef.current.moving,
                speed: pendingMotionRef.current.speed,
              },
        pendingTaskGraphSyncKey,
        queueRestartToken: navigationState.queueRestartToken,
        queueTasks,
        robotMode: navigationState.robotMode,
        taskQueueSourceMarkers: getTaskQueueSourceMarkerSpecs(
          navigationState.taskQueue,
          navigationState.activeTaskId,
          navigationState.enabled,
          navigationState.robotMode,
        ),
        taskLoopSettledToken: navigationState.taskLoopSettledToken,
        taskLoopToken: navigationState.taskLoopToken,
        taskQueuePlanningReady,
      }
    },
    [
      actorCellIndex,
      actorMoving,
      pascalTruckExitActive,
      pascalTruckIntroCompleted,
      pascalTruckIntroTaskReady,
      pendingTaskGraphSyncKey,
      taskQueuePlanningReady,
    ],
  )

  const recordTaskModeTrace = useCallback(
    (
      type: string,
      payload: Record<string, unknown> = {},
      options?: { includeSnapshot?: boolean; label?: string },
    ) => {
      appendTaskModeTrace(type, {
        ...payload,
        ...(options?.includeSnapshot ? { snapshot: getTaskModeSnapshot(options.label ?? type) } : {}),
      })
    },
    [getTaskModeSnapshot],
  )

  const actorComponentId =
    graph && actorCellIndex !== null ? (graph.componentIdByCell[actorCellIndex] ?? null) : null
  const actorCell = graph && actorCellIndex !== null ? graph.cells[actorCellIndex] : null
  const defaultActorSpawnPosition = useMemo(
    () =>
      actorCell
        ? ([actorCell.center[0], actorCell.center[1] + ACTOR_HOVER_Y, actorCell.center[2]] as [
            number,
            number,
            number,
          ])
        : null,
    [actorCell],
  )
  const pascalTruckIntroPlan = useMemo(
    () =>
      prewarmedGraph
        ? buildPascalTruckIntroState(prewarmedGraph, sceneState.nodes, selection.levelId)
        : null,
    [prewarmedGraph, sceneState.nodes, selection.levelId],
  )
  useEffect(() => {
    pascalTruckIntroPlanRef.current = pascalTruckIntroPlan
  }, [pascalTruckIntroPlan])

  useEffect(() => {
    const navigationVisuals = navigationVisualsStore.getState()
    const previousMoveVisualStates = taskQueueSyncedMoveVisualStatesRef.current
    const previousDeleteIds = taskQueueSyncedDeleteIdsRef.current
    const previousRepairIds = taskQueueSyncedRepairIdsRef.current
    const previousActionShieldKinds = taskQueueSyncedActionShieldKindsRef.current
    const previousActionShieldOpacities = taskQueueSyncedActionShieldOpacitiesRef.current
    const nextMoveVisualStates: Partial<Record<string, ItemMoveVisualState>> = {}
    const nextDeleteIds = new Set<string>()
    const nextRepairIds = new Set<string>()
    const nextActionShieldKinds: Partial<Record<string, 'copy' | 'delete' | 'move' | 'repair'>> =
      {}
    const nextActionShieldOpacities: Partial<Record<string, number>> = {}
    const moveTaskVisualRequests = new Map<string, NavigationItemMoveRequest>()
    const moveSourceIds = new Set<string>()

    if (enabled && robotMode === 'task') {
      for (const task of taskQueue) {
        const taskVisualKind = getNavigationQueuedTaskVisualKind(task)
        if (task.kind === 'move') {
          moveTaskVisualRequests.set(task.taskId, task.request)
          moveSourceIds.add(task.request.itemId)
        }
      }

      if (activeTaskId) {
        const activeTask = taskQueue.find((task) => task.taskId === activeTaskId) ?? null
        if (activeTask?.kind === 'move') {
          moveTaskVisualRequests.set(activeTask.taskId, activeTask.request)
          moveSourceIds.add(activeTask.request.itemId)
        } else if (activeTask) {
          const activeTaskVisualKind = getNavigationQueuedTaskVisualKind(activeTask)
          if (activeTaskVisualKind === 'delete') {
            nextDeleteIds.add(activeTask.request.itemId)
          } else if (activeTaskVisualKind === 'repair') {
            nextRepairIds.add(activeTask.request.itemId)
          }
        }
      }

      for (const request of moveTaskVisualRequests.values()) {
        navigationVisuals.setItemMoveVisualState(request.itemId, null)
        clearPersistentItemMoveVisualState(request.itemId)
        const queuedGhostIds = new Set<string>()
        const ensuredGhostId = ensureQueuedNavigationMoveGhostNode(request)
        if (ensuredGhostId) {
          queuedGhostIds.add(ensuredGhostId)
        }
        if (request.targetPreviewItemId) {
          queuedGhostIds.add(request.targetPreviewItemId)
        }

        for (const ghostId of queuedGhostIds) {
          nextMoveVisualStates[ghostId] = 'destination-ghost'
        }
      }

      for (const sourceItemId of moveSourceIds) {
        navigationVisuals.setItemMoveVisualState(sourceItemId, null)
        clearPersistentItemMoveVisualState(sourceItemId)
      }
    }

    for (const [itemId, previousKind] of Object.entries(previousActionShieldKinds)) {
      const nextKind = nextActionShieldKinds[itemId] ?? null
      if ((nextKind ?? null) !== previousKind) {
        navigationVisuals.setActionShieldKind(itemId, nextKind)
      }
    }

    for (const [itemId, nextKind] of Object.entries(nextActionShieldKinds)) {
      const previousKind = previousActionShieldKinds[itemId] ?? null
      const resolvedNextKind = nextKind ?? null
      if (previousKind !== resolvedNextKind) {
        navigationVisuals.setActionShieldKind(itemId, resolvedNextKind)
      }
    }

    for (const [itemId, previousState] of Object.entries(previousMoveVisualStates)) {
      const nextState = nextMoveVisualStates[itemId] ?? null
      if (nextState === previousState) {
        continue
      }

      const currentState = navigationVisuals.itemMoveVisualStates[itemId] ?? null
      if (currentState === previousState) {
        navigationVisuals.setItemMoveVisualState(itemId, nextState)
      }
      if (nextState === null) {
        clearPersistentItemMoveVisualState(itemId)
        if (previousState === 'destination-ghost') {
          removeTransientNavigationPreviewNode(itemId)
        }
      }
    }

    for (const [itemId, nextState] of Object.entries(nextMoveVisualStates)) {
      if (!nextState) {
        continue
      }

      const previousState = previousMoveVisualStates[itemId] ?? null
      if (previousState === nextState) {
        continue
      }

      const currentState = navigationVisuals.itemMoveVisualStates[itemId] ?? null
      if (
        currentState === null ||
        currentState === 'copy-source-pending' ||
        currentState === 'destination-ghost' ||
        currentState === 'destination-preview' ||
        currentState === 'source-pending'
      ) {
        navigationVisuals.setItemMoveVisualState(itemId, nextState)
      }
      setPersistentItemMoveVisualState(itemId, nextState)
    }

    for (const itemId of previousDeleteIds) {
      if (!nextDeleteIds.has(itemId)) {
        navigationVisuals.clearItemDelete(itemId)
      }
    }

    for (const itemId of nextDeleteIds) {
      if (!navigationVisuals.itemDeleteActivations[itemId]) {
        navigationVisuals.activateItemDelete(itemId)
      }
    }

    for (const itemId of previousRepairIds) {
      if (!nextRepairIds.has(itemId)) {
        navigationVisuals.clearRepairShield(itemId)
      }
    }

    for (const itemId of nextRepairIds) {
      if (!navigationVisuals.repairShieldActivations[itemId]) {
        navigationVisuals.activateRepairShield(itemId)
      }
    }

    for (const [itemId, previousOpacity] of Object.entries(previousActionShieldOpacities)) {
      const nextOpacity = nextActionShieldOpacities[itemId] ?? null
      if ((nextOpacity ?? null) !== previousOpacity) {
        navigationVisuals.setActionShieldOpacity(itemId, nextOpacity)
      }
    }

    for (const [itemId, nextOpacity] of Object.entries(nextActionShieldOpacities)) {
      const previousOpacity = previousActionShieldOpacities[itemId] ?? null
      const resolvedNextOpacity = nextOpacity ?? null
      if (previousOpacity !== resolvedNextOpacity) {
        navigationVisuals.setActionShieldOpacity(itemId, resolvedNextOpacity)
      }
    }

    taskQueueSyncedMoveVisualStatesRef.current = nextMoveVisualStates
    taskQueueSyncedDeleteIdsRef.current = nextDeleteIds
    taskQueueSyncedRepairIdsRef.current = nextRepairIds
    taskQueueSyncedActionShieldKindsRef.current = nextActionShieldKinds
    taskQueueSyncedActionShieldOpacitiesRef.current = nextActionShieldOpacities
    recordTaskModeTrace(
      'navigation.taskQueueVisualSync',
      {
        activeTaskId,
        actionShieldCount: Object.keys(nextActionShieldKinds).length,
        deleteCount: nextDeleteIds.size,
        ghostIds: Object.entries(nextMoveVisualStates)
          .filter(([, state]) => state === 'destination-ghost')
          .map(([id]) => id),
        moveVisualCount: Object.keys(nextMoveVisualStates).length,
        queueLength: taskQueue.length,
        repairCount: nextRepairIds.size,
      },
      { includeSnapshot: true },
    )
  }, [
    activeTaskId,
    enabled,
    recordTaskModeTrace,
    robotMode,
    taskLoopSettledToken,
    taskLoopToken,
    taskQueue,
  ])

  const taskQueueSourceMarkerSpecs = useMemo(
    () => getTaskQueueSourceMarkerSpecs(taskQueue, activeTaskId, enabled, robotMode),
    [activeTaskId, enabled, robotMode, taskQueue],
  )

  const actorSpawnPosition =
    enabled &&
    (pascalTruckIntroActive || introAnimationDebugActive) &&
    !pascalTruckIntroCompleted &&
    pascalTruckIntroPlan
      ? pascalTruckIntroPlan.startPosition
      : defaultActorSpawnPosition
  const pascalTruckEntryClipPlayback = useMemo(
    () =>
      pascalTruckIntroActive || introAnimationDebugActive
        ? {
            clipName: PASCAL_TRUCK_ENTRY_CLIP_NAME,
            holdLastFrame: true,
            loop: 'once' as const,
            revealFromStart: true,
            timeScale: 1,
          }
        : null,
    [introAnimationDebugActive, pascalTruckIntroActive],
  )
  const actorForcedClipPlayback = pascalTruckEntryClipPlayback ?? itemMoveForcedClipPlayback
  useEffect(() => {
    const actorObjectIds = new Set<number>()
    actorGroupRef.current?.traverse((object) => {
      if (typeof object.id === 'number') {
        actorObjectIds.add(object.id)
      }
    })
    actorObjectIdSetRef.current = actorObjectIds
  }, [actorRobotWarmupReady])

  useEffect(() => {
    const actorGroup = actorGroupRef.current
    if (!actorGroup) {
      return
    }

    actorGroup.userData.pascalNavigationActorRoot = true
    return () => {
      delete actorGroup.userData.pascalNavigationActorRoot
    }
  }, [])

  useEffect(() => {
    const warmupScope = async (run: () => void | Promise<void>) => {
      const actorGroup = actorGroupRef.current
      if (!actorGroup) {
        return false
      }

      const introPlan = pascalTruckIntroPlanRef.current
      const previousVisible = actorGroup.visible
      const previousPosition = actorGroup.position.clone()
      const previousRotationY = actorGroup.rotation.y
      const shadowMap = (gl as typeof gl & { shadowMap?: RendererShadowMap }).shadowMap
      const previousShadowAutoUpdate = shadowMap?.autoUpdate ?? null
      const previousShadowEnabled = shadowMap?.enabled ?? null
      const previousShadowNeedsUpdate = shadowMap?.needsUpdate ?? null
      actorGroup.visible = true
      if (introPlan) {
        actorGroup.position.set(
          introPlan.startPosition[0],
          introPlan.startPosition[1],
          introPlan.startPosition[2],
        )
        actorGroup.rotation.y = introPlan.rotationY
      }
      if (shadowMap) {
        shadowMap.enabled = true
        shadowMap.autoUpdate = false
        shadowMap.needsUpdate = true
      }
      try {
        actorGroup.updateMatrixWorld(true)
        await run()
        return true
      } finally {
        actorGroup.visible = previousVisible
        actorGroup.position.copy(previousPosition)
        actorGroup.rotation.y = previousRotationY
        if (shadowMap) {
          shadowMap.autoUpdate = previousShadowAutoUpdate ?? shadowMap.autoUpdate
          shadowMap.enabled = previousShadowEnabled ?? shadowMap.enabled
          shadowMap.needsUpdate = previousShadowNeedsUpdate ?? false
        }
        actorGroup.updateMatrixWorld(true)
      }
    }

    navigationVisualsStore.getState().setNavigationPostWarmupScope(warmupScope)
    return () => {
      if (navigationVisualsStore.getState().navigationPostWarmupScope === warmupScope) {
        navigationVisualsStore.getState().setNavigationPostWarmupScope(null)
      }
    }
  }, [gl])

  useFrame(() => {
    if (navigationRuntimeActive) {
      return
    }

    camera.getWorldPosition(navigationPostWarmupCameraPositionRef.current)
    camera.getWorldQuaternion(navigationPostWarmupCameraQuaternionRef.current)
    const position = navigationPostWarmupCameraPositionRef.current
    const quaternion = navigationPostWarmupCameraQuaternionRef.current
    const cameraSignature = [
      roundWarmupCameraValue(position.x),
      roundWarmupCameraValue(position.y),
      roundWarmupCameraValue(position.z),
      roundWarmupCameraValue(quaternion.x),
      roundWarmupCameraValue(quaternion.y),
      roundWarmupCameraValue(quaternion.z),
      roundWarmupCameraValue(quaternion.w),
      'fov' in camera ? roundWarmupCameraValue(camera.fov) : 0,
      'zoom' in camera ? roundWarmupCameraValue(camera.zoom) : 1,
    ].join(',')

    const now = performance.now()
    if (cameraSignature !== navigationPostWarmupPendingCameraSignatureRef.current) {
      navigationPostWarmupPendingCameraSignatureRef.current = cameraSignature
      navigationPostWarmupPendingCameraSinceRef.current = now
      return
    }

    if (cameraDragging) {
      return
    }

    if (
      now - navigationPostWarmupPendingCameraSinceRef.current <
      NAVIGATION_POST_WARMUP_CAMERA_STABLE_MS
    ) {
      return
    }

    if (navigationPostWarmupCameraSignatureRef.current === cameraSignature) {
      return
    }

    navigationPostWarmupCameraSignatureRef.current = cameraSignature
    startTransition(() => {
      setNavigationPostWarmupCameraSignature(cameraSignature)
    })
  })

  const navigationPostWarmupIntroSignature = pascalTruckIntroPlan
    ? [
        ...pascalTruckIntroPlan.startPosition.map(roundWarmupCameraValue),
        roundWarmupCameraValue(pascalTruckIntroPlan.rotationY),
      ].join(',')
    : 'no-intro-plan'
  const navigationPostWarmupRequestKey = [
    actorRobotWarmupReady ? '1' : '0',
    navigationPostWarmupCameraSignature,
    navigationPostWarmupIntroSignature,
    selection.buildingId ?? 'null',
    sceneState.rootNodeIds.join('|'),
  ].join('::')
  const lastNavigationPostWarmupRequestKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (
      !(
        actorRobotWarmupReady &&
        actorGroupRef.current &&
        !navigationRuntimeActive &&
        navigationPostWarmupCameraSignature !== 'uninitialized'
      )
    ) {
      return
    }

    if (lastNavigationPostWarmupRequestKeyRef.current === navigationPostWarmupRequestKey) {
      return
    }

    lastNavigationPostWarmupRequestKeyRef.current = navigationPostWarmupRequestKey
    const token = navigationVisualsStore.getState().requestNavigationPostWarmup()
    recordNavigationPerfMark('navigation.postWarmupRequest', {
      token,
      trigger: 'baseline',
    })
  }, [
    actorRobotWarmupReady,
    navigationPostWarmupCameraSignature,
    navigationPostWarmupRequestKey,
    navigationRuntimeActive,
  ])

  const getResolvedActorWorldPosition = useCallback(() => {
    const pendingPascalTruckIntroSettlePosition = pascalTruckIntroPendingSettlePositionRef.current
    if (pendingPascalTruckIntroSettlePosition) {
      return pendingPascalTruckIntroSettlePosition
    }

    const actorGroup = actorGroupRef.current
    if (actorGroup && actorPositionInitializedRef.current) {
      return [actorGroup.position.x, actorGroup.position.y, actorGroup.position.z] as [
        number,
        number,
        number,
      ]
    }

    return lastPublishedActorPositionRef.current ?? actorSpawnPosition
  }, [actorSpawnPosition])
  const getResolvedActorVisualWorldPosition = useCallback(() => {
    const pendingPascalTruckIntroSettlePosition = pascalTruckIntroPendingSettlePositionRef.current
    if (pendingPascalTruckIntroSettlePosition) {
      return pendingPascalTruckIntroSettlePosition
    }

    const actorGroup = actorGroupRef.current
    if (actorGroup && actorPositionInitializedRef.current) {
      return [
        actorGroup.position.x + motionRef.current.rootMotionOffset[0],
        actorGroup.position.y,
        actorGroup.position.z + motionRef.current.rootMotionOffset[2],
      ] as [number, number, number]
    }

    return lastPublishedActorPositionRef.current ?? actorSpawnPosition
  }, [actorSpawnPosition])
  const getActorNavigationPlanningState = useCallback(
    (planningGraph: NavigationGraph, preferredLevelId?: LevelNode['id'] | null) => {
      // Re-derive the actor on the current planning graph so task-mode graph rebuilds
      // cannot reuse a stale cell/component pair from the previous graph.
      const actorWorldPosition = getResolvedActorVisualWorldPosition()
      const actorNavigationPoint = actorWorldPosition
        ? ([actorWorldPosition[0], actorWorldPosition[1] - ACTOR_HOVER_Y, actorWorldPosition[2]] as [
            number,
            number,
            number,
          ])
        : null
      const actorStartCellIndexWithoutComponentFilter =
        actorNavigationPoint !== null
          ? findClosestNavigationCell(
              planningGraph,
              actorNavigationPoint,
              preferredLevelId ?? undefined,
              null,
            )
          : planningGraph === graph
            ? actorCellIndex
            : null
      const actorStartCellIndex =
        actorStartCellIndexWithoutComponentFilter ??
        (planningGraph === graph ? actorCellIndex : null)
      const actorStartComponentId =
        actorStartCellIndex !== null
          ? (planningGraph.componentIdByCell[actorStartCellIndex] ?? null)
          : null
      const actorStartLevelId =
        preferredLevelId ??
        (actorStartCellIndex !== null
          ? (toLevelNodeId(planningGraph.cells[actorStartCellIndex]?.levelId) ?? null)
          : null)

      return {
        actorNavigationPoint,
        actorStartCellIndex,
        actorStartCellIndexWithoutComponentFilter,
        actorStartComponentId,
        actorStartLevelId,
      }
    },
    [actorCellIndex, getResolvedActorVisualWorldPosition, graph],
  )

  useEffect(() => {
    setIntroAnimationDebugActive(false)
  }, [])

  useEffect(() => {
    return () => {
      cancelItemMovePreviewPlanWarmup()
    }
  }, [cancelItemMovePreviewPlanWarmup])

  useEffect(() => {
    cancelItemMovePreviewPlanWarmup()

    if (!(enabled && graph && itemMovePreviewActive && movingItemNode && itemMovePreview)) {
      itemMovePreviewPlanRef.current = null
      return
    }

    const movingNodeMetadata =
      typeof movingItemNode.metadata === 'object' &&
      movingItemNode.metadata !== null &&
      !Array.isArray(movingItemNode.metadata)
        ? (movingItemNode.metadata as Record<string, unknown>)
        : null
    const robotCopySourceId =
      typeof movingNodeMetadata?.robotCopySourceId === 'string'
        ? (movingNodeMetadata.robotCopySourceId as ItemNode['id'])
        : null
    const requestSourceId = robotCopySourceId ?? movingItemNode.id
    const requestSourceNode = sceneState.nodes[requestSourceId]
    const previewTargetNode = sceneState.nodes[itemMovePreview.id]
    if (!(requestSourceNode?.type === 'item' && previewTargetNode?.type === 'item')) {
      itemMovePreviewPlanRef.current = null
      return
    }

    const { actorNavigationPoint, actorStartCellIndex, actorStartComponentId } =
      getActorNavigationPlanningState(
        graph,
        selection.levelId ?? toLevelNodeId(requestSourceNode.parentId) ?? null,
      )
    if (actorStartCellIndex === null) {
      itemMovePreviewPlanRef.current = null
      return
    }

    const previewRequest: NavigationItemMoveRequest = {
      finalUpdate: {
        position: [...previewTargetNode.position] as [number, number, number],
        rotation: [...previewTargetNode.rotation] as [number, number, number],
      },
      itemDimensions: getScaledDimensions(requestSourceNode),
      itemId: requestSourceId,
      levelId: requestSourceNode.parentId,
      sourcePosition: [...requestSourceNode.position] as [number, number, number],
      sourceRotation: [...requestSourceNode.rotation] as [number, number, number],
      targetPreviewItemId: robotCopySourceId ? previewTargetNode.id : null,
      visualItemId: robotCopySourceId ? previewTargetNode.id : requestSourceId,
    }
    const previewPlanCacheKey = createNavigationItemMovePlanCacheKey(
      previewRequest,
      actorStartCellIndex,
      navigationSceneSnapshot?.key ?? null,
      selection.buildingId ?? null,
    )
    if (itemMovePreviewPlanRef.current?.cacheKey === previewPlanCacheKey) {
      return
    }
    const cachedPreviewPlan = itemMovePreviewPlanCacheRef.current.get(previewPlanCacheKey) ?? null
    if (cachedPreviewPlan) {
      itemMovePreviewPlanRef.current = cachedPreviewPlan
      return
    }

    let cancelled = false
    itemMovePreviewPlanWarmTimeoutRef.current = window.setTimeout(() => {
      itemMovePreviewPlanWarmTimeoutRef.current = null
      if (cancelled) {
        return
      }

      const previewPlan = measureNavigationPerf('navigation.itemMovePreviewPlanBuildMs', () =>
        resolveItemMovePlan(
          previewRequest,
          actorStartCellIndex,
          actorNavigationPoint,
          actorStartComponentId,
          {
            recordFallbackMeta: false,
            targetGraphPerfMetricName: 'navigation.itemMovePreviewTargetGraphBuildMs',
          },
        ),
      )

      if (!cancelled && previewPlan) {
        const resolvedPreviewPlan = {
          cacheKey: previewPlanCacheKey,
          ...previewPlan,
        }
        itemMovePreviewPlanRef.current = resolvedPreviewPlan
        cacheItemMovePreviewPlan(resolvedPreviewPlan)
      }
    }, ITEM_MOVE_PREVIEW_PLAN_DEBOUNCE_MS)

    return () => {
      cancelled = true
      cancelItemMovePreviewPlanWarmup()
    }
  }, [
    cancelItemMovePreviewPlanWarmup,
    enabled,
    graph,
    getActorNavigationPlanningState,
    itemMovePreview,
    itemMovePreviewActive,
    cacheItemMovePreviewPlan,
    movingItemNode,
    navigationSceneSnapshot?.key,
    resolveItemMovePlan,
    sceneState.nodes,
    selection.buildingId,
    selection.levelId,
  ])

  useEffect(() => {
    const clearIntroTaskReadyTimeout = () => {
      const timeoutId = pascalTruckIntroTaskReadyTimeoutRef.current
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
        pascalTruckIntroTaskReadyTimeoutRef.current = null
      }
    }

    if (!pascalTruckIntroCompleted) {
      clearIntroTaskReadyTimeout()
      setPascalTruckIntroTaskReady(false)
      return
    }

    setPascalTruckIntroTaskReady(false)
    pascalTruckIntroTaskReadyTimeoutRef.current = window.setTimeout(() => {
      pascalTruckIntroTaskReadyTimeoutRef.current = null
      setPascalTruckIntroTaskReady(true)
    }, PASCAL_TRUCK_ENTRY_RELEASE_DURATION_MS)

    return clearIntroTaskReadyTimeout
  }, [pascalTruckIntroCompleted])

  useEffect(() => {
    void sceneState.nodes
    void sceneState.rootNodeIds
    shadowControllerRef.current.dynamicSettleFrames = Math.max(
      shadowControllerRef.current.dynamicSettleFrames,
      STATIC_SHADOW_DYNAMIC_SETTLE_FRAMES,
    )
    shadowControllerRef.current.lastDynamicUpdateAtMs = 0
  }, [sceneState.nodes, sceneState.rootNodeIds])

  useEffect(() => {
    const shadowMap = (gl as typeof gl & { shadowMap?: RendererShadowMap }).shadowMap
    return () => {
      if (!shadowMap) {
        return
      }

      shadowMap.enabled = true
      shadowMap.autoUpdate = true
      shadowMap.needsUpdate = true
    }
  }, [gl])

  const resetMotion = useCallback((clearActorPosition = false) => {
    motionRef.current = createActorMotionState()
    motionWriteSourceRef.current = 'resetMotion'
    pascalTruckIntroPendingSettlePositionRef.current = null
    doorCollisionStateRef.current = {
      blocked: false,
      doorIds: [],
    }
    pendingMotionRef.current = null
    setActorMoving(false)
    setPathGraphOverride(null)
    setPathIndices([])
    setPathAnchorWorldPosition(null)

    if (clearActorPosition) {
      actorPositionInitializedRef.current = false
      lastPublishedActorPositionRef.current = null
      setActorAvailable(false)
      setActorWorldPosition(null)
      navigationEmitter.emit('navigation:actor-transform', {
        moving: false,
        position: null,
        rotationY: 0,
      })
    }
  }, [])

  const setMotionState = useCallback((nextMotionState: ActorMotionState, source: string) => {
    const introActive = pascalTruckIntroRef.current !== null
    const allowDuringIntro =
      source === 'pascalTruckIntro:start' ||
      source === 'pascalTruckIntro:frame' ||
      source === 'pascalTruckIntro:complete'
    if (introActive && !allowDuringIntro) {
      return false
    }

    motionRef.current = nextMotionState
    motionWriteSourceRef.current = source
    return true
  }, [])

  const beginPascalTruckIntro = useCallback(() => {
    const taskModePlanningBlocked = robotMode === 'task' && !taskQueuePlanningReady
    if (
      introAnimationDebugActive ||
      !enabled ||
      pascalTruckIntroRef.current ||
      !pascalTruckIntroPlan ||
      taskModePlanningBlocked
    ) {
      recordTaskModeTrace('navigation.beginPascalTruckIntroSkipped', {
        enabled,
        hasPlanningReady: taskQueuePlanningReady,
        introAnimationDebugActive,
        hasIntroPlan: Boolean(pascalTruckIntroPlan),
        introAlreadyActive: pascalTruckIntroRef.current !== null,
        robotMode,
      })
      return false
    }

    recordTaskModeTrace('navigation.beginPascalTruckIntroStart', {}, { includeSnapshot: true })
    setMotionState(
      {
        ...createActorMotionState(),
        destinationCellIndex: pascalTruckIntroPlan.finalCellIndex,
        forcedClip: {
          clipName: PASCAL_TRUCK_ENTRY_CLIP_NAME,
          holdLastFrame: true,
          loop: 'once',
          paused: true,
          revealProgress: 0,
          seekTime: 0,
          timeScale: 1,
        },
      },
      'pascalTruckIntro:start',
    )
    doorCollisionStateRef.current = {
      blocked: false,
      doorIds: [],
    }
    pendingMotionRef.current = null
    setActorMoving(false)
    setPathIndices([])
    setPathAnchorWorldPosition(null)
    actorPositionInitializedRef.current = false
    lastPublishedActorPositionRef.current = null
    lastPublishedActorPositionAtRef.current = performance.now()
    setActorAvailable(false)
    setActorWorldPosition(null)
    setPascalTruckIntroCompleted(false)
    pascalTruckIntroRef.current = {
      ...pascalTruckIntroPlan,
      animationElapsedMs: 0,
      animationStarted: false,
      handoffPending: false,
      revealElapsedMs: 0,
      revealStarted: false,
    }
    pascalTruckIntroPostWarmupTokenRef.current = null
    pascalTruckIntroPendingSettlePositionRef.current = null
    setPascalTruckIntroActive(true)
    return true
  }, [
    enabled,
    introAnimationDebugActive,
    pascalTruckIntroPlan,
    recordTaskModeTrace,
    robotMode,
    setActorAvailable,
    setActorWorldPosition,
    setMotionState,
    taskQueuePlanningReady,
  ])

  const setItemMoveGesturePlayback = useCallback((gesture: NavigationItemMoveGesture | null) => {
    setItemMoveForcedClipPlayback((currentPlayback) => {
      if (!gesture) {
        return currentPlayback === null ? currentPlayback : null
      }

      if (
        currentPlayback?.clipName === gesture.clipName &&
        currentPlayback.stabilizeRootMotion === true
      ) {
        return currentPlayback
      }

      return {
        clipName: gesture.clipName,
        loop: 'once',
        revealFromStart: false,
        stabilizeRootMotion: true,
        timeScale: 1,
      }
    })
  }, [])

  const clearItemMoveGestureClipState = useCallback(() => {
    motionRef.current.forcedClip = null
    setItemMoveGesturePlayback(null)
  }, [setItemMoveGesturePlayback])

  const syncItemMoveGestureClipState = useCallback(
    (gesture: NavigationItemMoveGesture, progress: number) => {
      const clampedProgress = MathUtils.clamp(progress, 0, 1)
      motionRef.current.forcedClip = {
        clipName: gesture.clipName,
        holdLastFrame: false,
        loop: 'once',
        paused: true,
        revealProgress: 1,
        seekTime: gesture.durationSeconds * clampedProgress,
        timeScale: 1,
      }
      setItemMoveGesturePlayback(gesture)
    },
    [setItemMoveGesturePlayback],
  )

  useEffect(() => {
    const sceneGraphEmpty =
      sceneState.rootNodeIds.length === 0 || Object.keys(sceneState.nodes).length === 0

    if (sceneGraphEmpty) {
      pascalTruckIntroRef.current = null
      pascalTruckIntroPostWarmupTokenRef.current = null
      pascalTruckExitRef.current = null
      pendingPascalTruckExitRef.current = null
      precomputedPascalTruckExitRef.current = null
      itemDeleteSequenceRef.current = null
      itemRepairSequenceRef.current = null
      clearItemMoveGestureClipState()
      resetTaskQueueVisuals()
      useNavigation.setState({
        activeTaskId: null,
        activeTaskIndex: 0,
        itemDeleteRequest: null,
        itemMoveControllers: {},
        itemMoveRequest: null,
        itemRepairRequest: null,
        taskQueue: [],
      })
      setPascalTruckIntroActive(false)
      setPascalTruckExitActive(false)
      setPascalTruckIntroCompleted(false)
      setToolCarryItemId(null)
      setActorCellIndex(null)
      resetMotion(true)
      return
    }

    // Task-mode graph refreshes can temporarily clear the prewarmed graph while
    // a new snapshot is being built. Preserve the active queue through that
    // gap instead of treating it as a full runtime teardown.
    if (!graph) {
      return
    }

    if (enabled && !pascalTruckIntroCompleted) {
      if (
        pascalTruckIntroPlan &&
        pascalTruckIntroPlan.finalCellIndex !== null &&
        actorCellIndex !== pascalTruckIntroPlan.finalCellIndex
      ) {
        setActorCellIndex(pascalTruckIntroPlan.finalCellIndex)
      }
      return
    }

    const currentActorWorldPosition = getResolvedActorWorldPosition()
    const actorNavigationPoint = currentActorWorldPosition
      ? ([
          currentActorWorldPosition[0],
          currentActorWorldPosition[1] - ACTOR_HOVER_Y,
          currentActorWorldPosition[2],
        ] as [number, number, number])
      : null
    const remappedActorCellIndex =
      actorNavigationPoint !== null
        ? findClosestNavigationCell(
            graph,
            actorNavigationPoint,
            selection.levelId ?? undefined,
            null,
          )
        : null

    if (remappedActorCellIndex !== null) {
      if (actorCellIndex !== remappedActorCellIndex) {
        setActorCellIndex(remappedActorCellIndex)
      }
      return
    }

    resetMotion()
    setActorCellIndex(getInitialActorCellIndex(graph, selection.levelId) ?? null)
  }, [
    actorCellIndex,
    clearItemMoveGestureClipState,
    enabled,
    getResolvedActorWorldPosition,
    graph,
    sceneState.nodes,
    sceneState.rootNodeIds,
    pascalTruckIntroCompleted,
    pascalTruckIntroPlan,
    resetTaskQueueVisuals,
    resetMotion,
    selection.levelId,
  ])

  useEffect(() => {
    const previousRobotMode = previousRobotModeRef.current
    previousRobotModeRef.current = robotMode
    const robotModeSwitchRequiresReset =
      previousRobotMode !== null && robotMode !== null && previousRobotMode !== robotMode

    if (enabled && !robotModeSwitchRequiresReset) {
      return
    }

    const navigationState = useNavigation.getState()
    const navigationVisualState = navigationVisualsStore.getState()
    const hasNavigationStateToClear =
      navigationState.itemDeleteRequest !== null ||
      navigationState.itemMoveRequest !== null ||
      navigationState.itemRepairRequest !== null ||
      navigationState.taskQueue.length > 0 ||
      itemMoveControllerCount > 0
    const hasTaskQueueVisualsToClear =
      navigationVisualState.itemMovePreview !== null ||
      Object.keys(navigationVisualState.itemDeleteActivations).length > 0 ||
      Object.keys(navigationVisualState.repairShieldActivations).length > 0 ||
      Object.keys(navigationVisualState.actionShieldKinds).length > 0 ||
      Object.keys(navigationVisualState.actionShieldOpacities).length > 0
    const hasLocalStateToClear =
      pascalTruckIntroRef.current !== null ||
      pascalTruckExitRef.current !== null ||
      itemDeleteSequenceRef.current !== null ||
      itemRepairSequenceRef.current !== null ||
      itemMoveSequenceRef.current !== null ||
      releasedNavigationItemId !== null ||
      pascalTruckIntroActive ||
      pascalTruckExitActive ||
      pascalTruckIntroCompleted ||
      itemMoveLocked

    if (!hasNavigationStateToClear && !hasLocalStateToClear && !hasTaskQueueVisualsToClear) {
      return
    }

    pascalTruckIntroRef.current = null
    pascalTruckIntroPostWarmupTokenRef.current = null
    pascalTruckExitRef.current = null
    pendingPascalTruckExitRef.current = null
    precomputedPascalTruckExitRef.current = null
    itemDeleteSequenceRef.current = null
    itemRepairSequenceRef.current = null
    setReleasedNavigationItemId(null)
    clearItemMoveGestureClipState()
    resetTaskQueueVisuals()
    setPascalTruckIntroActive(false)
    setPascalTruckExitActive(false)
    setPascalTruckIntroCompleted(false)
    setToolCarryItemId(null)
    const activeItemMoveSequence = itemMoveSequenceRef.current
    itemMoveSequenceRef.current = null
    activeItemMoveSequence?.controller.cancel()
    Object.values(itemMoveControllers).forEach((controller) => {
      controller?.cancel()
    })
    if (hasNavigationStateToClear) {
      useNavigation.setState({
        activeTaskId: null,
        activeTaskIndex: 0,
        itemDeleteRequest: null,
        itemMoveControllers: {},
        itemMoveRequest: null,
        itemRepairRequest: null,
        taskQueue: [],
      })
    }
    setItemMoveLocked(false)
    resetMotion(true)
  }, [
    clearItemMoveGestureClipState,
    enabled,
    itemMoveControllers,
    itemMoveControllerCount,
    itemMoveLocked,
    pascalTruckExitActive,
    pascalTruckIntroActive,
    pascalTruckIntroCompleted,
    releasedNavigationItemId,
    resetTaskQueueVisuals,
    robotMode,
    resetMotion,
    setItemMoveLocked,
  ])

  useEffect(() => {
    return () => {
      resetTaskQueueVisuals()
    }
  }, [resetTaskQueueVisuals])

  const simplifiedPathIndices = useMemo(
    () =>
      pathGraph
        ? measureNavigationPerf('navigation.pathSimplifyMs', () =>
            simplifyNavigationPath(pathGraph, pathIndices),
          )
        : [],
    [pathGraph, pathIndices],
  )
  const doorTransitions = useMemo(
    () => (pathGraph ? getNavigationDoorTransitions(pathGraph, pathIndices) : []),
    [pathGraph, pathIndices],
  )
  const rawPathPoints = useMemo(() => {
    if (!pathGraph) {
      return []
    }

    const worldPoints = getNavigationPathWorldPoints(pathGraph, pathIndices)
    if (!pathTargetWorldPosition) {
      return worldPoints
    }

    const lastWorldPoint = worldPoints.at(-1)
    if (!lastWorldPoint) {
      return [pathTargetWorldPosition]
    }

    const endJoinDistance = Math.max(0.08, (pathGraph.cellSize ?? 0.2) * 0.85)
    if (
      Math.hypot(
        lastWorldPoint[0] - pathTargetWorldPosition[0],
        lastWorldPoint[1] - pathTargetWorldPosition[1],
        lastWorldPoint[2] - pathTargetWorldPosition[2],
      ) <= endJoinDistance
    ) {
      worldPoints[worldPoints.length - 1] = pathTargetWorldPosition
      return worldPoints
    }

    return [...worldPoints, pathTargetWorldPosition]
  }, [pathGraph, pathIndices, pathTargetWorldPosition])
  useEffect(() => {
    if (pathIndices.length === 0 && pathTargetWorldPosition !== null) {
      setPathTargetWorldPosition(null)
    }
  }, [pathIndices.length, pathTargetWorldPosition])
  useEffect(() => {
    if (pathIndices.length === 0 && pathGraphOverride !== null) {
      setPathGraphOverride(null)
    }
  }, [pathGraphOverride, pathIndices.length])
  const protectedPathPointKeys = useMemo(
    () =>
      new Set(
        doorTransitions.flatMap((transition) => [
          getNavigationPointKey(transition.approachWorld),
          getNavigationPointKey(transition.entryWorld),
          getNavigationPointKey(transition.world),
          getNavigationPointKey(transition.exitWorld),
          getNavigationPointKey(transition.departureWorld),
        ]),
      ),
    [doorTransitions],
  )
  const pathComponentId = useMemo(() => {
    if (!pathGraph) {
      return null
    }

    const firstPathCellIndex = pathIndices[0]
    if (firstPathCellIndex === undefined) {
      return actorComponentId
    }

    return pathGraph.componentIdByCell[firstPathCellIndex] ?? actorComponentId
  }, [actorComponentId, pathGraph, pathIndices])
  const isPathPointSupported = useCallback(
    (point: Vector3) => {
      if (!pathGraph) {
        return true
      }

      return isNavigationPointSupported(pathGraph, [point.x, point.y, point.z], pathComponentId)
    },
    [pathComponentId, pathGraph],
  )
  const rawElevatedPathPoints = useMemo(
    () =>
      measureNavigationPerf('navigation.pathElevateMs', () => {
        const elevatedPoints = rawPathPoints.map(([x, y, z]) => new Vector3(x, y, z))
        const anchoredStartPoint = pathAnchorWorldPosition
          ? new Vector3(
              pathAnchorWorldPosition[0],
              pathAnchorWorldPosition[1] - ACTOR_HOVER_Y,
              pathAnchorWorldPosition[2],
            )
          : null

        if (anchoredStartPoint && elevatedPoints.length > 0) {
          const startJoinDistance = Math.max(0.08, (pathGraph?.cellSize ?? 0.2) * 0.85)
          const firstElevatedPoint = elevatedPoints[0]
          if (
            firstElevatedPoint &&
            anchoredStartPoint.distanceTo(firstElevatedPoint) <= startJoinDistance
          ) {
            elevatedPoints[0] = anchoredStartPoint
          } else {
            elevatedPoints.unshift(anchoredStartPoint)
          }
        }

        return elevatedPoints
      }),
    [pathAnchorWorldPosition, pathGraph?.cellSize, rawPathPoints],
  )
  const smoothedPathPoints = useMemo(
    () =>
      measureNavigationPerf('navigation.pathSmoothMs', () =>
        smoothPathWithinCorridor(rawElevatedPathPoints, protectedPathPointKeys),
      ),
    [protectedPathPointKeys, rawElevatedPathPoints],
  )
  const candidatePathCurve = useMemo(
    () =>
      measureNavigationPerf('navigation.pathCurveBuildMs', () =>
        buildPathCurve(smoothedPathPoints, doorTransitions, isPathPointSupported),
      ),
    [doorTransitions, isPathPointSupported, smoothedPathPoints],
  )
  debugDoorTransitionsRef.current = doorTransitions
  const candidatePathCollisionAudit = useMemo(
    () =>
      measureNavigationPerf('navigation.pathCollisionAuditMs', () =>
        auditNavigationCurveCollisions(pathGraph, candidatePathCurve, pathComponentId),
      ),
    [candidatePathCurve, pathGraph, pathComponentId],
  )
  const shouldBuildConservativePath =
    doorTransitions.length > 0 ||
    !candidatePathCurve ||
    candidatePathCollisionAudit.blockedSampleCount > 0
  const conservativePathCurve = useMemo(() => {
    if (!shouldBuildConservativePath) {
      return null
    }

    return measureNavigationPerf('navigation.pathConservativeCurveBuildMs', () =>
      buildPolylineCurve(rawElevatedPathPoints),
    )
  }, [rawElevatedPathPoints, shouldBuildConservativePath])
  const conservativePathCollisionAudit = useMemo(() => {
    if (!conservativePathCurve) {
      return EMPTY_NAVIGATION_PATH_COLLISION_AUDIT
    }

    return measureNavigationPerf('navigation.pathCollisionAuditMs', () =>
      auditNavigationCurveCollisions(pathGraph, conservativePathCurve, pathComponentId),
    )
  }, [conservativePathCurve, pathGraph, pathComponentId])
  const motionPathCurve = useMemo(() => {
    if (candidatePathCurve && candidatePathCollisionAudit.blockedSampleCount === 0) {
      return candidatePathCurve
    }

    if (conservativePathCurve && conservativePathCollisionAudit.blockedSampleCount === 0) {
      return conservativePathCurve
    }

    return candidatePathCurve ?? conservativePathCurve
  }, [
    candidatePathCollisionAudit.blockedSampleCount,
    candidatePathCurve,
    conservativePathCollisionAudit.blockedSampleCount,
    conservativePathCurve,
  ])
  const pathCurve = useMemo(
    () => candidatePathCurve ?? conservativePathCurve,
    [candidatePathCurve, conservativePathCurve],
  )
  debugPathCurveRef.current = pathCurve
  const pathLength = useMemo(() => pathCurve?.getLength() ?? 0, [pathCurve])
  const conservativePathLength = useMemo(
    () => conservativePathCurve?.getLength() ?? 0,
    [conservativePathCurve],
  )
  const primaryMotionCurve = motionPathCurve ?? conservativePathCurve
  const primaryMotionLength = useMemo(() => {
    if (!primaryMotionCurve) {
      return 0
    }

    return primaryMotionCurve === conservativePathCurve ? conservativePathLength : pathLength
  }, [conservativePathCurve, conservativePathLength, pathLength, primaryMotionCurve])
  const trajectoryMotionProfile = useMemo(
    () =>
      measureNavigationPerf('navigation.trajectoryMotionProfileMs', () =>
        buildTrajectoryMotionProfile(primaryMotionCurve, primaryMotionLength),
      ),
    [primaryMotionCurve, primaryMotionLength],
  )
  const pathTubeSegments = useMemo(
    () => Math.max(24, Math.ceil(pathLength / PATH_RENDER_SEGMENT_LENGTH)),
    [pathLength],
  )
  useEffect(() => {
    mergeNavigationPerfMeta({
      navigationPathBlockedObstacleCount:
        primaryMotionCurve === candidatePathCurve
          ? candidatePathCollisionAudit.blockedObstacleIds.length
          : conservativePathCollisionAudit.blockedObstacleIds.length,
      navigationPathBlockedSampleCount:
        primaryMotionCurve === candidatePathCurve
          ? candidatePathCollisionAudit.blockedSampleCount
          : conservativePathCollisionAudit.blockedSampleCount,
      navigationPathBlockedWallCount:
        primaryMotionCurve === candidatePathCurve
          ? candidatePathCollisionAudit.blockedWallIds.length
          : conservativePathCollisionAudit.blockedWallIds.length,
      navigationPathUsingConservativeCurve:
        Boolean(
          primaryMotionCurve &&
            conservativePathCurve &&
            primaryMotionCurve === conservativePathCurve,
        ) && primaryMotionCurve !== candidatePathCurve,
      navigationPathHighCurvatureSectionCount:
        trajectoryMotionProfile?.sections.filter((section) => section.kind === 'high').length ?? 0,
      navigationPathLowCurvatureSectionCount:
        trajectoryMotionProfile?.sections.filter((section) => section.kind === 'low').length ?? 0,
    })
  }, [
    candidatePathCollisionAudit.blockedObstacleIds.length,
    candidatePathCollisionAudit.blockedSampleCount,
    candidatePathCollisionAudit.blockedWallIds.length,
    candidatePathCurve,
    conservativePathCollisionAudit.blockedObstacleIds.length,
    conservativePathCollisionAudit.blockedSampleCount,
    conservativePathCollisionAudit.blockedWallIds.length,
    conservativePathCurve,
    primaryMotionCurve,
    trajectoryMotionProfile,
  ])
  const trajectoryRibbonGeometry = useMemo(() => {
    if (!(enabled && pathCurve)) {
      return null
    }

    return measureNavigationPerf('navigation.pathRibbonGeometryBuildMs', () =>
      buildFlatPathRibbonGeometry(pathCurve, pathTubeSegments, PATH_RENDER_THREAD_WIDTH),
    )
  }, [enabled, pathCurve, pathTubeSegments])
  const mainPathGeometry = useMemo(() => {
    if (!(PATH_STATIC_PREVIEW_MODE && pathCurve)) {
      return null
    }

    return measureNavigationPerf('navigation.pathMainGeometryBuildMs', () => {
      const splineCurveCount = pathCurve.curves.filter(
        (curve): curve is CatmullRomCurve3 => curve instanceof CatmullRomCurve3,
      ).length
      const lineCurveCount = pathCurve.curves.filter(
        (curve): curve is LineCurve3 => curve instanceof LineCurve3,
      ).length
      const quadraticCurveCount = pathCurve.curves.filter(
        (curve): curve is QuadraticBezierCurve3 => curve instanceof QuadraticBezierCurve3,
      ).length
      const geometry = new TubeGeometry(
        pathCurve,
        pathTubeSegments,
        PATH_STATIC_PREVIEW_MODE ? PATH_RENDER_STATIC_PREVIEW_MAIN_RADIUS : PATH_RENDER_MAIN_RADIUS,
        PATH_RENDER_MAIN_RADIAL_SEGMENTS,
        false,
      )
      mergeNavigationPerfMeta({
        navigationPathCurveCount: pathCurve.curves.length,
        navigationPathLineCurveCount: lineCurveCount,
        navigationPathLength: pathLength,
        navigationPathMainTriangles: pathTubeSegments * PATH_RENDER_MAIN_RADIAL_SEGMENTS * 2,
        navigationPathQuadraticCurveCount: quadraticCurveCount,
        navigationPathSplineCurveCount: splineCurveCount,
        navigationPathTubeSegments: pathTubeSegments,
      })
      return geometry
    })
  }, [pathCurve, pathLength, pathTubeSegments])
  const orbitPathGeometryA = useMemo(() => {
    if (!(PATH_RENDER_ORBITS_ENABLED && pathCurve)) {
      return null
    }

    return measureNavigationPerf('navigation.pathOrbitGeometryMs', () => {
      const geometry = buildOrbitRibbonGeometry(
        pathCurve,
        pathTubeSegments,
        PATH_RENDER_ORBIT_RIBBON_WIDTH,
        0,
      )
      if (!geometry) {
        return null
      }
      mergeNavigationPerfMeta({
        navigationPathOrbitCurveCount: 2,
        navigationPathOrbitTriangles: pathTubeSegments * 4,
      })
      return geometry
    })
  }, [pathCurve, pathTubeSegments])
  const orbitPathGeometryB = useMemo(() => {
    if (!(PATH_RENDER_ORBITS_ENABLED && pathCurve)) {
      return null
    }

    return measureNavigationPerf('navigation.pathOrbitGeometryMs', () =>
      buildOrbitRibbonGeometry(
        pathCurve,
        pathTubeSegments,
        PATH_RENDER_ORBIT_RIBBON_WIDTH,
        Math.PI,
      ),
    )
  }, [pathCurve, pathTubeSegments])
  const highlightPathTexture = useMemo(() => buildPathHighlightTexture(), [])
  const pathRenderSegments = useMemo(() => {
    if (!(PATH_STATIC_PREVIEW_MODE && pathCurve)) {
      return []
    }

    return measureNavigationPerf('navigation.pathMainGeometryBuildMs', () => {
      const splineCurveCount = pathCurve.curves.filter(
        (curve): curve is CatmullRomCurve3 => curve instanceof CatmullRomCurve3,
      ).length
      const lineCurveCount = pathCurve.curves.filter(
        (curve): curve is LineCurve3 => curve instanceof LineCurve3,
      ).length
      const quadraticCurveCount = pathCurve.curves.filter(
        (curve): curve is QuadraticBezierCurve3 => curve instanceof QuadraticBezierCurve3,
      ).length
      mergeNavigationPerfMeta({
        navigationPathCurveCount: pathCurve.curves.length,
        navigationPathLineCurveCount: lineCurveCount,
        navigationPathLength: pathLength,
        navigationPathMainTriangles:
          Math.max(PATH_STATIC_PREVIEW_FADE_SEGMENT_COUNT, Math.ceil(pathTubeSegments / 2)) *
          Math.max(
            3,
            Math.ceil(
              pathTubeSegments /
                Math.max(PATH_STATIC_PREVIEW_FADE_SEGMENT_COUNT, Math.ceil(pathTubeSegments / 2)),
            ),
          ) *
          PATH_RENDER_MAIN_RADIAL_SEGMENTS *
          2,
        navigationPathQuadraticCurveCount: quadraticCurveCount,
        navigationPathSplineCurveCount: splineCurveCount,
        navigationPathTubeSegments: pathTubeSegments,
      })
      return buildPathRenderSegments(
        pathCurve,
        pathTubeSegments,
        PATH_RENDER_STATIC_PREVIEW_MAIN_RADIUS,
      )
    })
  }, [pathCurve, pathLength, pathTubeSegments])
  const trajectoryRibbonMaterial = useMemo(() => {
    return createTrajectoryThreadMaterial()
  }, [])
  const basePathMaterial = useMemo(() => {
    const material = configureTrajectoryMaterial(
      new MeshBasicMaterial({
        color: new Color('#000000'),
        depthTest: false,
        depthWrite: false,
        opacity: 1,
        side: DoubleSide,
        transparent: true,
      }),
      basePathShaderRef,
      {
        discardHidden: true,
        endFadeLength: 0,
        frontFadeLength: 0,
        programKey: 'navigation-path-base',
      },
    )
    material.toneMapped = false
    return material
  }, [])
  const highlightPathMaterial = useMemo(() => {
    if (!highlightPathTexture) {
      return null
    }

    const material = configureTrajectoryMaterial(
      new MeshBasicMaterial({
        alphaMap: highlightPathTexture,
        color: new Color('#f5f7f8'),
        depthTest: false,
        depthWrite: false,
        opacity: PATH_MAIN_HIGHLIGHT_ALPHA,
        side: DoubleSide,
        transparent: true,
      }),
      highlightPathShaderRef,
      {
        endFadeLength: 0,
        frontFadeLength: 0,
        programKey: 'navigation-path-highlight',
      },
    )
    material.toneMapped = false
    return material
  }, [highlightPathTexture])
  const orbitPathMaterialA = useMemo(() => {
    const material = configureTrajectoryMaterial(
      new MeshBasicMaterial({
        blending: AdditiveBlending,
        color: new Color('#ffffff'),
        depthTest: false,
        depthWrite: false,
        fog: false,
        opacity: 1,
        side: DoubleSide,
        transparent: true,
        vertexColors: true,
      }),
      orbitPathShaderARef,
      {
        discardHidden: true,
        endFadeLength: 0,
        frontFadeLength: 0,
        programKey: 'navigation-path-orbit-a',
      },
    )
    material.toneMapped = false
    return material
  }, [])
  const orbitPathMaterialB = useMemo(() => {
    const material = configureTrajectoryMaterial(
      new MeshBasicMaterial({
        blending: AdditiveBlending,
        color: new Color('#ffffff'),
        depthTest: false,
        depthWrite: false,
        fog: false,
        opacity: 1,
        side: DoubleSide,
        transparent: true,
        vertexColors: true,
      }),
      orbitPathShaderBRef,
      {
        discardHidden: true,
        endFadeLength: 0,
        frontFadeLength: 0,
        programKey: 'navigation-path-orbit-b',
      },
    )
    material.toneMapped = false
    return material
  }, [])
  const pathMaterialWarmupGeometry = useMemo(() => {
    const geometry = new BufferGeometry()
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute(
        [-0.02, 0, 0, 0.02, 0, 0, 0.02, 0.04, 0, -0.02, 0, 0, 0.02, 0.04, 0, -0.02, 0.04, 0],
        3,
      ),
    )
    geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2))
    return geometry
  }, [])
  const pathShadersWarmedRef = useRef(false)
  const [pathShadersReady, setPathShadersReady] = useState(false)

  useEffect(() => {
    if (pathShadersWarmedRef.current) {
      return
    }

    pathShadersWarmedRef.current = true
    setPathShadersReady(false)
    const warmupRoot = new Group()
    const warmupMeshes = [
      new Mesh(pathMaterialWarmupGeometry, trajectoryRibbonMaterial),
      new Mesh(pathMaterialWarmupGeometry, basePathMaterial),
      new Mesh(pathMaterialWarmupGeometry, orbitPathMaterialA),
      new Mesh(pathMaterialWarmupGeometry, orbitPathMaterialB),
    ]

    for (const [index, mesh] of warmupMeshes.entries()) {
      mesh.position.set(0, 0, -index * 0.08)
      warmupRoot.add(mesh)
    }
    scene.add(warmupRoot)

    const warmupCamera = new PerspectiveCamera(50, 1, 0.01, 10)
    warmupCamera.position.set(0, 0.02, 1.35)
    warmupCamera.lookAt(0, 0.02, -0.12)
    warmupCamera.updateProjectionMatrix()
    warmupCamera.updateMatrixWorld(true)

    let cancelled = false
    const renderer = gl as unknown as {
      compileAsync?: (scene: Scene, camera: object) => Promise<unknown>
      render?: (scene: Scene, camera: object) => void
      setRenderTarget?: (target: RenderTarget | null) => void
    }
    const warmupStart = performance.now()
    const renderTarget = new RenderTarget(64, 64, { depthBuffer: true })

    const warmupShaders = async () => {
      try {
        try {
          await (renderer.compileAsync?.(scene as unknown as Scene, warmupCamera) ??
            Promise.resolve())
        } catch {}

        recordNavigationPerfSample(
          'navigation.pathRenderWarmupCompileAsyncWallMs',
          performance.now() - warmupStart,
        )

        if (cancelled) {
          return
        }

        const renderStart = performance.now()
        renderer.setRenderTarget?.(renderTarget)
        renderer.render?.(scene as unknown as Scene, warmupCamera)
        recordNavigationPerfSample(
          'navigation.pathRenderWarmupRenderMs',
          performance.now() - renderStart,
        )
        recordNavigationPerfSample('navigation.pathRenderWarmupMs', performance.now() - warmupStart)
        if (!cancelled) {
          setPathShadersReady(true)
        }
      } catch {
      } finally {
        renderer.setRenderTarget?.(null)
        renderTarget.dispose()
        warmupMeshes.forEach((mesh) => {
          warmupRoot.remove(mesh)
        })
        scene.remove(warmupRoot)
      }
    }

    void warmupShaders()

    return () => {
      cancelled = true
      scene.remove(warmupRoot)
    }
  }, [
    basePathMaterial,
    gl,
    orbitPathMaterialA,
    orbitPathMaterialB,
    pathMaterialWarmupGeometry,
    scene,
    trajectoryRibbonMaterial,
  ])

  useEffect(
    () => () => {
      trajectoryRibbonGeometry?.dispose()
    },
    [trajectoryRibbonGeometry],
  )

  useEffect(
    () => () => {
      mainPathGeometry?.dispose()
    },
    [mainPathGeometry],
  )

  useEffect(
    () => () => {
      pathRenderSegments.forEach((segment) => {
        segment.geometry.dispose()
        segment.material.dispose()
      })
    },
    [pathRenderSegments],
  )

  useEffect(
    () => () => {
      orbitPathGeometryA?.dispose()
    },
    [orbitPathGeometryA],
  )

  useEffect(
    () => () => {
      orbitPathGeometryB?.dispose()
    },
    [orbitPathGeometryB],
  )

  useEffect(
    () => () => {
      pathMaterialWarmupGeometry.dispose()
      trajectoryRibbonMaterial.dispose()
      basePathMaterial.dispose()
      highlightPathMaterial?.dispose()
      highlightPathTexture?.dispose()
      orbitPathMaterialA.dispose()
      orbitPathMaterialB.dispose()
    },
    [
      basePathMaterial,
      highlightPathMaterial,
      highlightPathTexture,
      orbitPathMaterialA,
      orbitPathMaterialB,
      pathMaterialWarmupGeometry,
      trajectoryRibbonMaterial,
    ],
  )

  useEffect(() => {
    mergeNavigationPerfMeta({
      navigationActorVisible:
        enabled && actorCellIndex !== null && Boolean(graph?.cells[actorCellIndex]),
      navigationActorMoving: actorMoving,
      navigationDoorTransitionCount: doorTransitions.length,
      navigationPathGridNodeCount: pathIndices.length,
      navigationPathRawWaypointCount: rawPathPoints.length,
      navigationPathSimplifiedNodeCount: simplifiedPathIndices.length,
      navigationPathSmoothedWaypointCount: smoothedPathPoints.length,
      navigationPathVisible: enabled && Boolean(pathCurve),
    })
  }, [
    actorCellIndex,
    actorMoving,
    doorTransitions.length,
    enabled,
    graph,
    pathCurve,
    pathIndices.length,
    rawPathPoints.length,
    simplifiedPathIndices.length,
    smoothedPathPoints.length,
  ])

  const commitPlannedNavigationPath = useCallback(
    (
      planningGraph: NavigationGraph,
      pathResult: NavigationPathResult,
      targetWorldPosition?: [number, number, number] | null,
      destinationCellIndex?: number | null,
    ) => {
      const actorWorldPosition = getResolvedActorWorldPosition()
      const actorVisualWorldPosition = getResolvedActorVisualWorldPosition()

      mergeNavigationPerfMeta({
        navigationLastPathElapsedMs: pathResult.elapsedMs,
        navigationLastPathNodeCount: pathResult.indices.length,
      })
      const anchorCellIndex = pathResult.indices.length > 0 ? (pathResult.indices[0] ?? null) : null
      lastCommittedPathDebugRef.current = {
        actorVisualWorldPosition,
        actorWorldPosition,
        anchorCellCenter:
          anchorCellIndex !== null ? (planningGraph.cells[anchorCellIndex]?.center ?? null) : null,
        anchorCellIndex,
        destinationCellCenter:
          destinationCellIndex !== null && destinationCellIndex !== undefined
            ? (planningGraph.cells[destinationCellIndex]?.center ?? null)
            : null,
        destinationCellIndex: destinationCellIndex ?? null,
        graphIsLiveBase: planningGraph === graph,
        graphCellCount: planningGraph.cells.length,
        pathIndices: [...pathResult.indices],
        targetWorldPosition: targetWorldPosition ?? null,
      }
      setPathGraphOverride(planningGraph === graph ? null : planningGraph)
      setPathIndices(pathResult.indices)
      setPathAnchorWorldPosition(actorVisualWorldPosition)
      setPathTargetWorldPosition(targetWorldPosition ?? null)
      if (PATH_STATIC_PREVIEW_MODE) {
        pendingMotionRef.current = null
        setMotionState(
          {
            ...createActorMotionState(),
            destinationCellIndex: planningGraph === graph ? (destinationCellIndex ?? null) : null,
          },
          'requestNavigation:staticPreview',
        )
        setActorMoving(false)
        return true
      }

      pendingMotionRef.current = {
        destinationCellIndex: planningGraph === graph ? (destinationCellIndex ?? null) : null,
        moving: pathResult.indices.length > 1,
        speed:
          pathResult.indices.length > 1
            ? motionRef.current.speed * ACTOR_REPATH_SPEED_RETENTION
            : 0,
      }
      setMotionState(
        {
          ...createActorMotionState(),
          destinationCellIndex: planningGraph === graph ? (destinationCellIndex ?? null) : null,
        },
        'requestNavigation:path',
      )

      if (pathResult.indices.length <= 1) {
        setActorMoving(false)
      }

      return true
    },
    [getResolvedActorVisualWorldPosition, getResolvedActorWorldPosition, graph, setMotionState],
  )

  const requestNavigationToCell = useCallback(
    (
      targetCellIndex: number,
      targetWorldPosition?: [number, number, number] | null,
      planningGraphOverride?: NavigationGraph | null,
    ) => {
      if (pascalTruckIntroRef.current) {
        return false
      }

      const planningGraph = planningGraphOverride ?? graph
      if (!planningGraph) {
        return false
      }

      const { actorStartCellIndex: startCellIndex } = getActorNavigationPlanningState(
        planningGraph,
        selection.levelId ?? null,
      )
      if (startCellIndex === null || !planningGraph.cells[startCellIndex]) {
        return false
      }

      const targetCell = planningGraph.cells[targetCellIndex]
      if (!targetCell) {
        return false
      }

      const pathResult = measureNavigationPerf('navigation.pathfindMs', () =>
        findNavigationPath(planningGraph, startCellIndex, targetCellIndex),
      )
      if (!pathResult) {
        return false
      }

      return commitPlannedNavigationPath(
        planningGraph,
        pathResult,
        targetWorldPosition,
        planningGraph === graph ? targetCellIndex : null,
      )
    },
    [
      commitPlannedNavigationPath,
      graph,
      getActorNavigationPlanningState,
      selection.levelId,
    ],
  )

  const requestNavigationToPoint = useCallback(
    (
      targetPoint: [number, number, number],
      preferredLevelId?: LevelNode['id'] | null,
      planningGraphOverride?: NavigationGraph | null,
    ) => {
      const planningGraph = planningGraphOverride ?? graph
      if (!planningGraph) {
        return false
      }

      const { actorStartComponentId } = getActorNavigationPlanningState(
        planningGraph,
        preferredLevelId ?? selection.levelId ?? null,
      )
      const targetCellIndex = findClosestNavigationCell(
        planningGraph,
        targetPoint,
        preferredLevelId ?? null,
        actorStartComponentId,
      )
      if (targetCellIndex === null) {
        return false
      }

      const targetCell = planningGraph.cells[targetCellIndex]
      const targetSnapDistance = targetCell
        ? Math.hypot(
            targetCell.center[0] - targetPoint[0],
            (targetCell.center[1] - targetPoint[1]) * 1.5,
            targetCell.center[2] - targetPoint[2],
          )
        : Number.POSITIVE_INFINITY

      if (targetSnapDistance > MAX_REACHABLE_TARGET_SNAP_DISTANCE) {
        return false
      }

      return requestNavigationToCell(targetCellIndex, targetPoint, planningGraph)
    },
    [getActorNavigationPlanningState, graph, requestNavigationToCell, selection.levelId],
  )

  const tryStartPascalTruckExitPath = useCallback(
    (exitState: PascalTruckExitState, options?: { consumePrecomputed?: boolean }) => {
      if (!graph) {
        return false
      }

      const precomputedExitPath = options?.consumePrecomputed ? precomputedPascalTruckExitRef.current : null
      if (options?.consumePrecomputed) {
        precomputedPascalTruckExitRef.current = null
      }

      const exitTargetPoint: [number, number, number] = [
        exitState.endPosition[0],
        exitState.endPosition[1] - ACTOR_HOVER_Y,
        exitState.endPosition[2],
      ]
      const exitTargetLevelId =
        exitState.finalCellIndex !== null
          ? (toLevelNodeId(graph.cells[exitState.finalCellIndex]?.levelId) ??
            selection.levelId ??
            null)
          : (selection.levelId ?? null)

      return (
        (precomputedExitPath
          ? commitPlannedNavigationPath(
              precomputedExitPath.planningGraph,
              precomputedExitPath.pathResult,
              precomputedExitPath.targetWorldPosition,
              precomputedExitPath.destinationCellIndex,
            )
          : false) ||
        requestNavigationToPoint(exitTargetPoint, exitTargetLevelId) ||
        (exitState.finalCellIndex !== null ? requestNavigationToCell(exitState.finalCellIndex) : false)
      )
    },
    [
      commitPlannedNavigationPath,
      graph,
      requestNavigationToCell,
      requestNavigationToPoint,
      selection.levelId,
    ],
  )

  const beginPascalTruckExit = useCallback(() => {
    const exitPlan = pascalTruckIntroPlan
    const actorGroup = actorGroupRef.current
    if (!(enabled && graph && exitPlan && actorGroup)) {
      pascalTruckExitRef.current = null
      setPascalTruckExitActive(false)
      setPascalTruckIntroCompleted(false)
      setActorCellIndex(null)
      resetMotion(true)
      return
    }

    const actorWorldPosition = getResolvedActorWorldPosition()
    const actorToTruckDistance =
      actorWorldPosition === null
        ? Number.POSITIVE_INFINITY
        : Math.hypot(
            actorWorldPosition[0] - exitPlan.endPosition[0],
            actorWorldPosition[1] - exitPlan.endPosition[1],
            actorWorldPosition[2] - exitPlan.endPosition[2],
          )
    const exitState: PascalTruckExitState = {
      endPosition: exitPlan.endPosition,
      fadeElapsedMs: 0,
      finalCellIndex: exitPlan.finalCellIndex,
      rotationY: exitPlan.rotationY,
      stage: actorToTruckDistance <= 0.2 ? 'fade' : 'to-truck',
      startPosition: exitPlan.startPosition,
    }

    pascalTruckExitRef.current = exitState
    setPascalTruckExitActive(true)
    setPascalTruckIntroCompleted(false)
    motionRef.current.visibilityRevealProgress = 1

    if (exitState.stage === 'fade') {
      actorGroup.position.set(
        exitState.endPosition[0],
        exitState.endPosition[1],
        exitState.endPosition[2],
      )
      actorGroup.rotation.y = exitState.rotationY
      pendingMotionRef.current = null
      setPathIndices([])
      setPathAnchorWorldPosition(null)
      setMotionState(
        {
          ...createActorMotionState(),
          destinationCellIndex: exitState.finalCellIndex,
          visibilityRevealProgress: 1,
        },
        'pascalTruckExit:start',
      )
      setActorMoving(false)
      return
    }
    const started = tryStartPascalTruckExitPath(exitState, { consumePrecomputed: true })
    if (!started) {
      pascalTruckExitRef.current = {
        ...exitState,
        stage: 'fade',
      }
      actorGroup.position.set(
        exitState.endPosition[0],
        exitState.endPosition[1],
        exitState.endPosition[2],
      )
      actorGroup.rotation.y = exitState.rotationY
      pendingMotionRef.current = null
      setPathIndices([])
      setPathAnchorWorldPosition(null)
      setMotionState(
        {
          ...createActorMotionState(),
          destinationCellIndex: exitState.finalCellIndex,
          visibilityRevealProgress: 1,
        },
        'pascalTruckExit:fallback',
      )
      setActorMoving(false)
    }
  }, [
    enabled,
    getResolvedActorWorldPosition,
    graph,
    pascalTruckIntroPlan,
    resetMotion,
    setMotionState,
    tryStartPascalTruckExitPath,
  ])

  const schedulePascalTruckExit = useCallback(
    (options?: { allowQueuedTasks?: boolean; requiredTaskLoopToken?: number | null }) => {
      if (robotMode !== 'task') {
        pendingPascalTruckExitRef.current = null
        return
      }
      pendingPascalTruckExitRef.current = {
        allowQueuedTasks: options?.allowQueuedTasks ?? false,
        requiredTaskLoopToken: options?.requiredTaskLoopToken ?? null,
      }
    },
    [robotMode],
  )

  useEffect(() => {
    if (robotMode !== 'task') {
      pendingPascalTruckExitRef.current = null
    }
  }, [robotMode])

  useEffect(() => {
    const activeSequence = itemMoveSequenceRef.current
    if (!activeSequence) {
      return
    }

    if (activeTaskId !== activeSequence.taskId) {
      itemMoveSequenceRef.current = null
      itemMoveStageHistoryRef.current.push({ at: performance.now(), stage: null })
      recordNavigationPerfMark('navigation.itemMoveStage', { stage: 'idle' })
      precomputedPascalTruckExitRef.current = null
      setReleasedNavigationItemId(null)
      clearNavigationItemMoveVisualResidue(activeSequence.request)
      if (carriedVisualItemIdRef.current) {
        navigationVisualsStore
          .getState()
          .setItemMoveVisualState(carriedVisualItemIdRef.current, null)
        carriedVisualItemIdRef.current = null
      }
      setToolCarryItemId(null)
      clearItemMoveGestureClipState()
      useLiveTransforms.getState().clear(getNavigationItemMoveVisualItemId(activeSequence.request))
      activeSequence.controller.cancel()
      setItemMoveLocked(false)
      resetMotion()
      const navigationState = useNavigation.getState()
      if (
        actorPositionInitializedRef.current &&
        navigationState.itemMoveRequest === null &&
        navigationState.itemDeleteRequest === null &&
        navigationState.itemRepairRequest === null
      ) {
        schedulePascalTruckExit()
      }
      return
    }

    if (activeSequence.controller.itemId === activeSequence.request.itemId) {
      return
    }

    itemMoveSequenceRef.current = null
    itemMoveStageHistoryRef.current.push({ at: performance.now(), stage: null })
    recordNavigationPerfMark('navigation.itemMoveStage', { stage: 'idle' })
    precomputedPascalTruckExitRef.current = null
    setReleasedNavigationItemId(null)
    clearNavigationItemMoveVisualResidue(activeSequence.request)
    if (carriedVisualItemIdRef.current) {
      navigationVisualsStore.getState().setItemMoveVisualState(carriedVisualItemIdRef.current, null)
      carriedVisualItemIdRef.current = null
    }
    setToolCarryItemId(null)
    clearItemMoveGestureClipState()
    useLiveTransforms.getState().clear(getNavigationItemMoveVisualItemId(activeSequence.request))
    activeSequence.controller.cancel()
    if (activeSequence.taskId) {
      removeQueuedTask(activeSequence.taskId)
    } else {
      requestItemMove(null)
    }
    setItemMoveLocked(false)
    resetMotion()
    const navigationState = useNavigation.getState()
    if (
      actorPositionInitializedRef.current &&
      navigationState.itemMoveRequest === null &&
      navigationState.itemDeleteRequest === null &&
      navigationState.itemRepairRequest === null
    ) {
      schedulePascalTruckExit()
    }
  }, [
    activeTaskId,
    clearItemMoveGestureClipState,
    clearNavigationItemMoveVisualResidue,
    removeQueuedTask,
    requestItemMove,
    resetMotion,
    schedulePascalTruckExit,
    setItemMoveLocked,
    setReleasedNavigationItemId,
    setToolCarryItemId,
  ])

  const hasPendingQueuedNavigationTask = useCallback(() => {
    return useNavigation.getState().taskQueue.length > 0
  }, [])

  const advanceTaskLoopAfterCompletion = useCallback((completedTaskId: string | null) => {
    if (!completedTaskId) {
      recordTaskModeTrace('navigation.advanceTaskLoopNoCompletedTask', {}, { includeSnapshot: true })
      schedulePascalTruckExit()
      return {
        hasQueuedTask: false,
        wrappedToStart: false,
      }
    }

    const result = advanceTaskQueue()
    recordTaskModeTrace(
      'navigation.advanceTaskLoopAfterCompletion',
      {
        completedTaskId,
        hasQueuedTask: result.hasQueuedTask,
        wrappedToStart: result.wrappedToStart,
      },
      { includeSnapshot: true },
    )
    if (!result.hasQueuedTask) {
      schedulePascalTruckExit()
      return result
    }

    if (result.wrappedToStart) {
      precomputedPascalTruckExitRef.current = null
      schedulePascalTruckExit({
        allowQueuedTasks: true,
        requiredTaskLoopToken: useNavigation.getState().taskLoopToken,
      })
    }

    return result
  }, [advanceTaskQueue, recordTaskModeTrace, schedulePascalTruckExit])

  useEffect(() => {
    const pendingPascalTruckExit = pendingPascalTruckExitRef.current
    if (!pendingPascalTruckExit) {
      return
    }

    if (
      !enabled ||
      !graph ||
      !pascalTruckIntroPlan ||
      !actorPositionInitializedRef.current ||
      pascalTruckIntroRef.current !== null ||
      pascalTruckExitRef.current !== null ||
      itemMoveSequenceRef.current !== null ||
      itemDeleteSequenceRef.current !== null ||
      itemRepairSequenceRef.current !== null ||
      (pendingPascalTruckExit.requiredTaskLoopToken !== null &&
        taskLoopSettledToken !== pendingPascalTruckExit.requiredTaskLoopToken) ||
      (pendingPascalTruckExit.allowQueuedTasks && !taskQueuePlanningReady) ||
      (hasPendingQueuedNavigationTask() && !pendingPascalTruckExit.allowQueuedTasks)
    ) {
      return
    }

    pendingPascalTruckExitRef.current = null
    beginPascalTruckExit()
  }, [
    beginPascalTruckExit,
    enabled,
    graph,
    hasPendingQueuedNavigationTask,
    pascalTruckIntroPlan,
    taskLoopSettledToken,
    taskQueuePlanningReady,
  ])

  const cancelItemDeleteSequence = useCallback(() => {
    const activeSequence = itemDeleteSequenceRef.current
    recordTaskModeTrace(
      'navigation.itemDeleteSequenceCancelled',
      {
        itemId: activeSequence?.request.itemId ?? null,
        taskId: activeSequence?.taskId ?? null,
      },
      { includeSnapshot: true },
    )
    itemDeleteSequenceRef.current = null
    precomputedPascalTruckExitRef.current = null
    resetMotion()
    clearItemMoveGestureClipState()
    if (activeSequence?.taskId) {
      removeQueuedTask(activeSequence.taskId)
    } else {
      requestItemDelete(null)
    }
    setItemMoveLocked(false)
    navigationVisualsStore.getState().clearItemDelete(activeSequence?.request.itemId)
    if (actorPositionInitializedRef.current && !hasPendingQueuedNavigationTask()) {
      schedulePascalTruckExit()
    }
  }, [
    clearItemMoveGestureClipState,
    hasPendingQueuedNavigationTask,
    recordTaskModeTrace,
    removeQueuedTask,
    requestItemDelete,
    resetMotion,
    schedulePascalTruckExit,
    setItemMoveLocked,
  ])

  const completeItemDeleteSequence = useCallback(
    (sequence: NavigationItemDeleteSequence) => {
      recordTaskModeTrace(
        'navigation.itemDeleteSequenceCompleted',
        {
          itemId: sequence.request.itemId,
          taskId: sequence.taskId,
        },
        { includeSnapshot: true },
      )
      itemDeleteSequenceRef.current = null
      precomputedPascalTruckExitRef.current = null
      resetMotion()
      clearItemMoveGestureClipState()
      if (robotMode !== 'task') {
        requestItemDelete(null)
      }
      setItemMoveLocked(false)
      navigationVisualsStore.getState().clearItemDelete(sequence.request.itemId)
      useScene.getState().deleteNode(sequence.request.itemId)
      sfxEmitter.emit('sfx:item-delete')
      if (robotMode === 'task') {
        if (sequence.taskId) {
          advanceTaskLoopAfterCompletion(sequence.taskId)
        } else {
          requestItemDelete(null)
          if (!hasPendingQueuedNavigationTask()) {
            schedulePascalTruckExit()
          }
        }
      } else if (!hasPendingQueuedNavigationTask()) {
        schedulePascalTruckExit()
      }
    },
    [
      advanceTaskLoopAfterCompletion,
      clearItemMoveGestureClipState,
      hasPendingQueuedNavigationTask,
      recordTaskModeTrace,
      removeQueuedTask,
      robotMode,
      requestItemDelete,
      resetMotion,
      schedulePascalTruckExit,
      setItemMoveLocked,
    ],
  )

  const cancelItemRepairSequence = useCallback(() => {
    const activeSequence = itemRepairSequenceRef.current
    recordTaskModeTrace(
      'navigation.itemRepairSequenceCancelled',
      {
        itemId: activeSequence?.request.itemId ?? null,
        taskId: activeSequence?.taskId ?? null,
      },
      { includeSnapshot: true },
    )
    itemRepairSequenceRef.current = null
    precomputedPascalTruckExitRef.current = null
    resetMotion()
    clearItemMoveGestureClipState()
    if (activeSequence?.taskId) {
      removeQueuedTask(activeSequence.taskId)
    } else {
      requestItemRepair(null)
    }
    setItemMoveLocked(false)
    navigationVisualsStore.getState().clearRepairShield(activeSequence?.request.itemId)
    if (actorPositionInitializedRef.current && !hasPendingQueuedNavigationTask()) {
      schedulePascalTruckExit()
    }
  }, [
    clearItemMoveGestureClipState,
    hasPendingQueuedNavigationTask,
    recordTaskModeTrace,
    removeQueuedTask,
    requestItemRepair,
    resetMotion,
    schedulePascalTruckExit,
    setItemMoveLocked,
  ])

  useEffect(() => {
    const activeSequence = itemDeleteSequenceRef.current
    if (!activeSequence || activeTaskId === activeSequence.taskId) {
      return
    }

    itemDeleteSequenceRef.current = null
    precomputedPascalTruckExitRef.current = null
    resetMotion()
    clearItemMoveGestureClipState()
    setItemMoveLocked(false)
    navigationVisualsStore.getState().clearItemDelete(activeSequence.request.itemId)
    const navigationState = useNavigation.getState()
    if (
      actorPositionInitializedRef.current &&
      navigationState.itemMoveRequest === null &&
      navigationState.itemDeleteRequest === null &&
      navigationState.itemRepairRequest === null
    ) {
      schedulePascalTruckExit()
    }
  }, [
    activeTaskId,
    clearItemMoveGestureClipState,
    resetMotion,
    schedulePascalTruckExit,
    setItemMoveLocked,
  ])

  useEffect(() => {
    const activeSequence = itemRepairSequenceRef.current
    if (!activeSequence || activeTaskId === activeSequence.taskId) {
      return
    }

    itemRepairSequenceRef.current = null
    precomputedPascalTruckExitRef.current = null
    resetMotion()
    clearItemMoveGestureClipState()
    setItemMoveLocked(false)
    navigationVisualsStore.getState().clearRepairShield(activeSequence.request.itemId)
    const navigationState = useNavigation.getState()
    if (
      actorPositionInitializedRef.current &&
      navigationState.itemMoveRequest === null &&
      navigationState.itemDeleteRequest === null &&
      navigationState.itemRepairRequest === null
    ) {
      schedulePascalTruckExit()
    }
  }, [
    activeTaskId,
    clearItemMoveGestureClipState,
    resetMotion,
    schedulePascalTruckExit,
    setItemMoveLocked,
  ])

  const completeItemRepairSequence = useCallback(
    (sequence: NavigationItemRepairSequence) => {
      recordTaskModeTrace(
        'navigation.itemRepairSequenceCompleted',
        {
          itemId: sequence.request.itemId,
          taskId: sequence.taskId,
        },
        { includeSnapshot: true },
      )
      itemRepairSequenceRef.current = null
      precomputedPascalTruckExitRef.current = null
      resetMotion()
      clearItemMoveGestureClipState()
      if (robotMode !== 'task') {
        requestItemRepair(null)
      }
      setItemMoveLocked(false)
      navigationVisualsStore.getState().clearRepairShield(sequence.request.itemId)
      if (robotMode === 'task') {
        if (sequence.taskId) {
          advanceTaskLoopAfterCompletion(sequence.taskId)
        } else {
          requestItemRepair(null)
          if (!hasPendingQueuedNavigationTask()) {
            schedulePascalTruckExit()
          }
        }
      } else if (!hasPendingQueuedNavigationTask()) {
        schedulePascalTruckExit()
      }
    },
    [
      advanceTaskLoopAfterCompletion,
      clearItemMoveGestureClipState,
      hasPendingQueuedNavigationTask,
      recordTaskModeTrace,
      removeQueuedTask,
      robotMode,
      requestItemRepair,
      resetMotion,
      schedulePascalTruckExit,
      setItemMoveLocked,
    ],
  )

  useEffect(() => {
    if (
      !(
        enabled &&
        graph &&
        itemMoveRequest &&
        !itemMoveLocked &&
        taskQueuePlanningReady &&
        headItemMoveController &&
        pascalTruckIntroCompleted &&
        pascalTruckIntroTaskReady &&
        pendingPascalTruckExitRef.current === null &&
        !pascalTruckIntroRef.current &&
        !pascalTruckExitRef.current
      )
    ) {
      return
    }

    if (
      headItemMoveController.itemId !== itemMoveRequest.itemId ||
      itemMoveSequenceRef.current ||
      itemRepairSequenceRef.current
    ) {
      return
    }

    if (releasedNavigationItemId !== null) {
      setReleasedNavigationItemId(null)
      return
    }

    const abortPendingItemMove = () => {
      headItemMoveController.cancel()
      if (activeTaskId) {
        removeQueuedTask(activeTaskId)
      } else {
        requestItemMove(null)
      }
      setItemMoveLocked(false)
    }

    const targetPosition = itemMoveRequest.finalUpdate.position
    const targetRotation = itemMoveRequest.finalUpdate.rotation ?? itemMoveRequest.sourceRotation
    const targetRotationY = targetRotation?.[1] ?? itemMoveRequest.sourceRotation[1] ?? 0

    if (!targetPosition || !targetRotation) {
      abortPendingItemMove()
      return
    }

    const { actorNavigationPoint, actorStartCellIndex, actorStartComponentId } =
      getActorNavigationPlanningState(
        graph,
        selection.levelId ?? toLevelNodeId(itemMoveRequest.levelId) ?? null,
      )
    if (actorStartCellIndex === null) {
      abortPendingItemMove()
      return
    }

    const itemMovePlanCacheKey = createNavigationItemMovePlanCacheKey(
      itemMoveRequest,
      actorStartCellIndex,
      navigationSceneSnapshot?.key ?? null,
      selection.buildingId ?? null,
    )
    const precomputedItemMovePlan =
      robotMode === 'task'
        ? null
        : itemMovePreviewPlanRef.current?.cacheKey === itemMovePlanCacheKey
          ? itemMovePreviewPlanRef.current
          : (itemMovePreviewPlanCacheRef.current.get(itemMovePlanCacheKey) ?? null)
    const resolvedItemMovePlan =
      precomputedItemMovePlan ??
      resolveItemMovePlan(
        itemMoveRequest,
        actorStartCellIndex,
        actorNavigationPoint,
        actorStartComponentId,
      )
    mergeNavigationPerfMeta({
      navigationItemMoveUsedPreviewPlan: Boolean(precomputedItemMovePlan),
    })
    if (!resolvedItemMovePlan) {
      abortPendingItemMove()
      return
    }

    const {
      exitPath,
      sourceApproach,
      sourcePath: pathToSource,
      targetApproach: resolvedTargetApproach,
      targetPath: resolvedPathToTarget,
      targetPlanningGraph: resolvedTargetPlanningGraph,
    } = resolvedItemMovePlan

    const started = commitPlannedNavigationPath(
      graph,
      pathToSource,
      sourceApproach.world,
      sourceApproach.cellIndex,
    )
    if (!started) {
      abortPendingItemMove()
      return
    }

    itemMoveSequenceRef.current = {
      controller: headItemMoveController,
      dropGesture: getRandomItemMoveGesture(),
      dropStartedAt: null,
      dropStartPosition: null,
      dropSettledAt: null,
      exitPath,
      pickupCarryVisualStartedAt: null,
      pickupGesture: getRandomItemMoveGesture(),
      pickupStartedAt: null,
      pickupTransferStartedAt: null,
      request: itemMoveRequest,
      sourceDisplayPosition: getRenderedFloorItemPosition(
        itemMoveRequest.levelId,
        itemMoveRequest.sourcePosition,
        itemMoveRequest.itemDimensions,
        itemMoveRequest.sourceRotation,
      ),
      sourceApproach,
      sourcePath: pathToSource,
      stage: 'to-source',
      taskId: activeTaskId,
      targetDisplayPosition: getRenderedFloorItemPosition(
        itemMoveRequest.levelId,
        targetPosition,
        itemMoveRequest.itemDimensions,
        targetRotation,
      ),
      targetApproach: resolvedTargetApproach,
      targetPath: resolvedPathToTarget,
      targetPlanningGraph: resolvedTargetPlanningGraph,
      targetRotationY,
    }
    itemMoveStageHistoryRef.current = [{ at: performance.now(), stage: 'to-source' }]
    recordTaskModeTrace(
      'navigation.itemMoveSequenceStarted',
      {
        activeTaskId,
        itemId: itemMoveRequest.itemId,
        visualItemId: getNavigationItemMoveVisualItemId(itemMoveRequest),
      },
      { includeSnapshot: true },
    )
  }, [
    activeTaskId,
    commitPlannedNavigationPath,
    enabled,
    graph,
    getActorNavigationPlanningState,
    headItemMoveController,
    itemMoveLocked,
    itemMoveRequest,
    navigationSceneSnapshot?.key,
    pascalTruckIntroCompleted,
    pascalTruckIntroTaskReady,
    removeQueuedTask,
    requestItemMove,
    recordTaskModeTrace,
    releasedNavigationItemId,
    resolveItemMovePlan,
    selection.buildingId,
    selection.levelId,
    taskQueuePlanningReady,
    setItemMoveLocked,
  ])

  useEffect(() => {
    if (
      !(
        enabled &&
        graph &&
        itemDeleteRequest &&
        !itemMoveLocked &&
        taskQueuePlanningReady &&
        pascalTruckIntroCompleted &&
        pascalTruckIntroTaskReady &&
        pendingPascalTruckExitRef.current === null &&
        !pascalTruckIntroRef.current &&
        !pascalTruckExitRef.current
      )
    ) {
      return
    }

    if (
      itemMoveSequenceRef.current ||
      itemDeleteSequenceRef.current ||
      itemRepairSequenceRef.current
    ) {
      return
    }

    const { actorNavigationPoint, actorStartCellIndex, actorStartComponentId } =
      getActorNavigationPlanningState(
        graph,
        selection.levelId ?? toLevelNodeId(itemDeleteRequest.levelId) ?? null,
      )

    if (actorStartCellIndex === null) {
      cancelItemDeleteSequence()
      return
    }

    const sourceApproach = findItemMoveApproach(
      graph,
      {
        dimensions: itemDeleteRequest.itemDimensions,
        footprintBounds: extractObjectLocalFootprintBounds(
          sceneRegistry.nodes.get(itemDeleteRequest.itemId) ?? null,
        ),
        levelId: itemDeleteRequest.levelId,
        position: itemDeleteRequest.sourcePosition,
        rotation: itemDeleteRequest.sourceRotation,
      },
      actorStartComponentId,
      actorStartCellIndex,
      actorNavigationPoint,
    )

    if (!sourceApproach) {
      cancelItemDeleteSequence()
      return
    }

    if (!findNavigationPath(graph, actorStartCellIndex, sourceApproach.cellIndex)) {
      cancelItemDeleteSequence()
      return
    }

    const started = requestNavigationToPoint(sourceApproach.world)
    if (!started) {
      cancelItemDeleteSequence()
      return
    }

    itemDeleteSequenceRef.current = {
      deleteStartedAt: null,
      gesture: getRandomItemMoveGesture(),
      request: itemDeleteRequest,
      sourceApproach,
      stage: 'to-source',
      taskId: activeTaskId,
    }
    recordTaskModeTrace(
      'navigation.itemDeleteSequenceStarted',
      {
        activeTaskId,
        itemId: itemDeleteRequest.itemId,
      },
      { includeSnapshot: true },
    )
  }, [
    activeTaskId,
    cancelItemDeleteSequence,
    enabled,
    graph,
    getActorNavigationPlanningState,
    itemDeleteRequest,
    itemMoveLocked,
    pascalTruckIntroCompleted,
    pascalTruckIntroTaskReady,
    recordTaskModeTrace,
    requestNavigationToPoint,
    selection.levelId,
    taskQueuePlanningReady,
  ])

  useEffect(() => {
    if (
      !(
        enabled &&
        graph &&
        itemRepairRequest &&
        !itemMoveLocked &&
        taskQueuePlanningReady &&
        pascalTruckIntroCompleted &&
        pascalTruckIntroTaskReady &&
        pendingPascalTruckExitRef.current === null &&
        !pascalTruckIntroRef.current &&
        !pascalTruckExitRef.current
      )
    ) {
      return
    }

    if (
      itemMoveSequenceRef.current ||
      itemDeleteSequenceRef.current ||
      itemRepairSequenceRef.current
    ) {
      return
    }

    const { actorNavigationPoint, actorStartCellIndex, actorStartComponentId } =
      getActorNavigationPlanningState(
        graph,
        selection.levelId ?? toLevelNodeId(itemRepairRequest.levelId) ?? null,
      )

    if (actorStartCellIndex === null) {
      cancelItemRepairSequence()
      return
    }

    const sourceApproach = findItemMoveApproach(
      graph,
      {
        dimensions: itemRepairRequest.itemDimensions,
        footprintBounds: extractObjectLocalFootprintBounds(
          sceneRegistry.nodes.get(itemRepairRequest.itemId) ?? null,
        ),
        levelId: itemRepairRequest.levelId,
        position: itemRepairRequest.sourcePosition,
        rotation: itemRepairRequest.sourceRotation,
      },
      actorStartComponentId,
      actorStartCellIndex,
      actorNavigationPoint,
    )

    if (!sourceApproach) {
      cancelItemRepairSequence()
      return
    }

    if (!findNavigationPath(graph, actorStartCellIndex, sourceApproach.cellIndex)) {
      cancelItemRepairSequence()
      return
    }

    const started = requestNavigationToPoint(sourceApproach.world)
    if (!started) {
      cancelItemRepairSequence()
      return
    }

    itemRepairSequenceRef.current = {
      gesture: getRandomItemMoveGesture(),
      repairStartedAt: null,
      request: itemRepairRequest,
      sourceApproach,
      stage: 'to-source',
      taskId: activeTaskId,
    }
    recordTaskModeTrace(
      'navigation.itemRepairSequenceStarted',
      {
        activeTaskId,
        itemId: itemRepairRequest.itemId,
      },
      { includeSnapshot: true },
    )
  }, [
    activeTaskId,
    cancelItemRepairSequence,
    enabled,
    graph,
    getActorNavigationPlanningState,
    itemMoveLocked,
    itemRepairRequest,
    pascalTruckIntroCompleted,
    pascalTruckIntroTaskReady,
    recordTaskModeTrace,
    requestItemRepair,
    requestNavigationToPoint,
    selection.levelId,
    taskQueuePlanningReady,
  ])

  useEffect(() => {
    if (
      !(
        enabled &&
        graph &&
        pascalTruckIntroCompleted &&
        pascalTruckIntroTaskReady &&
        !pascalTruckIntroRef.current &&
        !pascalTruckExitRef.current
      )
    ) {
      return
    }

    const canvas = gl.domElement

    const canHandleNavigationClick = () => {
      const {
        itemMoveControllers: currentItemMoveControllers,
        itemRepairRequest: currentItemRepairRequest,
        navigationClickSuppressedUntil,
      } = useNavigation.getState()
      const hasQueuedMoveController = Object.keys(currentItemMoveControllers).length > 0

      if (
        cameraDragging ||
        itemDeleteSequenceRef.current ||
        itemRepairSequenceRef.current ||
        pendingPascalTruckExitRef.current !== null ||
        hasQueuedMoveController ||
        useNavigation.getState().itemDeleteRequest ||
        currentItemRepairRequest ||
        useNavigation.getState().itemMoveLocked ||
        useEditor.getState().movingNode ||
        performance.now() < navigationClickSuppressedUntil
      ) {
        return false
      }

      const committedActorIndex = actorCellIndex
      if (committedActorIndex === null || !graph.cells[committedActorIndex]) {
        return false
      }

      return true
    }

    const requestNavigationAtClientPoint = (clientX: number, clientY: number) => {
      if (!canHandleNavigationClick()) {
        return false
      }

      const committedActorIndex = actorCellIndex
      if (committedActorIndex === null || !graph.cells[committedActorIndex]) {
        return false
      }

      const rect = canvas.getBoundingClientRect()
      pointerRef.current.x = ((clientX - rect.left) / rect.width) * 2 - 1
      pointerRef.current.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycasterRef.current.setFromCamera(pointerRef.current, camera)

      const preferredLevelId =
        selection.levelId ?? graph.cells[committedActorIndex]?.levelId ?? null
      const pickableObjects = getPickableNavigationObjects()
      const pickableRoots = new Set(pickableObjects)
      const occluderObjects = getNavigationOccluderObjects()
      const occluderRoots = new Set(occluderObjects)
      const intersections = raycasterRef.current.intersectObjects(
        [...pickableObjects, ...occluderObjects],
        true,
      )
      const hits = intersections.filter((hit) => objectBelongsToRoots(hit.object, pickableRoots))
      const firstHit = hits[0] ?? null
      const firstOccludingHit =
        intersections.find((hit) => objectBelongsToRoots(hit.object, occluderRoots)) ?? null

      if (
        firstOccludingHit &&
        (!firstHit || firstOccludingHit.distance <= firstHit.distance + Number.EPSILON)
      ) {
        return false
      }

      if (hits.length === 0) {
        return false
      }

      // Some rooms sit below overlapping slabs from upper levels. Try the visible
      // hits in depth order and pick the first one that resolves on the active level.
      for (const hit of hits) {
        if (requestNavigationToPoint([hit.point.x, hit.point.y, hit.point.z], preferredLevelId)) {
          return true
        }
      }
      return false
    }

    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0 || robotMode === 'normal') {
        return
      }

      requestNavigationAtClientPoint(event.clientX, event.clientY)
    }

    const handleContextMenu = (event: MouseEvent) => {
      if (robotMode !== 'normal') {
        return
      }

      if (cameraDragging) {
        return
      }

      event.preventDefault()
      requestNavigationAtClientPoint(event.clientX, event.clientY)
    }

    canvas.addEventListener('click', handleClick)
    canvas.addEventListener('contextmenu', handleContextMenu)
    return () => {
      canvas.removeEventListener('click', handleClick)
      canvas.removeEventListener('contextmenu', handleContextMenu)
    }
  }, [
    actorCellIndex,
    actorComponentId,
    actorSpawnPosition,
    camera,
    cameraDragging,
    enabled,
    gl.domElement,
    graph,
    pascalTruckIntroCompleted,
    pascalTruckIntroTaskReady,
    requestNavigationToPoint,
    robotMode,
  ])

  useEffect(() => {
    const pendingMotion = pendingMotionRef.current
    if (!pendingMotion) {
      return
    }

    if (pendingMotion.moving && !primaryMotionCurve) {
      return
    }

    setMotionState(
      {
        ...createActorMotionState(),
        destinationCellIndex: pendingMotion.destinationCellIndex,
        distance: 0,
        moving: pendingMotion.moving,
        speed: pendingMotion.speed,
      },
      'pendingMotion:flush',
    )
    recordTaskModeTrace('navigation.pendingMotionFlushed', {
      destinationCellIndex: pendingMotion.destinationCellIndex,
      moving: pendingMotion.moving,
      speed: pendingMotion.speed,
    })
    pendingMotionRef.current = null
    setActorMoving(pendingMotion.moving)
  }, [pathIndices, primaryMotionCurve, recordTaskModeTrace])

  useEffect(() => {
    const hasPendingTaskRequest =
      itemMoveRequest !== null || itemDeleteRequest !== null || itemRepairRequest !== null
    const hasPendingTaskWork = hasPendingTaskRequest || (robotMode === 'task' && taskQueue.length > 0)
    if (
      !(
        enabled &&
        !introAnimationDebugActive &&
        pascalTruckIntroPlan &&
        !pascalTruckIntroCompleted &&
        !pascalTruckIntroRef.current &&
        !pascalTruckExitActive &&
        (robotMode !== 'task' || (hasPendingTaskWork && taskQueuePlanningReady))
      )
    ) {
      return
    }

    debugPascalTruckIntroAttemptCountRef.current += 1
    if (beginPascalTruckIntro()) {
      debugPascalTruckIntroStartCountRef.current += 1
    }
  }, [
    beginPascalTruckIntro,
    enabled,
    introAnimationDebugActive,
    itemDeleteRequest,
    itemMoveRequest,
    itemRepairRequest,
    pascalTruckExitActive,
    pascalTruckIntroCompleted,
    pascalTruckIntroPlan,
    robotMode,
    taskQueue.length,
    taskQueuePlanningReady,
  ])

  useEffect(() => {
    const hasPendingTaskWork =
      itemMoveRequest !== null ||
      itemDeleteRequest !== null ||
      itemRepairRequest !== null ||
      taskQueue.length > 0
    if (
      introAnimationDebugActive ||
      robotMode !== 'task' ||
      !pascalTruckIntroRef.current ||
      hasPendingTaskWork ||
      itemMoveSequenceRef.current !== null ||
      itemDeleteSequenceRef.current !== null ||
      itemRepairSequenceRef.current !== null
    ) {
      return
    }

    pascalTruckIntroRef.current = null
    pascalTruckIntroPostWarmupTokenRef.current = null
    setPascalTruckIntroActive(false)
    setPascalTruckIntroCompleted(false)
    setActorCellIndex(null)
    resetMotion(true)
  }, [
    introAnimationDebugActive,
    itemDeleteRequest,
    itemMoveRequest,
    itemRepairRequest,
    resetMotion,
    robotMode,
    taskQueue.length,
  ])

  useEffect(() => {
    if (!(actorSpawnPosition && actorGroupRef.current)) {
      return
    }

    if (actorPositionInitializedRef.current && lastPublishedActorPositionRef.current) {
      return
    }

    actorGroupRef.current.position.set(
      actorSpawnPosition[0],
      actorSpawnPosition[1],
      actorSpawnPosition[2],
    )
    if (pascalTruckIntroRef.current) {
      actorGroupRef.current.rotation.y = pascalTruckIntroRef.current.rotationY
    }
    actorPositionInitializedRef.current = true
    setPathAnchorWorldPosition(null)
    lastPublishedActorPositionRef.current = actorSpawnPosition
    lastPublishedActorPositionAtRef.current = performance.now()
    setActorAvailable(true)
    setActorWorldPosition(actorSpawnPosition)
    recordTaskModeTrace('navigation.actorSpawnInitialized', {
      actorSpawnPosition,
    })
    navigationEmitter.emit('navigation:actor-transform', {
      moving: false,
      position: actorSpawnPosition,
      rotationY: actorGroupRef.current.rotation.y,
    })
  }, [actorSpawnPosition, recordTaskModeTrace, setActorAvailable, setActorWorldPosition])

  const tryStartPascalTruckIntroReveal = useCallback(
    (
      trigger: 'post-warmup-ready' | 'robot-ready',
      options?: { ignorePendingWarmup?: boolean },
    ) => {
      const pascalTruckIntro = pascalTruckIntroRef.current
      if (!(pascalTruckIntro && !pascalTruckIntro.revealStarted)) {
        return false
      }

      const pendingWarmupToken = pascalTruckIntroPostWarmupTokenRef.current
      if (
        !options?.ignorePendingWarmup &&
        pendingWarmupToken !== null &&
        navigationPostWarmupCompletedToken < pendingWarmupToken
      ) {
        return false
      }

      recordNavigationPerfMark('navigation.pascalTruckIntroRevealStart', { trigger })
      pascalTruckIntro.revealStarted = true
      pascalTruckIntroPostWarmupTokenRef.current = null
      return true
    },
    [navigationPostWarmupCompletedToken],
  )

  useEffect(() => {
    if (pascalTruckIntroPostWarmupTokenRef.current === null) {
      return
    }

    if (navigationPostWarmupCompletedToken >= pascalTruckIntroPostWarmupTokenRef.current) {
      recordNavigationPerfMark('navigation.postWarmupComplete', {
        token: pascalTruckIntroPostWarmupTokenRef.current,
        trigger: 'intro',
      })
    }
    void tryStartPascalTruckIntroReveal('post-warmup-ready')
  }, [navigationPostWarmupCompletedToken, tryStartPascalTruckIntroReveal])

  const handlePascalTruckIntroRobotReady = useCallback(() => {
    const pascalTruckIntro = pascalTruckIntroRef.current
    if (!(pascalTruckIntro && !pascalTruckIntro.revealStarted)) {
      return
    }

    const baselineWarmupReady =
      lastNavigationPostWarmupRequestKeyRef.current === navigationPostWarmupRequestKey &&
      navigationPostWarmupRequestToken <= navigationPostWarmupCompletedToken
    if (baselineWarmupReady) {
      void tryStartPascalTruckIntroReveal('robot-ready')
      return
    }

    if (pascalTruckIntroPostWarmupTokenRef.current === null) {
      const token = navigationVisualsStore.getState().requestNavigationPostWarmup()
      pascalTruckIntroPostWarmupTokenRef.current = token
      recordNavigationPerfMark('navigation.postWarmupRequest', {
        token,
        trigger: 'intro',
      })
      void tryStartPascalTruckIntroReveal('robot-ready', { ignorePendingWarmup: true })
      return
    }

    void tryStartPascalTruckIntroReveal('robot-ready', { ignorePendingWarmup: true })
  }, [
    navigationPostWarmupCompletedToken,
    navigationPostWarmupRequestKey,
    navigationPostWarmupRequestToken,
    tryStartPascalTruckIntroReveal,
  ])

  const cancelDeferredItemMoveCommit = useCallback(() => {
    if (deferredItemMoveCommitFrameRef.current !== null) {
      cancelAnimationFrame(deferredItemMoveCommitFrameRef.current)
      deferredItemMoveCommitFrameRef.current = null
    }

    if (
      deferredItemMoveCommitIdleRef.current !== null &&
      typeof window !== 'undefined' &&
      'cancelIdleCallback' in window
    ) {
      window.cancelIdleCallback(deferredItemMoveCommitIdleRef.current)
      deferredItemMoveCommitIdleRef.current = null
    }

    if (deferredItemMoveCommitTimeoutRef.current !== null) {
      window.clearTimeout(deferredItemMoveCommitTimeoutRef.current)
      deferredItemMoveCommitTimeoutRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      cancelDeferredItemMoveCommit()
    }
  }, [cancelDeferredItemMoveCommit])

  useEffect(() => {
    if (queueRestartToken === processedQueueRestartTokenRef.current) {
      return
    }

    recordTaskModeTrace(
      'navigation.queueRestartDetected',
      {
        nextQueueRestartToken: queueRestartToken,
        previousQueueRestartToken: processedQueueRestartTokenRef.current,
        queueLength: taskQueue.length,
      },
      { includeSnapshot: true },
    )
    processedQueueRestartTokenRef.current = queueRestartToken
    if (!enabled || robotMode !== 'task' || taskQueue.length === 0) {
      return
    }

    cancelDeferredItemMoveCommit()

    const timeoutId = pascalTruckIntroTaskReadyTimeoutRef.current
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId)
      pascalTruckIntroTaskReadyTimeoutRef.current = null
    }

    const activeMoveSequence = itemMoveSequenceRef.current
    itemMoveSequenceRef.current = null
    if (activeMoveSequence) {
      itemMoveStageHistoryRef.current.push({ at: performance.now(), stage: null })
      recordNavigationPerfMark('navigation.itemMoveStage', { stage: 'idle' })
      setReleasedNavigationItemId(null)
      clearNavigationItemMoveVisualResidue(activeMoveSequence.request)
      if (carriedVisualItemIdRef.current) {
        navigationVisualsStore
          .getState()
          .setItemMoveVisualState(carriedVisualItemIdRef.current, null)
        carriedVisualItemIdRef.current = null
      }
      setToolCarryItemId(null)
      useLiveTransforms
        .getState()
        .clear(getNavigationItemMoveVisualItemId(activeMoveSequence.request))
    }

    const activeDeleteSequence = itemDeleteSequenceRef.current
    itemDeleteSequenceRef.current = null
    if (activeDeleteSequence) {
      navigationVisualsStore.getState().clearItemDelete(activeDeleteSequence.request.itemId)
    }

    const activeRepairSequence = itemRepairSequenceRef.current
    itemRepairSequenceRef.current = null
    if (activeRepairSequence) {
      navigationVisualsStore.getState().clearRepairShield(activeRepairSequence.request.itemId)
    }

    pascalTruckIntroRef.current = null
    pascalTruckIntroPostWarmupTokenRef.current = null
    pascalTruckExitRef.current = null
    pendingPascalTruckExitRef.current = null
    precomputedPascalTruckExitRef.current = null
    pascalTruckIntroPendingSettlePositionRef.current = null
    setPendingTaskGraphSyncKey(null)
    setPascalTruckIntroTaskReady(false)
    doorCollisionStateRef.current = {
      blocked: false,
      doorIds: [],
    }
    clearItemMoveGestureClipState()
    setItemMoveLocked(false)
    setToolCarryItemId(null)
    setPascalTruckIntroActive(false)
    setPascalTruckExitActive(false)
    setPascalTruckIntroCompleted(false)
    setActorCellIndex(null)
    resetMotion(true)
  }, [
    cancelDeferredItemMoveCommit,
    clearItemMoveGestureClipState,
    clearNavigationItemMoveVisualResidue,
    enabled,
    queueRestartToken,
    recordTaskModeTrace,
    resetMotion,
    robotMode,
    setPendingTaskGraphSyncKey,
    setItemMoveLocked,
    setReleasedNavigationItemId,
    setToolCarryItemId,
    taskQueue.length,
  ])

  const scheduleDeferredItemMoveCommit = useCallback(
    (
      sequence: NavigationItemMoveSequence,
      finalCarryTransform?: { position: [number, number, number]; rotation: number },
    ) => {
      cancelDeferredItemMoveCommit()
      const commitItemMove = () => {
        deferredItemMoveCommitIdleRef.current = null
        deferredItemMoveCommitTimeoutRef.current = null
        const nextTaskGraphSyncKey =
          robotMode === 'task' ? buildItemMoveTargetSceneSnapshot(sequence.request).key : null
        if (robotMode === 'task') {
          itemMovePreviewPlanRef.current = null
          itemMovePreviewPlanCacheRef.current.clear()
        }
        setPendingTaskGraphSyncKey(nextTaskGraphSyncKey)
        measureNavigationPerf('navigation.itemMoveCommitMs', () =>
          sequence.controller.commit(sequence.request.finalUpdate, finalCarryTransform),
        )
        setItemMoveLocked(false)
        if (robotMode === 'task') {
          if (sequence.taskId) {
            advanceTaskLoopAfterCompletion(sequence.taskId)
          } else {
            requestItemMove(null)
            if (!hasPendingQueuedNavigationTask()) {
              schedulePascalTruckExit()
            }
          }
        } else if (!hasPendingQueuedNavigationTask()) {
          schedulePascalTruckExit()
        }
      }

      if (robotMode === 'task') {
        queueMicrotask(commitItemMove)
        return
      }

      deferredItemMoveCommitTimeoutRef.current = window.setTimeout(() => {
        deferredItemMoveCommitTimeoutRef.current = null

        if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
          deferredItemMoveCommitIdleRef.current = window.requestIdleCallback(commitItemMove, {
            timeout: ITEM_MOVE_COMMIT_IDLE_TIMEOUT_MS,
          })
          return
        }

        commitItemMove()
      }, ITEM_MOVE_COMMIT_DEFER_DELAY_MS)
    },
    [
      advanceTaskLoopAfterCompletion,
      buildItemMoveTargetSceneSnapshot,
      cancelDeferredItemMoveCommit,
      hasPendingQueuedNavigationTask,
      removeQueuedTask,
      requestItemMove,
      robotMode,
      schedulePascalTruckExit,
      setPendingTaskGraphSyncKey,
      setItemMoveLocked,
    ],
  )

  const cancelItemMoveSequence = useCallback(() => {
    const activeSequence = itemMoveSequenceRef.current
    recordTaskModeTrace(
      'navigation.itemMoveSequenceCancelled',
      {
        itemId: activeSequence?.request.itemId ?? null,
        taskId: activeSequence?.taskId ?? null,
      },
      { includeSnapshot: true },
    )
    itemMoveSequenceRef.current = null
    itemMoveStageHistoryRef.current.push({ at: performance.now(), stage: null })
    recordNavigationPerfMark('navigation.itemMoveStage', { stage: 'idle' })
    cancelDeferredItemMoveCommit()
    precomputedPascalTruckExitRef.current = null
    setReleasedNavigationItemId(null)
    clearNavigationItemMoveVisualResidue(activeSequence?.request ?? null)
    if (carriedVisualItemIdRef.current) {
      navigationVisualsStore.getState().setItemMoveVisualState(carriedVisualItemIdRef.current, null)
      carriedVisualItemIdRef.current = null
    }
    setToolCarryItemId(null)
    clearItemMoveGestureClipState()
    setItemMoveLocked(false)
    if (activeSequence) {
      useLiveTransforms.getState().clear(getNavigationItemMoveVisualItemId(activeSequence.request))
      if (activeSequence.taskId) {
        removeQueuedTask(activeSequence.taskId)
      } else {
        requestItemMove(null)
      }
    } else {
      requestItemMove(null)
    }
    activeSequence?.controller.cancel()
    if (actorPositionInitializedRef.current && !hasPendingQueuedNavigationTask()) {
      schedulePascalTruckExit()
    }
  }, [
    clearItemMoveGestureClipState,
    clearNavigationItemMoveVisualResidue,
    hasPendingQueuedNavigationTask,
    recordTaskModeTrace,
    removeQueuedTask,
    requestItemMove,
    schedulePascalTruckExit,
    setItemMoveLocked,
    setReleasedNavigationItemId,
    setToolCarryItemId,
  ])

  const completeItemMoveSequence = useCallback(
    (
      sequence: NavigationItemMoveSequence,
      finalCarryTransform?: { position: [number, number, number]; rotation: number },
    ) => {
      recordTaskModeTrace(
        'navigation.itemMoveSequenceCompleted',
        {
          itemId: sequence.request.itemId,
          taskId: sequence.taskId,
          visualItemId: getNavigationItemMoveVisualItemId(sequence.request),
        },
        { includeSnapshot: true },
      )
      itemMoveSequenceRef.current = null
      itemMoveStageHistoryRef.current.push({ at: performance.now(), stage: null })
      recordNavigationPerfMark('navigation.itemMoveStage', { stage: 'idle' })
      precomputedPascalTruckExitRef.current = sequence.exitPath
      // The item commit rebuilds the navigation graph. Clear the finished route first so
      // stale cell indices from the previous graph cannot render as a bogus post-drop path.
      setReleasedNavigationItemId(null)
      clearNavigationItemMoveVisualResidue(sequence.request)
      if (carriedVisualItemIdRef.current) {
        navigationVisualsStore
          .getState()
          .setItemMoveVisualState(carriedVisualItemIdRef.current, null)
        carriedVisualItemIdRef.current = null
      }
      setToolCarryItemId(null)
      resetMotion()
      clearItemMoveGestureClipState()
      if (robotMode !== 'task') {
        requestItemMove(null)
      }
      scheduleDeferredItemMoveCommit(sequence, finalCarryTransform)
    },
    [
      clearItemMoveGestureClipState,
      clearNavigationItemMoveVisualResidue,
      recordTaskModeTrace,
      requestItemMove,
      robotMode,
      resetMotion,
      scheduleDeferredItemMoveCommit,
      setReleasedNavigationItemId,
      setToolCarryItemId,
    ],
  )

  useFrame(() => {
    const shadowMap = (gl as typeof gl & { shadowMap?: RendererShadowMap }).shadowMap
    if (!shadowMap) {
      return
    }

    const shadowController = shadowControllerRef.current
    const now = performance.now()
    const shadowsEnabled = shadowMapOverrideEnabledRef.current !== false
    const shouldAutoUpdate = shadowsEnabled

    if (shadowController.currentAutoUpdate !== shouldAutoUpdate) {
      shadowMap.autoUpdate = shouldAutoUpdate
      shadowController.currentAutoUpdate = shouldAutoUpdate
    }

    if (shadowController.currentEnabled !== shadowsEnabled) {
      shadowMap.enabled = shadowsEnabled
      shadowController.currentEnabled = shadowsEnabled
      shadowMap.needsUpdate = shadowsEnabled
    }

    if (!shadowsEnabled) {
      shadowMap.needsUpdate = false
    }

    shadowController.dynamicSettleFrames = 0
    shadowController.lastDynamicUpdateAtMs = shadowsEnabled ? now : 0

    mergeNavigationPerfMeta({
      navigationShadowAutoUpdate: shouldAutoUpdate,
      navigationShadowDynamicScene: false,
      navigationShadowMapEnabled: shadowsEnabled,
      navigationShadowFrozenDuringNavigation: false,
      navigationShadowThrottled: false,
    })
  })

  useFrame((_, delta) => {
    if (!graph) {
      return
    }

    const actorGroup = actorGroupRef.current
    const frameStart = performance.now()
    const frameDeltaMs = delta * 1000
    recordNavigationPerfSample('navigation.frameDeltaMs', frameDeltaMs)
    const primaryPathCurve = primaryMotionCurve
    const primaryPathLength = primaryMotionLength
    const activeMotionProfile = trajectoryMotionProfile
    const ribbonPathVisible = enabled && pathCurve && pathLength > Number.EPSILON
    const trajectoryMode = trajectoryDebugModeRef.current
    const debugDistance = trajectoryDebugDistanceRef.current
    const pathDistance = Math.max(0, debugDistance ?? motionRef.current.distance)
    const pathProgress =
      primaryPathLength > Number.EPSILON
        ? MathUtils.clamp(pathDistance / primaryPathLength, 0, 1)
        : 0
    const opaqueTrajectory = trajectoryDebugOpaqueRef.current || trajectoryMode === 'opaque'
    const hiddenTrajectory = trajectoryMode === 'hidden'
    const visibleStart =
      !ribbonPathVisible || opaqueTrajectory || hiddenTrajectory
        ? 0
        : MathUtils.clamp(
            pathProgress + PATH_RENDER_FADE_START_DISTANCE / Math.max(pathLength, Number.EPSILON),
            0,
            1,
          )
    const frontFadeLength =
      !ribbonPathVisible || opaqueTrajectory || hiddenTrajectory
        ? 0
        : MathUtils.clamp(
            (PATH_RENDER_FADE_END_DISTANCE - PATH_RENDER_FADE_START_DISTANCE) / pathLength,
            0.0001,
            1,
          )

    if (!actorGroup) {
      recordNavigationPerfSample('navigation.frameMs', performance.now() - frameStart)
      return
    }

    const pendingPascalTruckIntroSettlePosition = pascalTruckIntroPendingSettlePositionRef.current
    if (pendingPascalTruckIntroSettlePosition) {
      actorGroup.position.set(
        pendingPascalTruckIntroSettlePosition[0],
        pendingPascalTruckIntroSettlePosition[1],
        pendingPascalTruckIntroSettlePosition[2],
      )
      const settledActorWorldPosition: [number, number, number] = [
        actorGroup.position.x,
        actorGroup.position.y,
        actorGroup.position.z,
      ]
      pascalTruckIntroPendingSettlePositionRef.current = null
      lastPublishedActorPositionRef.current = settledActorWorldPosition
      lastPublishedActorPositionAtRef.current = performance.now()
      setActorWorldPosition(settledActorWorldPosition)
      navigationEmitter.emit('navigation:actor-transform', {
        moving: false,
        position: settledActorWorldPosition,
        rotationY: actorGroup.rotation.y,
      })
    }

    const pascalTruckIntro = pascalTruckIntroRef.current
    if (pascalTruckIntro) {
      const now = performance.now()
      const introStepMs = Math.min(frameDeltaMs, PASCAL_TRUCK_ENTRY_MAX_STEP_MS)
      if (pascalTruckIntro.revealStarted && !pascalTruckIntro.animationStarted) {
        pascalTruckIntro.revealElapsedMs = Math.min(
          PASCAL_TRUCK_ENTRY_REVEAL_DURATION_MS,
          pascalTruckIntro.revealElapsedMs + introStepMs,
        )
        if (pascalTruckIntro.revealElapsedMs >= PASCAL_TRUCK_ENTRY_REVEAL_DURATION_MS - 1e-3) {
          pascalTruckIntro.animationStarted = true
        }
      } else if (pascalTruckIntro.animationStarted) {
        pascalTruckIntro.animationElapsedMs = Math.min(
          PASCAL_TRUCK_ENTRY_CLIP_DURATION_SECONDS * 1000,
          pascalTruckIntro.animationElapsedMs + introStepMs,
        )
      }

      const revealProgress = pascalTruckIntro.revealStarted
        ? MathUtils.clamp(
            pascalTruckIntro.revealElapsedMs / PASCAL_TRUCK_ENTRY_REVEAL_DURATION_MS,
            0,
            1,
          )
        : 0
      const animationProgress = MathUtils.clamp(
        pascalTruckIntro.animationElapsedMs / (PASCAL_TRUCK_ENTRY_CLIP_DURATION_SECONDS * 1000),
        0,
        1,
      )
      const revealTravelProgress =
        (1 - (1 - revealProgress) * (1 - revealProgress)) * PASCAL_TRUCK_ENTRY_REVEAL_TRAVEL_RATIO
      const animationTravelProgress =
        smoothstep01(
          MathUtils.clamp(animationProgress / PASCAL_TRUCK_ENTRY_TRAVEL_END_PROGRESS, 0, 1),
        ) *
        (1 - PASCAL_TRUCK_ENTRY_REVEAL_TRAVEL_RATIO)
      const positionBlend = Math.min(1, revealTravelProgress + animationTravelProgress)
      actorGroup.position.set(
        MathUtils.lerp(
          pascalTruckIntro.startPosition[0],
          pascalTruckIntro.endPosition[0],
          positionBlend,
        ),
        MathUtils.lerp(
          pascalTruckIntro.startPosition[1],
          pascalTruckIntro.endPosition[1],
          positionBlend,
        ),
        MathUtils.lerp(
          pascalTruckIntro.startPosition[2],
          pascalTruckIntro.endPosition[2],
          positionBlend,
        ),
      )
      actorGroup.rotation.y = pascalTruckIntro.rotationY
      const preservedRootMotionOffset = motionRef.current.rootMotionOffset
      setMotionState(
        {
          ...createActorMotionState(),
          destinationCellIndex: pascalTruckIntro.finalCellIndex,
          forcedClip: {
            clipName: PASCAL_TRUCK_ENTRY_CLIP_NAME,
            holdLastFrame: true,
            loop: 'once',
            paused: !pascalTruckIntro.animationStarted,
            revealProgress,
            seekTime: pascalTruckIntro.animationStarted ? null : 0,
            timeScale: 1,
          },
          rootMotionOffset: preservedRootMotionOffset,
        },
        'pascalTruckIntro:frame',
      )

      const actorVisualWorldPosition: [number, number, number] = [
        actorGroup.position.x + preservedRootMotionOffset[0],
        actorGroup.position.y,
        actorGroup.position.z + preservedRootMotionOffset[2],
      ]
      if (followRobotEnabled) {
        navigationEmitter.emit('navigation:actor-transform', {
          moving: false,
          position: actorVisualWorldPosition,
          rotationY: actorGroup.rotation.y,
        })
      }

      const lastPublishedActorPosition = lastPublishedActorPositionRef.current
      const shouldPublishActorPosition =
        !lastPublishedActorPosition ||
        Math.hypot(
          actorVisualWorldPosition[0] - lastPublishedActorPosition[0],
          actorVisualWorldPosition[1] - lastPublishedActorPosition[1],
          actorVisualWorldPosition[2] - lastPublishedActorPosition[2],
        ) > ACTOR_POSITION_PUBLISH_DISTANCE ||
        now - lastPublishedActorPositionAtRef.current > ACTOR_POSITION_PUBLISH_INTERVAL_MS

      if (shouldPublishActorPosition || animationProgress >= 1) {
        lastPublishedActorPositionRef.current = actorVisualWorldPosition
        lastPublishedActorPositionAtRef.current = now
      }

      if (animationProgress >= 1 && pascalTruckIntro.animationStarted) {
        if (!pascalTruckIntro.handoffPending) {
          pascalTruckIntro.handoffPending = true
        } else {
          const settledActorWorldPosition: [number, number, number] = [
            actorGroup.position.x + preservedRootMotionOffset[0],
            actorGroup.position.y,
            actorGroup.position.z + preservedRootMotionOffset[2],
          ]
          const settledActorCellIndex = graph
            ? (findClosestNavigationCell(
                graph,
                [
                  settledActorWorldPosition[0],
                  settledActorWorldPosition[1] - ACTOR_HOVER_Y,
                  settledActorWorldPosition[2],
                ],
                selection.levelId ??
                  (pascalTruckIntro.finalCellIndex !== null
                    ? toLevelNodeId(graph.cells[pascalTruckIntro.finalCellIndex]?.levelId)
                    : null) ??
                  undefined,
                null,
              ) ?? pascalTruckIntro.finalCellIndex)
            : pascalTruckIntro.finalCellIndex
          pascalTruckIntroPendingSettlePositionRef.current = settledActorWorldPosition
          pascalTruckIntroRef.current = null
          pascalTruckIntroPostWarmupTokenRef.current = null
          setPascalTruckIntroActive(false)
          setPascalTruckIntroCompleted(true)
          setMotionState(
            {
              ...createActorMotionState(),
              destinationCellIndex: settledActorCellIndex,
            },
            'pascalTruckIntro:complete',
          )
          if (settledActorCellIndex !== null && actorCellIndex !== settledActorCellIndex) {
            setActorCellIndex(settledActorCellIndex)
          }
        }
      }

      recordNavigationPerfSample('navigation.frameMs', performance.now() - frameStart)
      return
    }

    const pascalTruckExit = pascalTruckExitRef.current
    if (pascalTruckExit?.stage === 'fade') {
      const exitStepMs = Math.min(frameDeltaMs, PASCAL_TRUCK_ENTRY_MAX_STEP_MS)
      pascalTruckExit.fadeElapsedMs = Math.min(
        PASCAL_TRUCK_ENTRY_REVEAL_DURATION_MS,
        pascalTruckExit.fadeElapsedMs + exitStepMs,
      )
      const exitProgress = MathUtils.clamp(
        pascalTruckExit.fadeElapsedMs / PASCAL_TRUCK_ENTRY_REVEAL_DURATION_MS,
        0,
        1,
      )
      const revealProgress = 1 - exitProgress
      actorGroup.position.set(
        pascalTruckExit.endPosition[0],
        pascalTruckExit.endPosition[1],
        pascalTruckExit.endPosition[2],
      )
      actorGroup.rotation.y = pascalTruckExit.rotationY
      motionRef.current.moving = false
      motionRef.current.locomotion = createActorLocomotionState()
      motionRef.current.forcedClip = null
      motionRef.current.rootMotionOffset = [0, 0, 0]
      motionRef.current.visibilityRevealProgress = revealProgress

      const exitActorWorldPosition: [number, number, number] = [
        actorGroup.position.x,
        actorGroup.position.y,
        actorGroup.position.z,
      ]
      if (followRobotEnabled) {
        navigationEmitter.emit('navigation:actor-transform', {
          moving: false,
          position: exitActorWorldPosition,
          rotationY: actorGroup.rotation.y,
        })
      }

      if (exitProgress >= 0.999) {
        pascalTruckExitRef.current = null
        setPascalTruckExitActive(false)
        const navigationState = useNavigation.getState()
        const hasPendingTaskRequest =
          navigationState.itemMoveRequest !== null ||
          navigationState.itemDeleteRequest !== null ||
          navigationState.itemRepairRequest !== null
        const hasPendingTaskWork =
          hasPendingTaskRequest || (robotMode === 'task' && navigationState.taskQueue.length > 0)
        if (hasPendingTaskWork && beginPascalTruckIntro()) {
          setActorCellIndex(null)
        } else {
          setPascalTruckIntroCompleted(false)
          setActorCellIndex(null)
          resetMotion(true)
        }
      }

      recordNavigationPerfSample('navigation.frameMs', performance.now() - frameStart)
      return
    }

    if (debugDistance !== null && primaryPathCurve && primaryPathLength > Number.EPSILON) {
      const debugProgress = MathUtils.clamp(debugDistance / primaryPathLength, 0, 1)
      primaryPathCurve.getPointAt(debugProgress, actorPointRef.current)
      primaryPathCurve.getTangentAt(
        Math.min(0.999, debugProgress + 0.0001),
        actorTangentRef.current,
      )
      actorGroup.position.set(
        actorPointRef.current.x,
        actorPointRef.current.y + ACTOR_HOVER_Y,
        actorPointRef.current.z,
      )
      actorGroup.rotation.y = Math.atan2(actorTangentRef.current.x, actorTangentRef.current.z)
    }

    trajectoryRibbonMaterial.userData.uFadeLength.value = frontFadeLength
    trajectoryRibbonMaterial.userData.uOpaque.value = opaqueTrajectory ? 1 : 0
    trajectoryRibbonMaterial.userData.uReveal.value = ribbonPathVisible && !hiddenTrajectory ? 1 : 0
    trajectoryRibbonMaterial.userData.uVisibleStart.value = visibleStart
    const actorWorldPosition: [number, number, number] = [
      actorGroup.position.x,
      actorGroup.position.y,
      actorGroup.position.z,
    ]
    if (followRobotEnabled) {
      navigationEmitter.emit('navigation:actor-transform', {
        moving: motionRef.current.moving,
        position: actorWorldPosition,
        rotationY: actorGroup.rotation.y,
      })
    }
    const lastPublishedActorPosition = lastPublishedActorPositionRef.current
    const now = performance.now()
    const shouldPublishActorPosition =
      !lastPublishedActorPosition ||
      Math.hypot(
        actorWorldPosition[0] - lastPublishedActorPosition[0],
        actorWorldPosition[1] - lastPublishedActorPosition[1],
        actorWorldPosition[2] - lastPublishedActorPosition[2],
      ) > ACTOR_POSITION_PUBLISH_DISTANCE ||
      (motionRef.current.moving &&
        now - lastPublishedActorPositionAtRef.current > ACTOR_POSITION_PUBLISH_INTERVAL_MS)

    if (shouldPublishActorPosition) {
      lastPublishedActorPositionRef.current = actorWorldPosition
      lastPublishedActorPositionAtRef.current = now
    }

    const activeItemMoveSequence = itemMoveSequenceRef.current
    const activeItemDeleteSequence = itemDeleteSequenceRef.current
    const activeItemRepairSequence = itemRepairSequenceRef.current
    toolInteractionPhaseRef.current = activeItemMoveSequence
      ? activeItemMoveSequence.stage === 'pickup-transfer' ||
        activeItemMoveSequence.stage === 'to-target'
        ? 'pickup'
        : activeItemMoveSequence.stage === 'drop-transfer' ||
            activeItemMoveSequence.stage === 'drop-settle'
          ? 'drop'
          : null
      : activeItemDeleteSequence?.stage === 'delete-transfer'
        ? 'delete'
        : activeItemRepairSequence?.stage === 'repair-transfer'
          ? 'repair'
          : null
    toolInteractionTargetItemIdRef.current = activeItemMoveSequence
      ? activeItemMoveSequence.stage === 'pickup-transfer'
        ? activeItemMoveSequence.pickupCarryVisualStartedAt !== null
          ? getNavigationItemMoveVisualItemId(activeItemMoveSequence.request)
          : activeItemMoveSequence.request.itemId
        : activeItemMoveSequence.stage === 'drop-transfer' ||
            activeItemMoveSequence.stage === 'drop-settle'
          ? getNavigationItemMoveVisualItemId(activeItemMoveSequence.request)
          : null
      : activeItemDeleteSequence?.stage === 'delete-transfer'
        ? activeItemDeleteSequence.request.itemId
        : activeItemRepairSequence?.stage === 'repair-transfer'
          ? activeItemRepairSequence.request.itemId
          : null
    if (
      !activeItemMoveSequence &&
      !activeItemDeleteSequence &&
      !activeItemRepairSequence &&
      itemMoveForcedClipPlayback
    ) {
      clearItemMoveGestureClipState()
    }
    const currentMovingNode = useEditor.getState().movingNode
    if (NAVIGATION_FRAME_TRACE_ENABLED) {
      const registeredMoveControllerId = Object.keys(itemMoveControllers)[0] ?? null
      const traceSourceId =
        currentMovingNode?.id ??
        registeredMoveControllerId ??
        activeItemMoveSequence?.request.itemId ??
        null
      if (traceSourceId && itemMoveTraceSourceIdRef.current !== traceSourceId) {
        itemMoveTraceSourceIdRef.current = traceSourceId
        itemMoveTraceSourceBaselineRef.current = null
        itemMoveTraceGhostBaselineRef.current = null
        itemMoveFrameTraceRef.current = []
      }
      const traceActive = Boolean(traceSourceId || itemMoveTraceCooldownFramesRef.current > 0)
      if (traceSourceId) {
        itemMoveTraceCooldownFramesRef.current = 90
      } else if (itemMoveTraceCooldownFramesRef.current > 0) {
        itemMoveTraceCooldownFramesRef.current -= 1
      } else {
        itemMoveTraceSourceIdRef.current = null
        itemMoveTraceSourceBaselineRef.current = null
        itemMoveTraceGhostBaselineRef.current = null
      }
      if (traceActive) {
        const liveSceneNodes = useScene.getState().nodes as Record<string, any>
        const previewSelectedIds = [...useViewer.getState().previewSelectedIds]
        const transientPreviewGhostId =
          Object.values(liveSceneNodes).find((node) => {
            if (node?.type !== 'item' || node.id === traceSourceId) {
              return false
            }

            const metadata =
              typeof node.metadata === 'object' &&
              node.metadata !== null &&
              !Array.isArray(node.metadata)
                ? (node.metadata as Record<string, unknown>)
                : null
            return metadata?.isTransient === true
          })?.id ?? null
        const ghostId = previewSelectedIds[0] ?? transientPreviewGhostId
        const sourceNode = traceSourceId ? liveSceneNodes[traceSourceId] : null
        const ghostNode = ghostId ? liveSceneNodes[ghostId] : null
        const sourceObject = traceSourceId ? sceneRegistry.nodes.get(traceSourceId) : null
        const ghostObject = ghostId ? sceneRegistry.nodes.get(ghostId) : null
        const sourceWorldPosition = sourceObject
          ? (() => {
              const world = sourceObject.getWorldPosition(actorPointRef.current)
              return [world.x, world.y, world.z] as [number, number, number]
            })()
          : null
        const ghostWorldPosition = ghostObject
          ? (() => {
              const world = ghostObject.getWorldPosition(actorFallbackPointRef.current)
              return [world.x, world.y, world.z] as [number, number, number]
            })()
          : null

        if (sourceWorldPosition && !itemMoveTraceSourceBaselineRef.current) {
          itemMoveTraceSourceBaselineRef.current = [...sourceWorldPosition] as [
            number,
            number,
            number,
          ]
        }
        if (ghostWorldPosition && !itemMoveTraceGhostBaselineRef.current) {
          itemMoveTraceGhostBaselineRef.current = [...ghostWorldPosition] as [
            number,
            number,
            number,
          ]
        }

        const sourceBaseline = itemMoveTraceSourceBaselineRef.current
        const ghostBaseline = itemMoveTraceGhostBaselineRef.current
        itemMoveFrameTraceRef.current.push({
          at: now,
          ghostId,
          ghostLivePosition: ghostId
            ? (useLiveTransforms.getState().get(ghostId)?.position ?? null)
            : null,
          ghostLocalPosition: ghostObject
            ? ([ghostObject.position.x, ghostObject.position.y, ghostObject.position.z] as [
                number,
                number,
                number,
              ])
            : null,
          ghostNodePosition: ghostNode?.type === 'item' ? ghostNode.position : null,
          ghostWorldDeltaYFromStart:
            ghostWorldPosition && ghostBaseline ? ghostWorldPosition[1] - ghostBaseline[1] : null,
          ghostWorldDeltaZFromStart:
            ghostWorldPosition && ghostBaseline ? ghostWorldPosition[2] - ghostBaseline[2] : null,
          ghostWorldPosition,
          sourceId: traceSourceId,
          sourceLivePosition: traceSourceId
            ? (useLiveTransforms.getState().get(traceSourceId)?.position ?? null)
            : null,
          sourceLocalPosition: sourceObject
            ? ([sourceObject.position.x, sourceObject.position.y, sourceObject.position.z] as [
                number,
                number,
                number,
              ])
            : null,
          sourceNodePosition: sourceNode?.type === 'item' ? sourceNode.position : null,
          sourceWorldDeltaYFromStart:
            sourceWorldPosition && sourceBaseline
              ? sourceWorldPosition[1] - sourceBaseline[1]
              : null,
          sourceWorldDeltaZFromStart:
            sourceWorldPosition && sourceBaseline
              ? sourceWorldPosition[2] - sourceBaseline[2]
              : null,
          sourceWorldPosition,
          stage: activeItemMoveSequence?.stage ?? null,
        })
        if (itemMoveFrameTraceRef.current.length > 360) {
          itemMoveFrameTraceRef.current.shift()
        }
      }
    }
    if (currentMovingNode && !activeItemMoveSequence) {
      recordNavigationPerfSample('navigation.itemMovePreviewFrameDeltaMs', frameDeltaMs)
    }
    if (activeItemMoveSequence) {
      recordNavigationPerfSample('navigation.itemMoveSequenceFrameDeltaMs', frameDeltaMs)
    }
    const applySmoothedActorFacing = (targetPosition: [number, number, number] | null) => {
      if (!targetPosition) {
        return
      }

      const deltaX = targetPosition[0] - actorGroup.position.x
      const deltaZ = targetPosition[2] - actorGroup.position.z
      if (deltaX * deltaX + deltaZ * deltaZ <= 1e-6) {
        return
      }

      const targetYaw = Math.atan2(deltaX, deltaZ)
      const yawDelta = getShortestAngleDelta(actorGroup.rotation.y, targetYaw)
      actorGroup.rotation.y = MathUtils.damp(
        actorGroup.rotation.y,
        actorGroup.rotation.y + yawDelta,
        ACTOR_TURN_RESPONSE,
        delta,
      )
    }
    const syncCarriedItem = (sequence: NavigationItemMoveSequence, wobbleEnabled: boolean) => {
      const visualItemId = getNavigationItemMoveVisualItemId(sequence.request)
      const carryAnchor = getCarryAnchorPosition(
        [actorGroup.position.x, actorGroup.position.y, actorGroup.position.z],
        actorGroup.rotation.y,
        sequence.request.itemDimensions,
        now,
        wobbleEnabled,
      )
      sequence.controller.updateCarryTransform(
        carryAnchor.position,
        sequence.request.sourceRotation[1] ?? 0,
      )
      useLiveTransforms.getState().set(visualItemId, {
        position: carryAnchor.position,
        rotation: sequence.request.sourceRotation[1] ?? 0,
      })
    }
    const syncCarryVisualItem = (sequence: NavigationItemMoveSequence | null) => {
      const nextCarryVisualItemId =
        sequence &&
        ((sequence.stage === 'pickup-transfer' && sequence.pickupCarryVisualStartedAt !== null) ||
          sequence.stage === 'to-target' ||
          sequence.stage === 'drop-transfer' ||
          sequence.stage === 'drop-settle')
          ? getNavigationItemMoveVisualItemId(sequence.request)
          : null

      if (carriedVisualItemIdRef.current !== nextCarryVisualItemId) {
        if (carriedVisualItemIdRef.current) {
          navigationVisualsStore
            .getState()
            .setItemMoveVisualState(carriedVisualItemIdRef.current, null)
        }
        if (nextCarryVisualItemId) {
          navigationVisualsStore.getState().setItemMoveVisualState(nextCarryVisualItemId, 'carried')
        }
        carriedVisualItemIdRef.current = nextCarryVisualItemId
      }
    }
    const beginPickup = (sequence: NavigationItemMoveSequence) => {
      if (sequence.pickupStartedAt !== null) {
        return
      }

      sequence.stage = 'pickup-transfer'
      sequence.pickupStartedAt = now
      sequence.pickupCarryVisualStartedAt = null
      sequence.pickupTransferStartedAt = null
      sequence.dropStartedAt = null
      sequence.dropStartPosition = null
      sequence.dropSettledAt = null
      itemMoveStageHistoryRef.current.push({ at: now, stage: 'pickup-transfer' })
      recordNavigationPerfMark('navigation.itemMoveStage', { stage: 'pickup-transfer' })
      syncItemMoveGestureClipState(sequence.pickupGesture, 0)
      if (!shouldDelayPickupCarryUntilCheckoutComplete(sequence.request)) {
        sequence.pickupCarryVisualStartedAt = now
        sequence.pickupTransferStartedAt = now
        sequence.controller.beginCarry()
        navigationVisualsStore
          .getState()
          .setItemMoveVisualState(getNavigationItemMoveVisualItemId(sequence.request), 'carried')
      }
    }
    const beginDrop = (sequence: NavigationItemMoveSequence) => {
      if (sequence.dropStartedAt !== null) {
        return
      }

      const targetNodePosition = sequence.request.finalUpdate.position
      if (!targetNodePosition) {
        cancelItemMoveSequence()
        return
      }

      sequence.stage = 'drop-transfer'
      sequence.dropStartedAt = now
      sequence.dropStartPosition = getCarryAnchorPosition(
        [actorGroup.position.x, actorGroup.position.y, actorGroup.position.z],
        actorGroup.rotation.y,
        sequence.request.itemDimensions,
        now,
        false,
      ).position
      sequence.dropSettledAt = null
      itemMoveStageHistoryRef.current.push({ at: now, stage: 'drop-transfer' })
      recordNavigationPerfMark('navigation.itemMoveStage', { stage: 'drop-transfer' })
      syncItemMoveGestureClipState(sequence.dropGesture, 0)
    }
    const beginItemDelete = (sequence: NavigationItemDeleteSequence) => {
      if (sequence.deleteStartedAt !== null) {
        return
      }

      sequence.stage = 'delete-transfer'
      sequence.deleteStartedAt = now
      syncItemMoveGestureClipState(sequence.gesture, 0)
    }
    const beginItemRepair = (sequence: NavigationItemRepairSequence) => {
      if (sequence.repairStartedAt !== null) {
        return
      }

      sequence.stage = 'repair-transfer'
      sequence.repairStartedAt = now
      syncItemMoveGestureClipState(sequence.gesture, 0)
      navigationVisualsStore.getState().activateRepairShield(sequence.request.itemId)
    }
    if (trajectoryDebugPauseRef.current) {
      recordNavigationPerfSample('navigation.frameMs', performance.now() - frameStart)
      return
    }

    if (primaryPathLength <= Number.EPSILON) {
      motionRef.current.moving = false
      motionRef.current.locomotion = createActorLocomotionState()
      if (actorMoving) {
        setActorMoving(false)
      }
    }

    const waitingForPendingMotion = pendingMotionRef.current !== null
    const hasActivePathMotion =
      Boolean(primaryPathCurve) && motionRef.current.moving && primaryPathLength > Number.EPSILON

    if (
      pascalTruckExit?.stage === 'to-truck' &&
      !hasActivePathMotion &&
      !waitingForPendingMotion &&
      activeItemMoveSequence === null &&
      activeItemDeleteSequence === null &&
      activeItemRepairSequence === null
    ) {
      const exitActorWorldPosition = getResolvedActorWorldPosition()
      const actorToTruckDistance =
        exitActorWorldPosition === null
          ? Number.POSITIVE_INFINITY
          : Math.hypot(
              exitActorWorldPosition[0] - pascalTruckExit.endPosition[0],
              exitActorWorldPosition[1] - pascalTruckExit.endPosition[1],
              exitActorWorldPosition[2] - pascalTruckExit.endPosition[2],
            )

      if (pathIndices.length > 1 && primaryPathCurve && primaryPathLength > Number.EPSILON) {
        setMotionState(
          {
            ...createActorMotionState(),
            destinationCellIndex: pascalTruckExit.finalCellIndex,
            distance: 0,
            moving: true,
            speed: Math.max(motionRef.current.speed, ACTOR_WALK_MAX_SPEED * 0.35),
            visibilityRevealProgress: 1,
          },
          'pascalTruckExit:recoverMotion',
        )
        motionRef.current.visibilityRevealProgress = 1
        setActorMoving(true)
        recordTaskModeTrace('navigation.pascalTruckExitRecoveredMotion', {
          actorToTruckDistance,
          pathLength: primaryPathLength,
          pathNodeCount: pathIndices.length,
        })
        recordNavigationPerfSample('navigation.frameMs', performance.now() - frameStart)
        return
      }

      if (actorToTruckDistance > 0.2 && tryStartPascalTruckExitPath(pascalTruckExit)) {
        recordTaskModeTrace('navigation.pascalTruckExitRetriedPath', {
          actorToTruckDistance,
          finalCellIndex: pascalTruckExit.finalCellIndex,
          pathNodeCount: pathIndices.length,
        })
        recordNavigationPerfSample('navigation.frameMs', performance.now() - frameStart)
        return
      }

      actorGroup.position.set(
        pascalTruckExit.endPosition[0],
        pascalTruckExit.endPosition[1],
        pascalTruckExit.endPosition[2],
      )
      actorGroup.rotation.y = pascalTruckExit.rotationY
      pascalTruckExit.stage = 'fade'
      pascalTruckExit.fadeElapsedMs = 0
      setPathIndices([])
      setPathAnchorWorldPosition(null)
      setMotionState(
        {
          ...createActorMotionState(),
          destinationCellIndex: pascalTruckExit.finalCellIndex,
          visibilityRevealProgress: 1,
        },
        'pascalTruckExit:arrive',
      )
      motionRef.current.visibilityRevealProgress = 1
      setActorMoving(false)
      recordNavigationPerfSample('navigation.frameMs', performance.now() - frameStart)
      return
    }

    if (!hasActivePathMotion || !primaryPathCurve) {
      motionRef.current.locomotion = createActorLocomotionState()
      if (activeItemMoveSequence) {
        if (activeItemMoveSequence.stage === 'to-source' && !waitingForPendingMotion) {
          beginPickup(activeItemMoveSequence)
          applySmoothedActorFacing(activeItemMoveSequence.request.sourcePosition)
        } else if (activeItemMoveSequence.stage === 'pickup-transfer') {
          if (activeItemMoveSequence.pickupStartedAt === null) {
            beginPickup(activeItemMoveSequence)
            applySmoothedActorFacing(activeItemMoveSequence.request.sourcePosition)
          } else {
            const visualItemId = getNavigationItemMoveVisualItemId(activeItemMoveSequence.request)
            const pickupGestureProgress = clamp01(
              (now - activeItemMoveSequence.pickupStartedAt) /
                getItemInteractionGestureDurationMs(activeItemMoveSequence.pickupGesture),
            )
            syncItemMoveGestureClipState(
              activeItemMoveSequence.pickupGesture,
              pickupGestureProgress,
            )
            applySmoothedActorFacing(activeItemMoveSequence.sourceDisplayPosition)
            if (
              activeItemMoveSequence.pickupCarryVisualStartedAt === null &&
              pickupGestureProgress >= 0.5
            ) {
              activeItemMoveSequence.pickupCarryVisualStartedAt = now
              activeItemMoveSequence.controller.beginCarry()
              navigationVisualsStore.getState().setItemMoveVisualState(visualItemId, 'carried')
            }
            if (
              activeItemMoveSequence.pickupTransferStartedAt === null &&
              pickupGestureProgress >= 0.999
            ) {
              if (activeItemMoveSequence.pickupCarryVisualStartedAt === null) {
                activeItemMoveSequence.pickupCarryVisualStartedAt = now
                activeItemMoveSequence.controller.beginCarry()
                navigationVisualsStore.getState().setItemMoveVisualState(visualItemId, 'carried')
              }
              activeItemMoveSequence.pickupTransferStartedAt = now
            }
            if (activeItemMoveSequence.pickupTransferStartedAt !== null) {
              const pickupTransferProgress = clamp01(
                (now - activeItemMoveSequence.pickupTransferStartedAt) /
                  ITEM_MOVE_PICKUP_DURATION_MS,
              )
              const pickupTransform = getPickupTransferTransform(
                [actorGroup.position.x, actorGroup.position.y, actorGroup.position.z],
                actorGroup.rotation.y,
                activeItemMoveSequence.request.itemDimensions,
                activeItemMoveSequence.sourceDisplayPosition,
                activeItemMoveSequence.request.sourceRotation[1] ?? 0,
                now,
                pickupTransferProgress,
              )
              activeItemMoveSequence.controller.updateCarryTransform(
                pickupTransform.position,
                pickupTransform.rotationY,
              )
              useLiveTransforms.getState().set(visualItemId, {
                position: pickupTransform.position,
                rotation: pickupTransform.rotationY,
              })

              if (pickupTransferProgress >= 0.999) {
                if (pickupGestureProgress >= 0.999) {
                  const startedTargetMove = commitPlannedNavigationPath(
                    activeItemMoveSequence.targetPlanningGraph,
                    activeItemMoveSequence.targetPath,
                    activeItemMoveSequence.targetApproach.world,
                    activeItemMoveSequence.targetApproach.cellIndex,
                  )
                  if (startedTargetMove) {
                    clearItemMoveGestureClipState()
                    activeItemMoveSequence.stage = 'to-target'
                    activeItemMoveSequence.pickupCarryVisualStartedAt = null
                    activeItemMoveSequence.pickupStartedAt = null
                    activeItemMoveSequence.pickupTransferStartedAt = null
                    itemMoveStageHistoryRef.current.push({ at: now, stage: 'to-target' })
                    recordNavigationPerfMark('navigation.itemMoveStage', { stage: 'to-target' })
                  } else {
                    cancelItemMoveSequence()
                  }
                }
              }
            }
          }
        } else if (activeItemMoveSequence.stage === 'to-target' && !waitingForPendingMotion) {
          beginDrop(activeItemMoveSequence)
          applySmoothedActorFacing(activeItemMoveSequence.request.finalUpdate.position ?? null)
        } else if (
          activeItemMoveSequence.stage === 'drop-transfer' ||
          activeItemMoveSequence.stage === 'drop-settle'
        ) {
          if (
            activeItemMoveSequence.dropStartedAt === null ||
            !activeItemMoveSequence.dropStartPosition
          ) {
            beginDrop(activeItemMoveSequence)
          } else if (activeItemMoveSequence.stage === 'drop-settle') {
            const visualItemId = getNavigationItemMoveVisualItemId(activeItemMoveSequence.request)
            const dropGestureProgress = clamp01(
              (now - activeItemMoveSequence.dropStartedAt) /
                getItemInteractionGestureDurationMs(activeItemMoveSequence.dropGesture),
            )
            applySmoothedActorFacing(activeItemMoveSequence.targetDisplayPosition)
            syncItemMoveGestureClipState(activeItemMoveSequence.dropGesture, dropGestureProgress)
            activeItemMoveSequence.controller.updateCarryTransform(
              activeItemMoveSequence.targetDisplayPosition,
              activeItemMoveSequence.targetRotationY,
            )
            useLiveTransforms.getState().set(visualItemId, {
              position: activeItemMoveSequence.targetDisplayPosition,
              rotation: activeItemMoveSequence.targetRotationY,
            })
            if (
              dropGestureProgress >= 0.999 &&
              activeItemMoveSequence.dropSettledAt !== null &&
              now - activeItemMoveSequence.dropSettledAt >= ITEM_MOVE_DROP_SETTLE_DURATION_MS
            ) {
              completeItemMoveSequence(activeItemMoveSequence, {
                position: activeItemMoveSequence.targetDisplayPosition,
                rotation: activeItemMoveSequence.targetRotationY,
              })
            }
          } else {
            const visualItemId = getNavigationItemMoveVisualItemId(activeItemMoveSequence.request)
            applySmoothedActorFacing(activeItemMoveSequence.targetDisplayPosition)
            const dropTransferProgress = clamp01(
              (now - activeItemMoveSequence.dropStartedAt) / ITEM_MOVE_DROP_DURATION_MS,
            )
            const dropGestureProgress = clamp01(
              (now - activeItemMoveSequence.dropStartedAt) /
                getItemInteractionGestureDurationMs(activeItemMoveSequence.dropGesture),
            )
            syncItemMoveGestureClipState(activeItemMoveSequence.dropGesture, dropGestureProgress)
            const dropTransform = getDropTransferTransform(
              activeItemMoveSequence.dropStartPosition,
              activeItemMoveSequence.targetDisplayPosition,
              activeItemMoveSequence.request.sourceRotation[1] ?? 0,
              activeItemMoveSequence.targetRotationY,
              dropTransferProgress,
            )
            activeItemMoveSequence.controller.updateCarryTransform(
              dropTransform.position,
              dropTransform.rotationY,
            )
            useLiveTransforms.getState().set(visualItemId, {
              position: dropTransform.position,
              rotation: dropTransform.rotationY,
            })

            if (dropTransferProgress >= 0.999) {
              activeItemMoveSequence.controller.updateCarryTransform(
                activeItemMoveSequence.targetDisplayPosition,
                activeItemMoveSequence.targetRotationY,
              )
              useLiveTransforms.getState().set(visualItemId, {
                position: activeItemMoveSequence.targetDisplayPosition,
                rotation: activeItemMoveSequence.targetRotationY,
              })
              activeItemMoveSequence.stage = 'drop-settle'
              activeItemMoveSequence.dropSettledAt = now
              itemMoveStageHistoryRef.current.push({ at: now, stage: 'drop-settle' })
              recordNavigationPerfMark('navigation.itemMoveStage', { stage: 'drop-settle' })
            }
          }
        }
      }
      if (activeItemDeleteSequence) {
        const deleteSourcePosition = getRenderedFloorItemPosition(
          activeItemDeleteSequence.request.levelId,
          activeItemDeleteSequence.request.sourcePosition,
          activeItemDeleteSequence.request.itemDimensions,
          activeItemDeleteSequence.request.sourceRotation,
        )

        if (activeItemDeleteSequence.stage === 'to-source' && !waitingForPendingMotion) {
          beginItemDelete(activeItemDeleteSequence)
          applySmoothedActorFacing(deleteSourcePosition)
        } else if (activeItemDeleteSequence.stage === 'delete-transfer') {
          if (activeItemDeleteSequence.deleteStartedAt === null) {
            beginItemDelete(activeItemDeleteSequence)
            applySmoothedActorFacing(deleteSourcePosition)
          } else {
            const deleteElapsedMs = now - activeItemDeleteSequence.deleteStartedAt
            const deleteProgress = clamp01(
              deleteElapsedMs /
                getItemInteractionGestureDurationMs(activeItemDeleteSequence.gesture),
            )
            const deleteFadeStartedAtMs =
              navigationVisualsStore.getState().itemDeleteActivations[
                activeItemDeleteSequence.request.itemId
              ]?.fadeStartedAtMs ?? null
            syncItemMoveGestureClipState(activeItemDeleteSequence.gesture, deleteProgress)
            applySmoothedActorFacing(deleteSourcePosition)

            if (deleteFadeStartedAtMs === null && deleteProgress >= 0.5) {
              navigationVisualsStore
                .getState()
                .beginItemDeleteFade(activeItemDeleteSequence.request.itemId, now)
            }

            if (
              deleteProgress >= 0.999 &&
              deleteFadeStartedAtMs !== null &&
              now - deleteFadeStartedAtMs >= ITEM_DELETE_FADE_OUT_MS
            ) {
              completeItemDeleteSequence(activeItemDeleteSequence)
            }
          }
        }
      }
      if (activeItemRepairSequence) {
        const repairSourcePosition = getRenderedFloorItemPosition(
          activeItemRepairSequence.request.levelId,
          activeItemRepairSequence.request.sourcePosition,
          activeItemRepairSequence.request.itemDimensions,
          activeItemRepairSequence.request.sourceRotation,
        )

        if (activeItemRepairSequence.stage === 'to-source' && !waitingForPendingMotion) {
          beginItemRepair(activeItemRepairSequence)
          applySmoothedActorFacing(repairSourcePosition)
        } else if (activeItemRepairSequence.stage === 'repair-transfer') {
          if (activeItemRepairSequence.repairStartedAt === null) {
            beginItemRepair(activeItemRepairSequence)
            applySmoothedActorFacing(repairSourcePosition)
          } else {
            const repairProgress = clamp01(
              (now - activeItemRepairSequence.repairStartedAt) /
                getItemInteractionGestureDurationMs(activeItemRepairSequence.gesture),
            )
            syncItemMoveGestureClipState(activeItemRepairSequence.gesture, repairProgress)
            applySmoothedActorFacing(repairSourcePosition)
            if (repairProgress >= 0.999) {
              completeItemRepairSequence(activeItemRepairSequence)
            }
          }
        }
      }

      syncCarryVisualItem(activeItemMoveSequence)
      recordNavigationPerfSample('navigation.frameMs', performance.now() - frameStart)
      return
    }

    const motionPathCurve = primaryPathCurve
    const currentProgress = motionRef.current.distance / primaryPathLength
    motionPathCurve.getTangentAt(
      Math.min(0.999, currentProgress + 0.0001),
      actorTangentAheadRef.current,
    )
    const currentTargetYaw = Math.atan2(
      actorTangentAheadRef.current.x,
      actorTangentAheadRef.current.z,
    )
    const currentYawDelta = getShortestAngleDelta(actorGroup.rotation.y, currentTargetYaw)
    const trajectoryMotionState = getTrajectoryMotionState(
      activeMotionProfile,
      motionRef.current.distance,
    )
    const trajectoryRunBlend = trajectoryMotionState.runBlend
    const turnSpeedFactor = getTurnSpeedFactor(currentYawDelta)
    const speedCap =
      MathUtils.lerp(ACTOR_WALK_MAX_SPEED, ACTOR_RUN_MAX_SPEED, trajectoryRunBlend) *
      turnSpeedFactor
    const acceleration = MathUtils.lerp(
      ACTOR_WALK_ACCELERATION,
      ACTOR_RUN_ACCELERATION,
      trajectoryRunBlend,
    )
    const deceleration = MathUtils.lerp(
      ACTOR_WALK_DECELERATION,
      ACTOR_RUN_DECELERATION,
      trajectoryRunBlend,
    )
    const remainingDistance = primaryPathLength - motionRef.current.distance
    const brakingDistance =
      deceleration > Number.EPSILON
        ? (motionRef.current.speed * motionRef.current.speed) / (2 * deceleration)
        : 0

    if (remainingDistance <= brakingDistance || motionRef.current.speed > speedCap) {
      motionRef.current.speed = Math.max(
        0,
        motionRef.current.speed - deceleration * delta,
      )
    } else {
      motionRef.current.speed = Math.min(
        speedCap,
        motionRef.current.speed + acceleration * delta,
      )
    }

    const candidateDistance = Math.min(
      primaryPathLength,
      motionRef.current.distance + motionRef.current.speed * delta,
    )
    const candidateProgress = candidateDistance / primaryPathLength
    const activeDoorBounds = getActiveDoorLeafCollisionShapes(activeDoorCollisionCandidateIds)
    let resolvedMotionCurve = motionPathCurve

    motionPathCurve.getPointAt(candidateProgress, doorCollisionPointScratch)
    let blockingDoorIds = getBlockingDoorIdsForPoint(doorCollisionPointScratch, activeDoorBounds)

    if (
      blockingDoorIds.length > 0 &&
      candidatePathCurve &&
      conservativePathCurve &&
      motionPathCurve === candidatePathCurve
    ) {
      const conservativeCandidateProgress =
        conservativePathLength > Number.EPSILON
          ? Math.min(1, candidateDistance / conservativePathLength)
          : candidateProgress
      conservativePathCurve.getPointAt(conservativeCandidateProgress, actorFallbackPointRef.current)
      const fallbackBlockingDoorIds = getBlockingDoorIdsForPoint(
        actorFallbackPointRef.current,
        activeDoorBounds,
      )

      if (fallbackBlockingDoorIds.length === 0) {
        resolvedMotionCurve = conservativePathCurve
        blockingDoorIds = fallbackBlockingDoorIds
      }
    }

    const blockedByDoor = blockingDoorIds.length > 0
    doorCollisionStateRef.current = {
      blocked: blockedByDoor,
      doorIds: blockingDoorIds,
    }
    mergeNavigationPerfMeta({
      navigationDoorCollisionBlocked: blockedByDoor,
      navigationDoorCollisionDoorCount: blockingDoorIds.length,
    })

    if (blockedByDoor) {
      motionRef.current.speed = Math.max(
        0,
        motionRef.current.speed - deceleration * 1.5 * delta,
      )
    } else {
      motionRef.current.distance = candidateDistance
    }

    const resolvedTrajectoryMotionState = getTrajectoryMotionState(
      activeMotionProfile,
      motionRef.current.distance,
    )
    const locomotionMoveBlend = motionRef.current.moving
      ? smoothstep01(motionRef.current.speed / ACTOR_LOCOMOTION_BLEND_SPEED)
      : 0
    const locomotionRunBlend =
      resolvedTrajectoryMotionState.runBlend *
      smoothstep01(
        (motionRef.current.speed - ACTOR_WALK_MAX_SPEED * 0.82) /
          Math.max(ACTOR_RUN_MAX_SPEED - ACTOR_WALK_MAX_SPEED * 0.82, Number.EPSILON),
      )
    motionRef.current.locomotion = {
      moveBlend: locomotionMoveBlend,
      runBlend: Math.min(locomotionMoveBlend, locomotionRunBlend),
      runTimeScale: MathUtils.lerp(
        ACTOR_RUN_ANIMATION_SPEED_SCALE * 0.88,
        ACTOR_RUN_ANIMATION_SPEED_SCALE,
        clamp01(motionRef.current.speed / ACTOR_RUN_MAX_SPEED),
      ),
      sectionKind: resolvedTrajectoryMotionState.sectionKind,
      walkTimeScale: MathUtils.lerp(
        ACTOR_WALK_ANIMATION_SPEED_SCALE * 0.72,
        ACTOR_WALK_ANIMATION_SPEED_SCALE,
        clamp01(motionRef.current.speed / ACTOR_WALK_MAX_SPEED),
      ),
    }

    const progress = motionRef.current.distance / primaryPathLength
    let renderCurve = resolvedMotionCurve
    const conservativeProgress =
      conservativePathLength > Number.EPSILON
        ? Math.min(1, motionRef.current.distance / conservativePathLength)
        : progress

    if (candidatePathCurve && conservativePathCurve && renderCurve === candidatePathCurve) {
      candidatePathCurve.getPointAt(progress, actorPointRef.current)
      if (getBlockingDoorIdsForPoint(actorPointRef.current, activeDoorBounds).length > 0) {
        renderCurve = conservativePathCurve
      }
    }

    if (renderCurve === conservativePathCurve) {
      conservativePathCurve!.getPointAt(conservativeProgress, actorPointRef.current)
      conservativePathCurve!.getTangentAt(
        Math.min(0.999, conservativeProgress + 0.0001),
        actorTangentRef.current,
      )
    } else {
      motionPathCurve.getPointAt(progress, actorPointRef.current)
      motionPathCurve.getTangentAt(Math.min(0.999, progress + 0.0001), actorTangentRef.current)
    }
    const targetYaw = Math.atan2(actorTangentRef.current.x, actorTangentRef.current.z)
    const yawDelta = getShortestAngleDelta(actorGroup.rotation.y, targetYaw)

    actorGroup.position.set(
      actorPointRef.current.x,
      actorPointRef.current.y + ACTOR_HOVER_Y,
      actorPointRef.current.z,
    )
    actorGroup.rotation.y = MathUtils.damp(
      actorGroup.rotation.y,
      actorGroup.rotation.y + yawDelta,
      ACTOR_TURN_RESPONSE,
      delta,
    )

    if (activeItemMoveSequence?.stage === 'to-target') {
      syncCarriedItem(activeItemMoveSequence, true)
    }

    if (progress >= 0.999) {
      motionRef.current.moving = false
      motionRef.current.speed = 0
      motionRef.current.locomotion = createActorLocomotionState()
      if (actorMoving) {
        setActorMoving(false)
      }
      if (pathIndices.length > 0) {
        setPathIndices([])
      }
      setPathAnchorWorldPosition(null)
      const destinationCellIndex = motionRef.current.destinationCellIndex
      const settledActorWorldPosition = getResolvedActorVisualWorldPosition()
      const settledActorCellIndex =
        destinationCellIndex ??
        (graph && settledActorWorldPosition
          ? findClosestNavigationCell(
              graph,
              [
                settledActorWorldPosition[0],
                settledActorWorldPosition[1] - ACTOR_HOVER_Y,
                settledActorWorldPosition[2],
              ],
              selection.levelId ?? undefined,
              null,
            )
          : null)
      if (settledActorCellIndex !== null) {
        setActorCellIndex(settledActorCellIndex)
      }

      if (activeItemMoveSequence?.stage === 'to-source') {
        beginPickup(activeItemMoveSequence)
      } else if (activeItemMoveSequence?.stage === 'to-target') {
        beginDrop(activeItemMoveSequence)
      } else if (activeItemDeleteSequence?.stage === 'to-source') {
        beginItemDelete(activeItemDeleteSequence)
      } else if (activeItemRepairSequence?.stage === 'to-source') {
        beginItemRepair(activeItemRepairSequence)
      }
    }

    syncCarryVisualItem(activeItemMoveSequence)

    recordNavigationPerfSample('navigation.frameMs', performance.now() - frameStart)
  })

  const actorVisible =
    enabled &&
    (pascalTruckIntroActive ||
      pascalTruckExitActive ||
      (pascalTruckIntroCompleted &&
        actorCellIndex !== null &&
        Boolean(graph?.cells[actorCellIndex])))
  const actorRenderVisible =
    actorVisible &&
    (actorRenderVisibleOverrideRef.current === null || actorRenderVisibleOverrideRef.current)
  const actorToolAttachmentsVisible = robotToolAttachmentsVisibleOverrideRef.current ?? true
  const actorMounted = true
  const actorRenderPosition =
    getResolvedActorWorldPosition() ?? actorSpawnPosition ?? ([0, 0, 0] as [number, number, number])

  useEffect(() => {
    if (!(isNavigationDebugEnabled() && typeof window !== 'undefined')) {
      return
    }

    const getActorWorldPosition = () => getResolvedActorWorldPosition()

    const getActorNavigationPoint = () => {
      const actorWorldPosition = getActorWorldPosition()
      if (!actorWorldPosition) {
        return null
      }

      return [
        actorWorldPosition[0],
        actorWorldPosition[1] - ACTOR_HOVER_Y,
        actorWorldPosition[2],
      ] as [number, number, number]
    }

    const getConnectivitySnapshot = () => {
      if (!graph) {
        return null
      }

      const graphWithoutDoors = buildNavigationGraph(
        sceneState.nodes,
        sceneState.rootNodeIds,
        selection.buildingId,
        {
          includeDoorPortals: false,
        },
      )

      const actorNavigationPoint = getActorNavigationPoint()
      const actorLevelId =
        selection.levelId ?? (actorCellIndex !== null ? graph.cells[actorCellIndex]?.levelId : null)
      const actorCellIndexWithDoors =
        actorNavigationPoint !== null
          ? (findClosestNavigationCell(graph, actorNavigationPoint, actorLevelId, null) ??
            actorCellIndex)
          : actorCellIndex
      const actorCellIndexWithoutDoors =
        actorNavigationPoint !== null && graphWithoutDoors
          ? findClosestNavigationCell(graphWithoutDoors, actorNavigationPoint, actorLevelId, null)
          : null
      const actorComponentWithDoors =
        actorCellIndexWithDoors !== null
          ? (graph.componentIdByCell[actorCellIndexWithDoors] ?? null)
          : null
      const actorComponentWithoutDoors =
        actorCellIndexWithoutDoors !== null && graphWithoutDoors
          ? (graphWithoutDoors.componentIdByCell[actorCellIndexWithoutDoors] ?? null)
          : null

      const zones = Object.values(sceneState.nodes)
        .filter(
          (
            node,
          ): node is {
            id: string
            name?: string
            parentId?: string
            polygon: Array<[number, number]>
            type: 'zone'
            visible?: boolean
          } =>
            node?.type === 'zone' &&
            node.visible !== false &&
            Array.isArray((node as { polygon?: Array<[number, number]> }).polygon) &&
            ((node as { polygon?: Array<[number, number]> }).polygon?.length ?? 0) >= 3,
        )
        .map((zone) => {
          const centroid = getPolygonCentroid(zone.polygon)
          if (!centroid) {
            return null
          }

          const zoneLevelId = toLevelNodeId(zone.parentId)
          const withDoorCellIndex = findClosestNavigationCell(
            graph,
            [centroid[0], 0, centroid[1]],
            zoneLevelId ?? undefined,
            null,
          )
          const withoutDoorCellIndex = graphWithoutDoors
            ? findClosestNavigationCell(
                graphWithoutDoors,
                [centroid[0], 0, centroid[1]],
                zoneLevelId ?? undefined,
                null,
              )
            : null

          return {
            centroid,
            id: zone.id,
            levelId: zoneLevelId,
            name: zone.name ?? zone.id,
            withDoorCellIndex,
            withDoorComponentId:
              withDoorCellIndex !== null
                ? (graph.componentIdByCell[withDoorCellIndex] ?? null)
                : null,
            withoutDoorCellIndex,
            withoutDoorComponentId:
              withoutDoorCellIndex !== null && graphWithoutDoors
                ? (graphWithoutDoors.componentIdByCell[withoutDoorCellIndex] ?? null)
                : null,
          }
        })
        .filter(
          (
            zone,
          ): zone is {
            centroid: [number, number]
            id: string
            levelId: LevelNode['id'] | null
            name: string
            withDoorCellIndex: number | null
            withDoorComponentId: number | null
            withoutDoorCellIndex: number | null
            withoutDoorComponentId: number | null
          } => Boolean(zone),
        )

      const suggestedRoomTarget =
        actorCellIndexWithDoors !== null
          ? (() => {
              const candidates = zones
                .filter((zone) => {
                  if (zone.withDoorCellIndex === null || zone.withoutDoorCellIndex === null) {
                    return false
                  }

                  if (zone.withDoorCellIndex === actorCellIndexWithDoors) {
                    return false
                  }

                  return (
                    zone.withDoorComponentId === actorComponentWithDoors &&
                    zone.withoutDoorComponentId !== actorComponentWithoutDoors
                  )
                })
                .map((zone) => {
                  if (zone.withDoorCellIndex === null) {
                    return null
                  }

                  const path = findNavigationPath(
                    graph,
                    actorCellIndexWithDoors,
                    zone.withDoorCellIndex,
                  )
                  if (!path) {
                    return null
                  }

                  const targetCell = graph.cells[zone.withDoorCellIndex]
                  if (!targetCell) {
                    return null
                  }

                  return {
                    fromCellIndex: actorCellIndexWithDoors,
                    fromLevelId: actorLevelId,
                    pathCost: path.cost,
                    pathNodeCount: path.indices.length,
                    separatedWithoutDoors: true as const,
                    targetCellIndex: zone.withDoorCellIndex,
                    targetComponentId: zone.withDoorComponentId,
                    targetLevelId: zone.levelId,
                    targetWorld: targetCell.center,
                    zoneId: zone.id,
                    zoneName: zone.name,
                  }
                })
                .filter(
                  (candidate): candidate is NonNullable<typeof candidate> => candidate !== null,
                )

              if (candidates.length === 0) {
                return null
              }

              candidates.sort((left, right) => left.pathCost - right.pathCost)
              return candidates[0] ?? null
            })()
          : null

      const suggestedCrossFloorTarget =
        actorCellIndexWithDoors !== null
          ? (() => {
              const candidates = zones
                .filter((zone) => {
                  if (zone.withDoorCellIndex === null) {
                    return false
                  }

                  return zone.levelId !== actorLevelId
                })
                .map((zone) => {
                  if (zone.withDoorCellIndex === null) {
                    return null
                  }

                  const path = findNavigationPath(
                    graph,
                    actorCellIndexWithDoors,
                    zone.withDoorCellIndex,
                  )
                  if (!path) {
                    return null
                  }

                  const targetCell = graph.cells[zone.withDoorCellIndex]
                  if (!targetCell) {
                    return null
                  }

                  return {
                    fromCellIndex: actorCellIndexWithDoors,
                    fromLevelId: actorLevelId,
                    pathCost: path.cost,
                    pathNodeCount: path.indices.length,
                    targetCellIndex: zone.withDoorCellIndex,
                    targetLevelId: zone.levelId,
                    targetWorld: targetCell.center,
                    zoneId: zone.id,
                    zoneName: zone.name,
                  }
                })
                .filter(
                  (candidate): candidate is NonNullable<typeof candidate> => candidate !== null,
                )

              if (candidates.length === 0) {
                return null
              }

              candidates.sort((left, right) => left.pathCost - right.pathCost)
              return candidates[0] ?? null
            })()
          : null

      const stairLevels = [...graph.cellsByLevel.entries()]
        .map(([levelId, cellIndices]) => {
          const stairCells = cellIndices
            .map((cellIndex) => graph.cells[cellIndex])
            .filter((cell): cell is NonNullable<typeof cell> => Boolean(cell))
            .filter((cell) => cell.surfaceType === 'stair')

          if (stairCells.length === 0) {
            return null
          }

          const highestCell = [...stairCells].sort(
            (left, right) => right.center[1] - left.center[1],
          )[0]
          const lowestCell = [...stairCells].sort(
            (left, right) => left.center[1] - right.center[1],
          )[0]

          return {
            componentIds: [
              ...new Set(stairCells.map((cell) => graph.componentIdByCell[cell.cellIndex])),
            ],
            count: stairCells.length,
            highestWorld: highestCell?.center ?? null,
            levelId,
            maxY: Math.max(...stairCells.map((cell) => cell.center[1])),
            minY: Math.min(...stairCells.map((cell) => cell.center[1])),
            lowestWorld: lowestCell?.center ?? null,
          }
        })
        .filter((level): level is NonNullable<typeof level> => Boolean(level))

      return {
        actorCellIndexWithDoors,
        actorCellIndexWithoutDoors,
        actorComponentWithDoors,
        actorComponentWithoutDoors,
        actorLevelId,
        doorBridgeEdgeCount: graph.doorBridgeEdgeCount,
        graphComponentCountWithDoors: graph.components.length,
        graphComponentCountWithoutDoors: graphWithoutDoors?.components.length ?? null,
        stairLevels,
        stairSurfaceCount: graph.stairSurfaceCount,
        stairTransitionEdgeCount: graph.stairTransitionEdgeCount,
        suggestedCrossFloorTarget,
        suggestedRoomTarget,
        zoneCount: zones.length,
        zones,
      }
    }

    const getState = () => {
      const navigationState = useNavigation.getState()
      const navigationVisualState = navigationVisualsStore.getState()
      const viewerState = useViewer.getState()
      const actorRobotDebugState = actorRobotDebugStateRef.current
      const shadowController = shadowControllerRef.current
      const pascalTruckIntro = pascalTruckIntroRef.current
      const pascalTruckIntroRevealProgress = pascalTruckIntro
        ? MathUtils.clamp(
            pascalTruckIntro.revealElapsedMs / PASCAL_TRUCK_ENTRY_REVEAL_DURATION_MS,
            0,
            1,
          )
        : 0
      const pascalTruckIntroAnimationProgress = pascalTruckIntro
        ? MathUtils.clamp(
            pascalTruckIntro.animationElapsedMs / (PASCAL_TRUCK_ENTRY_CLIP_DURATION_SECONDS * 1000),
            0,
            1,
          )
        : 0
      const pascalTruckIntroPositionBlend = pascalTruckIntro
        ? Math.min(
            1,
            (1 - (1 - pascalTruckIntroRevealProgress) * (1 - pascalTruckIntroRevealProgress)) *
              PASCAL_TRUCK_ENTRY_REVEAL_TRAVEL_RATIO +
              smoothstep01(
                MathUtils.clamp(
                  pascalTruckIntroAnimationProgress / PASCAL_TRUCK_ENTRY_TRAVEL_END_PROGRESS,
                  0,
                  1,
                ),
              ) *
                (1 - PASCAL_TRUCK_ENTRY_REVEAL_TRAVEL_RATIO),
          )
        : 0

      return {
        actorCellIndex,
        actorComponentId,
        actorAvailable: navigationState.actorAvailable,
        actorRotationY: actorGroupRef.current?.rotation.y ?? 0,
        blockedDoorIds: doorCollisionStateRef.current.doorIds,
        blockedObstacleIds:
          primaryMotionCurve === candidatePathCurve
            ? candidatePathCollisionAudit.blockedObstacleIds
            : conservativePathCollisionAudit.blockedObstacleIds,
        blockedWallIds:
          primaryMotionCurve === candidatePathCurve
            ? candidatePathCollisionAudit.blockedWallIds
            : conservativePathCollisionAudit.blockedWallIds,
        doorCollisionBlocked: doorCollisionStateRef.current.blocked,
        actorMoving,
        pathDistanceTravelled: trajectoryDebugDistanceRef.current ?? motionRef.current.distance,
        actorVisible,
        actorVisualWorldPosition: getResolvedActorVisualWorldPosition(),
        actorWorldPosition: getActorWorldPosition(),
        enabled: navigationState.enabled,
        itemDeleteRequestId: navigationState.itemDeleteRequest?.itemId ?? null,
        itemMovePreviewPlanCacheSize: itemMovePreviewPlanCacheRef.current.size,
        itemMovePreviewPlanWarmPending: itemMovePreviewPlanWarmTimeoutRef.current !== null,
        itemMoveRequestId: navigationState.itemMoveRequest?.itemId ?? null,
        itemRepairRequestId: navigationState.itemRepairRequest?.itemId ?? null,
        introAnimationDebugActive,
        levelId: selection.levelId,
        navigationActorRenderVisible:
          actorRenderVisibleOverrideRef.current === null
            ? actorVisible
            : actorVisible && actorRenderVisibleOverrideRef.current,
        navigationActorRenderVisibleOverride: actorRenderVisibleOverrideRef.current,
        navigationGraphCacheSize: graphCacheRef.current.size,
        navigationGraphReady: Boolean(prewarmedGraph),
        navigationRobotToolAttachmentsVisible:
          robotToolAttachmentsVisibleOverrideRef.current ?? true,
        navigationRobotSkinnedMeshesVisible: robotSkinnedMeshVisibleOverrideRef.current ?? true,
        navigationRobotSkinnedMeshesVisibleOverride: robotSkinnedMeshVisibleOverrideRef.current,
        navigationRobotStaticMeshesVisible: robotStaticMeshVisibleOverrideRef.current ?? true,
        navigationRobotStaticMeshesVisibleOverride: robotStaticMeshVisibleOverrideRef.current,
        navigationRobotToolAttachmentsVisibleOverride:
          robotToolAttachmentsVisibleOverrideRef.current,
        navigationRobotMaterialDebugModeOverride:
          robotMaterialDebugModeOverrideRef.current ?? 'auto',
        navigationRobotRevealMaterialsActive:
          actorRobotDebugState && typeof actorRobotDebugState.revealMaterialsActive === 'boolean'
            ? actorRobotDebugState.revealMaterialsActive
            : null,
        navigationRobotToolRevealMaterialsActive:
          actorRobotDebugState &&
          typeof actorRobotDebugState.toolRevealMaterialsActive === 'boolean'
            ? actorRobotDebugState.toolRevealMaterialsActive
            : null,
        navigationSceneSnapshotKey: navigationSceneSnapshot?.key ?? null,
        navigationShadowAutoUpdate: shadowController.currentAutoUpdate,
        navigationShadowDynamicSettleFrames: shadowController.dynamicSettleFrames,
        navigationShadowLastDynamicUpdateAtMs: shadowController.lastDynamicUpdateAtMs,
        navigationShadowMapEnabled: shadowController.currentEnabled,
        navigationShadowMapOverrideEnabled: shadowMapOverrideEnabledRef.current,
        navigationPostWarmupCompletedToken:
          navigationVisualState.navigationPostWarmupCompletedToken,
        navigationPostWarmupPending:
          navigationVisualState.navigationPostWarmupRequestToken >
          navigationVisualState.navigationPostWarmupCompletedToken,
        navigationPostWarmupRequestToken: navigationVisualState.navigationPostWarmupRequestToken,
        runtimePostProcessing: viewerState.runtimePostProcessing,
        pascalTruckVisible:
          navigationVisualState.nodeVisibilityOverrides[PASCAL_TRUCK_ITEM_NODE_ID] !== false,
        toolConeOverlayEnabled: navigationVisualState.toolConeOverlayEnabled,
        pascalTruckIntroActive: Boolean(pascalTruckIntro),
        pascalTruckIntroAnimationProgress,
        pascalTruckIntroCompleted,
        pascalTruckIntroPositionBlend,
        pascalTruckIntroRevealProgress,
        pascalTruckIntroTaskReady,
        pascalTruckExitActive,
        motionWriteSource: motionWriteSourceRef.current,
        pathCellCount: pathIndices.length,
        pathCollisionSampleCount:
          primaryMotionCurve === candidatePathCurve
            ? candidatePathCollisionAudit.blockedSampleCount
            : conservativePathCollisionAudit.blockedSampleCount,
        pathLength,
        pendingPascalTruckExitActive: pendingPascalTruckExitRef.current !== null,
        pendingTaskRequestActive:
          navigationState.itemMoveRequest !== null ||
          navigationState.itemDeleteRequest !== null ||
          navigationState.itemRepairRequest !== null,
        debugPascalTruckIntroAttemptCount: debugPascalTruckIntroAttemptCountRef.current,
        debugPascalTruckIntroStartCount: debugPascalTruckIntroStartCountRef.current,
        queueRestartToken: navigationState.queueRestartToken,
        robotMaterialWarmupReady: actorRobotWarmupReady,
        robotMode: navigationState.robotMode,
        runtimeActive: navigationRuntimeActive,
        truckIntroPlanReady: pascalTruckIntroPlan !== null,
        taskQueueLength: navigationState.taskQueue.length,
        toolConeOverlayWarmupReady: navigationVisualState.toolConeOverlayWarmupReady,
        pathUsingConservativeCurve:
          Boolean(
            primaryMotionCurve &&
              conservativePathCurve &&
              primaryMotionCurve === conservativePathCurve,
          ) && primaryMotionCurve !== candidatePathCurve,
        trajectoryCurrentRunBlend: motionRef.current.locomotion.runBlend,
        trajectoryCurrentSectionKind: motionRef.current.locomotion.sectionKind,
        trajectoryLowCurvatureSectionCount:
          trajectoryMotionProfile?.sections.filter((section) => section.kind === 'low').length ?? 0,
        trajectoryHighCurvatureSectionCount:
          trajectoryMotionProfile?.sections.filter((section) => section.kind === 'high').length ??
          0,
        trajectoryDebugMode: trajectoryDebugModeRef.current,
        trajectoryRenderReady: Boolean(trajectoryRibbonGeometry),
        trajectoryRenderType: trajectoryRibbonGeometry ? 'ribbon' : null,
      }
    }

    const getDoorTangentDiagnostics = () => {
      const debugPathCurve = debugPathCurveRef.current
      const debugDoorTransitions = debugDoorTransitionsRef.current
      if (!debugPathCurve || debugDoorTransitions.length === 0) {
        return []
      }

      const tangentSampleCount = Math.max(96, Math.ceil(pathLength / 0.08))
      const tangent = new Vector3()

      return debugDoorTransitions.map((transition) => {
        const approachPoint = new Vector3(...transition.approachWorld)
        const entryPoint = new Vector3(...transition.entryWorld)
        const exitPoint = new Vector3(...transition.exitWorld)
        const departurePoint = new Vector3(...transition.departureWorld)

        const approachAxis = entryPoint.clone().sub(approachPoint).normalize()
        const departureAxis = departurePoint.clone().sub(exitPoint).normalize()
        const approachT = findClosestCurveProgress(
          debugPathCurve,
          approachPoint,
          tangentSampleCount,
        )
        const departureT = findClosestCurveProgress(
          debugPathCurve,
          departurePoint,
          tangentSampleCount,
        )

        debugPathCurve.getTangentAt(approachT, tangent)
        const approachDot = Math.abs(tangent.normalize().dot(approachAxis))
        debugPathCurve.getTangentAt(departureT, tangent)
        const departureDot = Math.abs(tangent.normalize().dot(departureAxis))

        return {
          approachDot,
          approachT,
          departureDot,
          departureT,
          openingId: transition.openingId,
          progress: transition.progress,
        }
      })
    }

    const getRenderBreakdown = () => {
      const rootSummaries = [
        ...Array.from(sceneRegistry.byType.item, (nodeId) => ({ nodeId, type: 'item' as const })),
        ...Array.from(sceneRegistry.byType.door, (nodeId) => ({ nodeId, type: 'door' as const })),
        ...Array.from(sceneRegistry.byType.wall, (nodeId) => ({ nodeId, type: 'wall' as const })),
        ...Array.from(sceneRegistry.byType.window, (nodeId) => ({
          nodeId,
          type: 'window' as const,
        })),
        ...Array.from(sceneRegistry.byType.slab, (nodeId) => ({ nodeId, type: 'slab' as const })),
        ...Array.from(sceneRegistry.byType.ceiling, (nodeId) => ({
          nodeId,
          type: 'ceiling' as const,
        })),
        ...Array.from(sceneRegistry.byType.roof, (nodeId) => ({ nodeId, type: 'roof' as const })),
      ]
        .map(({ nodeId, type }) => {
          const object = sceneRegistry.nodes.get(nodeId)
          if (!object) {
            return null
          }

          let meshCount = 0
          let skinnedMeshCount = 0
          let triangleCount = 0
          const materialIds = new Set<string>()

          object.traverse((child) => {
            const mesh = child as Mesh
            if (!mesh.isMesh || !mesh.visible) {
              return
            }

            meshCount += 1
            if ((mesh as Mesh & { isSkinnedMesh?: boolean }).isSkinnedMesh) {
              skinnedMeshCount += 1
            }

            if (Array.isArray(mesh.material)) {
              for (const material of mesh.material) {
                materialIds.add(material.uuid)
              }
            } else if (mesh.material) {
              materialIds.add(mesh.material.uuid)
            }

            const positionAttribute = mesh.geometry.getAttribute('position')
            if (positionAttribute) {
              triangleCount += Math.floor(positionAttribute.count / 3)
            }
          })

          return {
            materialCount: materialIds.size,
            meshCount,
            name:
              sceneState.nodes[nodeId]?.type === 'item'
                ? ((sceneState.nodes[nodeId] as ItemNode).name ??
                  (sceneState.nodes[nodeId] as ItemNode).asset.name)
                : (sceneState.nodes[nodeId]?.type ?? type),
            nodeId,
            skinnedMeshCount,
            triangleCount,
            type,
          }
        })
        .filter((summary): summary is NonNullable<typeof summary> => Boolean(summary))

      return rootSummaries.sort((left, right) => {
        if (right.meshCount !== left.meshCount) {
          return right.meshCount - left.meshCount
        }

        return right.triangleCount - left.triangleCount
      })
    }

    const getNodeRenderTree = (nodeId: string) => {
      const root = sceneRegistry.nodes.get(nodeId)
      if (!root) {
        return null
      }

      const describe = (object: Object3D): Record<string, unknown> => {
        const mesh = object as Mesh
        return {
          children: object.children.map((child) => describe(child)),
          material:
            mesh.isMesh && mesh.material
              ? Array.isArray(mesh.material)
                ? mesh.material.map((material) => material.name || material.type)
                : mesh.material.name || mesh.material.type
              : null,
          mesh: Boolean(mesh.isMesh),
          name: object.name || object.type,
          type: object.type,
          visible: object.visible,
        }
      }

      return describe(root)
    }

    const getTrajectorySamples = (sampleCount = 7) => {
      if (!pathCurve || pathLength <= Number.EPSILON) {
        return []
      }

      const clampedCount = Math.max(2, Math.floor(sampleCount))
      const samplePoint = new Vector3()
      return Array.from({ length: clampedCount }, (_, index) => {
        const sampleT = clampedCount <= 1 ? 0 : index / (clampedCount - 1)
        pathCurve.getPointAt(sampleT, samplePoint)
        return [samplePoint.x, samplePoint.y + PATH_CURVE_OFFSET_Y, samplePoint.z] as [
          number,
          number,
          number,
        ]
      })
    }

    const getItemMoveState = () => {
      const navigationState = useNavigation.getState()
      const editorState = useEditor.getState()
      const itemMoveSequence = itemMoveSequenceRef.current
      const actorRobotDebugState = actorRobotDebugStateRef.current
      const previewSelectedIds = [...useViewer.getState().previewSelectedIds]
      const liveSceneNodes = useScene.getState().nodes as Record<string, any>
      const movingNodeId =
        editorState.movingNode?.id ??
        Object.keys(navigationState.itemMoveControllers)[0] ??
        itemMoveSequence?.request.itemId ??
        null
      const movingNode = movingNodeId ? liveSceneNodes[movingNodeId] : null
      const transientPreviewGhostId =
        Object.values(liveSceneNodes).find((node) => {
          if (node?.type !== 'item' || node.id === movingNodeId) {
            return false
          }

          const metadata =
            typeof node.metadata === 'object' &&
            node.metadata !== null &&
            !Array.isArray(node.metadata)
              ? (node.metadata as Record<string, unknown>)
              : null
          return metadata?.isTransient === true
        })?.id ?? null
      const previewGhostId = previewSelectedIds[0] ?? transientPreviewGhostId
      const previewGhostNode = previewGhostId ? liveSceneNodes[previewGhostId] : null
      const itemMoveFrameTrace = [...itemMoveFrameTraceRef.current]

      return {
        itemMoveControllerId: Object.keys(navigationState.itemMoveControllers)[0] ?? null,
        itemMoveFrameTrace,
        itemMoveFrameTraceSummary: {
          ghostBaselineWorldPosition: itemMoveTraceGhostBaselineRef.current,
          ghostMinWorldY: itemMoveFrameTrace.reduce<number | null>(
            (minimum, sample) =>
              sample.ghostWorldPosition
                ? minimum === null
                  ? sample.ghostWorldPosition[1]
                  : Math.min(minimum, sample.ghostWorldPosition[1])
                : minimum,
            null,
          ),
          sourceBaselineWorldPosition: itemMoveTraceSourceBaselineRef.current,
          sourceMinWorldY: itemMoveFrameTrace.reduce<number | null>(
            (minimum, sample) =>
              sample.sourceWorldPosition
                ? minimum === null
                  ? sample.sourceWorldPosition[1]
                  : Math.min(minimum, sample.sourceWorldPosition[1])
                : minimum,
            null,
          ),
        },
        itemMoveLocked: navigationState.itemMoveLocked,
        itemMoveRequestId: navigationState.itemMoveRequest?.itemId ?? null,
        itemMoveSequenceStage: itemMoveSequence?.stage ?? null,
        itemMoveStageHistory: [...itemMoveStageHistoryRef.current],
        moveItemsEnabled: navigationState.moveItemsEnabled,
        robotMode: navigationState.robotMode,
        taskQueue: navigationState.taskQueue.map((task) => ({
          itemId: task.request.itemId,
          kind: task.kind,
          taskId: task.taskId,
        })),
        movingNodeId,
        movingNodeLiveTransform: movingNodeId
          ? (useLiveTransforms.getState().get(movingNodeId) ?? null)
          : null,
        movingNodePosition:
          editorState.movingNode && 'position' in editorState.movingNode
            ? editorState.movingNode.position
            : null,
        movingNodeVisualState: movingNodeId
          ? (navigationVisualsStore.getState().itemMoveVisualStates[movingNodeId] ??
            (movingNode?.type === 'item' ? getItemMoveVisualState(movingNode.metadata) : null))
          : null,
        toolCone:
          typeof actorRobotDebugState?.toolCone === 'object' &&
          actorRobotDebugState.toolCone !== null
            ? actorRobotDebugState.toolCone
            : null,
        toolConeIsolatedOverlay: navigationVisualsStore.getState().toolConeIsolatedOverlay,
        previewGhostId,
        previewGhostVisualState: previewGhostId
          ? (navigationVisualsStore.getState().itemMoveVisualStates[previewGhostId] ??
            (previewGhostNode?.type === 'item'
              ? getItemMoveVisualState(previewGhostNode.metadata)
              : null))
          : null,
        previewGhostVisible:
          previewGhostId !== null
            ? (navigationVisualsStore.getState().nodeVisibilityOverrides[previewGhostId] ??
              previewGhostNode?.visible ??
              null)
            : null,
        previewSelectedIds,
      }
    }

    const getPathDiagnostics = () => {
      if (!pathGraph) {
        return null
      }

      const actorWorldPosition = getResolvedActorWorldPosition()
      const actorVisualWorldPosition = getResolvedActorVisualWorldPosition()
      const actorNavigationPoint = actorWorldPosition
        ? ([
            actorWorldPosition[0],
            actorWorldPosition[1] - ACTOR_HOVER_Y,
            actorWorldPosition[2],
          ] as [number, number, number])
        : null
      const nearestLiveGraphCellIndex =
        actorNavigationPoint && graph
          ? findClosestNavigationCell(
              graph,
              actorNavigationPoint,
              selection.levelId ?? undefined,
              null,
            )
          : null

      return {
        actorCellCenter:
          actorCellIndex !== null && graph ? (graph.cells[actorCellIndex]?.center ?? null) : null,
        actorCellIndex,
        actorComponentId,
        actorNavigationPoint,
        actorVisualWorldPosition,
        actorWorldPosition,
        candidateCurveLength: candidatePathCurve?.getLength() ?? null,
        conservativeCurveLength: conservativePathCurve?.getLength() ?? null,
        lastCommittedPath: lastCommittedPathDebugRef.current,
        lastItemMovePlan: lastItemMovePlanDebugRef.current,
        nearestLiveGraphCellCenter:
          nearestLiveGraphCellIndex !== null && graph
            ? (graph.cells[nearestLiveGraphCellIndex]?.center ?? null)
            : null,
        nearestLiveGraphCellIndex,
        doorTransitions: doorTransitions.map((transition) => ({
          approachWorld: transition.approachWorld,
          departureWorld: transition.departureWorld,
          doorIds: [...transition.doorIds],
          entryWorld: transition.entryWorld,
          exitWorld: transition.exitWorld,
          fromCellCenter: pathGraph.cells[transition.fromCellIndex]?.center ?? null,
          fromCellIndex: transition.fromCellIndex,
          fromPathIndex: transition.fromPathIndex,
          openingId: transition.openingId,
          pathPosition: transition.pathPosition,
          progress: transition.progress,
          toCellCenter: pathGraph.cells[transition.toCellIndex]?.center ?? null,
          toCellIndex: transition.toCellIndex,
          toPathIndex: transition.toPathIndex,
          world: transition.world,
        })),
        pathAnchorWorldPosition,
        pathCellCenters: pathIndices.map((cellIndex) => pathGraph.cells[cellIndex]?.center ?? null),
        pathGraphCellCount: pathGraph.cells.length,
        pathGraphIsOverride: pathGraph !== graph,
        pathIndices: [...pathIndices],
        pathLength,
        pathTargetWorldPosition,
        pathUsingConservativeCurve:
          Boolean(
            primaryMotionCurve &&
              conservativePathCurve &&
              primaryMotionCurve === conservativePathCurve,
          ) && primaryMotionCurve !== candidatePathCurve,
        rawPathPoints: rawPathPoints.map((point) => [...point] as [number, number, number]),
        simplifiedPathCellCenters: simplifiedPathIndices.map(
          (cellIndex) => pathGraph.cells[cellIndex]?.center ?? null,
        ),
        simplifiedPathIndices: [...simplifiedPathIndices],
        smoothedPathPoints: smoothedPathPoints.map(
          (point) => [point.x, point.y, point.z] as [number, number, number],
        ),
        rootMotionOffset: [...motionRef.current.rootMotionOffset] as [number, number, number],
      }
    }

    const getCurrentMovePlanDiagnostics = () => {
      if (!(graph && itemMoveRequest)) {
        return null
      }

      const { actorNavigationPoint, actorStartCellIndex, actorStartComponentId } =
        getActorNavigationPlanningState(
          graph,
          selection.levelId ?? toLevelNodeId(itemMoveRequest.levelId) ?? null,
        )

      if (actorStartCellIndex === null) {
        return {
          actorNavigationPoint,
          actorStartCellIndex: null,
          itemId: itemMoveRequest.itemId,
          reason: 'missing-actor-start-cell',
        }
      }

      const previousPlanDebug = lastItemMovePlanDebugRef.current
      const resolvedPlan = resolveItemMovePlan(
        itemMoveRequest,
        actorStartCellIndex,
        actorNavigationPoint,
        actorStartComponentId,
        {
          recordFallbackMeta: false,
          targetGraphPerfMetricName: 'navigation.debugCurrentMovePlanTargetGraphBuildMs',
        },
      )
      const recomputedPlanDebug = lastItemMovePlanDebugRef.current
      lastItemMovePlanDebugRef.current = previousPlanDebug

      return {
        actorComponentId: actorStartComponentId,
        actorCommittedComponentId: actorComponentId,
        actorNavigationPoint,
        actorStartCellCenter: graph.cells[actorStartCellIndex]?.center ?? null,
        actorStartCellIndex,
        liveGraphCacheKey: prewarmedGraphStateKey,
        liveGraphCurrent: navigationGraphCurrent,
        itemId: itemMoveRequest.itemId,
        navigationSceneSnapshotKey: navigationSceneSnapshot?.key ?? null,
        request: itemMoveRequest,
        resolved: Boolean(resolvedPlan),
        resolvedPlan: recomputedPlanDebug,
      }
    }

    const canMoveItemToWorld = (itemId: string, world: [number, number, number]) => {
      const candidate = sceneState.nodes[itemId]
      if (!(candidate && candidate.type === 'item')) {
        return null
      }

      const item = candidate as ItemNode
      if (
        !isDebugMovableItem(
          item,
          sceneState.nodes as Record<string, ItemNode | LevelNode | { type?: string }>,
        )
      ) {
        return {
          itemId,
          reason: 'not-movable',
          valid: false,
          world,
        }
      }

      const levelId = resolveLevelId(item, sceneState.nodes)
      if (!levelId) {
        return {
          itemId,
          reason: 'missing-level',
          valid: false,
          world,
        }
      }

      const itemDimensions = getScaledDimensions(item)
      const finalPosition: [number, number, number] = [
        snapDebugMoveAxis(world[0], itemDimensions[0]),
        item.position[1],
        snapDebugMoveAxis(world[2], itemDimensions[2]),
      ]
      const finalRotation = [...item.rotation] as [number, number, number]
      const placement = spatialGridManager.canPlaceOnFloor(
        levelId,
        finalPosition,
        itemDimensions,
        finalRotation,
        [item.id],
      )

      return {
        finalPosition,
        finalRotation,
        itemId,
        valid: placement.valid,
        world,
      }
    }

    const getToolConeDiagnostics = () => {
      const actorRobotDebugState = actorRobotDebugStateRef.current
      const toolCone =
        typeof actorRobotDebugState?.toolCone === 'object' && actorRobotDebugState.toolCone !== null
          ? (actorRobotDebugState.toolCone as Record<string, unknown>)
          : null
      if (!toolCone) {
        return null
      }

      const targetItemId = typeof toolCone.targetItemId === 'string' ? toolCone.targetItemId : null
      const targetObject = targetItemId ? (sceneRegistry.nodes.get(targetItemId) ?? null) : null
      const rect = gl.domElement.getBoundingClientRect()
      const projectedScratch = new Vector3()
      const projectedVisiblePoints: Vector2[] = []
      const positionScratch = new Vector3()
      const cameraWorldPosition = new Vector3()
      camera.getWorldPosition(cameraWorldPosition)
      const projectWorldPoint = (world: [number, number, number]) => {
        projectedScratch.set(world[0], world[1], world[2]).project(camera)
        if (
          !Number.isFinite(projectedScratch.x) ||
          !Number.isFinite(projectedScratch.y) ||
          !Number.isFinite(projectedScratch.z)
        ) {
          return null
        }

        return {
          client: new Vector2(
            (projectedScratch.x + 1) * 0.5 * rect.width,
            (1 - projectedScratch.y) * 0.5 * rect.height,
          ),
          visible:
            projectedScratch.z >= -1 &&
            projectedScratch.z <= 1 &&
            projectedScratch.x >= -1 &&
            projectedScratch.x <= 1 &&
            projectedScratch.y >= -1 &&
            projectedScratch.y <= 1,
        }
      }

      if (targetObject) {
        targetObject.updateWorldMatrix(true, true)
        targetObject.traverse((child) => {
          const mesh = child as Mesh
          if (
            !mesh.isMesh ||
            !mesh.geometry ||
            mesh.userData?.pascalExcludeFromToolConeTarget === true ||
            !isObjectVisibleInHierarchy(mesh)
          ) {
            return
          }

          const positionAttribute = mesh.geometry.getAttribute('position')
          if (!positionAttribute) {
            return
          }

          for (let index = 0; index < positionAttribute.count; index += 1) {
            positionScratch.fromBufferAttribute(positionAttribute, index)
            mesh.localToWorld(positionScratch)
            const projectedPoint = projectWorldPoint([
              positionScratch.x,
              positionScratch.y,
              positionScratch.z,
            ])
            if (!projectedPoint) {
              continue
            }
            projectedVisiblePoints.push(projectedPoint.client)
          }
        })
      }

      const targetProjectedHull = computeProjectedHull2D(projectedVisiblePoints)
      const hullPoints = Array.isArray(toolCone.hullPoints) ? toolCone.hullPoints : []
      const hullDiagnostics = (
        hullPoints.map((entry) => {
          if (!(typeof entry === 'object' && entry !== null)) {
            return null
          }

          const hullPoint = entry as Record<string, unknown>
          const worldPoint = isVector3Tuple(hullPoint.worldPoint) ? hullPoint.worldPoint : null
          const renderedWorldPoint = isVector3Tuple(hullPoint.renderedWorldPoint)
            ? hullPoint.renderedWorldPoint
            : null
          if (!worldPoint) {
            return null
          }

          const projectedWorldPoint = projectWorldPoint(worldPoint)
          const projectedRenderedPoint = renderedWorldPoint
            ? projectWorldPoint(renderedWorldPoint)
            : null
          const surfaceHit = hullPoint.isApex
            ? null
            : getToolConeTargetSurfaceHit(targetObject, worldPoint, cameraWorldPosition)
          let silhouetteDistancePx: number | null = null
          let silhouetteRelation: 'boundary' | 'inside' | 'outside' | 'unknown' = 'unknown'

          if (projectedWorldPoint && targetProjectedHull.length >= 2) {
            silhouetteDistancePx = targetProjectedHull.reduce<number>(
              (minimumDistance, point, index) => {
                const nextPoint = targetProjectedHull[(index + 1) % targetProjectedHull.length]
                if (!nextPoint) {
                  return minimumDistance
                }
                return Math.min(
                  minimumDistance,
                  getDistanceToSegment2D(projectedWorldPoint.client, point, nextPoint),
                )
              },
              Number.POSITIVE_INFINITY,
            )

            if (Number.isFinite(silhouetteDistancePx)) {
              if (silhouetteDistancePx <= 1) {
                silhouetteRelation = 'boundary'
              } else {
                silhouetteRelation = isPointInsidePolygon2D(
                  projectedWorldPoint.client,
                  targetProjectedHull,
                )
                  ? 'inside'
                  : 'outside'
              }
            } else {
              silhouetteDistancePx = null
            }
          }

          const cameraSurfaceRelation =
            surfaceHit?.relation === 'no-hit' &&
            projectedWorldPoint?.visible &&
            typeof silhouetteDistancePx === 'number' &&
            silhouetteDistancePx <= 1
              ? ('grazing' as const)
              : (surfaceHit?.relation ?? (hullPoint.isApex ? 'apex' : 'no-hit'))

          return {
            ...hullPoint,
            cameraSurfaceDistanceDelta: surfaceHit?.surfaceDistanceDelta ?? null,
            cameraSurfaceMeshName: surfaceHit?.surfaceMeshName ?? null,
            cameraSurfacePoint: surfaceHit?.surfacePoint ?? null,
            cameraSurfaceRelation,
            projectedVisible: projectedWorldPoint?.visible ?? false,
            screenAlignmentErrorPx:
              projectedWorldPoint && projectedRenderedPoint
                ? projectedWorldPoint.client.distanceTo(projectedRenderedPoint.client)
                : null,
            silhouetteDistancePx,
            silhouetteRelation,
          }
        }) as Array<
          | null
          | (Record<string, unknown> & {
              cameraSurfaceDistanceDelta: number | null
              cameraSurfaceMeshName: string | null
              cameraSurfacePoint: [number, number, number] | null
              cameraSurfaceRelation: 'apex' | 'grazing' | 'no-hit' | 'occluded' | 'visible'
              projectedVisible: boolean
              screenAlignmentErrorPx: number | null
              silhouetteDistancePx: number | null
              silhouetteRelation: 'boundary' | 'inside' | 'outside' | 'unknown'
              worldAlignmentError?: number
            })
        >
      ).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))

      const interiorPoints = hullDiagnostics.filter(
        (entry) =>
          entry.silhouetteRelation === 'inside' &&
          typeof entry.silhouetteDistancePx === 'number' &&
          entry.silhouetteDistancePx > 1,
      )
      const occludedSurfacePoints = hullDiagnostics.filter(
        (entry) => entry.cameraSurfaceRelation === 'occluded',
      )
      const grazingSurfacePoints = hullDiagnostics.filter(
        (entry) => entry.cameraSurfaceRelation === 'grazing',
      )
      const missingSurfacePoints = hullDiagnostics.filter(
        (entry) => entry.cameraSurfaceRelation === 'no-hit',
      )

      return {
        ...toolCone,
        hullPoints: hullDiagnostics,
        maxCameraSurfaceDistanceDelta: hullDiagnostics.reduce(
          (maximum, entry) =>
            Math.max(
              maximum,
              typeof entry.cameraSurfaceDistanceDelta === 'number'
                ? entry.cameraSurfaceDistanceDelta
                : 0,
            ),
          0,
        ),
        interiorPointCount: interiorPoints.length,
        maxInteriorDistancePx: interiorPoints.reduce(
          (maximum, entry) =>
            Math.max(
              maximum,
              typeof entry.silhouetteDistancePx === 'number' ? entry.silhouetteDistancePx : 0,
            ),
          0,
        ),
        missingSurfacePointCount: missingSurfacePoints.length,
        occludedSurfacePointCount: occludedSurfacePoints.length,
        grazingSurfacePointCount: grazingSurfacePoints.length,
        maxScreenAlignmentErrorPx: hullDiagnostics.reduce(
          (maximum, entry) =>
            Math.max(
              maximum,
              typeof entry.screenAlignmentErrorPx === 'number' ? entry.screenAlignmentErrorPx : 0,
            ),
          0,
        ),
        maxWorldAlignmentError: hullDiagnostics.reduce(
          (maximum, entry) =>
            Math.max(
              maximum,
              typeof entry.worldAlignmentError === 'number' ? entry.worldAlignmentError : 0,
            ),
          0,
        ),
        targetItemId,
        targetObjectFound: Boolean(targetObject),
        targetProjectedHullVertexCount: targetProjectedHull.length,
      }
    }

    const getMovableItems = () =>
      Object.values(sceneState.nodes)
        .filter((node): node is ItemNode => node?.type === 'item')
        .filter((node) =>
          isDebugMovableItem(
            node,
            sceneState.nodes as Record<string, ItemNode | LevelNode | { type?: string }>,
          ),
        )
        .map((node) => ({
          id: node.id,
          levelId: resolveLevelId(node, sceneState.nodes),
          name: node.name ?? node.asset.name,
          position: [...node.position] as [number, number, number],
        }))

    const getRenderDiagnostics = () => {
      const summarizeObject = (object: Object3D | null | undefined) => {
        if (!object) {
          return {
            groupCount: 0,
            lineCount: 0,
            materialCount: 0,
            meshCount: 0,
            objectCount: 0,
            triangleCount: 0,
          }
        }

        let groupCount = 0
        let lineCount = 0
        let materialCount = 0
        let meshCount = 0
        let objectCount = 0
        let triangleCount = 0

        object.traverse((child) => {
          objectCount += 1
          if ((child as Group).isGroup) {
            groupCount += 1
          }
          const childAsMesh = child as Object3D & {
            geometry?: BufferGeometry
            isLine?: boolean
            isLineLoop?: boolean
            isLineSegments?: boolean
            isMesh?: boolean
            material?: Material | Material[]
          }
          if (childAsMesh.isMesh) {
            meshCount += 1
            materialCount += Array.isArray(childAsMesh.material) ? childAsMesh.material.length : 1
            const positionAttribute = childAsMesh.geometry?.getAttribute('position')
            const indexCount = childAsMesh.geometry?.index?.count ?? 0
            if (indexCount > 0) {
              triangleCount += indexCount / 3
            } else if (positionAttribute) {
              triangleCount += positionAttribute.count / 3
            }
          } else if (childAsMesh.isLine || childAsMesh.isLineLoop || childAsMesh.isLineSegments) {
            lineCount += 1
          }
        })

        return {
          groupCount,
          lineCount,
          materialCount,
          meshCount,
          objectCount,
          triangleCount,
        }
      }

      const items = Object.values(sceneState.nodes)
        .filter((node): node is ItemNode => node?.type === 'item')
        .map((node) => {
          const object = sceneRegistry.nodes.get(node.id)
          return {
            assetId: node.asset.id,
            assetSrc: node.asset.src,
            id: node.id,
            name: node.name ?? node.asset.name,
            ...summarizeObject(object),
          }
        })
        .sort(
          (left, right) =>
            right.meshCount - left.meshCount || right.triangleCount - left.triangleCount,
        )

      const assetSummary = new Map<
        string,
        {
          count: number
          meshCount: number
          triangleCount: number
        }
      >()

      for (const item of items) {
        const key = item.assetSrc || item.assetId
        const entry = assetSummary.get(key) ?? {
          count: 0,
          meshCount: 0,
          triangleCount: 0,
        }
        entry.count += 1
        entry.meshCount += item.meshCount
        entry.triangleCount += item.triangleCount
        assetSummary.set(key, entry)
      }

      return {
        assetSummary: [...assetSummary.entries()]
          .map(([assetKey, value]) => ({
            assetKey,
            averageMeshCount: value.count > 0 ? value.meshCount / value.count : 0,
            averageTriangleCount: value.count > 0 ? value.triangleCount / value.count : 0,
            count: value.count,
            totalMeshCount: value.meshCount,
            totalTriangleCount: value.triangleCount,
          }))
          .sort((left, right) => right.totalMeshCount - left.totalMeshCount)
          .slice(0, 20),
        itemCount: items.length,
        sceneByType: Object.fromEntries(
          Object.entries(sceneRegistry.byType).map(([type, ids]) => [type, ids.size]),
        ),
        topItems: items.slice(0, 20),
      }
    }

    const getViewportDiagnostics = () => {
      const rect = gl.domElement.getBoundingClientRect()
      return {
        cameraAspect:
          camera instanceof PerspectiveCamera
            ? camera.aspect
            : rect.height > 0
              ? rect.width / rect.height
              : null,
        canvasClientHeight: gl.domElement.clientHeight,
        canvasClientWidth: gl.domElement.clientWidth,
        canvasHeight: gl.domElement.height,
        canvasRect: {
          height: rect.height,
          left: rect.left,
          top: rect.top,
          width: rect.width,
        },
        canvasWidth: gl.domElement.width,
        devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : null,
        size: {
          height: canvasSize.height,
          left: canvasSize.left,
          top: canvasSize.top,
          width: canvasSize.width,
        },
      }
    }

    const projectNodeToClient = (nodeId: string) => {
      const nodeObject = sceneRegistry.nodes.get(nodeId)
      if (!nodeObject) {
        return null
      }

      const worldPosition = nodeObject.getWorldPosition(new Vector3())
      return projectWorldToClient([worldPosition.x, worldPosition.y, worldPosition.z])
    }

    const projectNodeBoundsToClient = (nodeId: string) => {
      const nodeObject = sceneRegistry.nodes.get(nodeId)
      if (!nodeObject) {
        return null
      }

      const bounds = new Box3().setFromObject(nodeObject)
      if (bounds.isEmpty()) {
        const projectedPoint = projectNodeToClient(nodeId)
        if (!projectedPoint) {
          return null
        }
        return {
          bottom: projectedPoint.y,
          centerX: projectedPoint.x,
          centerY: projectedPoint.y,
          height: 0,
          left: projectedPoint.x,
          right: projectedPoint.x,
          top: projectedPoint.y,
          visible: projectedPoint.visible,
          width: 0,
        }
      }

      const rect = gl.domElement.getBoundingClientRect()
      const corners = [
        new Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
        new Vector3(bounds.min.x, bounds.min.y, bounds.max.z),
        new Vector3(bounds.min.x, bounds.max.y, bounds.min.z),
        new Vector3(bounds.min.x, bounds.max.y, bounds.max.z),
        new Vector3(bounds.max.x, bounds.min.y, bounds.min.z),
        new Vector3(bounds.max.x, bounds.min.y, bounds.max.z),
        new Vector3(bounds.max.x, bounds.max.y, bounds.min.z),
        new Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
      ]

      let minX = Number.POSITIVE_INFINITY
      let minY = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY
      let maxY = Number.NEGATIVE_INFINITY
      let anyVisible = false

      for (const corner of corners) {
        const projected = corner.project(camera)
        if (
          Number.isFinite(projected.x) &&
          Number.isFinite(projected.y) &&
          Number.isFinite(projected.z)
        ) {
          const x = rect.left + ((projected.x + 1) / 2) * rect.width
          const y = rect.top + ((1 - projected.y) / 2) * rect.height
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x)
          maxY = Math.max(maxY, y)
          if (
            projected.z >= -1 &&
            projected.z <= 1 &&
            projected.x >= -1 &&
            projected.x <= 1 &&
            projected.y >= -1 &&
            projected.y <= 1
          ) {
            anyVisible = true
          }
        }
      }

      if (
        !Number.isFinite(minX) ||
        !Number.isFinite(minY) ||
        !Number.isFinite(maxX) ||
        !Number.isFinite(maxY)
      ) {
        return null
      }

      return {
        bottom: maxY,
        centerX: (minX + maxX) / 2,
        centerY: (minY + maxY) / 2,
        height: Math.max(0, maxY - minY),
        left: minX,
        right: maxX,
        top: minY,
        visible: anyVisible,
        width: Math.max(0, maxX - minX),
      }
    }

    const setNavigationEnabled = (value: boolean) => {
      recordNavigationPerfMark('navigation.debugSetEnabled', { enabled: value })
      useNavigation.getState().setEnabled(value)
    }

    const setMoveItemsEnabled = (value: boolean) => {
      recordNavigationPerfMark('navigation.debugSetMoveItemsEnabled', { enabled: value })
      useNavigation.getState().setMoveItemsEnabled(value)
    }

    const setRobotMode = (mode: NavigationRobotMode | null) => {
      recordNavigationPerfMark('navigation.debugSetRobotMode', { mode: mode ?? 'off' })
      useNavigation.getState().setRobotMode(mode)
    }

    const snapDebugMoveAxis = (position: number, dimension: number) => {
      const halfDimension = dimension / 2
      const needsOffset = Math.abs(((halfDimension * 2) % 1) - 0.5) < 0.01
      const offset = needsOffset ? 0.25 : 0
      return Math.round((position - offset) * 2) / 2 + offset
    }

    const startMoveItem = (itemId: string) => {
      const candidate = sceneState.nodes[itemId]
      if (!(candidate && candidate.type === 'item')) {
        return false
      }

      const item = candidate as ItemNode
      if (
        !isDebugMovableItem(
          item,
          sceneState.nodes as Record<string, ItemNode | LevelNode | { type?: string }>,
        )
      ) {
        return false
      }

      const levelId = resolveLevelId(item, sceneState.nodes)
      const selectionLevelId = toLevelNodeId(levelId) ?? useViewer.getState().selection.levelId
      useEditor.getState().setPhase('furnish')
      useEditor.getState().setMode('select')
      useEditor.getState().setTool(null)
      useEditor.getState().setMovingNode(item)
      recordNavigationPerfMark('navigation.debugStartMoveItem', { itemId: item.id })
      useViewer.getState().setSelection({
        levelId: selectionLevelId,
        selectedIds: [],
        zoneId: null,
      })
      return true
    }

    const requestMoveItemToWorld = (itemId: string, world: [number, number, number]) => {
      const candidate = sceneState.nodes[itemId]
      if (!(candidate && candidate.type === 'item')) {
        return false
      }

      const item = candidate as ItemNode
      if (
        !isDebugMovableItem(
          item,
          sceneState.nodes as Record<string, ItemNode | LevelNode | { type?: string }>,
        )
      ) {
        return false
      }

      const levelId = resolveLevelId(item, sceneState.nodes)
      if (!levelId) {
        return false
      }

      const itemDimensions = getScaledDimensions(item)
      const finalPosition: [number, number, number] = [
        snapDebugMoveAxis(world[0], itemDimensions[0]),
        item.position[1],
        snapDebugMoveAxis(world[2], itemDimensions[2]),
      ]
      const finalRotation = [...item.rotation] as [number, number, number]
      const placement = spatialGridManager.canPlaceOnFloor(
        levelId,
        finalPosition,
        itemDimensions,
        finalRotation,
        [item.id],
      )
      if (!placement.valid) {
        return false
      }

      if (!startMoveItem(itemId)) {
        return false
      }

      const request: NavigationItemMoveRequest = {
        finalUpdate: {
          position: finalPosition,
          rotation: finalRotation,
        },
        itemDimensions,
        itemId: item.id,
        levelId: item.parentId,
        sourcePosition: [...item.position] as [number, number, number],
        sourceRotation: [...item.rotation] as [number, number, number],
      }
      recordNavigationPerfMark('navigation.debugRequestMoveItemToWorld', {
        itemId: item.id,
        targetX: finalPosition[0],
        targetY: finalPosition[1],
        targetZ: finalPosition[2],
      })

      let remainingFrames = 120
      const startWhenControllerReady = () => {
        const editorState = useEditor.getState()
        if (editorState.movingNode?.id !== item.id) {
          return
        }

        const navigationState = useNavigation.getState()
        if (navigationState.itemMoveControllers[item.id]) {
          navigationState.requestItemMove(request)
          navigationState.setItemMoveLocked(true)
          return
        }

        if (remainingFrames <= 0) {
          return
        }

        remainingFrames -= 1
        requestAnimationFrame(startWhenControllerReady)
      }

      startWhenControllerReady()
      return true
    }

    const queueMoveItemToWorld = (itemId: string, world: [number, number, number]) => {
      const candidate = sceneState.nodes[itemId]
      if (!(candidate && candidate.type === 'item')) {
        return false
      }

      const item = candidate as ItemNode
      if (
        !isDebugMovableItem(
          item,
          sceneState.nodes as Record<string, ItemNode | LevelNode | { type?: string }>,
        )
      ) {
        return false
      }

      const levelId = resolveLevelId(item, sceneState.nodes)
      if (!levelId) {
        return false
      }

      const navigationState = useNavigation.getState()
      if (
        navigationState.taskQueue.some(
          (task) => task.kind === 'move' && task.request.itemId === item.id,
        ) ||
        navigationState.itemMoveControllers[item.id]
      ) {
        return false
      }

      const itemDimensions = getScaledDimensions(item)
      const finalPosition: [number, number, number] = [
        snapDebugMoveAxis(world[0], itemDimensions[0]),
        item.position[1],
        snapDebugMoveAxis(world[2], itemDimensions[2]),
      ]
      const finalRotation = [...item.rotation] as [number, number, number]
      const previewId =
        `item_debug_move_preview_${item.id}_${Math.round(performance.now())}` as ItemNode['id']
      const placement = spatialGridManager.canPlaceOnFloor(
        levelId,
        finalPosition,
        itemDimensions,
        finalRotation,
        [item.id],
      )
      if (!placement.valid) {
        return false
      }

      const request: NavigationItemMoveRequest = {
        finalUpdate: {
          position: finalPosition,
          rotation: finalRotation,
        },
        itemDimensions,
        itemId: item.id,
        levelId: item.parentId,
        sourcePosition: [...item.position] as [number, number, number],
        sourceRotation: [...item.rotation] as [number, number, number],
        targetPreviewItemId: previewId,
        visualItemId: item.id,
      }

      ensureQueuedNavigationMoveGhostNode(request)

      navigationState.registerItemMoveController(item.id, {
        itemId: item.id,
        beginCarry: () => {
          navigationVisualsStore.getState().setItemMoveVisualState(item.id, 'carried')
        },
        cancel: () => {
          navigationVisualsStore.getState().setItemMoveVisualState(item.id, null)
          navigationVisualsStore.getState().setNodeVisibilityOverride(item.id, null)
          useLiveTransforms.getState().clear(item.id)
          navigationState.registerItemMoveController(item.id, null)
        },
        commit: (finalUpdate, finalCarryTransform) => {
          const sceneNode = useScene.getState().nodes[item.id as AnyNodeId]
          if (sceneNode?.type === 'item') {
            useScene.getState().updateNode(item.id as AnyNodeId, {
              ...finalUpdate,
              metadata: setItemMoveVisualMetadata(sceneNode.metadata, null) as ItemNode['metadata'],
            })
          }

          if (finalCarryTransform) {
            useLiveTransforms.getState().set(item.id, finalCarryTransform)
          }
          navigationVisualsStore.getState().setItemMoveVisualState(item.id, null)
          navigationVisualsStore.getState().setNodeVisibilityOverride(item.id, null)
          useLiveTransforms.getState().clear(item.id)
          clearPersistentItemMoveVisualState(item.id)
          navigationState.registerItemMoveController(item.id, null)
        },
        updateCarryTransform: (position, rotationY) => {
          useLiveTransforms.getState().set(item.id, {
            position,
            rotation: rotationY,
          })
        },
      })

      navigationVisualsStore.getState().setItemMoveVisualState(item.id, 'source-pending')
      navigationVisualsStore.getState().setItemMoveVisualState(previewId, 'destination-ghost')
      recordNavigationPerfMark('navigation.debugQueueMoveItemToWorld', {
        itemId: item.id,
        previewId,
        targetX: finalPosition[0],
        targetY: finalPosition[1],
        targetZ: finalPosition[2],
      })
      navigationState.requestItemMove(request)
      navigationState.setItemMoveLocked(false)
      return true
    }

    const emitGridMove = (world: [number, number, number]) => {
      emitter.emit('grid:move', {
        nativeEvent: null as never,
        localPosition: world,
        position: world,
      })
    }

    const emitGridClick = (world: [number, number, number]) => {
      emitter.emit('grid:click', {
        nativeEvent: null as never,
        localPosition: world,
        position: world,
      })
    }

    const projectWorldToClient = (world: [number, number, number]) => {
      const rect = gl.domElement.getBoundingClientRect()
      const projected = new Vector3(world[0], world[1], world[2]).project(camera)

      return {
        visible:
          projected.z >= -1 &&
          projected.z <= 1 &&
          projected.x >= -1 &&
          projected.x <= 1 &&
          projected.y >= -1 &&
          projected.y <= 1,
        x: rect.left + ((projected.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - projected.y) / 2) * rect.height,
      }
    }

    const setLookAt = (position: [number, number, number], target: [number, number, number]) => {
      navigationEmitter.emit('navigation:look-at', {
        position,
        target,
      })
    }

    const setActorRenderVisible = (visible: boolean | null) => {
      actorRenderVisibleOverrideRef.current = visible
    }

    const setRobotSkinnedMeshesVisible = (visible: boolean | null) => {
      robotSkinnedMeshVisibleOverrideRef.current = visible
    }

    const setRobotStaticMeshesVisible = (visible: boolean | null) => {
      robotStaticMeshVisibleOverrideRef.current = visible
    }

    const setRobotToolAttachmentsVisible = (visible: boolean | null) => {
      robotToolAttachmentsVisibleOverrideRef.current = visible
    }

    const setRobotMaterialDebugMode = (mode: NavigationRobotMaterialDebugMode | null) => {
      robotMaterialDebugModeOverrideRef.current = mode
    }

    const requestDeleteItemById = (itemId: string) => {
      const node = sceneState.nodes[itemId]
      if (node?.type !== 'item') {
        return false
      }

      return requestNavigationItemDelete(node)
    }

    const navDebugApi = {
      canMoveItemToWorld,
      getConnectivitySnapshot,
      getCurrentMovePlanDiagnostics,
      getDoorTangentDiagnostics,
      getNodeRenderTree,
      getPathDiagnostics,
      getRenderBreakdown,
      getState,
      getTrajectorySamples,
      getItemMoveState,
      getMovableItems,
      getRenderDiagnostics,
      getToolConeDiagnostics,
      getToolConeIsolatedOverlay: () => navigationVisualsStore.getState().toolConeIsolatedOverlay,
      getViewportDiagnostics,
      emitGridClick,
      emitGridMove,
      moveToWorld: requestNavigationToPoint,
      projectNodeBoundsToClient,
      projectNodeToClient,
      projectWorldToClient,
      setTrajectoryDebugDistance: (distance: number | null) => {
        trajectoryDebugDistanceRef.current = distance
      },
      setTrajectoryDebugMode: (mode: 'fade' | 'hidden' | 'live' | 'opaque') => {
        trajectoryDebugModeRef.current = mode
      },
      setTrajectoryDebugOpaque: (enabled: boolean) => {
        trajectoryDebugOpaqueRef.current = enabled
        trajectoryDebugModeRef.current = enabled ? 'opaque' : 'fade'
      },
      setTrajectoryDebugPause: (paused: boolean) => {
        trajectoryDebugPauseRef.current = paused
      },
      resetPerf: resetNavigationPerf,
      setMoveItemsEnabled,
      setNavigationEnabled,
      setActorRenderVisible,
      setRobotSkinnedMeshesVisible,
      setRobotStaticMeshesVisible,
      setRobotMaterialDebugMode,
      setRobotToolAttachmentsVisible,
      setPascalTruckVisible: (visible: boolean) => {
        navigationVisualsStore
          .getState()
          .setNodeVisibilityOverride(PASCAL_TRUCK_ITEM_NODE_ID, visible ? null : false)
      },
      setShadowMapEnabled: (enabled: boolean | null) => {
        shadowMapOverrideEnabledRef.current = enabled
      },
      setToolConeOverlayEnabled: (enabled: boolean) => {
        navigationVisualsStore.getState().setToolConeOverlayEnabled(enabled)
      },
      setViewerPostProcessing: (
        mode: ReturnType<typeof useViewer.getState>['runtimePostProcessing'],
      ) => {
        useViewer.getState().setRuntimePostProcessing(mode)
      },
      setRobotMode,
      requestDeleteItemById,
      requestMoveItemToWorld,
      queueMoveItemToWorld,
      setToolConeIsolatedOverlay: (
        overlay: ReturnType<typeof navigationVisualsStore.getState>['toolConeIsolatedOverlay'],
      ) => {
        navigationVisualsStore.getState().setToolConeIsolatedOverlay(overlay)
      },
      startMoveItem,
      setLookAt,
    }

    void navDebugApi
  }, [
    actorCellIndex,
    actorComponentId,
    actorMoving,
    actorSpawnPosition?.join(':') ?? null,
    actorVisible,
    camera,
    candidatePathCollisionAudit.blockedObstacleIds,
    candidatePathCollisionAudit.blockedSampleCount,
    candidatePathCollisionAudit.blockedWallIds,
    candidatePathCurve,
    conservativePathCollisionAudit.blockedObstacleIds,
    conservativePathCollisionAudit.blockedSampleCount,
    conservativePathCollisionAudit.blockedWallIds,
    conservativePathCurve,
    enabled,
    gl.domElement,
    graph,
    pathIndices.length,
    pathLength,
    actorRobotWarmupReady,
    pathCurve,
    pascalTruckExitActive,
    pascalTruckIntroTaskReady,
    prewarmedGraph,
    requestNavigationToPoint,
    sceneState.nodes,
    sceneState.rootNodeIds.join('|'),
    navigationSceneSnapshot?.key,
    selection.buildingId,
    selection.levelId,
    trajectoryMotionProfile,
    getActorNavigationPlanningState,
    getTaskModeSnapshot,
    getResolvedActorWorldPosition,
  ])

  return (
    <>
      {pathGraph && (
        <NavigationDoorSystem
          enabled={enabled}
          graph={pathGraph}
          motionRef={motionRef}
          motionCurve={primaryMotionCurve}
          pathIndices={pathIndices}
          pathLength={primaryMotionLength}
        />
      )}

      {graph && walkableOverlayVisible && <WalkableSurfaceOverlay graph={graph} />}

      {taskQueueSourceMarkerSpecs.map((marker) => (
        <TaskQueueSourceMarker key={`task-source-marker:${marker.taskId}`} marker={marker} />
      ))}

      {enabled && PATH_STATIC_PREVIEW_MODE && pathCurve && pathRenderSegments.length > 0 && (
        <group position={[0, PATH_CURVE_OFFSET_Y, 0]}>
          {pathRenderSegments.map((segment, segmentIndex) => (
            <mesh key={`preview-path-segment-${segmentIndex}`} renderOrder={30}>
              <primitive attach="geometry" object={segment.geometry} />
              <primitive attach="material" object={segment.material} />
            </mesh>
          ))}
        </group>
      )}

      {enabled && !PATH_STATIC_PREVIEW_MODE && trajectoryRibbonGeometry && (
        <group position={[0, PATH_CURVE_OFFSET_Y, 0]}>
          <mesh renderOrder={30}>
            <primitive attach="geometry" object={trajectoryRibbonGeometry} />
            <primitive attach="material" object={trajectoryRibbonMaterial} />
          </mesh>
        </group>
      )}

      {actorMounted && (
        <group position={actorRenderPosition} ref={actorGroupRef} visible={actorRenderVisible}>
          <Suspense fallback={null}>
            <NavigationRobot
              active={actorVisible}
              forcedClipPlayback={actorForcedClipPlayback}
              hoverOffset={ACTOR_HOVER_Y}
              motionRef={motionRef}
              onReady={handlePascalTruckIntroRobotReady}
              onWarmupReadyChange={setActorRobotWarmupReady}
              skinnedMeshVisibilityOverride={robotSkinnedMeshVisibleOverrideRef.current}
              staticMeshVisibilityOverride={robotStaticMeshVisibleOverrideRef.current}
              showToolAttachments={actorToolAttachmentsVisible}
              toolConeColor={activeToolConeColor}
              toolCarryItemId={toolCarryItemId}
              toolCarryItemIdRef={carriedVisualItemIdRef}
              toolInteractionPhaseRef={toolInteractionPhaseRef}
              toolInteractionTargetItemIdRef={toolInteractionTargetItemIdRef}
            />
          </Suspense>
        </group>
      )}
    </>
  )
}
