'use client'

import {
  calculateLevelMiters,
  collectAlignmentAnchors,
  emitter,
  type FenceNode,
  type GridEvent,
  getTwoPointFenceCurveTangents,
  getWallMiterBoundaryPoints,
  type LevelNode,
  type Point2D,
  resolveAlignment,
  sampleFenceSpline,
  useScene,
  type WallMiterData,
  type WallNode,
} from '@pascal-app/core'
import {
  CursorSphere,
  createFenceOnCurrentLevel,
  createSplineFenceOnCurrentLevel,
  EDITOR_LAYER,
  type FencePlanPoint,
  formatAngleRadians,
  formatLinearMeasurement,
  getAngleArcToSegmentReference,
  getAngleToSegmentReference,
  getSegmentAngleReferenceAtPoint,
  getSegmentGridStep,
  isAlignmentGuideActive,
  isAngleSnapActive,
  isGridSnapActive,
  isMagneticSnapActive,
  markToolCancelConsumed,
  type SegmentAngleReference,
  snapFenceDraftPoint,
  snapScalarToGrid,
  triggerSFX,
  useAlignmentGuides,
  useEditor,
  useFenceCurveDraft,
  useSegmentDraftChain,
} from '@pascal-app/editor'

import { getSceneTheme, useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BoxGeometry, BufferGeometry, DoubleSide, type Group, type Mesh, Vector3 } from 'three'

const FENCE_PREVIEW_HEIGHT = 1.8
const FENCE_PREVIEW_THICKNESS = 0.08
/** Figma-style alignment-snap threshold (meters), matching the move tools. */
const ALIGNMENT_THRESHOLD_M = 0.08
// HUD label heights are measured from the top of the preview bar, so they
// track whatever height a seeded preset draws at (`previewHeight`).
const DRAFT_LABEL_Y_OFFSET = 0.22
const DRAFT_ANGLE_LABEL_Y_OFFSET = 0.08
const DRAFT_ANGLE_ARC_Y_OFFSET = 0.012
const DRAFT_ANGLE_ARC_MIN_RADIUS = 0.32
const DRAFT_ANGLE_ARC_MAX_RADIUS = 0.72
const DRAFT_ANGLE_ARC_SEGMENTS = 24

type DraftAngleLabel = {
  id: string
  label: string
  position: [number, number, number]
  arc: {
    center: FencePlanPoint
    radius: number
    startAngle: number
    endAngle: number
    y: number
  }
}

type DraftMeasurementState = {
  lengthLabel: string
  lengthPosition: [number, number, number]
  angleLabels: DraftAngleLabel[]
} | null

type SegmentLike = {
  id: string
  start: FencePlanPoint
  end: FencePlanPoint
  curveOffset?: number
  thickness?: number
}

type FaceAngleCandidate = {
  index: number
  point: FencePlanPoint
  vector: FencePlanPoint
}

type FaceAnglePair = {
  draft: FaceAngleCandidate
  connected: FaceAngleCandidate
  distance: number
}

