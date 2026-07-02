import {
  type AnyNode,
  calculateLevelMiters,
  collectAlignmentAnchors,
  emitter,
  type GridEvent,
  getWallMiterBoundaryPoints,
  type LevelNode,
  type Point2D,
  resolveAlignment,
  resolveBuildingForLevel,
  useScene,
  type WallMiterData,
  type WallNode,
  wallClosesRoom,
} from '@pascal-app/core'
import {
  CursorSphere,
  createWallOnCurrentLevel,
  EDITOR_LAYER,
  formatAngleRadians,
  formatLinearMeasurement,
  getAngleArcToSegmentReference,
  getAngleToSegmentReference,
  getSegmentAngleReferenceAtPoint,
  isAlignmentGuideActive,
  isAngleSnapActive,
  isMagneticSnapActive,
  markToolCancelConsumed,
  type SegmentAngleReference,
  snapWallDraftPointDetailed,
  triggerSFX,
  useAlignmentGuides,
  useEditor,
  useSegmentDraftChain,
  useWallSnapIndicator,
  WALL_CONNECT_SNAP_RADIUS,
  WALL_JOIN_SNAP_RADIUS,
  type WallPlanPoint,
} from '@pascal-app/editor'
import { getSceneTheme, useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BoxGeometry, BufferGeometry, DoubleSide, type Group, type Mesh, Vector3 } from 'three'

/**
 * Phase 5 Stage D — wall placement tool (kind-owned).
 *
 * 1:1 port of the legacy `WallTool`. Two-click flow: click 1 sets the
 * start, click 2 creates the wall. Between clicks a vertical preview
 * rectangle + length/angle measurement HUD follow the pointer. Snapping is
 * governed by the global snapping mode (`'off'` is the bypass); Esc cancels.
 *
 * Not a `DragAction` — same reasoning as fence/slab/ceiling placement:
 * stateful sequence of grid:click events, not a single drag-up.
 *
 * Mounted via `def.tool` from `wall/definition.ts`.
 */
const WALL_HEIGHT = 2.5
const DRAFT_WALL_THICKNESS = 0.1
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
const DRAFT_AXIS_GUIDE_LENGTH = 2000
const DRAFT_AXIS_GUIDE_WIDTH = 0.035
const DRAFT_AXIS_GUIDE_HEIGHT = 0.004
const DRAFT_AXIS_GUIDE_Y_OFFSET = 0.026
const DRAFT_AXIS_ANGLE_ARC_Y_OFFSET = 0.05
const DRAFT_AXIS_ANGLE_LABEL_Y_OFFSET = 0.16
const DRAFT_AXIS_ANGLE_ARC_MIN_RADIUS = 0.36
const DRAFT_AXIS_ANGLE_ARC_MAX_RADIUS = 0.82
const AXIS_ANGLE_REFERENCES: SegmentAngleReference[] = [
  { vector: [1, 0], orientation: 'axis' },
  { vector: [0, 1], orientation: 'axis' },
]

