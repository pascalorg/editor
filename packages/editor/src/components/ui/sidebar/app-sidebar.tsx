'use client'

import { type ReactNode, useEffect, useState } from 'react'
import { CommandPalette } from './../../../components/ui/command-palette'
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  useSidebar,
  useSidebarStore,
} from './../../../components/ui/primitives/sidebar'
import { cn } from './../../../lib/utils'
import { IconRail, type PanelId } from './icon-rail'
import { SettingsPanel, type SettingsPanelProps } from './panels/settings-panel'
import { SitePanel, type SitePanelProps } from './panels/site-panel'

interface AppSidebarProps {
  appMenuButton?: ReactNode
  sidebarTop?: ReactNode
  settingsPanelProps?: SettingsPanelProps
  sitePanelProps?: SitePanelProps
}

export function AppSidebar({
  appMenuButton,
  sidebarTop,
  settingsPanelProps,
  sitePanelProps,
}: AppSidebarProps) {
  const [activePanel, setActivePanel] = useState<PanelId>('site')
  const { open, toggleSidebar } = useSidebar()

  useEffect(() => {
    // Widen default sidebar (288px → 432px) for better project title visibility
    const store = useSidebarStore.getState()
    if (store.width <= 288) {
      store.setWidth(432)
    }
  }, [])

  const renderPanelContent = () => {
    switch (activePanel) {
      case 'site':
        return <SitePanel {...sitePanelProps} />
      case 'settings':
        return <SettingsPanel {...settingsPanelProps} />
      default:
        return null
    }
  }

  return (
    <>
      <Sidebar className={cn('dark text-white')} variant="floating" collapsible="icon">
        <div className="flex h-full">
          {/* Icon Rail */}
          <IconRail
            activePanel={activePanel}
            appMenuButton={appMenuButton}
            onPanelChange={setActivePanel}
          />

          {/* Panel Content */}
          <div className="relative flex flex-1 flex-col overflow-hidden">
            <div
              className={cn(
                'flex flex-1 flex-col overflow-hidden transition-all duration-200 ease-linear',
                !open && 'pointer-events-none w-0 min-w-0 opacity-0',
              )}
            >
              {open && sidebarTop && (
                <SidebarHeader className="relative flex-col items-start justify-center gap-1 border-border/50 border-b px-3 py-3">
                  {sidebarTop}
                </SidebarHeader>
              )}

              {open && (
                <SidebarContent className={cn('no-scrollbar flex flex-1 flex-col overflow-hidden')}>
                  {renderPanelContent()}
                </SidebarContent>
              )}
            </div>
          </div>
        </div>
      </Sidebar>
      <CommandPalette />
    </>
  )
}
