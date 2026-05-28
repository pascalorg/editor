'use client'

import { Editor, type SidebarTab, ViewerToolbarLeft, ViewerToolbarRight } from '@pascal-app/editor'
import { HardDrive, Home, Upload } from 'lucide-react'

const SIDEBAR_TABS: (SidebarTab & { component: React.ComponentType })[] = [
  {
    id: 'site',
    label: 'Scene',
    component: () => null,
  },
]

const PROJECT_ID = 'pascal-homeassistant-local'

export default function HomeAssistantAuthoringPage() {
  return (
    <main className="relative h-screen w-screen overflow-hidden">
      <div className="pointer-events-none absolute top-3 left-1/2 z-40 -translate-x-1/2">
        <div className="pointer-events-auto flex max-w-[calc(100vw-1.5rem)] items-center gap-3 rounded-full border border-border/60 bg-background/90 px-4 py-1.5 text-xs shadow-sm backdrop-blur">
          <Home className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
          <span className="truncate text-muted-foreground">
            Pascal Home Assistant
          </span>
          <span aria-hidden className="text-muted-foreground">
            |
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <HardDrive className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Saved in this browser</span>
          </span>
          <span aria-hidden className="text-muted-foreground">
            |
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <Upload className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Export from Smart Home</span>
          </span>
        </div>
      </div>
      <Editor
        homeAssistantApiEnabled={false}
        layoutVersion="v2"
        projectId={PROJECT_ID}
        sidebarTabs={SIDEBAR_TABS}
        viewerToolbarLeft={<ViewerToolbarLeft />}
        viewerToolbarRight={<ViewerToolbarRight />}
      />
    </main>
  )
}
