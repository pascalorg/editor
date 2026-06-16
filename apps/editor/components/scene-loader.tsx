'use client'

import { emitter } from '@pascal-app/core'
// Node registry bootstrap is loaded once at the root via
// `<ClientBootstrap>` in `app/layout.tsx` — no per-page side-effect
// import here.
import {
  AiChatPanel,
  applySceneGraphToEditor,
  Editor,
  ItemsPanel,
  type SceneGraph,
  type SidebarTab,
  useEditor,
  useSidebarStore,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Layers, MessageCircle, Package, Settings } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { t } from '@/i18n'
import { CommunityViewerToolbarLeft, CommunityViewerToolbarRight } from './viewer-toolbar'

export interface SceneMeta {
  id: string
  name: string
  projectId: string | null
  thumbnailUrl: string | null
  version: number
  createdAt: string
  updatedAt: string
  ownerId: string | null
  sizeBytes: number
  nodeCount: number
}

const SIDEBAR_TABS = (): (SidebarTab & { component: React.ComponentType })[] => [
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
]

interface SceneLoaderProps {
  initialScene: SceneGraph
  meta: SceneMeta
}

type SceneGraphWithCollections = SceneGraph & {
  collections?: Record<string, unknown>
}

const EMPTY_GRAPH: SceneGraph = {
  nodes: {},
  rootNodeIds: [],
}

interface LiveSceneEvent {
  eventId: number
  sceneId: string
  version: number
  kind: string
  createdAt: string
  graph: SceneGraphWithCollections
}

function sceneGraphSignature(graph: SceneGraphWithCollections): string {
  return JSON.stringify({
    nodes: graph.nodes,
    rootNodeIds: graph.rootNodeIds,
    collections: graph.collections,
  })
}

