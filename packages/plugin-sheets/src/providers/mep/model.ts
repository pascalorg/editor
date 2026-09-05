/**
 * The Bones bridge for the MEP sheets.
 *
 * E1.0 and P1.0 are not stored drawings — they are a READING of the scene.
 * Every device, circuit, pipe and panel row on them comes from
 * `computeLevel` (packages/plugin-bones/src/framing/compute.ts) run over the
 * level's own walls, openings and zones, so moving a wall or a door moves the
 * receptacles on the paper the next time the sheet paints.
 *
 * Two things this module owns beyond calling the engine:
 *
 * 1. SERVICE-POINT SYNC. The scene's site utilities carry a `service-point`
 *    node (plugin-utilities, `serviceKind: 'electric-meter'`) — the spot the
 *    overhead drop lands on, drawn on the site plan and in 3D. Bones takes its
 *    meter location from a `bones:service` node instead. Rather than create a
 *    node (this workstream writes no scene state), the utilities anchor is
 *    mirrored into a SYNTHETIC `bones:service` record in a throwaway copy of
 *    the node map, shaped exactly as `extractExtraServiceOverrides` reads it
 *    (compute.ts). The engine then treats the site's spot as authoritative and
 *    the meter, the panel beside it, the site plan and the 3D model agree.
 *    A REAL `bones:service` electric-meter node on the level always wins — it
 *    is the user's own explicit override and the synthetic one stands down.
 *
 * 2. MEMOISATION. `computeLevel` memoises on (config object identity, nodes
 *    identity); a synthesized node map is a new object every call, so its memo
 *    can never hit. This module keeps its own cache keyed by the SCENE's node
 *    map (a new object on every scene edit — Pascal's stores hand out
 *    immutable snapshots), so the electrical and plumbing viewports of one
 *    render share a single engine run and an untouched scene never recomputes.
 */
import type { AnyNodeLike, NodeMap } from '../../model'
import type { Fixture, Member, WallSlice } from '../../../../plugin-bones/src/core/types'
import { computeLevel } from '../../../../plugin-bones/src/framing/compute'
import { FramingNode } from '../../../../plugin-bones/src/framing/schema'

export type ServiceSync = {
  /** The utilities node the meter anchor came from. */
  sourceId: string
  wallId: string
  wallT: number
  heightAff: number
  /** False when a real `bones:service` node already owned the spot. */
  synthesized: boolean
  /** Where the panel was pinned, and what pinned it. */
  panel: { wallId: string; wallT: number; from: 'item' | 'beside-meter' } | null
}

/** Panel enclosure centre height above the floor — Bones' own PANEL_AFF. */
const PANEL_AFF = 1.524
/** How far along the wall the panel stands from the meter when nothing else
 * pins it. Bones uses the same 0.6 m offset the other way round in
 * `placeElectricMeterSpot` (METER_PANEL_OFFSET) — the service conductors stay
 * short and the two enclosures keep their own working space. */
const PANEL_BESIDE_METER = 0.6

export type MepModel = {
  levelId: string
  fixtures: Fixture[]
  members: Member[]
  walls: WallSlice[]
  /** Engine warnings — printed on the sheet, never swallowed. */
  warnings: string[]
  /** Resolved code jurisdiction ('FL', 'INTL', …) — the notes cite it. */
  jurisdiction: string
  /** How the meter got its spot, for the sheet's own honesty line. */
  serviceSync: ServiceSync | null
}

/** The synthetic `bones:service` record ids — never written to the scene. */
export const SYNTHETIC_METER_ID = 'bonessvc_sheets_electric_meter_sync'
export const SYNTHETIC_PANEL_ID = 'bonessvc_sheets_panel_sync'

/** One synthetic `bones:service` record, in the shape compute.ts reads. */
function serviceRecord(
  id: string,
  levelId: string,
  serviceType: string,
  wallId: string,
  wallT: number,
  heightAff: number,
): AnyNodeLike {
  return {
    id,
    type: 'bones:service',
    parentId: levelId,
    visible: true,
    serviceType,
    wallId,
    wallT,
    heightAff,
    position: [0, 0, 0],
  }
}

function levelOf(nodes: NodeMap, levelId: string): AnyNodeLike | undefined {
  const node = nodes[levelId]
  return node?.type === 'level' ? node : undefined
}

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/**
 * The site utilities' electric-meter service point for this level: a
 * `service-point` node whose `wallId` names a wall ON the level (the anchor
 * is what makes it level-local — the node itself hangs off the building, and
 * its free-standing `position` is in SITE metres, which is a different frame
 * and is therefore NOT mirrored).
 */
