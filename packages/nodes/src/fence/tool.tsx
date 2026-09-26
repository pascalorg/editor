'use client'

import {
  type AnyNodeId,
  calculateLevelMiters,
  collectAlignmentAnchors,
  emitter,
  FenceNode,
  GROUND_SUPPORT_ID,
  type GridEvent,
  getWallMiterBoundaryPoints,
  type LevelNode,
  levelBaseElevationAt,
  type Point2D,
  resolveAlignment,
  sampleFenceSpline,
  sceneRegistry,
  spatialGridManager,
  useScene,
  type WallMiterData,
  type WallNode,
} from '@pascal-app/core'
import {
  CursorSphere,
  clearPlacementSurface,
  DraftMeasurementLabel,
  EDITOR_LAYER,
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
  type PointerSupportSurface,
  publishPlacementSurface,
  resolvePointerSupportSurface,
  type SegmentAngleReference,
  snapScalarToGrid,
  triggerSFX,
  useAlignmentGuides,
  useEditor,
  useFenceCurveDraft,
  useFloorplanDraftPreview,
  usePlacementPreview,
  useRegistryToolContext,
  useSegmentDraftChain,
} from '@pascal-app/editor'

import { createSceneSupportHeightSampler, getSceneTheme, useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BufferGeometry, type Camera, DoubleSide, type Group, type Mesh, Vector3 } from 'three'
import {
  DraftAngleArc,
  type DraftAngleLabel,
  type DraftAxisGuideState,
  DraftAxisGuides,
  getNearestAxisAngleLabel,
} from '../shared/draft-axis-guides'
import {
  createFenceOnCurrentLevel,
  createSplineFenceOnCurrentLevel,
  type FencePlanPoint,
  getFenceInheritedDefaults,
  snapFenceDraftPoint,
} from './drafting'
import FenceFeatureTool from './feature-tool'
import { createFenceRailHeightSampler, generateFenceGeometry } from './geometry-parts'

const FENCE_PREVIEW_HEIGHT = 1.8
const FENCE_PREVIEW_THICKNESS = 0.08
// Grid-plane surface publish (pointer-decided): scratch + constant normal so
// per-move publishes don't allocate.
const SURFACE_UP = new Vector3(0, 1, 0)
const surfacePointScratch = new Vector3()

