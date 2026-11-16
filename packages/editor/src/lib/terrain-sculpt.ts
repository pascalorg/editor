// Sculpt-mode helpers that are pure enough to test without a canvas: sizing the
// field to a site, resolving the flatten target, and the commit.
//
// The tool component owns pointer plumbing; everything here is a function of
// data, which is what lets the interesting decisions (grid extent, undo
// granularity, when a stroke is worth persisting) be asserted in unit tests
// instead of e2e.

import {
  type AnyNode,
  type AnyNodeId,
  type BrushSettings,
  DEFAULT_TERRAIN_SPACING,
  fieldExtentForSite,
  type HeightPatch,
  minBrushRadius,
  planTerrainTileChanges,
  pointInPolygon2D,
  quantize,
  runAsSingleSceneHistoryStep,
  type SiteNode,
  sampleTarget,
  type TerrainField,
  type TerrainVerb,
  terrainEditField,
  terrainTilesOf,
  useLiveTerrain,
  useScene,
} from '@pascal-app/core'

// The sizing rule moved to core, where the agent's terrain writes share it; the editor still exports it.
export { fieldExtentForSite }

const MAX_SCULPT_SAMPLES = 1_000_000

function sculptBounds(site: SiteNode) {
  const points = site.polygon.points
  const xs = points.map(([x]) => x)
  const zs = points.map(([, z]) => z)
  return {
    minX: Math.min(...xs) - 4,
    minZ: Math.min(...zs) - 4,
    maxX: Math.max(...xs) + 4,
    maxZ: Math.max(...zs) + 4,
  }
}

/** Refuse the working allocation, not the lot: bounded agent tile edits remain available. */
export function terrainSculptRefusal(site: SiteNode): string | null {
  const bounds = sculptBounds(site)
  const spacing = DEFAULT_TERRAIN_SPACING
  const cols = Math.ceil(bounds.maxX / spacing) - Math.floor(bounds.minX / spacing) + 1
  const rows = Math.ceil(bounds.maxZ / spacing) - Math.floor(bounds.minZ / spacing) + 1
  const samples = cols * rows
  return !Number.isSafeInteger(samples) || samples > MAX_SCULPT_SAMPLES || samples <= 0
    ? 'Brush sculpting would exceed its 1,000,000-sample working budget. Use shape_site_terrain or carve_terrain_pad on smaller areas; the lot can stay this size.'
    : null
}

/** A regular editing lattice with the eight diffusion passes' four-metre halo. */
export function sculptFieldForSite(
  site: SiteNode,
  nodes: Readonly<Record<string, AnyNode>> = useScene.getState().nodes,
): TerrainField {
  const refusal = terrainSculptRefusal(site)
  if (refusal) throw new RangeError(refusal)
  return terrainEditField(site, nodes, sculptBounds(site))
}

/** Whether an XZ point belongs to the editable property footprint. */
export function terrainPointInsideSite(
  site: Pick<SiteNode, 'polygon'>,
  x: number,
  z: number,
): boolean {
  const polygon = site.polygon?.points ?? []
  return polygon.length >= 3 && pointInPolygon2D([x, z], polygon, { includeBoundary: true })
}

/**
 * Keep a rectangular brush patch inside the property footprint.
 *
 * The heightfield stays padded and square for compact storage and predictable
 * partial uploads, but that implementation extent is not editable land. Samples
 * outside the polygon retain their current values even when a brush overlaps the
 * property line.
 */
export function clipTerrainPatchToSite(
  field: TerrainField,
  patch: HeightPatch,
  site: Pick<SiteNode, 'polygon'>,
): HeightPatch {
  let heights: Int16Array | null = null

  for (let row = 0; row < patch.rows; row += 1) {
    for (let col = 0; col < patch.cols; col += 1) {
      const fieldCol = patch.col0 + col
      const fieldRow = patch.row0 + row
      const x = field.origin[0] + fieldCol * field.spacing
      const z = field.origin[1] + fieldRow * field.spacing
      if (terrainPointInsideSite(site, x, z)) continue

      const patchIndex = row * patch.cols + col
      const previous = field.heights[fieldRow * field.cols + fieldCol] ?? 0
      if ((patch.heights[patchIndex] ?? 0) === previous) continue
      heights ??= patch.heights.slice()
      heights[patchIndex] = previous
    }
  }

  return heights ? { ...patch, heights } : patch
}

/**
 * The site node the sculpt tool acts on, read straight from the scene.
 *
 * The tool and panel get this from a subscribed selector; the keyboard handler
 * cannot (it is one imperative listener, not a component), and open-coding
 * "root[0], is it a site?" a third time is how the three drift apart.
 */
export function activeSiteNode(): SiteNode | null {
  const { nodes, rootNodeIds } = useScene.getState()
  const root = rootNodeIds[0]
  const node = root ? nodes[root] : undefined
  return node?.type === 'site' ? (node as SiteNode) : null
}

/**
 * Largest brush radius offered, in metres.
 *
 * A taste call, unlike the minimum: 20 m covers a building pad in one pass and is
 * about where a bigger brush stops being aimable and starts being `flattenSite`.
 */
export const MAX_BRUSH_RADIUS = 20

/** The controls and keyboard share the fixed tile lattice's brush floor. */
export function brushRadiusRange(site: SiteNode | null | undefined): [number, number] {
  void site
  const min = minBrushRadius({ spacing: DEFAULT_TERRAIN_SPACING })
  return [min, Math.max(min, MAX_BRUSH_RADIUS)]
}

