import {
  EDITOR_LAYER,
  formatAngleRadians,
  getAngleArcToSegmentReference,
  getAngleToSegmentReference,
  type SegmentAngleReference,
  type WallPlanPoint,
} from '@pascal-app/editor'
import { Html } from '@react-three/drei'
import { useMemo } from 'react'
import { BufferGeometry, Vector3 } from 'three'

/**
 * Axis guide lines + axis-angle readout shown while drafting linear segments
 * (walls, fences). An X/Z cross of long thin boxes is drawn through the
 * segment start so it can be aligned against the world axes; the moving
 * endpoint gets a single long line PERPENDICULAR to the draft segment (a
 * second cross there would overlap the start cross whenever the segment is
 * axis-aligned). The angle to the nearest axis is shown as an arc + label
 * anchored at the start point only (duplicating it at the endpoint is
 * visual clutter).
 */
const DRAFT_AXIS_GUIDE_LENGTH = 2000
const DRAFT_AXIS_GUIDE_WIDTH = 0.035
const DRAFT_AXIS_GUIDE_HEIGHT = 0.004
const DRAFT_AXIS_GUIDE_Y_OFFSET = 0.026
const DRAFT_AXIS_ANGLE_ARC_Y_OFFSET = 0.05
const DRAFT_AXIS_ANGLE_LABEL_Y_OFFSET = 0.16
const DRAFT_AXIS_ANGLE_ARC_MIN_RADIUS = 0.36
const DRAFT_AXIS_ANGLE_ARC_MAX_RADIUS = 0.82
const DRAFT_ANGLE_ARC_SEGMENTS = 24
const AXIS_ANGLE_REFERENCES: SegmentAngleReference[] = [
  { vector: [1, 0], orientation: 'axis' },
  { vector: [0, 1], orientation: 'axis' },
]

export type DraftAngleLabel = {
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

export type DraftAxisGuideState = {
  origin: WallPlanPoint
  endOrigin: WallPlanPoint | null
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function getNearestAxisAngleLabel(
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

export function DraftAxisGuides({
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

  // Single long line through the endpoint, perpendicular to the draft
  // segment (a full axis cross there would collide with the start cross
  // whenever the segment is axis-aligned).
  let endRotationY: number | null = null
  if (guide.endOrigin) {
    const dx = guide.endOrigin[0] - x
    const dz = guide.endOrigin[1] - z
    if (dx * dx + dz * dz >= 0.01 * 0.01) {
      endRotationY = Math.atan2(-dx, -dz)
    }
  }

  return (
    <>
      <group position={[x, guide.y + DRAFT_AXIS_GUIDE_Y_OFFSET, z]}>
        <DraftAxisGuideLine axis="x" />
        <DraftAxisGuideLine axis="z" />
      </group>
      {guide.endOrigin && endRotationY !== null && (
        <group
          position={[guide.endOrigin[0], guide.y + DRAFT_AXIS_GUIDE_Y_OFFSET, guide.endOrigin[1]]}
        >
          <DraftAxisGuideLine rotationY={endRotationY} />
        </group>
      )}
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

function DraftAxisGuideLine({ axis, rotationY }: { axis?: 'x' | 'z'; rotationY?: number }) {
  const y = rotationY ?? (axis === 'z' ? Math.PI / 2 : 0)
  return (
    <mesh frustumCulled={false} layers={EDITOR_LAYER} renderOrder={0} rotation={[0, y, 0]}>
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

export function DraftAngleArc({ arc, color }: { arc: DraftAngleLabel['arc']; color: string }) {
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

export function DraftMeasurementLabel({
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
