import { isRegistrySelectable, sceneRegistry, useScene } from '@pascal-app/core'

/**
 * Who "owns" a raycast hit, for the hidden-wall nearest-first selection rule
 * (`pointer-transparency.ts`)?
 *
 * The live R3F event raycast recurses through the level/building wrapper
 * groups (they carry pointer handlers), so `event.intersections` contains
 * every mesh under them — including PASSIVE geometry that owns no selection
 * semantics: plugin overlay members (the Bones framing InstancedMeshes sit
 * exactly at the wall's depth), helper meshes, the grid. Distance alone
 * cannot rank those against a hidden wall; ownership can:
 *
 * - 'self-wall'   — the hit resolves to THIS wall (its own collision mesh,
 *                   render mesh, treatments). Neutral: a wall cannot outrank
 *                   itself, and must not yield to itself either.
 * - 'other-wall'  — the hit resolves to a different wall. Never a direct
 *                   competitor (two hidden walls must not both yield and
 *                   drop the event into the room behind — delivery order
 *                   already gives the nearest one the event), but an ANCHOR
 *                   for the wall-mounted test.
 * - 'selectable'  — the hit resolves to a node the editor can select
 *                   (furniture, devices, openings, slabs …). These are the
 *                   real competitors.
 * - 'passive'     — no selectable-node ancestry (framing members, gizmos,
 *                   the grid, unregistered helpers). Never outranks a wall.
 *
 * Ownership = the hit object's NEAREST ancestor registered in
 * `sceneRegistry` (every node's renderer registers its root). A hosted
 * door's meshes resolve to the door (registered deeper than its host wall),
 * a wall's own trim resolves to the wall, a framing member resolves to the
 * plugin's overlay node (registered, but not selectable → passive).
 */
export type WallRayHitOwnership = 'self-wall' | 'other-wall' | 'selectable' | 'passive'

/**
 * Built-in kinds with selection semantics in the editor (mirrors
 * SelectionManager's structure/furnish lists until Phase 4 makes
 * `capabilities.selectable` the single source of truth). Wrapper kinds
 * (level/building/site) and the zone volume are deliberately absent: a hit
 * whose nearest owner is a wrapper is passive scenery, and zone volumes
 * share the wall's own planes.
 */
const BUILTIN_SELECTABLE_COMPETITOR_KINDS = new Set([
  'fence',
  'item',
  'column',
  'elevator',
  'slab',
  'ceiling',
  'roof',
  'roof-segment',
  'stair',
  'stair-segment',
  'spawn',
  'window',
  'door',
  'shelf',
])

/** Injectable seams so the classifier is testable without the live editor. */
export type HitOwnerDeps = {
  /** Bumped whenever a node (un)registers — invalidates the reverse map. */
  registryRevision: () => number
  /** All registered (nodeId, root Object3D) pairs. */
  registeredEntries: () => Iterable<[string, object]>
  /** The node kind for a registered id (undefined once the node is gone). */
  kindOf: (id: string) => string | undefined
  /** Plugin kinds that declare `capabilities.selectable`. */
  isRegistrySelectableKind: (kind: string) => boolean
}

const liveDeps: HitOwnerDeps = {
  registryRevision: () => sceneRegistry.revision,
  registeredEntries: () => sceneRegistry.nodes.entries(),
  // The store index is keyed by AnyNodeId; keep the loose read in one place.
  kindOf: (id) =>
    (useScene.getState().nodes as Record<string, { type?: string } | undefined>)[id]?.type,
  isRegistrySelectableKind: isRegistrySelectable,
}

type ObjectLike = { parent?: ObjectLike | null }

/**
 * Reverse lookup (Object3D → registered node id), rebuilt lazily when the
 * scene registry's revision moves. One map per classifier factory; the
 * default factory below shares a single module-level instance.
 */
const createRegisteredObjectLookup = (deps: HitOwnerDeps) => {
  let revision = -1
  let reverse = new Map<object, string>()
  return (object: ObjectLike): string | null => {
    const currentRevision = deps.registryRevision()
    if (currentRevision !== revision) {
      revision = currentRevision
      reverse = new Map()
      for (const [id, root] of deps.registeredEntries()) reverse.set(root, id)
    }
    let current: ObjectLike | null | undefined = object
    while (current) {
      const id = reverse.get(current as object)
      if (id !== undefined) return id
      current = current.parent
    }
    return null
  }
}

const isSelectableCompetitorKind = (kind: string, deps: HitOwnerDeps): boolean =>
  BUILTIN_SELECTABLE_COMPETITOR_KINDS.has(kind) || deps.isRegistrySelectableKind(kind)

/**
 * Build a classifier for one wall's pointer gate. `selfWallId` is that
 * wall's node id; hits resolving to it are 'self-wall'.
 */
export const createWallRayHitClassifier = (
  selfWallId: string,
  deps: HitOwnerDeps = liveDeps,
): ((object: ObjectLike) => WallRayHitOwnership) => {
  const nearestRegisteredId = createRegisteredObjectLookup(deps)
  return (object) => {
    const ownerId = nearestRegisteredId(object)
    if (ownerId === null) return 'passive'
    if (ownerId === selfWallId) return 'self-wall'
    const kind = deps.kindOf(ownerId)
    if (kind === undefined) return 'passive'
    if (kind === 'wall') return 'other-wall'
    return isSelectableCompetitorKind(kind, deps) ? 'selectable' : 'passive'
  }
}
