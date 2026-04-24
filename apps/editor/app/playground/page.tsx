'use client'

import {
  Editor,
  type SidebarTab,
  setCollaborationSocket,
} from '@pascal-app/editor'
import { EditorToolbarLeft, EditorToolbarRight } from '../editor/[id]/EditorToolbar'
import { CollaborationBridge } from '@/components/collaboration/CollaborationBridge'
import { getSocket } from '@/lib/socket'
import { useEffect, useState } from 'react'
import { LayoutDashboard, Home, Share2 } from 'lucide-react'
import Link from 'next/link'

const SIDEBAR_TABS: (SidebarTab & { component: React.ComponentType })[] = [
  {
    id: 'site',
    label: 'Scene',
    component: () => null, // Built-in SitePanel handles this
  },
]

export default function PlaygroundPage() {
  const [projectId] = useState('playground-' + Math.random().toString(36).substring(7))
  const [userId] = useState('guest-' + Math.random().toString(36).substring(7))

  useEffect(() => {
    const socket = getSocket()
    setCollaborationSocket(socket)
  }, [])

  const handleLoad = async () => {
    const saved = localStorage.getItem('pascal-playground-state')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch (e) {
        return null
      }
    }
    return null
  }

  const handleSave = async (scene: any) => {
    localStorage.setItem('pascal-playground-state', JSON.stringify(scene))
  }

  return (
    <div className="h-screen w-screen relative bg-[#050505]">
      {/* Absolute Overlay for Home Button */}
      <div className="absolute top-3 left-3 z-[100] pointer-events-none flex items-center gap-2">
        <Link
          href="/"
          className="pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-xl border border-white/10 bg-[#0a0a0a] px-3 text-xs font-bold text-zinc-400 shadow-2xl backdrop-blur-md transition-colors hover:bg-white/5 hover:text-white"
        >
          <Home className="h-3.5 w-3.5 shrink-0" />
          <span>Home</span>
        </Link>
        <div className="h-4 w-px bg-white/10 mx-1" />
        <div className="px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-[10px] font-bold text-indigo-400 uppercase tracking-wider">
          Playground Mode
        </div>
      </div>

      {/* Share/Sign up CTA for playground */}
      <div className="absolute top-3 right-1/2 translate-x-1/2 z-[100] pointer-events-none hidden md:flex">
         <Link href="/apply" className="pointer-events-auto px-4 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white text-[11px] font-bold rounded-full transition-all shadow-lg shadow-indigo-500/20 flex items-center gap-2">
           <Share2 className="w-3 h-3" /> Save your work permanently →
         </Link>
      </div>

      <CollaborationBridge projectId={projectId} userId={userId} />
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
