'use client'

import { type AnyNodeId, sceneRegistry, useScene, type WallNode } from '@pascal-app/core'
import {
  drainRebuiltWalls,
  getPendingWallRebuildCount,
  isIsolationActive,
  SCENE_LAYER,
  useViewer,
  type WallMode,
} from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { type Material, Matrix4, Mesh, type Object3D } from 'three'
import {
  applyWallBatchGroups,
  buildWallBatch,
  hideBatchedWall,
  revealBatchedWall,
  type WallBatch,
} from './wall-batch'

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

/**
 * The inputs that re-make every wall's materials without touching a single
 * node.
 *
 * A wall whose own definition changes is marked dirty and leaves its batch on
 * that signal. These four do not go through a node at all — they are viewer
 * toggles and the scene's material library — yet the cutaway pass rebuilds
 * every wall's material set from them, so a merged mesh holding the old set
 * would keep a whole floor looking the way it did before the switch. They
 * change only when someone deliberately flips a switch, so re-sewing the
 * scene on them is cheap.
 */
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

const batchesByLevel = new Map<string, BatchRecord[]>()
const batchByNode = new Map<string, BatchRecord>()
const staleLevels = new Set<string>()
const changedWalls = new Set<string>()
const EMPTY_IDS: ReadonlySet<string> = new Set()
let lastCutawayHiddenWalls: ReadonlySet<string> = EMPTY_IDS
let knownWallCount = -1
let lastWallChangeAtMs = 0
let batchingSuspended = false

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

export type WallBatchCandidate = { nodeId: string; mesh: Mesh; materials: Material[] }

/**
 * A wall joins a batch only if its whole material set is opaque. Translucent
 * and cut-away walls depend on per-object blend ordering, which merging would
 * change — they keep the per-wall path.
 */
