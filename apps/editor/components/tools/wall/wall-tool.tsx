import { emitter, type GridEvent, useScene, WallNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef } from 'react'
import { DoubleSide, type Mesh, type Group, Shape, ShapeGeometry, Vector3 } from 'three'
import { sfxEmitter } from '@/lib/sfx-bus'
import { CursorSphere } from '../shared/cursor-sphere'

const WALL_HEIGHT = 2.5
const WALL_THICKNESS = 0.15

/**
 * Snap point to 45° angle increments relative to start point
 * Also snaps end point to 0.5 grid
 */
const snapTo45Degrees = (start: Vector3, cursor: Vector3): Vector3 => {
  const dx = cursor.x - start.x
  const dz = cursor.z - start.z

  // Calculate angle in radians
  const angle = Math.atan2(dz, dx)

  // Round to nearest 45° (π/4 radians)
  const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4)

  // Calculate distance from start to cursor
  const distance = Math.sqrt(dx * dx + dz * dz)

  // Project end point along snapped angle
  let snappedX = start.x + Math.cos(snappedAngle) * distance
  let snappedZ = start.z + Math.sin(snappedAngle) * distance

  // Snap to 0.5 grid
  snappedX = Math.round(snappedX * 2) / 2
  snappedZ = Math.round(snappedZ * 2) / 2

  return new Vector3(snappedX, cursor.y, snappedZ)
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

  // Perpendicular vector for thickness
  const perpendicular = new Vector3(-direction.z, 0, direction.x).multiplyScalar(WALL_THICKNESS / 2)

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

const commitWallDrawing = (start: [number, number], end: [number, number]) => {
  const currentLevelId = useViewer.getState().selection.levelId
  const { createNode } = useScene.getState()

  if (!currentLevelId) return

  const wall = WallNode.parse({ start, end })

  createNode(wall, currentLevelId)
  sfxEmitter.emit('sfx:structure-build')
}

export const WallTool: React.FC = () => {
  const cursorRef = useRef<Group>(null)
  const wallPreviewRef = useRef<Mesh>(null!)
  const startingPoint = useRef(new Vector3(0, 0, 0))
  const endingPoint = useRef(new Vector3(0, 0, 0))
  const buildingState = useRef(0)
  const shiftPressed = useRef(false)

  useEffect(() => {
    let gridPosition: [number, number] = [0, 0]
    let previousWallEnd: [number, number] | null = null

    const onGridMove = (event: GridEvent) => {
      if (!cursorRef.current || !wallPreviewRef.current) return

      gridPosition = [Math.round(event.position[0] * 2) / 2, Math.round(event.position[2] * 2) / 2]
      const cursorPosition = new Vector3(gridPosition[0], event.position[1], gridPosition[1])

      if (buildingState.current === 1) {
        // Snap to 45° angles only if shift is not pressed
        const snapped = shiftPressed.current
          ? cursorPosition
          : snapTo45Degrees(startingPoint.current, cursorPosition)
        endingPoint.current.copy(snapped)

        // Position the cursor at the end of the wall being drawn
        cursorRef.current.position.set(snapped.x, snapped.y, snapped.z)

        // Play snap sound only when the actual wall end position changes
        const currentWallEnd: [number, number] = [endingPoint.current.x, endingPoint.current.z]
        if (previousWallEnd &&
            (currentWallEnd[0] !== previousWallEnd[0] || currentWallEnd[1] !== previousWallEnd[1])) {
          sfxEmitter.emit('sfx:grid-snap')
        }
        previousWallEnd = currentWallEnd

        // Update wall preview geometry
        updateWallPreview(wallPreviewRef.current, startingPoint.current, endingPoint.current)
      } else {
        // Not drawing a wall, just follow the grid position
        cursorRef.current.position.set(gridPosition[0], event.position[1], gridPosition[1])
      }
    }

    const onGridClick = (event: GridEvent) => {
      if (buildingState.current === 0) {
        startingPoint.current.set(gridPosition[0], event.position[1], gridPosition[1])
        buildingState.current = 1
        wallPreviewRef.current.visible = true
      } else if (buildingState.current === 1) {
        commitWallDrawing(
          [startingPoint.current.x, startingPoint.current.z],
          [endingPoint.current.x, endingPoint.current.z],
        )
        wallPreviewRef.current.visible = false
        buildingState.current = 0
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
        buildingState.current = 0
        wallPreviewRef.current.visible = false
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
  }, [])

  return (
    <group>
      {/* Cursor indicator */}
      <CursorSphere ref={cursorRef}  />

      {/* Wall preview */}
      <mesh ref={wallPreviewRef} visible={false} renderOrder={1}>
        <shapeGeometry />
        <meshBasicMaterial
          color="#818cf8"
          transparent
          opacity={0.5}
          side={DoubleSide}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}
