'use client'

import type { SidebarTab } from '@pascal-app/editor'
import { FolderOpen, Hammer, Layers, Settings } from 'lucide-react'
import Image from 'next/image'
import { BuildTab } from '@/components/build-tab'
import { ScenesTab } from '@/components/scenes-tab'

/**
 * The editor's icon rail, defined once.
 *
 * It was defined twice — once for the root editor and once for a saved scene —
 * and the two drifted: opening a scene silently lost tabs. One list, both
 * mounts.
 *
 * This is a warehouse design tool: the host furniture catalog (couch/appliance/
 * kitchen/bathroom/outdoor — the `ItemsPanel` furnish grid) is deliberately not
 * surfaced here, so no one can drop home furniture into a layout. The warehouse
 * equipment palette is the plugin-warehouse catalog panel, which registers as
 * its own `defaultInstalled` "Warehouse" rail tab (`registerEditorHostPanel`
 * in `lib/bootstrap.ts`) and is the effective furnish surface. The `item` node
 * kind stays registered so existing saved scenes that contain furniture still
 * load and render — only the authoring UI is withheld.
 *
 * `site` and `settings` are built-in panels inside <Editor>; their `component`
 * is never called, which is why it returns null.
 */

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
    id: 'scenes',
    label: 'Scenes',
    component: ScenesTab,
    mobileDefaultSnap: 0.6,
    mobileIcon: <FolderOpen className="h-5 w-5" />,
    // No illustrated asset for a scene library exists in the shared icon set —
    // `collection.webp` was a byte-for-byte copy of `zone.webp` (the floorplan
    // zone tool), so Scenes silently wore the zone icon. Lucide's folder reads
    // unambiguously as "a library of saved things" and matches the mobile rail.
    icon: <FolderOpen className="h-7 w-7" strokeWidth={1.5} />,
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
