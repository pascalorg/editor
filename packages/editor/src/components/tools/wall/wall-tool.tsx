import { emitter, type GridEvent, useScene, WallNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DoubleSide, type Group, type Mesh, Shape, ShapeGeometry, Vector3 } from 'three'
import { EDITOR_LAYER } from '../../../lib/constants'
import { formatLengthInputValue, getLengthInputUnitLabel } from '../../../lib/measurements'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { CursorSphere } from '../shared/cursor-sphere'
import { DrawingDimensionLabel } from '../shared/drawing-dimension-label'
import {
  formatDistance,
  getPlanDistance,
  getPlanMidpoint,
  MIN_DRAW_DISTANCE,
  type PlanPoint,
  parseDistanceInput,
  projectPointAtDistance,
  snapSegmentTo45Degrees,
  snapToGrid,
} from '../shared/drawing-utils'

const WALL_HEIGHT = 2.5
const WALL_THICKNESS = 0.15

type WallDraft = {
  start: PlanPoint | null
  end: PlanPoint | null
  levelY: number
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
  const { createNode, nodes } = useScene.getState()

  if (!currentLevelId) return

  const wallCount = Object.values(nodes).filter((n) => n.type === 'wall').length
  const name = `Wall ${wallCount + 1}`

  const wall = WallNode.parse({ name, start, end })

  createNode(wall, currentLevelId)
  sfxEmitter.emit('sfx:structure-build')
}