export function SceneLoader({ initialScene, meta }: SceneLoaderProps) {
  const router = useRouter()
  const sidebarTabs = useMemo(() => SIDEBAR_TABS(), [])
  const versionRef = useRef(meta.version)
  const thumbnailUrlRef = useRef(meta.thumbnailUrl)
  const lastRemoteGraphJsonRef = useRef<string | null>(null)
  const suppressRemoteSaveUntilRef = useRef(0)
  const [conflict, setConflict] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isCreatingScene, setIsCreatingScene] = useState(false)

  useEffect(() => {
    void useEditor.persist.rehydrate()
    void useSidebarStore.persist.rehydrate()
    void useViewer.persist.rehydrate()
  }, [])

  const handleLoad = useCallback(async () => initialScene, [initialScene])

  const handleSave = useCallback(
    async (graph: SceneGraph) => {
      const graphJson = sceneGraphSignature(graph)
      const isRecentRemoteApply = Date.now() < suppressRemoteSaveUntilRef.current
      if (lastRemoteGraphJsonRef.current === graphJson) {
        lastRemoteGraphJsonRef.current = null
        suppressRemoteSaveUntilRef.current = 0
        return
      }
      if (isRecentRemoteApply) return

      try {
        const response = await fetch(`/api/scenes/${meta.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'If-Match': String(versionRef.current),
          },
          body: JSON.stringify({ name: meta.name, graph }),
        })

        if (response.status === 409) {
          setConflict(true)
          return
        }

        if (!response.ok) {
          setSaveError(
            t('save.saveFailed', {
              fallback: 'Save failed ({status})',
              params: { status: response.status },
            }),
          )
          return
        }

        const next = (await response.json()) as SceneMeta
        versionRef.current = next.version
        setSaveError(null)
      } catch (error) {
        setSaveError(
          error instanceof Error
            ? error.message
            : t('save.saveFailed', { fallback: 'Save failed ({status})', params: { status: '' } }),
        )
      }
    },
    [meta.id, meta.name],
  )

  useEffect(() => {
    const source = new EventSource(`/api/scenes/${meta.id}/events`)

    source.addEventListener('scene', (event) => {
      let payload: LiveSceneEvent
      try {
        payload = JSON.parse((event as MessageEvent<string>).data) as LiveSceneEvent
      } catch {
        return
      }
      if (payload.sceneId !== meta.id) return
      if (payload.version <= versionRef.current) return

      versionRef.current = payload.version
      lastRemoteGraphJsonRef.current = sceneGraphSignature(payload.graph)
      suppressRemoteSaveUntilRef.current = Date.now() + 2500
      applySceneGraphToEditor(payload.graph)
      setConflict(false)
      setSaveError(null)
    })

    source.addEventListener('error', () => {
      if (source.readyState === EventSource.CLOSED) {
        setSaveError(t('scene.liveConnectionClosed', 'Live scene connection closed'))
      }
    })

    return () => source.close()
  }, [meta.id])

  const handleThumb = useCallback(
    async (blob: Blob) => {
      const response = await fetch(`/api/scenes/${meta.id}/thumbnail`, {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'image/png' },
        body: blob,
      }).catch(() => null)
      if (!response?.ok) return

      const payload = (await response.json()) as { thumbnailUrl?: string | null; version?: number }
      if (payload.version !== undefined) versionRef.current = payload.version
      thumbnailUrlRef.current = payload.thumbnailUrl ?? null
    },
    [meta.id],
  )

  useEffect(() => {
    if (thumbnailUrlRef.current) return
    const timeout = window.setTimeout(() => {
      emitter.emit('camera-controls:generate-thumbnail', {
        projectId: meta.projectId ?? 'default',
        snapLevels: true,
      })
    }, 1800)
    return () => window.clearTimeout(timeout)
  }, [meta.projectId])

  const handleCreateScene = useCallback(async () => {
    setIsCreatingScene(true)
    setSaveError(null)

    try {
      const response = await fetch('/api/scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: t('save.untitledScene', 'Untitled scene'),
          graph: EMPTY_GRAPH,
        }),
      })

      if (!response.ok) {
        setSaveError(
          t('save.createFailed', {
            fallback: 'Failed to create scene ({status})',
            params: { status: response.status },
          }),
        )
        return
      }

      const next = (await response.json()) as { id: string }
      router.push(`/scene/${next.id}`)
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : t('save.createFailedGeneric', 'Failed to create scene'),
      )
    } finally {
      setIsCreatingScene(false)
    }
  }, [router])

  return (
    <div className="relative h-screen w-screen">
      {conflict && (
        <div className="pointer-events-auto absolute top-4 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border border-border bg-background p-4 shadow-xl">
          <h2 className="font-semibold text-sm">
            {t('scene.conflictTitle', 'Another session saved first — refresh?')}
          </h2>
          <p className="mt-1 text-muted-foreground text-xs">
            {t(
              'scene.conflictDetail',
              "Your changes haven't been saved. Reload to pick up the latest version.",
            )}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              className="rounded-md border border-border bg-accent px-3 py-1.5 font-medium text-xs hover:bg-accent/80"
              onClick={() => router.refresh()}
              type="button"
            >
              {t('common.reload', 'Reload')}
            </button>
            <button
              className="rounded-md border border-border bg-background px-3 py-1.5 font-medium text-xs hover:bg-accent/40"
              onClick={() => setConflict(false)}
              type="button"
            >
              {t('common.dismiss', 'Dismiss')}
            </button>
          </div>
        </div>
      )}
      {saveError && !conflict && (
        <div className="pointer-events-auto absolute top-4 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border border-destructive/50 bg-background p-3 shadow-xl">
          <p className="font-medium text-destructive text-xs">{saveError}</p>
        </div>
      )}
      {!conflict && !saveError && (
        <div className="pointer-events-none absolute top-3 left-1/2 z-40 -translate-x-1/2">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border/60 bg-background/90 px-4 py-1.5 text-xs shadow-sm backdrop-blur">
            <span className="text-muted-foreground">
              {t('scene.autoSaveNotice', '当前场景会自动保存。')}
            </span>
            <Link className="font-medium text-foreground hover:underline" href="/scenes">
              {t('home.openRecentScenes', 'Open recent scenes')}
            </Link>
            <span aria-hidden className="text-muted-foreground">
              ·
            </span>
            <button
              className="font-medium text-foreground hover:underline disabled:cursor-wait disabled:opacity-60"
              disabled={isCreatingScene}
              onClick={handleCreateScene}
              type="button"
            >
              {isCreatingScene
                ? t('common.creating', 'Creating...')
                : t('home.createNew', 'Create new')}
            </button>
          </div>
        </div>
      )}
      <Editor
        layoutVersion="v2"
        onLoad={handleLoad}
        onSave={handleSave}
        onThumbnailCapture={handleThumb}
        projectId={meta.projectId ?? 'default'}
        sidebarTabs={sidebarTabs}
        viewerToolbarLeft={<CommunityViewerToolbarLeft />}
        viewerToolbarRight={<CommunityViewerToolbarRight />}
      />
    </div>
  )
}
