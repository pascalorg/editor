'use client'

import {
  Editor,
  type SidebarTab,
  setCollaborationSocket,
} from '@pascal-app/editor'
import { EditorToolbarLeft, EditorToolbarRight } from './EditorToolbar'
import { CollaborationBridge } from '@/components/collaboration/CollaborationBridge'
import { getSocket } from '@/lib/socket'
import { useEffect } from 'react'
import { loadProject, saveProject } from '@/app/project/actions'

const SIDEBAR_TABS: (SidebarTab & { component: React.ComponentType })[] = [
  {
    id: 'site',
    label: 'Scene',
    component: () => null, // Built-in SitePanel handles this
  },
]

interface EditorClientProps {
  projectId: string;
  userId: string;
}

export default function EditorClient({ projectId, userId }: EditorClientProps) {
  useEffect(() => {
    const socket = getSocket()
    setCollaborationSocket(socket)
  }, [])

  const handleLoad = async () => {
    if (!projectId) return null;
    const sceneGraph = await loadProject(projectId);
    return sceneGraph;
  }

  const handleSave = async (scene: any) => {
    if (!projectId) return;
    await saveProject(projectId, scene);
  }

  return (
    <div className="h-screen w-screen">
      <CollaborationBridge projectId={projectId || 'local-editor'} userId={userId} />
      <Editor
        layoutVersion="v2"
        projectId={projectId}
        sidebarTabs={SIDEBAR_TABS}
        viewerToolbarLeft={<EditorToolbarLeft />}
        viewerToolbarRight={<EditorToolbarRight />}
        onLoad={handleLoad}
        onSave={handleSave}
      />
    </div>
  )
}
