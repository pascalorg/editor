import { generateId } from '../schema/base'
import type { AnyNode, AnyNodeId } from '../schema/types'

// Generic, opinion-free primitives the host app composes to implement
// catalog / paste / duplicate / preset flows.
//
// Design intent (see pascalorg/editor#340 redesign):
//   - The editor exposes a *pure* live-scene walk + a generic clone-and-
//     insert helper. It owns nothing about storage shape, position
//     re-anchoring policy, or host-ref re-derivation.
//   - The host (community-app, embedders, etc.) decides whether to
//     persist the subtree as JSON, strip host fields before storage,
//     stamp a placement position, re-attach to a wall on drop, etc.
//
// What the editor uniquely knows is which schema fields on each kind
// are *host references* (e.g. `wallId` / `wallT` on a door hosted by a
// wall). That knowledge lives on `def.hostRefFields` — read it via
// `getHostRefFields(def)` and apply it at storage time. See
// `wiki/architecture/node-definitions.md` (host refs section).

/** A flat live-scene subtree rooted at `root`. */
export type Subtree = {
  /** The root node, exactly as stored in `useScene.nodes[rootId]`. */
  root: AnyNode
  /** Every descendant reachable from `root` via the data-model `children` array, in BFS order. */
  descendants: AnyNode[]
}

function extractIdPrefix(id: string): string {
  const i = id.indexOf('_')
  return i === -1 ? 'node' : id.slice(0, i)
}

function getChildIds(node: AnyNode): AnyNodeId[] {
  if ('children' in node && Array.isArray((node as { children?: unknown }).children)) {
    return (node as { children: AnyNodeId[] }).children
  }
  return []
}

/**
 * Collect the subtree of nodes rooted at `rootId` from the live scene.
 *
 * - BFS walk via `node.children` arrays — order is stable and matches
 *   declaration order on container kinds.
 * - Returns the live node references (not clones). Cheap; the caller
 *   chooses whether to deep-clone for persistence.
 * - Returns `null` if `rootId` is missing.
 */
export function collectSubtree(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  rootId: AnyNodeId,
): Subtree | null {
  const root = nodes[rootId]
  if (!root) return null

  const descendants: AnyNode[] = []
  const seen = new Set<AnyNodeId>([rootId])
  const queue: AnyNodeId[] = [...getChildIds(root)]
  let head = 0
  while (head < queue.length) {
    const id = queue[head++]!
    if (seen.has(id)) continue
    const node = nodes[id]
    if (!node) continue
    seen.add(id)
    descendants.push(node)
    for (const childId of getChildIds(node)) queue.push(childId)
  }

  return { root, descendants }
}

export type CloneNodesIntoOptions = {
  /**
   * The id of the root node within `nodes` (i.e. the node whose
   * `parentId` becomes `parentId` in the destination instead of being
   * remapped to a sibling's fresh id). Required because `nodes` is a
   * flat array — there's no other way to mark which one is the root.
   */
  rootId: AnyNodeId
  /**
   * Parent for the cloned root in the destination scene. When omitted,
   * the root is inserted as a scene root (its `parentId` becomes the
   * preserved value, often `null`).
   */
  parentId?: AnyNodeId
  /**
   * Optional override for the cloned root's `position` (most placement
   * flows stamp the cursor / target point here). When omitted, the
   * root's own `position` field is preserved verbatim. Descendants
   * always keep their original positions — those are local to the root.
   */
  position?: readonly [number, number, number]
}

export type CloneNodesIntoResult = {
  /** Fresh id assigned to the root in the destination scene. */
  rootId: AnyNodeId
  /** Every cloned node, root first, ready to feed into `createNodes`. */
  nodes: AnyNode[]
  /** Original id → fresh id map, mostly useful for tests and host-side bookkeeping. */
  idMap: Map<AnyNodeId, AnyNodeId>
}

/**
 * Clone a flat array of nodes with fresh IDs and rewired references,
 * ready to insert via `useScene.createNodes`.
 *
 * Transformations applied:
 *   1. Deep-clone each node via JSON round-trip (strips three.js refs,
 *      functions, circular links — same trick `cloneLevelSubtree` uses).
 *   2. Mint a fresh id for every node, preserving the prefix
 *      (`wall_…`, `door_…`, etc.) so logs and lookups stay readable.
 *   3. Rewrite `parentId`, `children[]` to use the fresh ids.
 *   4. Stamp `position` onto the root if provided.
 *   5. Set the root's `parentId` to `opts.parentId` when supplied.
 *
 * Intentionally generic — no awareness of host refs (`wallId`/`wallT`
 * etc.). The caller is responsible for stripping or re-deriving those
 * before / after calling this function. See `getHostRefFields(def)`.
 */
export function cloneNodesInto(
  nodes: ReadonlyArray<AnyNode>,
  opts: CloneNodesIntoOptions,
): CloneNodesIntoResult {
  // Phase 1 — mint fresh ids for every node, preserving the prefix.
  const idMap = new Map<AnyNodeId, AnyNodeId>()
  for (const node of nodes) {
    const prefix = extractIdPrefix(node.id)
    idMap.set(node.id, generateId(prefix) as AnyNodeId)
  }

  const rootFreshId = idMap.get(opts.rootId)
  if (!rootFreshId) {
    throw new Error(`cloneNodesInto: rootId "${opts.rootId}" not found in supplied nodes array`)
  }

  // Phase 2 — clone each node + rewire references.
  const out: AnyNode[] = []
  let root: AnyNode | null = null
  for (const original of nodes) {
    const cloned = JSON.parse(JSON.stringify(original)) as AnyNode
    const freshId = idMap.get(original.id)!
    ;(cloned as { id: AnyNodeId }).id = freshId
    // parentId: root's parentId becomes opts.parentId (or preserved
    // value if not supplied). Descendants point at the remapped parent.
    if (original.id === opts.rootId) {
      ;(cloned as { parentId: AnyNodeId | null }).parentId =
        opts.parentId !== undefined
          ? opts.parentId
          : ((cloned as { parentId?: AnyNodeId | null }).parentId ?? null)
    } else if (cloned.parentId) {
      const parentFresh = idMap.get(cloned.parentId as AnyNodeId)
      ;(cloned as { parentId: AnyNodeId | null }).parentId = parentFresh ?? null
    }
    // children[]: remap any internal references, drop external ones
    // (a descendant pointing at a sibling that didn't make it into
    // `nodes` would dangle — `filter` drops those gracefully).
    if ('children' in cloned && Array.isArray((cloned as { children?: unknown }).children)) {
      ;(cloned as { children: AnyNodeId[] }).children = (
        cloned as { children: AnyNodeId[] }
      ).children
        .map((cid) => idMap.get(cid))
        .filter((cid): cid is AnyNodeId => cid !== undefined)
    }

    if (original.id === opts.rootId) {
      if (opts.position) {
        ;(cloned as { position: [number, number, number] }).position = [
          opts.position[0],
          opts.position[1],
          opts.position[2],
        ]
      }
      root = cloned
    } else {
      out.push(cloned)
    }
  }

  if (!root) {
    throw new Error('cloneNodesInto: root node missing after clone')
  }

  return { rootId: rootFreshId, nodes: [root, ...out], idMap }
}
