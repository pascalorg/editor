import { emitter, type GridEvent, type LevelNode, useScene, type WallNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

type DraftWallState = {
  end: WallPlanPoint
  start: WallPlanPoint
  y: number
}

type DraftLengthInputState = {
  error: string | null
  value: string
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

function formatDraftLengthInputValue(value: number, unit: 'metric' | 'imperial') {
  if (unit === 'imperial') {
    return formatMeasurement(value, unit)
  }

  return Number.parseFloat(value.toFixed(2)).toString()
}

function parseDraftLengthInput(input: string, unit: 'metric' | 'imperial') {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) {
    return null
  }

  if (unit === 'metric') {
    const normalized = trimmed.endsWith('m') ? trimmed.slice(0, -1).trim() : trimmed
    const value = Number.parseFloat(normalized)
    return Number.isFinite(value) && value > 0 ? value : null
  }

  const feetInchesMatch = trimmed.match(
    /^(-?\d+(?:\.\d+)?)\s*(?:ft|feet|')\s*(\d+(?:\.\d+)?)?\s*(?:(?:in|inch|inches|")\s*)?$/,
  )
  if (feetInchesMatch) {
    const feet = Number.parseFloat(feetInchesMatch[1] ?? '0')
    const inches = Number.parseFloat(feetInchesMatch[2] ?? '0')
    const meters = feet * 0.3048 + inches * 0.0254
    return Number.isFinite(meters) && meters > 0 ? meters : null
  }

  const inchesOnlyMatch = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*(?:in|inch|inches|")$/)
  if (inchesOnlyMatch) {
    const meters = Number.parseFloat(inchesOnlyMatch[1] ?? '0') * 0.0254
    return Number.isFinite(meters) && meters > 0 ? meters : null
  }

  const plainValue = Number.parseFloat(trimmed)
  if (Number.isFinite(plainValue) && plainValue > 0) {
    return plainValue * 0.3048
  }

  return null
}

function projectDraftPointToLength(
  start: WallPlanPoint,
  end: WallPlanPoint,
  length: number,
): WallPlanPoint | null {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const directionLength = Math.hypot(dx, dz)

  if (!(Number.isFinite(directionLength) && directionLength > 1e-6 && Number.isFinite(length))) {
    return null
  }

  const scale = length / directionLength
  return [start[0] + dx * scale, start[1] + dz * scale]
}

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
  const unit = useViewer((state) => state.unit)
  const cursorRef = useRef<Group>(null)
  const wallPreviewRef = useRef<Mesh>(null!)
  const draftLengthInputRef = useRef<HTMLInputElement>(null)
  const startingPoint = useRef(new Vector3(0, 0, 0))
  const endingPoint = useRef(new Vector3(0, 0, 0))
  const draftWallRef = useRef<DraftWallState | null>(null)
  const buildingState = useRef(0)
  const shiftPressed = useRef(false)
  const [draftWall, setDraftWall] = useState<DraftWallState | null>(null)
  const [draftLengthInput, setDraftLengthInput] = useState<DraftLengthInputState | null>(null)

  const setDraftWallState = useCallback((nextDraft: DraftWallState | null) => {
    draftWallRef.current = nextDraft
    setDraftWall(nextDraft)
  }, [])

  const clearDraftState = useCallback(() => {
    buildingState.current = 0
    setDraftLengthInput(null)
    setDraftWallState(null)
    if (wallPreviewRef.current) {
      wallPreviewRef.current.visible = false
    }
  }, [setDraftWallState])

  const draftLength = useMemo(() => {
    if (!draftWall) {
      return 0
    }

    return Math.hypot(draftWall.end[0] - draftWall.start[0], draftWall.end[1] - draftWall.start[1])
  }, [draftWall])

  const draftLabelPosition = useMemo<[number, number, number] | null>(() => {
    if (!(draftWall && draftLength >= 1e-6)) {
      return null
    }

    return [
      (draftWall.start[0] + draftWall.end[0]) / 2,
      draftWall.y + 0.35,
      (draftWall.start[1] + draftWall.end[1]) / 2,
    ]
  }, [draftLength, draftWall])

  const submitDraftLengthInput = useCallback(() => {
    const currentDraft = draftWallRef.current
    if (!(currentDraft && draftLengthInput)) {
      return
    }

    const parsedLength = parseDraftLengthInput(draftLengthInput.value, unit)
    if (!(parsedLength && parsedLength > 0)) {
      setDraftLengthInput((currentState) =>
        currentState ? { ...currentState, error: 'Enter a valid length.' } : currentState,
      )
      return
    }

    if (parsedLength < WALL_MIN_LENGTH) {
      setDraftLengthInput((currentState) =>
        currentState
          ? {
              ...currentState,
              error: `Walls must be at least ${formatMeasurement(WALL_MIN_LENGTH, unit)}.`,
            }
          : currentState,
      )
      return
    }

    const nextPoint = projectDraftPointToLength(currentDraft.start, currentDraft.end, parsedLength)
    if (!nextPoint) {
      setDraftLengthInput((currentState) =>
        currentState
          ? { ...currentState, error: 'Move the cursor to set a direction first.' }
          : null,
      )
      return
    }

    createWallOnCurrentLevel(currentDraft.start, nextPoint)
    clearDraftState()
  }, [clearDraftState, draftLengthInput, unit])

  useEffect(() => {
    if (!draftLengthInput) {
      return
    }

    const focusInput = window.requestAnimationFrame(() => {
      draftLengthInputRef.current?.focus()
      draftLengthInputRef.current?.select()
    })

    return () => window.cancelAnimationFrame(focusInput)
  }, [draftLengthInput])

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
        setDraftWallState({
          end: [snappedPoint[0], snappedPoint[1]],
          start: [startingPoint.current.x, startingPoint.current.z],
          y: event.position[1],
        })
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
        setDraftWallState({
          end: [snappedStart[0], snappedStart[1]],
          start: [snappedStart[0], snappedStart[1]],
          y: event.position[1],
        })
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
        clearDraftState()
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const isEditableTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        Boolean(target?.isContentEditable)

      if (e.key === 'Shift') {
        shiftPressed.current = true
      }

      if (
        !isEditableTarget &&
        e.key === 'Tab' &&
        buildingState.current === 1 &&
        draftWallRef.current
      ) {
        e.preventDefault()
        const currentDraft = draftWallRef.current
        const currentLength = Math.hypot(
          currentDraft.end[0] - currentDraft.start[0],
          currentDraft.end[1] - currentDraft.start[1],
        )

        setDraftLengthInput({
          error: null,
          value: formatDraftLengthInputValue(currentLength, unit),
        })
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
        clearDraftState()
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
  }, [clearDraftState, setDraftWallState, unit])

  return (
    <group>
      {/* Cursor indicator */}
      <CursorSphere ref={cursorRef} />

      {draftLabelPosition ? (
        <Html
          center
          position={draftLabelPosition}
          style={{ userSelect: 'none' }}
          zIndexRange={[30, 0]}
        >
          {draftLengthInput ? (
            <div
              className="pointer-events-auto min-w-[180px] rounded-xl border border-white/10 bg-zinc-900/95 p-2 shadow-[0_10px_24px_-16px_rgba(0,0,0,0.8)] backdrop-blur-sm"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-center gap-2">
                <input
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 font-mono text-sm text-white outline-none focus:border-white/25"
                  onBlur={() => setDraftLengthInput(null)}
                  onChange={(event) =>
                    setDraftLengthInput((currentState) =>
                      currentState
                        ? {
                            ...currentState,
                            error: null,
                            value: event.target.value,
                          }
                        : currentState,
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      submitDraftLengthInput()
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      setDraftLengthInput(null)
                    }
                  }}
                  placeholder={unit === 'imperial' ? `8'0"` : '2.40'}
                  ref={draftLengthInputRef}
                  value={draftLengthInput.value}
                />
                <button
                  className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-white px-3 font-medium text-[13px] text-zinc-900 transition-opacity hover:opacity-90"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={submitDraftLengthInput}
                  type="button"
                >
                  Place
                </button>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-white/60">
                <span>{unit === 'imperial' ? 'Feet/inches or inches' : 'Meters'}</span>
                <span>Enter to place</span>
              </div>
              {draftLengthInput.error ? (
                <div className="mt-1 text-[11px] text-red-300">{draftLengthInput.error}</div>
              ) : null}
            </div>
          ) : (
            <div className="pointer-events-none flex items-center gap-2 rounded-full border border-white/10 bg-zinc-900/95 px-3 py-1.5 text-white shadow-[0_10px_24px_-16px_rgba(0,0,0,0.8)] backdrop-blur-sm">
              <span className="font-mono text-[12px] leading-none tabular-nums">
                {formatMeasurement(draftLength, unit)}
              </span>
              <span className="rounded bg-white/10 px-1.5 py-0.5 font-medium text-[10px] leading-none text-white/75">
                Tab
              </span>
            </div>
          )}
        </Html>
      ) : null}

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
