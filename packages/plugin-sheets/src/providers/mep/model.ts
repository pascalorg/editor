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
}

export type MepModel = {
  levelId: string
  fixtures: Fixture[]
  members: Member[]
  walls: WallSlice[]
  /** Engine warnings — printed on the sheet, never swallowed. */
  warnings: string[]
  /** How the meter got its spot, for the sheet's own honesty line. */
  serviceSync: ServiceSync | null
}

/** The synthetic `bones:service` record's id — never written to the scene. */
export const SYNTHETIC_SERVICE_ID = 'bonessvc_sheets_electric_meter_sync'

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
    if (!wall || wall.type !== 'wall' || wall.parentId !== levelId) continue
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

/** A real `bones:service` electric-meter node already on this level. */
function hasBonesMeterNode(nodes: NodeMap, levelId: string): boolean {
  return Object.values(nodes).some(
    (n) =>
      n?.type === 'bones:service' &&
      n.parentId === levelId &&
      n.visible !== false &&
      String(n.serviceType ?? '') === 'electric-meter',
  )
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
  return FramingNode.parse({
    id: `bonesframing_sheets_${levelId}`,
    type: 'bones:framing',
    parentId: levelId,
    showElectrical: true,
    showPlumbing: true,
  })
}

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
  const ownedByBones = hasBonesMeterNode(nodes, levelId)
  const key = `${levelId}|${anchor ? `${anchor.wallId}@${anchor.wallT.toFixed(6)}@${anchor.heightAff.toFixed(4)}` : '-'}|${ownedByBones ? 'b' : 's'}`

  let entries = cache.get(nodes as object)
  if (!entries) {
    entries = new Map()
    cache.set(nodes as object, entries)
  }
  const hit = entries.get(key)
  if (hit) return hit

  const serviceSync: ServiceSync | null = anchor
    ? { ...anchor, synthesized: !ownedByBones }
    : null

  // The throwaway node map: the scene's own nodes plus the mirrored anchor.
  // Shaped exactly as compute.ts's `extractExtraServiceOverrides` reads a
  // `bones:service` node — type, parentId, visible, serviceType, wallId,
  // wallT, heightAff, and the [0,0,0] "wall anchor is authoritative" position.
  const engineNodes: NodeMap =
    anchor && !ownedByBones
      ? {
          ...nodes,
          [SYNTHETIC_SERVICE_ID]: {
            id: SYNTHETIC_SERVICE_ID,
            type: 'bones:service',
            parentId: levelId,
            visible: true,
            serviceType: 'electric-meter',
            wallId: anchor.wallId,
            wallT: anchor.wallT,
            heightAff: anchor.heightAff,
            position: [0, 0, 0],
          },
        }
      : nodes

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
      warnings: [...result.warnings],
      serviceSync,
    }
  } catch (error) {
    model = {
      levelId,
      fixtures: [],
      members: [],
      walls: [],
      warnings: [`MEP engine failed: ${(error as Error).message ?? 'unknown error'}`],
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
