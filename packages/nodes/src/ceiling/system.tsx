'use client'

import { CeilingSystem } from '@pascal-app/viewer'

/**
 * Registry-driven ceiling system bundle. Re-exports the legacy
 * `CeilingSystem` so it mounts via `RegisteredSystems` when ceiling is
 * registry-driven. `<LegacySystem kind="ceiling">` in viewer/components/
 * viewer/index.tsx short-circuits whenever `nodeRegistry.has('ceiling')`
 * is true — same shape wall / fence / slab use.
 *
 * Future Phase 5+: extract polygon triangulation + hole CSG into a pure
 * `buildCeilingGeometry(node)` and migrate to `def.geometry`.
 */
const CeilingSystems = () => {
  return <CeilingSystem />
}

export default CeilingSystems
