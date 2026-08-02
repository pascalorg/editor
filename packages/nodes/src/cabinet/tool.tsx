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
  getFloorStackPreviewPosition,
  getSideFromNormal,
  isAlignmentGuideActive,
  isGridSnapActive,
  isMagneticSnapActive,
  isValidWallSideFace,
  markToolCancelConsumed,
  movementSfxStepKey,
  PlacementBox,
  publishPlacementSurface,
  triggerSFX,
  useAlignmentGuides,
  useEditor,
  useFacingPose,
  usePlacementPreview,
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
import { findClosestWallInPlan, type WallHit } from '../shared/wall-attach-target'
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
import { resolveCabinetGridPosition } from './placement-snap'
import useCabinetPlacementStatus from './placement-status'
import useCabinetPlacementType from './placement-type'
import { cabinetPresetById } from './presets'
import { runLocalToPlan } from './run-layout'
import { addCabinetModuleSide, addCornerRun, previewCornerAdditionLayout } from './run-ops'
import {
  type CabinetWallSnapPlacement,
  collectCabinetWallSnapNeighbors,
  resolveCabinetWallFaceOffset,
  resolveCabinetWallSnapPlacement,
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
  wallLocalX?: number
  guide?: CabinetWallSnapPlacement['guide']
  snapReason?: CabinetWallSnapPlacement['snapReason']
  wallSurfaceNormal?: [number, number, number]
  // Rubber-band state: anchor is `position`/`yaw`; modules are run-local
  // center offsets filling the anchor→cursor span.
  stretch?: CabinetStretchPreview
  stretchAnchor?: StretchAnchor
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
  const activeGhostRef = useRef<Group | null>(null)
  const surfacePointRef = useRef(new Vector3())
  const surfaceNormalRef = useRef(new Vector3(0, 1, 0))
  const surfaceQuatRef = useRef(new Quaternion())
  const surfaceForwardRef = useRef(new Vector3(0, 0, 1))
  const facingPointRef = useRef(new Vector3())

  const previewNode = useMemo(() => {
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

  const publishFloorplanPreview = useCallback(
    (next: CabinetPlacement, island = islandModeRef.current) => {
      const stretch = next.stretch
      const node = buildCabinetPlacementPreviewNode({
        island,
        position: stretch
          ? runLocalToPlan({ position: next.position, rotation: next.yaw }, [
              stretch.centerLocalX,
              0,
              0,
            ])
          : next.position,
        previewModule: previewNode,
        yaw: next.yaw,
      })
      // A stretched span can exceed the schema's width cap — override post-parse.
      usePlacementPreview.getState().set(stretch ? { ...node, width: stretch.length } : node)
    },
    [previewNode],
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
    let alignmentCandidates = collectAlignmentAnchors(
      useScene.getState().nodes,
      previewNode.id,
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
      return resolveCabinetGridPosition({
        raw,
        dimensions: placementDimensions,
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
        previewModule: previewNode,
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
      if (bypassCollision) return { ...next, conflictIds: [], valid: true }
      const floorPlaced = nodeRegistry.get(previewNode.type)?.capabilities?.floorPlaced
      const effectiveNode = {
        ...previewNode,
        position: next.position,
        rotation: next.yaw,
      }
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
          ? spatialGridManager.canPlaceOnFloorFootprints(activeLevelId, footprints)
          : spatialGridManager.canPlaceOnFloor(activeLevelId, next.position, placementDimensions, [
              0,
              next.yaw,
              0,
            ])
      return { ...next, conflictIds: result.conflictIds, valid: result.valid }
    }

    const resolveWallHitPlacement = (hit: WallHit): CabinetPlacement | null => {
      if (!isWallSnapEligible()) return null
      const nodes = useScene.getState().nodes
      const neighbors = collectCabinetWallSnapNeighbors({
        hit,
        nodes,
        parentLevelId: activeLevelId as AnyNodeId,
        width: previewNode.width,
      })
      const faceOffset = resolveCabinetWallFaceOffset({
        hit,
        nodes,
        parentLevelId: activeLevelId as AnyNodeId,
      })

      const wallPlacement = resolveCabinetWallSnapPlacement({
        depth: previewNode.depth,
        faceOffset,
        gridStep: isGridSnapActive() ? useEditor.getState().gridSnapStep : 0,
        hit,
        neighbors,
        width: previewNode.width,
      })
      if (!wallPlacement) return null
      const wallSurfaceNormal = [Math.sin(wallPlacement.yaw), 0, Math.cos(wallPlacement.yaw)] as [
        number,
        number,
        number,
      ]

      return {
        conflictIds: [],
        guide: wallPlacement.guide,
        position: wallPlacement.position,
        snapReason: wallPlacement.snapReason,
        valid: true,
        wallLocalX: wallPlacement.localX,
        wallSurfaceNormal,
        yaw: wallPlacement.yaw,
        snappedToWall: true,
      }
    }

    const resolveWallPlacement = (raw: [number, number, number]): CabinetPlacement | null => {
      if (!isWallSnapEligible()) return null
      const nodes = useScene.getState().nodes
      const hit = findClosestWallInPlan([raw[0], raw[2]], nodes, activeLevelId as AnyNodeId)
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

    // While stretching, the run is pinned at the anchored first module and
    // grows toward the cursor — the far end tracks the pointer smoothly.
    const resolveStretchedPlacement = (
      anchor: StretchAnchor,
      event: FloorPlacementClickTriggerEvent,
    ): CabinetPlacement => {
      useAlignmentGuides.getState().clear()
      const raw = resolveRawPosition(event)
      let stretch = planCabinetContinuousStretch({
        anchor,
        previewWidth: previewNode.width,
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
            wallSurfaceNormal: anchor.wallSurfaceNormal,
            valid: false,
            conflictIds: [],
            stretch,
            stretchAnchor: anchor,
          }
        }
        stretch = stretchWithAdjustedConnectedWidth(stretch, preview.connectedWidth)
      }
      const spanCenter = runLocalToPlan({ position: anchor.position, rotation: anchor.yaw }, [
        stretch.centerLocalX,
        0,
        0,
      ])
      const ignoreIds = chainRootRunRef.current
        ? [chainRootRunRef.current.id as AnyNodeId]
        : undefined
      const result = resolveCabinetContinuousValidity(
        spatialGridManager.canPlaceOnFloor(
          activeLevelId,
          spanCenter,
          [stretch.length, placementDimensions[1], placementDimensions[2]],
          [0, anchor.yaw, 0],
          ignoreIds,
        ),
        isForcePlacementEvent(event),
      )
      return {
        position: anchor.position,
        yaw: anchor.yaw,
        snappedToWall: anchor.snappedToWall,
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

    const onClick = (event: FloorPlacementClickTriggerEvent) => {
      const anchor = resolveDraftAnchor()
      if (anchor) {
        const detail =
          ((event as { nativeEvent?: { detail?: number } }).nativeEvent?.detail as
            | number
            | undefined) ?? 1
        if (isCabinetContinuousFollowUpClick(detail)) {
          clearDraft()
          stopPlacementCommitPropagation(event)
          return
        }
        const segment = resolveCurrentDraftSegment(anchor, event)
        if (!segment) {
          stopPlacementCommitPropagation(event)
          return
        }
        const committed = commitDraftSegment(segment)
        if (!committed) {
          stopPlacementCommitPropagation(event)
          return
        }
        chainRootRunRef.current ??= committed.run
        chainRunRef.current = committed.run
        chainEndModuleRef.current = committed.endModule
        chainCornerSideRef.current = cabinetStretchExitSide(segment.stretch)
        draftAnchorRef.current = createCabinetContinuousContinuation({
          anchor: segment.anchor,
          previewDepth: previewNode.depth,
          previewWidth: previewNode.width,
          stretch: segment.stretch,
        })
        publishPlacement(resolveActiveStretchPlacement(draftAnchorRef.current, event))
        triggerSFX('sfx:item-place')
        stopPlacementCommitPropagation(event)
        return
      }
      const next = isForcePlacementEvent(event)
        ? resolvePlacement(event)
        : (placementRef.current ?? resolvePlacement(event))
      if (!next.valid) {
        stopPlacementCommitPropagation(event)
        return
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
          wallSurfaceNormal: next.wallSurfaceNormal,
        }
        publishPlacement(resolveStretchedPlacement(draftAnchorRef.current, event))
        triggerSFX('sfx:item-pick')
        stopPlacementCommitPropagation(event)
        return
      }
      const { cabinet, buildModule } = buildRunNodes(next.position, next.yaw)
      const module = buildModule(0, previewNode.width, 0)
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
      clearPlacementSurface()
      useFacingPose.getState().clear()
      stopPlacementCommitPropagation(event)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
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
          position: resolveCabinetGridPosition({
            raw,
            dimensions: placementDimensions,
            yaw: yawRef.current,
            step: isGridSnapActive() ? useEditor.getState().gridSnapStep : 0,
          }),
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
      unsubscribePlacementClicks()
      unsubscribePlacementDoubleClicks()
      window.removeEventListener('keydown', onKeyDown, true)
      draftAnchorRef.current = null
      usePlacementPreview.getState().clear()
      clearPlacementSurface()
      useFacingPose.getState().clear()
      useAlignmentGuides.getState().clear()
      useCabinetPlacementStatus.getState().setBlocked(false)
    }
  }, [activeLevelId, placementDimensions, previewNode, publishFloorplanPreview])

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
  const placementLabel = stretch
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
    stretch ? stretch.length : placementDimensions[0],
    placementDimensions[1],
    placementDimensions[2],
  ]
  const placementBoxPlanPosition = stretch
    ? runLocalToPlan({ position: placement.position, rotation: placement.yaw }, [
        stretch.centerLocalX,
        0,
        0,
      ])
    : placement.position
  const placementBoxPosition: [number, number, number] = [
    placementBoxPlanPosition[0],
    visualPosition[1],
    placementBoxPlanPosition[2],
  ]

  return (
    <LevelOffsetGroup>
      {placement.guide && <WallSnapGuide blocked={!placement.valid} guide={placement.guide} />}
      <PlacementBox
        dimensions={placementBoxDimensions}
        measurements={{ unit }}
        position={placementBoxPosition}
        rotationY={placementRotationY}
        valid={placement.valid}
      />
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
        {stretch ? (
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