function pointedSurfaceFor(camera: Camera, event: GridEvent): PointerSupportSurface | null {
  if (event.localRay) {
    return resolvePointerSupportSurface(camera, event.position, { includeNodeTopSurfaces: true })
  }

  const levelId = useViewer.getState().selection.levelId
  if (!levelId) return null
  const [x, , z] = event.localPosition
  const pointed = spatialGridManager.getPointedSupportSurface(levelId, [x, 10_000, z], [0, -1, 0])
  const nodes = useScene.getState().nodes
  const supportSlabId = pointed.slabId ?? GROUND_SUPPORT_ID
  const elevation = pointed.slabId ? pointed.elevation : levelBaseElevationAt(nodes, levelId, x, z)
  const levelMesh = sceneRegistry.nodes.get(levelId)
  const world = levelMesh
    ? levelMesh.localToWorld(new Vector3(x, elevation, z))
    : new Vector3(
        event.position[0],
        event.position[1] + elevation - event.localPosition[1],
        event.position[2],
      )
  const buildingId = useViewer.getState().selection.buildingId
  const buildingMesh = buildingId ? sceneRegistry.nodes.get(buildingId) : null
  const local = buildingMesh
    ? buildingMesh.worldToLocal(world.clone())
    : new Vector3(x, elevation, z)
  return {
    elevation,
    supportSlabId,
    sourceNodeId: null,
    worldY: world.y,
    worldPoint: [world.x, world.y, world.z],
    localPoint: [local.x, local.y, local.z],
  }
}
/** Figma-style alignment-snap threshold (meters), matching the move tools. */
const ALIGNMENT_THRESHOLD_M = 0.08
// HUD label heights are measured from the top of the preview bar, so they
// track whatever height a seeded preset draws at (`previewHeight`).
const DRAFT_LABEL_Y_OFFSET = 0.22
const DRAFT_ANGLE_LABEL_Y_OFFSET = 0.08
const DRAFT_ANGLE_ARC_Y_OFFSET = 0.012
const DRAFT_ANGLE_ARC_MIN_RADIUS = 0.32
const DRAFT_ANGLE_ARC_MAX_RADIUS = 0.72

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
  metricNotation: 'meters' | 'millimeters',
  baseY: number,
  previewHeight: number,
  previewThickness: number,
): DraftMeasurementState {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  if (length < 0.01) return null
  return {
    lengthLabel: formatLinearMeasurement(length, unit, metricNotation),
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
  const angle = Math.atan2(direction.z, direction.x)

  mesh.position.set((start.x + end.x) / 2, start.y + previewHeight / 2, (start.z + end.z) / 2)
  mesh.rotation.y = -angle
  mesh.scale.set(length, previewHeight, previewThickness)
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
  const feature = useEditor((s) => s.toolDefaults.fence?.featurePlacement)
  if (feature === 'gate' || feature === 'opening') return <FenceFeatureTool kind={feature} />
  if (fenceMode === 'curved') {
    return <SplineFenceDraft />
  }
  if (fenceMode === 'freehand') return <SplineFenceDraft freehand />
  return <StraightFenceTool />
}

const StraightFenceTool: React.FC = () => {
  const { activeLevelId, sceneApi } = useRegistryToolContext()
  const draftContext = useMemo(
    () => ({ sceneApi, levelId: activeLevelId }),
    [sceneApi, activeLevelId],
  )
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const isDark = useViewer((state) => getSceneTheme(state.sceneTheme).appearance === 'dark')
  // A placed preset seeds `toolDefaults.fence` before the tool mounts, so
  // the draft preview is drawn at the preset's height / thickness rather
  // than the generic fallbacks. Read through refs so the live event
  // handlers below see the latest values without re-subscribing.
  const fenceDefaults = useEditor((s) => s.toolDefaults.fence)
  const startingPoint = useRef(new Vector3(0, 0, 0))
  const buildingState = useRef(0)
  const inheritedPreview =
    buildingState.current === 1
      ? getFenceInheritedDefaults([startingPoint.current.x, startingPoint.current.z], draftContext)
      : null
  const effectiveDefaults = { ...fenceDefaults, ...inheritedPreview }
  const previewHeight =
    typeof effectiveDefaults.height === 'number' ? effectiveDefaults.height : FENCE_PREVIEW_HEIGHT
  const previewThickness =
    typeof effectiveDefaults.thickness === 'number'
      ? effectiveDefaults.thickness
      : FENCE_PREVIEW_THICKNESS
  const previewHeightRef = useRef(previewHeight)
  previewHeightRef.current = previewHeight
  const previewThicknessRef = useRef(previewThickness)
  previewThicknessRef.current = previewThickness
  // Camera for the pointer-support resolution (deck top vs floor) — read
  // through a ref so the live event handlers see the current camera.
  const camera = useThree((state) => state.camera)
  const cameraRef = useRef(camera)
  cameraRef.current = camera
  const cursorRef = useRef<Group>(null)
  const previewRef = useRef<Mesh>(null!)
  const endingPoint = useRef(new Vector3(0, 0, 0))
  const constructionSurface = useRef<PointerSupportSurface | null>(null)
  const [draftMeasurement, setDraftMeasurement] = useState<DraftMeasurementState>(null)
  const [axisGuide, setAxisGuide] = useState<DraftAxisGuideState>(null)
  const measurementColor = isDark ? '#ffffff' : '#111111'
  const measurementShadowColor = isDark ? '#111111' : '#ffffff'

  // Scope seeded defaults to this tool session: clear on deactivation so a
  // later manual fence draw isn't drawn with a stale preset's parameters.
  // Unmount-only (empty deps) — the [unit] effect below must not clear it.
  useEffect(
    () => () => {
      if (!useEditor.getState().toolDefaults.fence?.featurePlacement)
        useEditor.getState().setToolDefaults('fence', null)
    },
    [],
  )

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
      constructionSurface.current = null
      previewRef.current.visible = false
      setDraftMeasurement(null)
      setAxisGuide(null)
      const draftPreview = useFloorplanDraftPreview.getState()
      draftPreview.setFenceDraftStart(null)
      draftPreview.setFenceDraftEnd(null)
      useSegmentDraftChain.getState().clear('fence')
      useAlignmentGuides.getState().clear()
    }

    const onGridMove = (event: GridEvent) => {
      if (!(cursorRef.current && previewRef.current)) return
      // Ride the grid event plane on the pointed surface: aiming at an
      // elevated deck lifts the plane to the deck top, so the draft's XZ
      // lands where the cursor points and the preview/cursor Y
      // (`event.localPosition[1]`) sits at the lift the committed fence
      // will get. Aiming past the deck edge drops it back to the floor.
      const pointed = pointedSurfaceFor(cameraRef.current, event)
      const activeSurface = constructionSurface.current ?? pointed
      if (activeSurface) {
        publishPlacementSurface(
          surfacePointScratch.set(event.position[0], activeSurface.worldY, event.position[2]),
          SURFACE_UP,
        )
      }
      const activeY = activeSurface?.localPoint?.[1] ?? event.localPosition[1]
      const { walls, fences } = getCurrentLevelElements()
      const pointedLocal = buildingState.current === 0 ? pointed?.localPoint : null
      const localPoint: FencePlanPoint = [
        pointedLocal?.[0] ?? event.localPosition[0],
        pointedLocal?.[2] ?? event.localPosition[2],
      ]
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
        endingPoint.current.set(snappedLocal[0], activeY, snappedLocal[1])
        const draftPreview = useFloorplanDraftPreview.getState()
        draftPreview.setFenceDraftStart([startingPoint.current.x, startingPoint.current.z])
        draftPreview.setFenceDraftEnd(snappedLocal)
        cursorRef.current.position.copy(endingPoint.current)
        setAxisGuide({
          origin: [startingPoint.current.x, startingPoint.current.z],
          endOrigin: snappedLocal,
          y: startingPoint.current.y,
          angleLabel: getNearestAxisAngleLabel(
            [startingPoint.current.x, startingPoint.current.z],
            snappedLocal,
            startingPoint.current.y,
          ),
        })
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
            metricNotation,
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
        cursorRef.current.position.set(snappedPoint[0], activeY, snappedPoint[1])
        setDraftMeasurement(null)
        setAxisGuide(null)
      }
    }

    const onGridClick = (event: GridEvent) => {
      if (!previewRef.current) return
      if (buildingState.current === 1 && event.nativeEvent.detail >= 2) {
        stopDrafting()
        return
      }

      const { walls, fences } = getCurrentLevelElements()
      const pointed = pointedSurfaceFor(cameraRef.current, event)
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
        startingPoint.current.set(
          snappedStart[0],
          pointed?.localPoint?.[1] ?? event.localPosition[1],
          snappedStart[1],
        )
        constructionSurface.current = pointed
        endingPoint.current.copy(startingPoint.current)
        buildingState.current = 1
        const draftPreview = useFloorplanDraftPreview.getState()
        draftPreview.setFenceDraftStart(snappedStart)
        draftPreview.setFenceDraftEnd(snappedStart)
        triggerSFX('sfx:structure-build-start')
        previewRef.current.visible = true
        setDraftMeasurement(null)
        setAxisGuide({
          origin: snappedStart,
          endOrigin: null,
          y: event.localPosition[1],
          angleLabel: null,
        })
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
        const pointedSurface = constructionSurface.current ?? pointed
        const createdFence = createFenceOnCurrentLevel(
          [startingPoint.current.x, startingPoint.current.z],
          snappedEnd,
          {
            supportCap: pointedSurface?.elevation ?? null,
            preferredSupportSlabId: pointedSurface?.supportSlabId ?? null,
            constructionElevation: pointedSurface?.sourceNodeId ? pointedSurface.elevation : null,
          },
          draftContext,
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
        startingPoint.current.set(
          nextStart[0],
          constructionSurface.current?.localPoint?.[1] ?? event.localPosition[1],
          nextStart[1],
        )
        endingPoint.current.copy(startingPoint.current)
        const draftPreview = useFloorplanDraftPreview.getState()
        draftPreview.setFenceDraftEnd(null)
        draftPreview.setFenceDraftStart(nextStart)
        draftPreview.setFenceDraftEnd(nextStart)
        cursorRef.current?.position.copy(startingPoint.current)
        previewRef.current.visible = false
        buildingState.current = 1
        setDraftMeasurement(null)
        setAxisGuide({
          origin: nextStart,
          endOrigin: null,
          y: event.localPosition[1],
          angleLabel: null,
        })
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
      clearPlacementSurface()
      useSegmentDraftChain.getState().clear('fence')
      useAlignmentGuides.getState().clear()
      const draftPreview = useFloorplanDraftPreview.getState()
      draftPreview.setFenceDraftStart(null)
      draftPreview.setFenceDraftEnd(null)
    }
  }, [unit, metricNotation, draftContext])

  return (
    <group>
      <DraftAxisGuides
        guide={axisGuide}
        labelColor={measurementColor}
        labelShadowColor={measurementShadowColor}
      />
      <CursorSphere height={previewHeight} ref={cursorRef} />
      <mesh layers={EDITOR_LAYER} ref={previewRef} renderOrder={1} visible={false}>
        <boxGeometry />
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
const FREEHAND_SAMPLE_DISTANCE = 0.2
const FREEHAND_SIMPLIFY_TOLERANCE = 0.08
const FREEHAND_MAX_CONTROL_POINTS = 64

function simplifyFreehandPath(
  points: FencePlanPoint[],
  tolerance = FREEHAND_SIMPLIFY_TOLERANCE,
): FencePlanPoint[] {
  if (points.length <= 2) return points

  let threshold = tolerance * tolerance
  while (true) {
    const keep = new Uint8Array(points.length)
    keep[0] = 1
    keep[points.length - 1] = 1
    const ranges: Array<[number, number]> = [[0, points.length - 1]]

    while (ranges.length > 0) {
      const [start, end] = ranges.pop()!
      const a = points[start]!
      const b = points[end]!
      const dx = b[0] - a[0]
      const dz = b[1] - a[1]
      const lengthSquared = dx * dx + dz * dz
      let farthestIndex = -1
      let farthestDistanceSquared = threshold

      for (let index = start + 1; index < end; index += 1) {
        const point = points[index]!
        const t =
          lengthSquared > 1e-9
            ? Math.max(
                0,
                Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / lengthSquared),
              )
            : 0
        const offsetX = point[0] - (a[0] + dx * t)
        const offsetZ = point[1] - (a[1] + dz * t)
        const distanceSquared = offsetX * offsetX + offsetZ * offsetZ
        if (distanceSquared > farthestDistanceSquared) {
          farthestDistanceSquared = distanceSquared
          farthestIndex = index
        }
      }

      if (farthestIndex >= 0) {
        keep[farthestIndex] = 1
        ranges.push([start, farthestIndex], [farthestIndex, end])
      }
    }

    const simplified = points.filter((_, index) => keep[index] === 1)
    if (simplified.length <= FREEHAND_MAX_CONTROL_POINTS) return simplified
    threshold *= 2.25
  }
}

