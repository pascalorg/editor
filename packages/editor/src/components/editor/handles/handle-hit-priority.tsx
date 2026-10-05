'use client'

import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import type { Intersection, Object3D } from 'three'
import { EDITOR_HANDLE_HIT_AREA_USER_DATA_KEY } from '../../../lib/direct-manipulation'

const isHandleHit = (hit: { object: Object3D }) =>
  hit.object.userData?.[EDITOR_HANDLE_HIT_AREA_USER_DATA_KEY] === true

/**
 * Editor handles first, everything else after, each in distance order. Handles
 * draw on top of walls and a handle anywhere along the ray already owns the
 * press; ordering them first gives them the hover too. Distance order alone
 * lets a wall in front win the hover for good: once its enter stops
 * propagation, R3F keeps stopping every later move at it, so a handle behind
 * it never hears its enter however the pointer reaches it.
 */
export function prioritizeEditorHandleHits<T extends { object: Object3D }>(hits: T[]): T[] {
  if (!hits.some(isHandleHit)) return hits
  return [...hits.filter(isHandleHit), ...hits.filter((hit) => !isHandleHit(hit))]
}

/** Installs `prioritizeEditorHandleHits` as the canvas's pointer-event filter while mounted. */
export function EditorHandleHitPriority() {
  const get = useThree((state) => state.get)
  const setEvents = useThree((state) => state.setEvents)
  useEffect(() => {
    const previous = get().events.filter
    setEvents({
      filter: (hits: Intersection[], state) =>
        prioritizeEditorHandleHits(previous ? previous(hits, state) : hits),
    })
    return () => setEvents({ filter: previous })
  }, [get, setEvents])
  return null
}
