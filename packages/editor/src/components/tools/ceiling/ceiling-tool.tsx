import {
  CeilingNode,
  emitter,
  type GridEvent,
  type LevelNode,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BufferGeometry, DoubleSide, type Group, type Line, Shape, Vector3 } from 'three'
import { mix, positionLocal } from 'three/tsl'
import { EDITOR_LAYER } from '../../../lib/constants'
import { formatLengthInputValue, getLengthInputUnitLabel } from '../../../lib/measurements'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { CursorSphere } from '../shared/cursor-sphere'
import { DrawingDimensionLabel } from '../shared/drawing-dimension-label'
import {
  CLOSE_LOOP_TOLERANCE,
  formatDistance,
  getPlanDistance,
  getPlanMidpoint,
  getWallSnapPoint,
  MIN_DRAW_DISTANCE,
  type PlanPoint,
  parseDistanceInput,
  projectPointAtDistance,
  snapToGrid,
} from '../shared/drawing-utils'

const CEILING_HEIGHT = 2.52
const GRID_OFFSET = 0.02

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
 * Creates a ceiling with the given polygon points and returns its ID
 */
const commitCeilingDrawing = (levelId: LevelNode['id'], points: Array<PlanPoint>): string => {
  const { createNode, nodes } = useScene.getState()

  const ceilingCount = Object.values(nodes).filter((n) => n.type === 'ceiling').length
  const name = `Ceiling ${ceilingCount + 1}`

  const ceiling = CeilingNode.parse({
    name,
    polygon: points,
  })

  createNode(ceiling, levelId)
  sfxEmitter.emit('sfx:structure-build')
  return ceiling.id
}

