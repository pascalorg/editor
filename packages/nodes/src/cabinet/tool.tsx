'use client'

import {
  type AnyNode,
  type AnyNodeId,
  CabinetModuleNode,
  CabinetNode,
  collectAlignmentAnchors,
  createSceneApi,
  emitter,
  type GridEvent,
  getFloorPlacedFootprints,
  getWallThickness,
  isCurvedWall,
  movingFootprintAnchors,
  type NodeEvent,
  nodeRegistry,
  resolveAlignment,
  resolveSupportSlabPatch,
  spatialGridManager,
  useScene,
  type WallEvent,
  type WallNode,
} from '@pascal-app/core'
import {
  clearPlacementSurface,
  EDITOR_LAYER,
  formatLinearMeasurement,
  getFloorStackPreviewPosition,
  getSideFromNormal,
  isAlignmentGuideActive,
  isGridSnapActive,
  isMagneticSnapActive,
  isPlacementTypingKey,
  isValidWallSideFace,
  markToolCancelConsumed,
  movementSfxStepKey,
  PlacementBox,
  PlacementCoordinateInput,
  PlacementDimensionGuides,
  type PlacementTypingState,
  parseMeasurement,
  publishPlacementSurface,
  triggerSFX,
  useAlignmentGuides,
  useEditor,
  useFacingPose,
  usePlacementPreview,
  usePlacementTyping,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type Group, Mesh, Quaternion, Vector3 } from 'three'
import {
  FLOOR_PLACEMENT_ALIGNMENT_THRESHOLD_M,
  type FloorPlacementClickTriggerEvent,
  getLevelLocalSnappedPosition,
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
  subscribeFloorPlacementDoubleClicks,
} from '../shared/floor-placement'
import { LevelOffsetGroup } from '../shared/level-offset-group'
import type { WallHit } from '../shared/wall-attach-target'
import { findWallOpeningConflicts } from '../shared/wall-opening-clearance'
import {
  type CabinetStretchPreview,
  cabinetStretchExitSide,
  chooseCabinetContinuousAnchor,
  createCabinetContinuousContinuation,
  isCabinetContinuousFollowUpClick,
  isForcePlacementEvent,
  planCabinetContinuousStretch,
  resolveCabinetContinuousValidity,
  type StretchAnchor,
  type StretchContinuation,
} from './continuous-placement'
import {
  bumpCabinetRunsNear,
  cabinetDefinition,
  cabinetModuleDefinition,
  cabinetRunFootprint,
} from './definition'
import { buildCabinetGeometry } from './geometry'
import { applyCabinetModuleInsertion, cabinetModuleForRunInsertion } from './insertion'
import {
  buildCabinetPlacementSizeDimensions,
  getCabinetPlacementCoordinates,
  resolveCabinetPlacementDimensionPosition,
  resolveCabinetPlacementDimensions,
  resolveCabinetTypedPlacementPosition,
} from './placement-dimensions'
import {
  resolveCabinetGridPosition,
  resolveCabinetGridPositionInFrame,
  resolveCabinetLevelPlanFrame,
} from './placement-snap'
import useCabinetPlacementStatus from './placement-status'
import useCabinetPlacementType from './placement-type'
import { cabinetPresetById } from './presets'
import {
  moduleMaxX,
  planRunModuleInsertion,
  planToRunLocal,
  runLocalToPlan,
  runWallConstraints,
  sortRunModules,
} from './run-layout'
import {
  addCabinetModuleSide,
  addCornerRun,
  cabinetModulesForRun,
  cornerPinnedEndsForRun,
  previewCornerAdditionLayout,
  syncCornerRunsFromRunSources,
} from './run-ops'
import {
  type CabinetWallSnapPlacement,
  findClosestCabinetWallInPlan,
  resolveCabinetWallSnapPlacementInScene,
} from './wall-snap'

const PREVIEW_OPACITY = 0.55
const ROTATE_STEP_RAD = Math.PI / 4
const DEFAULT_PLACEMENT_PRESET = cabinetPresetById('base-door')
const ISLAND_SEATING_OVERHANG = 0.3

type CabinetPlacement = {
  position: [number, number, number]
  yaw: number
  snappedToWall: boolean
  valid: boolean
  conflictIds: string[]
  wallId?: AnyNodeId
  wallLocalX?: number
  guide?: CabinetWallSnapPlacement['guide']
  snapReason?: CabinetWallSnapPlacement['snapReason']
  wallSurfaceNormal?: [number, number, number]
  // Rubber-band state: anchor is `position`/`yaw`; modules are run-local
  // center offsets filling the anchor→cursor span.
  stretch?: CabinetStretchPreview
  stretchAnchor?: StretchAnchor
  insertionPreview?: CabinetInsertionPreview
  insertionFailure?: CabinetInsertionFailure
}

type CabinetInsertionPreview = {
  runId: AnyNodeId
  runPosition: [number, number, number]
  runYaw: number
  modules: Array<{
    id: AnyNodeId
    position: [number, number, number]
    width: number
  }>
  inserted: {
    position: [number, number, number]
    width: number
  }
}

type CabinetInsertionFailure = {
  runId: AnyNodeId
  reason: 'no-space'
}

function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b))
}

function resolveCabinetRunInsertion({
  hit,
  insertionId,
  nodes,
  placement,
  parentLevelId,
  width,
}: {
  hit: WallHit
  insertionId: CabinetModuleNode['id']
  nodes: Record<AnyNodeId, AnyNode>
  placement: CabinetWallSnapPlacement
  parentLevelId: AnyNodeId
  width: number
}):
  | { kind: 'preview'; runId: AnyNodeId; plan: CabinetInsertionPreview }
  | { kind: 'blocked'; runId: AnyNodeId; reason: 'no-space' }
  | null {
  if (isCurvedWall(hit.wall)) return null

  const candidates = Object.values(nodes).filter(
    (node): node is CabinetNode =>
      node?.type === 'cabinet' && node.parentId === parentLevelId && node.rotation != null,
  )
  let best:
    | {
        distance: number
        run: CabinetNode
        modules: ReturnType<typeof cabinetModulesForRun>
        localX: number
      }
    | undefined

  for (const run of candidates) {
    if (Math.abs(angleDelta(run.rotation, placement.yaw)) > 0.08) continue
    const modules = cabinetModulesForRun(run, nodes)
    if (modules.length < 2) continue
    const local = planToRunLocal(run, placement.position[0], 0, placement.position[2])
    const sorted = sortRunModules(modules)
    const insertionIndex = sorted.findIndex((module) => moduleMaxX(module) > local[0] + 1e-4)
    if (insertionIndex <= 0 || insertionIndex >= sorted.length) continue
    const left = sorted[insertionIndex - 1]!
    const right = sorted[insertionIndex]!
    if (
      local[0] < moduleMaxX(left) - 0.15 ||
      local[0] > right.position[0] - right.width / 2 + 0.15
    ) {
      continue
    }
    const distance = Math.abs(local[2] - (left.position[2] + right.position[2]) / 2)
    if (!best || distance < best.distance) best = { distance, run, modules, localX: local[0] }
  }

  if (!best) return null
  const { run, modules, localX } = best
  const sorted = sortRunModules(modules)
  const insertionModule = sorted.find((module) => moduleMaxX(module) > localX + 1e-4)
  const insertionY = insertionModule?.position[1] ?? sorted[0]!.position[1]
  const insertionZ = insertionModule?.position[2] ?? sorted[0]!.position[2]
  const preserveEnds = cornerPinnedEndsForRun(modules)
  const result = planRunModuleInsertion({
    modules,
    insertion: {
      id: insertionId,
      position: [localX, insertionY, insertionZ],
      width,
    },
    wallConstraints: runWallConstraints(run, modules, nodes),
    fillerIds: new Set(
      modules.filter((module) => module.moduleKind === 'corner-filler').map((module) => module.id),
    ),
    preserveEnds,
    anchorInsertionSide: preserveEnds.right ? 'right' : 'left',
  })
  if (!result.ok) return { kind: 'blocked', reason: 'no-space', runId: run.id as AnyNodeId }
  return {
    kind: 'preview',
    runId: run.id as AnyNodeId,
    plan: {
      runId: run.id as AnyNodeId,
      runPosition: [...run.position] as [number, number, number],
      runYaw: run.rotation,
      modules: result.modules.map((module) => ({
        id: module.id as AnyNodeId,
        position: [...module.position] as [number, number, number],
        width: module.width,
      })),
      inserted: {
        position: [...result.inserted.position] as [number, number, number],
        width: result.inserted.width,
      },
    },
  }
}

type DraftSegment = {
  anchor: StretchAnchor
  stretch: CabinetStretchPreview
}

type DraftAnchorState = StretchAnchor | StretchContinuation

function isStretchContinuation(anchor: DraftAnchorState): anchor is StretchContinuation {
  return 'straightAnchor' in anchor
}

function stretchWithAdjustedConnectedWidth(
  stretch: CabinetStretchPreview,
  connectedWidth: number,
): CabinetStretchPreview {
  if (stretch.modules.length < 2) return stretch
  const widths = [
    stretch.modules[0]!.width,
    connectedWidth,
    ...stretch.modules.slice(2).map((module) => module.width),
  ]
  const halfFirst = widths[0]! / 2
  let cum = 0
  const modules = widths.map((width) => {
    const x = stretch.direction * (cum + width / 2 - halfFirst)
    cum += width
    return { x, width }
  })
  const total = widths.reduce((sum, width) => sum + width, 0)
  return {
    modules,
    length: total,
    centerLocalX: stretch.direction * (total / 2 - halfFirst),
    direction: stretch.direction,
  }
}

function runModuleBaseY(plinthHeight: number, showPlinth: boolean) {
  return showPlinth ? plinthHeight : 0
}

