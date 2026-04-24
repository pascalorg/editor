'use client'

import {
  Editor,
  type SidebarTab,
  YjsCollaborationProvider,
} from '@pascal-app/editor'
import { EditorToolbarLeft, EditorToolbarRight } from './EditorToolbar'
import { getSocket } from '@/lib/socket'

import { useEffect } from 'react'
import { loadProject, saveProject } from '@/app/project/actions'
import { LayoutDashboard } from 'lucide-react'
import Link from 'next/link'

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
    <div className="h-screen w-screen relative">
      {/* Absolute Overlay for Dashboard Button */}
      <div className="absolute top-3 left-3 z-[100] pointer-events-none flex items-center gap-2">
        <Link
          href="/dashboard/projects"
          className="pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-xl border border-indigo-500/50 bg-[#0a0a0a] px-3 text-xs font-bold text-indigo-400 shadow-2xl backdrop-blur-md transition-colors hover:bg-indigo-500/20 hover:text-indigo-300"
        >
          <LayoutDashboard className="h-3.5 w-3.5 shrink-0" />
          <span>Dashboard</span>
        </Link>
      </div>

      <YjsCollaborationProvider 
        projectId={projectId || 'local-editor'} 
        userId={userId} 
        socket={getSocket()}
      >
        <Editor
          layoutVersion="v2"
          projectId={projectId}
          sidebarTabs={SIDEBAR_TABS}
          viewerToolbarLeft={<EditorToolbarLeft />}
          viewerToolbarRight={<EditorToolbarRight />}
          onLoad={handleLoad}
          onSave={handleSave}
        />
      </YjsCollaborationProvider>

    </div>
  )
}
