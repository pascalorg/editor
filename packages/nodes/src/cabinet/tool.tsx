'use client'

import {
  type AnyNodeId,
  CabinetModuleNode,
  CabinetNode,
  createSceneApi,
  emitter,
  type GridEvent,
  getFloorPlacedFootprints,
  getWallThickness,
  isCurvedWall,
  nodeRegistry,
  spatialGridManager,
  useScene,
  type WallEvent,
  type WallNode,
} from '@pascal-app/core'
import {
  getSideFromNormal,
  isGridSnapActive,
  isMagneticSnapActive,
  isValidWallSideFace,
  markToolCancelConsumed,
  triggerSFX,
  useEditor,
  usePlacementPreview,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type Group, Mesh } from 'three'
import {
  type FloorPlacementClickTriggerEvent,
  getLevelLocalSnappedPosition,
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
} from '../shared/floor-placement'
import { LevelOffsetGroup } from '../shared/level-offset-group'
import { findClosestWallInPlan, type WallHit } from '../shared/wall-attach-target'
import {
  cabinetStretchEndLocalX,
  cabinetStretchExitSide,
  isForcePlacementEvent,
  planCabinetContinuousStretch,
  resolveCabinetContinuousValidity,
  type CabinetStretchPreview,
  type StretchAnchor,
} from './continuous-placement'
import {
  bumpCabinetRunsNear,
  cabinetDefinition,
  cabinetModuleDefinition,
  cabinetRunFootprint,
} from './definition'
import { buildCabinetGeometry } from './geometry'
import { cabinetPresetById } from './presets'
import { runLocalToPlan } from './run-layout'
import { addCabinetModuleSide, addCornerRun } from './run-ops'
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
  guide?: CabinetWallSnapPlacement['guide']
  snapReason?: CabinetWallSnapPlacement['snapReason']
  // Rubber-band state: anchor is `position`/`yaw`; modules are run-local
  // center offsets filling the anchor→cursor span.
  stretch?: CabinetStretchPreview
}

