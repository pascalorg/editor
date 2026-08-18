'use client'

import { Box, Columns2, Map as MapIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { normalizeViewerStageModes, type ViewerStageMode } from './viewer-stage-modes'

export type { ViewerStageMode } from './viewer-stage-modes'

export type ViewerStageSwitcherProps = {
  className?: string
  hideSplitOnMobile?: boolean
  mode: ViewerStageMode
  modes?: readonly ViewerStageMode[]
  onChange: (mode: ViewerStageMode) => void
}

export function ViewerStageSwitcher({
  className,
  hideSplitOnMobile = true,
  mode,
  modes,
  onChange,
}: ViewerStageSwitcherProps) {
  const enabledModes = normalizeViewerStageModes(modes)

  return (
    <div
      aria-label="Viewer layout"
      className={cn(
        'dark absolute top-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-neutral-950/82 p-1 text-white shadow-elevation-4 backdrop-blur-xl',
        className,
      )}
      role="group"
    >
      {enabledModes.includes('3d') ? (
        <StageButton
          active={mode === '3d'}
          icon={<Box />}
          label="3D"
          onClick={() => onChange('3d')}
        />
      ) : null}
      {enabledModes.includes('2d') ? (
        <StageButton
          active={mode === '2d'}
          icon={<MapIcon />}
          label="2D"
          onClick={() => onChange('2d')}
        />
      ) : null}
      {enabledModes.includes('split') ? (
        <StageButton
          active={mode === 'split'}
          className={hideSplitOnMobile && enabledModes.length > 1 ? 'hidden md:flex' : undefined}
          icon={<Columns2 />}
          label="Split"
          onClick={() => onChange('split')}
        />
      ) : null}
    </div>
  )
}

function StageButton({
  active,
  className,
  icon,
  label,
  onClick,
}: {
  active: boolean
  className?: string
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        'flex h-8 items-center gap-1.5 rounded-full px-3 font-medium text-xs',
        active
          ? 'bg-white text-neutral-950 shadow-sm'
          : 'text-neutral-300 transition-colors hover:bg-white/10 hover:text-white',
        className,
      )}
      onClick={onClick}
      type="button"
    >
      <span className="[&>svg]:size-3.5">{icon}</span>
      {label}
    </button>
  )
}
