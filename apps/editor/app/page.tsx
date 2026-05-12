'use client'

import { Editor, ItemsPanel, type SceneGraph } from '@pascal-app/editor'
import {
  NavigationToolbarButton,
  NavigationViewerFrame,
  prepareNavigationSceneGraph,
} from '@pascal-app/robot/editor'
import { shouldPauseNavigationAutoSave, useNavigation } from '@pascal-app/robot'
import { Layers, Package, Settings } from 'lucide-react'
import Link from 'next/link'
import {
  CommunityViewerToolbarLeft,
  CommunityViewerToolbarRight,
} from '@/components/viewer-toolbar'

const SIDEBAR_TABS = [
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
    id: 'settings',
    label: 'Settings',
    component: () => null,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Settings className="h-5 w-5" />,
  },
]

const PROJECT_ID = 'local-editor'
const LOCAL_STORAGE_SCENE_KEY = 'pascal-editor-scene'

async function loadNavigationSceneFromLocalStorage(): Promise<SceneGraph | null> {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_SCENE_KEY)
    const scene = raw ? (JSON.parse(raw) as SceneGraph) : null
    return prepareNavigationSceneGraph(scene) ?? scene
  } catch {
    return null
  }
}

export default function Home() {
  const robotMode = useNavigation((state) => state.robotMode)

  return (
    <div className="relative h-screen w-screen">
      {PROJECT_ID === 'local-editor' && (
        <div className="pointer-events-none absolute top-3 left-1/2 z-40 -translate-x-1/2">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border/60 bg-background/90 px-4 py-1.5 text-xs shadow-sm backdrop-blur">
            <span className="text-muted-foreground">Local editor — scenes are not saved.</span>
            <Link className="font-medium text-foreground hover:underline" href="/scenes">
              Open recent scenes
            </Link>
            <span aria-hidden className="text-muted-foreground">
              ·
            </span>
            <Link className="font-medium text-foreground hover:underline" href="/scenes">
              Create new
            </Link>
          </div>
        </div>
      )}
      <Editor
        editorInteractionsDisabled={robotMode !== null}
        layoutVersion="v2"
        onLoad={loadNavigationSceneFromLocalStorage}
        projectId={PROJECT_ID}
        renderViewer={(children, props) => (
          <NavigationViewerFrame {...props}>{children}</NavigationViewerFrame>
        )}
        shouldPauseAutoSave={shouldPauseNavigationAutoSave}
        sidebarTabs={SIDEBAR_TABS}
        viewerToolbarLeft={<CommunityViewerToolbarLeft />}
        viewerToolbarRight={<CommunityViewerToolbarRight before={<NavigationToolbarButton />} />}
      />
    </div>
  )
}
