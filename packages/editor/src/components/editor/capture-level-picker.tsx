'use client'

import { type BuildingNode, getLevelDisplayName, type LevelNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '../../lib/utils'
import useEditor from '../../store/use-editor'

const rowClass = (selected: boolean) =>
  cn(
    'flex w-full min-w-0 items-center rounded-lg px-2.5 py-1.5 text-left font-medium text-xs transition-colors',
    selected
      ? 'bg-white/10 text-foreground'
      : 'text-muted-foreground/70 hover:bg-white/5 hover:text-muted-foreground',
  )

/**
 * The capture view's level picker: the editor's level list, top floor first,
 * under a "Whole building" row that shows every level (the default on entering
 * capture). A level shows itself and the levels below it, as while editing.
 */
export function CaptureLevelPicker() {
  const captureLevelId = useEditor((s) => s.captureLevelId)
  const setCaptureLevel = useEditor((s) => s.setCaptureLevel)
  const buildingId = useViewer((s) => s.selection.buildingId)
  const levels = useScene(
    useShallow((state) => {
      const building = (
        buildingId
          ? state.nodes[buildingId]
          : Object.values(state.nodes).find((n) => n?.type === 'building')
      ) as BuildingNode | undefined
      if (building?.type !== 'building') return [] as LevelNode[]
      return building.children
        .map((id) => state.nodes[id])
        .filter((node): node is LevelNode => node?.type === 'level')
        .sort((a, b) => b.level - a.level)
    }),
  )
  if (levels.length < 2) return null

  return (
    <div
      aria-label="Levels in the shot"
      className="pointer-events-auto absolute top-4 left-4 flex w-36 flex-col gap-0.5 rounded-xl border border-border bg-background/90 p-1 shadow-2xl backdrop-blur-md"
      data-capture-level-picker
      role="group"
    >
      <button
        aria-pressed={captureLevelId === null}
        className={rowClass(captureLevelId === null)}
        onClick={() => setCaptureLevel(null)}
        type="button"
      >
        <span className="truncate">Whole building</span>
      </button>
      <div className="mx-1.5 my-0.5 h-px bg-border/60" />
      {levels.map((level) => (
        <button
          aria-pressed={captureLevelId === level.id}
          className={rowClass(captureLevelId === level.id)}
          key={level.id}
          onClick={() => setCaptureLevel(level.id)}
          title={getLevelDisplayName(level)}
          type="button"
        >
          <span className="truncate">{getLevelDisplayName(level)}</span>
        </button>
      ))}
    </div>
  )
}
