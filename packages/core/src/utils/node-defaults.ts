import type { z } from 'zod'
import { AnyNode, nodeKindOf } from '../schema/types'

type DefaultField = { key: string; schema: z.ZodType }

let defaultsByKind: Map<string, DefaultField[]> | undefined

/**
 * Kinds whose load migrations all live in the shared server-safe pipeline, so a
 * caller that runs only that pipeline (the hosted authority) may fill their
 * defaults. Roofs, dormers, items and the rest still migrate in the client
 * loader, which reads fields those defaults would supply.
 */
export const STRUCTURE_NODE_KINDS: ReadonlySet<string> = new Set([
  'slab',
  'ceiling',
  'zone',
  'wall',
  'separator',
  'floor-opening',
])

// Only deterministic defaults: a generated id (`objectId`) is not a default a
// load may invent.
function fieldsWithDefaults(shape: Record<string, z.ZodType>): DefaultField[] {
  const fields: DefaultField[] = []
  for (const [key, schema] of Object.entries(shape)) {
    const first = schema.safeParse(undefined)
    if (!first.success || first.data === undefined) continue
    const second = schema.safeParse(undefined)
    if (JSON.stringify(first.data) !== JSON.stringify(second.data)) continue
    fields.push({ key, schema })
  }
  return fields
}

function defaultFields(kind: string): DefaultField[] | undefined {
  defaultsByKind ??= new Map(
    AnyNode.options.map((option) => [
      nodeKindOf(option),
      fieldsWithDefaults(option.shape as Record<string, z.ZodType>),
    ]),
  )
  return defaultsByKind.get(kind)
}

let containerDefaultsByKind: Map<string, ContainerDefault[]> | undefined

type ContainerDefault = { key: string; value: unknown; json: string }

/**
 * The container defaults of a kind: arrays (`children`, `holes`, `position`, …)
 * and empty objects (`metadata`). Unlike a scalar default (a legacy slab
 * without `thickness` is solid down to its level), an omitted container means
 * exactly its default: the reload after {@link materializeNodeDefaults} reads
 * it filled and must migrate the same.
 */
export function containerDefaultFields(kind: string): readonly ContainerDefault[] {
  containerDefaultsByKind ??= new Map()
  let fields = containerDefaultsByKind.get(kind)
  if (!fields) {
    fields = (defaultFields(kind) ?? []).flatMap(({ key, schema }) => {
      const value = schema.parse(undefined)
      const container =
        Array.isArray(value) ||
        (value !== null && typeof value === 'object' && Object.keys(value).length === 0)
      return container ? [{ key, value, json: JSON.stringify(value) }] : []
    })
    containerDefaultsByKind.set(kind, fields)
  }
  return fields
}

/**
 * Fills the schema defaults a stored built-in node leaves out, as the last
 * step of every load (client `setScene`, hosted authority). The migrations run
 * first on the stored nodes because they read what a node omits (a legacy slab
 * without `thickness` is solid down to its level); after them, renderers and
 * tools may rely on every defaulted field (`zone.holes`, `slab.holes`, …).
 * Only missing top-level fields are added: present values are never parsed,
 * coerced or stripped. `kinds` limits it to the kinds whose absence-reading
 * migrations the caller has all run ({@link STRUCTURE_NODE_KINDS} for the
 * hosted authority).
 */
export function materializeNodeDefaults<T extends Record<string, unknown>>(
  nodes: T,
  kinds?: ReadonlySet<string>,
): { nodes: T; changed: boolean } {
  let out: Record<string, unknown> | null = null
  for (const [id, value] of Object.entries(nodes)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const node = value as Record<string, unknown>
    const fields =
      typeof node.type === 'string' && (!kinds || kinds.has(node.type))
        ? defaultFields(node.type)
        : undefined
    if (!fields) continue
    let next: Record<string, unknown> | null = null
    for (const { key, schema } of fields) {
      if (node[key] !== undefined) continue
      next ??= { ...node }
      next[key] = schema.parse(undefined)
    }
    if (!next) continue
    out ??= { ...nodes }
    out[id] = next
  }
  return out ? { nodes: out as T, changed: true } : { nodes, changed: false }
}
