import { applySceneChanges, mergeSceneChanges } from '../agent-operations/apply-changes'
import type { SceneChanges, SceneNodes } from '../agent-operations/types'
import { refuse } from '../agent-tools/refusal'
import type { RampNode, SiteNode } from '../schema'
import { polygonsOverlap } from './polygon-relations'
import {
  rampBounds,
  rampHeightAt,
  rampLength,
  rampOffsetPoint,
  rampProjectPoint,
  rampStations,
} from './ramp'
import {
  applyHeightPatch,
  createTerrainField,
  heightAt,
  quantize,
  sampleRangeOver,
  storedHeightAt,
  type TerrainField,
} from './terrain-field'
import { persistedTerrainFieldOf } from './terrain-source-persisted'
import { planTerrainTileChanges } from './terrain-tile-changes'
import { terrainEditField } from './terrain-tile-write'

const GROUND_FIELDS = [
  'parentId',
  'start',
  'segments',
  'width',
  'startHeight',
  'endHeight',
  'thickness',
  'startTransition',
  'endTransition',
  'terrainMode',
  'retainingHeight',
] as const satisfies readonly (keyof RampNode)[]

export function rampGroundInputsChanged(before: RampNode, after: RampNode): boolean {
  return GROUND_FIELDS.some((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
}

function siteOf(ramp: RampNode, nodes: SceneNodes): SiteNode {
  const site = ramp.parentId ? nodes[ramp.parentId] : undefined
  if (site?.type !== 'site') refuse('no_site', 'A ramp must be owned by a Site.')
  return site
}

function corridor(ramp: RampNode) {
  const stations = rampStations(ramp, Math.max(0.5, rampLength(ramp) / 500))
  const half = ramp.width / 2 + (ramp.retainingHeight > 0 ? 0.2 : 0)
  return [
    ...stations.map((station) => rampOffsetPoint(station, half)),
    ...[...stations].reverse().map((station) => rampOffsetPoint(station, -half)),
  ]
}

function requireSeparated(ramp: RampNode, nodes: SceneNodes): void {
  const otherRamps = Object.values(nodes).filter(
    (node): node is RampNode =>
      node.type === 'ramp' && node.id !== ramp.id && node.parentId === ramp.parentId,
  )
  if (otherRamps.length > 128)
    refuse(
      'ramp_sampling_limit',
      'At most 128 existing ramp corridors can be compared in one edit.',
    )
  const bounds = rampBounds(ramp, true)
  let outline: ReturnType<typeof corridor> | undefined
  let visits = 0
  for (const other of otherRamps) {
    const box = rampBounds(other, true)
    if (
      bounds.maxX < box.minX ||
      bounds.minX > box.maxX ||
      bounds.maxZ < box.minZ ||
      bounds.minZ > box.maxZ
    )
      continue
    outline ??= corridor(ramp)
    const otherOutline = corridor(other)
    visits += outline.length * otherOutline.length
    if (visits > 2_000_000)
      refuse('ramp_sampling_limit', 'Comparing ramp corridors exceeds two million edge pairs.')
    if (polygonsOverlap(outline, otherOutline))
      refuse('ramp_self_intersection', 'The proposed ramp corridor intersects an existing ramp.', {
        rampId: other.id,
      })
  }
}

function fieldOf(site: SiteNode, nodes: SceneNodes, ramp: RampNode): TerrainField {
  const bounds = rampBounds(ramp)
  const count =
    (Math.ceil((bounds.maxX - bounds.minX) / 0.5) + 4) *
    (Math.ceil((bounds.maxZ - bounds.minZ) / 0.5) + 4)
  if (!Number.isFinite(count) || count * ramp.segments.length > 2_000_000)
    refuse('ramp_sampling_limit', 'Ramp grading exceeds two million segment projections.')
  const field = terrainEditField(site, nodes, {
    minX: bounds.minX - 0.5,
    minZ: bounds.minZ - 0.5,
    maxX: bounds.maxX + 0.5,
    maxZ: bounds.maxZ + 0.5,
  })
  if (
    !field ||
    ![
      ...field.origin,
      field.spacing,
      field.step,
      field.origin[0] + (field.cols - 1) * field.spacing,
      field.origin[1] + (field.rows - 1) * field.spacing,
    ].every(Number.isFinite) ||
    field.spacing <= 0 ||
    field.step <= 0 ||
    !field.heights.every((height) => Number.isFinite(height * field.step))
  )
    refuse('no_terrain', 'The Site terrain cannot be read as finite heights.')
  return field
}

function patchUnder(ramp: RampNode, field: TerrainField) {
  const bounds = rampBounds(ramp)
  const maxX = field.origin[0] + (field.cols - 1) * field.spacing
  const maxZ = field.origin[1] + (field.rows - 1) * field.spacing
  if (
    bounds.minX < field.origin[0] - 1e-8 ||
    bounds.minZ < field.origin[1] - 1e-8 ||
    bounds.maxX > maxX + 1e-8 ||
    bounds.maxZ > maxZ + 1e-8
  )
    refuse('outside_terrain', 'The ramp corridor extends outside the Site terrain field.')
  const range = sampleRangeOver(field, bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ)
  if (!range) refuse('outside_terrain', 'The ramp corridor misses the Site terrain field.')
  const cols = range.col1 - range.col0 + 1,
    rows = range.row1 - range.row0 + 1
  if (cols * rows * ramp.segments.length > 2_000_000)
    refuse(
      'ramp_sampling_limit',
      'Ramp terrain grading exceeds two million segment projections; simplify the alignment.',
    )
  const heights = new Int16Array(cols * rows)
  const samples: NonNullable<RampNode['terrainEffect']>['samples'] = []
  let changed = false
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      const source = (range.row0 + row) * field.cols + range.col0 + col
      const index = row * cols + col
      heights[index] = field.heights[source] ?? 0
      const x = field.origin[0] + (range.col0 + col) * field.spacing
      const z = field.origin[1] + (range.row0 + row) * field.spacing
      const projected = rampProjectPoint(ramp, [x, z])
      if (!projected.inside) continue
      const height = rampHeightAt(ramp, projected.distance) - ramp.thickness
      const units = height / field.step
      if (!Number.isFinite(units) || units < -32768 || units > 32767)
        refuse(
          'ramp_terrain_range',
          'The ramp underside exceeds the terrain height quantization range.',
        )
      const value = quantize(field, height)
      if (heights[index] !== value) samples.push([source, heights[index] ?? 0, value])
      changed ||= heights[index] !== value
      heights[index] = value
    }
  return { patch: { col0: range.col0, row0: range.row0, cols, rows, heights }, changed, samples }
}

function gradeTerrain(ramp: RampNode, nodes: SceneNodes) {
  rampLength(ramp)
  const site = siteOf(ramp, nodes)
  requireSeparated(ramp, nodes)
  if (ramp.terrainMode === 'none') return { changes: {} as SceneChanges, effect: undefined }
  const field = fieldOf(site, nodes, ramp)
  const { patch, changed, samples } = patchUnder(ramp, field)
  const effect: NonNullable<RampNode['terrainEffect']> = {
    siteId: site.id,
    origin: [...field.origin],
    spacing: field.spacing,
    cols: field.cols,
    rows: field.rows,
    step: field.step,
    samples,
  }
  const changes = changed
    ? planTerrainTileChanges(site, nodes, field, applyHeightPatch(field, patch))
    : {}
  return { changes, effect }
}

/** Terrain-only planning; creation and edit planners also retain the ramp's owned samples. */
export function planRampTerrain(ramp: RampNode, nodes: SceneNodes): SceneChanges {
  const { changes } = gradeTerrain(ramp, nodes)
  requireRampChangeBudget(changes, nodes)
  return changes
}

function withEffect(ramp: RampNode, effect: RampNode['terrainEffect']): RampNode {
  const owned = { ...ramp }
  if (effect) owned.terrainEffect = effect
  else delete owned.terrainEffect
  return owned
}

/** Reconstruct a receipt's grid without rebasing or rewriting the frozen legacy field. */
function receiptFields(
  effect: NonNullable<RampNode['terrainEffect']>,
  site: SiteNode,
  nodes: SceneNodes,
) {
  if (effect.cols * effect.rows > 2_000_000)
    refuse('ramp_sampling_limit', 'The ramp receipt exceeds two million terrain samples.')
  const authority = persistedTerrainFieldOf(site, nodes)
  const field = createTerrainField(effect)
  for (let row = 0; row < field.rows; row++)
    for (let col = 0; col < field.cols; col++)
      field.heights[row * field.cols + col] = authority
        ? quantize(
            field,
            storedHeightAt(
              authority,
              field.origin[0] + col * field.spacing,
              field.origin[1] + row * field.spacing,
            ),
          )
        : 0
  const before = { ...field, heights: field.heights.slice() }
  const after = { ...field, heights: field.heights.slice() }
  for (const [index, previous, applied] of effect.samples) {
    if (index >= field.heights.length)
      refuse(
        'ramp_terrain_grid_changed',
        'A ramp terrain receipt contains an invalid sample index.',
      )
    before.heights[index] = previous
    after.heights[index] = applied
  }
  return { before, after }
}

/** Restore only ground still equal to the receipt, including receipts tied to a legacy grid. */
export function planRampGroundRelease(ramp: RampNode, nodes: SceneNodes): SceneChanges {
  const effect = ramp.terrainEffect
  if (!effect?.samples.length) return {}
  const site = nodes[effect.siteId]
  if (site?.type !== 'site') return {}
  const receipt = receiptFields(effect, site, nodes)
  const field = terrainEditField(site, nodes, {
    minX: effect.origin[0],
    minZ: effect.origin[1],
    maxX: effect.origin[0] + (effect.cols - 1) * effect.spacing,
    maxZ: effect.origin[1] + (effect.rows - 1) * effect.spacing,
  })
  const heights = new Int16Array(field.heights)
  for (let row = 0; row < field.rows; row++)
    for (let col = 0; col < field.cols; col++) {
      const index = row * field.cols + col
      const x = field.origin[0] + col * field.spacing
      const z = field.origin[1] + row * field.spacing
      const previous = quantize(field, heightAt(receipt.before, x, z))
      const applied = quantize(field, heightAt(receipt.after, x, z))
      if (previous !== applied && heights[index] === applied) heights[index] = previous
    }
  const changes = planTerrainTileChanges(site, nodes, field, { ...field, heights })
  requireRampChangeBudget(changes, nodes)
  return changes
}

export function planRampCreation(ramp: RampNode, nodes: SceneNodes): SceneChanges {
  const { changes: terrain, effect } = gradeTerrain(ramp, nodes)
  const changes: SceneChanges = {
    ...terrain,
    create: [
      ...(terrain.create ?? []),
      { node: withEffect(ramp, effect), parentId: ramp.parentId ?? undefined },
    ],
  }
  requireRampChangeBudget(changes, nodes)
  return changes
}

/** All surfaces apply the profile, released ground and new cut/fill in the same undo step. */
export function planRampEdit(ramp: RampNode, nodes: SceneNodes): SceneChanges {
  const previous = nodes[ramp.id]
  if (previous?.type !== 'ramp') refuse('ramp_not_found', 'The ramp to edit is not in the scene.')
  rampLength(ramp)
  if (!rampGroundInputsChanged(previous, ramp)) {
    const next = withEffect(ramp, previous.terrainEffect)
    const data = Object.fromEntries(
      [...new Set([...Object.keys(previous), ...Object.keys(next)])]
        .filter(
          (key) =>
            JSON.stringify(previous[key as keyof RampNode]) !==
            JSON.stringify(next[key as keyof RampNode]),
        )
        .map((key) => [key, next[key as keyof RampNode]]),
    )
    const changes = Object.keys(data).length ? { update: [{ id: ramp.id, data }] } : {}
    requireRampChangeBudget(changes, nodes)
    return changes
  }
  const released = planRampGroundRelease(previous, nodes)
  const { changes: terrain, effect } = gradeTerrain(ramp, applySceneChanges(nodes, released))
  const changes = mergeSceneChanges([
    released,
    terrain,
    { update: [{ id: ramp.id, data: { ...withEffect(ramp, effect), terrainEffect: effect } }] },
  ])
  requireRampChangeBudget(changes, nodes)
  return changes
}

/** Each node must fit; the shared authority splits a multi-node edit into operations. */
export function requireRampChangeBudget(changes: SceneChanges, nodes: SceneNodes): void {
  const updates = changes.update?.map(({ id, data }) => ({
    id,
    data,
    from: Object.fromEntries(
      Object.keys(data).map((key) => [
        key,
        (nodes[id] as unknown as Record<string, unknown> | undefined)?.[key] ?? null,
      ]),
    ),
  }))
  const deletes = changes.delete?.map((id) => ({ id, from: nodes[id] }))
  const limitBytes = 62 * 1024
  for (const mutation of [...(updates ?? []), ...(changes.create ?? []), ...(deletes ?? [])]) {
    const bytes = new TextEncoder().encode(JSON.stringify(mutation)).byteLength
    if (bytes > limitBytes)
      refuse(
        'terrain_write_too_large',
        'A ramp or terrain node exceeds the shared scene operation size; nothing was written.',
        { bytes, limitBytes },
      )
  }
}
