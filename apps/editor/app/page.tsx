'use client'

import { Editor, ItemsPanel } from '@pascal-app/editor'
import { PascalWebXRButton } from '@webxr/plugin/pascal-editor'
import { Hammer, Layers, Package, Palette, Settings } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { BuildTab } from '@/components/build-tab'
import { PaintPanel } from '@/components/paint-panel'
import { PoolSectionBanner } from '@/components/pool-section-banner'
import {
  CommunityViewerToolbarLeft,
  CommunityViewerToolbarRight,
} from '@/components/viewer-toolbar'
import {
  useWebXRInstalled,
  WebXRFeatureConsumer,
  WebXRFeatureRuntime,
} from '@/components/webxr-feature-gate'

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
    id: 'paint',
    label: 'Paint',
    component: PaintPanel,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Palette className="h-5 w-5" />,
    icon: (
      <Image
        alt=""
        className="h-8 w-8 object-contain"
        height={32}
        src="/icons/paint.webp"
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
  const webXRInstalled = useWebXRInstalled()
  return (
    <div className="relative h-screen w-screen">
      <WebXRFeatureRuntime enabled={webXRInstalled}>
        <WebXRFeatureConsumer>
          {(vr) => (
            <>
              <Editor
                immersive={vr?.session ? vr.immersive : undefined}
                layoutVersion="v2"
                projectId={PROJECT_ID}
                sidebarTabs={SIDEBAR_TABS}
                viewerBanner={
                  <>
                    <Link
                      className="pointer-events-auto absolute top-14 left-1/2 flex h-8 -translate-x-1/2 items-center rounded-xl border border-border bg-background/90 px-3 font-medium text-foreground text-xs shadow-2xl backdrop-blur-md hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 lg:top-3"
                      href="/scenes"
                    >
                      Saved scenes
                    </Link>
                    <PoolSectionBanner />
                  </>
                }
                viewerToolbarLeft={<CommunityViewerToolbarLeft />}
                viewerToolbarRight={
                  <CommunityViewerToolbarRight
                    vrButton={
                      vr ? (
                        <PascalWebXRButton
                          className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-accent disabled:opacity-50"
                          feature={vr}
                        />
                      ) : null
                    }
                    vrLabel="Enter VR"
                  />
                }
              />
            </>
          )}
        </WebXRFeatureConsumer>
      </WebXRFeatureRuntime>
    </div>
  )
}
