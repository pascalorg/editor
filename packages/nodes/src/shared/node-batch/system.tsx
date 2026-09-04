'use client'

import {
  type AnyNodeId,
  emitter,
  sceneRegistry,
  useInteractive,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { isIsolationActive, publishPerfBatchStats, useViewer } from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { Object3D } from 'three'
import {
  BATCH_KINDS,
  collectBatchCandidate,
  collectTintedNodes,
  getBatchableNodeIds,
  hideBatchedNode,
  revealAllBatchedHolds,
  revealBatchedNode,
} from './candidates'
import { NodeBatchStore } from './store'
import { type BatchCandidate, MIN_BATCH_ENTRIES, NODE_BATCH_SETTLE_MS } from './types'

/**
 * Orchestrates node draw-call batching (charter backlog #3a/#3b). Same shape
 * as `../../wall/wall-batch-system.tsx`: membership follows the scene dirty
 * signal, lit nodes draw themselves, appearance switches re-sew everything,
 * and joins wait for a quiet window. The container differs — `NodeBatchStore`
 * holds BatchedMeshes, so membership changes are instance add/deletes, not
 * resews.
 */

const store = new NodeBatchStore(
  (levelId: string) => sceneRegistry.nodes.get(levelId) as Object3D | undefined,
)

/**
 * Marks captured before the consuming systems (priority 2+) clear them — the
 * walls' `drainRebuiltWalls` ledger, done from the outside: a priority-1 pass
 * snapshots which nodes this frame touched. A dirty WALL cascades to its
 * hosted doors/windows: the wall edit moves them in level space without
 * marking them.
 */
const changedNodes = new Set<string>()
const staleNodes = new Set<string>()
/**
 * Members whose wave joined only part of their meshes (the rest fell under
 * MIN_BATCH_ENTRIES). `store.has` locks them out of later waves, so a new
 * placement releases them for a full re-collect — the new copy may be what
 * makes their leftover buckets viable.
 */
const partialNodes = new Set<string>()
/**
 * Candidates whose whole wave fell under MIN_BATCH_ENTRIES. When a NEW
 * leftover appears (the missing bucket-mate arriving late — it was deferred
 * as selected/dirty/loading when its peers' wave ran), the whole set is
 * re-offered in one wave so the bucket finally tallies together. A stable
 * leftover set re-offers nothing, so genuinely small scenes stay quiet.
 */
const leftoverNodes = new Set<string>()
/** Last frame's batchable ids, for the add/remove diff below. */
let knownNodeIds: ReadonlySet<string> | null = null
// Probe-only counters (?perf sessions read them via __itemBatch).
const waveDebug = { runs: 0, stale: 0, candidates: 0, joined: 0, nullCandidates: 0 }
let lastNodeChangeAtMs = 0
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

// Same inputs as the wall batch: these re-resolve every batched node's
// materials without marking a node (per-node paint goes through `node.slots`
// → a dirty mark).
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
  changedNodes.clear()
  staleNodes.clear()
  partialNodes.clear()
  leftoverNodes.clear()
  knownNodeIds = null
  lastNodeChangeAtMs = 0
  batchingSuspended = false
  lastAppearance.shading = undefined
  lastAppearance.textures = undefined
  lastAppearance.colorPreset = undefined
  lastAppearance.sceneTheme = undefined
  lastAppearance.materials = null
}

// Membership truth for the ?perf panel's `batch` row — the panel cannot read
// this package's store itself, and the per-pass multi-draw counters flip
// between shadow/main/outline cameras.
function publishBatchStats() {
  const stats = store.stats()
  publishPerfBatchStats({
    items: stats.nodes,
    instances: stats.instances,
    containers: stats.batches,
  })
}

function releaseNode(nodeId: string) {
  partialNodes.delete(nodeId)
  leftoverNodes.delete(nodeId)
  if (store.release(nodeId)) {
    revealBatchedNode(nodeId)
    publishBatchStats()
  }
}

