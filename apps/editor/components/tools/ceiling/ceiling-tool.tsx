import { CeilingNode, emitter, type GridEvent, type LevelNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BufferGeometry, DoubleSide, type Line, type Mesh, Shape, Vector3 } from 'three'
import { sfxEmitter } from '@/lib/sfx-bus'
import useEditor from '@/store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'

const CEILING_HEIGHT = 2.52
const GRID_OFFSET = 0.02

/**
 * Snaps a point to the nearest axis-aligned or 45-degree diagonal from the last point
 */
const calculateSnapPoint = (
  lastPoint: [number, number],
  currentPoint: [number, number],
): [number, number] => {
  const [x1, y1] = lastPoint
  const [x, y] = currentPoint

  const dx = x - x1
  const dy = y - y1
  const absDx = Math.abs(dx)
  const absDy = Math.abs(dy)

  // Calculate distances to horizontal, vertical, and diagonal lines
  const horizontalDist = absDy
  const verticalDist = absDx
  const diagonalDist = Math.abs(absDx - absDy)

  // Find the minimum distance to determine which axis to snap to
  const minDist = Math.min(horizontalDist, verticalDist, diagonalDist)

  if (minDist === diagonalDist) {
    // Snap to 45° diagonal
    const diagonalLength = Math.min(absDx, absDy)
    return [x1 + Math.sign(dx) * diagonalLength, y1 + Math.sign(dy) * diagonalLength]
  } else if (minDist === horizontalDist) {
    // Snap to horizontal
    return [x, y1]
  } else {
    // Snap to vertical
    return [x1, y]
  }
}

/**
 * Creates a ceiling with the given polygon points
 */
const commitCeilingDrawing = (levelId: LevelNode['id'], points: Array<[number, number]>) => {
  const { createNode, nodes } = useScene.getState()

  // Count existing ceilings for naming
  const ceilingCount = Object.values(nodes).filter((n) => n.type === 'ceiling').length
  const name = `Ceiling ${ceilingCount + 1}`

  const ceiling = CeilingNode.parse({
    name,
    polygon: points,
  })

  createNode(ceiling, levelId)
  sfxEmitter.emit('sfx:structure-build')
}

