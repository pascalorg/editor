'use client'

import { AiChatPanel, Editor, ItemsPanel } from '@pascal-app/editor'
import { Layers, MessageCircle, Package, Settings } from 'lucide-react'
import Link from 'next/link'
import { useMemo } from 'react'
import {
  CommunityViewerToolbarLeft,
  CommunityViewerToolbarRight,
} from '@/components/viewer-toolbar'
import { t } from '@/i18n'

const PROJECT_ID = 'local-editor'

export default function Home() {
  const sidebarTabs = useMemo(
    () => [
      {
        id: 'ai',
        label: t('sidebar.ai', 'AI'),
        component: AiChatPanel,
        mobileDefaultSnap: 0.5,
        mobileIcon: <MessageCircle className="h-5 w-5" />,
      },
      {
        id: 'site',
        label: t('sidebar.scene', 'Scene'),
        component: () => null,
        mobileDefaultSnap: 0.5,
        mobileIcon: <Layers className="h-5 w-5" />,
      },
      {
        id: 'items',
        label: t('sidebar.items', 'Items'),
        component: ItemsPanel,
        mobileDefaultSnap: 0.5,
        mobileIcon: <Package className="h-5 w-5" />,
      },
      {
        id: 'settings',
        label: t('sidebar.settings', 'Settings'),
        component: () => null,
        mobileDefaultSnap: 0.5,
        mobileIcon: <Settings className="h-5 w-5" />,
      },
    ],
    [],
  )

  return (
    <div className="relative h-screen w-screen">
      {PROJECT_ID === 'local-editor' && (
        <div className="pointer-events-none absolute top-3 left-1/2 z-40 -translate-x-1/2">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border/60 bg-background/90 px-4 py-1.5 text-xs shadow-sm backdrop-blur">
            <span className="text-muted-foreground">
              {t('home.localEditorNotice', 'Local editor — scenes are not saved.')}
            </span>
            <Link className="font-medium text-foreground hover:underline" href="/scenes">
              {t('home.openRecentScenes', 'Open recent scenes')}
            </Link>
            <span aria-hidden className="text-muted-foreground">
              ·
            </span>
            <Link className="font-medium text-foreground hover:underline" href="/scenes">
              {t('home.createNew', 'Create new')}
            </Link>
          </div>
        </div>
      )}
      <Editor
        layoutVersion="v2"
        projectId={PROJECT_ID}
        sidebarTabs={sidebarTabs}
        viewerToolbarLeft={<CommunityViewerToolbarLeft />}
        viewerToolbarRight={<CommunityViewerToolbarRight />}
      />
    </div>
  )
}
