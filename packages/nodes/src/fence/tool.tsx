'use client'

import {
  emitter,
  type FenceNode,
  type GridEvent,
  type LevelNode,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import {
  CursorSphere,
  createFenceOnCurrentLevel,
  EDITOR_LAYER,
  type FencePlanPoint,
  formatAngleRadians,
  getAngleToSegmentReference,
  getSegmentAngleReferenceAtPoint,
  markToolCancelConsumed,
  snapFenceDraftPoint,
  triggerSFX,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useEffect, useRef, useState } from 'react'
import { DoubleSide, type Group, type Mesh, Shape, ShapeGeometry, Vector3 } from 'three'

/**
 * Phase 5 Stage D — fence placement tool (kind-owned via `def.tool`).
 *
 * Replaces the legacy `FenceTool` (346 LoC). Two-click placement flow:
 * click 1 sets the start, click 2 creates the fence. Between clicks a
 * preview rectangle and a length / angle measurement HUD follow the
 * pointer (shift defeats angle snap).
 *
 * Not a `DragAction` — placement isn't a single pointer-drag, it's a
 * sequence of discrete grid:click events with preview state across
 * them. `useDragAction` doesn't fit; this component owns the lifecycle
 * directly. The registry routes activation here via `def.tool`.
 */

const FENCE_PREVIEW_HEIGHT = 1.8
const DRAFT_LABEL_Y = FENCE_PREVIEW_HEIGHT + 0.22
const DRAFT_ANGLE_LABEL_Y = 0.28

type DraftAngleLabel = {
  id: string
  label: string
  position: [number, number, number]
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

function getDraftAngleLabels(
  start: FencePlanPoint,
  end: FencePlanPoint,
  segments: SegmentLike[],
): DraftAngleLabel[] {
  const draftFromStart: FencePlanPoint = [end[0] - start[0], end[1] - start[1]]
  const draftFromEnd: FencePlanPoint = [start[0] - end[0], start[1] - end[1]]
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
    const angle = getAngleToSegmentReference(endpoint.draftVector, connectedReference)
    if (angle === null) continue
    labels.push({
      id: endpoint.id,
      label: formatAngleRadians(angle),
      position: [endpoint.point[0], DRAFT_ANGLE_LABEL_Y, endpoint.point[1]],
    })
  }
  return labels
}

function getDraftMeasurementState(
  start: FencePlanPoint,
  end: FencePlanPoint,
  segments: SegmentLike[],
  unit: 'metric' | 'imperial',
): DraftMeasurementState {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  if (length < 0.01) return null
  return {
    lengthLabel: formatMeasurement(length, unit),
    lengthPosition: [(start[0] + end[0]) / 2, DRAFT_LABEL_Y, (start[1] + end[1]) / 2],
    angleLabels: getDraftAngleLabels(start, end, segments),
  }
}

function getReferenceSegments(walls: WallNode[], fences: FenceNode[]): SegmentLike[] {
  return [
    ...walls.map((w) => ({ id: w.id, start: w.start, end: w.end, curveOffset: w.curveOffset })),
    ...fences.map((f) => ({ id: f.id, start: f.start, end: f.end, curveOffset: f.curveOffset })),
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
  const shape = new Shape()
  shape.moveTo(0, 0)
  shape.lineTo(length, 0)
  shape.lineTo(length, FENCE_PREVIEW_HEIGHT)
  shape.lineTo(0, FENCE_PREVIEW_HEIGHT)
  shape.closePath()
  const geometry = new ShapeGeometry(shape)
  const angle = -Math.atan2(direction.z, direction.x)
  mesh.position.set(start.x, start.y, start.z)
  mesh.rotation.y = angle
  if (mesh.geometry) mesh.geometry.dispose()
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
  const unit = useViewer((s) => s.unit)
  const cursorRef = useRef<Group>(null)
  const previewRef = useRef<Mesh>(null!)
  const startingPoint = useRef(new Vector3(0, 0, 0))
  const endingPoint = useRef(new Vector3(0, 0, 0))
  const buildingState = useRef(0)
  const shiftPressed = useRef(false)
  const [draftMeasurement, setDraftMeasurement] = useState<DraftMeasurementState>(null)

  useEffect(() => {
    let previousFenceEnd: FencePlanPoint | null = null

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
          ),
        )
      } else {
        const snappedPoint = snapFenceDraftPoint({ point: localPoint, walls, fences })
        cursorRef.current.position.set(snappedPoint[0], event.localPosition[1], snappedPoint[1])
        setDraftMeasurement(null)
      }
    }

    const onGridClick = (event: GridEvent) => {
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
        createFenceOnCurrentLevel([startingPoint.current.x, startingPoint.current.z], snappedEnd)
        previewRef.current.visible = false
        buildingState.current = 0
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
        buildingState.current = 0
        if (previewRef.current) previewRef.current.visible = false
        setDraftMeasurement(null)
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
            label={draftMeasurement.lengthLabel}
            position={draftMeasurement.lengthPosition}
          />
          {draftMeasurement.angleLabels.map((angleLabel) => (
            <DraftMeasurementLabel
              key={angleLabel.id}
              label={angleLabel.label}
              position={angleLabel.position}
            />
          ))}
        </>
      )}
    </group>
  )
}

function DraftMeasurementLabel({
  label,
  position,
}: {
  label: string
  position: [number, number, number]
}) {
  return (
    <Html center position={position} style={{ pointerEvents: 'none' }} zIndexRange={[100, 0]}>
      <div className="whitespace-nowrap rounded-full border border-border bg-background/95 px-2 py-1 font-mono font-semibold text-[11px] text-foreground shadow-lg backdrop-blur-md">
        {label}
      </div>
    </Html>
  )
}

export default FenceTool