type AngleSource = {
  arcCenter: FencePlanPoint
  connectedVector: FencePlanPoint
  draftVector: FencePlanPoint
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function distanceSquared(a: FencePlanPoint, b: FencePlanPoint) {
  const dx = a[0] - b[0]
  const dz = a[1] - b[1]

  return dx * dx + dz * dz
}

function pointMatches(a: FencePlanPoint, b: FencePlanPoint, tolerance = 1e-5) {
  return distanceSquared(a, b) <= tolerance * tolerance
}

function toFencePlanPoint(point: Point2D): FencePlanPoint {
  return [point.x, point.y]
}

function toMiterWall(segment: SegmentLike): WallNode {
  return {
    object: 'node',
    id: segment.id as WallNode['id'],
    type: 'wall',
    name: 'Fence reference',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    start: segment.start,
    end: segment.end,
    thickness: segment.thickness,
    curveOffset: segment.curveOffset,
    frontSide: 'unknown',
    backSide: 'unknown',
  }
}

function buildDraftFenceSegment(
  start: FencePlanPoint,
  end: FencePlanPoint,
  thickness: number,
): SegmentLike {
  return {
    id: 'fence_draft',
    start,
    end,
    thickness,
  }
}

function getSegmentEndpointKind(
  point: FencePlanPoint,
  segment: SegmentLike,
): 'start' | 'end' | null {
  if (pointMatches(point, segment.start)) return 'start'
  if (pointMatches(point, segment.end)) return 'end'

  return null
}

function getFenceFaceAngleCandidates(
  point: FencePlanPoint,
  segment: SegmentLike,
  miterData: WallMiterData,
): FaceAngleCandidate[] {
  const endpoint = getSegmentEndpointKind(point, segment)
  const reference = getSegmentAngleReferenceAtPoint(point, segment)
  if (!(endpoint && reference)) return []

  const boundaryPoints = getWallMiterBoundaryPoints(toMiterWall(segment), miterData)
  if (!boundaryPoints) return []

  const points =
    endpoint === 'start'
      ? [boundaryPoints.startLeft, boundaryPoints.startRight]
      : [boundaryPoints.endLeft, boundaryPoints.endRight]

  return points.map((facePoint, index) => ({
    index,
    point: toFencePlanPoint(facePoint),
    vector: reference.vector,
  }))
}

function getMatchingFaceAnglePairs(
  draftCandidates: FaceAngleCandidate[],
  connectedCandidates: FaceAngleCandidate[],
) {
  const candidates: FaceAnglePair[] = []

  for (const draftCandidate of draftCandidates) {
    for (const connectedCandidate of connectedCandidates) {
      candidates.push({
        draft: draftCandidate,
        connected: connectedCandidate,
        distance: distanceSquared(draftCandidate.point, connectedCandidate.point),
      })
    }
  }

  candidates.sort((a, b) => a.distance - b.distance)

  const exactPairs = candidates.filter((pair) => pair.distance <= 1e-6)
  const sourcePairs = exactPairs.length > 0 ? exactPairs : candidates.slice(0, 1)
  const usedDraftIndexes = new Set<number>()
  const usedConnectedIndexes = new Set<number>()
  const pairs: FaceAnglePair[] = []

  for (const pair of sourcePairs) {
    if (usedDraftIndexes.has(pair.draft.index) || usedConnectedIndexes.has(pair.connected.index)) {
      continue
    }

    usedDraftIndexes.add(pair.draft.index)
    usedConnectedIndexes.add(pair.connected.index)
    pairs.push(pair)

    if (pairs.length === 2) break
  }

  return pairs
}

function getAngleSource(
  endpointPoint: FencePlanPoint,
  endpointDraftVector: FencePlanPoint,
  connectedReference: SegmentAngleReference,
  facePairs: FaceAnglePair[],
): AngleSource {
  if (facePairs.length === 0) {
    return {
      arcCenter: endpointPoint,
      connectedVector: connectedReference.vector,
      draftVector: endpointDraftVector,
    }
  }

  const arc = getAngleArcToSegmentReference(endpointDraftVector, connectedReference)
  const angleDirection: FencePlanPoint = arc
    ? [Math.cos(arc.midAngle), Math.sin(arc.midAngle)]
    : [endpointDraftVector[0], endpointDraftVector[1]]
  const bestPair =
    facePairs
      .map((pair) => {
        const arcCenter: FencePlanPoint = [
          (pair.draft.point[0] + pair.connected.point[0]) / 2,
          (pair.draft.point[1] + pair.connected.point[1]) / 2,
        ]
        const fromEndpoint: FencePlanPoint = [
          arcCenter[0] - endpointPoint[0],
          arcCenter[1] - endpointPoint[1],
        ]

        return {
          pair,
          score: fromEndpoint[0] * angleDirection[0] + fromEndpoint[1] * angleDirection[1],
        }
      })
      .sort((a, b) => b.score - a.score)[0]?.pair ?? facePairs[0]!

  return {
    arcCenter: [
      (bestPair.draft.point[0] + bestPair.connected.point[0]) / 2,
      (bestPair.draft.point[1] + bestPair.connected.point[1]) / 2,
    ],
    connectedVector: bestPair.connected.vector,
    draftVector: bestPair.draft.vector,
  }
}

function getDraftAngleLabels(
  start: FencePlanPoint,
  end: FencePlanPoint,
  segments: SegmentLike[],
  baseY: number,
  previewHeight: number,
  previewThickness: number,
): DraftAngleLabel[] {
  const draftFromStart: FencePlanPoint = [end[0] - start[0], end[1] - start[1]]
  const draftFromEnd: FencePlanPoint = [start[0] - end[0], start[1] - end[1]]
  const draftSegment = buildDraftFenceSegment(start, end, previewThickness)
  const miterData = calculateLevelMiters([...segments, draftSegment].map(toMiterWall))
  const endpoints = [
    { id: 'start', point: start, draftVector: draftFromStart },
    { id: 'end', point: end, draftVector: draftFromEnd },
  ]
  const labels: DraftAngleLabel[] = []
  for (const endpoint of endpoints) {
    const connectedSegment = segments.find((segment) =>
      Boolean(getSegmentAngleReferenceAtPoint(endpoint.point, segment)),
    )
    if (!connectedSegment) continue
    const connectedReference = getSegmentAngleReferenceAtPoint(endpoint.point, connectedSegment)
    if (!connectedReference) continue
    const draftFaceCandidates = getFenceFaceAngleCandidates(endpoint.point, draftSegment, miterData)
    const connectedFaceCandidates = getFenceFaceAngleCandidates(
      endpoint.point,
      connectedSegment,
      miterData,
    )
    const facePairs = getMatchingFaceAnglePairs(draftFaceCandidates, connectedFaceCandidates)
    const { arcCenter, connectedVector, draftVector } = getAngleSource(
      endpoint.point,
      endpoint.draftVector,
      connectedReference,
      facePairs,
    )
    const angle = getAngleToSegmentReference(draftVector, {
      ...connectedReference,
      vector: connectedVector,
    })
    if (angle === null) continue
    const arc = getAngleArcToSegmentReference(draftVector, {
      ...connectedReference,
      vector: connectedVector,
    })
    if (!arc || arc.angle < 0.01) continue
    const draftLength = Math.hypot(draftVector[0], draftVector[1])
    const referenceLength = Math.hypot(connectedVector[0], connectedVector[1])
    const radius = clamp(
      Math.min(draftLength, referenceLength) * 0.28,
      DRAFT_ANGLE_ARC_MIN_RADIUS,
      DRAFT_ANGLE_ARC_MAX_RADIUS,
    )

    labels.push({
      id: endpoint.id,
      label: formatAngleRadians(angle),
      position: [
        arcCenter[0] + Math.cos(arc.midAngle) * (radius + 0.16),
        baseY + previewHeight + DRAFT_ANGLE_LABEL_Y_OFFSET,
        arcCenter[1] + Math.sin(arc.midAngle) * (radius + 0.16),
      ],
      arc: {
        center: arcCenter,
        radius,
        startAngle: arc.startAngle,
        endAngle: arc.endAngle,
        y: baseY + previewHeight + DRAFT_ANGLE_ARC_Y_OFFSET,
      },
    })
  }
  return labels
}

function getDraftMeasurementState(
  start: FencePlanPoint,
  end: FencePlanPoint,
  segments: SegmentLike[],
  unit: 'metric' | 'imperial',
  baseY: number,
  previewHeight: number,
  previewThickness: number,
): DraftMeasurementState {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  if (length < 0.01) return null
  return {
    lengthLabel: formatLinearMeasurement(length, unit),
    lengthPosition: [
      (start[0] + end[0]) / 2,
      baseY + previewHeight + DRAFT_LABEL_Y_OFFSET,
      (start[1] + end[1]) / 2,
    ],
    angleLabels: getDraftAngleLabels(start, end, segments, baseY, previewHeight, previewThickness),
  }
}

function getReferenceSegments(walls: WallNode[], fences: FenceNode[]): SegmentLike[] {
  return [
    ...walls.map((wall) => ({
      id: wall.id,
      start: wall.start,
      end: wall.end,
      curveOffset: wall.curveOffset,
      thickness: wall.thickness,
    })),
    ...fences.map((fence) => ({
      id: fence.id,
      start: fence.start,
      end: fence.end,
      curveOffset: fence.curveOffset,
      thickness: fence.thickness,
    })),
  ]
}

function updateFencePreview(
  mesh: Mesh,
  start: Vector3,
  end: Vector3,
  previewHeight: number,
  previewThickness: number,
) {
  const direction = new Vector3(end.x - start.x, 0, end.z - start.z)
  const length = direction.length()
  if (length < 0.01) {
    mesh.visible = false
    return
  }
  mesh.visible = true
  direction.normalize()
  const geometry = new BoxGeometry(length, previewHeight, previewThickness)
  const angle = Math.atan2(direction.z, direction.x)

  mesh.position.set((start.x + end.x) / 2, start.y + previewHeight / 2, (start.z + end.z) / 2)
  mesh.rotation.y = -angle

  if (mesh.geometry) {
    mesh.geometry.dispose()
  }
  mesh.geometry = geometry
}

function getCurrentLevelElements(): { walls: WallNode[]; fences: FenceNode[] } {
  const currentLevelId = useViewer.getState().selection.levelId
  const { nodes } = useScene.getState()
  if (!currentLevelId) return { walls: [], fences: [] }
  const levelNode = nodes[currentLevelId]
  if (levelNode?.type !== 'level') return { walls: [], fences: [] }
  const children = (levelNode as LevelNode).children.map((childId) => nodes[childId])
  return {
    walls: children.filter((n): n is WallNode => n?.type === 'wall'),
    fences: children.filter((n): n is FenceNode => n?.type === 'fence'),
  }
}

export const FenceTool: React.FC = () => {
  const fenceMode = useEditor((s) => s.continuationByContext.fence)
  if (fenceMode === 'curved') {
    return <SplineFenceDraft />
  }
  return <StraightFenceTool />
}

const StraightFenceTool: React.FC = () => {
  const unit = useViewer((state) => state.unit)
  const isDark = useViewer((state) => getSceneTheme(state.sceneTheme).appearance === 'dark')
  // A placed preset seeds `toolDefaults.fence` before the tool mounts, so
  // the draft preview is drawn at the preset's height / thickness rather
  // than the generic fallbacks. Read through refs so the live event
  // handlers below see the latest values without re-subscribing.
  const fenceDefaults = useEditor((s) => s.toolDefaults.fence)
  const previewHeight =
    typeof fenceDefaults?.height === 'number' ? fenceDefaults.height : FENCE_PREVIEW_HEIGHT
  const previewThickness =
    typeof fenceDefaults?.thickness === 'number' ? fenceDefaults.thickness : FENCE_PREVIEW_THICKNESS
  const previewHeightRef = useRef(previewHeight)
  previewHeightRef.current = previewHeight
  const previewThicknessRef = useRef(previewThickness)
  previewThicknessRef.current = previewThickness
  const cursorRef = useRef<Group>(null)
  const previewRef = useRef<Mesh>(null!)
  const startingPoint = useRef(new Vector3(0, 0, 0))
  const endingPoint = useRef(new Vector3(0, 0, 0))
  const buildingState = useRef(0)
  const [draftMeasurement, setDraftMeasurement] = useState<DraftMeasurementState>(null)
  const measurementColor = isDark ? '#ffffff' : '#111111'
  const measurementShadowColor = isDark ? '#111111' : '#ffffff'

  // Scope seeded defaults to this tool session: clear on deactivation so a
  // later manual fence draw isn't drawn with a stale preset's parameters.
  // Unmount-only (empty deps) — the [unit] effect below must not clear it.
  useEffect(() => () => useEditor.getState().setToolDefaults('fence', null), [])

  useEffect(() => {
    let previousFenceEnd: FencePlanPoint | null = null

    // Alignment candidates — anchors of every alignable object. Refreshed
    // after each segment commits (the new fence becomes a candidate too).
    let alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, '')
    const refreshAlignmentCandidates = () => {
      alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, '')
    }

    // Align the drafted point onto another object's nearest real anchor and
    // publish the guide. Returns the possibly snapped point.
    const alignPoint = (
      point: FencePlanPoint,
      options?: { applySnap?: boolean },
    ): FencePlanPoint => {
      // Figma alignment lines onto existing corners / edges are DISPLAYED in
      // every mode except Off (isAlignmentGuideActive); the magnetic pull onto
      // them is applied only in 'lines' mode (isMagneticSnapActive).
      if (!isAlignmentGuideActive() || alignmentCandidates.length === 0) {
        useAlignmentGuides.getState().clear()
        return point
      }
      const ar = resolveAlignment({
        moving: [{ nodeId: '__fence-draft__', kind: 'corner', x: point[0], z: point[1] }],
        candidates: alignmentCandidates,
        threshold: ALIGNMENT_THRESHOLD_M,
      })
      useAlignmentGuides.getState().set(ar.guides)
      return ar.snap && options?.applySnap !== false && isMagneticSnapActive()
        ? [point[0] + ar.snap.dx, point[1] + ar.snap.dz]
        : point
    }

    const stopDrafting = () => {
      buildingState.current = 0
      previewRef.current.visible = false
      setDraftMeasurement(null)
      useSegmentDraftChain.getState().clear('fence')
      useAlignmentGuides.getState().clear()
    }

    const onGridMove = (event: GridEvent) => {
      if (!(cursorRef.current && previewRef.current)) return
      const { walls, fences } = getCurrentLevelElements()
      const localPoint: FencePlanPoint = [event.localPosition[0], event.localPosition[2]]
      // While drafting, the segment locks to 15° rays from its start.
      // Snapping is governed by the snapping mode (`'off'` is the bypass);
      // there is no Shift hold-to-bypass. Alignment follows the magnetic snap
      // mode, not Alt (continuation is cycled through the HUD / C).

      if (buildingState.current === 1) {
        const angleLocked = isAngleSnapActive()
        const snappedLocal = alignPoint(
          snapFenceDraftPoint({
            point: localPoint,
            walls,
            fences,
            start: angleLocked ? [startingPoint.current.x, startingPoint.current.z] : undefined,
            angleSnap: angleLocked,
            magnetic: isMagneticSnapActive(),
          }),
          { applySnap: !angleLocked },
        )
        endingPoint.current.set(snappedLocal[0], event.localPosition[1], snappedLocal[1])
        cursorRef.current.position.copy(endingPoint.current)
        const currentFenceEnd: FencePlanPoint = [snappedLocal[0], snappedLocal[1]]
        if (
          previousFenceEnd &&
          (currentFenceEnd[0] !== previousFenceEnd[0] || currentFenceEnd[1] !== previousFenceEnd[1])
        ) {
          triggerSFX('sfx:grid-snap')
        }
        previousFenceEnd = currentFenceEnd
        updateFencePreview(
          previewRef.current,
          startingPoint.current,
          endingPoint.current,
          previewHeightRef.current,
          previewThicknessRef.current,
        )
        setDraftMeasurement(
          getDraftMeasurementState(
            [startingPoint.current.x, startingPoint.current.z],
            snappedLocal,
            getReferenceSegments(walls, fences),
            unit,
            startingPoint.current.y,
            previewHeightRef.current,
            previewThicknessRef.current,
          ),
        )
      } else {
        const snappedPoint = alignPoint(
          snapFenceDraftPoint({
            point: localPoint,
            walls,
            fences,
            magnetic: isMagneticSnapActive(),
          }),
        )
        cursorRef.current.position.set(snappedPoint[0], event.localPosition[1], snappedPoint[1])
        setDraftMeasurement(null)
      }
    }

    const onGridClick = (event: GridEvent) => {
      if (!previewRef.current) return
      if (buildingState.current === 1 && event.nativeEvent.detail >= 2) {
        stopDrafting()
        return
      }

      const { walls, fences } = getCurrentLevelElements()
      const localClick: FencePlanPoint = [event.localPosition[0], event.localPosition[2]]

      if (buildingState.current === 0) {
        const snappedStart = alignPoint(
          snapFenceDraftPoint({
            point: localClick,
            walls,
            fences,
            magnetic: isMagneticSnapActive(),
          }),
        )
        startingPoint.current.set(snappedStart[0], event.localPosition[1], snappedStart[1])
        endingPoint.current.copy(startingPoint.current)
        buildingState.current = 1
        triggerSFX('sfx:structure-build-start')
        previewRef.current.visible = true
        setDraftMeasurement(null)
      } else {
        const angleLocked = isAngleSnapActive()
        const snappedEnd = alignPoint(
          snapFenceDraftPoint({
            point: localClick,
            walls,
            fences,
            start: angleLocked ? [startingPoint.current.x, startingPoint.current.z] : undefined,
            angleSnap: angleLocked,
            magnetic: isMagneticSnapActive(),
          }),
          { applySnap: !angleLocked },
        )
        const dx = snappedEnd[0] - startingPoint.current.x
        const dz = snappedEnd[1] - startingPoint.current.z
        if (dx * dx + dz * dz < 0.01 * 0.01) return
        const createdFence = createFenceOnCurrentLevel(
          [startingPoint.current.x, startingPoint.current.z],
          snappedEnd,
        )
        if (!createdFence) return

        // The new segment is now a real node — make it an alignment target
        // for the next segment, and drop the just-shown guide.
        refreshAlignmentCandidates()
        useAlignmentGuides.getState().clear()

        // Single mode commits one segment per click: stop drafting so the next
        // click starts a fresh segment instead of chaining off this endpoint.
        if (useEditor.getState().getContinuation('fence') === 'single') {
          stopDrafting()
          return
        }

        const nextStart = createdFence.end
        // Publish the resolved chain start so the 2D floor-plan draft
        // chains its next segment from the same point (its own snap
        // pipeline can resolve a slightly different endpoint).
        useSegmentDraftChain.getState().setChainStart('fence', [nextStart[0], nextStart[1]])
        startingPoint.current.set(nextStart[0], event.localPosition[1], nextStart[1])
        endingPoint.current.copy(startingPoint.current)
        cursorRef.current?.position.copy(startingPoint.current)
        previewRef.current.visible = false
        buildingState.current = 1
        setDraftMeasurement(null)
      }
    }

    const onCancel = () => {
      if (buildingState.current === 1) {
        markToolCancelConsumed()
        stopDrafting()
      }
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
      useSegmentDraftChain.getState().clear('fence')
      useAlignmentGuides.getState().clear()
    }
  }, [unit])

  return (
    <group>
      <CursorSphere height={previewHeight} ref={cursorRef} />
      <mesh layers={EDITOR_LAYER} ref={previewRef} renderOrder={1} visible={false}>
        <shapeGeometry />
        <meshBasicMaterial
          color="#ffffff"
          depthTest={false}
          depthWrite={false}
          opacity={0.45}
          side={DoubleSide}
          transparent
        />
      </mesh>
      {draftMeasurement && (
        <>
          <DraftMeasurementLabel
            color={measurementColor}
            label={draftMeasurement.lengthLabel}
            position={draftMeasurement.lengthPosition}
            shadowColor={measurementShadowColor}
          />
          {draftMeasurement.angleLabels.map((angleLabel) => (
            <group key={angleLabel.id}>
              <DraftAngleArc arc={angleLabel.arc} color={measurementColor} />
              <DraftMeasurementLabel
                color={measurementColor}
                label={angleLabel.label}
                position={angleLabel.position}
                shadowColor={measurementShadowColor}
              />
            </group>
          ))}
        </>
      )}
    </group>
  )
}

