import {
  type AnyNodeId,
  type BuildingNode,
  collectAlignmentAnchors,
  ElevatorNode,
  emitter,
  type GridEvent,
  type LevelNode,
  resolveAlignment,
  useScene,
} from '@pascal-app/core'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { resolveCurrentBuildingId, resolveElevatorSupportY } from '../../../lib/elevator-support'
import { sfxEmitter } from '../../../lib/sfx-bus'

import useAlignmentGuides from '../../../store/use-alignment-guides'
import useEditor, {
  isAlignmentGuideActive,
  isGridSnapActive,
  isMagneticSnapActive,
} from '../../../store/use-editor'

import usePlacementPreview from '../../../store/use-placement-preview'
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
/** Figma-style alignment-snap threshold (meters), matching the move tools. */
const ALIGNMENT_THRESHOLD_M = 0.08

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

function createElevatorPreviewEdgeGeometry(): THREE.BufferGeometry {
  return new THREE.EdgesGeometry(createElevatorPreviewGeometry())
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
  const previewEdgeGeometry = useMemo(() => createElevatorPreviewEdgeGeometry(), [])

  // Default-shaped elevator for the 2D floor-plan placement ghost. The 3D
  // preview meshes below are hidden in 2D (canvas `display:none`), so this
  // feeds `usePlacementPreview` → `FloorplanPlacementPreviewLayer`, which
  // renders the elevator's footprint following the cursor.
  const floorplanPreviewNode = useMemo(
    () =>
      ElevatorNode.parse({
        name: 'Elevator',
        position: [0, 0, 0],
        rotation: 0,
        width: DEFAULT_ELEVATOR_WIDTH,
        depth: DEFAULT_ELEVATOR_DEPTH,
        cabHeight: DEFAULT_ELEVATOR_CAB_HEIGHT,
        doorWidth: DEFAULT_ELEVATOR_DOOR_WIDTH,
        doorHeight: DEFAULT_ELEVATOR_DOOR_HEIGHT,
      }),
    [],
  )

  useEffect(() => {
    const currentBuildingId = resolveCurrentBuildingId({
      buildingId,
      levelId,
      nodes: useScene.getState().nodes,
    })
    if (!currentBuildingId) return

    rotationRef.current = 0
    if (previewRef.current) previewRef.current.rotation.y = 0

    // Alignment candidates — anchors of every alignable object; refreshed
    // after each placement. The elevator aligns by its ORIGIN point.
    let alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, '', levelId)
    // Snap the elevator origin onto another object's nearest real anchor and
    // publish the guide. The probe is the RAW cursor, NOT the 0.5m-grid-snapped
    // point: resolving against the grid point would only ever catch anchors
    // that happen to sit on a grid line, so off-grid items (furniture, angled
    // walls) would never surface a guide. The matched axis locks exactly to the
    // candidate's coordinate; the other axis keeps its grid snap. Guides are
    // published in every snapping mode (including Off); the magnetic pull toward
    // them (applySnap) applies only in 'lines' mode.
    const alignPoint = (
      gridX: number,
      gridZ: number,
      rawX: number,
      rawZ: number,
      bypass: boolean,
      applySnap: boolean,
    ): [number, number] => {
      if (bypass || alignmentCandidates.length === 0) {
        useAlignmentGuides.getState().clear()
        return [gridX, gridZ]
      }
      const ar = resolveAlignment({
        moving: [{ nodeId: '__elevator-draft__', kind: 'corner', x: rawX, z: rawZ }],
        candidates: alignmentCandidates,
        threshold: ALIGNMENT_THRESHOLD_M,
      })
      if (ar.guides.length === 0) {
        useAlignmentGuides.getState().clear()
        return [gridX, gridZ]
      }
      useAlignmentGuides.getState().set(ar.guides)
      if (!applySnap) return [gridX, gridZ]
      let x = gridX
      let z = gridZ
      for (const guide of ar.guides) {
        if (guide.axis === 'x') x = guide.coord
        else z = guide.coord
      }
      return [x, z]
    }

    const onGridMove = (event: GridEvent) => {
      // Grid snap follows the global mode (live step so the HUD chip is
      // honest); Off keeps the raw cursor. Shift cycles the mode centrally.
      const step = useEditor.getState().gridSnapStep
      const [gridX, gridZ] = alignPoint(
        isGridSnapActive()
          ? Math.round(event.localPosition[0] / step) * step
          : event.localPosition[0],
        isGridSnapActive()
          ? Math.round(event.localPosition[2] / step) * step
          : event.localPosition[2],
        event.localPosition[0],
        event.localPosition[2],
        !isAlignmentGuideActive(),
        isMagneticSnapActive(),
      )
      const supportY = resolveElevatorSupportY({
        buildingId: currentBuildingId,
        preferredLevelId: levelId as LevelNode['id'] | null,
        x: gridX,
        z: gridZ,
      })

      cursorRef.current?.position.set(gridX, supportY + GRID_OFFSET, gridZ)
      previewRef.current?.position.set(gridX, supportY + DEFAULT_ELEVATOR_CAB_HEIGHT / 2, gridZ)

      // Publish the 2D floor-plan ghost at the snapped/aligned cursor.
      usePlacementPreview.getState().set({
        ...floorplanPreviewNode,
        position: [gridX, supportY, gridZ],
        rotation: rotationRef.current,
      })

      if (
        (isGridSnapActive() || isMagneticSnapActive()) &&
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

      const step = useEditor.getState().gridSnapStep
      const [gridX, gridZ] = alignPoint(
        isGridSnapActive()
          ? Math.round(event.localPosition[0] / step) * step
          : event.localPosition[0],
        isGridSnapActive()
          ? Math.round(event.localPosition[2] / step) * step
          : event.localPosition[2],
        event.localPosition[0],
        event.localPosition[2],
        !isAlignmentGuideActive(),
        isMagneticSnapActive(),
      )
      commitElevatorPlacement(
        latestBuildingId,
        levelId,
        gridX,
        gridZ,
        rotationRef.current,
        onPlaced,
      )
      alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, '', levelId)
      useAlignmentGuides.getState().clear()
      // The placed elevator's footprint now renders for real; drop the ghost
      // (the next grid:move re-publishes it for the following placement).
      usePlacementPreview.getState().clear()
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
        // Reflect the rotation in the 2D ghost immediately (no pointer move
        // needed) by republishing at the last snapped cursor position.
        const last = previousGridPosRef.current
        if (last) {
          usePlacementPreview.getState().set({
            ...floorplanPreviewNode,
            position: [last[0], 0, last[1]],
            rotation: rotationRef.current,
          })
        }
      }
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      window.removeEventListener('keydown', onKeyDown)
      useAlignmentGuides.getState().clear()
      usePlacementPreview.getState().clear()
    }
  }, [buildingId, levelId, onPlaced, floorplanPreviewNode])

  return (
    <group>
      <CursorSphere ref={cursorRef} />
      <group ref={previewRef}>
        <mesh geometry={previewGeometry}>
          <meshStandardMaterial color="#38bdf8" depthWrite={false} opacity={0.12} transparent />
        </mesh>
        <lineSegments geometry={previewEdgeGeometry}>
          <lineBasicMaterial color="#38bdf8" opacity={0.9} transparent />
        </lineSegments>
        <mesh
          position={[0, -DEFAULT_ELEVATOR_CAB_HEIGHT / 2 + 0.015, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[DEFAULT_ELEVATOR_WIDTH, DEFAULT_ELEVATOR_DEPTH]} />
          <meshBasicMaterial color="#38bdf8" opacity={0.16} transparent />
        </mesh>
        <mesh position={[0, 0, -DEFAULT_ELEVATOR_DEPTH / 2 - 0.01]}>
          <planeGeometry args={[DEFAULT_ELEVATOR_WIDTH, DEFAULT_ELEVATOR_CAB_HEIGHT]} />
          <meshBasicMaterial color="#e0f2fe" opacity={0.18} transparent />
        </mesh>
        <mesh
          position={[
            0,
            -DEFAULT_ELEVATOR_CAB_HEIGHT / 2 + DEFAULT_ELEVATOR_DOOR_HEIGHT / 2,
            -DEFAULT_ELEVATOR_DEPTH / 2 - 0.03,
          ]}
        >
          <boxGeometry args={[DEFAULT_ELEVATOR_DOOR_WIDTH, DEFAULT_ELEVATOR_DOOR_HEIGHT, 0.035]} />
          <meshStandardMaterial color="#e5e7eb" depthWrite={false} opacity={0.45} transparent />
        </mesh>
        <mesh
          position={[
            0,
            -DEFAULT_ELEVATOR_CAB_HEIGHT / 2 + DEFAULT_ELEVATOR_DOOR_HEIGHT / 2,
            -DEFAULT_ELEVATOR_DEPTH / 2 - 0.049,
          ]}
        >
          <boxGeometry
            args={[DEFAULT_ELEVATOR_DOOR_WIDTH + 0.14, DEFAULT_ELEVATOR_DOOR_HEIGHT + 0.14, 0.01]}
          />
          <meshBasicMaterial color="#38bdf8" opacity={0.5} transparent />
        </mesh>
      </group>
    </group>
  )
}
