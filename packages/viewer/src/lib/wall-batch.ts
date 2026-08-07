import * as THREE from 'three'
import { hideFromScene, showInScene } from './scene-visibility'

/** A contiguous vertex range one wall contributes to one material run. */
export type WallBatchSlice = { nodeId: string; start: number; count: number }

/** Every triangle drawn with one material index, in wall order. */
export type WallBatchRun = {
  materialIndex: number
  start: number
  count: number
  slices: WallBatchSlice[]
}

export type WallBatchSource = {
  nodeId: string
  geometry: THREE.BufferGeometry
  /** Source-local to batch-root transform, baked into the merged vertices. */
  matrix: THREE.Matrix4
}

export type WallBatch = {
  geometry: THREE.BufferGeometry
  runs: WallBatchRun[]
}

const BATCH_ATTRIBUTES = ['position', 'normal', 'uv', 'uv2'] as const
type BatchAttribute = (typeof BATCH_ATTRIBUTES)[number]
const ATTRIBUTE_ITEM_SIZE: Record<BatchAttribute, number> = {
  position: 3,
  normal: 3,
  uv: 2,
  uv2: 2,
}

type PlannedGroup = { materialIndex: number; start: number; count: number }
type PlannedSource = { source: WallBatchSource; groups: PlannedGroup[] }

function planSource(source: WallBatchSource): PlannedSource | null {
  const position = source.geometry.getAttribute('position')
  if (!position || position.count === 0) return null

  const declared =
    source.geometry.groups.length > 0
      ? source.geometry.groups
      : [{ start: 0, count: position.count, materialIndex: 0 }]

  const groups: PlannedGroup[] = []
  for (const group of declared) {
    const start = Math.max(0, group.start)
    const count = Math.min(group.count, position.count - start)
    if (count <= 0) continue
    groups.push({ materialIndex: group.materialIndex ?? 0, start, count })
  }

  return groups.length > 0 ? { source, groups } : null
}

/**
 * Concatenates wall geometries into one buffer laid out material-major,
 * wall-minor: every triangle sharing a material index ends up in a single
 * contiguous run, so the merged mesh costs one draw call per material
 * instead of one per wall per material.
 *
 * Vertices are baked into the batch root's frame, so the merged mesh needs
 * no transform of its own. Each wall's slice of every run is recorded, which
 * is what lets a single wall be pulled back out later without touching the
 * buffers — see `applyWallBatchGroups`.
 *
 * Sources must be non-indexed (the wall pipeline's `applyWorldPlanarWallUVs`
 * already de-indexes) and are skipped if they carry no positions.
 */
export function buildWallBatch(sources: readonly WallBatchSource[]): WallBatch | null {
  const planned: PlannedSource[] = []
  const totals = new Map<number, number>()

  for (const source of sources) {
    const entry = planSource(source)
    if (!entry) continue
    planned.push(entry)
    for (const group of entry.groups) {
      totals.set(group.materialIndex, (totals.get(group.materialIndex) ?? 0) + group.count)
    }
  }

  if (planned.length === 0) return null

  const names = BATCH_ATTRIBUTES.filter((name) =>
    planned.every((entry) => entry.source.geometry.getAttribute(name)),
  )
  if (!names.includes('position')) return null

  let totalVertices = 0
  for (const count of totals.values()) totalVertices += count

  const buffers = new Map<BatchAttribute, Float32Array>(
    names.map((name) => [name, new Float32Array(totalVertices * ATTRIBUTE_ITEM_SIZE[name])]),
  )

  const normalMatrix = new THREE.Matrix3()
  const vector = new THREE.Vector3()
  const runs: WallBatchRun[] = []
  let cursor = 0

  for (const materialIndex of [...totals.keys()].sort((left, right) => left - right)) {
    const runStart = cursor
    const slices: WallBatchSlice[] = []

    for (const entry of planned) {
      const sliceStart = cursor
      normalMatrix.getNormalMatrix(entry.source.matrix)

      for (const group of entry.groups) {
        if (group.materialIndex !== materialIndex) continue
        copyGroup(entry.source, group, names, buffers, cursor, normalMatrix, vector)
        cursor += group.count
      }

      if (cursor > sliceStart) {
        slices.push({ nodeId: entry.source.nodeId, start: sliceStart, count: cursor - sliceStart })
      }
    }

    runs.push({ materialIndex, start: runStart, count: cursor - runStart, slices })
  }

  const geometry = new THREE.BufferGeometry()
  for (const name of names) {
    geometry.setAttribute(
      name,
      new THREE.BufferAttribute(buffers.get(name)!, ATTRIBUTE_ITEM_SIZE[name]),
    )
  }
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()

  const batch: WallBatch = { geometry, runs }
  applyWallBatchGroups(batch, EMPTY_HIDDEN)
  return batch
}

