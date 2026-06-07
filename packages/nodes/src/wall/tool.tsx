import {
  calculateLevelMiters,
  collectAlignmentAnchors,
  emitter,
  type GridEvent,
  getWallMiterBoundaryPoints,
  type LevelNode,
  type Point2D,
  resolveAlignment,
  useAlignmentGuides,
  useScene,
  useWallSnapIndicator,
  type WallMiterData,
  type WallNode,
} from '@pascal-app/core'
import {
  CursorSphere,
  createWallOnCurrentLevel,
  EDITOR_LAYER,
  formatAngleRadians,
  getAngleArcToSegmentReference,
  getAngleToSegmentReference,
  getSegmentAngleReferenceAtPoint,
  markToolCancelConsumed,
  type SegmentAngleReference,
  snapWallDraftPointDetailed,
  triggerSFX,
  useEditor,
  WALL_FINE_GRID_STEP,
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
 * rectangle + length/angle measurement HUD follow the pointer. Shift
 * bypasses the angle snap; Esc cancels.
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
    lengthLabel: formatMeasurement(length, unit),
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

function getCurrentLevelWalls(): WallNode[] {
  const currentLevelId = useViewer.getState().selection.levelId
  const { nodes } = useScene.getState()
  if (!currentLevelId) return []
  const levelNode = nodes[currentLevelId]
  if (!levelNode || levelNode.type !== 'level') return []
  return (levelNode as LevelNode).children
    .map((childId) => nodes[childId])
    .filter((node): node is WallNode => node?.type === 'wall')
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
  const buildingState = useRef(0)
  const shiftPressed = useRef(false)
  const [draftMeasurement, setDraftMeasurement] = useState<DraftMeasurementState>(null)
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
    // publish the guide. Alt bypasses. Returns the (possibly snapped) point.
    const alignPoint = (point: WallPlanPoint, bypass: boolean): WallPlanPoint => {
      if (bypass || alignmentCandidates.length === 0) {
        useAlignmentGuides.getState().clear()
        return point
      }
      const ar = resolveAlignment({
        moving: [{ nodeId: '__wall-draft__', kind: 'corner', x: point[0], z: point[1] }],
        candidates: alignmentCandidates,
        threshold: ALIGNMENT_THRESHOLD_M,
      })
      useAlignmentGuides.getState().set(ar.guides)
      return ar.snap ? [point[0] + ar.snap.dx, point[1] + ar.snap.dz] : point
    }

    const stopDrafting = () => {
      buildingState.current = 0
      if (wallPreviewRef.current) {
        wallPreviewRef.current.visible = false
      }
      setDraftMeasurement(null)
      useAlignmentGuides.getState().clear()
      useWallSnapIndicator.getState().clear()
    }

    const onGridMove = (event: GridEvent) => {
      if (!(cursorRef.current && wallPreviewRef.current)) return

      const walls = getCurrentLevelWalls()
      const localPoint: WallPlanPoint = [event.localPosition[0], event.localPosition[2]]
      // Default to the active grid step; Shift switches to the fine
      // step (0.05m) for precision. No 45° angle snap — we want the
      // cursor to track grid lines in every direction. Orthogonal
      // walls fall out of grid snap naturally when the start sits on
      // a grid intersection.
      const step = shiftPressed.current ? WALL_FINE_GRID_STEP : undefined
      const bypassAlign = event.nativeEvent?.altKey === true
      const snapResult = snapWallDraftPointDetailed({
        point: localPoint,
        walls,
        step,
        magnetic: useEditor.getState().magneticSnap,
      })
      gridPosition = alignPoint(snapResult.point, bypassAlign)
      // Stand the magnetic beacon at the endpoint when it locked onto an
      // existing wall corner / wall point; clear it for plain grid/angle moves.
      useWallSnapIndicator
        .getState()
        .set(
          snapResult.snap ? { x: gridPosition[0], z: gridPosition[1], kind: snapResult.snap } : null,
        )

      if (buildingState.current === 1) {
        const snappedLocal = gridPosition
        endingPoint.current.set(snappedLocal[0], event.localPosition[1], snappedLocal[1])
        cursorRef.current.position.copy(endingPoint.current)

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
      }
    }

    const onGridClick = (event: GridEvent) => {
      if (buildingState.current === 1 && event.nativeEvent.detail >= 2) {
        stopDrafting()
        return
      }

      const walls = getCurrentLevelWalls()
      const localClick: WallPlanPoint = [event.localPosition[0], event.localPosition[2]]

      const clickStep = shiftPressed.current ? WALL_FINE_GRID_STEP : undefined
      const bypassAlign = event.nativeEvent?.altKey === true

      if (buildingState.current === 0) {
        const snappedStart = alignPoint(
          snapWallDraftPointDetailed({
            point: localClick,
            walls,
            step: clickStep,
            magnetic: useEditor.getState().magneticSnap,
          }).point,
          bypassAlign,
        )
        gridPosition = snappedStart
        startingPoint.current.set(snappedStart[0], event.localPosition[1], snappedStart[1])
        endingPoint.current.copy(startingPoint.current)
        buildingState.current = 1
        // Visibility is owned by `updateWallPreview` — it flips
        // `mesh.visible` based on segment length. Setting it here
        // (before any geometry data has been written) draws the
        // mesh's empty `<shapeGeometry/>` placeholder, which WebGPU
        // flags as "Vertex buffer slot 0 ... was not set" on the
        // first frame after click. Leaving it false until the next
        // `onGridMove` writes a real BoxGeometry skips that frame.
        setDraftMeasurement(null)
      } else if (buildingState.current === 1) {
        const snappedEnd = alignPoint(
          snapWallDraftPointDetailed({
            point: localClick,
            walls,
            step: clickStep,
            magnetic: useEditor.getState().magneticSnap,
          }).point,
          bypassAlign,
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

        const nextStart = createdWall.end
        startingPoint.current.set(nextStart[0], event.localPosition[1], nextStart[1])
        endingPoint.current.copy(startingPoint.current)
        cursorRef.current?.position.copy(startingPoint.current)
        buildingState.current = 1
        // Hide the preview until the next `onGridMove` writes the
        // new segment's geometry. Without this the prior segment's
        // BoxGeometry stays visible for a frame on top of the
        // freshly-committed real wall, producing a brief
        // double-paint at the new wall's position.
        wallPreviewRef.current.visible = false
        setDraftMeasurement(null)
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftPressed.current = true
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftPressed.current = false
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
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      useAlignmentGuides.getState().clear()
      useWallSnapIndicator.getState().clear()
    }
  }, [unit])

  return (
    <group>
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
