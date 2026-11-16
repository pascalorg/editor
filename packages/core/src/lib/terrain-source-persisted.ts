/**
 * Scene → `TerrainField`, cached.
 *
 * Every consumer that needs the ground — the mesh builder, the raycast, the
 * placement predicate, the collider, the 2D view — starts here. It exists to
 * solve one problem: the scene stores terrain as base64 (`site.terrain`), and
 * decoding that per frame, or per pointer-move, would be absurd.
 *
 * The cache is a `WeakMap` keyed on the **`TerrainData` object identity**, which
 * is a correct version key because the scene store is immutable-by-convention:
 * `updateNode` produces a new node object with a new `terrain` object, so a
 * changed terrain necessarily misses the cache and a stale entry is unreachable.
 * No invalidation call, no version counter, nothing to forget to bump.
 *
 * `commitTerrainField` closes the loop: it encodes a field *and* primes the cache
 * with the field it just encoded. The virtual authority can reuse that decoded
 * base without decoding it again.
 */

import type { RampNode } from '../schema/nodes/ramp'
import type { SiteNode } from '../schema/nodes/site'
import type { TerrainBreakNode } from '../schema/nodes/terrain-break'
import type { TerrainTileNode } from '../schema/nodes/terrain-tile'
import type { TerrainData } from '../schema/terrain'
import { terrainAuthorityField } from './terrain-authority'
import { terrainBreaksOf } from './terrain-breaks'
import { decodeTerrainField, encodeTerrainField } from './terrain-codec'
import { createTerrainField, type TerrainField } from './terrain-field'
import { rampsGradingOf } from './terrain-ramp-cut'
import { type TerrainNodes, type TerrainSite, terrainTilesOf } from './terrain-tiles'

const fieldCache = new WeakMap<TerrainData, TerrainField>()

/**
 * Sites whose `terrain` failed to decode. Prevents re-attempting a doomed decode
 * on every frame — the corrupt-scene path must be cheap, not just survivable.
 */
const failedDecodes = new WeakSet<TerrainData>()

function legacyFieldOf(data: TerrainData | undefined): TerrainField | null {
  if (!data) return null
  const cached = fieldCache.get(data)
  if (cached) return cached
  if (failedDecodes.has(data)) return null

  const field = decodeTerrainField(data)
  if (!field) {
    failedDecodes.add(data)
    return null
  }
  fieldCache.set(data, field)
  return field
}

const emptyNodes: TerrainNodes = {}
const authorityCache = new WeakMap<object, WeakMap<object, TerrainField | null>>()

type AuthorityInputs = {
  polygon: TerrainSite['polygon']
  points: string
  terrain: TerrainData | undefined
  tiles: TerrainTileNode[]
  breaks: TerrainBreakNode[]
  ramps: RampNode[]
  field: TerrainField | null
}
/** The last authority built for a site id: one entry per site, a handful at most. */
const authorityByInputs = new Map<string, AuthorityInputs>()
const AUTHORITY_ENTRIES = 16

const pointsOf = (site: TerrainSite) => JSON.stringify(site.polygon?.points ?? [])

/**
 * The authority is a function of the lot's outline, the legacy field and the tiles, breaks and
 * graded ramps, and of nothing else about the site node: a child added under the site, or a
 * rename, replaces the site object and must not replace the field every mesh, raycast and cache is
 * keyed on.
 */
function reusableAuthority(
  site: TerrainSite,
  tiles: TerrainTileNode[],
  breaks: TerrainBreakNode[],
  ramps: RampNode[],
): AuthorityInputs | undefined {
  if (!site.id) return undefined
  const previous = authorityByInputs.get(site.id)
  if (
    previous &&
    previous.terrain === site.terrain &&
    breaks.length === previous.breaks.length &&
    breaks.every((boundary, index) => boundary === previous.breaks[index]) &&
    tiles.length === previous.tiles.length &&
    tiles.every((tile, index) => tile === previous.tiles[index]) &&
    ramps.length === previous.ramps.length &&
    ramps.every((ramp, index) => ramp === previous.ramps[index]) &&
    (previous.polygon === site.polygon || previous.points === pointsOf(site))
  )
    return previous
  return undefined
}

export function persistedTerrainFieldOf(
  site: TerrainSite | null | undefined,
  nodes?: TerrainNodes,
): TerrainField | null {
  if (!site) return null
  const version = nodes ?? emptyNodes
  let fields = authorityCache.get(version)
  if (!fields) {
    fields = new WeakMap()
    authorityCache.set(version, fields)
  }
  const key = !site.polygon && !nodes && site.terrain ? site.terrain : site
  if (fields.has(key)) return fields.get(key) ?? null
  const tiles = terrainTilesOf(site, nodes)
  const breaks = terrainBreaksOf(site, nodes)
  const ramps = rampsGradingOf(site, nodes)
  const reusable = reusableAuthority(site, tiles, breaks, ramps)
  if (reusable) {
    fields.set(key, reusable.field)
    return reusable.field
  }
  const base = legacyFieldOf(site.terrain)
  const field =
    site.terrain && !base && breaks.length ? null : terrainAuthorityField(site, base, nodes)
  fields.set(key, field)
  if (site.id) {
    authorityByInputs.delete(site.id)
    authorityByInputs.set(site.id, {
      polygon: site.polygon,
      points: pointsOf(site),
      terrain: site.terrain,
      tiles,
      breaks,
      ramps,
      field,
    })
    if (authorityByInputs.size > AUTHORITY_ENTRIES)
      authorityByInputs.delete(authorityByInputs.keys().next().value as string)
  }
  return field
}

/**
 * The field a site *would* sculpt into: its existing terrain, or a fresh flat
 * field sized to `options`.
 *
 * Separate from `terrainFieldOf` because the read path wants `null` for "no
 * terrain" and the write path wants something to write into. Collapsing them
 * would force every reader to allocate a field it does not need.
 */
export function terrainFieldForEdit(
  site: Pick<SiteNode, 'terrain'> | null | undefined,
  options?: Parameters<typeof createTerrainField>[0],
): TerrainField {
  return legacyFieldOf(site?.terrain) ?? createTerrainField(options)
}

/**
 * Encode a field for persistence and prime the read cache with it.
 *
 * Call this instead of `encodeTerrainField` whenever the result is going into the
 * scene. The returned data is what to write to `site.terrain`; the cache priming
 * means the next virtual read reuses this base without decoding.
 */
export function commitTerrainField(field: TerrainField): TerrainData {
  const data = encodeTerrainField(field)
  fieldCache.set(data, field)
  return data
}
