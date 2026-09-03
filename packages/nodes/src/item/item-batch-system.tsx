'use client'

import { type AnyNodeId, emitter, sceneRegistry, useScene } from '@pascal-app/core'
import { isIsolationActive, useViewer } from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { Object3D } from 'three'
import { ItemBatchStore } from './item-batch'
import {
  collectItemCandidate,
  collectTintedItems,
  getBatchableItemIds,
  hideBatchedItem,
  revealBatchedItem,
} from './item-batch-candidates'
import { ITEM_BATCH_SETTLE_MS, type ItemCandidate, MIN_BATCH_ENTRIES } from './item-batch-types'

/**
 * Orchestrates item draw-call batching (charter backlog #3a). Same shape as
 * `../wall/wall-batch-system.tsx`: membership follows the scene dirty signal,
 * lit items draw themselves, appearance switches re-sew everything, and joins
 * wait for a quiet window. The container differs — `ItemBatchStore` holds
 * BatchedMeshes, so membership changes are instance add/deletes, not resews.
 */

const store = new ItemBatchStore(
  (levelId: string) => sceneRegistry.nodes.get(levelId) as Object3D | undefined,
)

/**
 * Item marks captured before `ItemSystem` (priority 2) clears them — the
 * walls' `drainRebuiltWalls` ledger, done from the outside: a priority-1 pass
 * snapshots which items this frame touched.
 */
const changedItems = new Set<string>()
const staleItems = new Set<string>()
// Probe-only counters (?perf sessions read them via __itemBatch).
const waveDebug = { runs: 0, stale: 0, candidates: 0, joined: 0, nullCandidates: 0 }
let knownItemCount = -1
let lastItemChangeAtMs = 0
let batchingSuspended = false

type AppearanceInputs = {
  shading: unknown
  textures: unknown
  colorPreset: unknown
  sceneTheme: unknown
  materials: object | null
}

const lastAppearance: AppearanceInputs = {
  shading: undefined,
  textures: undefined,
  colorPreset: undefined,
  sceneTheme: undefined,
  materials: null,
}

// Same inputs as the wall batch: these re-resolve every item material without
// marking a node (per-item paint goes through `node.slots` → a dirty mark).
function appearanceChanged(): boolean {
  const viewer = useViewer.getState()
  const materials = useScene.getState().materials as object
  if (
    lastAppearance.shading === viewer.shading &&
    lastAppearance.textures === viewer.textures &&
    lastAppearance.colorPreset === viewer.colorPreset &&
    lastAppearance.sceneTheme === viewer.sceneTheme &&
    lastAppearance.materials === materials
  ) {
    return false
  }
  lastAppearance.shading = viewer.shading
  lastAppearance.textures = viewer.textures
  lastAppearance.colorPreset = viewer.colorPreset
  lastAppearance.sceneTheme = viewer.sceneTheme
  lastAppearance.materials = materials
  return true
}

function resetModuleState() {
  changedItems.clear()
  staleItems.clear()
  knownItemCount = -1
  lastItemChangeAtMs = 0
  batchingSuspended = false
  lastAppearance.shading = undefined
  lastAppearance.textures = undefined
  lastAppearance.colorPreset = undefined
  lastAppearance.sceneTheme = undefined
  lastAppearance.materials = null
}

function releaseItem(itemId: string) {
  if (store.release(itemId)) revealBatchedItem(itemId)
}

function releaseAll() {
  for (const itemId of [...store.itemIds()]) releaseItem(itemId)
  store.disposeAll()
}

function captureChangedItems() {
  const dirty = useScene.getState().dirtyNodes
  if (dirty.size === 0) return
  const nodes = useScene.getState().nodes
  for (const id of dirty) {
    if (nodes[id]?.type === 'item') changedItems.add(id as string)
  }
}

