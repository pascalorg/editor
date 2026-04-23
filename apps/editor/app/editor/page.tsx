'use client'

import {
  Editor,
  type SidebarTab,
  ViewerToolbarLeft,
  ViewerToolbarRight,
  setCollaborationSocket,
} from '@pascal-app/editor'
import { CollaborationBridge } from '@/components/collaboration/CollaborationBridge'
import { getSocket } from '@/lib/socket'
import { useEffect } from 'react'

const SIDEBAR_TABS: (SidebarTab & { component: React.ComponentType })[] = [
  {
    id: 'site',
    label: 'Scene',
    component: () => null, // Built-in SitePanel handles this
  },
]

export default function Home() {
  useEffect(() => {
    const socket = getSocket()
    setCollaborationSocket(socket)
  }, [])

  return (
    <div className="h-screen w-screen">
      <CollaborationBridge projectId="local-editor" userId="user-1" />
      <Editor
        layoutVersion="v2"
        projectId="local-editor"
        sidebarTabs={SIDEBAR_TABS}
        viewerToolbarLeft={<ViewerToolbarLeft />}
        viewerToolbarRight={<ViewerToolbarRight />}
      />
    </div>
  )
}
