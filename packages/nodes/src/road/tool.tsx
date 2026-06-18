'use client'

import {
  emitter,
  type GridEvent,
  type LevelNode,
  RoadNode,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import {
  CursorSphere,
  EDITOR_LAYER,
  markToolCancelConsumed,
  snapWallDraftPoint,
  triggerSFX,
  type WallPlanPoint,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useEffect, useRef, useState } from 'react'
import { BoxGeometry, DoubleSide, type Group, type Mesh, Vector3 } from 'three'

const DEFAULT_ROAD_WIDTH = 3.5
const DEFAULT_ROAD_THICKNESS = 0.04
const DEFAULT_ROAD_ELEVATION = 0.01
const DRAFT_LABEL_Y = 0.35

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

function updateRoadPreview(mesh: Mesh, start: Vector3, end: Vector3) {
  const direction = new Vector3(end.x - start.x, 0, end.z - start.z)
  const length = direction.length()
  if (length < 0.01) {
    mesh.visible = false
    return
  }

  const geometry = new BoxGeometry(length, DEFAULT_ROAD_THICKNESS, DEFAULT_ROAD_WIDTH)
  const angle = Math.atan2(direction.z, direction.x)

  mesh.visible = true
  mesh.position.set(
    (start.x + end.x) / 2,
    start.y + DEFAULT_ROAD_ELEVATION + DEFAULT_ROAD_THICKNESS / 2,
    (start.z + end.z) / 2,
  )
  mesh.rotation.y = -angle

  if (mesh.geometry) mesh.geometry.dispose()
  mesh.geometry = geometry
}

function getCurrentLevelWalls(): WallNode[] {
  const currentLevelId = useViewer.getState().selection.levelId
  const { nodes } = useScene.getState()
  if (!currentLevelId) return []
  const levelNode = nodes[currentLevelId]
  if (!levelNode || levelNode.type !== 'level') return []
  return (levelNode as LevelNode).children
    .map((childId) => nodes[childId])
    .filter((node): node is WallNode => node?.type === 'wall')
}

function createRoadOnCurrentLevel(start: WallPlanPoint, end: WallPlanPoint) {
  const currentLevelId = useViewer.getState().selection.levelId
  const { createNode, nodes } = useScene.getState()
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  if (!(currentLevelId && dx * dx + dz * dz >= 0.01 * 0.01)) return null

  const roadCount = Object.values(nodes).filter((node) => node.type === 'road').length
  const road = RoadNode.parse({
    name: `\u5730\u9762\u5e26 ${roadCount + 1}`,
    start,
    end,
  })

  createNode(road, currentLevelId)
  triggerSFX('sfx:structure-build')

  return road
}

export const RoadTool: React.FC = () => {
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
    let previousEnd: WallPlanPoint | null = null

    const stopDrafting = () => {
      buildingState.current = 0
      previewRef.current.visible = false
      setLengthLabel(null)
    }

    const onGridMove = (event: GridEvent) => {
      if (!(cursorRef.current && previewRef.current)) return
      const walls = getCurrentLevelWalls()
      const localPoint: WallPlanPoint = [event.localPosition[0], event.localPosition[2]]

      if (buildingState.current === 1) {
        const snappedLocal = snapWallDraftPoint({
          point: localPoint,
          walls,
          start: [startingPoint.current.x, startingPoint.current.z],
          angleSnap: !shiftPressed.current,
        })
        endingPoint.current.set(snappedLocal[0], event.localPosition[1], snappedLocal[1])
        cursorRef.current.position.set(snappedLocal[0], event.localPosition[1], snappedLocal[1])
        if (
          previousEnd &&
          (previousEnd[0] !== snappedLocal[0] || previousEnd[1] !== snappedLocal[1])
        ) {
          triggerSFX('sfx:grid-snap')
        }
        previousEnd = snappedLocal

        updateRoadPreview(previewRef.current, startingPoint.current, endingPoint.current)
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
        const snappedPoint = snapWallDraftPoint({ point: localPoint, walls })
        cursorRef.current.position.set(snappedPoint[0], event.localPosition[1], snappedPoint[1])
        setLengthLabel(null)
      }
    }

    const onGridClick = (event: GridEvent) => {
      if (buildingState.current === 1 && event.nativeEvent.detail >= 2) {
        stopDrafting()
        return
      }

      const walls = getCurrentLevelWalls()
      const localClick: WallPlanPoint = [event.localPosition[0], event.localPosition[2]]

      if (buildingState.current === 0) {
        const snappedStart = snapWallDraftPoint({ point: localClick, walls })
        startingPoint.current.set(snappedStart[0], event.localPosition[1], snappedStart[1])
        endingPoint.current.copy(startingPoint.current)
        buildingState.current = 1
        previewRef.current.visible = true
        cursorRef.current?.position.set(snappedStart[0], event.localPosition[1], snappedStart[1])
        setLengthLabel(null)
      } else {
        const snappedEnd = snapWallDraftPoint({
          point: localClick,
          walls,
          start: [startingPoint.current.x, startingPoint.current.z],
          angleSnap: !shiftPressed.current,
        })
        const createdRoad = createRoadOnCurrentLevel(
          [startingPoint.current.x, startingPoint.current.z],
          snappedEnd,
        )
        if (!createdRoad) return

        useViewer.getState().setSelection({ selectedIds: [createdRoad.id] })
        const nextStart = createdRoad.end
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
      previewRef.current?.geometry?.dispose()
    }
  }, [unit])

  return (
    <group>
      <CursorSphere height={0} ref={cursorRef} />
      <mesh layers={EDITOR_LAYER} ref={previewRef} renderOrder={1} visible={false}>
        <meshBasicMaterial
          color="#475569"
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

export default RoadTool