function runItemBatchFrame(
  invalidate: () => void,
  wakeRef: { current: ReturnType<typeof setTimeout> | null },
) {
  const itemIds = getBatchableItemIds()

  let changed = changedItems.size > 0
  for (const itemId of changedItems) {
    releaseItem(itemId)
    staleItems.add(itemId)
  }
  changedItems.clear()

  const tinted = collectTintedItems(itemIds)
  for (const itemId of tinted) {
    if (!store.has(itemId)) continue
    releaseItem(itemId)
    staleItems.add(itemId)
    changed = true
  }

  if (appearanceChanged()) {
    releaseAll()
    for (const itemId of itemIds) staleItems.add(itemId)
    changed = true
  }

  // Deleted items carry no mark of their own; the count moving is the tell.
  if (itemIds.size !== knownItemCount) {
    if (knownItemCount >= 0) {
      for (const itemId of [...store.itemIds()]) {
        if (itemIds.has(itemId)) continue
        releaseItem(itemId)
        changed = true
      }
      for (const itemId of itemIds) {
        if (!store.has(itemId)) staleItems.add(itemId)
      }
      changed = true
    } else {
      for (const itemId of itemIds) staleItems.add(itemId)
      changed = true
    }
    knownItemCount = itemIds.size
  }

  // Isolation hides everything outside the focused subtree; batches hang off
  // level roots and would go dark with them, leaving members drawn by nobody
  // when a batched item is the focus. Stand down entirely, re-sew after.
  const suspended = isIsolationActive()
  if (suspended !== batchingSuspended) {
    batchingSuspended = suspended
    releaseAll()
    staleItems.clear()
    if (!suspended) for (const itemId of itemIds) staleItems.add(itemId)
    changed = true
  }
  if (batchingSuspended) {
    staleItems.clear()
    return
  }

  const now = performance.now()
  if (changed) lastItemChangeAtMs = now
  if (staleItems.size === 0) return

  const settled = !changed && now - lastItemChangeAtMs >= ITEM_BATCH_SETTLE_MS
  if (!settled) {
    if (wakeRef.current) clearTimeout(wakeRef.current)
    wakeRef.current = setTimeout(() => {
      wakeRef.current = null
      invalidate()
    }, ITEM_BATCH_SETTLE_MS + 20)
    return
  }

  const dirty = useScene.getState().dirtyNodes
  const candidates: ItemCandidate[] = []
  // A lit or still-dirty item is deferred, not dropped — it must rejoin once
  // the tint lifts or the mark drains, and nothing later would re-stale it.
  const deferred = new Set<string>()
  waveDebug.runs++
  waveDebug.stale = staleItems.size
  waveDebug.nullCandidates = 0
  for (const itemId of staleItems) {
    if (store.has(itemId)) continue
    if (tinted.has(itemId) || dirty.has(itemId as AnyNodeId)) {
      deferred.add(itemId)
      continue
    }
    const candidate = collectItemCandidate(itemId)
    if (candidate) candidates.push(candidate)
    else waveDebug.nullCandidates++
  }
  waveDebug.candidates = candidates.length
  // Hide exactly what the store took — an entry it skipped (below the
  // new-batch threshold, rejected geometry, missing level root) must keep
  // drawing itself.
  const joined = store.join(candidates, MIN_BATCH_ENTRIES)
  waveDebug.joined = joined.length
  const joinedByItem = new Map<string, typeof joined>()
  for (const entry of joined) {
    const bucket = joinedByItem.get(entry.itemId)
    if (bucket) bucket.push(entry)
    else joinedByItem.set(entry.itemId, [entry])
  }
  for (const [itemId, entries] of joinedByItem) {
    hideBatchedItem({ itemId, levelId: entries[0]!.levelId, entries })
  }
  staleItems.clear()
  for (const itemId of deferred) staleItems.add(itemId)
}

export const ItemBatchSystem = () => {
  const invalidate = useThree((state) => state.invalidate)
  const wakeRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Before ItemSystem (priority 2) consumes the marks this frame.
  useFrame(captureChangedItems, 1)
  useFrame(() => runItemBatchFrame(invalidate, wakeRef), 5)

  // GLB export / thumbnail capture clones the live scene and prunes anything
  // off the scene layer — exactly where batched sources sit. Hand every item
  // its own meshes back before the clone; the settle window re-sews after.
  useEffect(() => {
    const restoreForCapture = () => {
      for (const itemId of [...store.itemIds()]) {
        releaseItem(itemId)
        staleItems.add(itemId)
      }
      store.disposeAll()
      lastItemChangeAtMs = performance.now()
    }
    emitter.on('thumbnail:before-capture', restoreForCapture)
    return () => {
      emitter.off('thumbnail:before-capture', restoreForCapture)
    }
  }, [])

  // Scripted-probe hook, ?perf sessions only (mirrors __pascalPerf).
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('perf')) return
    const probe = {
      stats: () => store.stats(),
      staleCount: () => staleItems.size,
      lastChangeAgoMs: () => performance.now() - lastItemChangeAtMs,
      has: (itemId: string) => store.has(itemId),
      ids: () => [...store.itemIds()],
      hovered: () => useViewer.getState().hoveredId ?? null,
      wave: () => ({ ...waveDebug }),
      sceneCensus: () => {
        let batchMeshes = 0
        let heldSources = 0
        for (const levelId of sceneRegistry.byType.level ?? []) {
          const root = sceneRegistry.nodes.get(levelId)
          root?.traverse((child) => {
            if (child.name === 'item-batch') batchMeshes++
            else if ((child as { isMesh?: boolean }).isMesh && !child.layers.isEnabled(0)) {
              heldSources++
            }
          })
        }
        return { batchMeshes, heldSources }
      },
    }
    ;(window as unknown as { __itemBatch?: unknown }).__itemBatch = probe
    return () => {
      delete (window as unknown as { __itemBatch?: unknown }).__itemBatch
    }
  }, [])

  useEffect(
    () => () => {
      if (wakeRef.current) clearTimeout(wakeRef.current)
      releaseAll()
      resetModuleState()
    },
    [],
  )

  return null
}