function toCandidate(
  nodeId: string,
  node: WallNode,
  excludedNodeIds: ReadonlySet<string> = EMPTY_IDS,
): WallBatchCandidate | null {
  if (excludedNodeIds.has(nodeId)) return null
  if (node.visible === false) return null

  const mesh = sceneRegistry.nodes.get(nodeId) as Mesh | undefined
  if (!mesh?.visible) return null
  if (mesh.userData.wallHidden === true) return null
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

/**
 * Whether a level's walls may be merged at all right now.
 *
 * The merged mesh captures one material set when it is sewn and nothing
 * re-reads it, so batching is only sound while every batched wall's materials
 * hold still. That is true in `up`; in `cutaway`, walls stamped `wallHidden`
 * are released per wall in the same frame because WallCutout runs at priority
 * 0 and this system at 5. `down` and `translucent` make every wall see-through.
 * Isolation is the other stand-down: it hides the level root the merged mesh
 * hangs off, which would leave a focused batched wall drawn by nobody.
 */
export function canBatchWalls(wallMode: WallMode, isolationActive: boolean): boolean {
  return !isolationActive && (wallMode === 'up' || wallMode === 'cutaway')
}

/**
 * Walls the viewer is currently lighting up — a selection, or any hover.
 *
 * A selection or delete hover paints the wall by swapping the materials on its
 * own mesh, which the merged mesh does not follow. Every other hover draws an
 * outline instead, and that needs the same thing for a different reason: the
 * outline node renders `outliner.hoveredObjects` through the main camera, which
 * enables no batched layer, so a sewn wall reaches neither mask pass and
 * hovering it lights up nothing at all — in select mode, and in paint mode
 * where the outline is the only signal for which surface the next click lands
 * on.
 *
 * Both wants are the same one: a lit wall goes back to drawing its own
 * geometry. Only ever a handful are lit at once, and a handful of extra draw
 * calls is what lighting them costs.
 */
export function collectTintedWalls(wallIds: ReadonlySet<string>): Set<string> {
  const viewer = useViewer.getState()
  const tinted = new Set<string>()

  for (const id of viewer.selection.selectedIds) if (wallIds.has(id)) tinted.add(id)
  for (const id of viewer.previewSelectedIds) if (wallIds.has(id)) tinted.add(id)

  const hovered = viewer.hoveredId
  if (hovered && wallIds.has(hovered)) tinted.add(hovered)

  return tinted
}

function materialSetKey(materials: readonly Material[]): string {
  return materials.map((material) => material.uuid).join('|')
}

export function collectWallBatchCandidates(
  levelId: string,
  excludedNodeIds: ReadonlySet<string> = EMPTY_IDS,
): Map<string, WallBatchCandidate[]> {
  const nodes = useScene.getState().nodes
  const level = nodes[levelId as AnyNodeId]
  const grouped = new Map<string, WallBatchCandidate[]>()
  if (level?.type !== 'level') return grouped

  for (const childId of level.children) {
    const child = nodes[childId]
    if (child?.type !== 'wall') continue

    const candidate = toCandidate(childId, child as WallNode, excludedNodeIds)
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
function unbatchedWallCount(
  levelId: string,
  excludedNodeIds: ReadonlySet<string> = EMPTY_IDS,
): number {
  const nodes = useScene.getState().nodes
  const level = nodes[levelId as AnyNodeId]
  if (level?.type !== 'level') return 0

  let count = 0
  for (const childId of level.children) {
    if (excludedNodeIds.has(childId)) continue
    if (batchByNode.has(childId)) continue
    const child = nodes[childId]
    if (child?.type !== 'wall') continue
    if (toCandidate(childId, child as WallNode)) count++
  }

  return count
}

const localMatrix = new Matrix4()
const rootInverse = new Matrix4()

function mergeLevel(levelId: string, excludedNodeIds: ReadonlySet<string> = EMPTY_IDS) {
  disposeLevelBatches(levelId)

  const root = sceneRegistry.nodes.get(levelId) as Object3D | undefined
  if (!root) return

  root.updateWorldMatrix(true, false)
  rootInverse.copy(root.matrixWorld).invert()

  const records: BatchRecord[] = []

  for (const candidates of collectWallBatchCandidates(levelId, excludedNodeIds).values()) {
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

  // Scripted-probe hook, ?perf sessions only (mirrors __itemBatch): the
  // panel has no row for the merged wall batch, so probes read it here.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('perf')) return
    const probe = {
      stats: () => {
        let batches = 0
        for (const records of batchesByLevel.values()) batches += records.length
        let hidden = 0
        for (const nodeId of sceneRegistry.byType.wall ?? EMPTY_IDS) {
          if (sceneRegistry.nodes.get(nodeId)?.userData.wallHidden === true) hidden++
        }
        return {
          walls: batchByNode.size,
          batches,
          levels: batchesByLevel.size,
          hidden,
          suspended: batchingSuspended,
          wallMode: useViewer.getState().wallMode,
        }
      },
    }
    ;(window as unknown as { __wallBatch?: unknown }).__wallBatch = probe
    return () => {
      delete (window as unknown as { __wallBatch?: unknown }).__wallBatch
    }
  }, [])

  useEffect(
    () => () => {
      if (wakeRef.current) clearTimeout(wakeRef.current)
      for (const levelId of [...batchesByLevel.keys()]) disposeLevelBatches(levelId)
      changedWalls.clear()
      staleLevels.clear()
      lastCutawayHiddenWalls = EMPTY_IDS
      knownWallCount = -1
      batchingSuspended = false
      lastAppearance.shading = undefined
      lastAppearance.textures = undefined
      lastAppearance.colorPreset = undefined
      lastAppearance.sceneTheme = undefined
      lastAppearance.materials = null
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

  // A tinted wall paints itself through materials the merged mesh never reads,
  // so it goes back to drawing its own geometry for as long as it is lit. It
  // stays out afterwards: one wall short of a batch is not worth re-sewing a
  // floor over, and the level's own re-merge threshold decides when it is.
  const tintedWalls = collectTintedWalls(wallIds)
  for (const nodeId of tintedWalls) {
    if (!batchByNode.has(nodeId)) continue
    const record = batchByNode.get(nodeId)
    if (record) staleLevels.add(record.levelId)
    releaseWall(nodeId)
    changed = true
  }

  // Only cutaway hides walls one by one; `up` hides none and the other modes
  // stand the batch down, so the stamp scan is worth a frame only there.
  const cutawayHiddenWalls = new Set<string>()
  if (useViewer.getState().wallMode === 'cutaway') {
    for (const nodeId of wallIds) {
      const mesh = sceneRegistry.nodes.get(nodeId)
      if (mesh?.userData.wallHidden === true) cutawayHiddenWalls.add(nodeId)
    }
  }
  for (const nodeId of cutawayHiddenWalls) {
    const record = batchByNode.get(nodeId)
    if (!record) continue
    releaseWall(nodeId)
    staleLevels.add(record.levelId)
    changed = true
  }
  // A stamp that lifts hands the wall back to its own draw call, and nothing
  // else marks the level — so the flip itself has to, or the wall would stay
  // out of the merged mesh until an unrelated edit re-sews the floor.
  for (const nodeId of lastCutawayHiddenWalls) {
    if (cutawayHiddenWalls.has(nodeId)) continue
    const node = nodes[nodeId as AnyNodeId]
    if (node?.type === 'wall' && node.parentId) staleLevels.add(node.parentId)
    changed = true
  }
  lastCutawayHiddenWalls = cutawayHiddenWalls
  const excludedNodeIds = new Set(cutawayHiddenWalls)
  for (const nodeId of tintedWalls) excludedNodeIds.add(nodeId)

  // A theme, texture or material-library switch re-makes every wall's
  // materials without marking a single node, so the merged copies have to be
  // sewn again from the new ones. See `appearanceChanged`.
  if (appearanceChanged()) {
    for (const levelId of [...batchesByLevel.keys()]) disposeLevelBatches(levelId)
    for (const levelId of sceneRegistry.byType.level ?? EMPTY_IDS) staleLevels.add(levelId)
    changed = true
  }

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

  // Isolation, `down` and `translucent` make batching unsound, so the batch
  // stands down while they hold and sews the floors back together once they
  // lift. `cutaway` stays live because WallCutout stamps hidden walls at
  // priority 0 and this system releases them per wall at priority 5 in the
  // same frame. See `canBatchWalls`.
  const suspended = !canBatchWalls(useViewer.getState().wallMode, isIsolationActive())
  if (suspended !== batchingSuspended) {
    batchingSuspended = suspended
    for (const levelId of [...batchesByLevel.keys()]) disposeLevelBatches(levelId)
    staleLevels.clear()
    if (!suspended) {
      for (const levelId of sceneRegistry.byType.level ?? EMPTY_IDS) staleLevels.add(levelId)
    }
    changed = true
  }
  if (batchingSuspended) {
    staleLevels.clear()
    return
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
    if (unbatchedWallCount(levelId, excludedNodeIds) >= MIN_BATCH_WALLS) {
      mergeLevel(levelId, excludedNodeIds)
    }
  }
  staleLevels.clear()
}
