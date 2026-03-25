'use client'

import { type ReactNode, useEffect, useState } from 'react'
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
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
    <Sidebar className={cn('dark text-white')} variant="floating">
      <div className="flex h-full">
        {/* Icon Rail */}
        <IconRail
          activePanel={activePanel}
          appMenuButton={appMenuButton}
          onPanelChange={setActivePanel}
        />

        {/* Panel Content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {sidebarTop && (
            <SidebarHeader className="relative flex-col items-start justify-center gap-1 border-border/50 border-b px-3 py-3">
              {sidebarTop}
            </SidebarHeader>
          )}

          <SidebarContent className={cn('no-scrollbar flex flex-1 flex-col overflow-hidden')}>
            {renderPanelContent()}
          </SidebarContent>
        </div>
      </div>
    </Sidebar>
  )
}
