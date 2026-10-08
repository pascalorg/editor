'use client'

import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  polygonInteriorPoint,
  sceneRegistry,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Group } from 'three'
import { useShallow } from 'zustand/react/shallow'
import { useRoomRecords } from '../../hooks/use-selected-room'
import { getAreaUnitLabel, type LinearUnit, squareMetersToAreaUnit } from '../../lib/measurements'
import { roomFloorElevation } from '../../lib/room-handle-drag'
import type { RoomSelectionRecord } from '../../lib/room-selection'
import useEditor from '../../store/use-editor'
import useInteractionScope from '../../store/use-interaction-scope'

const CONTEXT_TYPES = new Set(['site', 'building', 'level'])

export type RoomLabelVisibilityState = {
  phase: string
  mode: string
  scopeIdle: boolean
  room: unknown
  selectedTypes: readonly (string | undefined)[]
  zoneId: string | null
  focusedUnitId: string | null
  isCaptureMode: boolean
  isThumbnailCapture: boolean
}

/**
 * Room pills are the resting view of a level: inside the building, select tool
 * idle, and nothing picked but the site, building or level itself. Anything
 * selected, a unit being arranged, or a gesture in flight takes them away.
 */
export function roomLabelsVisible(state: RoomLabelVisibilityState): boolean {
  return (
    state.phase === 'building' &&
    state.mode === 'select' &&
    state.scopeIdle &&
    !state.room &&
    !state.zoneId &&
    !state.focusedUnitId &&
    !state.isCaptureMode &&
    !state.isThumbnailCapture &&
    state.selectedTypes.every((type) => type !== undefined && CONTEXT_TYPES.has(type))
  )
}

export function formatRoomArea(squareMeters: number, unit: LinearUnit): string {
  return `${squareMetersToAreaUnit(squareMeters, unit).toFixed(1)} ${getAreaUnitLabel(unit)}`
}

function useRoomLabelsVisible() {
  const [isThumbnailCapture, setThumbnailCapture] = useState(false)
  useEffect(() => {
    const hide = () => setThumbnailCapture(true)
    const restore = () => setThumbnailCapture(false)
    emitter.on('thumbnail:before-capture', hide)
    emitter.on('thumbnail:after-capture', restore)
    return () => {
      emitter.off('thumbnail:before-capture', hide)
      emitter.off('thumbnail:after-capture', restore)
    }
  }, [])
  const editor = useEditor(
    useShallow((s) => ({
      phase: s.phase,
      mode: s.mode,
      room: s.room,
      isCaptureMode: s.isCaptureMode,
    })),
  )
  const scopeIdle = useInteractionScope((s) => s.scope.kind === 'idle')
  const zoneId = useViewer((s) => s.selection.zoneId)
  const focusedUnitId = useViewer((s) => s.focusedUnitId)
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const selectedTypes = useScene(
    useShallow((s) =>
      selectedIds.map((id) => (s.nodes[id as AnyNodeId] as AnyNode | undefined)?.type),
    ),
  )
  return roomLabelsVisible({
    ...editor,
    scopeIdle,
    zoneId,
    focusedUnitId,
    selectedTypes,
    isThumbnailCapture,
  })
}

/** Light name-and-area pills over each room of the active level. */
export function RoomLabels3D() {
  const levelId = useViewer((s) => s.selection.levelId)
  const visible = useRoomLabelsVisible()
  const rooms = useRoomRecords(visible ? levelId : null)
  const ref = useRef<Group>(null)

  useFrame(() => {
    if (!(ref.current && levelId)) return
    const level = sceneRegistry.nodes.get(levelId)
    ref.current.visible = !!level
    if (level) {
      level.updateWorldMatrix(true, false)
      ref.current.matrix.copy(level.matrixWorld)
    }
  })

  if (!(visible && levelId) || rooms.length === 0) return null
  return (
    <group matrixAutoUpdate={false} ref={ref}>
      {rooms.map((room) => (
        <RoomLabel key={room.key.zoneId} room={room} />
      ))}
    </group>
  )
}

function RoomLabel({ room }: { room: RoomSelectionRecord }) {
  const zone = useScene((s) => s.nodes[room.zoneId as AnyNodeId] as ZoneNode | undefined)
  const floorY = useScene((s) => roomFloorElevation(s.nodes, room.zoneId))
  const unit = useViewer((s) => s.unit)
  const [x, z] = useMemo(
    () => polygonInteriorPoint({ polygon: room.polygon, holes: room.holes }),
    [room.polygon, room.holes],
  )
  if (!zone || zone.visible === false) return null

  return (
    <Html
      center
      position={[x, floorY + 0.05, z]}
      // Canvas hit routing owns room-first selection, modifier bypass and item priority.
      style={{ pointerEvents: 'none' }}
      zIndexRange={[20, 0]}
    >
      <div
        className="flex cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 bg-neutral-950/75 px-2.5 py-1 text-white text-xs shadow-sm backdrop-blur-sm transition-colors hover:bg-neutral-950/90"
        data-room-label={room.zoneId}
      >
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: zone.color }} />
        <span className="font-medium">{zone.name?.trim() || room.name || 'Room'}</span>
        <span className="font-mono text-white/60 tabular-nums">
          {formatRoomArea(room.area, unit)}
        </span>
      </div>
    </Html>
  )
}
