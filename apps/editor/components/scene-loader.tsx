'use client'

// Node registry bootstrap is loaded once at the root via
// `<ClientBootstrap>` in `app/layout.tsx` — no per-page side-effect
// import here.
import {
  applySceneGraphToEditor,
  Editor,
  type SceneGraph,
  type SidebarTab,
  useTranslations,
} from '@pascal-app/editor'
import { Hammer, Layers, Settings } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { countGraphNodes, isEmptyGraphOverwrite } from '@/lib/empty-graph-guard'
import { type PersistedSceneGraph, sceneGraphSignature } from '@/lib/scene-signature'
import { cn } from '@/lib/utils'
import { BuildTab } from './build-tab'
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

interface SceneLoaderProps {
  initialScene: SceneGraph
  meta: SceneMeta
}

interface LiveSceneEvent {
  eventId: number
  sceneId: string
  version: number
  kind: string
  createdAt: string
  graph: PersistedSceneGraph
}

/**
 * `?disable=postFx` is read at post-processing module load, so it only takes
 * effect on a full page load. Reading it here as well lets the flag survive a
 * client-side navigation, since `disablePostFx` is a live prop.
 */
function isLightPreviewQuery(searchParams: URLSearchParams): boolean {
  const disable = searchParams.get('disable') ?? ''
  return disable.split(',').some((p) => p.trim() === 'postFx')
}

