import { containerDefaultFields } from './node-defaults'

type Nodes = Record<string, unknown>
type Filled = Map<string, readonly { key: string; json: string; value: unknown }[]>

/**
 * The stored nodes as the load migrations read them: container schema
 * defaults (`children`, `holes`, `position`, `metadata`, …) supplied where a
 * raw legacy node leaves them out. Scalar defaults stay absent: migrations read
 * their absence (see `materializeNodeDefaults`).
 */
export function loadNodeView(source: Nodes): { view: Nodes; filled: Filled } {
  let view: Nodes | null = null
  const filled: Filled = new Map()
  for (const [id, value] of Object.entries(source)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const node = value as Record<string, unknown>
    if (typeof node.type !== 'string') continue
    let next: Record<string, unknown> | null = null
    const keys: { key: string; json: string; value: unknown }[] = []
    for (const { key, json, value } of containerDefaultFields(node.type)) {
      if (node[key] !== undefined) continue
      next ??= { ...node }
      next[key] = structuredClone(value)
      keys.push({ key, json, value: next[key] })
    }
    if (!next) continue
    view ??= { ...source }
    view[id] = next
    filled.set(id, keys)
  }
  return { view: view ?? source, filled }
}

/**
 * Drops the view's fills a migration carried through untouched (the same
 * instance, same content), so no stored node is rewritten by them. A value the
 * migration wrote itself, even an equal one, is its output and stays.
 */
function restoreStoredShape(source: Nodes, view: Nodes, filled: Filled, migrated: Nodes): Nodes {
  const out: Nodes = { ...migrated }
  let same = Object.keys(out).length === Object.keys(source).length
  for (const [id, node] of Object.entries(out)) {
    const fields = filled.get(id)
    if (fields && node && typeof node === 'object') {
      const record = node as Record<string, unknown>
      const untouched = fields.filter(
        ({ key, json, value }) => record[key] === value && JSON.stringify(value) === json,
      )
      if (node === view[id] && untouched.length === fields.length) out[id] = source[id]
      else if (untouched.length) {
        const next = { ...record }
        for (const { key } of untouched) delete next[key]
        out[id] = next
      }
    }
    if (out[id] !== source[id]) same = false
  }
  return same ? source : out
}

function reportFailure(name: string, error: unknown) {
  console.error(`[scene load] ${name} failed; the scene loads without it`, error)
}

/**
 * Wraps a load migration so a raw legacy scene can never stop a project
 * opening: the migration reads {@link loadNodeView}, and if it still throws the
 * scene loads without it — as main loaded it before the migration existed.
 */
export function loadMigration<A extends unknown[], R extends { nodes: Nodes }>(
  name: string,
  migrate: (nodes: Nodes, ...args: A) => R,
  unchanged: (nodes: Nodes) => R,
): (nodes: Nodes, ...args: A) => R {
  return (source, ...args) => {
    const { view, filled } = loadNodeView(source)
    let result: R
    try {
      result = migrate(view, ...args)
    } catch (error) {
      reportFailure(name, error)
      return unchanged(source)
    }
    if (!filled.size) return result
    return { ...result, nodes: restoreStoredShape(source, view, filled, result.nodes) } as R
  }
}

/** {@link loadMigration} for a migration that returns the node map itself. */
export function loadMapMigration<A extends unknown[], R extends Nodes>(
  name: string,
  migrate: (nodes: Nodes, ...args: A) => R,
): (nodes: Nodes, ...args: A) => R {
  const wrapped = loadMigration(
    name,
    (nodes: Nodes, ...args: A) => ({ nodes: migrate(nodes, ...args) as Nodes }),
    (nodes) => ({ nodes }),
  )
  return (source, ...args) => wrapped(source, ...args).nodes as R
}