export const CeilingTool: React.FC = () => {
  const cursorRef = useRef<Mesh>(null)
  const gridCursorRef = useRef<Mesh>(null)
  const mainLineRef = useRef<Line>(null!)
  const closingLineRef = useRef<Line>(null!)
  const currentLevelId = useViewer((state) => state.selection.levelId)
  const setTool = useEditor((state) => state.setTool)

  const [points, setPoints] = useState<Array<[number, number]>>([])
  const [cursorPosition, setCursorPosition] = useState<[number, number]>([0, 0])
  const [snappedCursorPosition, setSnappedCursorPosition] = useState<[number, number]>([0, 0])
  const [levelY, setLevelY] = useState(0)
  const previousSnappedPointRef = useRef<[number, number] | null>(null)
  const shiftPressed = useRef(false)

  // Update cursor position and lines on grid move
  useEffect(() => {
    if (!currentLevelId) return

    const onGridMove = (event: GridEvent) => {
      if (!cursorRef.current || !gridCursorRef.current) return

      const gridX = Math.round(event.position[0] * 2) / 2
      const gridZ = Math.round(event.position[2] * 2) / 2
      const gridPosition: [number, number] = [gridX, gridZ]

      setCursorPosition(gridPosition)
      setLevelY(event.position[1])

      const ceilingY = event.position[1] + CEILING_HEIGHT
      const gridY = event.position[1] + GRID_OFFSET

      // Calculate snapped display position (bypass snap when Shift is held)
      const lastPoint = points[points.length - 1]
      const displayPoint =
        shiftPressed.current || !lastPoint
          ? gridPosition
          : calculateSnapPoint(lastPoint, gridPosition)
      setSnappedCursorPosition(displayPoint)

      // Play snap sound when the snapped position actually changes (only when drawing)
      if (
        points.length > 0 &&
        previousSnappedPointRef.current &&
        (displayPoint[0] !== previousSnappedPointRef.current[0] ||
          displayPoint[1] !== previousSnappedPointRef.current[1])
      ) {
        sfxEmitter.emit('sfx:grid-snap')
      }

      previousSnappedPointRef.current = displayPoint
      cursorRef.current.position.set(displayPoint[0], ceilingY, displayPoint[1])
      gridCursorRef.current.position.set(displayPoint[0], gridY, displayPoint[1])
    }

    const onGridClick = (_event: GridEvent) => {
      if (!currentLevelId) return

      // Use the last displayed snapped position (respects Shift state from onGridMove)
      const clickPoint = previousSnappedPointRef.current ?? cursorPosition

      // Check if clicking on the first point to close the shape
      const firstPoint = points[0]
      if (
        points.length >= 3 &&
        firstPoint &&
        Math.abs(clickPoint[0] - firstPoint[0]) < 0.25 &&
        Math.abs(clickPoint[1] - firstPoint[1]) < 0.25
      ) {
        // Create the ceiling
        commitCeilingDrawing(currentLevelId, points)
        setPoints([])
        setTool(null)
      } else {
        // Add point to polygon
        setPoints([...points, clickPoint])
      }
    }

    const onGridDoubleClick = (_event: GridEvent) => {
      if (!currentLevelId) return

      // Need at least 3 points to form a polygon
      if (points.length >= 3) {
        commitCeilingDrawing(currentLevelId, points)
        setPoints([])
        setTool(null)
      }
    }

    const onCancel = () => {
      setPoints([])
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftPressed.current = true
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftPressed.current = false
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('grid:double-click', onGridDoubleClick)
    emitter.on('tool:cancel', onCancel)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('grid:double-click', onGridDoubleClick)
      emitter.off('tool:cancel', onCancel)
    }
  }, [currentLevelId, points, cursorPosition, setTool])

  // Update line geometries when points change
  useEffect(() => {
    if (!mainLineRef.current || !closingLineRef.current) return

    if (points.length === 0) {
      mainLineRef.current.visible = false
      closingLineRef.current.visible = false
      return
    }

    const ceilingY = levelY + CEILING_HEIGHT
    const snappedCursor = snappedCursorPosition

    // Build main line points
    const linePoints: Vector3[] = points.map(([x, z]) => new Vector3(x, ceilingY, z))
    linePoints.push(new Vector3(snappedCursor[0], ceilingY, snappedCursor[1]))

    // Update main line
    if (linePoints.length >= 2) {
      mainLineRef.current.geometry.dispose()
      mainLineRef.current.geometry = new BufferGeometry().setFromPoints(linePoints)
      mainLineRef.current.visible = true
    } else {
      mainLineRef.current.visible = false
    }

    // Update closing line (from cursor back to first point)
    const firstPoint = points[0]
    if (points.length >= 2 && firstPoint) {
      const closingPoints = [
        new Vector3(snappedCursor[0], ceilingY, snappedCursor[1]),
        new Vector3(firstPoint[0], ceilingY, firstPoint[1]),
      ]
      closingLineRef.current.geometry.dispose()
      closingLineRef.current.geometry = new BufferGeometry().setFromPoints(closingPoints)
      closingLineRef.current.visible = true
    } else {
      closingLineRef.current.visible = false
    }
  }, [points, snappedCursorPosition, levelY])

  // Create preview shape when we have 3+ points
  const previewShape = useMemo(() => {
    if (points.length < 3) return null

    const snappedCursor = snappedCursorPosition

    const allPoints = [...points, snappedCursor]

    // THREE.Shape is in X-Y plane. After rotation of -PI/2 around X:
    // - Shape X -> World X
    // - Shape Y -> World -Z (so we negate Z to get correct orientation)
    const firstPt = allPoints[0]
    if (!firstPt) return null

    const shape = new Shape()
    shape.moveTo(firstPt[0], -firstPt[1])

    for (let i = 1; i < allPoints.length; i++) {
      const pt = allPoints[i]
      if (pt) {
        shape.lineTo(pt[0], -pt[1])
      }
    }
    shape.closePath()

    return shape
  }, [points, snappedCursorPosition])

  return (
    <group>
      {/* Cursor at ceiling height */}
      <CursorSphere ref={cursorRef} />

      {/* Grid-level cursor indicator */}
      <mesh ref={gridCursorRef} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <ringGeometry args={[0.15, 0.2, 32]} />
        <meshBasicMaterial color="#a3a3a3" side={DoubleSide} depthTest={false} depthWrite={true} />
      </mesh>

      {/* Preview fill */}
      {previewShape && (
        <mesh
          frustumCulled={false}
          position={[0, levelY + CEILING_HEIGHT, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <shapeGeometry args={[previewShape]} />
          <meshBasicMaterial
            color="#d4d4d4"
            depthTest={false}
            opacity={0.3}
            side={DoubleSide}
            transparent
          />
        </mesh>
      )}

      {/* Main line */}
      {/* @ts-ignore */}
      <line ref={mainLineRef} frustumCulled={false} renderOrder={1} visible={false}>
        <bufferGeometry />
        <lineBasicNodeMaterial color="#a3a3a3" linewidth={3} depthTest={false} depthWrite={false} />
      </line>

      {/* Closing line */}
      {/* @ts-ignore */}
      <line ref={closingLineRef} frustumCulled={false} renderOrder={1} visible={false}>
        <bufferGeometry />
        <lineBasicNodeMaterial
          color="#a3a3a3"
          linewidth={2}
          depthTest={false}
          depthWrite={false}
          opacity={0.5}
          transparent
        />
      </line>

      {/* Point markers */}
      {points.map(([x, z], index) => (
        <CursorSphere
          key={index}
          position={[x, levelY + CEILING_HEIGHT + 0.01, z]}
          color={index === 0 ? '#22c55e' : undefined}
        />
      ))}
    </group>
  )
}