function releaseAll() {
  for (const nodeId of [...store.nodeIds()]) releaseNode(nodeId)
  store.disposeAll()
  // Tracked refs can go stale when a system rebuilt a batched node's meshes;
  // the sweep guarantees nothing stays draw-hidden after a full stand-down.
  revealAllBatchedHolds()
}

function captureChangedNodes() {
  const dirty = useScene.getState().dirtyNodes
  if (dirty.size === 0) return
  const nodes = useScene.getState().nodes
  for (const id of dirty) {
    const node = nodes[id]
    if (!node) continue
    if (BATCH_KINDS.has(node.type)) changedNodes.add(id as string)
    else if (node.type === 'wall' && Array.isArray(node.children)) {
      // The wall edit moved its openings in level space; their own marks may
      // never come.
      for (const childId of node.children) {
        const child = nodes[childId as AnyNodeId]
        if (child && (child.type === 'door' || child.type === 'window')) {
          changedNodes.add(childId as string)
        }
      }
    }
  }
}

function runBatchFrame(
  invalidate: () => void,
  wakeRef: { current: ReturnType<typeof setTimeout> | null },
) {
  const nodeIds = getBatchableNodeIds()

  let changed = changedNodes.size > 0

  // A level-subtree remount (thumbnail capture, tool-state swings) replaces
  // the registry groups: batches die with the old groups and fresh sources
  // mount with no hold. Detect it by parent identity and re-sew.
  for (const nodeId of store.pruneDetached()) {
    releaseNode(nodeId)
    staleNodes.add(nodeId)
    changed = true
  }

  for (const nodeId of changedNodes) {
    releaseNode(nodeId)
    staleNodes.add(nodeId)
  }
  changedNodes.clear()

  const tinted = collectTintedNodes(nodeIds)
  for (const nodeId of tinted) {
    if (!store.has(nodeId)) continue
    releaseNode(nodeId)
    staleNodes.add(nodeId)
    changed = true
  }

  // A live override on a batched node — a collaborator's remote drag, a
  // programmatic move — has no local selection to tint it; the batch copy
  // would freeze at the join pose while the real meshes move.
  for (const nodeId of useLiveNodeOverrides.getState().overrides.keys()) {
    if (!store.has(nodeId)) continue
    releaseNode(nodeId)
    staleNodes.add(nodeId)
    changed = true
  }

  // A door/window whose animation record just appeared must draw its own
  // meshes for the tween — the batch copy would hold the pre-swing pose. The
  // candidate filter keeps it out while the record lives; the completion
  // dirty mark re-stales it at the settled pose.
  const interactive = useInteractive.getState()
  for (const animated of [interactive.doorAnimations, interactive.windowAnimations]) {
    for (const nodeId of Object.keys(animated)) {
      if (!store.has(nodeId)) continue
      releaseNode(nodeId)
      staleNodes.add(nodeId)
      changed = true
    }
  }

  if (appearanceChanged()) {
    releaseAll()
    for (const nodeId of nodeIds) staleNodes.add(nodeId)
    changed = true
  }

  // Deleted nodes carry no mark of their own, so membership is diffed by id
  // against last frame's registry — a size comparison would miss a same-size
  // add-and-remove (compound undo, paste-replace) and leave the removed
  // node's instances drawing as ghosts.
  if (knownNodeIds === null) {
    for (const nodeId of nodeIds) staleNodes.add(nodeId)
    changed = true
  } else {
    for (const nodeId of knownNodeIds) {
      if (nodeIds.has(nodeId)) continue
      if (store.has(nodeId)) releaseNode(nodeId)
      staleNodes.delete(nodeId)
      changed = true
    }
    let added = false
    for (const nodeId of nodeIds) {
      if (knownNodeIds.has(nodeId) || store.has(nodeId)) continue
      staleNodes.add(nodeId)
      added = true
      changed = true
    }
    // A newly placed copy can be what pushes an under-threshold bucket over
    // MIN_BATCH_ENTRIES — earlier copies were dropped from staleNodes when
    // their wave came up short, so re-stale everything unbatched, and release
    // partial members so their leftover meshes get re-offered too.
    if (added) {
      for (const nodeId of nodeIds) {
        if (!store.has(nodeId)) staleNodes.add(nodeId)
      }
      for (const nodeId of [...partialNodes]) {
        releaseNode(nodeId)
        staleNodes.add(nodeId)
      }
    }
  }
  knownNodeIds = nodeIds

  // Isolation hides everything outside the focused subtree; batches hang off
  // level roots and would go dark with them, leaving members drawn by nobody
  // when a batched node is the focus. Stand down entirely, re-sew after.
  const suspended = isIsolationActive()
  if (suspended !== batchingSuspended) {
    batchingSuspended = suspended
    releaseAll()
    staleNodes.clear()
    if (!suspended) for (const nodeId of nodeIds) staleNodes.add(nodeId)
    changed = true
  }
  if (batchingSuspended) {
    staleNodes.clear()
    return
  }

  const now = performance.now()
  if (changed) lastNodeChangeAtMs = now
  if (staleNodes.size === 0) return

  const settled = !changed && now - lastNodeChangeAtMs >= NODE_BATCH_SETTLE_MS
  if (!settled) {
    if (wakeRef.current) clearTimeout(wakeRef.current)
    wakeRef.current = setTimeout(() => {
      wakeRef.current = null
      invalidate()
    }, NODE_BATCH_SETTLE_MS + 20)
    return
  }

  const dirty = useScene.getState().dirtyNodes
  const candidates: BatchCandidate[] = []
  // A lit or still-dirty node is deferred, not dropped — it must rejoin once
  // the tint lifts or the mark drains, and nothing later would re-stale it.
  const deferred = new Set<string>()
  waveDebug.runs++
  waveDebug.stale = staleNodes.size
  waveDebug.nullCandidates = 0
  const overrides = useLiveNodeOverrides.getState()
  for (const nodeId of staleNodes) {
    if (store.has(nodeId)) continue
    // Overrides defer like tint/dirt — an in-flight gesture ends with a
    // commit whose mark re-offers the node; dropping it here would strand it.
    if (
      tinted.has(nodeId) ||
      dirty.has(nodeId as AnyNodeId) ||
      overrides.get(nodeId) !== undefined
    ) {
      deferred.add(nodeId)
      continue
    }
    const candidate = collectBatchCandidate(nodeId)
    if (candidate) candidates.push(candidate)
    else waveDebug.nullCandidates++
  }
  waveDebug.candidates = candidates.length

  // Hide exactly what the store took — an entry it skipped (below the
  // new-batch threshold, rejected geometry, missing level root) must keep
  // drawing itself.
  const joined = store.join(candidates, MIN_BATCH_ENTRIES)
  waveDebug.joined = joined.length
  const joinedByNode = new Map<string, typeof joined>()
  for (const entry of joined) {
    const bucket = joinedByNode.get(entry.nodeId)
    if (bucket) bucket.push(entry)
    else joinedByNode.set(entry.nodeId, [entry])
  }
  let newLeftovers = false
  for (const candidate of candidates) {
    if (!joinedByNode.has(candidate.nodeId)) {
      if (!leftoverNodes.has(candidate.nodeId)) newLeftovers = true
      leftoverNodes.add(candidate.nodeId)
    }
  }
  for (const candidate of candidates) {
    const joinedEntries = joinedByNode.get(candidate.nodeId)
    if (!joinedEntries) continue
    leftoverNodes.delete(candidate.nodeId)
    hideBatchedNode({
      nodeId: candidate.nodeId,
      levelId: candidate.levelId,
      entries: joinedEntries,
    })
    if (joinedEntries.length < candidate.entries.length) partialNodes.add(candidate.nodeId)
  }
  staleNodes.clear()
  for (const nodeId of deferred) staleNodes.add(nodeId)
  // A new leftover may be the bucket-mate its peers were missing — re-offer
  // the whole set together next wave.
  if (newLeftovers) for (const nodeId of leftoverNodes) staleNodes.add(nodeId)
  publishBatchStats()
}

