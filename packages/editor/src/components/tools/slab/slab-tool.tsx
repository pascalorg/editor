import {
  emitter,
  type GridEvent,
  type LevelNode,
  SlabNode,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BufferGeometry, DoubleSide, type Group, type Line, Shape, Vector3 } from 'three'
import { EDITOR_LAYER } from '../../../lib/constants'
import { formatLengthInputValue, getLengthInputUnitLabel } from '../../../lib/measurements'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'
import { DrawingDimensionLabel } from '../shared/drawing-dimension-label'
import {
  CLOSE_LOOP_TOLERANCE,
  formatDistance,
  getPlanDistance,
  getPlanMidpoint,
  getSegmentSnapPoint,
  MIN_DRAW_DISTANCE,
  type PlanPoint,
  parseDistanceInput,
  projectPointAtDistance,
  snapToGrid,
} from '../shared/drawing-utils'

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
  }
  if (minDist === horizontalDist) {
    // Snap to horizontal
    return [x, y1]
  }
  // Snap to vertical
  return [x1, y]
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
  const measurementGuides = useEditor((state) => state.measurementGuides)
  const showGuides = useViewer((state) => state.showGuides)
  const unitSystem = useViewer((state) => state.unitSystem)
  const cursorRef = useRef<Group>(null)
  const mainLineRef = useRef<Line>(null!)
  const closingLineRef = useRef<Line>(null!)
  const currentLevelId = useViewer((state) => state.selection.levelId)
  const setSelection = useViewer((state) => state.setSelection)

  const [points, setPoints] = useState<Array<[number, number]>>([])
  const [snappedCursorPosition, setSnappedCursorPosition] = useState<[number, number]>([0, 0])
  const [levelY, setLevelY] = useState(0)
  const [distanceInput, setDistanceInput] = useState({ open: false, value: '' })
  const previousSnappedPointRef = useRef<[number, number] | null>(null)
  const shiftPressed = useRef(false)
  const pointsRef = useRef<Array<PlanPoint>>([])
  const cursorPositionRef = useRef<PlanPoint>([0, 0])
  const snappedCursorPositionRef = useRef<PlanPoint>([0, 0])
  const levelYRef = useRef(0)
  const inputOpenRef = useRef(false)
  const ignoreNextGridClickRef = useRef(false)

  const updatePoints = useCallback((nextPoints: Array<PlanPoint>) => {
    pointsRef.current = nextPoints
    setPoints(nextPoints)
  }, [])

  const closeDistanceInput = useCallback((options?: { ignoreNextGridClick?: boolean }) => {
    inputOpenRef.current = false
    shiftPressed.current = false
    if (options?.ignoreNextGridClick) {
      ignoreNextGridClickRef.current = true
    }
    setDistanceInput({ open: false, value: '' })
  }, [])

  const commitDraftPoint = useCallback(
    (point: PlanPoint) => {
      if (!currentLevelId) return

      const firstPoint = pointsRef.current[0]
      if (
        pointsRef.current.length >= 3 &&
        firstPoint &&
        Math.abs(point[0] - firstPoint[0]) < CLOSE_LOOP_TOLERANCE &&
        Math.abs(point[1] - firstPoint[1]) < CLOSE_LOOP_TOLERANCE
      ) {
        const slabId = commitSlabDrawing(currentLevelId, pointsRef.current)
        setSelection({ selectedIds: [slabId] })
        updatePoints([])
        previousSnappedPointRef.current = null
        closeDistanceInput()
        return
      }

      updatePoints([...pointsRef.current, point])
    },
    [closeDistanceInput, currentLevelId, setSelection, updatePoints],
  )

  const applyDistanceInput = (
    rawValue: string,
    options?: { commitAfterApply?: boolean; ignoreNextGridClick?: boolean },
  ) => {
    const lastPoint = pointsRef.current[pointsRef.current.length - 1]
    if (!lastPoint) {
      closeDistanceInput(options)
      return
    }

    const parsedDistance = parseDistanceInput(rawValue, unitSystem)
    if (!(parsedDistance && parsedDistance >= MIN_DRAW_DISTANCE)) {
      closeDistanceInput(options)
      return
    }

    const projected = projectPointAtDistance(
      lastPoint,
      snappedCursorPositionRef.current,
      parsedDistance,
    )
    cursorPositionRef.current = projected
    snappedCursorPositionRef.current = projected
    previousSnappedPointRef.current = projected
    setSnappedCursorPosition(projected)
    cursorRef.current?.position.set(projected[0], levelYRef.current, projected[1])

    if (options?.commitAfterApply) {
      closeDistanceInput()
      commitDraftPoint(projected)
      return
    }

    closeDistanceInput(options)
  }

  // Update cursor position and lines on grid move
  useEffect(() => {
    if (!currentLevelId) return
    const getLevelWalls = () =>
      Object.values(useScene.getState().nodes).filter(
        (node): node is WallNode => node.type === 'wall' && node.parentId === currentLevelId,
      )
    const getSnapSegments = () => [
      ...getLevelWalls(),
      ...(showGuides
        ? measurementGuides
            .filter((guide) => guide.levelId === currentLevelId)
            .map((guide) => ({ start: guide.start, end: guide.end }))
        : []),
    ]

    const onGridMove = (event: GridEvent) => {
      if (!cursorRef.current) return

      const gridX = snapToGrid(event.position[0])
      const gridZ = snapToGrid(event.position[2])
      const gridPosition: PlanPoint = [gridX, gridZ]

      if (inputOpenRef.current) return

      cursorPositionRef.current = gridPosition
      levelYRef.current = event.position[1]
      setLevelY(event.position[1])

      // Calculate snapped display position (bypass snap when Shift is held)
      const lastPoint = pointsRef.current[pointsRef.current.length - 1]
      const basePoint =
        shiftPressed.current || !lastPoint
          ? gridPosition
          : calculateSnapPoint(lastPoint, gridPosition)
      const displayPoint = shiftPressed.current
        ? basePoint
        : (getSegmentSnapPoint(basePoint, getSnapSegments()) ?? basePoint)
      snappedCursorPositionRef.current = displayPoint
      setSnappedCursorPosition(displayPoint)

      // Play snap sound when the snapped position actually changes (only when drawing)
      if (
        pointsRef.current.length > 0 &&
        previousSnappedPointRef.current &&
        (displayPoint[0] !== previousSnappedPointRef.current[0] ||
          displayPoint[1] !== previousSnappedPointRef.current[1])
      ) {
        sfxEmitter.emit('sfx:grid-snap')
      }

      previousSnappedPointRef.current = displayPoint
      cursorRef.current.position.set(displayPoint[0], event.position[1], displayPoint[1])
    }

    const onGridClick = (_event: GridEvent) => {
      if (!currentLevelId) return
      if (ignoreNextGridClickRef.current) {
        ignoreNextGridClickRef.current = false
        return
      }
      if (inputOpenRef.current) return

      // Use the last displayed snapped position (respects Shift state from onGridMove)
      const clickPoint = previousSnappedPointRef.current ?? cursorPositionRef.current

      // Check if clicking on the first point to close the shape
      commitDraftPoint(clickPoint)
    }

    const onGridDoubleClick = (_event: GridEvent) => {
      if (!currentLevelId) return

      // Need at least 3 points to form a polygon
      if (pointsRef.current.length >= 3) {
        const slabId = commitSlabDrawing(currentLevelId, pointsRef.current)
        setSelection({ selectedIds: [slabId] })
        updatePoints([])
        previousSnappedPointRef.current = null
        closeDistanceInput()
      }
    }

    const onCancel = () => {
      updatePoints([])
      previousSnappedPointRef.current = null
      closeDistanceInput()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if (e.key === 'Shift') {
        shiftPressed.current = true
        return
      }

      if (e.key !== 'Tab' || pointsRef.current.length === 0) return

      const lastPoint = pointsRef.current[pointsRef.current.length - 1]
      if (!lastPoint) return

      const currentDistance = getPlanDistance(lastPoint, snappedCursorPositionRef.current)
      if (currentDistance < MIN_DRAW_DISTANCE) return

      e.preventDefault()
      shiftPressed.current = false
      inputOpenRef.current = true
      setDistanceInput({
        open: true,
        value: formatLengthInputValue(currentDistance, unitSystem),
      })
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
  }, [
    closeDistanceInput,
    commitDraftPoint,
    currentLevelId,
    measurementGuides,
    setSelection,
    showGuides,
    unitSystem,
    updatePoints,
  ])

  // Update line geometries when points change
  useEffect(() => {
    if (!(mainLineRef.current && closingLineRef.current)) return

    if (points.length === 0) {
      mainLineRef.current.visible = false
      closingLineRef.current.visible = false
      return
    }

    const y = levelY + Y_OFFSET
    const snappedCursor = snappedCursorPosition

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

  const currentSegment = useMemo(() => {
    const lastPoint = points[points.length - 1]
    if (!lastPoint) return null

    const distance = getPlanDistance(lastPoint, snappedCursorPosition)
    if (distance < MIN_DRAW_DISTANCE) return null

    return {
      distance,
      midpoint: getPlanMidpoint(lastPoint, snappedCursorPosition),
    }
  }, [points, snappedCursorPosition])

  return (
    <group>
      {/* Cursor */}
      <CursorSphere ref={cursorRef} />

      {/* Preview fill */}
      {previewShape && (
        <mesh
          frustumCulled={false}
          layers={EDITOR_LAYER}
          position={[0, levelY + Y_OFFSET, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <shapeGeometry args={[previewShape]} />
          <meshBasicMaterial
            color="#818cf8"
            depthTest={false}
            opacity={0.15}
            side={DoubleSide}
            transparent
          />
        </mesh>
      )}

      {/* Main line */}
      {/* @ts-ignore */}
      <line
        frustumCulled={false}
        layers={EDITOR_LAYER}
        ref={mainLineRef}
        renderOrder={1}
        visible={false}
      >
        <bufferGeometry />
        <lineBasicNodeMaterial color="#818cf8" depthTest={false} depthWrite={false} linewidth={3} />
      </line>

      {/* Closing line */}
      {/* @ts-ignore */}
      <line
        frustumCulled={false}
        layers={EDITOR_LAYER}
        ref={closingLineRef}
        renderOrder={1}
        visible={false}
      >
        <bufferGeometry />
        <lineBasicNodeMaterial
          color="#818cf8"
          depthTest={false}
          depthWrite={false}
          linewidth={2}
          opacity={0.5}
          transparent
        />
      </line>

      {/* Point markers */}
      {points.map(([x, z], index) => (
        <CursorSphere
          color="#818cf8"
          height={0}
          key={index}
          position={[x, levelY + Y_OFFSET + 0.01, z]}
          showTooltip={false}
        />
      ))}

      {currentSegment && (
        <DrawingDimensionLabel
          hint="Enter to place, Esc to cancel"
          inputLabel="Segment length"
          inputUnitLabel={getLengthInputUnitLabel(unitSystem)}
          inputValue={distanceInput.value}
          isEditing={distanceInput.open}
          onInputBlur={() => {
            if (!inputOpenRef.current) return
            applyDistanceInput(distanceInput.value, { ignoreNextGridClick: true })
          }}
          onInputChange={(value) => {
            setDistanceInput((current) => ({ ...current, value }))
          }}
          onInputKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              applyDistanceInput(distanceInput.value, { commitAfterApply: true })
            } else if (event.key === 'Escape') {
              event.preventDefault()
              closeDistanceInput()
            }
          }}
          position={[currentSegment.midpoint[0], levelY + 0.18, currentSegment.midpoint[1]]}
          value={formatDistance(currentSegment.distance, unitSystem)}
        />
      )}
    </group>
  )
}
