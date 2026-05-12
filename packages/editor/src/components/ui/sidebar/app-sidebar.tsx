'use client'

import { type ReactNode, useEffect } from 'react'
import {
  CommandPalette,
  type CommandPaletteEmptyAction,
} from './../../../components/ui/command-palette'
import { EditorCommands } from './../../../components/ui/command-palette/editor-commands'
import {
  SidebarContent,
  SidebarHeader,
  useSidebarStore,
} from './../../../components/ui/primitives/sidebar'
import { cn } from './../../../lib/utils'
import useEditor from './../../../store/use-editor'
import { type ExtraPanel, IconRail } from './icon-rail'
import { SettingsPanel, type SettingsPanelProps } from './panels/settings-panel'
import { SitePanel, type SitePanelProps } from './panels/site-panel'

interface AppSidebarProps {
  appMenuButton?: ReactNode
  sidebarTop?: ReactNode
  settingsPanelProps?: SettingsPanelProps
  sitePanelProps?: SitePanelProps
  extraPanels?: ExtraPanel[]
  commandPaletteEmptyAction?: CommandPaletteEmptyAction
}

export function AppSidebar({
  appMenuButton,
  sidebarTop,
  settingsPanelProps,
  sitePanelProps,
  extraPanels,
  commandPaletteEmptyAction,
}: AppSidebarProps) {
  const activePanel = useEditor((s) => s.activeSidebarPanel)
  const setActivePanel = useEditor((s) => s.setActiveSidebarPanel)
  const hasActivePanel =
    activePanel === 'site' ||
    activePanel === 'settings' ||
    Boolean(extraPanels?.some((panel) => panel.id === activePanel))

  useEffect(() => {
    // Widen default sidebar (288px → 432px) for better project title visibility
    const store = useSidebarStore.getState()
    if (store.width <= 288) {
      store.setWidth(432)
    }
  }, [])

  useEffect(() => {
    if (!hasActivePanel) {
      setActivePanel('site')
    }
  }, [hasActivePanel, setActivePanel])

  const renderPanelContent = () => {
    switch (activePanel) {
      case 'site':
        return <SitePanel {...sitePanelProps} />
      case 'settings':
        return <SettingsPanel {...settingsPanelProps} />
      default: {
        const extra = extraPanels?.find((p) => p.id === activePanel)
        if (extra) {
          const Component = extra.component
          return <Component />
        }
        return <SitePanel {...sitePanelProps} />
      }
    }
  }

  return (
    <>
      <div className={cn('dark flex h-full w-full bg-sidebar text-sidebar-foreground')}>
        {/* Icon Rail */}
        <IconRail
          activePanel={activePanel}
          appMenuButton={appMenuButton}
          extraPanels={extraPanels}
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
      <EditorCommands />
      <CommandPalette emptyAction={commandPaletteEmptyAction} />
    </>
  )
}
