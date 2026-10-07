'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useSyncExternalStore } from 'react'
import { selectionEnabled } from '../lib/interaction/scope'
import {
  type RoomKey,
  RoomSelectionIndex,
  type RoomSelectionRecord,
  resolveRoomHit,
} from '../lib/room-selection'
import { shouldInterceptRoom } from '../lib/room-selection-commands'
import { type SelectionModifierKeys, selectionModifiersFromEvent } from '../lib/selection-routing'
import useEditor, { type Phase } from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'

const indexes = new Map<string, RoomSelectionIndex>()
const subscriptions = new Map<string, { listeners: Set<() => void>; dispose: () => void }>()
const EMPTY: RoomSelectionRecord[] = []

export function getRoomSelectionIndex(levelId: string) {
  let index = indexes.get(levelId)
  if (!index) {
    index = new RoomSelectionIndex(levelId)
    indexes.set(levelId, index)
  }
  index.update(useScene.getState().nodes)
  return index
}

function subscribeLevel(levelId: string | null, listener: () => void) {
  if (!levelId) return () => {}
  let subscription = subscriptions.get(levelId)
  if (!subscription) {
    const listeners = new Set<() => void>()
    const dispose = useScene.subscribe((state, previous) => {
      if (state.nodes === previous.nodes) return
      const rooms = getRoomSelectionIndex(levelId).update(state.nodes)
      const editor = useEditor.getState()
      if (
        editor.room?.levelId === levelId &&
        !rooms.some((room) => room.key.zoneId === editor.room?.zoneId)
      )
        editor.clearRoom()
      for (const notify of listeners) notify()
    })
    subscription = { listeners, dispose }
    subscriptions.set(levelId, subscription)
  }
  subscription.listeners.add(listener)
  return () => {
    subscription.listeners.delete(listener)
    if (!subscription.listeners.size) {
      subscription.dispose()
      subscriptions.delete(levelId)
      indexes.delete(levelId)
    }
  }
}

export function useRoomRecords(levelId: string | null) {
  const subscribe = useCallback((notify: () => void) => subscribeLevel(levelId, notify), [levelId])
  const snapshot = useCallback(
    () => (levelId ? getRoomSelectionIndex(levelId).update(useScene.getState().nodes) : EMPTY),
    [levelId],
  )
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export function useSelectedRoom() {
  const key = useEditor((state) => state.room)
  const rooms = useRoomRecords(key?.levelId ?? null)
  return rooms.find((room) => room.key.zoneId === key?.zoneId) ?? null
}

/**
 * The room a selected zone is, for the room panel: its record when the room
 * index knows it, `{ record: null }` for a room the walls do not close, null
 * for anything that is not a room.
 */
export function useZoneRoom(zoneId: string | null): { record: RoomSelectionRecord | null } | null {
  const levelId = useScene((state) => {
    const zone = zoneId ? state.nodes[zoneId as AnyNodeId] : undefined
    return zone?.type === 'zone' && zone.spaceRole === 'room' ? (zone.parentId ?? null) : null
  })
  const rooms = useRoomRecords(levelId)
  if (!(zoneId && levelId)) return null
  return { record: rooms.find((room) => room.key.zoneId === zoneId) ?? null }
}

export function useHighlightedRoom() {
  const key = useEditor((state) => state.hoveredRoom ?? state.room)
  const rooms = useRoomRecords(key?.levelId ?? null)
  return rooms.find((room) => room.key.zoneId === key?.zoneId) ?? null
}

const hitPoint: [number, number] = [0, 0]

export function resolveEditorRoomHit(
  node: AnyNode | null,
  levelId: string,
  point: readonly [number, number],
  view: '2d' | '3d',
) {
  if (node && node.type !== 'wall' && node.type !== 'slab' && node.type !== 'ceiling') return null
  const index = getRoomSelectionIndex(levelId)
  hitPoint[0] = point[0]
  hitPoint[1] = point[1]
  const room = resolveRoomHit(index, levelId, node, hitPoint, view)
  return room?.key ?? null
}

/**
 * Rooms pick in the structure and furnish phases alike; site has no rooms.
 * `phase` is the phase the pick lands in, when the pick itself switches phase.
 */
export function roomPickingEnabled(phase: Phase = useEditor.getState().phase) {
  const editor = useEditor.getState()
  return (
    phase !== 'site' &&
    editor.mode === 'select' &&
    !useViewer.getState().focusedUnitId &&
    selectionEnabled(useInteractionScope.getState().scope)
  )
}

export function hoverRoomFromHit(
  hit: RoomKey | null,
  modifiers: SelectionModifierKeys,
  nodeId: string | null,
) {
  const editor = useEditor.getState()
  const room = shouldInterceptRoom(hit, modifiers, nodeId) ? hit : null
  editor.setHoveredRoom(room)
  if (room) useViewer.getState().setHoveredId(null)
  return !!room
}

export function resolvePlanRoomHit(nodeId: string | null, point: readonly [number, number]) {
  const node = nodeId ? useScene.getState().nodes[nodeId as AnyNodeId] : null
  const levelId = node?.parentId ?? useViewer.getState().selection.levelId
  return levelId ? resolveEditorRoomHit(node ?? null, levelId, point, '2d') : null
}

export { selectionModifiersFromEvent }
