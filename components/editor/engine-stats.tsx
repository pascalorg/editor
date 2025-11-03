'use client'

import { useEngineStats } from '@/hooks/use-engine'
import type { World } from '@/lib/engine/core'

interface EngineStatsProps {
  world: World
  enabled?: boolean
}

/**
 * Debug overlay showing ECS engine statistics
 */
export function EngineStats({ world, enabled = true }: EngineStatsProps) {
  const stats = useEngineStats(world)

  if (!enabled) return null

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 rounded-lg bg-black/80 p-3 font-mono text-white text-xs backdrop-blur-sm">
      <div className="mb-2 font-bold text-green-400">⚡ ECS Engine</div>
      <div className="space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-gray-400">Entities:</span>
          <span className="font-semibold">{stats.entityCount}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-gray-400">Component Types:</span>
          <span className="font-semibold">{stats.componentTypeCount}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-gray-400">Total Components:</span>
          <span className="font-semibold">{stats.totalComponents}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-gray-400">Avg/Entity:</span>
          <span className="font-semibold">
            {stats.entityCount > 0 ? (stats.totalComponents / stats.entityCount).toFixed(1) : '0'}
          </span>
        </div>
      </div>
    </div>
  )
}
