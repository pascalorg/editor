'use client'

import {
  acquireSceneReadOnlyLease,
  Editor,
  QuantitiesPanel,
  type SceneGraph,
  type SidebarTab,
  SunStudyPanel,
  useTranslation,
} from '@pascal-app/editor'
import { Layers, Sigma, Sun } from 'lucide-react'
import Image from 'next/image'
import { useCallback, useEffect, useRef, useState } from 'react'
import { TopBarAuth } from './auth/top-bar-auth'
import { EditorTopBar } from './editor-top-bar'
import { CommunityViewerToolbarLeft, CommunityViewerToolbarRight } from './viewer-toolbar'

export type SharedSceneMeta = {
  name: string
  version: number
}

/**
 * No Build tab. The scene is locked by the read-only lease, so a build tool
 * would arm, follow the cursor, and place nothing — an affordance that looks
 * broken rather than absent.
 */
const SHARED_SIDEBAR_TABS: (SidebarTab & { component: React.ComponentType })[] = [
  {
    id: 'site',
    label: 'Scene',
    component: () => null, // Built-in SitePanel handles this — comments live here.
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
    id: 'sun',
    label: 'Sun',
    component: SunStudyPanel,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Sun className="h-5 w-5" />,
    icon: <Sun className="h-5 w-5" />,
  },
  {
    id: 'quantities',
    label: 'Quantities',
    component: QuantitiesPanel,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Sigma className="h-5 w-5" />,
    icon: <Sigma className="h-5 w-5" />,
  },
]

/**
 * The editor as a view-only reviewer sees it through a share link: navigate,
 * measure, read and leave comments — no edits.
 *
 * The lock is `acquireSceneReadOnlyLease()`, the same mechanism version preview
 * uses, and comment actions are deliberately exempt from it in `useScene` —
 * that exemption is what makes this page useful rather than just a viewer.
 *
 * Saving is narrowed to match: `onSave` posts the comment bag alone to a
 * token-authorized endpoint, and the server replaces only that bag. Neither
 * side trusts the other to keep the visitor out of the model.
 */
export function SharedSceneLoader({
  initialScene,
  meta,
  token,
}: {
  initialScene: SceneGraph
  meta: SharedSceneMeta
  token: string
}) {
  const t = useTranslation()
  const [saveError, setSaveError] = useState<string | null>(null)
  const lastSentRef = useRef<string | null>(null)

  useEffect(() => acquireSceneReadOnlyLease(), [])

  const handleLoad = useCallback(async () => initialScene, [initialScene])

  const handleSave = useCallback(
    async (graph: SceneGraph, options?: { keepalive?: boolean }) => {
      const comments = (graph as { comments?: Record<string, unknown> }).comments ?? {}
      const body = JSON.stringify({ comments })
      // The editor's autosave fires on any tracked change; under the read-only
      // lease the only one that can happen is a comment, but a redundant PUT
      // still costs a scene write for every unrelated store touch.
      if (lastSentRef.current === body) return
      lastSentRef.current = body

      try {
        const response = await fetch(`/api/share/${encodeURIComponent(token)}/comments`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: options?.keepalive,
        })
        if (!response.ok) {
          // Let the next change retry: a conflict here means the owner saved
          // between our read and write, not that the comment was rejected.
          lastSentRef.current = null
          setSaveError(
            response.status === 409 ? 'Comment not saved — try again' : 'Comment not saved',
          )
          return
        }
        setSaveError(null)
      } catch {
        lastSentRef.current = null
        setSaveError('Comment not saved')
      }
    },
    [token],
  )

  return (
    <div className="relative h-screen w-screen">
      {saveError && (
        <div className="pointer-events-auto absolute top-4 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border border-destructive/50 bg-background p-3 shadow-xl">
          <p className="font-medium text-destructive text-xs">{t(saveError)}</p>
        </div>
      )}
      <Editor
        layoutVersion="v2"
        navbarSlot={
          <EditorTopBar status={t('View only')} title={meta.name} actions={<TopBarAuth />} />
        }
        onLoad={handleLoad}
        onSave={handleSave}
        projectId="shared"
        sidebarTabs={SHARED_SIDEBAR_TABS}
        viewerToolbarLeft={<CommunityViewerToolbarLeft />}
        viewerToolbarRight={<CommunityViewerToolbarRight />}
      />
    </div>
  )
}
