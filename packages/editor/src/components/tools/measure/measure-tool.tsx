import { emitter, type GridEvent, useScene, type WallNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BufferGeometry, type Group, type Line, Vector3 } from 'three'
import { EDITOR_LAYER } from '../../../lib/constants'
import { formatLengthInputValue, getLengthInputUnitLabel } from '../../../lib/measurements'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'
import { DrawingDimensionLabel } from '../shared/drawing-dimension-label'
import {
  formatDistance,
  getPlanDistance,
  getPlanMidpoint,
  getSegmentSnapPoint,
  MIN_DRAW_DISTANCE,
  type PlanPoint,
  parseDistanceInput,
  projectPointAtDistance,
  snapSegmentTo45Degrees,
  snapToGrid,
} from '../shared/drawing-utils'

type MeasureState = {
  start: PlanPoint | null
  end: PlanPoint | null
  isLocked: boolean
  levelY: number
}

const syncLineGeometry = (
  line: Line,
  start: PlanPoint | null,
  end: PlanPoint | null,
  y: number,
) => {
  if (!(start && end)) {
    line.visible = false
    return
  }

  if (getPlanDistance(start, end) < MIN_DRAW_DISTANCE) {
    line.visible = false
    return
  }

  const points = [new Vector3(start[0], y + 0.02, start[1]), new Vector3(end[0], y + 0.02, end[1])]

  line.geometry.dispose()
  line.geometry = new BufferGeometry().setFromPoints(points)
  line.visible = true
}

