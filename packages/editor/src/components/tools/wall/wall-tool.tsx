import { emitter, type GridEvent, type LevelNode, useScene, type WallNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useEffect, useRef, useState } from 'react'
import { DoubleSide, type Group, type Mesh, Shape, ShapeGeometry, Vector3 } from 'three'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { EDITOR_LAYER } from '../../../lib/constants'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { CursorSphere } from '../shared/cursor-sphere'
import {
  formatAngleRadians,
  getAngleToSegmentReference,
  getSegmentAngleReferenceAtPoint,
} from '../shared/segment-angle'
import { createWallOnCurrentLevel, snapWallDraftPoint, type WallPlanPoint } from './wall-drafting'

const WALL_HEIGHT = 2.5
const DRAFT_LABEL_Y = WALL_HEIGHT + 0.22
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
  start: WallPlanPoint,
  end: WallPlanPoint,
  walls: WallNode[],
): DraftAngleLabel[] {
  const draftFromStart: WallPlanPoint = [end[0] - start[0], end[1] - start[1]]
  const draftFromEnd: WallPlanPoint = [start[0] - end[0], start[1] - end[1]]
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
  start: WallPlanPoint,
  end: WallPlanPoint,
  walls: WallNode[],
  unit: 'metric' | 'imperial',
): DraftMeasurementState {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)

  if (length < 0.01) return null

  return {
    lengthLabel: formatMeasurement(length, unit),
    lengthPosition: [(start[0] + end[0]) / 2, DRAFT_LABEL_Y, (start[1] + end[1]) / 2],
    angleLabels: getDraftAngleLabels(start, end, walls),
  }
}

/**
 * Update wall preview mesh geometry to create a vertical plane between two points
 */
const updateWallPreview = (mesh: Mesh, start: Vector3, end: Vector3) => {
  // Calculate direction and perpendicular for wall thickness
  const direction = new Vector3(end.x - start.x, 0, end.z - start.z)
  const length = direction.length()

  if (length < 0.01) {
    mesh.visible = false
    return
  }

  mesh.visible = true
  direction.normalize()

  // Create wall shape (vertical rectangle in XY plane)
  const shape = new Shape()
  shape.moveTo(0, 0)
  shape.lineTo(length, 0)
  shape.lineTo(length, WALL_HEIGHT)
  shape.lineTo(0, WALL_HEIGHT)
  shape.closePath()

  // Create geometry
  const geometry = new ShapeGeometry(shape)

  // Calculate rotation angle
  // Negate the angle to fix the opposite direction issue
  const angle = -Math.atan2(direction.z, direction.x)

  // Position at start point and rotate
  mesh.position.set(start.x, start.y, start.z)
  mesh.rotation.y = angle

  // Dispose old geometry and assign new one
  if (mesh.geometry) {
    mesh.geometry.dispose()
  }
  mesh.geometry = geometry
}

const getCurrentLevelWalls = (): WallNode[] => {
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
  const cursorRef = useRef<Group>(null)
  const wallPreviewRef = useRef<Mesh>(null!)
  const startingPoint = useRef(new Vector3(0, 0, 0))
  const endingPoint = useRef(new Vector3(0, 0, 0))
  const buildingState = useRef(0)
  const shiftPressed = useRef(false)
  const [draftMeasurement, setDraftMeasurement] = useState<DraftMeasurementState>(null)

  useEffect(() => {
    let gridPosition: WallPlanPoint = [0, 0]
    let previousWallEnd: [number, number] | null = null

    // All positions are building-local: this tool is inside the ToolManager building group,
    // so local coords are used for both data and visual positioning.
    const onGridMove = (event: GridEvent) => {
      if (!(cursorRef.current && wallPreviewRef.current)) return

      const walls = getCurrentLevelWalls()
      // event.localPosition is building-local — consistent with stored wall start/end
      const localPoint: WallPlanPoint = [event.localPosition[0], event.localPosition[2]]
      gridPosition = snapWallDraftPoint({ point: localPoint, walls })

      if (buildingState.current === 1) {
        const snappedLocal = snapWallDraftPoint({
          point: localPoint,
          walls,
          start: [startingPoint.current.x, startingPoint.current.z],
          angleSnap: !shiftPressed.current,
        })
        endingPoint.current.set(snappedLocal[0], event.localPosition[1], snappedLocal[1])
        cursorRef.current.position.copy(endingPoint.current)

        // Play snap sound only when the actual wall end position changes
        const currentWallEnd: [number, number] = [snappedLocal[0], snappedLocal[1]]
        if (
          previousWallEnd &&
          (currentWallEnd[0] !== previousWallEnd[0] || currentWallEnd[1] !== previousWallEnd[1])
        ) {
          sfxEmitter.emit('sfx:grid-snap')
        }
        previousWallEnd = currentWallEnd

        updateWallPreview(wallPreviewRef.current, startingPoint.current, endingPoint.current)
        setDraftMeasurement(
          getDraftMeasurementState(
            [startingPoint.current.x, startingPoint.current.z],
            snappedLocal,
            walls,
            unit,
          ),
        )
      } else {
        // Not drawing a wall yet, show the snapped anchor point.
        cursorRef.current.position.set(gridPosition[0], event.localPosition[1], gridPosition[1])
        setDraftMeasurement(null)
      }
    }

    const onGridClick = (event: GridEvent) => {
      const walls = getCurrentLevelWalls()
      const localClick: WallPlanPoint = [event.localPosition[0], event.localPosition[2]]

      if (buildingState.current === 0) {
        const snappedStart = snapWallDraftPoint({ point: localClick, walls })
        gridPosition = snappedStart
        startingPoint.current.set(snappedStart[0], event.localPosition[1], snappedStart[1])
        endingPoint.current.copy(startingPoint.current)
        buildingState.current = 1
        wallPreviewRef.current.visible = true
        setDraftMeasurement(null)
      } else if (buildingState.current === 1) {
        const snappedEnd = snapWallDraftPoint({
          point: localClick,
          walls,
          start: [startingPoint.current.x, startingPoint.current.z],
          angleSnap: !shiftPressed.current,
        })
        const dx = snappedEnd[0] - startingPoint.current.x
        const dz = snappedEnd[1] - startingPoint.current.z
        if (dx * dx + dz * dz < 0.01 * 0.01) return
        // Both start and end are building-local ✓
        createWallOnCurrentLevel([startingPoint.current.x, startingPoint.current.z], snappedEnd)
        wallPreviewRef.current.visible = false
        buildingState.current = 0
        setDraftMeasurement(null)
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        shiftPressed.current = true
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        shiftPressed.current = false
      }
    }

    const onCancel = () => {
      if (buildingState.current === 1) {
        markToolCancelConsumed()
        buildingState.current = 0
        wallPreviewRef.current.visible = false
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
      {/* Cursor indicator */}
      <CursorSphere ref={cursorRef} />

      {/* Wall preview */}
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
      <div className="whitespace-nowrap rounded-full border border-border bg-background/95 px-2 py-1 font-mono text-[11px] font-semibold text-foreground shadow-lg backdrop-blur-md">
        {label}
      </div>
    </Html>
  )
}
