/**
 * The difference between two scene graphs, as something small enough to send.
 *
 * Autosave used to PUT the whole graph once a second: dragging one wall in a
 * 300 KB scene sent 300 KB, sixty times a minute, from every editor at once.
 * The unit here is the node, not the field — a moved wall is a few hundred
 * bytes either way, and field-level diffing buys nothing for what it costs.
 *
 * Server-safe on purpose, the same rule `scene-migrations.ts` lives under: the
 * API route applies these on the way in, so nothing here may touch the store,
 * React or Three.js.
 *
 * Two decisions worth knowing before changing anything:
 *
 * - **The graph is typed structurally, not as `SceneGraph`.** This module never
 *   looks inside a node, and the published editor package carries its own
 *   looser graph type; making the diff demand the branded one would force a
 *   cast at the only call site that matters.
 * - **Nodes are compared by reference.** Zustand replaces exactly the objects a
 *   mutation wrote and leaves every other one alone, so an untouched node
 *   settles in one pointer check. That is also what makes this cheap enough to
 *   replace the `JSON.stringify` autosave used for change detection — but it
 *   only means anything for two graphs that came out of the same store. Diffing
 *   against a graph parsed from the wire reports every node as changed, which
 *   is safe (`deltaIsWorthSending` rejects it) but wasteful.
 */

/** The bags that live alongside `nodes` and are small enough to send whole. */
export const SCENE_DELTA_RECORDS = [
  'collections',
  'savedViews',
  'comments',
  'definitions',
  'materials',
  'unitPrices',
  'installedPlugins',
] as const

export type SceneDeltaRecord = (typeof SCENE_DELTA_RECORDS)[number]

/** The shape a graph needs for a diff: keys and identity, nothing more. */
export type DeltaGraph = {
  nodes: Record<string, unknown>
  rootNodeIds: readonly string[]
} & Partial<Record<SceneDeltaRecord, unknown>>

export type SceneDeltaOp =
  /** Create or replace one node. */
  | { op: 'set'; id: string; node: unknown }
  | { op: 'delete'; id: string }
  | { op: 'roots'; rootNodeIds: string[] }
  | { op: 'record'; record: SceneDeltaRecord; value: unknown }

export interface SceneDelta {
  ops: SceneDeltaOp[]
}

/** Reference-equal arrays are the common case; only then compare by value. */
function sameRootIds(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
  return true
}

/**
 * Ops that turn `previous` into `next`. An empty list means the two graphs are
 * indistinguishable to the store, which is the signal "nothing to save".
 */
export function diffSceneGraphs(previous: DeltaGraph, next: DeltaGraph): SceneDelta {
  const ops: SceneDeltaOp[] = []

  for (const [id, node] of Object.entries(next.nodes)) {
    if (previous.nodes[id] !== node) ops.push({ op: 'set', id, node })
  }
  for (const id of Object.keys(previous.nodes)) {
    if (!(id in next.nodes)) ops.push({ op: 'delete', id })
  }

  if (!sameRootIds(previous.rootNodeIds, next.rootNodeIds)) {
    ops.push({ op: 'roots', rootNodeIds: [...next.rootNodeIds] })
  }

  for (const record of SCENE_DELTA_RECORDS) {
    if (previous[record] !== next[record]) {
      ops.push({ op: 'record', record, value: next[record] })
    }
  }

  return { ops }
}

/**
 * Applies a delta and hands back a new graph. The input is never mutated: the
 * server holds the stored graph while this runs, and a partial application that
 * then failed validation would leave the scene half-written.
 */
export function applySceneDelta<G extends DeltaGraph>(base: G, delta: SceneDelta): G {
  const nodes: Record<string, unknown> = { ...base.nodes }
  let rootNodeIds = base.rootNodeIds
  const records: Partial<Record<SceneDeltaRecord, unknown>> = {}

  for (const op of delta.ops) {
    switch (op.op) {
      case 'set':
        nodes[op.id] = op.node
        break
      case 'delete':
        delete nodes[op.id]
        break
      case 'roots':
        rootNodeIds = op.rootNodeIds
        break
      case 'record':
        records[op.record] = op.value
        break
    }
  }

  return { ...base, ...records, nodes, rootNodeIds } as G
}

/**
 * Whether a delta is still smaller than the graph it describes. One that
 * rewrites most of the scene — the first save after a load, an import, an undo
 * across a large batch — costs more than the full PUT once the op envelopes are
 * counted, and the PUT is the path that already handles every edge case.
 */
export function deltaIsWorthSending(delta: SceneDelta, graph: DeltaGraph): boolean {
  if (delta.ops.length === 0) return false
  const nodeCount = Object.keys(graph.nodes).length
  if (nodeCount === 0) return false
  const touched = delta.ops.filter((op) => op.op === 'set' || op.op === 'delete').length
  return touched <= nodeCount * 0.5
}