const EMPTY_HIDDEN: ReadonlySet<string> = new Set()

function copyGroup(
  source: WallBatchSource,
  group: PlannedGroup,
  names: readonly BatchAttribute[],
  buffers: Map<BatchAttribute, Float32Array>,
  writeAt: number,
  normalMatrix: THREE.Matrix3,
  vector: THREE.Vector3,
) {
  for (const name of names) {
    const attribute = source.geometry.getAttribute(name)
    const target = buffers.get(name)!
    const itemSize = ATTRIBUTE_ITEM_SIZE[name]

    for (let offset = 0; offset < group.count; offset += 1) {
      const from = group.start + offset
      const to = (writeAt + offset) * itemSize

      if (name === 'position') {
        vector.fromBufferAttribute(attribute, from).applyMatrix4(source.matrix)
        target[to] = vector.x
        target[to + 1] = vector.y
        target[to + 2] = vector.z
      } else if (name === 'normal') {
        vector.fromBufferAttribute(attribute, from).applyMatrix3(normalMatrix).normalize()
        target[to] = vector.x
        target[to + 1] = vector.y
        target[to + 2] = vector.z
      } else {
        target[to] = attribute.getX(from)
        target[to + 1] = attribute.getY(from)
      }
    }
  }
}

/**
 * Rewrites the merged geometry's draw groups so the listed walls are skipped.
 *
 * Pulling a wall out of the batch is what happens while it is being dragged:
 * it goes back to drawing itself, and the merged mesh has to stop drawing it
 * or the two would overlap. Because each wall owns a contiguous slice of each
 * run, skipping it is a matter of splitting that run around the hole — no
 * vertex data moves and nothing is re-uploaded to the GPU, so a drag costs a
 * handful of group objects rather than a rebuild of the floor.
 *
 * Each hidden wall adds at most one extra group (one extra draw call) per run,
 * so callers should re-merge once the holes stop being temporary.
 */
export function applyWallBatchGroups(batch: WallBatch, hidden: ReadonlySet<string>): void {
  batch.geometry.clearGroups()

  for (const run of batch.runs) {
    let cursor = run.start

    if (hidden.size > 0) {
      for (const slice of run.slices) {
        if (!hidden.has(slice.nodeId)) continue
        if (slice.start > cursor) {
          batch.geometry.addGroup(cursor, slice.start - cursor, run.materialIndex)
        }
        cursor = slice.start + slice.count
      }
    }

    const end = run.start + run.count
    if (end > cursor) batch.geometry.addGroup(cursor, end - cursor, run.materialIndex)
  }
}

/**
 * Silences a wall the batch now draws.
 *
 * Emptying the draw range is not enough — three.js still submits a zero-count
 * group, so 1000 muted walls cost 1000 draw calls. `visible = false` would
 * cost nothing but takes the wall's children (cutters, treatments) down with
 * it. Moving the mesh alone off the scene layer skips it in every pass while
 * its subtree keeps rendering and picking.
 */
export function hideBatchedWall(mesh: THREE.Object3D): void {
  hideFromScene(mesh, 'batched')
}

/** Hands a wall back its own draw call — unless solo or isolation still hide it. */
export function revealBatchedWall(mesh: THREE.Object3D): void {
  showInScene(mesh, 'batched')
}
