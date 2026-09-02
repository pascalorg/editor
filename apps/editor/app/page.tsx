'use client'

import { Editor, ItemsPanel, useTranslations } from '@pascal-app/editor'
import { Hammer, Layers, Package, Settings } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useMemo } from 'react'
import { BuildTab } from '@/components/build-tab'
import {
  CommunityViewerToolbarLeft,
  CommunityViewerToolbarRight,
} from '@/components/viewer-toolbar'

// The open-source editor only ships the built-in catalog (no uploaded items),
// so the Library/Community/Mine source chips and tag filters add nothing —
// drop them and keep the panel to plain categories.
function EditorItemsPanel() {
  return <ItemsPanel showSourceFilter={false} showTagFilters={false} />
}

const PROJECT_ID = 'local-editor'

export default function Home() {
  const t = useTranslations()
  const SIDEBAR_TABS = useMemo(
    () => [
      {
        id: 'site',
        label: t('sidebar.scene'),
        component: () => null,
        mobileDefaultSnap: 0.5,
        mobileIcon: <Layers className="h-5 w-5" />,
        icon: (
          <Image
            alt=""
            className="h-8 w-8 object-contain"
            height={32}
            src="/icons/scene.webp"
            width={32}
          />
        ),
      },
      {
        id: 'build',
        label: t('sidebar.build'),
        component: BuildTab,
        mobileDefaultSnap: 0.5,
        mobileIcon: <Hammer className="h-5 w-5" />,
        icon: (
          <Image
            alt=""
            className="h-8 w-8 object-contain"
            height={32}
            src="/icons/build.webp"
            width={32}
          />
        ),
      },
      {
        id: 'items',
        label: t('sidebar.items'),
        component: EditorItemsPanel,
        mobileDefaultSnap: 0.5,
        mobileIcon: <Package className="h-5 w-5" />,
        icon: (
          <Image
            alt=""
            className="h-8 w-8 object-contain"
            height={32}
            src="/icons/couch.webp"
            width={32}
          />
        ),
      },
      {
        id: 'settings',
        label: t('sidebar.settings'),
        component: () => null,
        mobileDefaultSnap: 0.5,
        mobileIcon: <Settings className="h-5 w-5" />,
        icon: (
          <Image
            alt=""
            className="h-8 w-8 object-contain"
            height={32}
            src="/icons/settings.webp"
            width={32}
          />
        ),
      },
    ],
    [t],
  )

  return (
    <div className="relative h-screen w-screen">
      {PROJECT_ID === 'local-editor' && (
        <div className="pointer-events-none absolute top-14 left-1/2 z-40 -translate-x-1/2">
          <div className="pointer-events-none flex max-w-[min(92vw,42rem)] flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full border border-border/60 bg-background/90 px-4 py-1.5 text-xs shadow-sm backdrop-blur">
            <span className="text-muted-foreground">{t('editor.localWarning')}</span>
            <Link
              className="pointer-events-auto font-medium text-foreground hover:underline"
              href="/scenes"
            >
              {t('editor.openSavedScenes')}
            </Link>
          </div>
        </div>
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
