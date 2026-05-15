'use client'

import { SlabSystem } from '@pascal-app/viewer'

/**
 * Registry-driven slab system bundle. Re-exports the legacy `SlabSystem`
 * (still in viewer) so it mounts via `RegisteredSystems` when slab is
 * registry-driven. `<LegacySystem kind="slab">` in viewer/components/
 * viewer/index.tsx short-circuits whenever `nodeRegistry.has('slab')`
 * is true — same shape wall and fence use.
 *
 * Future Phase 5+: extract polygon triangulation + hole CSG into a pure
 * `buildSlabGeometry(node)` and migrate to `def.geometry`. The legacy
 * system body has it well-isolated; should be a clean extraction.
 */
const SlabSystems = () => {
  return <SlabSystem />
}

export default SlabSystems
