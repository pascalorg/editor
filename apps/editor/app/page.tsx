'use client'

import { Editor, type SidebarTab, ViewerToolbarLeft, ViewerToolbarRight } from '@pascal-app/editor'
import type { ComponentType } from 'react'
import { useHomeEditorOrchestration } from '../lib/use-home-editor-orchestration'

const SIDEBAR_TABS: (SidebarTab & { component: ComponentType })[] = [
  {
    id: 'site',
    label: 'Scene',
    component: () => null, // Built-in SitePanel handles this
  },
  {
    id: 'settings',
    label: 'Settings',
    component: () => null, // Built-in SettingsPanel handles this
  },
]

export default function Home() {
  const { handleLoad } = useHomeEditorOrchestration()

  return (
    <div className="h-screen w-screen">
      <Editor
        layoutVersion="v2"
        onLoad={handleLoad}
        projectId="local-editor"
        sidebarTabs={SIDEBAR_TABS}
        viewerToolbarLeft={<ViewerToolbarLeft />}
        viewerToolbarRight={<ViewerToolbarRight />}
      />
    </div>
  )
}
