'use client'

import { type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  type Group,
  type Object3D,
} from 'three'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import { useShallow } from 'zustand/react/shallow'
import { useHighlightedRoom } from '../../hooks/use-selected-room'
import { EDITOR_LAYER } from '../../lib/constants'
import { resolveOverlayPolicy } from '../../lib/interaction/overlay-policy'
import {
  getRoomAssembly,
  type RoomAssemblyHeights,
  resolveRoomAssemblyHeights,
} from '../../lib/room-assembly-overlay'
import { describeZoneOutline, type RoomSelectionRecord } from '../../lib/room-selection'
import useEditor from '../../store/use-editor'
import useInteractionScope from '../../store/use-interaction-scope'
import { RoomControls2D, RoomControls3D } from './room-controls'

/**
 * A zone reached as a zone (hovered or selected through its area or pill, not
 * as a room) shows the room's outline, never a tinted volume.
 */
function useZoneOutline() {
  const hoveredId = useViewer((state) => state.hoveredId)
  const selectedId = useViewer(
    (state) =>
      state.selection.zoneId ??
      (state.selection.selectedIds.length === 1 ? state.selection.selectedIds[0] : null),
  )
  const unitFocused = useViewer((state) => !!state.focusedUnitId)
  const zone = useScene((state) => {
    for (const id of [hoveredId, selectedId]) {
      const node = id ? state.nodes[id as AnyNodeId] : undefined
      if (node?.type === 'zone') return node
    }
    return null
  })
  return useMemo(
    () => (zone?.parentId && !unitFocused ? describeZoneOutline(zone.parentId, zone) : null),
    [zone, unitFocused],
  )
}

function useRoomHighlight() {
  const room = useHighlightedRoom()
  const zoneOutline = useZoneOutline()
  const visible = useInteractionScope(
    (state) => resolveOverlayPolicy(state.scope).conflictingControls === 'shown',
  )
  // No phase gate: site never hovers or keeps a room (`roomPickingEnabled`).
  const enabled = useEditor((state) => state.mode === 'select')
  return enabled && visible ? (room ?? zoneOutline) : null
}

const noRaycast = () => {}
const outlineMaterial = new LineBasicNodeMaterial({
  color: '#818cf8',
  depthTest: false,
  depthWrite: false,
})
const fillMaterial = (opacity: number) =>
  new MeshBasicNodeMaterial({
    color: '#818cf8',
    depthTest: false,
    depthWrite: false,
    opacity,
    side: DoubleSide,
    transparent: true,
  })
const floorMaterial = fillMaterial(0.18)
// Walls and the ceiling stack over the floor when seen from above.
const surfaceMaterial = fillMaterial(0.1)

function positions(array: Float32Array) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(array, 3))
  return geometry
}

function RoomMesh({ room }: { room: RoomSelectionRecord }) {
  const { levelId } = room.key
  // Zone, plate and ceiling edits already produce a new record; wall and
  // storey heights live on these nodes.
  const heightSources = useScene(
    useShallow((state) => [
      state.nodes[levelId as keyof typeof state.nodes],
      ...room.boundaryWallIds.map((id) => state.nodes[id as keyof typeof state.nodes]),
    ]),
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: `heightSources` re-resolves heights from the current node map.
  const heights = useMemo(
    () => resolveRoomAssemblyHeights(room, useScene.getState().nodes),
    [room, heightSources],
  )
  return (
    <RoomAssemblyMesh
      heights={heights}
      levelObject={() => sceneRegistry.nodes.get(levelId)}
      room={room}
    />
  )
}

/** A room's floor, wall faces and outline in the highlight colour, riding its level's object. */
export function RoomAssemblyMesh({
  room,
  heights,
  levelObject,
}: {
  room: RoomSelectionRecord
  heights: RoomAssemblyHeights
  levelObject: () => Object3D | undefined
}) {
  const ref = useRef<Group>(null)
  const assembly = useMemo(() => getRoomAssembly(room.geometry, heights), [room, heights])
  const geometry = useMemo(
    () => ({
      floor: positions(assembly.floor),
      surfaces: positions(assembly.surfaces),
      outline: positions(assembly.outline),
    }),
    [assembly],
  )
  useEffect(
    () => () => {
      geometry.floor.dispose()
      geometry.surfaces.dispose()
      geometry.outline.dispose()
    },
    [geometry],
  )
  useFrame(() => {
    const level = levelObject()
    if (!ref.current) return
    ref.current.visible = !!level
    if (level) {
      level.updateWorldMatrix(true, false)
      ref.current.matrix.copy(level.matrixWorld)
    }
  })
  return (
    <group matrixAutoUpdate={false} ref={ref}>
      <mesh
        geometry={geometry.floor}
        layers={EDITOR_LAYER}
        material={floorMaterial}
        raycast={noRaycast}
        renderOrder={100}
      />
      <mesh
        geometry={geometry.surfaces}
        layers={EDITOR_LAYER}
        material={surfaceMaterial}
        raycast={noRaycast}
        renderOrder={100}
      />
      <lineSegments
        geometry={geometry.outline}
        layers={EDITOR_LAYER}
        material={outlineMaterial}
        raycast={noRaycast}
        renderOrder={101}
      />
    </group>
  )
}

export function RoomHighlight3D() {
  const room = useRoomHighlight()
  return (
    <>
      <RoomControls3D />
      {room ? <RoomMesh room={room} /> : null}
    </>
  )
}

export function RoomHighlight2D({ levelId }: { levelId: string | null }) {
  const room = useRoomHighlight()
  const shape = room?.geometry
  const paths = useMemo(() => {
    if (!shape) return null
    const ringPath = (ring: [number, number][]) =>
      `M ${ring.map((point) => point.join(' ')).join(' L ')} Z`
    return {
      floor: shape.clearPolygon
        .flatMap(({ outer, holes }) => [outer, ...holes])
        .map(ringPath)
        .join(' '),
      walls: shape.boundaryWallIds
        .flatMap((id) => {
          const ring = shape.context.wallFootprints.get(id)
          return ring ? [ringPath(ring)] : []
        })
        .join(' '),
    }
  }, [shape])
  return (
    <>
      <RoomControls2D levelId={levelId} />
      {room && paths && room.key.levelId === levelId && (
        <g data-room-highlight={room.key.zoneId} pointerEvents="none">
          <path d={paths.floor} fill="#818cf8" fillOpacity={0.18} fillRule="evenodd" />
          <path
            d={paths.walls}
            fill="none"
            stroke="#818cf8"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )}
    </>
  )
}
