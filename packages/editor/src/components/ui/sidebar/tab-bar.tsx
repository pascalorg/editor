'use client'

import type { ReactNode } from 'react'
import { cn } from './../../../lib/utils'

export type SidebarTab = {
  id: string
  label: string
  mobileDefaultSnap?: number
  mobileIcon?: ReactNode
  /** Desktop icon shown in the vertical rail (v2 layout). */
  icon?: ReactNode
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
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
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
 * Vertical icon rail for the v2 left column. Always visible (even when the
 * panel is collapsed) so the user can reopen the panel by clicking an icon.
 * The label renders as a hover tooltip via the native `title`.
 */
export function IconRail({ tabs, activeTab, collapsed, onIconClick }: IconRailProps) {
  return (
    <div className="flex h-full w-12 shrink-0 flex-col items-center gap-1 border-border/50 border-r py-2">
      {tabs.map((tab) => {
        // While expanded, the active tab is filled. While collapsed, nothing
        // is "open", so the active tab reads as a muted highlight instead.
        const isActive = activeTab === tab.id
        return (
          <button
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
              isActive && !collapsed
                ? 'bg-accent text-foreground'
                : isActive
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
            key={tab.id}
            onClick={() => onIconClick(tab.id)}
            title={tab.label}
            type="button"
          >
            {tab.icon ?? tab.label.charAt(0)}
          </button>
        )
      })}
    </div>
  )
}