function buildCabinetPlacementPreviewNode({
  island,
  position,
  previewModule,
  yaw,
}: {
  island: boolean
  position: [number, number, number]
  previewModule: Pick<
    ReturnType<typeof CabinetModuleNode.parse>,
    'width' | 'depth' | 'carcassHeight'
  >
  yaw: number
}) {
  const defaults = cabinetDefinition.defaults()
  return CabinetNode.parse({
    ...defaults,
    name: island ? 'Kitchen Island Preview' : 'Modular Cabinet Preview',
    position,
    rotation: yaw,
    width: previewModule.width,
    depth: previewModule.depth,
    carcassHeight: previewModule.carcassHeight,
    ...(island && {
      countertopBackOverhang: ISLAND_SEATING_OVERHANG,
      withFinishedBack: true,
    }),
  })
}

// Cabinet wall attachment is a placement affordance, separate from floor-grid
// quantization. Keep the long-standing behavior in grid and magnetic modes;
// Off remains the explicit way to place without wall attachment.
function isWallSnapEligible(): boolean {
  return isGridSnapActive() || isMagneticSnapActive()
}

function WallSnapGuide({
  blocked,
  guide,
}: {
  blocked: boolean
  guide: NonNullable<CabinetPlacement['guide']>
}) {
  const dx = guide.end[0] - guide.start[0]
  const dz = guide.end[2] - guide.start[2]
  const length = Math.hypot(dx, dz)
  if (length <= 1e-4) return null
  return (
    <group
      position={[
        (guide.start[0] + guide.end[0]) / 2,
        guide.start[1],
        (guide.start[2] + guide.end[2]) / 2,
      ]}
      rotation={[0, Math.atan2(-dz, dx), 0]}
    >
      <mesh>
        <boxGeometry args={[length, 0.018, 0.018]} />
        <meshBasicMaterial
          color={blocked ? '#ef4444' : '#f59e0b'}
          opacity={blocked ? 0.85 : 0.7}
          transparent
        />
      </mesh>
    </group>
  )
}

// Re-key only the sibling runs whose countertop join the new run can affect.
// The adjacency watcher in system.tsx skips a run's first sighting, so it
// never re-keys neighbors when a run APPEARS — this covers that gap. History
// stays paused inside `bumpCabinetRunsNear`, keeping placement one undo step.
function bumpCabinetRunsNearNewRun(runId: AnyNodeId) {
  const scene = useScene.getState()
  const run = scene.nodes[runId]
  if (run?.type !== 'cabinet') return
  bumpCabinetRunsNear(
    createSceneApi(useScene),
    [cabinetRunFootprint(run, scene.nodes)],
    new Set([runId]),
  )
}

function wallHitFromWallEvent(event: WallEvent): WallHit | null {
  if (!event.normal || !isValidWallSideFace(event.normal) || isCurvedWall(event.node)) return null
  const wall = event.node as WallNode
  const dx = wall.end[0] - wall.start[0]
  const dy = wall.end[1] - wall.start[1]
  const wallLength = Math.hypot(dx, dy)
  if (wallLength <= 1e-6) return null
  const side = getSideFromNormal(event.normal)

  return {
    wall,
    localX: event.localPosition[0],
    perpDistance: (side === 'front' ? 1 : -1) * (getWallThickness(wall) / 2),
    side,
    dirX: dx / wallLength,
    dirY: dy / wallLength,
    wallLength,
    itemRotation: side === 'front' ? 0 : Math.PI,
  }
}

