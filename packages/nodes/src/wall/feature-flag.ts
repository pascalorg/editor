/**
 * Feature flag for the registry-driven wall.
 *
 * Wall is the Phase 3 stress test — its scope is large enough (5 affordances,
 * miter cascade, host re-anchor, slab/zone dirty propagation, undo
 * correctness) that flipping it on uncontrolled would risk silently
 * regressing every wall scene in production.
 *
 * Pattern mirrors `NEXT_PUBLIC_USE_REGISTRY_FOR_SPAWN` used during the
 * Phase 2 spawn migration: when ON, `wallDefinition` is appended to
 * `builtinPlugin.nodes` and the Phase 0 dispatch shims take over wall
 * rendering / tooling. When OFF, the legacy wall paths run unchanged.
 *
 * Literal `process.env.NEXT_PUBLIC_USE_REGISTRY_FOR_WALL` access is required
 * — Next.js only inline-substitutes literal env reads, so `process.env[name]`
 * with a variable would always read undefined in client bundles.
 *
 * Drop this file the moment Phase 3 parity is signed off and wall is
 * registered unconditionally.
 */
export const isWallRegistryEnabled = (): boolean => {
  return process.env.NEXT_PUBLIC_USE_REGISTRY_FOR_WALL === 'true'
}
