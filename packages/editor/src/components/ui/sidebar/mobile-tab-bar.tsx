'use client'

import { cn } from './../../../lib/utils'
import type { SidebarTab } from './tab-bar'

interface MobileTabBarProps {
  tabs: SidebarTab[]
  activeTab: string
  onTabPress: (id: string) => void
}

export function MobileTabBar({ tabs, activeTab, onTabPress }: MobileTabBarProps) {
  return (
    <div
      className="z-50 flex h-14 shrink-0 border-border/50 border-t bg-sidebar text-sidebar-foreground"
      style={{
        // Cap the safe-area inset — iOS Chrome can report its bottom UI bar
        // (50–100px) as part of the safe area which would balloon the tab bar.
        // 34px matches the iPhone home-indicator height (the typical max).
        paddingBottom: 'min(env(safe-area-inset-bottom, 0px), 34px)',
      }}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id
        return (
          <button
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 text-xs transition-colors',
              isActive ? 'text-foreground' : 'text-muted-foreground',
            )}
            key={tab.id}
            onClick={() => onTabPress(tab.id)}
            type="button"
          >
            {tab.mobileIcon ? (
              <span className={cn('flex h-5 w-5 items-center justify-center')}>
                {tab.mobileIcon}
              </span>
            ) : null}
            <span className="font-medium">{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}
