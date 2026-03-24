import {
  emitter,
  type GridEvent,
  type LevelNode,
  useScene,
  type WallNode,
  ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BufferGeometry, DoubleSide, type Group, type Line, Shape, Vector3 } from 'three'
import { PALETTE_COLORS } from './../../../components/ui/primitives/color-dot'
import { EDITOR_LAYER } from './../../../lib/constants'
import { formatLengthInputValue, getLengthInputUnitLabel } from './../../../lib/measurements'
import { sfxEmitter } from './../../../lib/sfx-bus'
import useEditor from './../../../store/use-editor'
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
const calculateSnapPoint = (lastPoint: PlanPoint, currentPoint: PlanPoint): PlanPoint => {
  const [x1, y1] = lastPoint
  const [x, y] = currentPoint

  const dx = x - x1
  const dy = y - y1
  const absDx = Math.abs(dx)
  const absDy = Math.abs(dy)

  const horizontalDist = absDy
  const verticalDist = absDx
  const diagonalDist = Math.abs(absDx - absDy)
  const minDist = Math.min(horizontalDist, verticalDist, diagonalDist)

  if (minDist === diagonalDist) {
    const diagonalLength = Math.min(absDx, absDy)
    return [x1 + Math.sign(dx) * diagonalLength, y1 + Math.sign(dy) * diagonalLength]
  }
  if (minDist === horizontalDist) {
    return [x, y1]
  }
  return [x1, y]
}

/**
 * Creates a zone with the given polygon points
 */
const commitZoneDrawing = (levelId: LevelNode['id'], points: Array<PlanPoint>) => {
  const { createNode, nodes } = useScene.getState()

  const zoneCount = Object.values(nodes).filter((n) => n.type === 'zone').length
  const name = `Zone ${zoneCount + 1}`
  const color = PALETTE_COLORS[zoneCount % PALETTE_COLORS.length]

  const zone = ZoneNode.parse({
    name,
    polygon: points,
    color,
  })

  createNode(zone, levelId)
  useViewer.getState().setSelection({ zoneId: zone.id })
}

export const ZoneTool: React.FC = () => {
  const currentLevelId = useViewer((state) => state.selection.levelId)
  const measurementGuides = useEditor((state) => state.measurementGuides)
  const showGuides = useViewer((state) => state.showGuides)
  const unitSystem = useViewer((state) => state.unitSystem)
  const cursorRef = useRef<Group>(null)
  const mainLineRef = useRef<Line>(null!)
  const closingLineRef = useRef<Line>(null!)
  const pointsRef = useRef<Array<PlanPoint>>([])
  const levelYRef = useRef(0)
  const cursorPositionRef = useRef<PlanPoint>([0, 0])
  const snappedCursorPositionRef = useRef<PlanPoint>([0, 0])
  const previousSnappedPointRef = useRef<PlanPoint | null>(null)
  const shiftPressed = useRef(false)
  const inputOpenRef = useRef(false)
  const ignoreNextGridClickRef = useRef(false)

  const [points, setPoints] = useState<Array<PlanPoint>>([])
  const [snappedCursorPosition, setSnappedCursorPosition] = useState<PlanPoint>([0, 0])
  const [levelY, setLevelY] = useState(0)
  const [distanceInput, setDistanceInput] = useState({ open: false, value: '' })

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

  const clearDraft = useCallback(() => {
    updatePoints([])
    previousSnappedPointRef.current = null
    closeDistanceInput()
    if (mainLineRef.current.geometry) {
      mainLineRef.current.visible = false
      closingLineRef.current.visible = false
    }
  }, [closeDistanceInput, updatePoints])

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
        commitZoneDrawing(currentLevelId, pointsRef.current)
        clearDraft()
        return
      }

      updatePoints([...pointsRef.current, point])
    },
    [clearDraft, currentLevelId, updatePoints],
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

  useEffect(() => {
    if (!currentLevelId) return

    mainLineRef.current.geometry = new BufferGeometry()
    closingLineRef.current.geometry = new BufferGeometry()

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
      if (inputOpenRef.current) return

      const gridPosition: PlanPoint = [snapToGrid(event.position[0]), snapToGrid(event.position[2])]

      cursorPositionRef.current = gridPosition
      levelYRef.current = event.position[1]
      setLevelY(event.position[1])

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

      const clickPoint = previousSnappedPointRef.current ?? cursorPositionRef.current
      commitDraftPoint(clickPoint)
    }

    const onGridDoubleClick = (_event: GridEvent) => {
      if (!currentLevelId) return

      if (pointsRef.current.length >= 3) {
        commitZoneDrawing(currentLevelId, pointsRef.current)
        clearDraft()
      }
    }

    const onCancel = () => {
      clearDraft()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      if (event.key === 'Shift') {
        shiftPressed.current = true
        return
      }

      if (event.key !== 'Tab' || pointsRef.current.length === 0) return

      const lastPoint = pointsRef.current[pointsRef.current.length - 1]
      if (!lastPoint) return

      const currentDistance = getPlanDistance(lastPoint, snappedCursorPositionRef.current)
      if (currentDistance < MIN_DRAW_DISTANCE) return

      event.preventDefault()
      shiftPressed.current = false
      inputOpenRef.current = true
      setDistanceInput({
        open: true,
        value: formatLengthInputValue(currentDistance, unitSystem),
      })
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        shiftPressed.current = false
      }
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('grid:double-click', onGridDoubleClick)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('grid:double-click', onGridDoubleClick)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [clearDraft, commitDraftPoint, currentLevelId, measurementGuides, showGuides, unitSystem])

  useEffect(() => {
    if (!(mainLineRef.current && closingLineRef.current)) return

    if (points.length === 0) {
      mainLineRef.current.visible = false
      closingLineRef.current.visible = false
      return
    }

    const y = levelY + Y_OFFSET
    const linePoints: Vector3[] = points.map(([x, z]) => new Vector3(x, y, z))
    linePoints.push(new Vector3(snappedCursorPosition[0], y, snappedCursorPosition[1]))

    if (linePoints.length >= 2) {
      mainLineRef.current.geometry.dispose()
      mainLineRef.current.geometry = new BufferGeometry().setFromPoints(linePoints)
      mainLineRef.current.visible = true
    } else {
      mainLineRef.current.visible = false
    }

    const firstPoint = points[0]
    if (points.length >= 2 && firstPoint) {
      const closingPoints = [
        new Vector3(snappedCursorPosition[0], y, snappedCursorPosition[1]),
        new Vector3(firstPoint[0], y, firstPoint[1]),
      ]
      closingLineRef.current.geometry.dispose()
      closingLineRef.current.geometry = new BufferGeometry().setFromPoints(closingPoints)
      closingLineRef.current.visible = true
    } else {
      closingLineRef.current.visible = false
    }
  }, [levelY, points, snappedCursorPosition])

  const previewShape = useMemo(() => {
    if (points.length < 3) return null

    const allPoints = [...points, snappedCursorPosition]
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
      <CursorSphere ref={cursorRef} />

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
