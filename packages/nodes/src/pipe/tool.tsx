'use client'

import {
  emitter,
  type GridEvent,
  type LevelNode,
  type PipeNode,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import {
  createPipeOnCurrentLevel,
  CursorSphere,
  EDITOR_LAYER,
  markToolCancelConsumed,
  type PipePlanPoint,
  snapPipeDraftPoint,
  triggerSFX,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useEffect, useRef, useState } from 'react'
import {
  CatmullRomCurve3,
  DoubleSide,
  Group,
  Mesh,
  TubeGeometry,
  Vector3,
} from 'three'

const DEFAULT_ELEVATION = 3
const DEFAULT_DIAMETER = 0.15
const DRAFT_LABEL_Y = DEFAULT_ELEVATION + 0.35

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

function updatePipePreview(mesh: Mesh, start: Vector3, end: Vector3) {
  const direction = new Vector3(end.x - start.x, 0, end.z - start.z)
  const length = direction.length()
  if (length < 0.01) {
    mesh.visible = false
    return
  }

  mesh.visible = true
  const y = start.y + DEFAULT_ELEVATION
  const points = [new Vector3(start.x, y, start.z), new Vector3(end.x, y, end.z)]
  const curve = new CatmullRomCurve3(points)
  const geometry = new TubeGeometry(curve, 8, DEFAULT_DIAMETER / 2, 10, false)

  mesh.position.set(0, 0, 0)
  mesh.rotation.set(0, 0, 0)

  if (mesh.geometry) mesh.geometry.dispose()
  mesh.geometry = geometry
}

function getCurrentLevelElements(): { walls: WallNode[]; pipes: PipeNode[] } {
  const currentLevelId = useViewer.getState().selection.levelId
  const { nodes } = useScene.getState()
  if (!currentLevelId) return { walls: [], pipes: [] }
  const levelNode = nodes[currentLevelId]
  if (!levelNode || levelNode.type !== 'level') return { walls: [], pipes: [] }
  const children = (levelNode as LevelNode).children.map((childId) => nodes[childId])
  return {
    walls: children.filter((n): n is WallNode => n?.type === 'wall'),
    pipes: children.filter((n): n is PipeNode => n?.type === 'pipe'),
  }
}

export const PipeTool: React.FC = () => {
  const unit = useViewer((state) => state.unit)
  const theme = useViewer((state) => state.theme)
  const cursorRef = useRef<Group>(null)
  const previewRef = useRef<Mesh>(null!)
  const startingPoint = useRef(new Vector3(0, 0, 0))
  const endingPoint = useRef(new Vector3(0, 0, 0))
  const buildingState = useRef(0)
  const shiftPressed = useRef(false)
  const [lengthLabel, setLengthLabel] = useState<{
    label: string
    position: [number, number, number]
  } | null>(null)
  const measurementColor = theme === 'dark' ? '#ffffff' : '#111111'
  const measurementShadowColor = theme === 'dark' ? '#111111' : '#ffffff'

  useEffect(() => {
    let previousEnd: PipePlanPoint | null = null

    const stopDrafting = () => {
      buildingState.current = 0
      previewRef.current.visible = false
      setLengthLabel(null)
    }

    const onGridMove = (event: GridEvent) => {
      if (!(cursorRef.current && previewRef.current)) return
      const { walls, pipes } = getCurrentLevelElements()
      const localPoint: PipePlanPoint = [event.localPosition[0], event.localPosition[2]]

      if (buildingState.current === 1) {
        const snappedLocal = snapPipeDraftPoint({
          point: localPoint,
          walls,
          pipes,
          start: [startingPoint.current.x, startingPoint.current.z],
          angleSnap: !shiftPressed.current,
        })
        endingPoint.current.set(snappedLocal[0], event.localPosition[1], snappedLocal[1])
        cursorRef.current.position.set(snappedLocal[0], event.localPosition[1], snappedLocal[1])
        const currentEnd: PipePlanPoint = [snappedLocal[0], snappedLocal[1]]
        if (
          previousEnd &&
          (currentEnd[0] !== previousEnd[0] || currentEnd[1] !== previousEnd[1])
        ) {
          triggerSFX('sfx:grid-snap')
        }
        previousEnd = currentEnd
        updatePipePreview(previewRef.current, startingPoint.current, endingPoint.current)
        const length = Math.hypot(
          snappedLocal[0] - startingPoint.current.x,
          snappedLocal[1] - startingPoint.current.z,
        )
        setLengthLabel(
          length >= 0.01
            ? {
                label: formatMeasurement(length, unit),
                position: [
                  (startingPoint.current.x + snappedLocal[0]) / 2,
                  startingPoint.current.y + DRAFT_LABEL_Y,
                  (startingPoint.current.z + snappedLocal[1]) / 2,
                ],
              }
            : null,
        )
      } else {
        const snappedPoint = snapPipeDraftPoint({ point: localPoint, walls, pipes })
        cursorRef.current.position.set(snappedPoint[0], event.localPosition[1], snappedPoint[1])
        setLengthLabel(null)
      }
    }

    const onGridClick = (event: GridEvent) => {
      if (buildingState.current === 1 && event.nativeEvent.detail >= 2) {
        stopDrafting()
        return
      }

      const { walls, pipes } = getCurrentLevelElements()
      const localClick: PipePlanPoint = [event.localPosition[0], event.localPosition[2]]

      if (buildingState.current === 0) {
        const snappedStart = snapPipeDraftPoint({ point: localClick, walls, pipes })
        startingPoint.current.set(snappedStart[0], event.localPosition[1], snappedStart[1])
        endingPoint.current.copy(startingPoint.current)
        buildingState.current = 1
        previewRef.current.visible = true
        cursorRef.current?.position.set(snappedStart[0], event.localPosition[1], snappedStart[1])
        setLengthLabel(null)
      } else {
        const snappedEnd = snapPipeDraftPoint({
          point: localClick,
          walls,
          pipes,
          start: [startingPoint.current.x, startingPoint.current.z],
          angleSnap: !shiftPressed.current,
        })
        const dx = snappedEnd[0] - startingPoint.current.x
        const dz = snappedEnd[1] - startingPoint.current.z
        if (dx * dx + dz * dz < 0.01 * 0.01) return
        const createdPipe = createPipeOnCurrentLevel(
          [startingPoint.current.x, startingPoint.current.z],
          snappedEnd,
        )
        if (!createdPipe) return

        const nextStart = createdPipe.end
        startingPoint.current.set(nextStart[0], event.localPosition[1], nextStart[1])
        endingPoint.current.copy(startingPoint.current)
        cursorRef.current?.position.set(nextStart[0], event.localPosition[1], nextStart[1])
        previewRef.current.visible = false
        buildingState.current = 1
        setLengthLabel(null)
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftPressed.current = true
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftPressed.current = false
    }

    const onCancel = () => {
      if (buildingState.current === 1) {
        markToolCancelConsumed()
        stopDrafting()
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
  }, [unit])

  return (
    <group>
      <CursorSphere height={DEFAULT_ELEVATION} ref={cursorRef} />
      <mesh layers={EDITOR_LAYER} ref={previewRef} renderOrder={1} visible={false}>
        <meshBasicMaterial
          color="#7dd3fc"
          depthTest={false}
          depthWrite={false}
          opacity={0.55}
          side={DoubleSide}
          transparent
        />
      </mesh>
      {lengthLabel && (
        <Html
          center
          position={lengthLabel.position}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
          zIndexRange={[100, 0]}
        >
          <div
            className="whitespace-nowrap font-bold font-mono text-[15px]"
            style={{
              color: measurementColor,
              textShadow: `-1.5px -1.5px 0 ${measurementShadowColor}, 1.5px -1.5px 0 ${measurementShadowColor}, -1.5px 1.5px 0 ${measurementShadowColor}, 1.5px 1.5px 0 ${measurementShadowColor}, 0 0 4px ${measurementShadowColor}, 0 0 4px ${measurementShadowColor}`,
            }}
          >
            {lengthLabel.label}
          </div>
        </Html>
      )}
    </group>
  )
}

export default PipeTool
