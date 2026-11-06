'use client'

import { usePascalI18n } from '@pascal-app/core'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { ReactNode } from 'react'
import { triggerSFX } from './../../../lib/sfx-bus'
import { cn } from './../../../lib/utils'
import { useSidebarStore } from '../primitives/sidebar'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../primitives/tooltip'

export type SidebarTab = {
  id: string
  label: string
  mobileDefaultSnap?: number
  mobileIcon?: ReactNode
  /** Desktop icon shown in the vertical rail (v2 layout). */
  icon?: ReactNode
  /**
   * Rail entry that drives the stage instead of opening a sidebar panel:
   * activating it hides the panel column (preserving its collapse state) and
   * keeps the icon highlighted regardless of collapse.
   */
  noPanel?: boolean
  /** Runs when the entry is picked — with `noPanel`, to put its surface on the stage. */
  onSelect?: () => void
  /**
   * For a `noPanel` entry whose surface can leave the stage on its own (a view
   * closed from the view bar): false once it has, and the rail goes back to
   * the panel that was open before it.
   */
  stageActive?: boolean
  /** Runs when the rail moves from this entry to another: a stage entry takes its surface down. */
  onDeselect?: () => void
}

interface TabBarProps {
  tabs: SidebarTab[]
  activeTab: string
  onTabChange: (id: string) => void
}

export function TabBar({ tabs, activeTab, onTabChange }: TabBarProps) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-0.5 border-border/50 border-b px-2">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id
        return (
          <button
            className={cn(
              'relative h-7 rounded-md px-3 font-medium text-sm transition-colors',
              isActive
                ? 'bg-sidebar-accent text-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground',
            )}
            key={tab.id}
            onClick={() => {
              triggerSFX('sfx:menu-click')
              onTabChange(tab.id)
            }}
            onMouseEnter={() => triggerSFX('sfx:menu-hover')}
            type="button"
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

interface IconRailProps {
  tabs: SidebarTab[]
  /** Highlighted tab. Stays highlighted while the panel is collapsed. */
  activeTab: string
  /** True when the panel beside the rail is collapsed. */
  collapsed: boolean
  /** Clicking a rail icon: switch tab, or toggle the panel (see layout). */
  onIconClick: (id: string) => void
}

/**
 * Vertical rail for the v2 left column. Always visible (even when the panel is
 * collapsed) so the user can reopen the panel by clicking an entry. It shows
 * each tool's name, and can close back to icons for more room, where the name
 * becomes a hover tooltip.
 */
export function IconRail({ tabs, activeTab, collapsed, onIconClick }: IconRailProps) {
  const i18n = usePascalI18n()
  const expanded = useSidebarStore((s) => s.railExpanded)
  const setExpanded = useSidebarStore((s) => s.setRailExpanded)
  const toggleLabel = i18n._(
    expanded
      ? /* i18n */ { id: 'editor.sidebar.rail.collapse', message: 'Hide names' }
      : /* i18n */ { id: 'editor.sidebar.rail.expand', message: 'Show names' },
  )

  const renderTab = (tab: SidebarTab) => {
    const showActive = activeTab === tab.id && (!collapsed || tab.noPanel === true)
    const button = (
      <button
        aria-label={tab.label}
        aria-pressed={showActive}
        className={cn(
          'group flex items-center rounded-xl transition-all duration-200 [&_img]:transition-[opacity,filter] [&_img]:duration-200',
          expanded ? 'h-10 w-full gap-2 px-1.5' : 'h-11 w-11 justify-center',
          showActive
            ? 'bg-sidebar-accent text-foreground shadow-sm [&_img]:opacity-100 [&_img]:grayscale-0'
            : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground [&_img]:opacity-60 [&_img]:grayscale hover:[&_img]:opacity-100 hover:[&_img]:grayscale-0',
        )}
        key={tab.id}
        onClick={() => {
          triggerSFX('sfx:menu-click')
          onIconClick(tab.id)
        }}
        onMouseEnter={() => triggerSFX('sfx:menu-hover')}
        type="button"
      >
        <span className="flex size-8 shrink-0 items-center justify-center">
          {tab.icon ?? tab.label.charAt(0)}
        </span>
        {expanded ? <span className="truncate font-medium text-sm">{tab.label}</span> : null}
      </button>
    )
    if (expanded) return button
    return (
      <Tooltip key={tab.id}>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right">{tab.label}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <TooltipProvider delayDuration={0} disableHoverableContent>
      <div
        className={cn(
          'flex h-full shrink-0 flex-col gap-1 overflow-y-auto border-border/50 border-r py-2',
          expanded ? 'w-40 px-2' : 'w-14 items-center',
        )}
        data-surface="icon-rail"
      >
        {tabs.map(renderTab)}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label={toggleLabel}
              className={cn(
                'mt-auto flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-foreground',
                expanded && 'ml-1.5',
              )}
              onClick={() => setExpanded(!expanded)}
              type="button"
            >
              {expanded ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{toggleLabel}</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )
}
