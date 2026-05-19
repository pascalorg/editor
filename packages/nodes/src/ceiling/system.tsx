'use client'

import { CeilingSystem } from '@pascal-app/viewer'

/**
 * Registry-driven ceiling system bundle. Wraps `CeilingSystem` so it
 * mounts via `RegisteredSystems`.
 *
 * Future: extract polygon triangulation + hole CSG into a pure
 * `buildCeilingGeometry(node)` and migrate to `def.geometry`.
 */
const CeilingSystems = () => {
  return <CeilingSystem />
}

export default CeilingSystems
