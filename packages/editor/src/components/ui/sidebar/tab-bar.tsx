'use client'

import type { ReactNode } from 'react'
import { cn } from './../../../lib/utils'

export type SidebarTab = {
  id: string
  label: string
  icon?: ReactNode
  mobileDefaultSnap?: number
  mobileIcon?: ReactNode
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
            aria-pressed={isActive}
            className={cn(
              'relative h-7 rounded-md px-3 font-medium text-sm transition-colors',
              isActive
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
            data-testid={`sidebar-tab-${tab.id}`}
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