const SPLINE_PREVIEW_COLOR = '#8381ed'
const SPLINE_PREVIEW_SEGMENTS = 40

const SplineFenceDraft: React.FC = () => {
  const previewHeight =
    typeof useEditor.getState().toolDefaults.fence?.height === 'number'
      ? (useEditor.getState().toolDefaults.fence?.height as number)
      : FENCE_PREVIEW_HEIGHT
  const [draftPoints, setDraftPoints] = useState<FencePlanPoint[]>([])
  const [cursor, setCursor] = useState<FencePlanPoint | null>(null)
  const draftRef = useRef(draftPoints)

  draftRef.current = draftPoints

  // Mirror the draft length into the HUD store so the "finish curve" hint only
  // shows once drafting has started; always clear it when the tool unmounts.
  useEffect(() => {
    useFenceCurveDraft.getState().setPointCount(draftPoints.length)
  }, [draftPoints])
  useEffect(() => () => useFenceCurveDraft.getState().reset(), [])

  useEffect(() => () => useEditor.getState().setToolDefaults('fence', null), [])

  useEffect(() => {
    const snapPoint = (local: FencePlanPoint): FencePlanPoint => {
      const step = isGridSnapActive() ? getSegmentGridStep() : 0
      if (step <= 0) return local
      return [snapScalarToGrid(local[0], step), snapScalarToGrid(local[1], step)]
    }

    const commit = () => {
      const points = draftRef.current
      if (points.length >= 2) {
        const created = createSplineFenceOnCurrentLevel(points)
        if (created) {
          triggerSFX('sfx:item-place')
          // Once the new curve fence is selected for direct editing, leave
          // placement mode so the toolbar matches the active interaction.
          useViewer.getState().setSelection({ selectedIds: [created.id] })
          useEditor.getState().setTool(null)
          useEditor.getState().setMode('select')
        }
      }
      setDraftPoints([])
      setCursor(null)
    }

    const onMove = (event: GridEvent) => {
      setCursor(snapPoint([event.localPosition[0], event.localPosition[2]]))
    }

    const onClick = (event: GridEvent) => {
      if (event.nativeEvent.detail >= 2) {
        commit()
        return
      }
      const point = snapPoint([event.localPosition[0], event.localPosition[2]])
      triggerSFX('sfx:grid-snap')
      setDraftPoints((prev) => [...prev, point])
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter') commit()
    }
    const onCancel = () => {
      if (draftRef.current.length === 0) return
      markToolCancelConsumed()
      setDraftPoints((prev) => prev.slice(0, -1))
    }

    emitter.on('grid:move', onMove)
    emitter.on('grid:click', onClick)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      emitter.off('grid:move', onMove)
      emitter.off('grid:click', onClick)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const previewPoints = cursor ? [...draftPoints, cursor] : draftPoints
  const curveGeometry = useMemo(() => {
    if (previewPoints.length < 2) return null
    const sampled = sampleFenceSpline(
      previewPoints,
      getTwoPointFenceCurveTangents(previewPoints),
      SPLINE_PREVIEW_SEGMENTS,
    )
    return new BufferGeometry().setFromPoints(
      sampled.map((point) => new Vector3(point.x, previewHeight, point.y)),
    )
  }, [previewHeight, previewPoints])

  return (
    <group>
      {cursor && <CursorSphere height={previewHeight} position={[cursor[0], 0, cursor[1]]} />}
      {draftPoints.map((point, index) => (
        <mesh
          key={`fence-spline-pt-${index}`}
          layers={EDITOR_LAYER}
          position={[point[0], previewHeight, point[1]]}
        >
          <sphereGeometry args={[0.07, 16, 12]} />
          <meshBasicMaterial color={SPLINE_PREVIEW_COLOR} depthTest={false} />
        </mesh>
      ))}
      {curveGeometry && (
        // @ts-expect-error - R3F accepts Three line primitives here.
        <line frustumCulled={false} geometry={curveGeometry} layers={EDITOR_LAYER} renderOrder={2}>
          <lineBasicNodeMaterial
            color={SPLINE_PREVIEW_COLOR}
            depthTest={false}
            depthWrite={false}
            linewidth={2}
            opacity={0.95}
            transparent
          />
        </line>
      )}
    </group>
  )
}

function DraftAngleArc({ arc, color }: { arc: DraftAngleLabel['arc']; color: string }) {
  const geometry = useMemo(() => {
    const segmentCount = Math.max(
      8,
      Math.ceil((Math.abs(arc.endAngle - arc.startAngle) / Math.PI) * DRAFT_ANGLE_ARC_SEGMENTS),
    )

    const points = Array.from({ length: segmentCount + 1 }, (_, index) => {
      const t = index / segmentCount
      const angle = arc.startAngle + (arc.endAngle - arc.startAngle) * t

      return new Vector3(
        arc.center[0] + Math.cos(angle) * arc.radius,
        arc.y,
        arc.center[1] + Math.sin(angle) * arc.radius,
      )
    })

    return new BufferGeometry().setFromPoints(points)
  }, [arc])

  return (
    // @ts-expect-error - R3F accepts Three line primitives, matching the other editor drawing tools.
    <line frustumCulled={false} geometry={geometry} layers={EDITOR_LAYER} renderOrder={2}>
      <lineBasicNodeMaterial
        color={color}
        depthTest={false}
        depthWrite={false}
        linewidth={2}
        opacity={0.95}
        transparent
      />
    </line>
  )
}

function DraftMeasurementLabel({
  color,
  label,
  position,
  shadowColor,
}: {
  color: string
  label: string
  position: [number, number, number]
  shadowColor: string
}) {
  return (
    <Html
      center
      position={position}
      style={{ pointerEvents: 'none', userSelect: 'none' }}
      zIndexRange={[100, 0]}
    >
      <div
        className="whitespace-nowrap font-bold font-mono text-[15px]"
        style={{
          color,
          textShadow: `-1.5px -1.5px 0 ${shadowColor}, 1.5px -1.5px 0 ${shadowColor}, -1.5px 1.5px 0 ${shadowColor}, 1.5px 1.5px 0 ${shadowColor}, 0 0 4px ${shadowColor}, 0 0 4px ${shadowColor}`,
        }}
      >
        {label}
      </div>
    </Html>
  )
}

export default FenceTool
