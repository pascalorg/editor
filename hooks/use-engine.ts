/**
 * Engine Hook
 *
 * React hook that manages the ECS World derived from the node tree.
 * Memoizes the world and runs systems when levels change.
 */

import { useMemo } from 'react'
import { buildWorldFromNodes } from '../lib/engine/adapters/nodes-to-world'
import type { World } from '../lib/engine/core'
import { runBoundsSystem } from '../lib/engine/systems/bounds-system'
import { runFootprintSystem } from '../lib/engine/systems/footprint-system'
import type { LevelNode } from '../lib/nodes/types'

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook to get the engine world from levels
 */
export function useEngineWorld(levels: LevelNode[], gridSizeMeters = 0.5): World {
  const world = useMemo(() => {
    // Build world from nodes
    const newWorld = buildWorldFromNodes(levels, gridSizeMeters)

    // Run systems
    runBoundsSystem(newWorld)
    runFootprintSystem(newWorld)

    return newWorld
  }, [levels, gridSizeMeters])

  return world
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Hook to get world statistics
 */
export function useEngineStats(world: World) {
  return useMemo(() => world.getStats(), [world])
}
