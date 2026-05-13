import {
  type AnyNodeId,
  type BuildingNode,
  ElevatorNode,
  emitter,
  type GridEvent,
  type LevelNode,
  useScene,
} from '@pascal-app/core'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { resolveCurrentBuildingId, resolveElevatorSupportY } from '../../../lib/elevator-support'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { CursorSphere } from '../shared/cursor-sphere'
import {
  DEFAULT_ELEVATOR_CAB_HEIGHT,
  DEFAULT_ELEVATOR_DEPTH,
  DEFAULT_ELEVATOR_DOOR_DURATION_MS,
  DEFAULT_ELEVATOR_DOOR_HEIGHT,
  DEFAULT_ELEVATOR_DOOR_WIDTH,
  DEFAULT_ELEVATOR_DWELL_MS,
  DEFAULT_ELEVATOR_SPEED,
  DEFAULT_ELEVATOR_WIDTH,
} from './elevator-defaults'

const GRID_OFFSET = 0.02

type ElevatorToolProps = {
  buildingId: BuildingNode['id'] | null
  levelId: LevelNode['id'] | null
  onPlaced?: (elevatorId: AnyNodeId, buildingId: BuildingNode['id']) => void
}

function resolveDefaultServiceRange(
  buildingId: BuildingNode['id'],
  selectedLevelId: LevelNode['id'] | null,
): {
  defaultLevelId: LevelNode['id'] | null
  fromLevelId: LevelNode['id'] | null
  toLevelId: LevelNode['id'] | null
} {
  const nodes = useScene.getState().nodes
  const building = nodes[buildingId as AnyNodeId]
  if (building?.type !== 'building') {
    return { defaultLevelId: null, fromLevelId: null, toLevelId: null }
  }

  const levels = building.children
    .map((childId) => nodes[childId as AnyNodeId])
    .filter((node): node is LevelNode => node?.type === 'level')
    .sort((left, right) => left.level - right.level)
  const selectedLevelIndex = levels.findIndex((level) => level.id === selectedLevelId)
  const fromIndex = selectedLevelIndex >= 0 ? selectedLevelIndex : 0
  const fromLevel = levels[fromIndex]
  const toLevel = levels[Math.min(fromIndex + 1, levels.length - 1)] ?? fromLevel

  return {
    defaultLevelId: fromLevel?.id ?? null,
    fromLevelId: fromLevel?.id ?? null,
    toLevelId: toLevel?.id ?? fromLevel?.id ?? null,
  }
}

function createElevatorPreviewGeometry(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(
    DEFAULT_ELEVATOR_WIDTH,
    DEFAULT_ELEVATOR_CAB_HEIGHT,
    DEFAULT_ELEVATOR_DEPTH,
  )
}

function commitElevatorPlacement(
  buildingId: BuildingNode['id'],
  selectedLevelId: LevelNode['id'] | null,
  x: number,
  z: number,
  rotation: number,
  onPlaced: ElevatorToolProps['onPlaced'],
): void {
  const { createNode, nodes } = useScene.getState()
  const elevatorCount = Object.values(nodes).filter((node) => node.type === 'elevator').length
  const serviceRange = resolveDefaultServiceRange(buildingId, selectedLevelId)
  const supportY = resolveElevatorSupportY({
    buildingId,
    preferredLevelId: serviceRange.fromLevelId ?? serviceRange.defaultLevelId,
    x,
    z,
  })
  const elevator = ElevatorNode.parse({
    name: `Elevator ${elevatorCount + 1}`,
    parentId: buildingId,
    position: [x, supportY, z],
    rotation,
    width: DEFAULT_ELEVATOR_WIDTH,
    depth: DEFAULT_ELEVATOR_DEPTH,
    cabHeight: DEFAULT_ELEVATOR_CAB_HEIGHT,
    doorWidth: DEFAULT_ELEVATOR_DOOR_WIDTH,
    doorHeight: DEFAULT_ELEVATOR_DOOR_HEIGHT,
    ...serviceRange,
    speed: DEFAULT_ELEVATOR_SPEED,
    doorDurationMs: DEFAULT_ELEVATOR_DOOR_DURATION_MS,
    dwellMs: DEFAULT_ELEVATOR_DWELL_MS,
  })

  createNode(elevator, buildingId)
  onPlaced?.(elevator.id as AnyNodeId, buildingId)
  sfxEmitter.emit('sfx:structure-build')
}