export const MeasureTool: React.FC = () => {
  const addMeasurementGuide = useEditor((state) => state.addMeasurementGuide)
  const currentLevelId = useViewer((state) => state.selection.levelId)
  const measurementGuides = useEditor((state) => state.measurementGuides)
  const showGuides = useViewer((state) => state.showGuides)
  const unitSystem = useViewer((state) => state.unitSystem)
  const cursorRef = useRef<Group>(null)
  const lineRef = useRef<Line>(null!)
  const startRef = useRef<PlanPoint | null>(null)
  const endRef = useRef<PlanPoint | null>(null)
  const isLockedRef = useRef(false)
  const shiftPressed = useRef(false)
  const previousEndRef = useRef<PlanPoint | null>(null)
  const inputOpenRef = useRef(false)
  const levelYRef = useRef(0)
  const ignoreNextGridClickRef = useRef(false)

  const [measurement, setMeasurement] = useState<MeasureState>({
    start: null,
    end: null,
    isLocked: false,
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

  const syncMeasurementState = useCallback((levelY: number) => {
    levelYRef.current = levelY
    setMeasurement({
      start: startRef.current,
      end: endRef.current,
      isLocked: isLockedRef.current,
      levelY,
    })
  }, [])

  const lockMeasurement = useCallback(
    (levelY: number) => {
      if (!(startRef.current && endRef.current)) return
      if (getPlanDistance(startRef.current, endRef.current) < MIN_DRAW_DISTANCE) return

      if (currentLevelId) {
        addMeasurementGuide({
          end: endRef.current,
          levelId: currentLevelId,
          levelY,
          start: startRef.current,
        })
      }

      const finalEnd = endRef.current
      cursorRef.current?.position.set(finalEnd[0], levelY, finalEnd[1])
      startRef.current = null
      endRef.current = null
      isLockedRef.current = false
      previousEndRef.current = null
      ignoreNextGridClickRef.current = false
      if (lineRef.current.geometry) {
        lineRef.current.visible = false
      }
      setMeasurement({ start: null, end: null, isLocked: false, levelY })
    },
    [addMeasurementGuide, currentLevelId],
  )

  const applyDistanceInput = (
    rawValue: string,
    options?: { commitAfterApply?: boolean; ignoreNextGridClick?: boolean },
  ) => {
    if (!(startRef.current && endRef.current)) {
      closeDistanceInput(options)
      return
    }

    const parsedDistance = parseDistanceInput(rawValue, unitSystem)
    if (!(parsedDistance && parsedDistance >= MIN_DRAW_DISTANCE)) {
      closeDistanceInput(options)
      return
    }

    const nextEnd = projectPointAtDistance(startRef.current, endRef.current, parsedDistance)
    endRef.current = nextEnd
    previousEndRef.current = nextEnd
    cursorRef.current?.position.set(nextEnd[0], levelYRef.current, nextEnd[1])
    syncLineGeometry(lineRef.current, startRef.current, nextEnd, levelYRef.current)
    syncMeasurementState(levelYRef.current)

    if (options?.commitAfterApply) {
      closeDistanceInput()
      lockMeasurement(levelYRef.current)
      return
    }

    closeDistanceInput(options)
  }

  useEffect(() => {
    lineRef.current.geometry = new BufferGeometry()
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

      const levelY = event.position[1]
      const rawGridPosition: PlanPoint = [
        snapToGrid(event.position[0]),
        snapToGrid(event.position[2]),
      ]
      const gridPosition =
        shiftPressed.current || !currentLevelId
          ? rawGridPosition
          : (getSegmentSnapPoint(rawGridPosition, getSnapSegments()) ?? rawGridPosition)

      if (!(startRef.current && !isLockedRef.current)) {
        cursorRef.current.position.set(gridPosition[0], levelY, gridPosition[1])
        return
      }

      if (inputOpenRef.current) return

      const angleSnapped = shiftPressed.current
        ? gridPosition
        : snapSegmentTo45Degrees(startRef.current, gridPosition)
      const nextEnd =
        shiftPressed.current || !currentLevelId
          ? angleSnapped
          : (getSegmentSnapPoint(angleSnapped, getSnapSegments()) ?? angleSnapped)

      if (
        previousEndRef.current &&
        (nextEnd[0] !== previousEndRef.current[0] || nextEnd[1] !== previousEndRef.current[1])
      ) {
        sfxEmitter.emit('sfx:grid-snap')
      }

      previousEndRef.current = nextEnd
      endRef.current = nextEnd
      cursorRef.current.position.set(nextEnd[0], levelY, nextEnd[1])
      syncLineGeometry(lineRef.current, startRef.current, nextEnd, levelY)
      syncMeasurementState(levelY)
    }

    const onGridClick = (event: GridEvent) => {
      if (ignoreNextGridClickRef.current) {
        ignoreNextGridClickRef.current = false
        return
      }
      if (inputOpenRef.current) return

      const levelY = event.position[1]
      const rawGridPosition: PlanPoint = [
        snapToGrid(event.position[0]),
        snapToGrid(event.position[2]),
      ]
      const gridPosition =
        shiftPressed.current || !currentLevelId
          ? rawGridPosition
          : (getSegmentSnapPoint(rawGridPosition, getSnapSegments()) ?? rawGridPosition)

      if (!startRef.current || isLockedRef.current) {
        startRef.current = gridPosition
        endRef.current = gridPosition
        isLockedRef.current = false
        previousEndRef.current = gridPosition
        cursorRef.current?.position.set(gridPosition[0], levelY, gridPosition[1])
        syncLineGeometry(lineRef.current, null, null, levelY)
        syncMeasurementState(levelY)
        return
      }

      const finalEnd = endRef.current ?? gridPosition
      endRef.current = finalEnd
      lockMeasurement(levelY)
    }

    const onCancel = () => {
      startRef.current = null
      endRef.current = null
      isLockedRef.current = false
      previousEndRef.current = null
      ignoreNextGridClickRef.current = false
      closeDistanceInput()
      if (lineRef.current.geometry) {
        lineRef.current.visible = false
      }
      setMeasurement({ start: null, end: null, isLocked: false, levelY: 0 })
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      if (event.key === 'Shift') {
        shiftPressed.current = true
        return
      }

      if (event.key !== 'Tab') return
      if (!(startRef.current && endRef.current && !isLockedRef.current)) return

      const currentDistance = getPlanDistance(startRef.current, endRef.current)
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
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      closeDistanceInput()
    }
  }, [
    closeDistanceInput,
    currentLevelId,
    lockMeasurement,
    measurementGuides,
    showGuides,
    syncMeasurementState,
    unitSystem,
  ])

  const currentDistance = useMemo(() => {
    if (!(measurement.start && measurement.end)) return 0
    return getPlanDistance(measurement.start, measurement.end)
  }, [measurement.end, measurement.start])

  const labelPosition = useMemo(() => {
    if (!(measurement.start && measurement.end)) return null
    const midpoint = getPlanMidpoint(measurement.start, measurement.end)
    return [midpoint[0], measurement.levelY + 0.18, midpoint[1]] as [number, number, number]
  }, [measurement.end, measurement.levelY, measurement.start])

  return (
    <group>
      <CursorSphere ref={cursorRef} />

      {/* @ts-ignore R3F line type mismatches DOM line typing */}
      <line
        frustumCulled={false}
        layers={EDITOR_LAYER}
        ref={lineRef}
        renderOrder={1}
        visible={false}
      >
        <bufferGeometry />
        <lineBasicNodeMaterial
          color="#fbbf24"
          depthTest={false}
          depthWrite={false}
          linewidth={2}
          opacity={0.95}
          transparent
        />
      </line>

      {measurement.start && (
        <CursorSphere
          color="#fbbf24"
          height={0}
          position={[measurement.start[0], measurement.levelY + 0.02, measurement.start[1]]}
          showTooltip={false}
        />
      )}

      {measurement.isLocked && measurement.end && (
        <CursorSphere
          color="#fbbf24"
          height={0}
          position={[measurement.end[0], measurement.levelY + 0.02, measurement.end[1]]}
          showTooltip={false}
        />
      )}

      {labelPosition && currentDistance >= MIN_DRAW_DISTANCE && (
        <DrawingDimensionLabel
          hint="Enter to lock, Esc to cancel"
          inputLabel="Measure"
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
          position={labelPosition}
          value={formatDistance(currentDistance, unitSystem)}
        />
      )}
    </group>
  )
}
