import type { AnyNodeDefinition, Capabilities, NodeCategory } from '@pascal-app/core'

/**
 * The subset of a node definition that widens *soundly* to any other node
 * definition. `kind`, `schemaVersion`, `category` and `capabilities` are
 * plain covariant data, so a value carrying them is safe to accept
 * regardless of the concrete node shape. This is enough to keep call sites
 * honest — you cannot pass an arbitrary object — without dragging in the
 * schema-typed contravariant callback fields (`geometry`, `parametrics`,
 * `floorplan`, …) that make the full `NodeDefinition<S>` invariant.
 */
type NodeDefinitionLike = {
  kind: string
  schemaVersion: number
  category: NodeCategory
  capabilities: Capabilities
}

/**
 * Widen a concrete `NodeDefinition<SpecificSchema>` to the heterogeneous
 * `AnyNodeDefinition` the registry stores.
 *
 * This widening is genuinely unsound at the type level and cannot be
 * expressed without an assertion: `NodeDefinition<S>` carries the node
 * shape `S` in *contravariant* positions (e.g. `parametrics`'
 * `visibleIf: (n: z.infer<S>) => boolean`, `geometry: (node: z.infer<S>)
 * => …`). A function accepting the specific node type is, correctly, not
 * assignable to one accepting an arbitrary `Record<string, unknown>`, so
 * even `NodeDefinition<S extends ZodObject<…>>` fails to unify at the
 * call boundary.
 *
 * The registry resolves this at runtime by dispatching on `node.type`, so
 * every callback only ever receives a node of its own kind. That runtime
 * invariant is the thing TypeScript cannot see. We localise the single
 * unavoidable assertion here — behind an `unknown` parameter so no
 * `as`-cast token appears at any call site — while the public overload
 * keeps a covariant `NodeDefinitionLike` bound so callers are still
 * checked that they pass a real node definition.
 */
function widen(def: unknown): AnyNodeDefinition {
  return def as AnyNodeDefinition
}

export function asNodeDefinition(def: NodeDefinitionLike): AnyNodeDefinition {
  return widen(def)
}