type DraftSegment = {
  anchor: StretchAnchor
  stretch: CabinetStretchPreview
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

function snap(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

function isFreePlacementEvent(event: FloorPlacementClickTriggerEvent): boolean {
  const native = (event as { nativeEvent?: { altKey?: boolean } }).nativeEvent
  return Boolean(native?.altKey)
}

// Wall snap is an attachment behavior (like door/window wall placement), not a
// magnetic alignment guide — active in every snapping mode except Off.
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
  const [placement, setPlacement] = useState<CabinetPlacement | null>(null)
  const [draftSegments, setDraftSegments] = useState<DraftSegment[]>([])
  const [yaw, setYaw] = useState(0)
  const [islandMode, setIslandMode] = useState(false)
  const yawRef = useRef(0)
  const islandModeRef = useRef(false)
  const placementRef = useRef<CabinetPlacement | null>(null)
  const draftSegmentsRef = useRef<DraftSegment[]>([])
  const previousSnapRef = useRef<[number, number] | null>(null)
  const previousWasWallSnapRef = useRef(false)
  const draftAnchorRef = useRef<StretchAnchor | null>(null)

  const previewNode = useMemo(
    () =>
      CabinetModuleNode.parse({
        ...cabinetModuleDefinition.defaults(),
        ...DEFAULT_PLACEMENT_PRESET.createPatch(),
      }),
    [],
  )
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

  useEffect(() => {
    if (!activeLevelId) return
    placementRef.current = null
    draftSegmentsRef.current = []
    setDraftSegments([])
    previousSnapRef.current = null
    previousWasWallSnapRef.current = false
    draftAnchorRef.current = null
    let lastWallEventTime = -1

    const clearDraft = () => {
      draftSegmentsRef.current = []
      setDraftSegments([])
      draftAnchorRef.current = null
      placementRef.current = null
      setPlacement(null)
      usePlacementPreview.getState().clear()
    }

    // The segmented draft survives only while continuous mode is on.
    const resolveDraftAnchor = (): StretchAnchor | null => {
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
      return [snap(raw[0], step), 0, snap(raw[2], step)]
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
          : spatialGridManager.canPlaceOnFloor(
              activeLevelId,
              next.position,
              placementDimensions,
              [0, next.yaw, 0],
            )
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

      return {
        conflictIds: [],
        guide: wallPlacement.guide,
        position: wallPlacement.position,
        snapReason: wallPlacement.snapReason,
        valid: true,
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
      const freePlacement = isFreePlacementEvent(event)
      const wallPlacement =
        freePlacement || islandModeRef.current ? null : resolveWallPlacement(raw)
      if (wallPlacement) return withPlacementValidity(wallPlacement, freePlacement)
      return withPlacementValidity(
        {
          position: resolveGridPosition(raw, freePlacement),
          yaw: yawRef.current,
          snappedToWall: false,
        },
        freePlacement,
      )
    }

    // While stretching, the run is pinned at the anchored first module and
    // grows toward the cursor — the far end tracks the pointer smoothly.
    const resolveStretchedPlacement = (
      anchor: StretchAnchor,
      event: FloorPlacementClickTriggerEvent,
    ): CabinetPlacement => {
      const raw = resolveRawPosition(event)
      const stretch = planCabinetContinuousStretch({
        anchor,
        previewWidth: previewNode.width,
        rawPlanPosition: raw,
      })
      const spanCenter = runLocalToPlan(
        { position: anchor.position, rotation: anchor.yaw },
        [stretch.centerLocalX, 0, 0],
      )
      const result = resolveCabinetContinuousValidity(
        spatialGridManager.canPlaceOnFloor(
          activeLevelId,
          spanCenter,
          [stretch.length, placementDimensions[1], placementDimensions[2]],
          [0, anchor.yaw, 0],
        ),
        isForcePlacementEvent(event),
      )
      return {
        position: anchor.position,
        yaw: anchor.yaw,
        snappedToWall: anchor.snappedToWall,
        valid: result.valid,
        conflictIds: result.conflictIds,
        stretch,
      }
    }

    const nextOrthogonalAnchor = (segment: DraftSegment): StretchAnchor => {
      const exitSide = cabinetStretchExitSide(segment.stretch)
      const sourceAxis: [number, number] = [
        Math.cos(segment.anchor.yaw),
        -Math.sin(segment.anchor.yaw),
      ]
      const corner = runLocalToPlan(
        { position: segment.anchor.position, rotation: segment.anchor.yaw },
        [cabinetStretchEndLocalX(segment.stretch, previewNode.width), 0, -previewNode.depth / 2],
      )
      const sign = exitSide === 'right' ? 1 : -1
      const shiftedCorner: [number, number] = [
        corner[0] + sign * previewNode.depth * sourceAxis[0],
        corner[2] + sign * previewNode.depth * sourceAxis[1],
      ]
      const yaw =
        exitSide === 'right' ? segment.anchor.yaw - Math.PI / 2 : segment.anchor.yaw + Math.PI / 2
      const position = runLocalToPlan(
        { position: [shiftedCorner[0], segment.anchor.position[1], shiftedCorner[1]], rotation: yaw },
        [previewNode.depth / 2, 0, previewNode.depth / 2],
      )
      return {
        position,
        yaw,
        snappedToWall: false,
        forcedDirection: 1,
        leadingWidth: previewNode.depth,
      }
    }

    const publishPlacement = (next: CabinetPlacement) => {
      placementRef.current = next
      setPlacement(next)
      publishFloorplanPreview(next)
      const prev = previousSnapRef.current
      const wasWallSnap = previousWasWallSnapRef.current
      if (!prev || prev[0] !== next.position[0] || prev[1] !== next.position[2]) {
        if (next.snappedToWall && !wasWallSnap) {
          triggerSFX('sfx:item-pick')
        } else {
          triggerSFX('sfx:grid-snap')
        }
        previousSnapRef.current = [next.position[0], next.position[2]]
      }
      previousWasWallSnapRef.current = next.snappedToWall
    }

    const onGridMove = (event: GridEvent) => {
      const ts = event.nativeEvent?.timeStamp ?? -1
      if (ts === lastWallEventTime) return
      const anchor = resolveDraftAnchor()
      if (anchor) {
        publishPlacement(resolveStretchedPlacement(anchor, event))
        return
      }
      publishPlacement(resolvePlacement(event))
    }

    const onWallMove = (event: WallEvent) => {
      lastWallEventTime = event.nativeEvent?.timeStamp ?? -1
      if (event.node.parentId !== activeLevelId) return
      const anchor = resolveDraftAnchor()
      if (anchor) {
        publishPlacement(resolveStretchedPlacement(anchor, event))
        event.stopPropagation()
        return
      }
      const hit = islandModeRef.current ? null : wallHitFromWallEvent(event)
      const next = hit ? resolveWallHitPlacement(hit) : null
      if (next) {
        publishPlacement(withPlacementValidity(next, false))
        event.stopPropagation()
        return
      }
      publishPlacement(resolvePlacement(event))
    }

    const buildRunNodes = (position: [number, number, number], yaw: number) => {
      const patch = DEFAULT_PLACEMENT_PRESET.createPatch()
      const island = islandModeRef.current
      const cabinet = CabinetNode.parse({
        ...cabinetDefinition.defaults(),
        name: island ? 'Kitchen Island' : 'Modular Cabinet',
        position,
        rotation: yaw,
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

    const commitDraftSegments = (segments: DraftSegment[]): AnyNodeId | null => {
      if (segments.length === 0) return null
      const sceneApi = createSceneApi(useScene)
      sceneApi.pauseHistory()
      try {
        const first = segments[0]!
        const { cabinet, buildModule } = buildRunNodes(first.anchor.position, first.anchor.yaw)
        sceneApi.upsert(cabinet, activeLevelId)
        const firstModules = first.stretch.modules.map((m, index) => buildModule(m.x, m.width, index))
        for (const module of firstModules) sceneApi.upsert(module, cabinet.id as AnyNodeId)
        bumpCabinetRunsNearNewRun(cabinet.id as AnyNodeId)

        let currentRun = sceneApi.get<CabinetNode>(cabinet.id as AnyNodeId) ?? cabinet
        let currentEndModule = firstModules[firstModules.length - 1]!

        for (let index = 1; index < segments.length; index += 1) {
          const previous = segments[index - 1]!
          const segment = segments[index]!
          const connectedId = addCornerRun({
            module: currentEndModule,
            run: currentRun,
            sceneApi,
            side: cabinetStretchExitSide(previous.stretch),
          })
          if (!connectedId) throw new Error('Unable to create cabinet corner')
          const connectedModule = sceneApi.get<ReturnType<typeof CabinetModuleNode.parse>>(connectedId)
          const nextRun = connectedModule?.parentId
            ? sceneApi.get<CabinetNode>(connectedModule.parentId as AnyNodeId)
            : null
          if (!connectedModule || !nextRun) throw new Error('Unable to resolve connected corner run')

          let accumulatedWidth = connectedModule.width
          let anchorModule = connectedModule
          while (accumulatedWidth + 1e-4 < segment.stretch.length) {
            const addedId = addCabinetModuleSide({
              anchorModule,
              run: nextRun,
              sceneApi,
              side: 'right',
            })
            if (!addedId) break
            const added = sceneApi.get<ReturnType<typeof CabinetModuleNode.parse>>(addedId)
            if (!added) break
            accumulatedWidth += added.width
            anchorModule = added
          }

          bumpCabinetRunsNearNewRun(nextRun.id as AnyNodeId)
          currentRun = sceneApi.get<CabinetNode>(nextRun.id as AnyNodeId) ?? nextRun
          currentEndModule = anchorModule
        }

        sceneApi.resumeHistory()
        return currentRun.id as AnyNodeId
      } catch {
        sceneApi.restoreAll()
        sceneApi.resumeHistory()
        return null
      }
    }

    const finishDraft = (segments: DraftSegment[], event: FloorPlacementClickTriggerEvent) => {
      const selectedId = commitDraftSegments(segments)
      if (!selectedId) {
        stopPlacementCommitPropagation(event)
        return
      }
      useViewer.getState().setSelection({ selectedIds: [selectedId] })
      triggerSFX('sfx:item-place')
      clearDraft()
      stopPlacementCommitPropagation(event)
    }

    const onClick = (event: FloorPlacementClickTriggerEvent) => {
      const anchor = resolveDraftAnchor()
      if (anchor) {
        const next = resolveStretchedPlacement(anchor, event)
        if (!next.valid || !next.stretch) {
          stopPlacementCommitPropagation(event)
          return
        }
        const segment = { anchor, stretch: next.stretch }
        const segments = [...draftSegmentsRef.current, segment]
        const detail =
          ((event as { nativeEvent?: { detail?: number } }).nativeEvent?.detail as number | undefined) ??
          1
        if (detail >= 2) {
          finishDraft(segments, event)
          return
        }
        draftSegmentsRef.current = segments
        setDraftSegments(segments)
        draftAnchorRef.current = nextOrthogonalAnchor(segment)
        publishPlacement(resolveStretchedPlacement(draftAnchorRef.current, event))
        triggerSFX('sfx:item-pick')
        stopPlacementCommitPropagation(event)
        return
      }
      const next = isFreePlacementEvent(event)
        ? resolvePlacement(event)
        : (placementRef.current ?? resolvePlacement(event))
      if (!next.valid) {
        stopPlacementCommitPropagation(event)
        return
      }
      if (useEditor.getState().getContinuation('cabinet') === 'continuous') {
        draftSegmentsRef.current = []
        setDraftSegments([])
        draftAnchorRef.current = {
          position: next.position,
          yaw: next.yaw,
          snappedToWall: next.snappedToWall,
        }
        publishPlacement(resolveStretchedPlacement(draftAnchorRef.current, event))
        triggerSFX('sfx:item-pick')
        stopPlacementCommitPropagation(event)
        return
      }
      const { cabinet, buildModule } = buildRunNodes(next.position, next.yaw)
      const module = buildModule(0, previewNode.width, 0)
      useScene.getState().createNodes([
        { node: cabinet, parentId: activeLevelId },
        { node: module, parentId: cabinet.id },
      ])
      bumpCabinetRunsNearNewRun(cabinet.id as AnyNodeId)
      useViewer.getState().setSelection({ selectedIds: [module.id] })
      triggerSFX('sfx:item-place')
      usePlacementPreview.getState().clear()
      stopPlacementCommitPropagation(event)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (event.key === 'i' || event.key === 'I') {
        event.preventDefault()
        event.stopPropagation()
        clearDraft()
        islandModeRef.current = !islandModeRef.current
        setIslandMode(islandModeRef.current)
        // Drop a stale wall-snapped preview so the next move re-resolves free.
        if (islandModeRef.current && placementRef.current?.snappedToWall) {
          placementRef.current = null
          setPlacement(null)
          usePlacementPreview.getState().clear()
        } else if (placementRef.current) {
          publishFloorplanPreview(placementRef.current, islandModeRef.current)
        }
        triggerSFX('sfx:item-rotate')
        return
      }
      if (event.key !== 'r' && event.key !== 'R' && event.key !== 't' && event.key !== 'T') return
      event.preventDefault()
      event.stopPropagation()
      const steps = event.key === 't' || event.key === 'T' || event.shiftKey ? -1 : 1
      yawRef.current += steps * ROTATE_STEP_RAD
      setYaw(yawRef.current)
      if (
        placementRef.current &&
        !placementRef.current.snappedToWall &&
        !placementRef.current.stretch
      ) {
        const next = { ...placementRef.current, yaw: yawRef.current }
        placementRef.current = next
        setPlacement(next)
        publishFloorplanPreview(next)
      }
      triggerSFX('sfx:item-rotate')
    }

    const onCancel = () => {
      if (!draftAnchorRef.current) return
      markToolCancelConsumed()
      const currentStretch = placementRef.current?.valid ? placementRef.current.stretch : undefined
      const segments = [
        ...draftSegmentsRef.current,
        ...(currentStretch ? [{ anchor: draftAnchorRef.current, stretch: currentStretch }] : []),
      ]
      const selectedId = commitDraftSegments(segments)
      if (selectedId) {
        useViewer.getState().setSelection({ selectedIds: [selectedId] })
        triggerSFX('sfx:item-place')
      }
      clearDraft()
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('wall:move', onWallMove)
    emitter.on('tool:cancel', onCancel)
    const unsubscribePlacementClicks = subscribeFloorPlacementClicks(onClick)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('wall:move', onWallMove)
      emitter.off('tool:cancel', onCancel)
      unsubscribePlacementClicks()
      window.removeEventListener('keydown', onKeyDown, true)
      draftAnchorRef.current = null
      usePlacementPreview.getState().clear()
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
      : 'Blocked: Alt to force'
    : !placement.valid
      ? 'Blocked: Alt to force'
      : placement.snappedToWall
        ? placement.snapReason === 'cabinet-edge'
          ? 'Edge snap'
          : placement.snapReason === 'corner'
            ? 'Corner snap'
            : 'Wall snap'
        : islandMode
          ? 'Island · R/T rotate'
          : 'R/T rotate'
  const labelPosition = stretch
    ? runLocalToPlan({ position: placement.position, rotation: placement.yaw }, [
        stretch.centerLocalX,
        0,
        0,
      ])
    : placement.position

  return (
    <LevelOffsetGroup>
      {placement.guide && <WallSnapGuide blocked={!placement.valid} guide={placement.guide} />}
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
      <group
        position={placement.position}
        rotation={[0, placement.snappedToWall || stretch ? placement.yaw : yaw, 0]}
      >
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
        {!placement.valid && (
          <mesh position={[stretch ? stretch.centerLocalX : 0, placementDimensions[1] / 2, 0]}>
            <boxGeometry
              args={[
                stretch ? stretch.length : placementDimensions[0],
                placementDimensions[1],
                placementDimensions[2],
              ]}
            />
            <meshBasicMaterial color="#ef4444" opacity={0.16} transparent wireframe />
          </mesh>
        )}
      </group>
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
    </LevelOffsetGroup>
  )
}

export default CabinetTool
