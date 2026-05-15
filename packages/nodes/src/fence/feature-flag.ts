/**
 * Feature flag for the registry-driven fence.
 *
 * Same pattern as wall (Phase 3) and spawn (Phase 2): with the flag on,
 * `fenceDefinition` is appended to `builtinPlugin.nodes` and the Phase 0
 * dispatch shims hand fence over to the registry. With the flag off,
 * the legacy fence paths run unchanged.
 *
 * Drops the moment Phase 5 fence parity is signed off.
 */
export const isFenceRegistryEnabled = (): boolean => {
  return process.env.NEXT_PUBLIC_USE_REGISTRY_FOR_FENCE === 'true'
}
