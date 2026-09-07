'use client'

import { Editor, ItemsPanel } from '@pascal-app/editor'
import { createViewerXRStore } from '@pascal-app/viewer'
import { useWebXRFeature, WebXRToolbarButton } from '@pascal-local/plugin-webxr'
import { Hammer, Layers, Package, Settings } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
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

const SIDEBAR_TABS = [
  {
    id: 'site',
    label: 'Scene',
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
    label: 'Build',
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
    label: 'Items',
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
    label: 'Settings',
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

const PROJECT_ID = 'local-editor'

export default function Home() {
  const webXR = useWebXRFeature(createViewerXRStore)

  return (
    <div
      className="relative h-screen w-screen"
      data-webxr-input-sources={webXR.inputSources.join(',')}
    >
      {PROJECT_ID === 'local-editor' && webXR.status !== 'active' && (
        <div className="pointer-events-none absolute top-14 left-1/2 z-40 -translate-x-1/2">
          <div className="pointer-events-none flex max-w-[min(92vw,42rem)] flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full border border-border/60 bg-background/90 px-4 py-1.5 text-xs shadow-sm backdrop-blur">
            <span className="text-muted-foreground">
              Blank canvas — saved scenes are under Scenes (not this page).
            </span>
            <Link
              className="pointer-events-auto font-medium text-foreground hover:underline"
              href="/scenes"
            >
              Open saved scenes
            </Link>
          </div>
        </div>
      )}
      <Editor
        forceWebGL={webXR.enabled}
        immersivePresentation={webXR.status === 'active'}
        layoutVersion="v2"
        projectId={PROJECT_ID}
        sidebarTabs={SIDEBAR_TABS}
        viewerToolbarLeft={<CommunityViewerToolbarLeft />}
        viewerToolbarRight={
          <CommunityViewerToolbarRight pluginActions={<WebXRToolbarButton feature={webXR} />} />
        }
        xr={webXR.xr}
      />
    </div>
  )
}
