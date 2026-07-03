'use client'

import {
  calculateLevelMiters,
  emitter,
  type FenceNode,
  type GridEvent,
  getWallMiterBoundaryPoints,
  type LevelNode,
  type Point2D,
  useScene,
  type WallMiterData,
  type WallNode,
} from '@pascal-app/core'
import {
  CursorSphere,
  createFenceOnCurrentLevel,
  EDITOR_LAYER,
  type FencePlanPoint,
  formatAngleRadians,
  getAngleArcToSegmentReference,
  getAngleToSegmentReference,
  getSegmentAngleReferenceAtPoint,
  markToolCancelConsumed,
  type SegmentAngleReference,
  snapFenceDraftPoint,
  triggerSFX,
} from '@pascal-app/editor'
import useViewer from '@pascal-app/viewer/store'
import { Html } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BoxGeometry, BufferGeometry, DoubleSide, type Group, type Mesh, Vector3 } from 'three'

const FENCE_PREVIEW_HEIGHT = 1.8
const FENCE_PREVIEW_THICKNESS = 0.08
const DRAFT_LABEL_Y = FENCE_PREVIEW_HEIGHT + 0.22
const DRAFT_ANGLE_LABEL_Y = FENCE_PREVIEW_HEIGHT + 0.08
const DRAFT_ANGLE_ARC_Y = FENCE_PREVIEW_HEIGHT + 0.012
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

function buildDraftFenceSegment(start: FencePlanPoint, end: FencePlanPoint): SegmentLike {
  return {
    id: 'fence_draft',
    start,
    end,
    thickness: FENCE_PREVIEW_THICKNESS,
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
): DraftAngleLabel[] {
  const draftFromStart: FencePlanPoint = [end[0] - start[0], end[1] - start[1]]
  const draftFromEnd: FencePlanPoint = [start[0] - end[0], start[1] - end[1]]
  const draftSegment = buildDraftFenceSegment(start, end)
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
        baseY + DRAFT_ANGLE_LABEL_Y,
        arcCenter[1] + Math.sin(arc.midAngle) * (radius + 0.16),
      ],
      arc: {
        center: arcCenter,
        radius,
        startAngle: arc.startAngle,
        endAngle: arc.endAngle,
        y: baseY + DRAFT_ANGLE_ARC_Y,
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
): DraftMeasurementState {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  if (length < 0.01) return null
  return {
    lengthLabel: formatMeasurement(length, unit),
    lengthPosition: [(start[0] + end[0]) / 2, baseY + DRAFT_LABEL_Y, (start[1] + end[1]) / 2],
    angleLabels: getDraftAngleLabels(start, end, segments, baseY),
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

function updateFencePreview(mesh: Mesh, start: Vector3, end: Vector3) {
  const direction = new Vector3(end.x - start.x, 0, end.z - start.z)
  const length = direction.length()
  if (length < 0.01) {
    mesh.visible = false
    return
  }
  mesh.visible = true
  direction.normalize()
  const geometry = new BoxGeometry(length, FENCE_PREVIEW_HEIGHT, FENCE_PREVIEW_THICKNESS)
  const angle = Math.atan2(direction.z, direction.x)

  mesh.position.set(
    (start.x + end.x) / 2,
    start.y + FENCE_PREVIEW_HEIGHT / 2,
    (start.z + end.z) / 2,
  )
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
  if (!levelNode || levelNode.type !== 'level') return { walls: [], fences: [] }
  const children = (levelNode as LevelNode).children.map((childId) => nodes[childId])
  return {
    walls: children.filter((n): n is WallNode => n?.type === 'wall'),
    fences: children.filter((n): n is FenceNode => n?.type === 'fence'),
  }
}

export const FenceTool: React.FC = () => {
  const unit = useViewer((state) => state.unit)
  const theme = useViewer((state) => state.theme)
  const cursorRef = useRef<Group>(null)
  const previewRef = useRef<Mesh>(null!)
  const startingPoint = useRef(new Vector3(0, 0, 0))
  const endingPoint = useRef(new Vector3(0, 0, 0))
  const buildingState = useRef(0)
  const shiftPressed = useRef(false)
  const [draftMeasurement, setDraftMeasurement] = useState<DraftMeasurementState>(null)
  const measurementColor = theme === 'dark' ? '#ffffff' : '#111111'
  const measurementShadowColor = theme === 'dark' ? '#111111' : '#ffffff'

  useEffect(() => {
    let previousFenceEnd: FencePlanPoint | null = null

    const stopDrafting = () => {
      buildingState.current = 0
      previewRef.current.visible = false
      setDraftMeasurement(null)
    }

    const onGridMove = (event: GridEvent) => {
      if (!(cursorRef.current && previewRef.current)) return
      const { walls, fences } = getCurrentLevelElements()
      const localPoint: FencePlanPoint = [event.localPosition[0], event.localPosition[2]]

      if (buildingState.current === 1) {
        const snappedLocal = snapFenceDraftPoint({
          point: localPoint,
          walls,
          fences,
          start: [startingPoint.current.x, startingPoint.current.z],
          angleSnap: !shiftPressed.current,
        })
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
        updateFencePreview(previewRef.current, startingPoint.current, endingPoint.current)
        setDraftMeasurement(
          getDraftMeasurementState(
            [startingPoint.current.x, startingPoint.current.z],
            snappedLocal,
            getReferenceSegments(walls, fences),
            unit,
            startingPoint.current.y,
          ),
        )
      } else {
        const snappedPoint = snapFenceDraftPoint({ point: localPoint, walls, fences })
        cursorRef.current.position.set(snappedPoint[0], event.localPosition[1], snappedPoint[1])
        setDraftMeasurement(null)
      }
    }

    const onGridClick = (event: GridEvent) => {
      if (buildingState.current === 1 && event.nativeEvent.detail >= 2) {
        stopDrafting()
        return
      }

      const { walls, fences } = getCurrentLevelElements()
      const localClick: FencePlanPoint = [event.localPosition[0], event.localPosition[2]]

      if (buildingState.current === 0) {
        const snappedStart = snapFenceDraftPoint({ point: localClick, walls, fences })
        startingPoint.current.set(snappedStart[0], event.localPosition[1], snappedStart[1])
        endingPoint.current.copy(startingPoint.current)
        buildingState.current = 1
        previewRef.current.visible = true
        setDraftMeasurement(null)
      } else {
        const snappedEnd = snapFenceDraftPoint({
          point: localClick,
          walls,
          fences,
          start: [startingPoint.current.x, startingPoint.current.z],
          angleSnap: !shiftPressed.current,
        })
        const dx = snappedEnd[0] - startingPoint.current.x
        const dz = snappedEnd[1] - startingPoint.current.z
        if (dx * dx + dz * dz < 0.01 * 0.01) return
        const createdFence = createFenceOnCurrentLevel(
          [startingPoint.current.x, startingPoint.current.z],
          snappedEnd,
        )
        if (!createdFence) return

        const nextStart = createdFence.end
        startingPoint.current.set(nextStart[0], event.localPosition[1], nextStart[1])
        endingPoint.current.copy(startingPoint.current)
        cursorRef.current?.position.copy(startingPoint.current)
        previewRef.current.visible = false
        buildingState.current = 1
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
    }
  }, [unit])

  return (
    <group>
      <CursorSphere height={FENCE_PREVIEW_HEIGHT} ref={cursorRef} />
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
