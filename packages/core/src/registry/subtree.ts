import { generateId } from '../schema/base'
import type { AnyNode, AnyNodeId } from '../schema/types'

// A serializable, location-independent snapshot of a single-root node
// subtree — designed to round-trip through JSON storage (the unified
// `items` catalog's `node_data` column) and re-materialize at a new
// position with fresh IDs.
//
// Stripping rules applied at snapshot time:
//   1. `id` is removed from the root and every descendant; the host's
//      `parentId` on the root is removed too. Fresh IDs are minted at
//      materialize time, and parent / child references are rewritten
//      with the new IDs.
//   2. The root's absolute world `position` is stripped — the placement
//      site decides where the preset lands. Descendants keep their
//      positions verbatim because those are local-to-parent (still valid
//      after the root is repositioned).
//   3. Host anchor fields on the root are stripped: `wallId` (doors,
//      windows, items hosted on walls) and `wallT` (linear parameter
//      along the wall). They are re-derived at materialize time by the
//      consumer's auto-attach UX (drop a door on a wall → re-anchor).
//   4. Every other field — `rotation`, parametric fields, `children`,
//      `metadata`, schema-defined defaults — is preserved verbatim.
//
// The shape is intentionally a plain `AnyNode`-shaped record (with the
// id/parentId-bearing properties optional) plus a flat descendants
// array, rather than a recursive tree, so consumers parsing it through
// a kind's Zod schema land in the same world as `createNode` (one node
// per registry entry, container fields holding ID arrays).

export type SubtreeNode = Omit<AnyNode, 'id' | 'parentId'> & {
  // Children on container kinds are kept as either an array of legacy
  // descendant IDs (subtree-relative — re-mapped at materialize time)
  // or an array of fresh prefixes the materializer turns into IDs. We
  // preserve the original strings verbatim and rebuild a fresh ID map
  // at materialize time.
  children?: AnyNodeId[]
}

export type NodeSubtree = {
  /** Kind of the root node — duplicated from `root.type` for cheap lookups before parsing. */
  rootKind: string
  /** Root node, with id / parentId / absolute position / host refs stripped. */
  root: SubtreeNode
  /** Flat list of descendants. Each carries its `parentId` pointing inside the subtree. */
  descendants: SubtreeNode[]
  /**
   * Stable internal IDs (UUID-free, only valid within this snapshot) so
   * `parentId` / `children` arrays inside `descendants` can reference
   * each other. The materialize step minted fresh real IDs and remaps
   * these tokens to them.
   */
  internalIds: {
    rootKey: string
    /** Per-descendant token. `descendants[i].metadata.__subtreeKey` carries the same string. */
    descendantKeys: string[]
  }
}

const SUBTREE_KEY = '__subtreeKey'

function getDescendantIds(node: AnyNode): AnyNodeId[] {
  if ('children' in node && Array.isArray((node as { children?: unknown }).children)) {
    return (node as { children: AnyNodeId[] }).children
  }
  return []
}

function stripRootFields(node: AnyNode): SubtreeNode {
  // Doors / windows / wall-hosted items carry `wallId`; doors / windows
  // also carry `side`, but `side` is a logical wall-side declaration the
  // re-attach UX can re-derive from cursor + hit normal. Keeping it on
  // descendants is fine — only the root is ever re-anchored.
  const {
    id: _id,
    parentId: _parentId,
    position: _position,
    wallId: _wallId,
    wallT: _wallT,
    ...rest
  } = node as AnyNode & {
    position?: unknown
    wallId?: unknown
    wallT?: unknown
  }
  return rest as SubtreeNode
}

function stripDescendantFields(node: AnyNode): SubtreeNode {
  // Descendants keep their `parentId` — it's been rewritten to point at
  // the parent's internal token by the caller, and `materializeSubtree`
  // reads it to re-anchor the descendant under the freshly-minted root.
  // Only `id` is stripped (a fresh one is minted at materialize time).
  const { id: _id, ...rest } = node
  return rest as SubtreeNode
}

/**
 * Build a {@link NodeSubtree} snapshot rooted at `rootId`. Walks the
 * `children` array recursively, so any kind that participates in the
 * scene-graph's containment model is captured (slab → ceiling holes
 * stay on the slab, stair → segments, roof → segments, shelf → items).
 *
 * Returns `null` if `rootId` is missing from `nodes`.
 */
