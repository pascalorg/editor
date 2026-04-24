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
import { useSession } from 'next-auth/react'
import { loadProject, saveProject } from '@/app/project/actions'
import { useParams } from 'next/navigation'

const SIDEBAR_TABS: (SidebarTab & { component: React.ComponentType })[] = [
  {
    id: 'site',
    label: 'Scene',
    component: () => null, // Built-in SitePanel handles this
  },
]

export default function EditorPage() {
  const params = useParams()
  const projectId = params.id as string
  const { data: session } = useSession()

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

  // Fallback user id if session is missing
  const userId = (session?.user as any)?.id || 'anonymous'

  return (
    <div className="h-screen w-screen">
      <CollaborationBridge projectId={projectId || 'local-editor'} userId={userId} />
      <Editor
        layoutVersion="v2"
        projectId={projectId}
        sidebarTabs={SIDEBAR_TABS}
        viewerToolbarLeft={<ViewerToolbarLeft />}
        viewerToolbarRight={<ViewerToolbarRight />}
        onLoad={handleLoad}
        onSave={handleSave}
      />
    </div>
  )
}
