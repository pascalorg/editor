import {
  type AnyNode,
  collectAlignmentAnchors,
  createSurfaceOpeningPreviewController,
  type EventSuffix,
  emitter,
  type GridEvent,
  type LevelNode,
  movingAlignmentAnchors,
  type NodeEvent,
  resolveAlignment,
  StairNode,
  StairSegmentNode,
  syncAutoStairOpenings,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
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
import { CursorSphere } from '../shared/cursor-sphere'
import { getFloorStackPreviewPosition } from '../shared/floor-stack-preview'
import {
  DEFAULT_CURVED_STAIR_INNER_RADIUS,
  DEFAULT_CURVED_STAIR_SWEEP_ANGLE,
  DEFAULT_SPIRAL_SHOW_CENTER_COLUMN,
  DEFAULT_SPIRAL_SHOW_STEP_SUPPORTS,
  DEFAULT_SPIRAL_TOP_LANDING_DEPTH,
  DEFAULT_SPIRAL_TOP_LANDING_MODE,
  DEFAULT_STAIR_ATTACHMENT_SIDE,
  DEFAULT_STAIR_FILL_TO_FLOOR,
  DEFAULT_STAIR_HEIGHT,
  DEFAULT_STAIR_LENGTH,
  DEFAULT_STAIR_OPENING_OFFSET,
  DEFAULT_STAIR_RAILING_HEIGHT,
  DEFAULT_STAIR_RAILING_MODE,
  DEFAULT_STAIR_STEP_COUNT,
  DEFAULT_STAIR_THICKNESS,
  DEFAULT_STAIR_TYPE,
  DEFAULT_STAIR_WIDTH,
} from './stair-defaults'

const GRID_OFFSET = 0.02
/** Figma-style alignment-snap threshold (meters), matching the move tools. */
const ALIGNMENT_THRESHOLD_M = 0.08
type ClickTriggerEvent = GridEvent | NodeEvent<AnyNode>

const CLICK_TRIGGER_KINDS = [
  'shelf',
  'item',
  'slab',
  'ceiling',
  'wall',
  'fence',
  'column',
  'roof',
  'roof-segment',
  'stair',
  'stair-segment',
] as const

/**
 * Generates the step-profile geometry for the ghost preview.
 * Same algorithm as StairSystem's generateStairSegmentGeometry.
 */
function createStairPreviewGeometry(): THREE.BufferGeometry {
  const riserHeight = DEFAULT_STAIR_HEIGHT / DEFAULT_STAIR_STEP_COUNT
  const treadDepth = DEFAULT_STAIR_LENGTH / DEFAULT_STAIR_STEP_COUNT

  const shape = new THREE.Shape()
  shape.moveTo(0, 0)

  for (let i = 0; i < DEFAULT_STAIR_STEP_COUNT; i++) {
    shape.lineTo(i * treadDepth, (i + 1) * riserHeight)
    shape.lineTo((i + 1) * treadDepth, (i + 1) * riserHeight)
  }

  // Fill to floor (absoluteHeight = 0)
  shape.lineTo(DEFAULT_STAIR_LENGTH, 0)
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
 * Creates a default straight stair segment.
 */
function createDefaultStairSegment() {
  return StairSegmentNode.parse({
    segmentType: 'stair',
    width: DEFAULT_STAIR_WIDTH,
    length: DEFAULT_STAIR_LENGTH,
    height: DEFAULT_STAIR_HEIGHT,
    stepCount: DEFAULT_STAIR_STEP_COUNT,
    attachmentSide: DEFAULT_STAIR_ATTACHMENT_SIDE,
    fillToFloor: DEFAULT_STAIR_FILL_TO_FLOOR,
    thickness: DEFAULT_STAIR_THICKNESS,
    position: [0, 0, 0],
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
  return StairNode.parse({
    name,
    position,
    rotation,
    stairType: DEFAULT_STAIR_TYPE,
    fromLevelId: levelId,
    toLevelId: nextLevelId,
    slabOpeningMode: 'destination',
    openingOffset: DEFAULT_STAIR_OPENING_OFFSET,
    width: DEFAULT_STAIR_WIDTH,
    totalRise: DEFAULT_STAIR_HEIGHT,
    stepCount: DEFAULT_STAIR_STEP_COUNT,
    thickness: DEFAULT_STAIR_THICKNESS,
    fillToFloor: DEFAULT_STAIR_FILL_TO_FLOOR,
    innerRadius: DEFAULT_CURVED_STAIR_INNER_RADIUS,
    sweepAngle: DEFAULT_CURVED_STAIR_SWEEP_ANGLE,
    topLandingMode: DEFAULT_SPIRAL_TOP_LANDING_MODE,
    topLandingDepth: DEFAULT_SPIRAL_TOP_LANDING_DEPTH,
    showCenterColumn: DEFAULT_SPIRAL_SHOW_CENTER_COLUMN,
    showStepSupports: DEFAULT_SPIRAL_SHOW_STEP_SUPPORTS,
    railingHeight: DEFAULT_STAIR_RAILING_HEIGHT,
    railingMode: DEFAULT_STAIR_RAILING_MODE,
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
  const segment = createDefaultStairSegment()

  const destinationPlan = resolveStairDestinationLevel({
    createMissing: true,
    fromLevelId: placementLevelId,
    nodes,
  })
  const nextLevelId = destinationPlan?.toLevel.id ?? placementLevelId

  const stair = createDefaultStairNode({
    name,
    levelId: placementLevelId,
    nextLevelId,
    position,
    rotation,
    segmentId: segment.id,
  })

  const createdLevel = destinationPlan?.createdLevel
  const levelCreateOps =
    createdLevel && destinationPlan.buildingId
      ? [{ node: createdLevel, parentId: destinationPlan.buildingId }]
      : []

  createNodes([
    ...levelCreateOps,
    { node: stair, parentId: placementLevelId },
    { node: segment, parentId: stair.id },
  ])

  sfxEmitter.emit('sfx:structure-build')
}

export const StairTool: React.FC = () => {
  const cursorRef = useRef<THREE.Group>(null)
  const previewRef = useRef<THREE.Group>(null)
  const rotationRef = useRef(0)
  const previousGridPosRef = useRef<[number, number] | null>(null)
  const lastCanonicalPositionRef = useRef<[number, number, number] | null>(null)
  const currentLevelId = useViewer((state) => state.selection.levelId)

  const previewGeometry = useMemo(() => createStairPreviewGeometry(), [])

  useEffect(() => {
    if (!currentLevelId) return

    const openingPreview = createSurfaceOpeningPreviewController()

    // Reset rotation when tool activates
    rotationRef.current = 0
    if (previewRef.current) previewRef.current.rotation.y = 0
    lastCanonicalPositionRef.current = null

    const buildPreviewScene = (position: [number, number, number], rotation: number) => {
      const nodes = useScene.getState().nodes
      const placementLevelId = resolveStairPlacementLevelId(
        nodes,
        currentLevelId,
        useViewer.getState().selection.buildingId,
      )
      if (!placementLevelId) return null

      const destinationPlan = resolveStairDestinationLevel({
        createMissing: true,
        fromLevelId: placementLevelId,
        nodes,
      })
      const nextLevelId = destinationPlan?.toLevel.id ?? placementLevelId
      const segment = createDefaultStairSegment()
      const stair = createDefaultStairNode({
        name: 'Staircase Preview',
        levelId: placementLevelId,
        nextLevelId,
        position,
        rotation,
        segmentId: segment.id,
      })
      const previewNodes = {
        ...nodes,
        ...(destinationPlan?.createdLevel
          ? { [destinationPlan.createdLevel.id]: destinationPlan.createdLevel }
          : {}),
        [stair.id]: { ...stair, parentId: placementLevelId },
        [segment.id]: { ...segment, parentId: stair.id },
      } as Record<string, AnyNode>

      return { placementLevelId, previewNodes, stair }
    }

    // The preview rebuild (full-scene copy + destination-level resolution +
    // auto-opening CSG) is expensive; `grid:move` fires it every pointer event
    // but the placed position is grid-snapped, so within a cell every rebuild
    // is identical. Dedupe on the snapped position + rotation so we rebuild
    // only when the staircase would actually land somewhere new — this is the
    // difference between a smooth and a stuttering stair tool (the elevator is
    // cheap because it has no opening sync).
    let lastPreviewKey: string | null = null

    const applyDraftPreview = (position: [number, number, number], rotation: number) => {
      const key = `${position[0].toFixed(3)},${position[2].toFixed(3)},${rotation.toFixed(4)}`
      if (key === lastPreviewKey) return
      lastPreviewKey = key
      const preview = buildPreviewScene(position, rotation)
      const visualPosition = preview
        ? getFloorStackPreviewPosition({
            node: preview.stair,
            position,
            rotation,
            levelId: preview.placementLevelId,
            nodes: preview.previewNodes,
          })
        : position
      if (cursorRef.current) {
        cursorRef.current.position.set(
          visualPosition[0],
          visualPosition[1] + GRID_OFFSET,
          visualPosition[2],
        )
      }

      if (previewRef.current) {
        previewRef.current.position.set(...visualPosition)
        previewRef.current.rotation.y = rotation
      }

      // Forward-facing triangle (editor-side overlay). The run ascends along
      // local +Z from the entry at z≈0; the stair's front is the -Z entry side,
      // so `reversed` points the triangle out of the entry (where you approach
      // from), sitting just before it — not inside the footprint or at the
      // elevated far end. Centre is the footprint mid-run (origin is the entry).
      useFacingPose.getState().set({
        position: visualPosition,
        rotationY: rotation,
        depth: DEFAULT_STAIR_LENGTH,
        center: [0, DEFAULT_STAIR_LENGTH / 2],
        reversed: true,
      })

      if (!preview) {
        openingPreview.clear()
        return
      }

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
      const preview = buildPreviewScene([x, 0, z], rotation)
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

    const onGridMove = (event: GridEvent) => {
      // Grid snap follows the global mode (live step so the HUD chip is
      // honest); Off keeps the raw cursor. Shift cycles the mode centrally.
      const step = useEditor.getState().gridSnapStep
      const [gridX, gridZ] = alignPoint(
        isGridSnapActive()
          ? Math.round(event.localPosition[0] / step) * step
          : event.localPosition[0],
        isGridSnapActive()
          ? Math.round(event.localPosition[2] / step) * step
          : event.localPosition[2],
        event.localPosition[0],
        event.localPosition[2],
        !isAlignmentGuideActive(),
        isMagneticSnapActive(),
      )
      const position: [number, number, number] = [gridX, 0, gridZ]
      lastCanonicalPositionRef.current = position
      applyDraftPreview(position, rotationRef.current)

      if (
        (isGridSnapActive() || isMagneticSnapActive()) &&
        previousGridPosRef.current &&
        (gridX !== previousGridPosRef.current[0] || gridZ !== previousGridPosRef.current[1])
      ) {
        sfxEmitter.emit('sfx:grid-snap')
      }

      previousGridPosRef.current = [gridX, gridZ]
    }

    const getAlignedGridPosition = (event: GridEvent): [number, number, number] => {
      const step = useEditor.getState().gridSnapStep
      const [gridX, gridZ] = alignPoint(
        isGridSnapActive()
          ? Math.round(event.localPosition[0] / step) * step
          : event.localPosition[0],
        isGridSnapActive()
          ? Math.round(event.localPosition[2] / step) * step
          : event.localPosition[2],
        event.localPosition[0],
        event.localPosition[2],
        !isAlignmentGuideActive(),
        isMagneticSnapActive(),
      )
      return [gridX, 0, gridZ]
    }

    const commitAtCursor = (event: ClickTriggerEvent) => {
      if (!currentLevelId) return
      const nodeEvent = 'node' in event ? (event as NodeEvent<AnyNode>) : null
      if (nodeEvent) {
        nodeEvent.stopPropagation()
        nodeEvent.nativeEvent.stopPropagation()
      }

      const position = nodeEvent
        ? lastCanonicalPositionRef.current
        : getAlignedGridPosition(event as GridEvent)
      if (!position) return

      commitStairPlacement(currentLevelId, position, rotationRef.current)
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
        useFacingPose.getState().clear()
        useEditor.getState().setTool(null)
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
          applyDraftPreview(lastCanonicalPositionRef.current, rotationRef.current)
        } else if (previewRef.current) {
          previewRef.current.rotation.y = rotationRef.current
        }
      }
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', commitAtCursor)
    type SuffixedKey<K extends string> = `${K}:${EventSuffix}`
    type ClickKey = SuffixedKey<(typeof CLICK_TRIGGER_KINDS)[number]>
    for (const kind of CLICK_TRIGGER_KINDS) {
      const key = `${kind}:click` as ClickKey
      emitter.on(key, commitAtCursor as never)
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', commitAtCursor)
      for (const kind of CLICK_TRIGGER_KINDS) {
        const key = `${kind}:click` as ClickKey
        emitter.off(key, commitAtCursor as never)
      }
      window.removeEventListener('keydown', onKeyDown)
      useAlignmentGuides.getState().clear()
      openingPreview.clear()
      useFacingPose.getState().clear()
    }
  }, [currentLevelId])

  return (
    <group>
      <CursorSphere ref={cursorRef} />

      {/* 3D ghost preview — position/rotation updated imperatively. The
          forward-facing triangle is drawn by the editor-side overlay from the
          pose published in `applyDraftPreview`. */}
      <group ref={previewRef}>
        <mesh castShadow geometry={previewGeometry}>
          <meshStandardMaterial color="#818cf8" depthWrite={false} opacity={0.35} transparent />
        </mesh>
      </group>
    </group>
  )
}
