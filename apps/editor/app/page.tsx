'use client'

import { AddCatalogPanel, Editor, ItemsPanel } from '@pascal-app/editor'
import { Bot, Images, Layers, Package, Plus, Settings, Video } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { AiAssistantPanel } from '@/components/ai-assistant-bubble'
import { PanoramaPhotoPanel, WalkthroughVideoPanel } from '@/components/panorama-walkthrough-panel'
import { ImportDxfTool } from '@/components/tools/ImportDxfTool'
import {
  CommunityViewerToolbarLeft,
  CommunityViewerToolbarRight,
} from '@/components/viewer-toolbar'

const SIDEBAR_TABS = [
  {
    id: 'ai-assistant',
    label: 'AI',
    component: AiAssistantPanel,
    mobileDefaultSnap: 0.8,
    mobileIcon: <Bot className="h-5 w-5" />,
  },
  {
    id: 'site',
    label: 'Scene',
    component: () => null,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Layers className="h-5 w-5" />,
  },
  {
    id: 'items',
    label: 'Items',
    component: ItemsPanel,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Package className="h-5 w-5" />,
  },
  {
    id: 'add-catalog',
    label: 'Add',
    component: AddCatalogPanel,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Plus className="h-5 w-5" />,
  },
  {
    id: 'panorama',
    label: '360',
    component: PanoramaPhotoPanel,
    mobileDefaultSnap: 0.7,
    mobileIcon: <Images className="h-5 w-5" />,
  },
  {
    id: 'walkthrough',
    label: 'Walkthrough',
    component: WalkthroughVideoPanel,
    mobileDefaultSnap: 0.7,
    mobileIcon: <Video className="h-5 w-5" />,
  },
  {
    id: 'settings',
    label: 'Settings',
    component: () => null,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Settings className="h-5 w-5" />,
  },
]

const PROJECT_ID = 'local-editor'

export default function Home() {
  const [dxfOpen, setDxfOpen] = useState(false)
  const router = useRouter()

  return (
    <div className="relative h-screen w-screen">
      {PROJECT_ID === 'local-editor' && (
        <div className="pointer-events-none absolute top-3 left-1/2 z-40 -translate-x-1/2">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border/60 bg-background/90 px-4 py-1.5 text-xs shadow-sm backdrop-blur">
            <span className="text-muted-foreground">Local editor - scenes are not saved.</span>
            <Link className="font-medium text-foreground hover:underline" href="/scenes">
              Open recent scenes
            </Link>
            <span aria-hidden className="text-muted-foreground">
              |
            </span>
            <Link className="font-medium text-foreground hover:underline" href="/scenes">
              Create new
            </Link>
            <span aria-hidden className="text-muted-foreground">
              |
            </span>
            <Link className="font-medium text-foreground hover:underline" href="/pic-to-3d">
              Image to 3D
            </Link>
            <span aria-hidden className="text-muted-foreground">
              |
            </span>
            <button
              className="font-medium text-foreground hover:underline"
              onClick={() => setDxfOpen(true)}
              type="button"
            >
              Import DXF
            </button>
          </div>
        </div>
      )}

      {dxfOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto bg-black/50 pt-16 pb-8 backdrop-blur-sm"
            onClick={(event) => {
              if (event.target === event.currentTarget) setDxfOpen(false)
            }}
          >
            <ImportDxfTool
              onClose={() => setDxfOpen(false)}
              onDone={({ buildingId }) => {
                setDxfOpen(false)
                router.push(`/_pascal/scene/${buildingId}`)
              }}
            />
          </div>,
          document.body,
        )}
      <Editor
        layoutVersion="v2"
        projectId={PROJECT_ID}
        sidebarTabs={SIDEBAR_TABS}
        viewerToolbarLeft={<CommunityViewerToolbarLeft />}
        viewerToolbarRight={<CommunityViewerToolbarRight />}
      />
    </div>
  )
}
