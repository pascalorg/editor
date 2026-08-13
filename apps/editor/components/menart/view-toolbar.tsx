'use client'

import Image from 'next/image'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import {
  ChevronsLeftIcon,
  EyeIcon,
  MagnetIcon,
  RulerIcon,
  SlidersIcon,
  SplitIcon,
  StackIcon,
} from './icons'
import type { CanvasTool, ViewMode } from './types'

interface ToolbarButtonProps {
  active?: boolean
  /** Ink marks a view choice; accent marks an armed tool. */
  tone?: 'ink' | 'accent'
  divider: 'left' | 'right'
  onClick?: () => void
  title?: string
  children: ReactNode
}

function ToolbarButton({
  active = false,
  tone = 'ink',
  divider,
  onClick,
  title,
  children,
}: ToolbarButtonProps) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        'flex h-10 items-center gap-[7px] border-[var(--rule)] px-3.5 font-semibold text-[13px]',
        divider === 'left' ? 'border-l' : 'border-r',
        active &&
          tone === 'ink' &&
          'bg-[var(--surface)] text-[var(--ink)] shadow-[inset_0_-3px_0_var(--ink)]',
        active &&
          tone === 'accent' &&
          'bg-[var(--accent-soft)] text-[var(--ink)] shadow-[inset_0_-3px_0_var(--accent)]',
        !active && 'text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]',
      )}
      onClick={onClick}
      title={title}
      type="button"
    >
      {children}
    </button>
  )
}

function ToolbarIconButton({
  divider,
  onClick,
  title,
  children,
}: Omit<ToolbarButtonProps, 'active' | 'tone'>) {
  return (
    <button
      className={cn(
        'flex h-10 w-10 items-center justify-center border-[var(--rule)] text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]',
        divider === 'left' ? 'border-l' : 'border-r',
      )}
      onClick={onClick}
      title={title}
      type="button"
    >
      {children}
    </button>
  )
}

function ToolbarImage({ active, name, size }: { active: boolean; name: string; size: number }) {
  return (
    <Image
      alt=""
      className={cn('object-contain', !active && 'opacity-60 grayscale')}
      height={size}
      src={`/icons/${name}.webp`}
      style={{ height: size, width: size }}
      width={size}
    />
  )
}

export interface ViewToolbarProps {
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  tool: CanvasTool
  onToolChange: (tool: CanvasTool) => void
  panelCollapsed: boolean
  onTogglePanel: () => void
}

export function ViewToolbar({
  viewMode,
  onViewModeChange,
  tool,
  onToolChange,
  panelCollapsed,
  onTogglePanel,
}: ViewToolbarProps) {
  const toggleTool = (next: NonNullable<CanvasTool>) => onToolChange(tool === next ? null : next)

  return (
    <div className="pointer-events-none absolute top-0 right-0 left-0 z-20 flex items-stretch justify-between border-[var(--rule-strong)] border-b-2 bg-[var(--ground)]">
      <div className="pointer-events-auto flex items-stretch">
        <ToolbarIconButton
          divider="right"
          onClick={onTogglePanel}
          title={panelCollapsed ? 'Paneli aç' : 'Paneli daralt'}
        >
          <ChevronsLeftIcon className={cn(panelCollapsed && 'rotate-180')} size={16} />
        </ToolbarIconButton>

        <ToolbarButton
          active={viewMode === '3d'}
          divider="right"
          onClick={() => onViewModeChange('3d')}
        >
          <ToolbarImage active={viewMode === '3d'} name="building" size={16} />
          <span>3D</span>
        </ToolbarButton>

        <ToolbarButton
          active={viewMode === '2d'}
          divider="right"
          onClick={() => onViewModeChange('2d')}
        >
          <ToolbarImage active={viewMode === '2d'} name="blueprint" size={16} />
          <span>2D</span>
        </ToolbarButton>

        <ToolbarButton
          active={viewMode === 'split'}
          divider="right"
          onClick={() => onViewModeChange('split')}
        >
          <SplitIcon size={14} />
          <span>Bölünmüş</span>
        </ToolbarButton>
      </div>

      <div className="pointer-events-auto flex items-stretch">
        <ToolbarButton divider="left" title="Kat yığınını göster">
          <StackIcon size={15} />
          <span>Yığın</span>
        </ToolbarButton>

        <ToolbarButton
          active={tool === 'section'}
          divider="left"
          onClick={() => toggleTool('section')}
          tone="accent"
        >
          <ToolbarImage active={tool === 'section'} name="wallcut" size={17} />
          <span>Kesit</span>
        </ToolbarButton>

        <ToolbarButton
          active={tool === 'measure'}
          divider="left"
          onClick={() => toggleTool('measure')}
          tone="accent"
        >
          <RulerIcon size={15} />
          <span>Ölçü</span>
        </ToolbarButton>

        <ToolbarButton divider="left" title="Görünüm ayarları">
          <SlidersIcon size={15} />
          <span>Görünüm</span>
        </ToolbarButton>

        <ToolbarIconButton divider="left" title="Yakalama">
          <MagnetIcon size={16} />
        </ToolbarIconButton>

        <ToolbarButton divider="left" title="Sunum önizlemesi">
          <EyeIcon size={15} />
          <span>Önizleme</span>
        </ToolbarButton>
      </div>
    </div>
  )
}
