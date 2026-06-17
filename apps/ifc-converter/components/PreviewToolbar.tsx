'use client'

// Lightweight viewer-settings toolbar for the converter preview. Drives
// the same `useViewer` store the editor's own toolbar drives — the full
// `@pascal-app/editor` Editor shell didn't fit (its CSS expects a
// full-page layout) and we don't need its editing tools here.
//
// Once the editor extracts its toolbar into a reusable shell component,
// this file can collapse to an import.

import { type AnyNode, type LevelNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Box, Grid2x2, Layers, Layers2, Maximize, ScanLine, Square } from 'lucide-react'
import { type ReactNode, useMemo } from 'react'

const levelModes = ['stacked', 'solo', 'exploded', 'manual'] as const
const wallModes = ['up', 'cutaway', 'down', 'translucent'] as const

const levelLabel: Record<(typeof levelModes)[number], string> = {
  stacked: 'Stack',
  solo: 'Solo',
  exploded: 'Exploded',
  manual: 'Manual',
}

const wallLabel: Record<(typeof wallModes)[number], string> = {
  up: 'Full',
  cutaway: 'Cutaway',
  down: 'Down',
  translucent: 'Translucent',
}

function cycle<T>(list: readonly T[], current: T): T {
  const i = list.indexOf(current)
  return list[(i + 1) % list.length] ?? list[0]!
}

function ToolButton({
  active,
  label,
  icon,
  onClick,
}: {
  active?: boolean
  label: string
  icon: ReactNode
  onClick: () => void
}) {
  return (
    <button
      aria-pressed={active}
      className={[
        'flex h-8 items-center gap-1.5 rounded-md px-2.5 font-medium text-xs transition-colors',
        active ? 'bg-white/15 text-white' : 'text-white/65 hover:bg-white/8 hover:text-white/95',
      ].join(' ')}
      onClick={onClick}
      title={label}
      type="button"
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

export function PreviewToolbar() {
  const cameraMode = useViewer((s) => s.cameraMode)
  const setCameraMode = useViewer((s) => s.setCameraMode)
  const showGrid = useViewer((s) => s.showGrid)
  const setShowGrid = useViewer((s) => s.setShowGrid)
  const levelMode = useViewer((s) => s.levelMode)
  const setLevelMode = useViewer((s) => s.setLevelMode)
  const wallMode = useViewer((s) => s.wallMode)
  const setWallMode = useViewer((s) => s.setWallMode)

  return (
    <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/60 p-1 shadow-lg backdrop-blur-md">
      <ToolButton
        active={cameraMode === 'orthographic'}
        icon={
          cameraMode === 'perspective' ? (
            <Box className="size-3.5" />
          ) : (
            <Square className="size-3.5" />
          )
        }
        label={cameraMode === 'perspective' ? 'Perspective' : 'Orthographic'}
        onClick={() => setCameraMode(cameraMode === 'perspective' ? 'orthographic' : 'perspective')}
      />

      <span aria-hidden className="mx-0.5 h-5 w-px bg-white/10" />

      <ToolButton
        active={levelMode !== 'stacked'}
        icon={
          levelMode === 'solo' ? <Layers2 className="size-3.5" /> : <Layers className="size-3.5" />
        }
        label={`Levels: ${levelLabel[levelMode]}`}
        onClick={() => setLevelMode(cycle(levelModes, levelMode))}
      />

      <ToolButton
        active={wallMode !== 'up'}
        icon={<ScanLine className="size-3.5" />}
        label={`Walls: ${wallLabel[wallMode]}`}
        onClick={() => setWallMode(cycle(wallModes, wallMode))}
      />

      <span aria-hidden className="mx-0.5 h-5 w-px bg-white/10" />

      <ToolButton
        active={showGrid}
        icon={<Grid2x2 className="size-3.5" />}
        label="Grid"
        onClick={() => setShowGrid(!showGrid)}
      />
    </div>
  )
}

export function FitSceneButton({ onFit }: { onFit: () => void }) {
  return (
    <button
      className="flex h-8 items-center gap-1.5 rounded-xl border border-white/10 bg-black/60 px-3 font-medium text-white/85 text-xs shadow-lg backdrop-blur-md transition-colors hover:bg-black/70 hover:text-white"
      onClick={onFit}
      title="Fit scene"
      type="button"
    >
      <Maximize className="size-3.5" />
      <span className="hidden sm:inline">Fit</span>
    </button>
  )
}

/**
 * Vertical level picker, top-floor first (matches the way you'd read a
 * building section). Highlights `useViewer.selection.levelId` so it
 * stays in sync with the editor's own LevelSystem (e.g. when Solo mode
 * hides every level except the selected one). Hidden when the scene
 * has 0 or 1 levels — no point picking from a list of one.
 */
export function LevelSelector() {
  const nodes = useScene((s) => s.nodes)
  const selection = useViewer((s) => s.selection)
  const setSelection = useViewer((s) => s.setSelection)

  const levels = useMemo(() => {
    const list = Object.values(nodes as Record<string, AnyNode>).filter(
      (n): n is LevelNode => n.type === 'level',
    )
    // Top floor first.
    return list.slice().sort((a, b) => b.level - a.level)
  }, [nodes])

  if (levels.length <= 1) return null

  const selectedId = selection.levelId

  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-white/10 bg-black/60 p-1 shadow-lg backdrop-blur-md">
      {levels.map((level) => {
        const active = level.id === selectedId
        return (
          <button
            aria-pressed={active}
            className={[
              'flex min-w-[88px] items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left font-medium text-xs transition-colors',
              active
                ? 'bg-white/15 text-white'
                : 'text-white/65 hover:bg-white/8 hover:text-white/95',
            ].join(' ')}
            key={level.id}
            onClick={() => setSelection({ levelId: level.id })}
            type="button"
          >
            <span className="truncate">{level.name?.trim() || `Level ${level.level}`}</span>
            <span className="shrink-0 text-[10px] text-white/40">L{level.level}</span>
          </button>
        )
      })}
    </div>
  )
}