export const CeilingTool: React.FC = () => {
  const unitSystem = useViewer((state) => state.unitSystem)
  const cursorRef = useRef<Group>(null)
  const gridCursorRef = useRef<Group>(null)
  const mainLineRef = useRef<Line>(null!)
  const closingLineRef = useRef<Line>(null!)
  const groundMainLineRef = useRef<Line>(null!)
  const groundClosingLineRef = useRef<Line>(null!)
  const verticalLineRef = useRef<Line>(null!)
  const currentLevelId = useViewer((state) => state.selection.levelId)
  const setSelection = useViewer((state) => state.setSelection)

  const [points, setPoints] = useState<Array<PlanPoint>>([])
  const [snappedCursorPosition, setSnappedCursorPosition] = useState<PlanPoint>([0, 0])
  const [levelY, setLevelY] = useState(0)
  const [distanceInput, setDistanceInput] = useState({ open: false, value: '' })
  const previousSnappedPointRef = useRef<PlanPoint | null>(null)
  const shiftPressed = useRef(false)
  const pointsRef = useRef<Array<PlanPoint>>([])
  const cursorPositionRef = useRef<PlanPoint>([0, 0])
  const snappedCursorPositionRef = useRef<PlanPoint>([0, 0])
  const levelYRef = useRef(0)
  const inputOpenRef = useRef(false)
  const ignoreNextGridClickRef = useRef(false)

  const verticalGeo = useMemo(
    () =>
      new BufferGeometry().setFromPoints([
        new Vector3(0, 0, 0),
        new Vector3(0, CEILING_HEIGHT - GRID_OFFSET, 0),
      ]),
    [],
  )

  const gradientOpacityNode = useMemo(
    () => mix(0.6, 0.0, positionLocal.y.div(CEILING_HEIGHT - GRID_OFFSET).clamp()),
    [],
  )

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
        const ceilingId = commitCeilingDrawing(currentLevelId, pointsRef.current)
        setSelection({ selectedIds: [ceilingId] })
        clearDraft()
        return
      }

      updatePoints([...pointsRef.current, point])
    },
    [clearDraft, currentLevelId, setSelection, updatePoints],
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

    const ceilingY = levelYRef.current + CEILING_HEIGHT
    const gridY = levelYRef.current + GRID_OFFSET
    cursorRef.current?.position.set(projected[0], ceilingY, projected[1])
    gridCursorRef.current?.position.set(projected[0], gridY, projected[1])
    verticalLineRef.current?.position.set(projected[0], gridY, projected[1])

    if (options?.commitAfterApply) {
      closeDistanceInput()
      commitDraftPoint(projected)
      return
    }

    closeDistanceInput(options)
  }

  useEffect(() => {
    if (!currentLevelId) return

    const getLevelWalls = () =>
      Object.values(useScene.getState().nodes).filter(
        (node): node is WallNode => node.type === 'wall' && node.parentId === currentLevelId,
      )

    const onGridMove = (event: GridEvent) => {
      if (!(cursorRef.current && gridCursorRef.current)) return
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
        : (getWallSnapPoint(basePoint, getLevelWalls()) ?? basePoint)

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

      const ceilingY = event.position[1] + CEILING_HEIGHT
      const gridY = event.position[1] + GRID_OFFSET
      cursorRef.current.position.set(displayPoint[0], ceilingY, displayPoint[1])
      gridCursorRef.current.position.set(displayPoint[0], gridY, displayPoint[1])
      verticalLineRef.current?.position.set(displayPoint[0], gridY, displayPoint[1])
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
        const ceilingId = commitCeilingDrawing(currentLevelId, pointsRef.current)
        setSelection({ selectedIds: [ceilingId] })
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
  }, [clearDraft, commitDraftPoint, currentLevelId, setSelection, unitSystem])

  useEffect(() => {
    if (!(mainLineRef.current && closingLineRef.current)) return

    if (points.length === 0) {
      mainLineRef.current.visible = false
      closingLineRef.current.visible = false
      groundMainLineRef.current.visible = false
      groundClosingLineRef.current.visible = false
      return
    }

    const ceilingY = levelY + CEILING_HEIGHT
    const snappedCursor = snappedCursorPosition

    const linePoints: Vector3[] = points.map(([x, z]) => new Vector3(x, ceilingY, z))
    linePoints.push(new Vector3(snappedCursor[0], ceilingY, snappedCursor[1]))

    const gridY = levelY + GRID_OFFSET
    const groundLinePoints: Vector3[] = points.map(([x, z]) => new Vector3(x, gridY, z))
    groundLinePoints.push(new Vector3(snappedCursor[0], gridY, snappedCursor[1]))

    if (linePoints.length >= 2) {
      mainLineRef.current.geometry.dispose()
      mainLineRef.current.geometry = new BufferGeometry().setFromPoints(linePoints)
      mainLineRef.current.visible = true

      groundMainLineRef.current.geometry.dispose()
      groundMainLineRef.current.geometry = new BufferGeometry().setFromPoints(groundLinePoints)
      groundMainLineRef.current.visible = true
    } else {
      mainLineRef.current.visible = false
      groundMainLineRef.current.visible = false
    }

    const firstPoint = points[0]
    if (points.length >= 2 && firstPoint) {
      const closingPoints = [
        new Vector3(snappedCursor[0], ceilingY, snappedCursor[1]),
        new Vector3(firstPoint[0], ceilingY, firstPoint[1]),
      ]
      closingLineRef.current.geometry.dispose()
      closingLineRef.current.geometry = new BufferGeometry().setFromPoints(closingPoints)
      closingLineRef.current.visible = true

      const groundClosingPoints = [
        new Vector3(snappedCursor[0], gridY, snappedCursor[1]),
        new Vector3(firstPoint[0], gridY, firstPoint[1]),
      ]
      groundClosingLineRef.current.geometry.dispose()
      groundClosingLineRef.current.geometry = new BufferGeometry().setFromPoints(
        groundClosingPoints,
      )
      groundClosingLineRef.current.visible = true
    } else {
      closingLineRef.current.visible = false
      groundClosingLineRef.current.visible = false
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

      <mesh
        layers={EDITOR_LAYER}
        ref={gridCursorRef}
        renderOrder={2}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[0.15, 0.2, 32]} />
        <meshBasicMaterial
          color="#818cf8"
          depthTest={false}
          depthWrite={true}
          opacity={0.5}
          side={DoubleSide}
          transparent
        />
      </mesh>

      {/* @ts-ignore */}
      <line geometry={verticalGeo} layers={EDITOR_LAYER} ref={verticalLineRef} renderOrder={1}>
        <lineBasicNodeMaterial
          color="#818cf8"
          depthTest={false}
          depthWrite={false}
          opacityNode={gradientOpacityNode}
          transparent
        />
      </line>

      {previewShape && (
        <mesh
          frustumCulled={false}
          layers={EDITOR_LAYER}
          position={[0, levelY + CEILING_HEIGHT, 0]}
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

      {previewShape && (
        <mesh
          frustumCulled={false}
          layers={EDITOR_LAYER}
          position={[0, levelY + GRID_OFFSET, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <shapeGeometry args={[previewShape]} />
          <meshBasicMaterial
            color="#818cf8"
            depthTest={false}
            opacity={0.1}
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

      {/* @ts-ignore */}
      <line
        frustumCulled={false}
        layers={EDITOR_LAYER}
        ref={groundMainLineRef}
        renderOrder={1}
        visible={false}
      >
        <bufferGeometry />
        <lineBasicNodeMaterial
          color="#818cf8"
          depthTest={false}
          depthWrite={false}
          linewidth={3}
          opacity={0.3}
          transparent
        />
      </line>

      {/* @ts-ignore */}
      <line
        frustumCulled={false}
        layers={EDITOR_LAYER}
        ref={groundClosingLineRef}
        renderOrder={1}
        visible={false}
      >
        <bufferGeometry />
        <lineBasicNodeMaterial
          color="#818cf8"
          depthTest={false}
          depthWrite={false}
          linewidth={2}
          opacity={0.15}
          transparent
        />
      </line>

      {points.map(([x, z], index) => (
        <CursorSphere
          color="#818cf8"
          key={index}
          position={[x, levelY + CEILING_HEIGHT + 0.01, z]}
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
          position={[
            currentSegment.midpoint[0],
            levelY + CEILING_HEIGHT + 0.18,
            currentSegment.midpoint[1],
          ]}
          value={formatDistance(currentSegment.distance, unitSystem)}
        />
      )}
    </group>
  )
}
