'use client'

import { type AnyNodeId, sceneRegistry, useScene, type WallNode } from '@pascal-app/core'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { type Material, Matrix4, Mesh, type Object3D } from 'three'
import { SCENE_LAYER } from '../../lib/layers'
import {
  applyWallBatchGroups,
  buildWallBatch,
  hideBatchedWall,
  revealBatchedWall,
  type WallBatch,
} from '../../lib/wall-batch'
import { drainRebuiltWalls, getPendingWallRebuildCount } from './wall-system'

// A level's walls are merged only once they stop changing. Below this many
// walls a merge is not worth the buffer, and the leftovers (a selected wall,
// a lone partition) keep drawing themselves.
const MIN_BATCH_WALLS = 8
// Quiet window after the last wall change before the merge runs.
const BATCH_SETTLE_MS = 180

type BatchRecord = {
  levelId: string
  mesh: Mesh
  batch: WallBatch
  hidden: Set<string>
  nodeIds: string[]
}

const batchesByLevel = new Map<string, BatchRecord[]>()
const batchByNode = new Map<string, BatchRecord>()
const staleLevels = new Set<string>()
const changedWalls = new Set<string>()
const EMPTY_IDS: ReadonlySet<string> = new Set()
let knownWallCount = -1
let lastWallChangeAtMs = 0

/**
 * Batched walls are drawn by the merged mesh but still picked, measured and
 * highlighted through their own meshes, so the merged copy must stay out of
 * every raycast.
 */
function skipRaycast() {
  // intentionally empty — see the note above
}

function showOwnGeometry(nodeId: string) {
  const mesh = sceneRegistry.nodes.get(nodeId) as Mesh | undefined
  if (mesh) revealBatchedWall(mesh)
}

/** Hands a wall back to itself: the merged mesh stops drawing it, it resumes. */
function releaseWall(nodeId: string) {
  const record = batchByNode.get(nodeId)
  if (record) {
    record.hidden.add(nodeId)
    applyWallBatchGroups(record.batch, record.hidden)
    batchByNode.delete(nodeId)
  }
  showOwnGeometry(nodeId)
}

function disposeLevelBatches(levelId: string) {
  const records = batchesByLevel.get(levelId)
  if (!records) return

  for (const record of records) {
    record.mesh.removeFromParent()
    record.batch.geometry.dispose()
    for (const nodeId of record.nodeIds) {
      if (batchByNode.get(nodeId) === record) batchByNode.delete(nodeId)
      showOwnGeometry(nodeId)
    }
  }

  batchesByLevel.delete(levelId)
}

type Candidate = { nodeId: string; mesh: Mesh; materials: Material[] }

/**
 * A wall joins a batch only if its whole material set is opaque. Translucent
 * and cut-away walls depend on per-object blend ordering, which merging would
 * change — they keep the per-wall path.
 */
function toCandidate(nodeId: string, node: WallNode): Candidate | null {
  if (node.visible === false) return null

  const mesh = sceneRegistry.nodes.get(nodeId) as Mesh | undefined
  if (!mesh?.visible) return null
  // Solo's shadow-caster-only pass and the viewer's isolation filter both
  // hide a wall by taking it off the scene layer. Sewing it in would put it
  // back on screen through the merged mesh, which neither asked for.
  if (!mesh.layers.isEnabled(SCENE_LAYER)) return null
  if (!mesh.geometry?.getAttribute('position')) return null

  const materials = mesh.material
  if (!Array.isArray(materials) || materials.length === 0) return null
  if (materials.some((material) => material.transparent)) return null

  return { nodeId, mesh, materials }
}

function materialSetKey(materials: readonly Material[]): string {
  return materials.map((material) => material.uuid).join('|')
}

function collectCandidates(levelId: string): Map<string, Candidate[]> {
  const nodes = useScene.getState().nodes
  const level = nodes[levelId as AnyNodeId]
  const grouped = new Map<string, Candidate[]>()
  if (level?.type !== 'level') return grouped

  for (const childId of level.children) {
    const child = nodes[childId]
    if (child?.type !== 'wall') continue

    const candidate = toCandidate(childId, child as WallNode)
    if (!candidate) continue

    const key = materialSetKey(candidate.materials)
    const bucket = grouped.get(key)
    if (bucket) bucket.push(candidate)
    else grouped.set(key, [candidate])
  }

  return grouped
}

/**
 * Walls on this level that no batch currently draws.
 *
 * Editing a wall drops it out of its batch — a group-list rewrite that touches
 * no buffer — and it goes back to drawing itself. Re-sewing the level only
 * pays off once enough walls have drifted out, so a single edit leaves the
 * floor's merged mesh exactly where it was.
 */
function unbatchedWallCount(levelId: string): number {
  const nodes = useScene.getState().nodes
  const level = nodes[levelId as AnyNodeId]
  if (level?.type !== 'level') return 0

  let count = 0
  for (const childId of level.children) {
    if (batchByNode.has(childId)) continue
    const child = nodes[childId]
    if (child?.type !== 'wall') continue
    if (toCandidate(childId, child as WallNode)) count++
  }

  return count
}

const localMatrix = new Matrix4()
const rootInverse = new Matrix4()

