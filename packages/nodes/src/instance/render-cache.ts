'use client'

import type { DefinitionId } from '@pascal-app/core'
import { useCallback, useSyncExternalStore } from 'react'
import type { DefinitionRenderData } from './render-data'

type Listener = () => void

type CacheEntry = {
  publishers: Map<symbol, DefinitionRenderData>
  snapshot: DefinitionRenderData | null
  listeners: Set<Listener>
}

const entries = new Map<DefinitionId, CacheEntry>()

function entryFor(id: DefinitionId): CacheEntry {
  let entry = entries.get(id)
  if (!entry) {
    entry = { publishers: new Map(), snapshot: null, listeners: new Set() }
    entries.set(id, entry)
  }
  return entry
}

function notify(entry: CacheEntry) {
  for (const listener of entry.listeners) listener()
}

export function publishDefinitionRenderData(
  id: DefinitionId,
  owner: symbol,
  data: DefinitionRenderData,
) {
  const entry = entryFor(id)
  if (entry.publishers.get(owner)?.signature === data.signature) return
  entry.publishers.set(owner, data)
  entry.snapshot = data
  notify(entry)
}

export function clearDefinitionRenderData(id: DefinitionId, owner: symbol) {
  const entry = entries.get(id)
  if (!entry?.publishers.delete(owner)) return
  entry.snapshot = Array.from(entry.publishers.values()).at(-1) ?? null
  notify(entry)
  if (entry.publishers.size === 0 && entry.listeners.size === 0) entries.delete(id)
}

export function hasDefinitionRenderData(id: DefinitionId): boolean {
  return entries.get(id)?.snapshot !== null && entries.get(id)?.snapshot !== undefined
}

export function useDefinitionRenderData(id: DefinitionId): DefinitionRenderData | null {
  const subscribe = useCallback(
    (listener: Listener) => {
      const entry = entryFor(id)
      entry.listeners.add(listener)
      return () => {
        entry.listeners.delete(listener)
        if (entry.publishers.size === 0 && entry.listeners.size === 0) entries.delete(id)
      }
    },
    [id],
  )
  const getSnapshot = useCallback(() => entries.get(id)?.snapshot ?? null, [id])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
