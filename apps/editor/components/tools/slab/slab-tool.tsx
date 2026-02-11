import { emitter, type GridEvent, type LevelNode, SlabNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BufferGeometry, DoubleSide, type Line, type Mesh, Shape, Vector3 } from 'three'
import { sfxEmitter } from '@/lib/sfx-bus'

const Y_OFFSET = 0.02

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
 * Creates a slab with the given polygon points and returns its ID
 */
const commitSlabDrawing = (levelId: LevelNode['id'], points: Array<[number, number]>): string => {
  const { createNode, nodes } = useScene.getState()

  // Count existing slabs for naming
  const slabCount = Object.values(nodes).filter((n) => n.type === 'slab').length
  const name = `Slab ${slabCount + 1}`

  const slab = SlabNode.parse({
    name,
    polygon: points,
  })

  createNode(slab, levelId)
  sfxEmitter.emit('sfx:structure-build')
  return slab.id
}

export const SlabTool: React.FC = () => {
  const cursorRef = useRef<Mesh>(null)
  const mainLineRef = useRef<Line>(null!)
  const closingLineRef = useRef<Line>(null!)
  const currentLevelId = useViewer((state) => state.selection.levelId)
  const setSelection = useViewer((state) => state.setSelection)

  const [points, setPoints] = useState<Array<[number, number]>>([])
  const [cursorPosition, setCursorPosition] = useState<[number, number]>([0, 0])
  const [levelY, setLevelY] = useState(0)
  const previousSnappedPointRef = useRef<[number, number] | null>(null)

  // Update cursor position and lines on grid move
  useEffect(() => {
    if (!currentLevelId) return

    const onGridMove = (event: GridEvent) => {
      if (!cursorRef.current) return

      const gridX = Math.round(event.position[0] * 2) / 2
      const gridZ = Math.round(event.position[2] * 2) / 2
      const gridPosition: [number, number] = [gridX, gridZ]

      setCursorPosition(gridPosition)
      setLevelY(event.position[1])

      // Calculate snapped display position
      const lastPoint = points[points.length - 1]
      const displayPoint = lastPoint ? calculateSnapPoint(lastPoint, gridPosition) : gridPosition

      // Play snap sound when the snapped position actually changes (only when drawing)
      if (points.length > 0 && previousSnappedPointRef.current &&
          (displayPoint[0] !== previousSnappedPointRef.current[0] || displayPoint[1] !== previousSnappedPointRef.current[1])) {
        sfxEmitter.emit('sfx:grid-snap')
      }

      previousSnappedPointRef.current = displayPoint
      cursorRef.current.position.set(displayPoint[0], event.position[1], displayPoint[1])
    }

    const onGridClick = (_event: GridEvent) => {
      if (!currentLevelId) return

      // Calculate snapped click point
      const lastPoint = points[points.length - 1]
      const clickPoint = lastPoint ? calculateSnapPoint(lastPoint, cursorPosition) : cursorPosition

      // Check if clicking on the first point to close the shape
      const firstPoint = points[0]
      if (
        points.length >= 3 &&
        firstPoint &&
        Math.abs(clickPoint[0] - firstPoint[0]) < 0.25 &&
        Math.abs(clickPoint[1] - firstPoint[1]) < 0.25
      ) {
        // Create the slab and select it
        const slabId = commitSlabDrawing(currentLevelId, points)
        setSelection({ selectedIds: [slabId] })
        setPoints([])
      } else {
        // Add point to polygon
        setPoints([...points, clickPoint])
      }
    }

    const onGridDoubleClick = (_event: GridEvent) => {
      if (!currentLevelId) return

      // Need at least 3 points to form a polygon
      if (points.length >= 3) {
        const slabId = commitSlabDrawing(currentLevelId, points)
        setSelection({ selectedIds: [slabId] })
        setPoints([])
      }
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('grid:double-click', onGridDoubleClick)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('grid:double-click', onGridDoubleClick)
    }
  }, [currentLevelId, points, cursorPosition, setSelection])

  // Update line geometries when points change
  useEffect(() => {
    if (!mainLineRef.current || !closingLineRef.current) return

    if (points.length === 0) {
      mainLineRef.current.visible = false
      closingLineRef.current.visible = false
      return
    }

    const y = levelY + Y_OFFSET
    const lastPoint = points[points.length - 1]
    const snappedCursor = lastPoint ? calculateSnapPoint(lastPoint, cursorPosition) : cursorPosition

    // Build main line points
    const linePoints: Vector3[] = points.map(([x, z]) => new Vector3(x, y, z))
    linePoints.push(new Vector3(snappedCursor[0], y, snappedCursor[1]))

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
        new Vector3(snappedCursor[0], y, snappedCursor[1]),
        new Vector3(firstPoint[0], y, firstPoint[1]),
      ]
      closingLineRef.current.geometry.dispose()
      closingLineRef.current.geometry = new BufferGeometry().setFromPoints(closingPoints)
      closingLineRef.current.visible = true
    } else {
      closingLineRef.current.visible = false
    }
  }, [points, cursorPosition, levelY])

  // Create preview shape when we have 3+ points
  const previewShape = useMemo(() => {
    if (points.length < 3) return null

    const lastPoint = points[points.length - 1]
    const snappedCursor = lastPoint ? calculateSnapPoint(lastPoint, cursorPosition) : cursorPosition

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
  }, [points, cursorPosition])

  return (
    <group>
      {/* Cursor */}
      <mesh ref={cursorRef}>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshBasicMaterial color="#a3a3a3" depthTest={false} depthWrite={false} />
      </mesh>

      {/* Preview fill */}
      {previewShape && (
        <mesh
          frustumCulled={false}
          position={[0, levelY + Y_OFFSET, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <shapeGeometry args={[previewShape]} />
          <meshBasicMaterial
            color="#a3a3a3"
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
        <lineBasicNodeMaterial color="#737373" linewidth={3} depthTest={false} depthWrite={false} />
      </line>

      {/* Closing line */}
      {/* @ts-ignore */}
      <line ref={closingLineRef} frustumCulled={false} renderOrder={1} visible={false}>
        <bufferGeometry />
        <lineBasicNodeMaterial
          color="#737373"
          linewidth={2}
          depthTest={false}
          depthWrite={false}
          opacity={0.5}
          transparent
        />
      </line>

      {/* Point markers */}
      {points.map(([x, z], index) => (
        <mesh key={index} position={[x, levelY + Y_OFFSET + 0.01, z]}>
          <sphereGeometry args={[0.1, 16, 16]} />
          <meshBasicMaterial
            color={index === 0 ? '#22c55e' : '#a3a3a3'}
            depthTest={false}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  )
}
