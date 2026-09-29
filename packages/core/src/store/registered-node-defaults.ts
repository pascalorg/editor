import { nodeRegistry } from '../registry/registry'
import { AnyNode, nodeKindOf } from '../schema/types'

let builtinKinds: Set<string> | undefined

/**
 * Fills registered schema defaults on stored nodes before `setScene`, for kinds
 * the scene loader does not own. Built-in kinds are left exactly as stored: the
 * loader's migrations read what a stored node leaves out (a legacy slab without
 * `thickness` occupies `[0, elevation]`, a level without `height` marks a legacy
 * scene) and a zod parse would also strip legacy fields they consume. Parsing
 * them here made the editor load legacy scenes differently from the viewer and
 * the hosted authority.
 */
export function materializeRegisteredNodeDefaults(
  nodes: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  builtinKinds ??= new Set(AnyNode.options.map(nodeKindOf))
  const kinds = builtinKinds
  return Object.fromEntries(
    Object.entries(nodes).map(([id, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [id, value]
      const type = (value as { type?: unknown }).type
      if (typeof type !== 'string' || kinds.has(type)) return [id, value]
      const parsed = nodeRegistry.get(type)?.schema.safeParse(value)
      return [id, parsed?.success ? parsed.data : value]
    }),
  )
}