export function utilitiesMeterAnchor(
  nodes: NodeMap,
  levelId: string,
): { sourceId: string; wallId: string; wallT: number; heightAff: number } | null {
  const candidates = Object.values(nodes)
    .filter(
      (n) =>
        n?.type === 'service-point' &&
        n.visible !== false &&
        String(n.serviceKind ?? '') === 'electric-meter',
    )
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
  for (const node of candidates) {
    const wallId = typeof node.wallId === 'string' ? node.wallId : ''
    if (!wallId) continue
    const wall = nodes[wallId]
    if (wall?.type !== 'wall' || wall.parentId !== levelId) continue
    const wallT = num(node.wallT)
    if (wallT === null) continue
    return {
      sourceId: String(node.id ?? ''),
      wallId,
      wallT: Math.max(0, Math.min(1, wallT)),
      heightAff: num(node.height) ?? 1.5,
    }
  }
  return null
}

/** A real `bones:service` node of `serviceType` already on this level. */
function hasBonesServiceNode(nodes: NodeMap, levelId: string, serviceType: string): boolean {
  return Object.values(nodes).some(
    (n) =>
      n?.type === 'bones:service' &&
      n.parentId === levelId &&
      n.visible !== false &&
      String(n.serviceType ?? '') === serviceType,
  )
}

/**
 * Where the PANEL belongs, so the sheet, the site plan and the model agree.
 *
 * Bones auto-places the panel on the longest garage or exterior wall, which
 * on a garage-less cottage puts it clean across the house from the meter the
 * service point pinned — a service chain no electrician would run. Two things
 * outrank the auto-placement, in order:
 *
 *  1. A PLACED PANEL. An `electric-panel` item hung on a wall of this level is
 *     the user pointing at the spot; its `wallT` is read straight off the
 *     wall-local position the host stores.
 *  2. THE METER. Otherwise the panel stands beside the meter on the meter's
 *     own wall, inside, the way a meter-main pair is actually built.
 */
function panelAnchor(
  nodes: NodeMap,
  levelId: string,
  meter: { wallId: string; wallT: number } | null,
): { wallId: string; wallT: number; heightAff: number; from: 'item' | 'beside-meter' } | null {
  const placed = Object.values(nodes)
    .filter((n) => {
      if (n?.type !== 'item' || n.visible === false) return false
      const asset = (n.asset ?? {}) as { id?: string }
      if (String(asset.id ?? '') !== 'electric-panel') return false
      const wall = typeof n.parentId === 'string' ? nodes[n.parentId] : undefined
      return wall?.type === 'wall' && wall.parentId === levelId
    })
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0]
  if (placed) {
    const wall = nodes[String(placed.parentId)]
    const length = wallLength(wall)
    const position = Array.isArray(placed.position) ? (placed.position as number[]) : null
    const u = position && typeof position[0] === 'number' ? position[0] : null
    if (length > 0.1 && u !== null && Number.isFinite(u)) {
      const pos = Array.isArray(placed.position) ? (placed.position as number[]) : []
      const height = typeof pos[1] === 'number' && Number.isFinite(pos[1]) ? pos[1] : PANEL_AFF
      return {
        wallId: String(placed.parentId),
        wallT: Math.max(0, Math.min(1, u / length)),
        heightAff: height,
        from: 'item',
      }
    }
  }
  if (!meter) return null
  const wall = nodes[meter.wallId]
  const length = wallLength(wall)
  if (length <= 0.1) return null
  const u = meter.wallT * length
  const beside = u + PANEL_BESIDE_METER <= length - 0.2 ? u + PANEL_BESIDE_METER : u - PANEL_BESIDE_METER
  return {
    wallId: meter.wallId,
    wallT: Math.max(0, Math.min(1, beside / length)),
    heightAff: PANEL_AFF,
    from: 'beside-meter',
  }
}

function wallLength(wall: AnyNodeLike | undefined): number {
  if (wall?.type !== 'wall') return 0
  const start = wall.start
  const end = wall.end
  if (!Array.isArray(start) || !Array.isArray(end)) return 0
  return Math.hypot(Number(end[0]) - Number(start[0]), Number(end[1]) - Number(start[1]))
}

/**
 * The level's own `bones:framing` X-ray node when it has one — so the sheet
 * derives from the SAME config the 3D view does (jurisdiction, per-wall
 * construction, detail). The object identity is preserved when nothing has to
 * change, which keeps `computeLevel`'s own memo warm.
 */
function configFor(nodes: NodeMap, levelId: string): FramingNode {
  const existing = Object.values(nodes).find(
    (n) => n?.type === 'bones:framing' && n.parentId === levelId,
  )
  if (existing) {
    const node = existing as unknown as FramingNode
    if (node.showElectrical !== false && node.showPlumbing !== false) return node
    return { ...node, showElectrical: true, showPlumbing: true }
  }
  // No X-ray node: the jurisdiction comes from the site address, exactly as
  // the structural sheets resolve it, so E1.0 and S1.0 cite the same state.
  return FramingNode.parse({
    id: `bonesframing_sheets_${levelId}`,
    type: 'bones:framing',
    parentId: levelId,
    showElectrical: true,
    showPlumbing: true,
    jurisdiction: siteState(nodes) ?? 'AUTO',
  })
}