type DraftAngleLabel = {
  id: string
  label: string
  position: [number, number, number]
  arc: {
    center: WallPlanPoint
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

type DraftAxisGuideState = {
  origin: WallPlanPoint
  y: number
  angleLabel: DraftAngleLabel | null
} | null

type AxisAngleCandidate = {
  angle: number
  arc: {
    startAngle: number
    endAngle: number
    midAngle: number
  }
}

type FaceAngleCandidate = {
  index: number
  point: WallPlanPoint
  vector: WallPlanPoint
}

type FaceAnglePair = {
  draft: FaceAngleCandidate
  connected: FaceAngleCandidate
  distance: number
}

type AngleSource = {
  arcCenter: WallPlanPoint
  connectedVector: WallPlanPoint
  draftVector: WallPlanPoint
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function distanceSquared(a: WallPlanPoint, b: WallPlanPoint) {
  const dx = a[0] - b[0]
  const dz = a[1] - b[1]

  return dx * dx + dz * dz
}

function pointMatches(a: WallPlanPoint, b: WallPlanPoint, tolerance = 1e-5) {
  return distanceSquared(a, b) <= tolerance * tolerance
}

function isWithinWallJoinSnapRadius(point: WallPlanPoint, vertex: Vector3) {
  const dx = point[0] - vertex.x
  const dz = point[1] - vertex.z

  return dx * dx + dz * dz <= WALL_JOIN_SNAP_RADIUS * WALL_JOIN_SNAP_RADIUS
}

function getNearestAxisAngleLabel(
  start: WallPlanPoint,
  end: WallPlanPoint,
  y: number,
): DraftAngleLabel | null {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  if (length < 0.01) return null

  const draftVector: WallPlanPoint = [dx, dz]
  const axisCandidates: AxisAngleCandidate[] = []
  for (const reference of AXIS_ANGLE_REFERENCES) {
    const angle = getAngleToSegmentReference(draftVector, reference)
    const arc = getAngleArcToSegmentReference(draftVector, reference)
    if (!(angle === null || arc === null)) {
      axisCandidates.push({ angle, arc })
    }
  }
  const nearestAxisAngle = axisCandidates.sort((a, b) => a.angle - b.angle)[0]
  if (!nearestAxisAngle) return null

  const radius = clamp(
    length * 0.22,
    DRAFT_AXIS_ANGLE_ARC_MIN_RADIUS,
    DRAFT_AXIS_ANGLE_ARC_MAX_RADIUS,
  )
  const { angle, arc } = nearestAxisAngle

  return {
    id: 'axis',
    label: formatAngleRadians(angle),
    position: [
      start[0] + Math.cos(arc.midAngle) * (radius + 0.16),
      y + DRAFT_AXIS_ANGLE_LABEL_Y_OFFSET,
      start[1] + Math.sin(arc.midAngle) * (radius + 0.16),
    ],
    arc: {
      center: start,
      radius,
      startAngle: arc.startAngle,
      endAngle: arc.endAngle,
      y: y + DRAFT_AXIS_ANGLE_ARC_Y_OFFSET,
    },
  }
}

function toWallPlanPoint(point: Point2D): WallPlanPoint {
  return [point.x, point.y]
}

function getWallEndpointKind(point: WallPlanPoint, wall: WallNode): 'start' | 'end' | null {
  if (pointMatches(point, wall.start)) return 'start'
  if (pointMatches(point, wall.end)) return 'end'

  return null
}

function buildDraftWall(start: WallPlanPoint, end: WallPlanPoint): WallNode {
  return {
    object: 'node',
    id: 'wall_draft' as WallNode['id'],
    type: 'wall',
    name: 'Draft wall',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    start,
    end,
    thickness: DRAFT_WALL_THICKNESS,
    frontSide: 'unknown',
    backSide: 'unknown',
  }
}

function getWallFaceAngleCandidates(
  point: WallPlanPoint,
  wall: WallNode,
  miterData: WallMiterData,
): FaceAngleCandidate[] {
  const endpoint = getWallEndpointKind(point, wall)
  const reference = getSegmentAngleReferenceAtPoint(point, wall)
  if (!(endpoint && reference)) return []

  const boundaryPoints = getWallMiterBoundaryPoints(wall, miterData)
  if (!boundaryPoints) return []

  const points =
    endpoint === 'start'
      ? [boundaryPoints.startLeft, boundaryPoints.startRight]
      : [boundaryPoints.endLeft, boundaryPoints.endRight]

  return points.map((facePoint, index) => ({
    index,
    point: toWallPlanPoint(facePoint),
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
  endpointPoint: WallPlanPoint,
  endpointDraftVector: WallPlanPoint,
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
  const angleDirection: WallPlanPoint = arc
    ? [Math.cos(arc.midAngle), Math.sin(arc.midAngle)]
    : [endpointDraftVector[0], endpointDraftVector[1]]
  const bestPair =
    facePairs
      .map((pair) => {
        const arcCenter: WallPlanPoint = [
          (pair.draft.point[0] + pair.connected.point[0]) / 2,
          (pair.draft.point[1] + pair.connected.point[1]) / 2,
        ]
        const fromEndpoint: WallPlanPoint = [
          arcCenter[0] - endpointPoint[0],
          arcCenter[1] - endpointPoint[1],
        ]

        return {
          arcCenter,
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
  start: WallPlanPoint,
  end: WallPlanPoint,
  walls: WallNode[],
  baseY: number,
  previewHeight: number,
): DraftAngleLabel[] {
  const draftFromStart: WallPlanPoint = [end[0] - start[0], end[1] - start[1]]
  const draftFromEnd: WallPlanPoint = [start[0] - end[0], start[1] - end[1]]
  const draftWall = buildDraftWall(start, end)
  const miterData = calculateLevelMiters([...walls, draftWall])
  const endpoints = [
    { id: 'start', point: start, draftVector: draftFromStart },
    { id: 'end', point: end, draftVector: draftFromEnd },
  ]
  const labels: DraftAngleLabel[] = []

  for (const endpoint of endpoints) {
    const connectedWall = walls.find((wall) =>
      Boolean(getSegmentAngleReferenceAtPoint(endpoint.point, wall)),
    )
    if (!connectedWall) continue
    const connectedReference = getSegmentAngleReferenceAtPoint(endpoint.point, connectedWall)
    if (!connectedReference) continue

    const draftFaceCandidates = getWallFaceAngleCandidates(endpoint.point, draftWall, miterData)
    const connectedFaceCandidates = getWallFaceAngleCandidates(
      endpoint.point,
      connectedWall,
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
  start: WallPlanPoint,
  end: WallPlanPoint,
  walls: WallNode[],
  unit: 'metric' | 'imperial',
  baseY: number,
  previewHeight: number,
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
    angleLabels: getDraftAngleLabels(start, end, walls, baseY, previewHeight),
  }
}

function updateWallPreview(
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

function getLevelWalls(levelId: string | null, nodes: Record<string, AnyNode>): WallNode[] {
  if (!levelId) return []
  const levelNode = nodes[levelId]
  if (levelNode?.type !== 'level') return []
  return (levelNode as LevelNode).children
    .map((childId) => nodes[childId])
    .filter((node): node is WallNode => node?.type === 'wall')
}

function getCurrentLevelWalls(): WallNode[] {
  const currentLevelId = useViewer.getState().selection.levelId
  const { nodes } = useScene.getState()
  return getLevelWalls(currentLevelId ?? null, nodes)
}

// Walls on the level directly beneath the active one. Levels share the same
// local XZ origin (they only differ in world Y), so these walls live in the
// identical coordinate frame and can be fed straight into the snap pipeline —
// letting the user draw a new wall aligned with the floor below. They are
// snap references only; `createWallOnCurrentLevel` re-derives its own
// current-level wall list, so the floor below is never split or mutated.
function getBelowLevelWalls(): WallNode[] {
  const currentLevelId = useViewer.getState().selection.levelId
  const { nodes } = useScene.getState()
  if (!currentLevelId) return []
  const currentLevel = nodes[currentLevelId]
  if (currentLevel?.type !== 'level') return []
  const buildingId = resolveBuildingForLevel(currentLevelId, nodes)
  if (!buildingId) return []
  const building = nodes[buildingId]
  if (building?.type !== 'building') return []
  const currentIndex = (currentLevel as LevelNode).level
  const belowLevel = (building.children ?? [])
    .map((childId) => nodes[childId])
    .filter((node): node is LevelNode => node?.type === 'level' && node.level < currentIndex)
    .sort((a, b) => b.level - a.level)[0]
  return getLevelWalls(belowLevel?.id ?? null, nodes)
}

export const WallTool: React.FC = () => {
  const unit = useViewer((state) => state.unit)
  const isDark = useViewer((state) => getSceneTheme(state.sceneTheme).appearance === 'dark')
  // A placed wall preset seeds `toolDefaults.wall` (height / thickness …)
  // before the tool mounts, so the draft preview is drawn at the preset's
  // dimensions rather than the generic fallbacks — matching the wall that
  // will be created. Read through refs so the live event handlers below see
  // the latest values without re-subscribing.
  const wallDefaults = useEditor((s) => s.toolDefaults.wall)
  const previewHeight = typeof wallDefaults?.height === 'number' ? wallDefaults.height : WALL_HEIGHT
  const previewThickness =
    typeof wallDefaults?.thickness === 'number' ? wallDefaults.thickness : DRAFT_WALL_THICKNESS
  const previewHeightRef = useRef(previewHeight)
  previewHeightRef.current = previewHeight
  const previewThicknessRef = useRef(previewThickness)
  previewThicknessRef.current = previewThickness
  const cursorRef = useRef<Group>(null)
  const wallPreviewRef = useRef<Mesh>(null!)
  const startingPoint = useRef(new Vector3(0, 0, 0))
  const endingPoint = useRef(new Vector3(0, 0, 0))
  const chainFirstVertex = useRef<Vector3 | null>(null)
  const buildingState = useRef(0)
  const [draftMeasurement, setDraftMeasurement] = useState<DraftMeasurementState>(null)
  const [axisGuide, setAxisGuide] = useState<DraftAxisGuideState>(null)
  const measurementColor = isDark ? '#ffffff' : '#111111'
  const measurementShadowColor = isDark ? '#111111' : '#ffffff'

  // Clear preset-seeded defaults on deactivation so a later manual wall draw
  // isn't built with a stale preset's parameters. Unmount-only.
  useEffect(() => () => useEditor.getState().setToolDefaults('wall', null), [])

  useEffect(() => {
    let gridPosition: WallPlanPoint = [0, 0]
    let previousWallEnd: [number, number] | null = null

    // Alignment candidates — anchors of every alignable object. Refreshed
    // after each segment commits (the new wall becomes a candidate too).
    let alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, '')
    const refreshAlignmentCandidates = () => {
      alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, '')
    }

    // Align the drafted point onto another object's nearest real anchor and
    // publish the guide. Returns the possibly snapped point.
    const alignPoint = (point: WallPlanPoint, options?: { applySnap?: boolean }): WallPlanPoint => {
      // Figma alignment lines onto existing wall corners / edges are DISPLAYED
      // in every mode except Off (isAlignmentGuideActive); the magnetic pull
      // onto them is applied only in 'lines' mode (isMagneticSnapActive).
      if (!isAlignmentGuideActive() || alignmentCandidates.length === 0) {
        useAlignmentGuides.getState().clear()
        return point
      }
      const ar = resolveAlignment({
        moving: [{ nodeId: '__wall-draft__', kind: 'corner', x: point[0], z: point[1] }],
        candidates: alignmentCandidates,
        threshold: ALIGNMENT_THRESHOLD_M,
      })
      const magnetic = isMagneticSnapActive()
      // In non-magnetic modes nothing pulls the point onto a guide, so an
      // axis-alignment dot on a far corner reads as a false "connect here" cue.
      // Only surface guides whose anchor is within connect distance — the same
      // tight range the wall-body connect uses — so a corner is no more
      // magnetic-looking than any other point on the wall. 'lines' keeps the
      // wider guides since its magnetic snap closes the gap.
      const guides = magnetic
        ? ar.guides
        : ar.guides.filter(
            (guide) =>
              Math.hypot(point[0] - guide.anchor.x, point[1] - guide.anchor.z) <=
              WALL_CONNECT_SNAP_RADIUS,
          )
      useAlignmentGuides.getState().set(guides)
      return ar.snap && options?.applySnap !== false && magnetic
        ? [point[0] + ar.snap.dx, point[1] + ar.snap.dz]
        : point
    }

    const stopDrafting = () => {
      buildingState.current = 0
      chainFirstVertex.current = null
      if (wallPreviewRef.current) {
        wallPreviewRef.current.visible = false
      }
      setDraftMeasurement(null)
      setAxisGuide(null)
      useAlignmentGuides.getState().clear()
      useWallSnapIndicator.getState().clear()
      useSegmentDraftChain.getState().clear('wall')
    }

    const onGridMove = (event: GridEvent) => {
      if (!(cursorRef.current && wallPreviewRef.current)) return

      const walls = getCurrentLevelWalls()
      // Add walls on the floor below as extra snap references so the new wall
      // can align with the level beneath it. Kept separate from `walls` so the
      // measurement HUD only reports against the active level.
      const snapWalls = [...walls, ...getBelowLevelWalls()]
      const localPoint: WallPlanPoint = [event.localPosition[0], event.localPosition[2]]
      // Snapping is governed entirely by the snapping mode (grid / lines /
      // angles / off). `'off'` is the bypass — there is no Shift hold-to-bypass.
      const angleLocked = buildingState.current === 1 && isAngleSnapActive()
      const snapResult = snapWallDraftPointDetailed({
        point: localPoint,
        walls: snapWalls,
        start: angleLocked ? [startingPoint.current.x, startingPoint.current.z] : undefined,
        angleSnap: angleLocked,
        magnetic: isMagneticSnapActive(),
      })
      gridPosition = alignPoint(snapResult.point, { applySnap: !angleLocked })
      // Stand the magnetic beacon at the endpoint when it locked onto an
      // existing wall corner / wall point; clear it for plain grid/angle moves.
      useWallSnapIndicator
        .getState()
        .set(
          snapResult.snap
            ? { x: gridPosition[0], z: gridPosition[1], kind: snapResult.snap }
            : null,
        )

      if (buildingState.current === 1) {
        const snappedLocal = gridPosition
        endingPoint.current.set(snappedLocal[0], event.localPosition[1], snappedLocal[1])
        cursorRef.current.position.copy(endingPoint.current)
        setAxisGuide({
          origin: [startingPoint.current.x, startingPoint.current.z],
          y: startingPoint.current.y,
          angleLabel: getNearestAxisAngleLabel(
            [startingPoint.current.x, startingPoint.current.z],
            snappedLocal,
            startingPoint.current.y,
          ),
        })

        const currentWallEnd: [number, number] = [snappedLocal[0], snappedLocal[1]]
        if (
          previousWallEnd &&
          (currentWallEnd[0] !== previousWallEnd[0] || currentWallEnd[1] !== previousWallEnd[1])
        ) {
          triggerSFX('sfx:grid-snap')
        }
        previousWallEnd = currentWallEnd

        updateWallPreview(
          wallPreviewRef.current,
          startingPoint.current,
          endingPoint.current,
          previewHeightRef.current,
          previewThicknessRef.current,
        )
        setDraftMeasurement(
          getDraftMeasurementState(
            [startingPoint.current.x, startingPoint.current.z],
            snappedLocal,
            walls,
            unit,
            startingPoint.current.y,
            previewHeightRef.current,
          ),
        )
      } else {
        cursorRef.current.position.set(gridPosition[0], event.localPosition[1], gridPosition[1])
        setDraftMeasurement(null)
        setAxisGuide(null)
      }
    }

    const onGridClick = (event: GridEvent) => {
      if (!wallPreviewRef.current) return

      if (buildingState.current === 1 && event.nativeEvent.detail >= 2) {
        stopDrafting()
        return
      }

      const walls = getCurrentLevelWalls()
      const snapWalls = [...walls, ...getBelowLevelWalls()]
      const localClick: WallPlanPoint = [event.localPosition[0], event.localPosition[2]]

      if (buildingState.current === 0) {
        const snappedStart = alignPoint(
          snapWallDraftPointDetailed({
            point: localClick,
            walls: snapWalls,
            magnetic: isMagneticSnapActive(),
          }).point,
        )
        gridPosition = snappedStart
        startingPoint.current.set(snappedStart[0], event.localPosition[1], snappedStart[1])
        chainFirstVertex.current = startingPoint.current.clone()
        endingPoint.current.copy(startingPoint.current)
        buildingState.current = 1
        setAxisGuide({
          origin: snappedStart,
          y: event.localPosition[1],
          angleLabel: null,
        })
        triggerSFX('sfx:structure-build-start')
        // Visibility is owned by `updateWallPreview` — it flips
        // `mesh.visible` based on segment length. Setting it here
        // (before any geometry data has been written) draws the
        // mesh's empty `<shapeGeometry/>` placeholder, which WebGPU
        // flags as "Vertex buffer slot 0 ... was not set" on the
        // first frame after click. Leaving it false until the next
        // `onGridMove` writes a real BoxGeometry skips that frame.
        setDraftMeasurement(null)
      } else if (buildingState.current === 1) {
        const angleLocked = isAngleSnapActive()
        const snappedEnd = alignPoint(
          snapWallDraftPointDetailed({
            point: localClick,
            walls: snapWalls,
            start: angleLocked ? [startingPoint.current.x, startingPoint.current.z] : undefined,
            angleSnap: angleLocked,
            magnetic: isMagneticSnapActive(),
          }).point,
          { applySnap: !angleLocked },
        )
        const dx = snappedEnd[0] - startingPoint.current.x
        const dz = snappedEnd[1] - startingPoint.current.z
        if (dx * dx + dz * dz < 0.01 * 0.01) return
        // Both start and end are building-local ✓
        const createdWall = createWallOnCurrentLevel(
          [startingPoint.current.x, startingPoint.current.z],
          snappedEnd,
        )
        if (!createdWall) return

        // The new segment is now a real node — make it an alignment target
        // for the next segment, and drop the just-shown guide.
        refreshAlignmentCandidates()
        useAlignmentGuides.getState().clear()
        useWallSnapIndicator.getState().clear()

        if (useEditor.getState().getContinuation('wall') === 'single') {
          stopDrafting()
          return
        }

        const closedToChainStart =
          chainFirstVertex.current &&
          isWithinWallJoinSnapRadius(createdWall.end, chainFirstVertex.current)

        // Auto-close also fires when the segment seals a room against the
        // existing wall network (e.g. a bay closed onto the middle of another
        // wall), not just when the chain loops back to its own start. Shares the
        // room graph with auto slab/ceiling detection so the two never disagree.
        if (closedToChainStart || wallClosesRoom(getCurrentLevelWalls(), createdWall)) {
          stopDrafting()
          return
        }

        const nextStart = createdWall.end
        // Publish the resolved chain start so the 2D floor-plan draft
        // chains its next segment from the same point (its own snap
        // pipeline can resolve a slightly different endpoint).
        useSegmentDraftChain.getState().setChainStart('wall', [nextStart[0], nextStart[1]])
        startingPoint.current.set(nextStart[0], event.localPosition[1], nextStart[1])
        endingPoint.current.copy(startingPoint.current)
        cursorRef.current?.position.copy(startingPoint.current)
        buildingState.current = 1
        setAxisGuide({
          origin: nextStart,
          y: event.localPosition[1],
          angleLabel: null,
        })
        // Hide the preview until the next `onGridMove` writes the
        // new segment's geometry. Without this the prior segment's
        // BoxGeometry stays visible for a frame on top of the
        // freshly-committed real wall, producing a brief
        // double-paint at the new wall's position.
        if (wallPreviewRef.current) {
          wallPreviewRef.current.visible = false
        }
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
      useAlignmentGuides.getState().clear()
      useWallSnapIndicator.getState().clear()
      useSegmentDraftChain.getState().clear('wall')
    }
  }, [unit])

  return (
    <group>
      <WallAxisGuides
        guide={axisGuide}
        labelColor={measurementColor}
        labelShadowColor={measurementShadowColor}
      />
      <CursorSphere height={previewHeight} ref={cursorRef} />
      <mesh layers={EDITOR_LAYER} ref={wallPreviewRef} renderOrder={1} visible={false}>
        <shapeGeometry />
        <meshBasicMaterial
          color="#818cf8"
          depthTest={false}
          depthWrite={false}
          opacity={0.5}
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

function WallAxisGuides({
  guide,
  labelColor,
  labelShadowColor,
}: {
  guide: DraftAxisGuideState
  labelColor: string
  labelShadowColor: string
}) {
  if (!guide) return null

  const [x, z] = guide.origin

  return (
    <>
      <group position={[x, guide.y + DRAFT_AXIS_GUIDE_Y_OFFSET, z]}>
        <WallAxisGuideLine axis="x" />
        <WallAxisGuideLine axis="z" />
      </group>
      {guide.angleLabel && (
        <>
          <DraftAngleArc arc={guide.angleLabel.arc} color="#818cf8" />
          <DraftMeasurementLabel
            color={labelColor}
            label={guide.angleLabel.label}
            position={guide.angleLabel.position}
            shadowColor={labelShadowColor}
          />
        </>
      )}
    </>
  )
}

function WallAxisGuideLine({ axis }: { axis: 'x' | 'z' }) {
  return (
    <mesh
      frustumCulled={false}
      layers={EDITOR_LAYER}
      renderOrder={0}
      rotation={[0, axis === 'z' ? Math.PI / 2 : 0, 0]}
    >
      <boxGeometry
        args={[DRAFT_AXIS_GUIDE_LENGTH, DRAFT_AXIS_GUIDE_HEIGHT, DRAFT_AXIS_GUIDE_WIDTH]}
      />
      <meshBasicMaterial
        color="#818cf8"
        depthTest={false}
        depthWrite={false}
        opacity={0.36}
        transparent
      />
    </mesh>
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

export default WallTool