// The headless bake/thumbnail worker loads `?disable=draw` pages: one capture,
// no interactive frames — batching there only risks the export (sources are
// layer-held exactly when the clone happens) and wins nothing.
const DRAW_DISABLED =
  typeof window !== 'undefined' &&
  new Set(
    (new URLSearchParams(window.location.search).get('disable') ?? '')
      .split(',')
      .map((s) => s.trim()),
  ).has('draw')

export const NodeBatchSystem = () => {
  if (DRAW_DISABLED) return null
  return <NodeBatchSystemActive />
}

const NodeBatchSystemActive = () => {
  const invalidate = useThree((state) => state.invalidate)
  const wakeRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Before the consuming systems (priority 2+) clear the marks this frame.
  useFrame(captureChangedNodes, 1)
  useFrame(() => runBatchFrame(invalidate, wakeRef), 5)

  // GLB export / thumbnail capture clones the live scene and prunes anything
  // off the scene layer — exactly where batched sources sit. Hand every node
  // its own meshes back before the clone; the settle window re-sews after.
  useEffect(() => {
    const restoreForCapture = () => {
      for (const nodeId of [...store.nodeIds()]) {
        releaseNode(nodeId)
        staleNodes.add(nodeId)
      }
      store.disposeAll()
      revealAllBatchedHolds()
      lastNodeChangeAtMs = performance.now()
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
      staleCount: () => staleNodes.size,
      lastChangeAgoMs: () => performance.now() - lastNodeChangeAtMs,
      has: (nodeId: string) => store.has(nodeId),
      ids: () => [...store.nodeIds()],
      hovered: () => useViewer.getState().hoveredId ?? null,
      wave: () => ({ ...waveDebug }),
      releaseAllNow: () => {
        releaseAll()
        publishBatchStats()
      },
      staleAllNow: () => {
        for (const nodeId of getBatchableNodeIds()) staleNodes.add(nodeId)
      },
      batchRender: () => {
        const out: Array<{ segments: number; visibleChain: boolean; instances: number }> = []
        for (const levelId of sceneRegistry.byType.level ?? []) {
          const root = sceneRegistry.nodes.get(levelId)
          root?.traverse((child) => {
            if (child.name !== 'item-batch') return
            let chain = true
            let walker: typeof child | null = child
            let top: typeof child = child
            while (walker) {
              if (walker.visible === false) chain = false
              top = walker
              walker = walker.parent as typeof child | null
            }
            const b = child as unknown as { _multiDrawCount?: number; _maxInstanceCount?: number }
            out.push({
              segments: b._multiDrawCount ?? -1,
              visibleChain: chain && (top as { isScene?: boolean }).isScene === true,
              instances: b._maxInstanceCount ?? -1,
            })
          })
        }
        return out
      },
      // Emits the real capture event and reports what is still draw-hidden
      // afterwards — a nonzero heldSources here is exactly what the GLB
      // exporter would prune.
      simulateCapture: () => {
        emitter.emit('thumbnail:before-capture', undefined)
        let batchMeshes = 0
        const heldMeshes: string[] = []
        for (const levelId of sceneRegistry.byType.level ?? []) {
          const root = sceneRegistry.nodes.get(levelId)
          root?.traverse((child) => {
            if (child.name === 'item-batch') batchMeshes++
            else if ((child as { isMesh?: boolean }).isMesh && !child.layers.isEnabled(0)) {
              heldMeshes.push(`${child.name || '?'}`)
            }
          })
        }
        return { batchMeshes, held: heldMeshes.length, heldNames: heldMeshes.slice(0, 20) }
      },
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
