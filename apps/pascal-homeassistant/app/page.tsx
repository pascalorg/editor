'use client'

import { Editor, type SidebarTab, ViewerToolbarLeft, ViewerToolbarRight } from '@pascal-app/editor'
import { HardDrive, Home, Upload } from 'lucide-react'

const SIDEBAR_TABS: (SidebarTab & { component: React.ComponentType })[] = [
  {
    id: 'site',
    label: 'Scene',
    component: () => null,
  },
  {
    id: 'settings',
    label: 'Settings',
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
      <section className="pointer-events-auto absolute top-14 right-3 z-30 w-[min(24rem,calc(100vw-1.5rem))] rounded-lg border border-border/60 bg-background/95 px-4 py-3 text-xs shadow-sm backdrop-blur">
        <h2 className="mb-2 text-sm font-semibold text-foreground">Quick setup:</h2>
        <ol className="list-decimal space-y-1.5 pl-4 text-muted-foreground">
          <li>Create and export your house using Pascal below.</li>
          <li>
            Set up HACS in Home Assistant and add the custom repository{' '}
            <a
              className="text-cyan-300 underline-offset-2 hover:underline"
              href="https://github.com/Niutels/editor/tree/dev-lovelace"
              rel="noreferrer"
              target="_blank"
            >
              https://github.com/Niutels/editor/tree/dev-lovelace
            </a>
            .
          </li>
          <li>
            In a dashboard, add the Pascal Viewer card and copy/paste the export from Pascal
            into it.
          </li>
          <li>Bind your smart devices in the editor view and save.</li>
        </ol>
      </section>
      <Editor
        layoutVersion="v2"
        projectId={PROJECT_ID}
        sidebarTabs={SIDEBAR_TABS}
        viewerToolbarLeft={<ViewerToolbarLeft />}
        viewerToolbarRight={<ViewerToolbarRight />}
      />
    </main>
  )
}