export const WallTool: React.FC = () => {
  const unitSystem = useViewer((state) => state.unitSystem)
  const cursorRef = useRef<Group>(null)
  const wallPreviewRef = useRef<Mesh>(null!)
  const startingPoint = useRef(new Vector3(0, 0, 0))
  const endingPoint = useRef(new Vector3(0, 0, 0))
  const buildingState = useRef(0)
  const shiftPressed = useRef(false)
  const levelYRef = useRef(0)
  const inputOpenRef = useRef(false)
  const ignoreNextGridClickRef = useRef(false)

  const [draft, setDraft] = useState<WallDraft>({
    start: null,
    end: null,
    levelY: 0,
  })
  const [distanceInput, setDistanceInput] = useState({ open: false, value: '' })

  const closeDistanceInput = useCallback((options?: { ignoreNextGridClick?: boolean }) => {
    inputOpenRef.current = false
    shiftPressed.current = false
    if (options?.ignoreNextGridClick) {
      ignoreNextGridClickRef.current = true
    }
    setDistanceInput({ open: false, value: '' })
  }, [])

  const syncDraftState = useCallback(() => {
    setDraft({
      start: [startingPoint.current.x, startingPoint.current.z],
      end: [endingPoint.current.x, endingPoint.current.z],
      levelY: levelYRef.current,
    })
  }, [])

  const applyDistanceInput = (rawValue: string, options?: { ignoreNextGridClick?: boolean }) => {
    if (buildingState.current !== 1) {
      closeDistanceInput(options)
      return
    }

    const parsedDistance = parseDistanceInput(rawValue, unitSystem)
    if (!(parsedDistance && parsedDistance >= MIN_DRAW_DISTANCE)) {
      closeDistanceInput(options)
      return
    }

    const start: PlanPoint = [startingPoint.current.x, startingPoint.current.z]
    const currentEnd: PlanPoint = [endingPoint.current.x, endingPoint.current.z]
    const projected = projectPointAtDistance(start, currentEnd, parsedDistance)

    endingPoint.current.set(projected[0], levelYRef.current, projected[1])
    cursorRef.current?.position.set(projected[0], levelYRef.current, projected[1])
    updateWallPreview(wallPreviewRef.current, startingPoint.current, endingPoint.current)
    syncDraftState()
    closeDistanceInput(options)
  }

  useEffect(() => {
    let gridPosition: PlanPoint = [0, 0]
    let previousWallEnd: PlanPoint | null = null

    const onGridMove = (event: GridEvent) => {
      if (!(cursorRef.current && wallPreviewRef.current)) return

      gridPosition = [snapToGrid(event.position[0]), snapToGrid(event.position[2])]
      levelYRef.current = event.position[1]
      const cursorPosition: PlanPoint = [gridPosition[0], gridPosition[1]]

      if (buildingState.current === 1) {
        if (inputOpenRef.current) return

        const start: PlanPoint = [startingPoint.current.x, startingPoint.current.z]
        const snapped = shiftPressed.current
          ? cursorPosition
          : snapSegmentTo45Degrees(start, cursorPosition)

        endingPoint.current.set(snapped[0], event.position[1], snapped[1])

        // Position the cursor at the end of the wall being drawn
        cursorRef.current.position.set(snapped[0], event.position[1], snapped[1])

        // Play snap sound only when the actual wall end position changes
        const currentWallEnd: PlanPoint = [endingPoint.current.x, endingPoint.current.z]
        if (
          previousWallEnd &&
          (currentWallEnd[0] !== previousWallEnd[0] || currentWallEnd[1] !== previousWallEnd[1])
        ) {
          sfxEmitter.emit('sfx:grid-snap')
        }
        previousWallEnd = currentWallEnd

        // Update wall preview geometry
        updateWallPreview(wallPreviewRef.current, startingPoint.current, endingPoint.current)
        syncDraftState()
      } else {
        // Not drawing a wall, just follow the grid position
        cursorRef.current.position.set(gridPosition[0], event.position[1], gridPosition[1])
      }
    }

    const onGridClick = (event: GridEvent) => {
      if (ignoreNextGridClickRef.current) {
        ignoreNextGridClickRef.current = false
        return
      }

      if (inputOpenRef.current) return

      if (buildingState.current === 0) {
        startingPoint.current.set(gridPosition[0], event.position[1], gridPosition[1])
        endingPoint.current.copy(startingPoint.current)
        levelYRef.current = event.position[1]
        buildingState.current = 1
        wallPreviewRef.current.visible = true
        syncDraftState()
      } else if (buildingState.current === 1) {
        const dx = endingPoint.current.x - startingPoint.current.x
        const dz = endingPoint.current.z - startingPoint.current.z
        if (dx * dx + dz * dz < MIN_DRAW_DISTANCE * MIN_DRAW_DISTANCE) return
        commitWallDrawing(
          [startingPoint.current.x, startingPoint.current.z],
          [endingPoint.current.x, endingPoint.current.z],
        )
        wallPreviewRef.current.visible = false
        buildingState.current = 0
        closeDistanceInput()
        setDraft({ start: null, end: null, levelY: 0 })
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if (e.key === 'Shift') {
        shiftPressed.current = true
        return
      }

      if (e.key !== 'Tab' || buildingState.current !== 1) return

      const currentDistance = getPlanDistance(
        [startingPoint.current.x, startingPoint.current.z],
        [endingPoint.current.x, endingPoint.current.z],
      )
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
      if (e.key === 'Shift') {
        shiftPressed.current = false
      }
    }

    const onCancel = () => {
      if (buildingState.current === 1) {
        buildingState.current = 0
        wallPreviewRef.current.visible = false
        closeDistanceInput()
        setDraft({ start: null, end: null, levelY: 0 })
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
  }, [closeDistanceInput, syncDraftState, unitSystem])

  const currentDistance = useMemo(() => {
    if (!(draft.start && draft.end)) return 0
    return getPlanDistance(draft.start, draft.end)
  }, [draft.end, draft.start])

  const labelPosition = useMemo(() => {
    if (!(draft.start && draft.end)) return null
    const midpoint = getPlanMidpoint(draft.start, draft.end)
    return [midpoint[0], draft.levelY + WALL_HEIGHT + 0.3, midpoint[1]] as [number, number, number]
  }, [draft.end, draft.levelY, draft.start])

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

      {labelPosition && currentDistance >= MIN_DRAW_DISTANCE && (
        <DrawingDimensionLabel
          hint="Enter to apply, Esc to cancel"
          inputLabel="Wall length"
          inputUnitLabel={getLengthInputUnitLabel(unitSystem)}
          inputValue={distanceInput.value}
          isEditing={distanceInput.open}
          onInputBlur={() => {
            if (!distanceInput.open) return
            applyDistanceInput(distanceInput.value, { ignoreNextGridClick: true })
          }}
          onInputChange={(value) => {
            setDistanceInput((current) => ({ ...current, value }))
          }}
          onInputKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              applyDistanceInput(distanceInput.value)
            } else if (event.key === 'Escape') {
              event.preventDefault()
              closeDistanceInput()
            }
          }}
          position={labelPosition}
          value={formatDistance(currentDistance, unitSystem)}
        />
      )}
    </group>
  )
}