export const ElevatorTool: React.FC<ElevatorToolProps> = ({ buildingId, levelId, onPlaced }) => {
  const cursorRef = useRef<THREE.Group>(null)
  const previewRef = useRef<THREE.Group>(null)
  const rotationRef = useRef(0)
  const previousGridPosRef = useRef<[number, number] | null>(null)
  const previewGeometry = useMemo(() => createElevatorPreviewGeometry(), [])

  useEffect(() => {
    const currentBuildingId = resolveCurrentBuildingId({
      buildingId,
      levelId,
      nodes: useScene.getState().nodes,
    })
    if (!currentBuildingId) return

    rotationRef.current = 0
    if (previewRef.current) previewRef.current.rotation.y = 0

    const onGridMove = (event: GridEvent) => {
      const gridX = Math.round(event.localPosition[0] * 2) / 2
      const gridZ = Math.round(event.localPosition[2] * 2) / 2
      const supportY = resolveElevatorSupportY({
        buildingId: currentBuildingId,
        preferredLevelId: levelId as LevelNode['id'] | null,
        x: gridX,
        z: gridZ,
      })

      cursorRef.current?.position.set(gridX, supportY + GRID_OFFSET, gridZ)
      previewRef.current?.position.set(gridX, supportY + DEFAULT_ELEVATOR_CAB_HEIGHT / 2, gridZ)

      if (
        previousGridPosRef.current &&
        (gridX !== previousGridPosRef.current[0] || gridZ !== previousGridPosRef.current[1])
      ) {
        sfxEmitter.emit('sfx:grid-snap')
      }

      previousGridPosRef.current = [gridX, gridZ]
    }

    const onGridClick = (event: GridEvent) => {
      const latestBuildingId = resolveCurrentBuildingId({
        buildingId,
        levelId,
        nodes: useScene.getState().nodes,
      })
      if (!latestBuildingId) return

      const gridX = Math.round(event.localPosition[0] * 2) / 2
      const gridZ = Math.round(event.localPosition[2] * 2) / 2
      commitElevatorPlacement(
        latestBuildingId,
        levelId,
        gridX,
        gridZ,
        rotationRef.current,
        onPlaced,
      )
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      const ROTATION_STEP = Math.PI / 4
      let rotationDelta = 0
      if (event.key === 'r' || event.key === 'R') rotationDelta = ROTATION_STEP
      else if (event.key === 't' || event.key === 'T') rotationDelta = -ROTATION_STEP

      if (rotationDelta !== 0) {
        event.preventDefault()
        sfxEmitter.emit('sfx:item-rotate')
        rotationRef.current += rotationDelta
        if (previewRef.current) previewRef.current.rotation.y = rotationRef.current
      }
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [buildingId, levelId, onPlaced])

  return (
    <group>
      <CursorSphere ref={cursorRef} />
      <group ref={previewRef}>
        <mesh castShadow geometry={previewGeometry}>
          <meshStandardMaterial color="#38bdf8" depthWrite={false} opacity={0.32} transparent />
        </mesh>
        <mesh position={[0, DEFAULT_ELEVATOR_CAB_HEIGHT / 2, -DEFAULT_ELEVATOR_DEPTH / 2 - 0.03]}>
          <boxGeometry args={[DEFAULT_ELEVATOR_DOOR_WIDTH, DEFAULT_ELEVATOR_DOOR_HEIGHT, 0.035]} />
          <meshStandardMaterial color="#e5e7eb" depthWrite={false} opacity={0.45} transparent />
        </mesh>
      </group>
    </group>
  )
}
