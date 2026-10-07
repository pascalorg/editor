import {
  type AnyNode,
  collectAlignmentAnchors,
  createSizedStairFlight,
  createSurfaceOpeningPreviewController,
  DEFAULT_LEVEL_HEIGHT,
  emitter,
  type GridEvent,
  getFloorStackedPosition,
  getLevelFloorToFloorHeight,
  type LevelNode,
  movingAlignmentAnchors,
  type NodeEvent,
  planStairCreation,
  planStairSizing,
  resolveAlignment,
  resolveFrozenFloorPlacementPatch,
  resolveStairSurfaceSnap,
  resolveSupportSlabPatch,
  StairNode,
  type StairSegmentNode,
  type StairSurfaceSnap,
  syncAutoStairOpenings,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { EDITOR_LAYER } from '../../../lib/constants'
import { sfxEmitter } from '../../../lib/sfx-bus'
import {
  resolveStairDestinationLevel,
  resolveStairPlacementLevelId,
} from '../../../lib/stair-levels'

import useAlignmentGuides from '../../../store/use-alignment-guides'
import useEditor, {
  isAlignmentGuideActive,
  isGridSnapActive,
  isMagneticSnapActive,
} from '../../../store/use-editor'

import useFacingPose from '../../../store/use-facing-pose'
import { useStairBuildPreview } from '../../../store/use-stair-build-preview'
import { CursorSphere } from '../shared/cursor-sphere'
import { getFloorStackPreviewPosition } from '../shared/floor-stack-preview'
import {
  type PointerSupportSurface,
  resolvePointerSupportSurface,
} from '../shared/pointer-support-cap'
import { createStairCommitGate, swallowFollowUpBrowserClick } from './stair-click-guard'
import {
  DEFAULT_CURVED_STAIR_INNER_RADIUS,
  DEFAULT_CURVED_STAIR_SWEEP_ANGLE,
  DEFAULT_SPIRAL_SHOW_CENTER_COLUMN,
  DEFAULT_SPIRAL_SHOW_STEP_SUPPORTS,
  DEFAULT_SPIRAL_TOP_LANDING_DEPTH,
  DEFAULT_SPIRAL_TOP_LANDING_MODE,
  DEFAULT_STAIR_ATTACHMENT_SIDE,
  DEFAULT_STAIR_FILL_TO_FLOOR,
  DEFAULT_STAIR_OPENING_OFFSET,
  DEFAULT_STAIR_RAILING_HEIGHT,
  DEFAULT_STAIR_RAILING_MODE,
  DEFAULT_STAIR_THICKNESS,
  DEFAULT_STAIR_TYPE,
  DEFAULT_STAIR_WIDTH,
} from './stair-defaults'

const GRID_OFFSET = 0.02
/** Figma-style alignment-snap threshold (meters), matching the move tools. */
const ALIGNMENT_THRESHOLD_M = 0.08
type ClickTriggerEvent = GridEvent | NodeEvent<AnyNode>
type MoveTriggerEvent = GridEvent | NodeEvent<AnyNode>

/**
 * Generates the step-profile geometry for the ghost preview.
 * Same algorithm as StairSystem's generateStairSegmentGeometry.
 */
function createStairPreviewGeometry(
  rise: number,
  count?: number,
  run?: number,
): THREE.BufferGeometry {
  const sizing = planStairSizing(rise)
  const stepCount = count ?? sizing.stepCount
  const length = run ?? sizing.length
  const riserHeight = rise / stepCount
  const treadDepth = length / stepCount

  const shape = new THREE.Shape()
  shape.moveTo(0, 0)

  for (let i = 0; i < stepCount; i++) {
    shape.lineTo(i * treadDepth, (i + 1) * riserHeight)
    shape.lineTo((i + 1) * treadDepth, (i + 1) * riserHeight)
  }

  // Fill to floor (absoluteHeight = 0)
  shape.lineTo(length, 0)
  shape.lineTo(0, 0)

  const geometry = new THREE.ExtrudeGeometry(shape, {
    steps: 1,
    depth: DEFAULT_STAIR_WIDTH,
    bevelEnabled: false,
  })

  // Rotate so extrusion is along X (width), shape profile in XZ plane
  const matrix = new THREE.Matrix4()
  matrix.makeRotationY(-Math.PI / 2)
  matrix.setPosition(DEFAULT_STAIR_WIDTH / 2, 0, 0)
  geometry.applyMatrix4(matrix)

  return geometry
}

/**
 * Creates a default straight stair segment climbing `rise` — the storey it is
 * dropped on, not a constant: the placed stair has no explicit `totalRise`, so
 * this is the height `syncStairRises` immediately converges it to anyway.
 */
function resolvePlacedStairBase(
  nodes: Record<string, AnyNode>,
  levelId: LevelNode['id'],
  stair: StairNode,
  supportSurface: PointerSupportSurface | null,
  seed: StairSegmentNode,
): number {
  // Keep the pointer-selected base when an overlapping deck is above the cursor.
  const base = getFloorStackedPosition({
    node: stair,
    nodes: { ...nodes, [seed.id]: { ...seed, parentId: stair.id } },
    position: stair.position,
    rotation: stair.rotation,
    levelId,
    maxElevation: supportSurface?.elevation ?? null,
  })[1]
  return base
}

function createSeedStairSegment(rise: number) {
  return createSizedStairFlight(rise, {
    width: DEFAULT_STAIR_WIDTH,
    attachmentSide: DEFAULT_STAIR_ATTACHMENT_SIDE,
    fillToFloor: DEFAULT_STAIR_FILL_TO_FLOOR,
    thickness: DEFAULT_STAIR_THICKNESS,
  })
}

function createDefaultStairNode({
  name,
  levelId,
  nextLevelId,
  position,
  rotation,
  segmentId,
}: {
  name: string
  levelId: LevelNode['id']
  nextLevelId: LevelNode['id']
  position: [number, number, number]
  rotation: number
  segmentId: StairSegmentNode['id']
}) {
  const railingMode = useEditor.getState().toolDefaults.stair?.railingMode
  return StairNode.parse({
    name,
    parentId: levelId,
    position,
    rotation,
    stairType: DEFAULT_STAIR_TYPE,
    uniformRisers: true,
    fromLevelId: levelId,
    toLevelId: nextLevelId,
    slabOpeningMode: 'destination',
    openingOffset: DEFAULT_STAIR_OPENING_OFFSET,
    width: DEFAULT_STAIR_WIDTH,
    thickness: DEFAULT_STAIR_THICKNESS,
    fillToFloor: DEFAULT_STAIR_FILL_TO_FLOOR,
    innerRadius: DEFAULT_CURVED_STAIR_INNER_RADIUS,
    sweepAngle: DEFAULT_CURVED_STAIR_SWEEP_ANGLE,
    topLandingMode: DEFAULT_SPIRAL_TOP_LANDING_MODE,
    topLandingDepth: DEFAULT_SPIRAL_TOP_LANDING_DEPTH,
    showCenterColumn: DEFAULT_SPIRAL_SHOW_CENTER_COLUMN,
    showStepSupports: DEFAULT_SPIRAL_SHOW_STEP_SUPPORTS,
    railingHeight: DEFAULT_STAIR_RAILING_HEIGHT,
    railingMode:
      railingMode === 'none' ||
      railingMode === 'left' ||
      railingMode === 'right' ||
      railingMode === 'both'
        ? railingMode
        : DEFAULT_STAIR_RAILING_MODE,
    children: [segmentId],
  })
}

/**
 * Creates a stair group with one default stair segment at the given position/rotation.
 */
function commitStairPlacement(
  levelId: LevelNode['id'],
  position: [number, number, number],
  rotation: number,
  supportSurface: PointerSupportSurface | null,
  landscapeSnap: StairSurfaceSnap | null,
): void {
  const { createNodes, nodes } = useScene.getState()
  const placementLevelId = resolveStairPlacementLevelId(
    nodes,
    levelId,
    useViewer.getState().selection.buildingId,
  )
  if (!placementLevelId) return

  const stairCount = Object.values(nodes).filter((n) => n.type === 'stair').length
  const name = `Staircase ${stairCount + 1}`
  const storeyRise = getLevelFloorToFloorHeight(placementLevelId, nodes)
  if (!(storeyRise > 0)) return
  const seed = createSeedStairSegment(storeyRise)

  const destinationPlan = landscapeSnap
    ? null
    : resolveStairDestinationLevel({
        createMissing: true,
        fromLevelId: placementLevelId,
        nodes,
      })
  const nextLevelId = destinationPlan?.toLevel.id ?? placementLevelId

  const stair = StairNode.parse({
    ...createDefaultStairNode({
      name,
      levelId: placementLevelId,
      nextLevelId,
      position,
      rotation,
      segmentId: seed.id,
    }),
    parentId: placementLevelId,
    ...(landscapeSnap
      ? {
          totalRise: landscapeSnap.totalRise,
          stepCount: landscapeSnap.stepCount,
          slabOpeningMode: 'none' as const,
          landscapeSurfaceId: landscapeSnap.surfaceId,
          railingMode: 'none' as const,
        }
      : {}),
  })
  const base = resolvePlacedStairBase(nodes, placementLevelId, stair, supportSurface, seed)
  let segment: StairSegmentNode
  try {
    segment = {
      ...planStairCreation(
        stair,
        nodes,
        {
          width: seed.width,
          attachmentSide: seed.attachmentSide,
          fillToFloor: seed.fillToFloor,
          thickness: seed.thickness,
        },
        base,
      ).flight,
      id: seed.id,
    }
  } catch (error) {
    if (error instanceof RangeError) return
    throw error
  }
  if (landscapeSnap)
    segment = {
      ...segment,
      height: landscapeSnap.totalRise,
      length: landscapeSnap.length,
      stepCount: landscapeSnap.stepCount,
    }
  stair.stepCount = segment.stepCount
  const prospectiveNodes = {
    ...nodes,
    [stair.id]: stair,
    [segment.id]: { ...segment, parentId: stair.id },
  } as Record<string, AnyNode>
  const placementPatch = landscapeSnap
    ? { position }
    : supportSurface?.sourceNodeId
      ? resolveFrozenFloorPlacementPatch(stair, prospectiveNodes, {
          position,
          rotation,
          elevation: supportSurface.elevation,
          preferredSlabId: supportSurface.supportSlabId,
        })
      : {
          position,
          ...resolveSupportSlabPatch(stair, prospectiveNodes, {
            maxElevation: supportSurface?.elevation,
          }),
        }
  const committedStair = StairNode.parse({
    ...stair,
    ...placementPatch,
  })

  const createdLevel = destinationPlan?.createdLevel
  const levelCreateOps =
    createdLevel && destinationPlan.buildingId
      ? [{ node: createdLevel, parentId: destinationPlan.buildingId }]
      : []

  createNodes([
    ...levelCreateOps,
    { node: committedStair, parentId: placementLevelId },
    { node: segment, parentId: committedStair.id },
  ])

  sfxEmitter.emit('sfx:structure-build')
}

export const StairTool: React.FC = () => {
  const camera = useThree((state) => state.camera)
  const cameraRef = useRef(camera)
  cameraRef.current = camera
  const cursorRef = useRef<THREE.Group>(null)
  const previewRef = useRef<THREE.Group>(null)
  const previewMeshRef = useRef<THREE.Mesh>(null)
  const rotationRef = useRef(0)
  const supportSurfaceRef = useRef<PointerSupportSurface | null>(null)
  const landscapeSnapRef = useRef<StairSurfaceSnap | null>(null)
  const previousGridPosRef = useRef<[number, number] | null>(null)
  const lastCanonicalPositionRef = useRef<[number, number, number] | null>(null)
  const currentLevelId = useViewer((state) => state.selection.levelId)

  const previewRise = useScene((state) =>
    currentLevelId ? getLevelFloorToFloorHeight(currentLevelId, state.nodes) : DEFAULT_LEVEL_HEIGHT,
  )
  const previewRiseRef = useRef(previewRise)
  previewRiseRef.current = previewRise
  const previewGeometry = useMemo(() => createStairPreviewGeometry(DEFAULT_LEVEL_HEIGHT), [])
  const ownedGeometryRef = useRef(previewGeometry)
  const geometryRiseRef = useRef<string | number>(DEFAULT_LEVEL_HEIGHT)
  useEffect(() => () => ownedGeometryRef.current.dispose(), [])
  useEffect(() => () => useEditor.getState().setToolDefaults('stair', null), [])

  useEffect(() => {
    if (!currentLevelId) return

    const openingPreview = createSurfaceOpeningPreviewController()
    // Refuses the duplicate commit triggers a single physical click produces
    // — see `stair-click-guard.ts`. Fresh per armed session.
    const commitGate = createStairCommitGate()

    // Reset rotation when tool activates
    rotationRef.current = 0
    useStairBuildPreview.getState().reset()
    if (previewRef.current) {
      previewRef.current.rotation.y = 0
      previewRef.current.scale.y = 1
    }
    lastCanonicalPositionRef.current = null
    supportSurfaceRef.current = null
    landscapeSnapRef.current = null

    const buildPreviewScene = (
      position: [number, number, number],
      rotation: number,
      supportSurface: PointerSupportSurface | null,
      landscapeSnap: StairSurfaceSnap | null,
    ) => {
      const nodes = useScene.getState().nodes
      const placementLevelId = resolveStairPlacementLevelId(
        nodes,
        currentLevelId,
        useViewer.getState().selection.buildingId,
      )
      if (!placementLevelId) return null

      const destinationPlan = landscapeSnap
        ? null
        : resolveStairDestinationLevel({
            createMissing: true,
            fromLevelId: placementLevelId,
            nodes,
          })
      const nextLevelId = destinationPlan?.toLevel.id ?? placementLevelId
      const storeyRise = getLevelFloorToFloorHeight(placementLevelId, nodes)
      if (!(storeyRise > 0)) return null
      const seed = createSeedStairSegment(storeyRise)
      const stair = createDefaultStairNode({
        name: 'Staircase Preview',
        levelId: placementLevelId,
        nextLevelId,
        position,
        rotation,
        segmentId: seed.id,
      })
      const base = resolvePlacedStairBase(nodes, placementLevelId, stair, supportSurface, seed)
      let segment: StairSegmentNode
      try {
        segment = {
          ...planStairCreation(
            stair,
            nodes,
            {
              width: seed.width,
              attachmentSide: seed.attachmentSide,
              fillToFloor: seed.fillToFloor,
              thickness: seed.thickness,
            },
            base,
          ).flight,
          id: seed.id,
        }
      } catch (error) {
        if (error instanceof RangeError) return null
        throw error
      }
      if (landscapeSnap) {
        stair.totalRise = landscapeSnap.totalRise
        stair.landscapeSurfaceId = landscapeSnap.surfaceId
        stair.slabOpeningMode = 'none'
        stair.railingMode = 'none'
        segment = {
          ...segment,
          height: landscapeSnap.totalRise,
          length: landscapeSnap.length,
          stepCount: landscapeSnap.stepCount,
        }
      }
      stair.stepCount = segment.stepCount
      const previewNodes = {
        ...nodes,
        ...(destinationPlan?.createdLevel
          ? { [destinationPlan.createdLevel.id]: destinationPlan.createdLevel }
          : {}),
        [stair.id]: { ...stair, parentId: placementLevelId },
        [segment.id]: { ...segment, parentId: stair.id },
      } as Record<string, AnyNode>

      return { placementLevelId, previewNodes, stair, rise: segment.height }
    }

    // The preview rebuild (full-scene copy + destination-level resolution +
    // auto-opening CSG) is expensive; `grid:move` fires it every pointer event
    // but the placed position is grid-snapped, so within a cell every rebuild
    // is identical. Dedupe on the snapped position + rotation so we rebuild
    // only when the staircase would actually land somewhere new — this is the
    // difference between a smooth and a stuttering stair tool (the elevator is
    // cheap because it has no opening sync).
    let lastPreviewKey: string | null = null

    const applyDraftPreview = (
      position: [number, number, number],
      rotation: number,
      supportSurface: PointerSupportSurface | null,
    ) => {
      const landscapeSnap = landscapeSnapRef.current
      rotation = landscapeSnap?.rotation ?? rotation
      const key = `${position[0].toFixed(3)},${position[2].toFixed(3)},${rotation.toFixed(4)},${supportSurface?.elevation.toFixed(3) ?? 'none'},${supportSurface?.sourceNodeId ?? 'floor'},${landscapeSnapRef.current?.length.toFixed(3) ?? 'free'},${landscapeSnapRef.current?.stepCount ?? 0},${landscapeSnapRef.current?.totalRise.toFixed(3) ?? 'free'}`
      if (key === lastPreviewKey) return
      lastPreviewKey = key
      const preview = buildPreviewScene(position, rotation, supportSurface, landscapeSnap)
      useStairBuildPreview
        .getState()
        .setPreview(
          preview ? [position[0], position[2]] : null,
          rotation,
          preview?.rise ?? null,
          landscapeSnap?.length,
          landscapeSnap?.stepCount,
        )
      const frozenPatch =
        preview && supportSurface?.sourceNodeId && !landscapeSnap
          ? resolveFrozenFloorPlacementPatch(preview.stair, preview.previewNodes, {
              position,
              rotation,
              elevation: supportSurface.elevation,
              preferredSlabId: supportSurface.supportSlabId,
            })
          : null
      const previewPosition = frozenPatch?.position ?? position
      const previewStair = frozenPatch
        ? ({ ...preview?.stair, ...frozenPatch } as AnyNode)
        : preview?.stair
      const visualPosition = landscapeSnap
        ? previewPosition
        : preview && previewStair
          ? getFloorStackPreviewPosition({
              node: previewStair,
              position: previewPosition,
              rotation,
              levelId: preview.placementLevelId,
              nodes: preview.previewNodes,
              maxElevation: supportSurface?.sourceNodeId ? null : supportSurface?.elevation,
            })
          : previewPosition
      if (cursorRef.current) {
        cursorRef.current.position.set(
          visualPosition[0],
          visualPosition[1] + GRID_OFFSET,
          visualPosition[2],
        )
      }

      if (previewRef.current) {
        previewRef.current.visible = Boolean(preview)
        previewRef.current.position.set(...visualPosition)
        previewRef.current.rotation.y = rotation
        if (
          preview &&
          previewMeshRef.current &&
          `${preview.rise}:${landscapeSnap?.stepCount}:${landscapeSnap?.length}` !==
            String(geometryRiseRef.current)
        ) {
          const previous = previewMeshRef.current.geometry
          previewMeshRef.current.geometry = createStairPreviewGeometry(
            preview.rise,
            landscapeSnap?.stepCount,
            landscapeSnap?.length,
          )
          previous.dispose()
          ownedGeometryRef.current = previewMeshRef.current.geometry
          geometryRiseRef.current = `${preview.rise}:${landscapeSnap?.stepCount}:${landscapeSnap?.length}`
        }
        previewRef.current.scale.y = 1
      }

      // Forward-facing triangle (editor-side overlay). The run ascends along
      // local +Z from the entry at z≈0; the stair's front is the -Z entry side,
      // so `reversed` points the triangle out of the entry (where you approach
      // from), sitting just before it — not inside the footprint or at the
      // elevated far end. Centre is the footprint mid-run (origin is the entry).
      if (!preview) {
        useFacingPose.getState().clear()
        openingPreview.clear()
        return
      }
      const sizing = planStairSizing(preview.rise)
      useFacingPose.getState().set({
        position: visualPosition,
        rotationY: rotation,
        depth: sizing.length,
        center: [0, sizing.length / 2],
        reversed: true,
      })

      openingPreview.apply(syncAutoStairOpenings(preview.previewNodes))
    }

    // Alignment candidates — anchors of every alignable object; refreshed
    // after each placement. The moving stair aligns by its footprint edges so
    // users can snap the run side against walls, slabs, elevators, or another
    // stair instead of only lining up the invisible origin point.
    let alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, '', currentLevelId)
    const resolveStairFootprintAlignment = (
      x: number,
      z: number,
      rotation: number,
    ): ReturnType<typeof resolveAlignment> | null => {
      const preview = buildPreviewScene(
        [x, 0, z],
        rotation,
        supportSurfaceRef.current,
        landscapeSnapRef.current,
      )
      const moving = preview
        ? movingAlignmentAnchors(preview.stair, preview.previewNodes, x, z, rotation)
        : []
      if (moving.length === 0) return null
      return resolveAlignment({
        moving,
        candidates: alignmentCandidates,
        threshold: ALIGNMENT_THRESHOLD_M,
      })
    }
    // The probe is the RAW cursor, not the grid-snapped point: resolving
    // against the grid point would only catch anchors that happen to sit near
    // a grid line. Matched axes use the raw probe + snap delta; unmatched axes
    // keep the normal grid snap. Guides are published in every snapping mode
    // (including Off); the magnetic pull toward them (applySnap) applies only in
    // 'lines' mode.
    const alignPoint = (
      gridX: number,
      gridZ: number,
      rawX: number,
      rawZ: number,
      bypass: boolean,
      applySnap: boolean,
    ): [number, number] => {
      if (bypass || alignmentCandidates.length === 0) {
        useAlignmentGuides.getState().clear()
        return [gridX, gridZ]
      }
      const ar = resolveStairFootprintAlignment(rawX, rawZ, rotationRef.current)
      if (!ar || ar.guides.length === 0) {
        useAlignmentGuides.getState().clear()
        return [gridX, gridZ]
      }
      if (!applySnap) {
        useAlignmentGuides.getState().set(ar.guides)
        return [gridX, gridZ]
      }
      let x = gridX
      let z = gridZ
      if (ar.snap) {
        if (ar.guides.some((guide) => guide.axis === 'x')) x = rawX + ar.snap.dx
        if (ar.guides.some((guide) => guide.axis === 'z')) z = rawZ + ar.snap.dz
      }
      const finalAlignment = resolveStairFootprintAlignment(x, z, rotationRef.current)
      useAlignmentGuides.getState().set(finalAlignment?.guides ?? ar.guides)
      return [x, z]
    }

    const resolveStairPosition = (event: MoveTriggerEvent): [number, number, number] | null => {
      const pointed = resolvePointerSupportSurface(cameraRef.current, event.position, {
        includeNodeTopSurfaces: true,
      })
      supportSurfaceRef.current = pointed
      const fallbackPosition =
        'node' in event ? lastCanonicalPositionRef.current : event.localPosition
      if (!pointed?.localPoint && !fallbackPosition) return null
      const rawX = pointed?.localPoint?.[0] ?? fallbackPosition![0]
      const rawZ = pointed?.localPoint?.[2] ?? fallbackPosition![2]
      // Grid snap follows the global mode (live step so the HUD chip is
      // honest); Off keeps the raw cursor. Shift cycles the mode centrally.
      const bypassSnap = event.nativeEvent?.altKey === true
      const step = useEditor.getState().gridSnapStep
      const [gridX, gridZ] = alignPoint(
        !bypassSnap && isGridSnapActive() ? Math.round(rawX / step) * step : rawX,
        !bypassSnap && isGridSnapActive() ? Math.round(rawZ / step) * step : rawZ,
        rawX,
        rawZ,
        !isAlignmentGuideActive(),
        !bypassSnap && isMagneticSnapActive(),
      )
      const nodes = useScene.getState().nodes
      const levelId = resolveStairPlacementLevelId(
        nodes,
        currentLevelId,
        useViewer.getState().selection.buildingId,
      )
      const candidate: [number, number, number] = [gridX, 0, gridZ]
      const draft = StairNode.parse({
        parentId: levelId,
        position: candidate,
        width: DEFAULT_STAIR_WIDTH,
        stairType: 'straight',
        rotation: rotationRef.current,
      })
      const baseElevation = levelId
        ? getFloorStackedPosition({
            node: draft,
            nodes,
            position: candidate,
            rotation: rotationRef.current,
            levelId,
          })[1]
        : candidate[1]
      const snap =
        event.nativeEvent?.altKey || !isMagneticSnapActive()
          ? null
          : resolveStairSurfaceSnap(
              draft,
              nodes,
              candidate,
              planStairSizing(previewRiseRef.current).length,
              baseElevation,
              useScene.getState().installedPlugins,
            )
      landscapeSnapRef.current = snap
      if (snap) return snap.position
      return candidate
    }

    const onPointerMove = (event: MoveTriggerEvent) => {
      const position = resolveStairPosition(event)
      if (!position) return
      const [gridX, , gridZ] = position
      lastCanonicalPositionRef.current = position
      applyDraftPreview(position, rotationRef.current, supportSurfaceRef.current)

      if (
        (isGridSnapActive() || isMagneticSnapActive()) &&
        previousGridPosRef.current &&
        (gridX !== previousGridPosRef.current[0] || gridZ !== previousGridPosRef.current[1])
      ) {
        sfxEmitter.emit('sfx:grid-snap')
      }

      previousGridPosRef.current = [gridX, gridZ]
    }

    const commitAtCursor = (event: ClickTriggerEvent) => {
      if (!currentLevelId) return
      // One physical click can reach here twice (node click synthesized on
      // pointerup + the native browser click driving `grid:click`) — see
      // `stair-click-guard.ts`. The gate refuses anything after a single-
      // continuation commit; the swallow below eats the same gesture's
      // follow-up click while the tool stays armed (repeat continuation).
      if (!commitGate.shouldCommit()) return
      const nodeEvent = 'node' in event ? (event as NodeEvent<AnyNode>) : null
      if (nodeEvent) {
        nodeEvent.stopPropagation()
        nodeEvent.nativeEvent.stopPropagation()
        // The canvas-level `grid:click` listener is out of stopPropagation's
        // reach — without this, the browser click that follows this
        // pointerup-synthesized node click commits a second stair.
        swallowFollowUpBrowserClick()
      }

      const position = resolveStairPosition(event)
      if (!position) return

      commitStairPlacement(
        currentLevelId,
        position,
        landscapeSnapRef.current?.rotation ?? rotationRef.current,
        supportSurfaceRef.current,
        landscapeSnapRef.current,
      )
      openingPreview.clear()
      // Commit cleared the opening preview, so force the next hover (even on the
      // same cell) to rebuild rather than dedupe against the just-placed key.
      lastPreviewKey = null
      useAlignmentGuides.getState().clear()

      // Single by default; the C-toggle ('point' context, shared with every
      // other placement tool) opts into placing more. On single, drop the tool
      // and the facing triangle so we fall back to select after one stair.
      if (useEditor.getState().getContinuation('point') === 'repeat') {
        alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, '', currentLevelId)
      } else {
        commitGate.markExited()
        useFacingPose.getState().clear()
        useEditor.getState().setTool(null)
        // Return to select mode explicitly (matches the spawn tool's exit).
        // The selection managers route node clicks only while
        // `mode === 'select'`; exiting with `mode: 'build'` + a null tool
        // left every click dead until the user pressed Escape.
        useEditor.getState().setMode('select')
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      const ROTATION_STEP = Math.PI / 4
      let rotationDelta = 0
      if (event.key === 'r' || event.key === 'R') rotationDelta = ROTATION_STEP
      else if (event.key === 't' || event.key === 'T') rotationDelta = -ROTATION_STEP

      if (rotationDelta !== 0) {
        event.preventDefault()
        sfxEmitter.emit('sfx:item-rotate')
        rotationRef.current += rotationDelta
        if (lastCanonicalPositionRef.current) {
          applyDraftPreview(
            lastCanonicalPositionRef.current,
            rotationRef.current,
            supportSurfaceRef.current,
          )
        } else if (previewRef.current) {
          previewRef.current.rotation.y = rotationRef.current
        }
      }
    }

    emitter.on('grid:move', onPointerMove)
    emitter.on('grid:click', commitAtCursor)
    emitter.on('node:click', commitAtCursor)
    emitter.on('node:move', onPointerMove)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      emitter.off('grid:move', onPointerMove)
      emitter.off('grid:click', commitAtCursor)
      emitter.off('node:click', commitAtCursor)
      emitter.off('node:move', onPointerMove)
      window.removeEventListener('keydown', onKeyDown)
      useAlignmentGuides.getState().clear()
      openingPreview.clear()
      useFacingPose.getState().clear()
      useStairBuildPreview.getState().reset()
    }
  }, [currentLevelId])

  return (
    <group>
      <CursorSphere ref={cursorRef} />

      {/* 3D ghost preview — position/rotation updated imperatively. The
          forward-facing triangle is drawn by the editor-side overlay from the
          pose published in `applyDraftPreview`. */}
      <group ref={previewRef}>
        <mesh dispose={null} geometry={previewGeometry} layers={EDITOR_LAYER} ref={previewMeshRef}>
          <meshStandardMaterial color="#818cf8" depthWrite={false} opacity={0.35} transparent />
        </mesh>
      </group>
    </group>
  )
}
