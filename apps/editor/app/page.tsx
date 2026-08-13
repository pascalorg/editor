'use client'

import { Editor, ItemsPanel, useTranslation } from '@pascal-app/editor'
import { Hammer, Layers, Package, Settings } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { BuildTab } from '@/components/build-tab'
import { EditorTopBar, TOP_BAR_ACTION } from '@/components/editor-top-bar'
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

function sidebarTabs(t: (text: string) => string) {
  return [
    {
      id: 'site',
      label: t('Scene'),
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
      label: t('Build'),
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
      label: t('Items'),
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
      label: t('Settings'),
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
  ]
}

const PROJECT_ID = 'local-editor'

export default function Home() {
  const t = useTranslation()

  return (
    <div className="relative h-screen w-screen">
      <Editor
        layoutVersion="v2"
        navbarSlot={
          <EditorTopBar
            actions={
              <Link className={TOP_BAR_ACTION} href="/scenes">
                {t('Saved scenes')}
              </Link>
            }
            status={t('Blank canvas · not saved')}
            title={t('New workspace')}
          />
        }
        projectId={PROJECT_ID}
        sidebarTabs={sidebarTabs(t)}
        viewerToolbarLeft={<CommunityViewerToolbarLeft />}
        viewerToolbarRight={<CommunityViewerToolbarRight />}
      />
    </div>
  )
}