function mergeLevel(levelId: string) {
  disposeLevelBatches(levelId)

  const root = sceneRegistry.nodes.get(levelId) as Object3D | undefined
  if (!root) return

  root.updateWorldMatrix(true, false)
  rootInverse.copy(root.matrixWorld).invert()

  const records: BatchRecord[] = []

  for (const candidates of collectCandidates(levelId).values()) {
    if (candidates.length < MIN_BATCH_WALLS) continue

    const sources = candidates.map((candidate) => {
      candidate.mesh.updateWorldMatrix(true, false)
      return {
        nodeId: candidate.nodeId,
        geometry: candidate.mesh.geometry,
        matrix: localMatrix.multiplyMatrices(rootInverse, candidate.mesh.matrixWorld).clone(),
      }
    })

    const batch = buildWallBatch(sources)
    if (!batch) continue

    const mesh = new Mesh(batch.geometry, candidates[0]!.materials)
    mesh.name = 'wall-batch'
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.matrixAutoUpdate = false
    mesh.raycast = skipRaycast
    root.add(mesh)

    const record: BatchRecord = {
      levelId,
      mesh,
      batch,
      hidden: new Set(),
      nodeIds: candidates.map((candidate) => candidate.nodeId),
    }
    records.push(record)

    for (const candidate of candidates) {
      hideBatchedWall(candidate.mesh)
      batchByNode.set(candidate.nodeId, record)
    }
  }

  if (records.length > 0) batchesByLevel.set(levelId, records)
}

export const WallBatchSystem = () => {
  const invalidate = useThree((state) => state.invalidate)
  const wakeRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useFrame(() => runBatchFrame(invalidate, wakeRef), 5)

  useEffect(
    () => () => {
      if (wakeRef.current) clearTimeout(wakeRef.current)
      for (const levelId of [...batchesByLevel.keys()]) disposeLevelBatches(levelId)
      changedWalls.clear()
      staleLevels.clear()
      knownWallCount = -1
    },
    [],
  )

  return null
}

/**
 * Follows the scene's dirty tracking rather than watching the walls itself.
 *
 * A wall changes for exactly one reason the merged mesh cares about: the wall
 * system rebuilt its geometry. That system already runs off `dirtyNodes`, so
 * this reads the same signal from both ends — the marks still standing when
 * this frame reaches us, and the rebuild notices the wall system left behind
 * for the walls whose marks it has already cleared. Nothing here re-derives
 * "did this wall move" on its own, and the per-frame cost is the size of the
 * dirty set rather than the size of the floor.
 */
function runBatchFrame(
  invalidate: () => void,
  wakeRef: { current: ReturnType<typeof setTimeout> | null },
) {
  const wallIds = sceneRegistry.byType.wall ?? EMPTY_IDS
  const nodes = useScene.getState().nodes

  // Walls the wall system rebuilt: it clears each mark as it goes, so by the
  // time this runs the store no longer names them.
  drainRebuiltWalls(changedWalls)
  // Walls still marked: the wall system deferred them to a later frame (a
  // progressive import) or their mesh had not mounted yet.
  for (const nodeId of useScene.getState().dirtyNodes) {
    if (wallIds.has(nodeId)) changedWalls.add(nodeId)
  }

  let changed = changedWalls.size > 0

  for (const nodeId of changedWalls) {
    const record = batchByNode.get(nodeId)
    if (record) staleLevels.add(record.levelId)
    const node = nodes[nodeId as AnyNodeId]
    if (node?.type === 'wall' && node.parentId) staleLevels.add(node.parentId)
    releaseWall(nodeId)
  }
  changedWalls.clear()

  // A wall that left the scene carries no mark of its own — deleting one
  // dirties the neighbours it re-mitres, not the node that went away. The
  // wall count moving is the cheap tell that the batch needs reconciling.
  if (wallIds.size !== knownWallCount) {
    knownWallCount = wallIds.size
    for (const [nodeId, record] of [...batchByNode]) {
      if (wallIds.has(nodeId)) continue
      staleLevels.add(record.levelId)
      releaseWall(nodeId)
      changed = true
    }
  }

  const now = performance.now()
  if (changed) lastWallChangeAtMs = now
  if (staleLevels.size === 0) return

  // Merging mid-edit would sew stale geometry in: a dragged wall's neighbours
  // are deferred to the wall system's trailing-edge flush, and those rebuilds
  // land after the drag's last dirty mark. Waiting on its queue — not just on
  // a clock — is what keeps a re-sewn floor in step with the walls it copies.
  const settled =
    !changed && getPendingWallRebuildCount() === 0 && now - lastWallChangeAtMs >= BATCH_SETTLE_MS

  if (!settled) {
    // The canvas renders on demand, so nothing would bring us back once the
    // scene goes quiet — poke one frame after the window should have closed.
    if (wakeRef.current) clearTimeout(wakeRef.current)
    wakeRef.current = setTimeout(() => {
      wakeRef.current = null
      invalidate()
    }, BATCH_SETTLE_MS + 20)
    return
  }

  for (const levelId of staleLevels) {
    if (unbatchedWallCount(levelId) >= MIN_BATCH_WALLS) mergeLevel(levelId)
  }
  staleLevels.clear()
}