const SplineFenceDraft: React.FC<{ freehand?: boolean }> = ({ freehand = false }) => {
  const { activeLevelId, sceneApi } = useRegistryToolContext()
  const draftContext = useMemo(
    () => ({ sceneApi, levelId: activeLevelId }),
    [sceneApi, activeLevelId],
  )
  const fenceDefaults = useEditor((state) => state.toolDefaults.fence)
  const sceneNodes = useScene((state) => state.nodes)
  const levelId = useViewer((state) => state.selection.levelId)
  const [draftPoints, setDraftPoints] = useState<FencePlanPoint[]>([])
  const inheritedPreview = useMemo(
    () =>
      draftPoints[0] ? getFenceInheritedDefaults(draftPoints[0], draftContext, sceneNodes) : null,
    [draftPoints[0], sceneNodes, draftContext],
  )
  const effectiveDefaults = useMemo(
    () => ({ ...fenceDefaults, ...inheritedPreview }),
    [fenceDefaults, inheritedPreview],
  )
  const previewHeight =
    typeof effectiveDefaults.height === 'number' ? effectiveDefaults.height : FENCE_PREVIEW_HEIGHT
  const [cursor, setCursor] = useState<FencePlanPoint | null>(null)
  // Building-local Y of the grid plane (rides the pointed surface — see
  // `pointedSurfaceFor`), so the spline preview draws on the deck top when
  // the curve is being laid out on one.
  const [liftY, setLiftY] = useState(0)
  const camera = useThree((state) => state.camera)
  const cameraRef = useRef(camera)
  cameraRef.current = camera
  const draftRef = useRef(draftPoints)
  const freehandSamplesRef = useRef<FencePlanPoint[]>([])
  const isSketchingRef = useRef(false)

  draftRef.current = draftPoints

  // Mirror the full transient curve so additional preview surfaces observe
  // the same snapped control points as the local preview.
  useEffect(() => {
    useFenceCurveDraft.getState().setDraft(draftPoints, cursor)
  }, [cursor, draftPoints])
  useEffect(() => () => useFenceCurveDraft.getState().reset(), [])

  useEffect(
    () => () => {
      if (!useEditor.getState().toolDefaults.fence?.featurePlacement)
        useEditor.getState().setToolDefaults('fence', null)
    },
    [],
  )

  useEffect(() => {
    const snapPoint = (local: FencePlanPoint): FencePlanPoint => {
      if (freehand) return local
      const step = isGridSnapActive() ? getSegmentGridStep() : 0
      if (step <= 0) return local
      return [snapScalarToGrid(local[0], step), snapScalarToGrid(local[1], step)]
    }

    const commit = (points = draftRef.current) => {
      if (points.length >= 2) {
        const created = createSplineFenceOnCurrentLevel(points, undefined, draftContext)
        if (created) {
          triggerSFX('sfx:item-place')
          // Once the new curve fence is selected for direct editing, leave
          // placement mode so the toolbar matches the active interaction.
          useViewer.getState().setSelection({ selectedIds: [created.id] })
          useEditor.getState().setTool(null)
          useEditor.getState().setMode('select')
        }
      }
      draftRef.current = []
      freehandSamplesRef.current = []
      isSketchingRef.current = false
      setDraftPoints([])
      setCursor(null)
    }

    const trackPointedSurface = (event: GridEvent) => {
      const pointed = pointedSurfaceFor(cameraRef.current, event)
      const activeSurface = pointed
      if (!activeSurface) return null
      publishPlacementSurface(
        surfacePointScratch.set(event.position[0], activeSurface.worldY, event.position[2]),
        SURFACE_UP,
      )
      setLiftY(activeSurface.localPoint?.[1] ?? event.localPosition[1])
      return pointed
    }

    const onMove = (event: GridEvent) => {
      const pointed = trackPointedSurface(event)
      const point = snapPoint([
        pointed?.localPoint?.[0] ?? event.localPosition[0],
        pointed?.localPoint?.[2] ?? event.localPosition[2],
      ])
      setCursor(point)
      if (freehand && isSketchingRef.current) {
        const last = freehandSamplesRef.current.at(-1)
        if (
          last &&
          Math.hypot(point[0] - last[0], point[1] - last[1]) >= FREEHAND_SAMPLE_DISTANCE
        ) {
          const samples = [...freehandSamplesRef.current, point]
          freehandSamplesRef.current = samples
          const next = simplifyFreehandPath(samples)
          draftRef.current = next
          setDraftPoints(next)
        }
      }
    }

    const onPointerDown = (event: GridEvent) => {
      if (!freehand || event.nativeEvent.button !== 0) return
      const pointed = trackPointedSurface(event)
      const point = snapPoint([
        pointed?.localPoint?.[0] ?? event.localPosition[0],
        pointed?.localPoint?.[2] ?? event.localPosition[2],
      ])
      isSketchingRef.current = true
      freehandSamplesRef.current = [point]
      draftRef.current = [point]
      setDraftPoints([point])
      setCursor(point)
    }

    const onPointerUp = (event: GridEvent) => {
      if (!freehand || !isSketchingRef.current) return
      isSketchingRef.current = false
      const pointed = trackPointedSurface(event)
      const point = snapPoint([
        pointed?.localPoint?.[0] ?? event.localPosition[0],
        pointed?.localPoint?.[2] ?? event.localPosition[2],
      ])
      const previous = freehandSamplesRef.current
      const last = previous.at(-1)
      const samples =
        last && Math.hypot(point[0] - last[0], point[1] - last[1]) < 0.03
          ? previous
          : [...previous, point]
      freehandSamplesRef.current = samples
      const next = simplifyFreehandPath(samples)
      draftRef.current = next
      setDraftPoints(next)
      commit(next)
    }

    const onClick = (event: GridEvent) => {
      if (freehand) return
      const pointed = trackPointedSurface(event)
      if (event.nativeEvent.detail >= 2) {
        commit()
        return
      }
      const point = snapPoint([
        pointed?.localPoint?.[0] ?? event.localPosition[0],
        pointed?.localPoint?.[2] ?? event.localPosition[2],
      ])
      triggerSFX('sfx:grid-snap')
      setDraftPoints((prev) => [...prev, point])
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter') commit()
    }
    const onCancel = () => {
      if (draftRef.current.length === 0) return
      markToolCancelConsumed()
      isSketchingRef.current = false
      if (freehand) {
        draftRef.current = []
        freehandSamplesRef.current = []
        setDraftPoints([])
        setCursor(null)
        return
      }
      setDraftPoints((prev) => prev.slice(0, -1))
    }

    emitter.on('grid:move', onMove)
    emitter.on('grid:click', onClick)
    emitter.on('grid:pointerdown', onPointerDown)
    emitter.on('grid:pointerup', onPointerUp)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      emitter.off('grid:move', onMove)
      emitter.off('grid:click', onClick)
      emitter.off('grid:pointerdown', onPointerDown)
      emitter.off('grid:pointerup', onPointerUp)
      emitter.off('tool:cancel', onCancel)
      clearPlacementSurface()
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [freehand, draftContext])

  const previewPoints = useMemo(() => {
    const last = draftPoints.at(-1)
    return cursor && last && !pointMatches(last, cursor) ? [...draftPoints, cursor] : draftPoints
  }, [cursor, draftPoints])
  const previewNode = useMemo(() => {
    if (previewPoints.length < 2) return null
    return FenceNode.parse({
      ...effectiveDefaults,
      id: 'fence_curve_preview',
      start: previewPoints[0],
      end: previewPoints.at(-1),
      path: previewPoints,
      tangents: undefined,
    })
  }, [effectiveDefaults, previewPoints])
  const previewGroundAt = useMemo(() => {
    if (!levelId || !previewNode) return null
    const selectedHost =
      previewNode.surfaceMode === 'selected'
        ? ((previewNode.supportSurfaceNodeId ?? previewNode.supportSlabId) as AnyNodeId | undefined)
        : undefined
    const sampledSupport = createSceneSupportHeightSampler(sceneNodes, levelId, selectedHost)
    const startHeight = sampledSupport(previewNode.start[0], previewNode.start[1])
    const samples = new Map<string, number>()
    return (x: number, z: number) => {
      const key = `${x},${z}`
      const cached = samples.get(key)
      if (cached !== undefined) return cached
      const height = previewNode.surfaceMode === 'level' ? startHeight : sampledSupport(x, z)
      samples.set(key, height)
      return height
    }
  }, [levelId, previewNode, sceneNodes])
  const previewStartGround = previewNode
    ? (previewGroundAt?.(previewNode.start[0], previewNode.start[1]) ?? 0)
    : 0
  const previewLift = previewGroundAt ? previewStartGround : liftY
  const ghostGeometry = useMemo(
    () =>
      previewNode
        ? generateFenceGeometry(
            previewNode,
            previewGroundAt ? (x, z) => previewGroundAt(x, z) - previewStartGround : undefined,
          )
        : null,
    [previewNode, previewGroundAt, previewStartGround],
  )
  useEffect(() => () => ghostGeometry?.dispose(), [ghostGeometry])
  useEffect(() => {
    usePlacementPreview.getState().set(previewNode)
  }, [previewNode])
  useEffect(() => () => usePlacementPreview.getState().clear(), [])
  const curveGeometry = useMemo(() => {
    if (previewPoints.length < 2 || previewNode?.transitionMode !== 'slope') return null
    const sampled = sampleFenceSpline(previewPoints, undefined, SPLINE_PREVIEW_SEGMENTS)
    const railHeightAt = previewGroundAt
      ? createFenceRailHeightSampler(
          previewNode,
          (x, z) => previewGroundAt(x, z) - previewStartGround,
        )
      : null
    return new BufferGeometry().setFromPoints(
      sampled.map(
        (point) =>
          new Vector3(
            point.x,
            previewLift + previewHeight + (railHeightAt?.(point.x, point.y) ?? 0),
            point.y,
          ),
      ),
    )
  }, [previewLift, previewGroundAt, previewHeight, previewNode, previewPoints, previewStartGround])
  useEffect(() => () => curveGeometry?.dispose(), [curveGeometry])

  return (
    <group>
      {ghostGeometry && (
        <mesh
          geometry={ghostGeometry}
          layers={EDITOR_LAYER}
          position={[0, previewLift + (previewNode?.supportOffset ?? 0), 0]}
          raycast={() => {}}
          renderOrder={1}
        >
          <meshBasicMaterial color="#ffffff" depthWrite={false} opacity={0.45} transparent />
        </mesh>
      )}
      {cursor && (
        <CursorSphere
          height={previewHeight}
          position={[
            cursor[0],
            previewLift +
              (previewGroundAt ? previewGroundAt(cursor[0], cursor[1]) - previewStartGround : 0),
            cursor[1],
          ]}
        />
      )}
      {draftPoints.map((point, index) => (
        <mesh
          key={`fence-spline-pt-${index}`}
          layers={EDITOR_LAYER}
          position={[
            point[0],
            previewLift +
              (previewGroundAt ? previewGroundAt(point[0], point[1]) - previewStartGround : 0) +
              previewHeight,
            point[1],
          ]}
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

export default FenceTool
