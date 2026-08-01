'use client'

import { ItemsPanel, type SidebarTab } from '@pascal-app/editor'
import { FolderOpen, Hammer, Layers, Package, Settings } from 'lucide-react'
import Image from 'next/image'
import { BuildTab } from '@/components/build-tab'
import { ScenesTab } from '@/components/scenes-tab'

/**
 * The editor's icon rail, defined once.
 *
 * It was defined twice — once for the root editor and once for a saved scene —
 * and the two drifted: opening a scene silently lost Items and Settings. One
 * list, both mounts.
 *
 * `site` and `settings` are built-in panels inside <Editor>; their `component`
 * is never called, which is why it returns null.
 */

// The open-source editor only ships the built-in catalog (no uploaded items),
// so the Library/Community/Mine source chips and tag filters add nothing —
// drop them and keep the panel to plain categories.
function EditorItemsPanel() {
  return <ItemsPanel showSourceFilter={false} showTagFilters={false} />
}

function railIcon(src: string) {
  return <Image alt="" className="h-8 w-8 object-contain" height={32} src={src} width={32} />
}

export const EDITOR_SIDEBAR_TABS: (SidebarTab & { component: React.ComponentType })[] = [
  {
    id: 'site',
    label: 'Scene',
    component: () => null,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Layers className="h-5 w-5" />,
    icon: railIcon('/icons/scene.webp'),
  },
  {
    id: 'build',
    label: 'Build',
    component: BuildTab,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Hammer className="h-5 w-5" />,
    icon: railIcon('/icons/build.webp'),
  },
  {
    id: 'items',
    label: 'Items',
    component: EditorItemsPanel,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Package className="h-5 w-5" />,
    icon: railIcon('/icons/couch.webp'),
  },
  {
    id: 'scenes',
    label: 'Scenes',
    component: ScenesTab,
    mobileDefaultSnap: 0.6,
    mobileIcon: <FolderOpen className="h-5 w-5" />,
    icon: railIcon('/icons/collection.webp'),
  },
  {
    id: 'settings',
    label: 'Settings',
    component: () => null,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Settings className="h-5 w-5" />,
    icon: railIcon('/icons/settings.webp'),
  },
]
