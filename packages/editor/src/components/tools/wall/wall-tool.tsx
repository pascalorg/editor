import { emitter, type GridEvent, type LevelNode, useScene, type WallNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef } from 'react'
import { DoubleSide, type Group, type Mesh, Shape, ShapeGeometry, Vector3 } from 'three'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { EDITOR_LAYER } from '../../../lib/constants'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { CursorSphere } from '../shared/cursor-sphere'
import {
  createWallOnCurrentLevel,
  snapWallDraftPoint,
  WALL_MIN_LENGTH,
  type WallPlanPoint,
} from './wall-drafting'

const WALL_HEIGHT = 2.5

/**
 * Update wall preview mesh geometry to create a vertical plane between two points
 */
const updateWallPreview = (mesh: Mesh, start: Vector3, end: Vector3) => {
  // Calculate direction and perpendicular for wall thickness
  const direction = new Vector3(end.x - start.x, 0, end.z - start.z)
  const length = direction.length()

  if (length < WALL_MIN_LENGTH) {
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
  const cursorRef = useRef<Group>(null)
  const wallPreviewRef = useRef<Mesh>(null!)
  const startingPoint = useRef(new Vector3(0, 0, 0))
  const endingPoint = useRef(new Vector3(0, 0, 0))
  const buildingState = useRef(0)
  const shiftPressed = useRef(false)

  useEffect(() => {
    let gridPosition: WallPlanPoint = [0, 0]
    let previousWallEnd: [number, number] | null = null

    const onGridMove = (event: GridEvent) => {
      if (!(cursorRef.current && wallPreviewRef.current)) return

      const walls = getCurrentLevelWalls()
      const cursorPoint: WallPlanPoint = [event.position[0], event.position[2]]
      gridPosition = snapWallDraftPoint({
        point: cursorPoint,
        walls,
      })

      if (buildingState.current === 1) {
        const snappedPoint = snapWallDraftPoint({
          point: cursorPoint,
          walls,
          start: [startingPoint.current.x, startingPoint.current.z],
          angleSnap: !shiftPressed.current,
        })
        const snapped = new Vector3(snappedPoint[0], event.position[1], snappedPoint[1])
        endingPoint.current.copy(snapped)

        // Position the cursor at the end of the wall being drawn
        cursorRef.current.position.set(snapped.x, snapped.y, snapped.z)

        // Play snap sound only when the actual wall end position changes
        const currentWallEnd: [number, number] = [endingPoint.current.x, endingPoint.current.z]
        if (
          previousWallEnd &&
          (currentWallEnd[0] !== previousWallEnd[0] || currentWallEnd[1] !== previousWallEnd[1])
        ) {
          sfxEmitter.emit('sfx:grid-snap')
        }
        previousWallEnd = currentWallEnd

        // Update wall preview geometry
        updateWallPreview(wallPreviewRef.current, startingPoint.current, endingPoint.current)
      } else {
        // Not drawing a wall yet, show the snapped anchor point.
        cursorRef.current.position.set(gridPosition[0], event.position[1], gridPosition[1])
      }
    }

    const onGridClick = (event: GridEvent) => {
      const walls = getCurrentLevelWalls()
      const clickPoint: WallPlanPoint = [event.position[0], event.position[2]]

      if (buildingState.current === 0) {
        const snappedStart = snapWallDraftPoint({
          point: clickPoint,
          walls,
        })
        gridPosition = snappedStart
        startingPoint.current.set(snappedStart[0], event.position[1], snappedStart[1])
        endingPoint.current.copy(startingPoint.current)
        buildingState.current = 1
        wallPreviewRef.current.visible = true
      } else if (buildingState.current === 1) {
        const snappedEnd = snapWallDraftPoint({
          point: clickPoint,
          walls,
          start: [startingPoint.current.x, startingPoint.current.z],
          angleSnap: !shiftPressed.current,
        })
        endingPoint.current.set(snappedEnd[0], event.position[1], snappedEnd[1])
        const dx = endingPoint.current.x - startingPoint.current.x
        const dz = endingPoint.current.z - startingPoint.current.z
        if (dx * dx + dz * dz < WALL_MIN_LENGTH * WALL_MIN_LENGTH) return
        createWallOnCurrentLevel(
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
        markToolCancelConsumed()
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
    </group>
  )
}