/** The two-letter state on the site record, when there is one. */
function siteState(nodes: NodeMap): string | null {
  const site = Object.values(nodes).find((n) => n?.type === 'site')
  const address = site?.address as { state?: unknown } | undefined
  const parcel = site?.parcel as { state?: unknown } | undefined
  const raw = (address?.state ?? parcel?.state) as unknown
  if (typeof raw !== 'string') return null
  const code = raw.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(code) ? code : null
}

/**
 * `computeLevel` runs every Bones system, so its warning list carries the
 * framing, bracing and foundation engines' lines too. Those print on the
 * S-sheets, which are drawn from the same run; on E1.0 / P1.0 they are noise
 * about another discipline.
 */
const STRUCTURAL_WARNING =
  /R602\.10|braced wall|hold-down|slab-on-grade|\bfooting|\bfoundation\b|\brafter|\bjoist|sheathing|Framing derived/i

type CacheEntry = Map<string, MepModel>
const cache = new WeakMap<object, CacheEntry>()

/**
 * Derive the level's MEP model. Returns null when the level does not exist.
 * Never throws: an engine failure surfaces as a warning on an empty model so
 * the sheet prints the reason instead of a blank box.
 */
export function mepModel(nodes: NodeMap, levelId: string | undefined): MepModel | null {
  if (!levelId || !levelOf(nodes, levelId)) return null
  const anchor = utilitiesMeterAnchor(nodes, levelId)
  const meterOwnedByBones = hasBonesServiceNode(nodes, levelId, 'electric-meter')
  const panelOwnedByBones = hasBonesServiceNode(nodes, levelId, 'panel')
  const panel = panelOwnedByBones ? null : panelAnchor(nodes, levelId, anchor)
  const key = [
    levelId,
    anchor
      ? `${anchor.wallId}@${anchor.wallT.toFixed(6)}@${anchor.heightAff.toFixed(4)}`
      : '-',
    meterOwnedByBones ? 'b' : 's',
    panel ? `${panel.wallId}@${panel.wallT.toFixed(6)}@${panel.from}` : '-',
  ].join('|')

  let entries = cache.get(nodes as object)
  if (!entries) {
    entries = new Map()
    cache.set(nodes as object, entries)
  }
  const hit = entries.get(key)
  if (hit) return hit

  const serviceSync: ServiceSync | null = anchor
    ? {
        ...anchor,
        synthesized: !meterOwnedByBones,
        panel: panel ? { wallId: panel.wallId, wallT: panel.wallT, from: panel.from } : null,
      }
    : null

  // The throwaway node map: the scene's own nodes plus the mirrored anchors.
  // Each entry is shaped exactly as compute.ts reads a `bones:service` node
  // (`extractServiceOverrides` for the panel, `extractExtraServiceOverrides`
  // for the meter) — type, parentId, visible, serviceType, wallId, wallT,
  // heightAff, and the [0,0,0] "the wall anchor is authoritative" position.
  const synthetic: NodeMap = {}
  if (anchor && !meterOwnedByBones) {
    synthetic[SYNTHETIC_METER_ID] = serviceRecord(
      SYNTHETIC_METER_ID,
      levelId,
      'electric-meter',
      anchor.wallId,
      anchor.wallT,
      anchor.heightAff,
    )
  }
  if (panel) {
    synthetic[SYNTHETIC_PANEL_ID] = serviceRecord(
      SYNTHETIC_PANEL_ID,
      levelId,
      'panel',
      panel.wallId,
      panel.wallT,
      panel.heightAff,
    )
  }
  const engineNodes: NodeMap =
    Object.keys(synthetic).length > 0 ? { ...nodes, ...synthetic } : nodes

  let model: MepModel
  try {
    const result = computeLevel(
      engineNodes as unknown as Record<string, Record<string, unknown>>,
      configFor(nodes, levelId),
    )
    model = {
      levelId,
      fixtures: result.fixtures,
      members: result.members,
      walls: result.walls,
      warnings: result.warnings.filter((w) => !STRUCTURAL_WARNING.test(w)),
      jurisdiction: result.jurisdiction,
      serviceSync,
    }
  } catch (error) {
    model = {
      levelId,
      fixtures: [],
      members: [],
      walls: [],
      warnings: [`MEP engine failed: ${(error as Error).message ?? 'unknown error'}`],
      jurisdiction: 'AUTO',
      serviceSync,
    }
  }
  entries.set(key, model)
  return model
}

/** Fixtures of one Bones system, in derivation order. */
export function fixturesOf(model: MepModel, system: Fixture['system']): Fixture[] {
  return model.fixtures.filter((f) => f.system === system)
}

/** Members of one Bones system and role. */
export function membersOf(
  model: MepModel,
  system: Member['system'],
  roles: readonly Member['role'][],
): Member[] {
  const wanted = new Set<string>(roles)
  return model.members.filter((m) => m.system === system && wanted.has(m.role))
}