export function SceneLoader({ initialScene, meta }: SceneLoaderProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const versionRef = useRef(meta.version)
  // Node count of the graph the server is known to hold. Guards against the
  // autosave wipe class: a save fired from a not-yet-hydrated (empty) editor
  // store must never overwrite a populated server copy.
  const serverNodeCountRef = useRef(meta.nodeCount)
  const lastRemoteGraphJsonRef = useRef<string | null>(null)
  const suppressRemoteSaveUntilRef = useRef(0)
  const [conflict, setConflict] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const lightPreview = isLightPreviewQuery(searchParams)

  const handleLoad = useCallback(async () => initialScene, [initialScene])

  const handleSave = useCallback(
    async (graph: SceneGraph, options?: { keepalive?: boolean }) => {
      const graphJson = sceneGraphSignature(graph)
      const isRecentRemoteApply = Date.now() < suppressRemoteSaveUntilRef.current
      if (lastRemoteGraphJsonRef.current === graphJson) {
        lastRemoteGraphJsonRef.current = null
        suppressRemoteSaveUntilRef.current = 0
        return
      }
      if (isRecentRemoteApply) return

      // Wipe guard: never PUT an empty graph over a populated server copy.
      // An empty serialization here means the editor store was not hydrated
      // (load in flight or failed), not that the user deleted everything.
      const outgoingNodeCount = countGraphNodes(graph)
      if (isEmptyGraphOverwrite(outgoingNodeCount, serverNodeCountRef.current)) {
        console.error(
          `[scene-loader] Blocked autosave: refusing to overwrite scene ${meta.id} ` +
            `(${serverNodeCountRef.current} nodes on the server) with an empty graph.`,
        )
        setSaveError('Autosave blocked: the editor tried to save an empty scene')
        return
      }

      try {
        const response = await fetch(`/api/scenes/${meta.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'If-Match': String(versionRef.current),
          },
          body: JSON.stringify({ name: meta.name, graph }),
          // `keepalive` lets the request outlive a page unload (the autosave
          // flush on refresh/close). Browsers cap keepalive bodies at 64KB, so
          // only the unload flush opts in — normal debounced saves omit it and
          // can carry arbitrarily large scenes.
          keepalive: options?.keepalive,
        })

        if (response.status === 409) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null
          if (body?.error === 'empty_graph_rejected') {
            // Server-side wipe guard (defense in depth behind the client-side
            // check above) — not a concurrent-session conflict.
            console.error(
              `[scene-loader] Server rejected an empty-graph save for scene ${meta.id}.`,
            )
            setSaveError('Autosave blocked: the editor tried to save an empty scene')
            return
          }
          setConflict(true)
          return
        }

        if (!response.ok) {
          setSaveError(`Save failed (${response.status})`)
          return
        }

        const next = (await response.json()) as SceneMeta
        versionRef.current = next.version
        serverNodeCountRef.current = next.nodeCount
        setSaveError(null)
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Save failed')
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
      serverNodeCountRef.current = countGraphNodes(payload.graph)
      lastRemoteGraphJsonRef.current = sceneGraphSignature(payload.graph)
      suppressRemoteSaveUntilRef.current = Date.now() + 2500
      applySceneGraphToEditor(payload.graph)
      setConflict(false)
      setSaveError(null)
    })

    source.addEventListener('error', () => {
      if (source.readyState === EventSource.CLOSED) {
        setSaveError('Live scene connection closed')
      }
    })

    return () => source.close()
  }, [meta.id])

  const handleThumb = useCallback(
    async (_blob: Blob) => {
      // TODO(phase7): upload thumbnail via POST /api/scenes/[id]/thumbnail.
      // Stub endpoint is not yet implemented in v0.1 — skip upload for now.
      await fetch(`/api/scenes/${meta.id}/thumbnail`, {
        method: 'POST',
        // Intentionally no body — endpoint is a stub.
      }).catch(() => {
        // Swallow errors silently; thumbnail upload is best-effort.
      })
    },
    [meta.id],
  )

  const t = useTranslations()
  const sidebarTabs: (SidebarTab & { component: React.ComponentType })[] = useMemo(
    () => [
      {
        id: 'site',
        label: t('sidebar.scene'),
        component: () => null, // Built-in SitePanel handles this
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
      {conflict && (
        <div className="pointer-events-auto absolute top-4 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border border-border bg-background p-4 shadow-xl">
          <h2 className="font-semibold text-sm">{t('editor.conflictTitle')}</h2>
          <p className="mt-1 text-muted-foreground text-xs">{t('editor.conflictBody')}</p>
          <div className="mt-3 flex items-center gap-2">
            <button
              className="rounded-md border border-border bg-accent px-3 py-1.5 font-medium text-xs hover:bg-accent/80"
              onClick={() => router.refresh()}
              type="button"
            >
              {t('editor.reload')}
            </button>
            <button
              className="rounded-md border border-border bg-background px-3 py-1.5 font-medium text-xs hover:bg-accent/40"
              onClick={() => setConflict(false)}
              type="button"
            >
              {t('editor.dismiss')}
            </button>
          </div>
        </div>
      )}
      {saveError && !conflict && (
        <div className="pointer-events-auto absolute top-4 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border border-destructive/50 bg-background p-3 shadow-xl">
          <p className="font-medium text-destructive text-xs">{saveError}</p>
        </div>
      )}
      <div className="pointer-events-none absolute top-4 right-4 z-40 flex flex-col items-end gap-1 md:top-14 md:flex-row md:items-center md:gap-2">
        <button
          aria-pressed={lightPreview}
          className={cn(
            'pointer-events-auto rounded-md border border-border px-3 py-1.5 font-medium text-xs shadow-sm backdrop-blur',
            lightPreview ? 'bg-accent' : 'bg-background/90 hover:bg-accent/40',
          )}
          onClick={() =>
            router.push(lightPreview ? `/scene/${meta.id}` : `/scene/${meta.id}?disable=postFx`)
          }
          title={t('editor.lightPreviewTitle')}
          type="button"
        >
          {t('editor.lightPreview')}
        </button>
        <Link
          className="pointer-events-auto rounded-md border border-border bg-background/90 px-3 py-1.5 font-medium text-xs shadow-sm backdrop-blur hover:bg-accent/40"
          href="/scenes"
        >
          {t('scenes.allScenes')}
        </Link>
      </div>
      <Editor
        disablePostFx={lightPreview}
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
