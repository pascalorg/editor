'use client'

import { type BuildingNode, type LevelNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '../../lib/utils'

function getLevelDisplayLabel(level: LevelNode) {
  return level.name || `Level ${level.level}`
}

export function FloatingLevelSelector() {
  const selectedBuildingId = useViewer((s) => s.selection.buildingId)
  const levelId = useViewer((s) => s.selection.levelId)
  const setSelection = useViewer((s) => s.setSelection)

  // Resolve the effective building ID — selected or first in scene (scalar, stable reference)
  const resolvedBuildingId = useScene((state) => {
    if (selectedBuildingId) return selectedBuildingId
    const first = Object.values(state.nodes).find((n) => n?.type === 'building') as
      | BuildingNode
      | undefined
    return first?.id ?? null
  })

  // Get levels for the resolved building (array, useShallow for stable reference)
  const levels = useScene(
    useShallow((state) => {
      if (!resolvedBuildingId) return [] as LevelNode[]
      const building = state.nodes[resolvedBuildingId]
      if (!building || building.type !== 'building') return [] as LevelNode[]
      return (building as BuildingNode).children
        .map((id) => state.nodes[id])
        .filter((node): node is LevelNode => node?.type === 'level')
        .sort((a, b) => a.level - b.level)
    }),
  )

  if (levels.length <= 1) return null

  // Display highest level at top, ground at bottom
  const reversedLevels = [...levels].reverse()

  return (
    <div className="pointer-events-auto absolute top-14 left-3 z-20">
      {/* Outer: rounded-xl (12px) with p-1 (4px) → inner: rounded-lg (8px) for concentric radii */}
      <div className="flex flex-col gap-0.5 rounded-xl border border-border bg-background/90 p-1 shadow-2xl backdrop-blur-md">
        {reversedLevels.map((level) => {
          const isSelected = level.id === levelId
          return (
            <button
              className={cn(
                'flex min-w-[80px] items-center justify-start rounded-lg px-2.5 py-1.5 font-medium text-xs transition-colors',
                isSelected
                  ? 'bg-white/10 text-foreground'
                  : 'text-muted-foreground/70 hover:bg-white/5 hover:text-muted-foreground',
              )}
              key={level.id}
              onClick={() =>
                setSelection(
                  resolvedBuildingId
                    ? { buildingId: resolvedBuildingId, levelId: level.id }
                    : { levelId: level.id },
                )
              }
              title={getLevelDisplayLabel(level)}
              type="button"
            >
              <span className="truncate">{getLevelDisplayLabel(level)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