export function buildSubtreeSnapshot(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  rootId: AnyNodeId,
): NodeSubtree | null {
  const rootNode = nodes[rootId]
  if (!rootNode) return null

  // Collect every node id reachable from the root via `children`.
  // FIFO walk so siblings keep their original `children` array order
  // in `descendants` — important for kinds where order is semantic
  // (stair segments, roof segments). The root lands at index 0.
  const subtreeIds: AnyNodeId[] = []
  const seen = new Set<AnyNodeId>()
  const queue: AnyNodeId[] = [rootId]
  let head = 0
  while (head < queue.length) {
    const id = queue[head++]!
    if (seen.has(id)) continue
    const node = nodes[id]
    if (!node) continue
    seen.add(id)
    subtreeIds.push(id)
    for (const childId of getDescendantIds(node)) queue.push(childId)
  }

  // Assign internal tokens. Mirror the existing id prefix so the
  // generated IDs at materialize time keep the same `wall_…`, `door_…`
  // shape — helpful for debugging and lookup heuristics.
  const idToKey = new Map<AnyNodeId, string>()
  let counter = 0
  for (const id of subtreeIds) {
    const prefix = id.includes('_') ? id.slice(0, id.indexOf('_')) : 'node'
    idToKey.set(id, `${prefix}::${counter++}`)
  }
  const rootKey = idToKey.get(rootId)!

  // Clone + rewrite each node so internal references point at tokens
  // instead of original ids. Tokens land in `metadata.__subtreeKey`
  // for descendants so we can re-discover them at materialize time.
  const descendants: SubtreeNode[] = []
  let rootStripped: SubtreeNode | null = null

  for (const id of subtreeIds) {
    const original = nodes[id]
    if (!original) continue
    // Deep-clone via JSON: strips three.js refs / functions / circular
    // links (same trick `cloneLevelSubtree` uses for runtime nodes).
    const cloned = JSON.parse(JSON.stringify(original)) as AnyNode
    // Rewrite children to tokens.
    if ('children' in cloned && Array.isArray((cloned as { children?: unknown }).children)) {
      ;(cloned as { children: unknown }).children = (cloned as { children: AnyNodeId[] }).children
        .map((cid) => idToKey.get(cid))
        .filter((key): key is string => key !== undefined) as unknown as AnyNodeId[]
    }
    // Rewrite parentId on descendants to point at the parent's token.
    if (id !== rootId && cloned.parentId) {
      const parentKey = idToKey.get(cloned.parentId as AnyNodeId)
      ;(cloned as { parentId: string | null }).parentId = parentKey ?? null
    }
    if (id === rootId) {
      rootStripped = stripRootFields(cloned)
    } else {
      const stripped = stripDescendantFields(cloned)
      const meta = (stripped as { metadata?: Record<string, unknown> }).metadata
      ;(stripped as { metadata?: Record<string, unknown> }).metadata = {
        ...(meta ?? {}),
        [SUBTREE_KEY]: idToKey.get(id),
      }
      descendants.push(stripped)
    }
  }

  if (!rootStripped) return null

  return {
    rootKind: rootNode.type,
    root: rootStripped,
    descendants,
    internalIds: {
      rootKey,
      descendantKeys: descendants.map((d) => {
        const meta = (d as { metadata?: Record<string, unknown> }).metadata
        return (meta?.[SUBTREE_KEY] as string) ?? ''
      }),
    },
  }
}

export type MaterializedSubtree = {
  /** Fresh id assigned to the root. */
  rootId: AnyNodeId
  /** Every materialized node, root first, ready to feed into `createNodes`. */
  nodes: AnyNode[]
  /** Internal-token → fresh-id map, mostly useful for tests. */
  idMap: Map<string, AnyNodeId>
}

/**
 * Re-hydrate a {@link NodeSubtree} into a flat list of real nodes with
 * fresh IDs. The caller decides where to insert them — typically by
 * passing `nodes[0]` as the root op to `createNodes`, with `parentId`
 * set to the active level / wall / parent surface — and `position` is
 * stamped onto the root before materializing.
 *
 * Stripping is reversed: the root receives the supplied `position`;
 * host anchor fields (wallId / wallT) stay absent and must be filled
 * by the caller's auto-attach pass when applicable.
 *
 * The returned `nodes` are NOT parsed through the Zod schemas — the
 * caller is responsible for `def.schema.parse(...)` before insertion
 * if it wants schema-default merging. `createNode` re-validates via
 * the registry, so unsafe payloads can't slip into the scene store.
 */
export function materializeSubtree(
  subtree: NodeSubtree,
  position: readonly [number, number, number],
): MaterializedSubtree {
  const idMap = new Map<string, AnyNodeId>()

  function tokenToId(token: string): AnyNodeId {
    const existing = idMap.get(token)
    if (existing) return existing
    const prefix = token.includes('::') ? token.slice(0, token.indexOf('::')) : 'node'
    const fresh = generateId(prefix) as AnyNodeId
    idMap.set(token, fresh)
    return fresh
  }

  const rootId = tokenToId(subtree.internalIds.rootKey)

  // Reserve fresh IDs for all descendants up-front so children arrays
  // resolve regardless of declaration order.
  for (const key of subtree.internalIds.descendantKeys) tokenToId(key)

  function remap(node: SubtreeNode, freshId: AnyNodeId, parentId: AnyNodeId | null): AnyNode {
    const remapped = JSON.parse(JSON.stringify(node)) as AnyNode
    ;(remapped as { id: AnyNodeId }).id = freshId
    ;(remapped as { parentId: AnyNodeId | null }).parentId = parentId
    if ('children' in remapped && Array.isArray((remapped as { children?: unknown }).children)) {
      ;(remapped as { children: AnyNodeId[] }).children = (
        remapped as { children: string[] }
      ).children
        .map((token) => idMap.get(token))
        .filter((id): id is AnyNodeId => id !== undefined)
    }
    // Strip the internal-token marker — irrelevant once materialized.
    const meta = (remapped as { metadata?: Record<string, unknown> }).metadata
    if (meta && SUBTREE_KEY in meta) {
      const { [SUBTREE_KEY]: _drop, ...rest } = meta
      ;(remapped as { metadata: Record<string, unknown> }).metadata = rest
    }
    return remapped
  }

  const rootNode = remap(subtree.root, rootId, null)
  ;(rootNode as { position: [number, number, number] }).position = [
    position[0],
    position[1],
    position[2],
  ]

  const out: AnyNode[] = [rootNode]
  for (let i = 0; i < subtree.descendants.length; i += 1) {
    const descendant = subtree.descendants[i]!
    const token = subtree.internalIds.descendantKeys[i]!
    const freshId = tokenToId(token)
    const parentToken = (descendant as { parentId?: string | null }).parentId ?? null
    const parentFreshId = parentToken ? (idMap.get(parentToken) ?? null) : null
    out.push(remap(descendant, freshId, parentFreshId))
  }

  return { rootId, nodes: out, idMap }
}