/** `radius` clamped into `brushRadiusRange(site)`. */
export function clampBrushRadius(site: SiteNode | null | undefined, radius: number): number {
  const [min, max] = brushRadiusRange(site)
  return Math.min(max, Math.max(min, radius))
}

/**
 * The absolute height a `flatten` stroke aims at.
 *
 * `null` target means the user never picked one, so the first click samples the
 * ground under the cursor — flatten stays usable without ever opening a number
 * field, and "flatten this pad to match that corner" is a two-step gesture.
 */
export function resolveFlattenTarget(
  field: TerrainField,
  explicitTarget: number | null,
  x: number,
  z: number,
): number {
  return explicitTarget ?? sampleTarget(field, x, z)
}

export type SculptCommit = {
  verb: TerrainVerb
  settings: BrushSettings
}

/**
 * Drop any stroke in flight on `site` before a write that replaces the whole field.
 *
 * Every reader prefers the live stroke over the persisted terrain (that is what
 * makes a drag consistent), so a lot-wide write landing *under* a live stroke is
 * invisible: the ground keeps showing the stroke, and the stroke's own commit —
 * computed from a snapshot taken before the write — then overwrites it. The user
 * sees a button that did nothing, with no error and nothing in history to undo.
 *
 * Reachable because the brush and these controls are usable at the same moment.
 * On touch it takes no timing at all: one finger holds a stroke while the other
 * taps the panel. With a mouse a stroke stays live across a wheel zoom's 500 ms
 * `cameraDragging` window, and a held pointer that leaves the canvas keeps its
 * capture until release.
 *
 * Abandoning rather than committing first: the pending dabs are the thing the
 * user is replacing, so keeping them would mean "level the lot, except where I
 * happened to be mid-drag". Ending the live stroke without committing reverts it
 * exactly, the same as Escape.
 */
function abandonLiveStroke(site: Pick<SiteNode, 'id'>): void {
  useLiveTerrain.getState().end(site.id)
}

/**
 * Flatten the whole site to one height in a single step.
 *
 * The brush cannot cover a whole lot reliably; context outside the lot stays unchanged.
 */
export function flattenSite(site: SiteNode, metres: number): void {
  abandonLiveStroke(site)
  const field = sculptFieldForSite(site)
  const value = quantize(field, metres)
  const heights = field.heights.slice()
  for (let row = 0; row < field.rows; row++)
    for (let col = 0; col < field.cols; col++)
      if (
        terrainPointInsideSite(
          site,
          field.origin[0] + col * field.spacing,
          field.origin[1] + row * field.spacing,
        )
      )
        heights[row * field.cols + col] = value
  commitStroke(site.id, { ...field, heights }, field)
}

/**
 * Clear the authored overlays, revealing the unchanged legacy ground (or datum).
 */
export function resetSiteTerrain(site: SiteNode): void {
  abandonLiveStroke(site)
  const tiles = terrainTilesOf(site, useScene.getState().nodes)
  if (!tiles.length) return
  runAsSingleSceneHistoryStep(useScene, () => {
    useScene.getState().applyNodeChanges({ delete: tiles.map((tile) => tile.id) })
  })
}

/**
 * Persist a finished stroke as exactly one undo step.
 *
 * `runAsSingleSceneHistoryStep` collapses the write, which matters because a
 * stroke is one user action even though it produced dozens of dabs — without it,
 * undo would walk back through the stroke dab by dab, which is both surprising
 * and unbounded in length.
 *
 * Only changed samples become tile writes, including duplicate seam samples.
 */
export function commitStroke(
  siteId: SiteNode['id'],
  field: TerrainField,
  snapshot?: TerrainField,
): void {
  const { nodes } = useScene.getState()
  const site = nodes[siteId]
  if (site?.type !== 'site') return
  const before =
    snapshot ??
    terrainEditField(site, nodes, {
      minX: field.origin[0],
      minZ: field.origin[1],
      maxX: field.origin[0] + (field.cols - 1) * field.spacing,
      maxZ: field.origin[1] + (field.rows - 1) * field.spacing,
    })
  const changes = planTerrainTileChanges(site, nodes, before, field)
  if (!changes.create?.length && !changes.update?.length) return
  runAsSingleSceneHistoryStep(useScene, () => {
    useScene.getState().applyNodeChanges({
      create: changes.create?.map(({ node, parentId }) => ({
        node,
        parentId: parentId as AnyNodeId | undefined,
      })),
      update: changes.update?.map(({ id, data }) => ({ id: id as AnyNodeId, data })),
    })
  })
}

/**
 * The pointer-up path: persist the stroke only if it is still the live one.
 *
 * The sculpt tool holds the in-flight field in a ref from pointer-down to
 * pointer-up, and a terrain write landing inside that window (a tool shaping
 * the ground, `flattenSite`, `resetSiteTerrain`) ends the live stroke and
 * persists its own field. Ending the store entry alone cannot stop the ref:
 * an unguarded `commitStroke` on pointer-up would write the pre-write
 * snapshot over the newer write and add a second, phantom undo step. So the
 * commit is gated on stroke identity — a stroke that was ended or superseded
 * since pointer-down is dropped, exactly as if it had been abandoned.
 *
 * Returns whether the stroke committed. On success the commit lands before
 * the live stroke ends, so readers never see a frame of pre-stroke ground.
 */
export function commitLiveStroke(
  siteId: SiteNode['id'],
  strokeId: number,
  field: TerrainField,
): boolean {
  const stroke = useLiveTerrain.getState().strokeOf(siteId)
  if (stroke?.id !== strokeId) return false
  try {
    commitStroke(siteId, field, stroke.snapshot)
    return true
  } finally {
    useLiveTerrain.getState().end(siteId)
  }
}