const CabinetTool = () => {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const unit = useViewer((s) => s.unit)
  const metricNotation = useViewer((s) => s.metricNotation)
  const activeDimensionId = usePlacementPreview((s) => s.activeDimensionId)
  const dimensionInput = usePlacementPreview((s) => s.dimensionInput)
  const typingActive = usePlacementTyping((s) => s.isActive)
  const typingProjectedPosition = usePlacementTyping((s) => s.projectedPosition)
  // HUD ownership: in 2d/split the floorplan pane owns the typed-entry HUD.
  const viewMode = useEditor((s) => s.viewMode)
  const [placement, setPlacement] = useState<CabinetPlacement | null>(null)
  const [draftSegments, setDraftSegments] = useState<DraftSegment[]>([])
  const [yaw, setYaw] = useState(0)
  const placementType = useCabinetPlacementType((s) => s.type)
  const islandMode = placementType === 'island'
  const yawRef = useRef(0)
  const islandModeRef = useRef(useCabinetPlacementType.getState().type === 'island')
  const placementRef = useRef<CabinetPlacement | null>(null)
  const draftSegmentsRef = useRef<DraftSegment[]>([])
  const chainRootRunRef = useRef<CabinetNode | null>(null)
  const chainRunRef = useRef<CabinetNode | null>(null)
  const chainEndModuleRef = useRef<ReturnType<typeof CabinetModuleNode.parse> | null>(null)
  const chainCornerSideRef = useRef<'left' | 'right' | null>(null)
  const previousSnapRef = useRef<string | null>(null)
  const previousWasWallSnapRef = useRef(false)
  const previousTickFrameRef = useRef(-1)
  const draftAnchorRef = useRef<DraftAnchorState | null>(null)
  const lastRawPositionRef = useRef<[number, number, number] | null>(null)
  const typedWallHitRef = useRef<WallHit | null>(null)
  const typedCoordinateDefaultsRef = useRef<[number, number] | null>(null)
  // Set while a code path intentionally ends the session *and* owns the
  // placement afterwards (canvas-click commit, island toggle) so the
  // restore-on-cancel logic stays out of the way.
  const suppressTypedRestoreRef = useRef(false)
  const lastPlacementEventRef = useRef<FloorPlacementClickTriggerEvent | null>(null)
  const activeGhostRef = useRef<Group | null>(null)
  const surfacePointRef = useRef(new Vector3())
  const surfaceNormalRef = useRef(new Vector3(0, 1, 0))
  const surfaceQuatRef = useRef(new Quaternion())
  const surfaceForwardRef = useRef(new Vector3(0, 0, 1))
  const facingPointRef = useRef(new Vector3())

  const previewNodeTemplate = useMemo(() => {
    const runDefaults = cabinetDefinition.defaults()
    return CabinetModuleNode.parse({
      ...cabinetModuleDefinition.defaults(),
      ...DEFAULT_PLACEMENT_PRESET.createPatch(),
      showPlinth: runDefaults.showPlinth,
      plinthHeight: runDefaults.plinthHeight,
      toeKickDepth: runDefaults.toeKickDepth,
      withCountertop: runDefaults.withCountertop,
      countertopThickness: runDefaults.countertopThickness,
      countertopOverhang: runDefaults.countertopOverhang,
      countertopBackOverhang: runDefaults.countertopBackOverhang,
    })
  }, [])
  const [previewSize, setPreviewSize] = useState(() => ({
    depth: previewNodeTemplate.depth,
    height: previewNodeTemplate.carcassHeight,
    width: previewNodeTemplate.width,
  }))
  const previewNode = useMemo(
    () =>
      CabinetModuleNode.parse({
        ...previewNodeTemplate,
        carcassHeight: previewSize.height,
        depth: previewSize.depth,
        width: previewSize.width,
      }),
    [previewNodeTemplate, previewSize],
  )
  const previewNodeRef = useRef(previewNode)
  previewNodeRef.current = previewNode
  const placementDimensions = useMemo(() => {
    const defaults = cabinetDefinition.defaults()
    return [
      previewNode.width,
      (defaults.showPlinth ? defaults.plinthHeight : 0) +
        previewNode.carcassHeight +
        (defaults.withCountertop ? defaults.countertopThickness : 0),
      previewNode.depth + (islandMode ? ISLAND_SEATING_OVERHANG : 0),
    ] as [number, number, number]
  }, [previewNode, islandMode])
  const placementDimensionsRef = useRef(placementDimensions)
  placementDimensionsRef.current = placementDimensions
  const placementSnapFootprint = useMemo(() => {
    const sideAndFrontOverhang = previewNode.withCountertop ? previewNode.countertopOverhang : 0
    const backOverhang = islandMode ? ISLAND_SEATING_OVERHANG : 0
    return {
      dimensions: [
        previewNode.width + sideAndFrontOverhang * 2,
        placementDimensions[1],
        previewNode.depth + sideAndFrontOverhang + backOverhang,
      ] as [number, number, number],
      offset: [0, (sideAndFrontOverhang - backOverhang) / 2] as [number, number],
    }
  }, [islandMode, placementDimensions, previewNode])
  const placementSnapFootprintRef = useRef(placementSnapFootprint)
  placementSnapFootprintRef.current = placementSnapFootprint
  const ghost = useMemo(() => {
    const group = buildCabinetGeometry(previewNode)
    group.traverse((child) => {
      if (child instanceof Mesh) {
        child.material = child.material.clone()
        child.material.transparent = true
        child.material.opacity = PREVIEW_OPACITY
        child.raycast = () => {}
      }
    })
    return group
  }, [previewNode])
  const insertionGhost = useMemo(() => {
    const node = CabinetModuleNode.parse({
      ...previewNode,
      plinthHeight: 0,
      showPlinth: false,
      countertopThickness: 0,
      withCountertop: false,
    })
    const group = buildCabinetGeometry(node)
    group.traverse((child) => {
      child.layers.set(EDITOR_LAYER)
      if (child instanceof Mesh) {
        child.material = child.material.clone()
        child.material.transparent = true
        child.material.opacity = PREVIEW_OPACITY
        child.raycast = () => {}
      }
    })
    return group
  }, [previewNode])
  // The stretched span renders one ghost per module — the same Object3D can't
  // appear twice in the scene, so extra modules reuse pooled clones (geometry
  // and materials stay shared) instead of cloning on every pointer move.
  const ghostPoolRef = useRef<Group[]>([])
  const ghostForIndex = useCallback(
    (index: number): Group => {
      if (index === 0) return ghost
      const pool = ghostPoolRef.current
      while (pool.length < index) pool.push(ghost.clone())
      return pool[index - 1] as Group
    },
    [ghost],
  )
  const insertionGhostPoolRef = useRef<Group[]>([])
  const insertionGhostForIndex = useCallback(
    (index: number): Group => {
      if (index === 0) return insertionGhost
      const pool = insertionGhostPoolRef.current
      while (pool.length < index) pool.push(insertionGhost.clone())
      return pool[index - 1] as Group
    },
    [insertionGhost],
  )

  const publishFloorplanPreview = useCallback(
    (next: CabinetPlacement, island = islandModeRef.current) => {
      const stretch = next.stretch
      const previewPosition = stretch
        ? runLocalToPlan({ position: next.position, rotation: next.yaw }, [
            stretch.centerLocalX,
            0,
            0,
          ])
        : next.position
      const livePreviewNode = previewNodeRef.current
      const node = buildCabinetPlacementPreviewNode({
        island,
        position: previewPosition,
        previewModule: livePreviewNode,
        yaw: next.yaw,
      })
      let floorplanNode: AnyNode = stretch ? { ...node, width: stretch.length } : node
      let floorplanContextNodes: AnyNode[] = []
      if (next.insertionPreview) {
        const liveRun = useScene.getState().nodes[next.insertionPreview.runId]
        if (liveRun?.type === 'cabinet') {
          const insertedId = livePreviewNode.id as AnyNodeId
          const previewModules = [
            ...next.insertionPreview.modules.map((planned) => {
              const liveModule = useScene.getState().nodes[planned.id]
              return liveModule?.type === 'cabinet-module'
                ? ({
                    ...liveModule,
                    position: planned.position,
                    width: planned.width,
                  } as CabinetModuleNode)
                : null
            }),
            CabinetModuleNode.parse({
              ...cabinetModuleForRunInsertion(livePreviewNode, liveRun),
              id: insertedId,
              position: next.insertionPreview.inserted.position,
              width: next.insertionPreview.inserted.width,
            }),
          ].filter((previewModule): previewModule is CabinetModuleNode => previewModule != null)
          floorplanNode = CabinetNode.parse({
            ...liveRun,
            children: previewModules.map((previewModule) => previewModule.id as AnyNodeId),
          })
          floorplanContextNodes = previewModules as AnyNode[]
        }
      }
      const placementDimensions =
        activeLevelId && !island
          ? resolveCabinetPlacementDimensions({
              depth: livePreviewNode.depth,
              levelId: activeLevelId,
              nodes: useScene.getState().nodes,
              position: previewPosition,
              providedWallHit:
                typedWallHitRef.current && next.wallLocalX != null
                  ? { ...typedWallHitRef.current, localX: next.wallLocalX }
                  : undefined,
              rotation: next.yaw,
              wallId: next.wallId,
              width: stretch?.length ?? livePreviewNode.width,
            })
          : []
      const sizeDimensions =
        !stretch && !island
          ? buildCabinetPlacementSizeDimensions({
              depth: livePreviewNode.depth,
              height: livePreviewNode.carcassHeight,
              position: previewPosition,
              rotation: next.yaw,
              width: livePreviewNode.width,
            })
          : []
      // A stretched span can exceed the schema's width cap — override post-parse.
      usePlacementPreview
        .getState()
        .set(
          floorplanNode,
          null,
          [...placementDimensions, ...sizeDimensions],
          floorplanContextNodes,
        )
    },
    [activeLevelId],
  )

  useFrame(() => {
    const ghostGroup = activeGhostRef.current
    const current = placementRef.current
    if (!ghostGroup || !current) {
      clearPlacementSurface()
      useFacingPose.getState().clear()
      return
    }

    ghostGroup.getWorldPosition(surfacePointRef.current)
    const facingPoint = current.stretch
      ? ghostGroup.localToWorld(facingPointRef.current.set(current.stretch.centerLocalX, 0, 0))
      : facingPointRef.current.copy(surfacePointRef.current)
    if (current.snappedToWall) {
      ghostGroup.getWorldQuaternion(surfaceQuatRef.current)
      const forward = surfaceForwardRef.current.set(0, 0, 1).applyQuaternion(surfaceQuatRef.current)
      forward.y = 0
      if (forward.lengthSq() > 1e-6) {
        surfaceNormalRef.current.copy(forward.normalize())
      } else if (current.wallSurfaceNormal) {
        surfaceNormalRef.current.set(...current.wallSurfaceNormal)
      }
      surfacePointRef.current.addScaledVector(surfaceNormalRef.current, -previewNode.depth / 2)
    } else {
      surfaceNormalRef.current.set(0, 1, 0)
    }
    publishPlacementSurface(surfacePointRef.current, surfaceNormalRef.current)
    useFacingPose.getState().set({
      position: [facingPoint.x, facingPoint.y, facingPoint.z],
      rotationY: current.snappedToWall || current.stretch ? current.yaw : yawRef.current,
      depth: current.stretch ? placementDimensions[2] : previewNode.depth,
    })
  })

  useEffect(() => {
    if (!activeLevelId) return
    placementRef.current = null
    draftSegmentsRef.current = []
    chainRootRunRef.current = null
    chainRunRef.current = null
    chainEndModuleRef.current = null
    chainCornerSideRef.current = null
    setDraftSegments([])
    previousSnapRef.current = null
    previousWasWallSnapRef.current = false
    previousTickFrameRef.current = -1
    draftAnchorRef.current = null
    typedWallHitRef.current = null
    typedCoordinateDefaultsRef.current = null
    lastPlacementEventRef.current = null
    usePlacementTyping.getState().clear()
    let alignmentCandidates = collectAlignmentAnchors(
      useScene.getState().nodes,
      previewNodeRef.current.id,
      activeLevelId,
    )
    let lastWallEventTime = -1
    let wallOwnedPointerAt = Number.NEGATIVE_INFINITY
    const WALL_OWNS_POINTER_MS = 64
    const markWallOwnedPointer = () => {
      wallOwnedPointerAt = performance.now()
    }
    const wallOwnsPointer = () => performance.now() - wallOwnedPointerAt < WALL_OWNS_POINTER_MS

    const clearDraft = () => {
      draftSegmentsRef.current = []
      chainRootRunRef.current = null
      chainRunRef.current = null
      chainEndModuleRef.current = null
      chainCornerSideRef.current = null
      setDraftSegments([])
      draftAnchorRef.current = null
      placementRef.current = null
      setPlacement(null)
      usePlacementPreview.getState().clear()
      previousSnapRef.current = null
      previousTickFrameRef.current = -1
      clearPlacementSurface()
      useFacingPose.getState().clear()
      useAlignmentGuides.getState().clear()
      useCabinetPlacementStatus.getState().setBlocked(false)
    }

    const applyPlacementType = (type: 'cabinet' | 'island') => {
      const nextIslandMode = type === 'island'
      if (nextIslandMode === islandModeRef.current) return
      const currentPlacement = placementRef.current
      const hasContinuousDraft =
        draftAnchorRef.current !== null || draftSegmentsRef.current.length > 0
      if (hasContinuousDraft) clearDraft()
      islandModeRef.current = nextIslandMode
      // Island mode has no wall snapping, so a live typed session would be
      // orphaned (frozen pointer + vanished HUD). End it — the toggle owns
      // the placement afterwards, so suppress the pose restore.
      if (nextIslandMode && usePlacementTyping.getState().isActive) {
        suppressTypedRestoreRef.current = true
        usePlacementTyping.getState().clear()
        typedWallHitRef.current = null
        typedCoordinateDefaultsRef.current = null
      }
      if (hasContinuousDraft) return
      // Drop a stale wall-snapped preview so the next move re-resolves free.
      if (nextIslandMode && currentPlacement?.snappedToWall) {
        placementRef.current = null
        setPlacement(null)
        usePlacementPreview.getState().clear()
      } else if (currentPlacement) {
        publishFloorplanPreview(currentPlacement, nextIslandMode)
      }
    }

    // The segmented draft survives only while continuous mode is on.
    const resolveDraftAnchor = (): DraftAnchorState | null => {
      const anchor = draftAnchorRef.current
      if (!anchor) return null
      if (useEditor.getState().getContinuation('cabinet') !== 'continuous') {
        clearDraft()
        return null
      }
      return anchor
    }

    const resolveRawPosition = (
      event: FloorPlacementClickTriggerEvent,
    ): [number, number, number] => {
      return getLevelLocalSnappedPosition(activeLevelId, event, 0, true)
    }

    const resolveGridPosition = (
      raw: [number, number, number],
      bypassGrid = false,
    ): [number, number, number] => {
      const step = !bypassGrid && isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      if (step > 0) {
        const frame = resolveCabinetLevelPlanFrame(activeLevelId, useScene.getState().nodes)
        return resolveCabinetGridPositionInFrame({
          raw,
          dimensions: placementSnapFootprintRef.current.dimensions,
          footprintOffset: placementSnapFootprintRef.current.offset,
          yaw: yawRef.current,
          step,
          frame,
        })
      }
      return resolveCabinetGridPosition({
        raw,
        dimensions: placementSnapFootprintRef.current.dimensions,
        footprintOffset: placementSnapFootprintRef.current.offset,
        yaw: yawRef.current,
        step,
      })
    }

    const resolveAlignedCabinetPosition = ({
      applyAlignmentSnap,
      position,
      width,
      yaw,
    }: {
      applyAlignmentSnap: boolean
      position: [number, number, number]
      width?: number
      yaw: number
    }): [number, number, number] => {
      if (!isAlignmentGuideActive()) {
        useAlignmentGuides.getState().clear()
        return position
      }

      const alignmentNode = buildCabinetPlacementPreviewNode({
        island: islandModeRef.current,
        position,
        previewModule: previewNodeRef.current,
        yaw,
      })
      const moving = movingFootprintAnchors(
        {
          ...alignmentNode,
          ...(width != null ? { width } : null),
        } as AnyNode,
        position[0],
        position[2],
        yaw,
      )
      if (moving.length === 0 || alignmentCandidates.length === 0) {
        useAlignmentGuides.getState().clear()
        return position
      }

      const result = resolveAlignment({
        moving,
        candidates: alignmentCandidates,
        threshold: FLOOR_PLACEMENT_ALIGNMENT_THRESHOLD_M,
      })
      useAlignmentGuides.getState().set(result.guides)

      if (!applyAlignmentSnap || !result.snap) return position
      return [position[0] + result.snap.dx, position[1], position[2] + result.snap.dz]
    }

    const withPlacementValidity = (
      next: Omit<CabinetPlacement, 'conflictIds' | 'valid'>,
      bypassCollision: boolean,
    ): CabinetPlacement => {
      if (bypassCollision) {
        return { ...next, conflictIds: [], valid: !next.insertionFailure }
      }
      const livePreviewNode = previewNodeRef.current
      const livePlacementDimensions = placementDimensionsRef.current
      const floorPlaced = nodeRegistry.get(livePreviewNode.type)?.capabilities?.floorPlaced
      const effectiveNode = {
        ...livePreviewNode,
        position: next.position,
        rotation: next.yaw,
      }
      const ignoreIds = next.insertionPreview ? [next.insertionPreview.runId] : undefined
      const footprints = floorPlaced
        ? getFloorPlacedFootprints(floorPlaced, effectiveNode, {
            nodes: useScene.getState().nodes,
          }).filter(
            (
              footprint,
            ): footprint is {
              position: [number, number, number]
              dimensions: [number, number, number]
              rotation: [number, number, number]
            } => footprint.position != null,
          )
        : []
      const result =
        footprints.length > 0
          ? spatialGridManager.canPlaceOnFloorFootprints(activeLevelId, footprints, ignoreIds)
          : spatialGridManager.canPlaceOnFloor(
              activeLevelId,
              next.position,
              livePlacementDimensions,
              [0, next.yaw, 0],
              ignoreIds,
            )
      const wall = next.wallId ? useScene.getState().nodes[next.wallId] : undefined
      const openingConflictIds =
        wall?.type === 'wall' && next.wallLocalX != null
          ? findWallOpeningConflicts({
              bottom: 0,
              height: livePlacementDimensions[1],
              localX: next.wallLocalX,
              nodes: useScene.getState().nodes,
              wall,
              width: livePreviewNode.width,
            })
          : []
      const conflictIds = [...new Set([...result.conflictIds, ...openingConflictIds])]
      return {
        ...next,
        conflictIds,
        valid: !next.insertionFailure && result.valid && openingConflictIds.length === 0,
      }
    }

    const resolveWallHitPlacement = (hit: WallHit): CabinetPlacement | null => {
      if (!isWallSnapEligible()) return null
      const nodes = useScene.getState().nodes
      const wallPlacement = resolveCabinetWallSnapPlacementInScene({
        depth: previewNodeRef.current.depth,
        gridStep: isGridSnapActive() ? useEditor.getState().gridSnapStep : 0,
        hit,
        nodes,
        parentLevelId: activeLevelId as AnyNodeId,
        width: previewNodeRef.current.width,
      })
      if (!wallPlacement) return null
      const wallSurfaceNormal = [Math.sin(wallPlacement.yaw), 0, Math.cos(wallPlacement.yaw)] as [
        number,
        number,
        number,
      ]

      const insertion = resolveCabinetRunInsertion({
        hit,
        insertionId: previewNodeRef.current.id,
        nodes,
        placement: wallPlacement,
        parentLevelId: activeLevelId as AnyNodeId,
        width: previewNodeRef.current.width,
      })
      const insertionPreview = insertion?.kind === 'preview' ? insertion.plan : undefined
      const insertionFailure =
        insertion?.kind === 'blocked'
          ? { runId: insertion.runId, reason: insertion.reason }
          : undefined
      const insertionPosition = insertionPreview
        ? runLocalToPlan(
            { position: insertionPreview.runPosition, rotation: insertionPreview.runYaw },
            insertionPreview.inserted.position,
          )
        : wallPlacement.position

      return {
        conflictIds: [],
        guide: wallPlacement.guide,
        ...(insertionFailure ? { insertionFailure } : {}),
        ...(insertionPreview ? { insertionPreview } : {}),
        position: insertionPosition,
        snapReason: wallPlacement.snapReason,
        valid: true,
        wallId: hit.wall.id as AnyNodeId,
        wallLocalX: wallPlacement.localX,
        wallSurfaceNormal,
        yaw: wallPlacement.yaw,
        snappedToWall: true,
      }
    }

    const resolveWallPlacement = (raw: [number, number, number]): CabinetPlacement | null => {
      if (!isWallSnapEligible()) return null
      const nodes = useScene.getState().nodes
      const hit = findClosestCabinetWallInPlan({
        excludeIds: [],
        nodes,
        parentLevelId: activeLevelId as AnyNodeId,
        planPoint: [raw[0], raw[2]],
      })
      if (!hit) return null
      return resolveWallHitPlacement(hit)
    }

    const resolvePlacement = (event: FloorPlacementClickTriggerEvent): CabinetPlacement => {
      const raw = resolveRawPosition(event)
      lastRawPositionRef.current = raw
      const forcePlacement = isForcePlacementEvent(event)
      const wallPlacement = islandModeRef.current ? null : resolveWallPlacement(raw)
      if (wallPlacement) {
        return withPlacementValidity(
          {
            ...wallPlacement,
            position: resolveAlignedCabinetPosition({
              applyAlignmentSnap: false,
              position: wallPlacement.position,
              yaw: wallPlacement.yaw,
            }),
          },
          forcePlacement,
        )
      }
      const position = resolveAlignedCabinetPosition({
        applyAlignmentSnap: isMagneticSnapActive(),
        position: resolveGridPosition(raw),
        yaw: yawRef.current,
      })
      return withPlacementValidity(
        {
          position,
          yaw: yawRef.current,
          snappedToWall: false,
        },
        forcePlacement,
      )
    }

    const resolveStretchedValidity = (
      anchor: StretchAnchor,
      stretch: CabinetStretchPreview,
      forcePlace: boolean,
    ) => {
      const spanCenter = runLocalToPlan({ position: anchor.position, rotation: anchor.yaw }, [
        stretch.centerLocalX,
        0,
        0,
      ])
      const ignoreIds = chainRootRunRef.current
        ? [chainRootRunRef.current.id as AnyNodeId]
        : undefined
      return resolveCabinetContinuousValidity(
        (() => {
          const floorResult = spatialGridManager.canPlaceOnFloor(
            activeLevelId,
            spanCenter,
            [stretch.length, placementDimensionsRef.current[1], placementDimensionsRef.current[2]],
            [0, anchor.yaw, 0],
            ignoreIds,
          )
          const nodes = useScene.getState().nodes
          const wall = anchor.wallId ? nodes[anchor.wallId] : undefined
          const wallHit =
            wall?.type === 'wall' && anchor.wallLocalX != null
              ? { wall, localX: anchor.wallLocalX + stretch.centerLocalX }
              : findClosestCabinetWallInPlan({
                  excludeIds: [],
                  nodes,
                  parentLevelId: activeLevelId as AnyNodeId,
                  planPoint: [spanCenter[0], spanCenter[2]],
                  yaw: anchor.yaw,
                })
          const openingConflictIds =
            wallHit && (wallHit.localX ?? null) != null
              ? findWallOpeningConflicts({
                  bottom: 0,
                  height: placementDimensionsRef.current[1],
                  localX: wallHit.localX!,
                  nodes,
                  wall: wallHit.wall,
                  width: stretch.length,
                })
              : []
          return {
            conflictIds: [...new Set([...floorResult.conflictIds, ...openingConflictIds])],
            valid: floorResult.valid && openingConflictIds.length === 0,
          }
        })(),
        forcePlace,
      )
    }

    // While stretching, the run is pinned at the anchored first module and
    // grows toward the cursor — the far end tracks the pointer smoothly.
    const resolveStretchedPlacement = (
      anchor: StretchAnchor,
      event: FloorPlacementClickTriggerEvent,
      rawOverride?: [number, number, number],
    ): CabinetPlacement => {
      useAlignmentGuides.getState().clear()
      // `rawOverride` lets callers seed the stretch geometry directly (typed
      // entry commits at the typed pose — the reused pointer event's cursor
      // position is stale and must not grow the run).
      const raw = rawOverride ?? resolveRawPosition(event)
      let stretch = planCabinetContinuousStretch({
        anchor,
        previewWidth: previewNodeRef.current.width,
        rawPlanPosition: raw,
      })
      if (
        anchor.leadingWidth != null &&
        chainRunRef.current &&
        chainEndModuleRef.current &&
        chainCornerSideRef.current
      ) {
        const preview = previewCornerAdditionLayout({
          module: chainEndModuleRef.current,
          run: chainRunRef.current,
          nodes: useScene.getState().nodes,
          side: chainCornerSideRef.current,
        })
        if (!preview) {
          return {
            position: anchor.position,
            yaw: anchor.yaw,
            snappedToWall: anchor.snappedToWall,
            wallId: anchor.wallId,
            wallLocalX: anchor.wallLocalX,
            wallSurfaceNormal: anchor.wallSurfaceNormal,
            valid: false,
            conflictIds: [],
            stretch,
            stretchAnchor: anchor,
          }
        }
        stretch = stretchWithAdjustedConnectedWidth(stretch, preview.connectedWidth)
      }
      const result = resolveStretchedValidity(anchor, stretch, isForcePlacementEvent(event))
      return {
        position: anchor.position,
        yaw: anchor.yaw,
        snappedToWall: anchor.snappedToWall,
        wallId: anchor.wallId,
        wallLocalX: anchor.wallLocalX,
        wallSurfaceNormal: anchor.wallSurfaceNormal,
        valid: result.valid,
        conflictIds: result.conflictIds,
        stretch,
        stretchAnchor: anchor,
      }
    }

    const resolveActiveStretchPlacement = (
      anchor: DraftAnchorState,
      event: FloorPlacementClickTriggerEvent,
    ): CabinetPlacement => {
      if (isStretchContinuation(anchor)) {
        return resolveStretchedPlacement(
          chooseCabinetContinuousAnchor(anchor, resolveRawPosition(event)),
          event,
        )
      }
      return resolveStretchedPlacement(anchor, event)
    }

    const publishPlacement = (next: CabinetPlacement, frame = -1) => {
      placementRef.current = next
      setPlacement(next)
      useCabinetPlacementStatus.getState().setBlocked(!next.valid)
      publishFloorplanPreview(next)
      const nextSnapKey = movementSfxStepKey({
        coords:
          next.snappedToWall && typeof next.wallLocalX === 'number'
            ? [next.wallLocalX]
            : [next.position[0], next.position[2]],
        gridSnapActive: isGridSnapActive(),
        gridStep: useEditor.getState().gridSnapStep,
      })
      const prev = previousSnapRef.current
      const wasWallSnap = previousWasWallSnapRef.current
      if (frame !== previousTickFrameRef.current && prev !== nextSnapKey) {
        if (next.snappedToWall && !wasWallSnap) {
          triggerSFX('sfx:item-pick')
        } else {
          triggerSFX('sfx:grid-snap')
        }
        previousSnapRef.current = nextSnapKey
        previousTickFrameRef.current = frame
      }
      previousWasWallSnapRef.current = next.snappedToWall
    }

    const onGridMove = (event: GridEvent) => {
      const ts = event.nativeEvent?.timeStamp ?? -1
      if (ts === lastWallEventTime || wallOwnsPointer()) return
      if (usePlacementTyping.getState().isActive) return
      lastPlacementEventRef.current = event
      const anchor = resolveDraftAnchor()
      if (anchor) {
        publishPlacement(resolveActiveStretchPlacement(anchor, event), ts)
        return
      }
      publishPlacement(resolvePlacement(event), ts)
    }

    const onWallMove = (event: WallEvent) => {
      lastWallEventTime = event.nativeEvent?.timeStamp ?? -1
      if (event.node.parentId !== activeLevelId) return
      if (usePlacementTyping.getState().isActive) {
        event.stopPropagation()
        return
      }
      lastPlacementEventRef.current = event
      const anchor = resolveDraftAnchor()
      if (anchor) {
        markWallOwnedPointer()
        publishPlacement(resolveActiveStretchPlacement(anchor, event), lastWallEventTime)
        event.stopPropagation()
        return
      }
      const hit = islandModeRef.current ? null : wallHitFromWallEvent(event)
      const next = hit ? resolveWallHitPlacement(hit) : null
      if (next) {
        markWallOwnedPointer()
        publishPlacement(
          withPlacementValidity(next, isForcePlacementEvent(event)),
          lastWallEventTime,
        )
        event.stopPropagation()
        return
      }
      publishPlacement(resolvePlacement(event), lastWallEventTime)
    }

    const buildRunNodes = (position: [number, number, number], yaw: number) => {
      const patch = DEFAULT_PLACEMENT_PRESET.createPatch()
      const island = islandModeRef.current
      const cabinet = CabinetNode.parse({
        ...cabinetDefinition.defaults(),
        name: island ? 'Kitchen Island' : 'Modular Cabinet',
        position,
        rotation: yaw,
        parentId: activeLevelId,
        depth: patch.depth ?? cabinetDefinition.defaults().depth,
        carcassHeight: patch.carcassHeight ?? cabinetDefinition.defaults().carcassHeight,
        ...(island && {
          countertopBackOverhang: ISLAND_SEATING_OVERHANG,
          withFinishedBack: true,
        }),
      })
      const buildModule = (localX: number, width: number, index: number) =>
        CabinetModuleNode.parse({
          ...cabinetModuleDefinition.defaults(),
          ...patch,
          name: index === 0 ? (patch.name ?? 'Base Cabinet') : `Base Cabinet ${index + 1}`,
          parentId: cabinet.id,
          position: [localX, runModuleBaseY(cabinet.plinthHeight, cabinet.showPlinth), 0],
          width,
          depth: cabinet.depth,
          carcassHeight: cabinet.carcassHeight,
          plinthHeight: cabinet.plinthHeight,
          toeKickDepth: cabinet.toeKickDepth,
          countertopThickness: cabinet.countertopThickness,
          countertopOverhang: cabinet.countertopOverhang,
        })
      return { cabinet, buildModule }
    }

    const commitDraftSegment = (
      segment: DraftSegment,
    ): {
      endModule: ReturnType<typeof CabinetModuleNode.parse>
      run: CabinetNode
    } | null => {
      const sceneApi = createSceneApi(useScene)
      sceneApi.pauseHistory()
      try {
        if (!chainRunRef.current || !chainEndModuleRef.current || !chainCornerSideRef.current) {
          const { cabinet, buildModule } = buildRunNodes(
            segment.anchor.position,
            segment.anchor.yaw,
          )
          sceneApi.upsert(cabinet, activeLevelId)
          const modules = segment.stretch.modules.map((m, index) =>
            buildModule(m.x, m.width, index),
          )
          for (const module of modules) sceneApi.upsert(module, cabinet.id as AnyNodeId)
          const liveRun = sceneApi.get<CabinetNode>(cabinet.id as AnyNodeId) ?? cabinet
          sceneApi.update(
            liveRun.id as AnyNodeId,
            resolveSupportSlabPatch(liveRun, sceneApi.nodes()),
          )
          bumpCabinetRunsNearNewRun(cabinet.id as AnyNodeId)
          sceneApi.resumeHistory()
          return {
            endModule: modules[modules.length - 1]!,
            run: sceneApi.get<CabinetNode>(cabinet.id as AnyNodeId) ?? liveRun,
          }
        }

        const connectedId = addCornerRun({
          module: chainEndModuleRef.current,
          run: chainRunRef.current,
          sceneApi,
          side: chainCornerSideRef.current,
        })
        if (!connectedId) throw new Error('Unable to create cabinet corner')
        const connectedModule =
          sceneApi.get<ReturnType<typeof CabinetModuleNode.parse>>(connectedId)
        const nextRun = connectedModule?.parentId
          ? sceneApi.get<CabinetNode>(connectedModule.parentId as AnyNodeId)
          : null
        if (!connectedModule || !nextRun) throw new Error('Unable to resolve connected corner run')

        const plannedConnectedWidths = segment.stretch.modules
          .slice(1)
          .map((module) => module.width)
        let anchorModule = connectedModule
        for (const expectedWidth of plannedConnectedWidths.slice(1)) {
          const addedId = addCabinetModuleSide({
            anchorModule,
            run: nextRun,
            sceneApi,
            side: 'right',
          })
          if (!addedId) break
          let added = sceneApi.get<ReturnType<typeof CabinetModuleNode.parse>>(addedId)
          if (!added) break
          if (expectedWidth < added.width - 1e-4) {
            const leftEdge = added.position[0] - added.width / 2
            sceneApi.update(added.id as AnyNodeId, {
              width: expectedWidth,
              position: [leftEdge + expectedWidth / 2, added.position[1], added.position[2]],
            })
            added = sceneApi.get<ReturnType<typeof CabinetModuleNode.parse>>(addedId) ?? added
          }
          anchorModule = added
        }

        bumpCabinetRunsNearNewRun(nextRun.id as AnyNodeId)
        const liveNextRun = sceneApi.get<CabinetNode>(nextRun.id as AnyNodeId) ?? nextRun
        sceneApi.update(
          liveNextRun.id as AnyNodeId,
          resolveSupportSlabPatch(liveNextRun, sceneApi.nodes()),
        )
        const rootRun = chainRootRunRef.current
        if (rootRun) {
          const liveRoot = sceneApi.get<CabinetNode>(rootRun.id as AnyNodeId) ?? rootRun
          sceneApi.update(
            liveRoot.id as AnyNodeId,
            resolveSupportSlabPatch(liveRoot, sceneApi.nodes()),
          )
        }
        sceneApi.resumeHistory()
        return {
          endModule: anchorModule,
          run: sceneApi.get<CabinetNode>(nextRun.id as AnyNodeId) ?? nextRun,
        }
      } catch {
        sceneApi.restoreAll()
        sceneApi.resumeHistory()
        return null
      }
    }

    const resolveCurrentDraftSegment = (
      anchor: DraftAnchorState,
      event: FloorPlacementClickTriggerEvent,
    ): DraftSegment | null => {
      const currentPlacement =
        placementRef.current?.stretch && placementRef.current.stretchAnchor
          ? placementRef.current
          : resolveActiveStretchPlacement(anchor, event)
      if (!currentPlacement.valid || !currentPlacement.stretch || !currentPlacement.stretchAnchor) {
        return null
      }
      return { anchor: currentPlacement.stretchAnchor, stretch: currentPlacement.stretch }
    }

    const commitInsertion = (next: CabinetPlacement): AnyNodeId | null => {
      const insertionPreview = next.insertionPreview
      if (!insertionPreview) return null
      const sceneApi = createSceneApi(useScene)
      const run = sceneApi.get<CabinetNode>(insertionPreview.runId)
      if (!run) return null
      const module = cabinetModuleForRunInsertion(
        CabinetModuleNode.parse({
          ...previewNodeRef.current,
          position: insertionPreview.inserted.position,
          width: insertionPreview.inserted.width,
        }),
        run,
      )

      sceneApi.pauseHistory()
      try {
        const id = applyCabinetModuleInsertion({
          module,
          plan: insertionPreview,
          run,
          sceneApi,
        })
        if (!id) throw new Error('Unable to apply cabinet insertion')
        const liveRun = sceneApi.get<CabinetNode>(run.id as AnyNodeId)
        if (!liveRun) throw new Error('Unable to resolve inserted cabinet run')
        sceneApi.update(liveRun.id as AnyNodeId, resolveSupportSlabPatch(liveRun, sceneApi.nodes()))
        syncCornerRunsFromRunSources({
          run: sceneApi.get<CabinetNode>(liveRun.id as AnyNodeId) ?? liveRun,
          sceneApi,
        })
        const updatedRun = sceneApi.get<CabinetNode>(liveRun.id as AnyNodeId) ?? liveRun
        bumpCabinetRunsNear(
          sceneApi,
          [cabinetRunFootprint(updatedRun, sceneApi.nodes())],
          new Set([updatedRun.id as AnyNodeId]),
        )
        sceneApi.resumeHistory()
        return id
      } catch {
        sceneApi.restoreAll()
        sceneApi.resumeHistory()
        return null
      }
    }

    const updatePreviewSize = (field: 'width' | 'depth' | 'height', value: number) => {
      const nextPreviewNode = CabinetModuleNode.parse({
        ...previewNodeRef.current,
        carcassHeight: field === 'height' ? value : previewNodeRef.current.carcassHeight,
        depth: field === 'depth' ? value : previewNodeRef.current.depth,
        width: field === 'width' ? value : previewNodeRef.current.width,
      })
      previewNodeRef.current = nextPreviewNode
      setPreviewSize({
        depth: nextPreviewNode.depth,
        height: nextPreviewNode.carcassHeight,
        width: nextPreviewNode.width,
      })
      const nextPlacementDimensions = [
        nextPreviewNode.width,
        (nextPreviewNode.showPlinth ? nextPreviewNode.plinthHeight : 0) +
          nextPreviewNode.carcassHeight +
          (nextPreviewNode.withCountertop ? nextPreviewNode.countertopThickness : 0),
        nextPreviewNode.depth + (islandModeRef.current ? ISLAND_SEATING_OVERHANG : 0),
      ] as [number, number, number]
      placementDimensionsRef.current = nextPlacementDimensions
      const sideAndFrontOverhang = nextPreviewNode.withCountertop
        ? nextPreviewNode.countertopOverhang
        : 0
      placementSnapFootprintRef.current = {
        dimensions: [
          nextPreviewNode.width + sideAndFrontOverhang * 2,
          nextPlacementDimensions[1],
          nextPreviewNode.depth +
            sideAndFrontOverhang +
            (islandModeRef.current ? ISLAND_SEATING_OVERHANG : 0),
        ],
        offset: [
          0,
          (sideAndFrontOverhang - (islandModeRef.current ? ISLAND_SEATING_OVERHANG : 0)) / 2,
        ],
      }
    }

    const onDoubleClick = (event: FloorPlacementClickTriggerEvent) => {
      const anchor = resolveDraftAnchor()
      if (!anchor) return
      const segment = resolveCurrentDraftSegment(anchor, event)
      if (segment) {
        const committed = commitDraftSegment(segment)
        if (committed) {
          chainRunRef.current = committed.run
          chainEndModuleRef.current = committed.endModule
          chainCornerSideRef.current = cabinetStretchExitSide(segment.stretch)
          triggerSFX('sfx:item-place')
        }
      }
      clearDraft()
      stopPlacementCommitPropagation(event)
    }

    // Returns true when a cabinet (or insertion) was actually committed —
    // typed-entry uses this to decide whether to end the typing session.
    // `fromTypedCommit` marks the synthetic Enter-commit call, which manages
    // the typing session itself in its caller.
    const onClick = (
      event: FloorPlacementClickTriggerEvent,
      fromTypedCommit = false,
      rawOverride?: [number, number, number],
    ): boolean => {
      // A canvas click during typed entry ends the typing session. The typed
      // preview is what the user sees, so it is what the click commits —
      // keep `placementRef` (typed pose) and only suppress the pre-typing
      // restore the subscriber would otherwise run.
      if (!fromTypedCommit && usePlacementTyping.getState().isActive) {
        suppressTypedRestoreRef.current = true
        usePlacementTyping.getState().clear()
        typedWallHitRef.current = null
        typedCoordinateDefaultsRef.current = null
      }
      const anchor = resolveDraftAnchor()
      if (anchor) {
        const detail =
          ((event as { nativeEvent?: { detail?: number } }).nativeEvent?.detail as
            | number
            | undefined) ?? 1
        if (isCabinetContinuousFollowUpClick(detail)) {
          clearDraft()
          stopPlacementCommitPropagation(event)
          return false
        }
        const segment = resolveCurrentDraftSegment(anchor, event)
        if (!segment) {
          stopPlacementCommitPropagation(event)
          return false
        }
        const committed = commitDraftSegment(segment)
        if (!committed) {
          stopPlacementCommitPropagation(event)
          return false
        }
        chainRootRunRef.current ??= committed.run
        chainRunRef.current = committed.run
        chainEndModuleRef.current = committed.endModule
        chainCornerSideRef.current = cabinetStretchExitSide(segment.stretch)
        draftAnchorRef.current = createCabinetContinuousContinuation({
          anchor: segment.anchor,
          previewDepth: previewNodeRef.current.depth,
          previewWidth: previewNodeRef.current.width,
          stretch: segment.stretch,
        })
        publishPlacement(resolveActiveStretchPlacement(draftAnchorRef.current, event))
        triggerSFX('sfx:item-place')
        stopPlacementCommitPropagation(event)
        return true
      }
      const next = isForcePlacementEvent(event)
        ? resolvePlacement(event)
        : (placementRef.current ?? resolvePlacement(event))
      if (!next.valid) {
        stopPlacementCommitPropagation(event)
        return false
      }
      if (next.insertionPreview) {
        const insertedId = commitInsertion(next)
        if (!insertedId) {
          stopPlacementCommitPropagation(event)
          return false
        }
        useViewer.getState().setSelection({ selectedIds: [insertedId] })
        useEditor.getState().setMode('select')
        triggerSFX('sfx:item-place')
        useAlignmentGuides.getState().clear()
        usePlacementPreview.getState().clear()
        clearPlacementSurface()
        useFacingPose.getState().clear()
        stopPlacementCommitPropagation(event)
        return true
      }
      if (useEditor.getState().getContinuation('cabinet') === 'continuous') {
        draftSegmentsRef.current = []
        setDraftSegments([])
        chainRootRunRef.current = null
        chainRunRef.current = null
        chainEndModuleRef.current = null
        chainCornerSideRef.current = null
        draftAnchorRef.current = {
          position: next.position,
          yaw: next.yaw,
          snappedToWall: next.snappedToWall,
          wallId: next.wallId,
          wallLocalX: next.wallLocalX,
          wallSurfaceNormal: next.wallSurfaceNormal,
        }
        // Typed entry commits at the typed pose: seed the stretch preview
        // there (zero-length) instead of growing toward the stale cursor
        // position carried by the reused pointer event.
        publishPlacement(
          rawOverride
            ? resolveStretchedPlacement(draftAnchorRef.current, event, rawOverride)
            : resolveStretchedPlacement(draftAnchorRef.current, event),
        )
        triggerSFX('sfx:item-pick')
        stopPlacementCommitPropagation(event)
        return true
      }
      const { cabinet, buildModule } = buildRunNodes(next.position, next.yaw)
      const module = buildModule(0, previewNodeRef.current.width, 0)
      const nodes = { ...useScene.getState().nodes, [cabinet.id]: cabinet, [module.id]: module }
      const committedCabinet = CabinetNode.parse({
        ...cabinet,
        ...resolveSupportSlabPatch(cabinet, nodes),
      })
      useScene.getState().createNodes([
        { node: committedCabinet, parentId: activeLevelId },
        { node: module, parentId: committedCabinet.id },
      ])
      bumpCabinetRunsNearNewRun(committedCabinet.id as AnyNodeId)
      useViewer.getState().setSelection({ selectedIds: [module.id] })
      useEditor.getState().setMode('select')
      triggerSFX('sfx:item-place')
      useAlignmentGuides.getState().clear()
      usePlacementPreview.getState().clear()
      usePlacementTyping.getState().clear()
      typedWallHitRef.current = null
      typedCoordinateDefaultsRef.current = null
      clearPlacementSurface()
      useFacingPose.getState().clear()
      stopPlacementCommitPropagation(event)
      return true
    }

    const applyTypedPlacement = () => {
      const typing = usePlacementTyping.getState()
      const current = placementRef.current
      const hit = typedWallHitRef.current
      const defaults = typedCoordinateDefaultsRef.current
      if (!typing.isActive || !current || !hit || !defaults || current.stretch) return false

      const bareUnit = unit === 'imperial' ? 'in' : metricNotation === 'millimeters' ? 'mm' : 'm'
      const parseTypedValue = (raw: string, fallback: number) =>
        raw.trim() ? parseMeasurement(raw, { kind: 'length', unitId: 'm' }, { bareUnit }) : fallback
      const distance = parseTypedValue(typing.fields[0], defaults[0])
      const offset = parseTypedValue(typing.fields[1], defaults[1])
      if (distance == null || offset == null) return false

      const resolved = resolveCabinetTypedPlacementPosition({
        depth: previewNodeRef.current.depth,
        distance,
        hit,
        levelId: activeLevelId,
        nodes: useScene.getState().nodes,
        offset,
        position: current.position,
        width: previewNodeRef.current.width,
      })
      if (!resolved) return false

      // Typed entry targets an exact wall position. Drop any run-insertion
      // preview captured by the pointer path — otherwise Enter re-enters the
      // `onClick` insertion branch and commits the original run slot instead
      // of the typed coordinates.
      const {
        conflictIds: _conflictIds,
        insertionFailure: _insertionFailure,
        insertionPreview: _insertionPreview,
        valid: _valid,
        ...placementBase
      } = current
      const next = withPlacementValidity(
        {
          ...placementBase,
          position: resolved.position,
          wallLocalX: resolved.wallLocalX,
          yaw: resolved.yaw,
          wallSurfaceNormal: [Math.sin(resolved.yaw), 0, Math.cos(resolved.yaw)],
          snappedToWall: true,
        },
        false,
      )
      placementRef.current = next
      setPlacement(next)
      usePlacementTyping.getState().setProjectedPosition(next.position)
      publishFloorplanPreview(next)
      return true
    }

    const beginTypedPlacement = (key: string) => {
      const current = placementRef.current
      if (!current || current.stretch || !current.snappedToWall || !current.wallId) return false
      const nodes = useScene.getState().nodes
      const excludedWallIds = Object.values(nodes as Record<AnyNodeId, AnyNode>)
        .filter((node): node is WallNode => node.type === 'wall' && node.id !== current.wallId)
        .map((node) => node.id as AnyNodeId)
      const hit = findClosestCabinetWallInPlan({
        excludeIds: excludedWallIds,
        // The placement already knows its wall; a typed perpendicular offset
        // can push the cabinet center beyond the normal snap distance, so
        // don't cap the projection — just make sure the closest wall is the
        // one we're attached to.
        maxDistance: Infinity,
        nodes,
        parentLevelId: activeLevelId,
        planPoint: [current.position[0], current.position[2]],
      })
      if (!hit || hit.wall.id !== current.wallId) return false

      const coordinates = getCabinetPlacementCoordinates({
        depth: previewNodeRef.current.depth,
        hit,
        levelId: activeLevelId,
        nodes,
        position: current.position,
        width: previewNodeRef.current.width,
      })
      typedWallHitRef.current = hit
      typedCoordinateDefaultsRef.current = [coordinates.distance, coordinates.offset]
      suppressTypedRestoreRef.current = false
      usePlacementTyping
        .getState()
        .begin([
          formatLinearMeasurement(coordinates.distance, unit, metricNotation),
          formatLinearMeasurement(coordinates.offset, unit, metricNotation),
        ])
      usePlacementTyping.getState().append(key)
      return true
    }

    let handledSubmitRevision = usePlacementTyping.getState().submitRevision
    let previousTypingFields = usePlacementTyping.getState().fields
    let previousTypingField = usePlacementTyping.getState().activeField
    let previousTypingActive = usePlacementTyping.getState().isActive
    const unsubscribePlacementTyping = usePlacementTyping.subscribe(
      (state: PlacementTypingState) => {
        const fieldsChanged =
          state.fields[0] !== previousTypingFields[0] || state.fields[1] !== previousTypingFields[1]
        const activeFieldChanged = state.activeField !== previousTypingField
        const becameActive = state.isActive && !previousTypingActive
        const becameInactive = !state.isActive && previousTypingActive
        previousTypingFields = state.fields
        previousTypingField = state.activeField
        previousTypingActive = state.isActive

        if (state.isActive && (fieldsChanged || activeFieldChanged || becameActive)) {
          applyTypedPlacement()
        }
        // Any exit path (Escape in the HUD input, tool cancel, commit) must
        // drop the frozen wall hit — otherwise pointer moves keep feeding it
        // into `publishFloorplanPreview`. An uncommitted exit re-resolves
        // placement from the last pointer event so `placementRef` does not
        // stay stuck at the cancelled typed pose.
        if (becameInactive) {
          typedWallHitRef.current = null
          typedCoordinateDefaultsRef.current = null
          if (!suppressTypedRestoreRef.current && lastPlacementEventRef.current) {
            const event = lastPlacementEventRef.current
            const anchor = resolveDraftAnchor()
            const next = anchor
              ? resolveActiveStretchPlacement(anchor, event)
              : resolvePlacement(event)
            publishPlacement(next)
          }
          suppressTypedRestoreRef.current = false
        }
        if (state.submitRevision === handledSubmitRevision) return
        handledSubmitRevision = state.submitRevision
        if (!applyTypedPlacement()) return

        // Typed commits must honor the typed pose. Reusing the last pointer
        // event in continuous mode would replay a stale `altKey` into
        // `isForcePlacementEvent` and re-resolve placement from the old
        // cursor hit instead of the typed distance/offset. `node` is also
        // stripped: `stopPlacementCommitPropagation` installs a 300ms
        // window click swallow for real wall hits, which would eat the
        // user's next real click after this keyboard commit.
        const baseCommitEvent =
          useEditor.getState().getContinuation('cabinet') === 'continuous'
            ? (lastPlacementEventRef.current ??
              ({ nativeEvent: {} } as FloorPlacementClickTriggerEvent))
            : ({ nativeEvent: {} } as FloorPlacementClickTriggerEvent)
        const { node: _node, ...baseEventWithoutNode } = baseCommitEvent as NodeEvent<AnyNode>
        const commitEvent: FloorPlacementClickTriggerEvent = {
          ...baseEventWithoutNode,
          nativeEvent: { ...(baseCommitEvent.nativeEvent ?? {}), altKey: false },
        }
        // Seed any continuous-mode stretch at the typed position (zero-length
        // span), not the stale cursor carried by the reused pointer event.
        // Restore is suppressed: a successful commit owns the placement, and
        // `onClick`'s internal `clear()` would otherwise re-trigger the
        // restore logic below and revert the fresh stretch anchor.
        const typedPosition = placementRef.current?.position
        suppressTypedRestoreRef.current = true
        const committed = onClick(commitEvent, true, typedPosition)
        // Keep the typed values when the pose was rejected (e.g. collision)
        // so Enter does not silently wipe the session — the user can adjust
        // distance/offset and retry.
        if (!committed) {
          suppressTypedRestoreRef.current = false
          return
        }
        typedWallHitRef.current = null
        typedCoordinateDefaultsRef.current = null
        usePlacementTyping.getState().clear()
      },
    )

    const applyTypedDimension = () => {
      const editor = usePlacementPreview.getState()
      const current = placementRef.current
      if (!editor.activeDimensionId || !editor.dimensionInput || !current) {
        return false
      }
      const value = parseMeasurement(
        editor.dimensionInput,
        { kind: 'length', unitId: 'm' },
        {
          bareUnit: unit === 'imperial' ? 'in' : metricNotation === 'millimeters' ? 'mm' : 'm',
          system: unit === 'imperial' ? 'imperial' : 'metric',
        },
      )
      if (value === null) return false
      if (!current.stretch) {
        const sizeField =
          editor.activeDimensionId === 'cabinet-width'
            ? 'width'
            : editor.activeDimensionId === 'cabinet-depth'
              ? 'depth'
              : editor.activeDimensionId === 'cabinet-height'
                ? 'height'
                : null
        if (sizeField) {
          const limits =
            sizeField === 'width'
              ? { max: 3, min: 0.3 }
              : sizeField === 'depth'
                ? { max: 1.2, min: 0.3 }
                : { max: 1.4, min: 0.4 }
          const nextValue = Math.min(limits.max, Math.max(limits.min, value))
          updatePreviewSize(sizeField, nextValue)
          let position = current.position
          let wallLocalX = current.wallLocalX
          if (current.snappedToWall && current.wallId) {
            const resolvedWallPosition = resolveCabinetPlacementDimensionPosition({
              depth: previewNodeRef.current.depth,
              dimensionId: 'wall-clearance',
              levelId: activeLevelId,
              nodes: useScene.getState().nodes,
              position: current.position,
              rotation: current.yaw,
              wallId: current.wallId,
              value: 0,
              width: previewNodeRef.current.width,
            })
            if (resolvedWallPosition) {
              position = resolvedWallPosition.position
              wallLocalX = resolvedWallPosition.wallLocalX
            }
          }
          const { conflictIds: _conflictIds, valid: _valid, ...placementBase } = current
          const next = withPlacementValidity(
            {
              ...placementBase,
              position,
              ...(wallLocalX != null ? { wallLocalX } : {}),
            },
            false,
          )
          placementRef.current = next
          setPlacement(next)
          publishFloorplanPreview(next)
          editor.clearDimensionEditor()
          return true
        }
      }
      if (current.stretch && current.stretchAnchor) {
        const spanPosition = runLocalToPlan({ position: current.position, rotation: current.yaw }, [
          current.stretch.centerLocalX,
          0,
          0,
        ])
        const resolved = resolveCabinetPlacementDimensionPosition({
          depth: previewNodeRef.current.depth,
          dimensionId: editor.activeDimensionId,
          levelId: activeLevelId,
          nodes: useScene.getState().nodes,
          position: spanPosition,
          rotation: current.yaw,
          wallId: current.wallId,
          value,
          width: current.stretch.length,
        })
        if (!resolved) return false
        const anchorPosition = runLocalToPlan(
          { position: resolved.position, rotation: current.yaw },
          [-current.stretch.centerLocalX, 0, 0],
        )
        const nextAnchor = {
          ...current.stretchAnchor,
          position: anchorPosition,
          ...(current.wallId && current.wallLocalX != null
            ? { wallLocalX: resolved.wallLocalX - current.stretch.centerLocalX }
            : {}),
        }
        const validity = resolveStretchedValidity(nextAnchor, current.stretch, false)
        const next = {
          ...current,
          conflictIds: validity.conflictIds,
          position: anchorPosition,
          stretchAnchor: nextAnchor,
          valid: validity.valid,
          ...(current.wallId && current.wallLocalX != null
            ? { wallLocalX: resolved.wallLocalX - current.stretch.centerLocalX }
            : {}),
        }
        placementRef.current = next
        setPlacement(next)
        publishFloorplanPreview(next)
        editor.clearDimensionEditor()
        return true
      }
      const resolved = resolveCabinetPlacementDimensionPosition({
        depth: previewNodeRef.current.depth,
        dimensionId: editor.activeDimensionId,
        levelId: activeLevelId,
        nodes: useScene.getState().nodes,
        position: current.position,
        rotation: current.yaw,
        wallId: current.wallId,
        value,
        width: previewNodeRef.current.width,
      })
      if (!resolved) return false
      const { conflictIds: _conflictIds, valid: _valid, ...placementBase } = current
      const next = withPlacementValidity(
        {
          ...placementBase,
          position: resolved.position,
          wallLocalX: resolved.wallLocalX,
        },
        false,
      )
      placementRef.current = next
      setPlacement(next)
      publishFloorplanPreview(next)
      editor.clearDimensionEditor()
      return true
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const dimensionEditor = usePlacementPreview.getState()
      const placementTyping = usePlacementTyping.getState()
      if (placementTyping.isActive) {
        if (event.key === 'Tab') {
          placementTyping.toggleField()
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (event.key === 'Enter') {
          placementTyping.requestCommit()
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (event.key === 'Escape') {
          placementTyping.clear()
          typedWallHitRef.current = null
          typedCoordinateDefaultsRef.current = null
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (event.key === 'Backspace' || event.key === 'Delete') {
          if (event.key === 'Delete') placementTyping.setField(placementTyping.activeField, '')
          else placementTyping.backspace()
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (isPlacementTypingKey(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
          placementTyping.append(event.key)
          event.preventDefault()
          event.stopPropagation()
          return
        }
      }
      if (
        !dimensionEditor.activeDimensionId &&
        isPlacementTypingKey(event.key) &&
        /^[0-9.-]$/.test(event.key) &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        beginTypedPlacement(event.key)
      ) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (event.key === 'Tab' && dimensionEditor.dimensions.length > 0) {
        const currentIndex = dimensionEditor.dimensions.findIndex(
          (dimension) => dimension.id === dimensionEditor.activeDimensionId,
        )
        const direction = event.shiftKey ? -1 : 1
        const nextIndex =
          (currentIndex + direction + dimensionEditor.dimensions.length) %
          dimensionEditor.dimensions.length
        dimensionEditor.selectDimension(dimensionEditor.dimensions[nextIndex]!.id)
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (dimensionEditor.activeDimensionId && placementRef.current) {
        if (event.key === 'Enter') {
          applyTypedDimension()
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (event.key === 'Escape') {
          dimensionEditor.clearDimensionEditor()
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (event.key === 'Backspace' || event.key === 'Delete') {
          dimensionEditor.setDimensionInput(
            event.key === 'Delete'
              ? ''
              : dimensionEditor.dimensionInput.slice(
                  0,
                  Math.max(0, dimensionEditor.dimensionInput.length - 1),
                ),
          )
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (
          event.key.length === 1 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey &&
          /^[0-9a-zA-Z.'"+\- ]$/.test(event.key)
        ) {
          dimensionEditor.setDimensionInput(dimensionEditor.dimensionInput + event.key)
          event.preventDefault()
          event.stopPropagation()
          return
        }
      }
      if (event.key === 'i' || event.key === 'I') {
        event.preventDefault()
        event.stopPropagation()
        useCabinetPlacementType.getState().cycleType()
        triggerSFX('sfx:item-rotate')
        return
      }
      if (event.key !== 'r' && event.key !== 'R' && event.key !== 't' && event.key !== 'T') return
      event.preventDefault()
      event.stopPropagation()
      const steps = event.key === 't' || event.key === 'T' ? -1 : 1
      yawRef.current += steps * ROTATE_STEP_RAD
      setYaw(yawRef.current)
      if (
        placementRef.current &&
        !placementRef.current.snappedToWall &&
        !placementRef.current.stretch
      ) {
        const current = placementRef.current
        const { conflictIds: _conflictIds, valid: _valid, ...placementBase } = current
        const raw = lastRawPositionRef.current ?? current.position
        const position = resolveAlignedCabinetPosition({
          applyAlignmentSnap: isMagneticSnapActive(),
          position: resolveGridPosition(raw),
          yaw: yawRef.current,
        })
        const next = withPlacementValidity(
          { ...placementBase, position, yaw: yawRef.current },
          false,
        )
        placementRef.current = next
        setPlacement(next)
        publishFloorplanPreview(next)
      }
      triggerSFX('sfx:item-rotate')
    }

    const onCancel = () => {
      if (usePlacementTyping.getState().isActive) {
        markToolCancelConsumed()
        usePlacementTyping.getState().clear()
        typedWallHitRef.current = null
        typedCoordinateDefaultsRef.current = null
        return
      }
      if (!draftAnchorRef.current) return
      markToolCancelConsumed()
      clearDraft()
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('wall:move', onWallMove)
    emitter.on('tool:cancel', onCancel)
    const unsubscribeCabinetPlacementType = useCabinetPlacementType.subscribe((state) => {
      applyPlacementType(state.type)
    })
    const unsubscribePlacementClicks = subscribeFloorPlacementClicks(onClick)
    const unsubscribePlacementDoubleClicks = subscribeFloorPlacementDoubleClicks(onDoubleClick)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('wall:move', onWallMove)
      emitter.off('tool:cancel', onCancel)
      unsubscribeCabinetPlacementType()
      unsubscribePlacementTyping()
      unsubscribePlacementClicks()
      unsubscribePlacementDoubleClicks()
      window.removeEventListener('keydown', onKeyDown, true)
      draftAnchorRef.current = null
      usePlacementPreview.getState().clear()
      usePlacementTyping.getState().clear()
      typedWallHitRef.current = null
      typedCoordinateDefaultsRef.current = null
      clearPlacementSurface()
      useFacingPose.getState().clear()
      useAlignmentGuides.getState().clear()
      useCabinetPlacementStatus.getState().setBlocked(false)
    }
  }, [activeLevelId, metricNotation, publishFloorplanPreview, unit])

  if (!activeLevelId || !placement) return null
  const stretch = placement.stretch
  const draftModuleOffsets = draftSegments.map((segment, segmentIndex) =>
    draftSegments
      .slice(0, segmentIndex)
      .reduce((sum, previous) => sum + previous.stretch.modules.length, 0),
  )
  const activeStretchGhostOffset = draftSegments.reduce(
    (sum, segment) => sum + segment.stretch.modules.length,
    0,
  )
  const placementLabel = placement.insertionFailure
    ? 'No space in this run to insert this cabinet'
    : stretch
      ? placement.valid
        ? `${draftSegments.length + 1} leg${draftSegments.length + 1 === 1 ? '' : 's'} · ${stretch.modules.length} module${stretch.modules.length === 1 ? '' : 's'} · Click to continue · Double-click/Esc to finish`
        : null
      : !placement.valid
        ? null
        : placement.snappedToWall
          ? placement.snapReason === 'cabinet-edge'
            ? 'Edge snap'
            : placement.snapReason === 'corner'
              ? 'Corner snap'
              : 'Wall snap'
          : null
  const labelPosition = stretch
    ? runLocalToPlan({ position: placement.position, rotation: placement.yaw }, [
        stretch.centerLocalX,
        0,
        0,
      ])
    : placement.position
  const visualPosition = getFloorStackPreviewPosition({
    node: buildCabinetPlacementPreviewNode({
      island: islandMode,
      position: placement.position,
      previewModule: previewNode,
      yaw: placement.yaw,
    }),
    position: placement.position,
    rotation: placement.yaw,
    levelId: activeLevelId,
  })
  const placementRotationY = placement.snappedToWall || stretch ? placement.yaw : yaw
  const placementBoxDimensions: [number, number, number] = [
    stretch
      ? stretch.length + (previewNode.withCountertop ? previewNode.countertopOverhang * 2 : 0)
      : placementSnapFootprint.dimensions[0],
    placementSnapFootprint.dimensions[1],
    placementSnapFootprint.dimensions[2],
  ]
  const placementBoxPlanPosition = runLocalToPlan(
    { position: placement.position, rotation: placement.yaw },
    [stretch?.centerLocalX ?? 0, 0, placementSnapFootprint.offset[1]],
  )
  const placementBoxPosition: [number, number, number] = [
    placementBoxPlanPosition[0],
    visualPosition[1],
    placementBoxPlanPosition[2],
  ]

  return (
    <LevelOffsetGroup>
      {placement.guide && <WallSnapGuide blocked={!placement.valid} guide={placement.guide} />}
      <PlacementBox
        activeDimensionId={stretch ? null : activeDimensionId}
        dimensions={placementBoxDimensions}
        dimensionInput={dimensionInput}
        measurements={{ unit, metricNotation }}
        measurementValues={
          stretch ? undefined : [previewNode.width, previewNode.carcassHeight, previewNode.depth]
        }
        onDimensionSelect={
          stretch ? undefined : (id) => usePlacementPreview.getState().selectDimension(id)
        }
        position={placementBoxPosition}
        rotationY={placementRotationY}
        valid={placement.valid}
      />
      <PlacementDimensionGuides />
      {draftSegments.map((segment, segmentIndex) => (
        <group
          key={`draft-${segmentIndex}`}
          position={segment.anchor.position}
          rotation={[0, segment.anchor.yaw, 0]}
        >
          {segment.stretch.modules.map((module, index) => (
            <group
              key={`${segmentIndex}-${index}`}
              position={[module.x, 0, 0]}
              scale={[module.width / previewNode.width, 1, 1]}
            >
              <primitive object={ghostForIndex(draftModuleOffsets[segmentIndex]! + index)} />
            </group>
          ))}
        </group>
      ))}
      <group ref={activeGhostRef} position={visualPosition} rotation={[0, placementRotationY, 0]}>
        {placement.insertionPreview ? (
          <primitive object={insertionGhost as Group} />
        ) : stretch ? (
          stretch.modules.map((module, index) => (
            <group
              key={index}
              position={[module.x, 0, 0]}
              scale={[module.width / previewNode.width, 1, 1]}
            >
              <primitive object={ghostForIndex(activeStretchGhostOffset + index)} />
            </group>
          ))
        ) : (
          <primitive object={ghost as Group} />
        )}
      </group>
      {placement.insertionPreview ? (
        <group
          position={placement.insertionPreview.runPosition}
          rotation={[0, placement.insertionPreview.runYaw, 0]}
        >
          {placement.insertionPreview.modules.map((module, index) => (
            <group
              key={module.id}
              position={module.position}
              scale={[module.width / previewNode.width, 1, 1]}
            >
              <primitive object={insertionGhostForIndex(index + 1)} />
            </group>
          ))}
        </group>
      ) : null}
      {/* Render the typed-entry HUD from exactly one surface: the 2D pane
          owns it whenever it is visible (2d / split); the 3D Html mounts it
          only in 3d-only mode. Both instances share one store, so mounting
          both in split view would show two HUDs and steal the caret on
          Tab/activation. */}
      {viewMode === '3d' && typingActive && !stretch && placement.snappedToWall ? (
        <Html
          center
          position={[
            typingProjectedPosition?.[0] ?? placement.position[0],
            visualPosition[1] + previewNode.carcassHeight + 0.45,
            typingProjectedPosition?.[2] ?? placement.position[2],
          ]}
          style={{ pointerEvents: 'auto', userSelect: 'none' }}
          zIndexRange={[200, 0]}
        >
          <PlacementCoordinateInput />
        </Html>
      ) : null}
      {placementLabel ? (
        <Html
          center
          position={[
            labelPosition[0],
            previewNode.plinthHeight + previewNode.carcassHeight + 0.35,
            labelPosition[2],
          ]}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
          zIndexRange={[100, 0]}
        >
          <div
            className={`flex items-center gap-2 whitespace-nowrap rounded-full border px-4 py-1.5 text-xs shadow-sm backdrop-blur ${
              placement.valid
                ? 'border-border/60 bg-background/90'
                : 'border-red-400/60 bg-red-950/85'
            }`}
          >
            <span className="font-medium text-foreground">{placementLabel}</span>
          </div>
        </Html>
      ) : null}
    </LevelOffsetGroup>
  )
}

export default CabinetTool
