'use client'

// Node registry bootstrap is loaded once at the root via
// `<ClientBootstrap>` in `app/layout.tsx` — no per-page side-effect
// import here.
import {
  Editor,
  QuantitiesPanel,
  receiveAgentSceneChange,
  type SceneGraph,
  type SidebarTab,
  SunStudyPanel,
  useAgentActivity,
  useTranslation,
} from '@pascal-app/editor'
import { Hammer, Layers, Sigma, Sun } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type PersistedSceneGraph,
  sceneGraphSignature,
  sceneModelSignature,
} from '@/lib/scene-signature'
import { cn } from '@/lib/utils'
import { BuildTab } from './build-tab'
import { EditorTopBar, TOP_BAR_ACTION } from './editor-top-bar'
import { ShareLinkButton } from './share-link-button'
import { useAgentPrompts } from './use-agent-prompts'
import { useSceneCollaboration } from './use-scene-collaboration'
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

const SIDEBAR_TABS: (SidebarTab & { component: React.ComponentType })[] = [
  {
    id: 'site',
    label: 'Scene',
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
  const t = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const versionRef = useRef(meta.version)
  const authoritativeGraphJsonRef = useRef(sceneGraphSignature(initialScene))
  const authoritativeModelJsonRef = useRef(sceneModelSignature(initialScene))
  const [conflict, setConflict] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [liveVersion, setLiveVersion] = useState(meta.version)

  const lightPreview = isLightPreviewQuery(searchParams)

  const handleLoad = useCallback(async () => initialScene, [initialScene])

  const handleAuthoritativeGraph = useCallback((event: LiveSceneEvent) => {
    const graphJson = sceneGraphSignature(event.graph)
    authoritativeGraphJsonRef.current = graphJson
    authoritativeModelJsonRef.current = sceneModelSignature(event.graph)
    setLiveVersion(event.version)
    setConflict(false)
    setSaveError(null)
  }, [])
  useAgentPrompts(meta.id)

  const { receiveCollaborationEvent, waitForCollaboration } = useSceneCollaboration({
    initialGraph: initialScene,
    sceneId: meta.id,
    versionRef,
    onAuthoritativeGraph: handleAuthoritativeGraph,
    onError: setSaveError,
  })

  const handleSave = useCallback(
    async (graph: SceneGraph, options?: { keepalive?: boolean }) => {
      await waitForCollaboration()
      const graphJson = sceneGraphSignature(graph)
      if (graphJson === authoritativeGraphJsonRef.current) return
      if (sceneModelSignature(graph) !== authoritativeModelJsonRef.current) return

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
          setConflict(true)
          return
        }

        if (!response.ok) {
          setSaveError(`Save failed (${response.status})`)
          return
        }

        const next = (await response.json()) as SceneMeta
        versionRef.current = next.version
        setLiveVersion(next.version)
        authoritativeGraphJsonRef.current = graphJson
        authoritativeModelJsonRef.current = sceneModelSignature(graph)
        setSaveError(null)
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Save failed')
      }
    },
    [meta.id, meta.name, waitForCollaboration],
  )

  useEffect(() => {
    const source = new EventSource(`/api/scenes/${meta.id}/events`)
    const activity = useAgentActivity.getState()
    activity.setConnected(true)

    source.addEventListener('scene', (event) => {
      let payload: LiveSceneEvent
      try {
        payload = JSON.parse((event as MessageEvent<string>).data) as LiveSceneEvent
      } catch {
        return
      }
      if (payload.sceneId !== meta.id) return
      if (payload.version <= versionRef.current) return

      if (payload.kind.startsWith('collaboration:')) {
        receiveCollaborationEvent(payload as LiveSceneEvent & { graph: SceneGraph })
        return
      }

      versionRef.current = payload.version
      setLiveVersion(payload.version)
      // Echo bookkeeping only advances for a change we actually applied. A
      // held proposal must leave it alone, or accepting it later reads as a
      // local edit and gets saved back over the agent's own version.
      const applied = receiveAgentSceneChange({
        eventId: payload.eventId,
        kind: payload.kind,
        version: payload.version,
        graph: payload.graph,
      })
      if (applied) {
        const graphJson = sceneGraphSignature(payload.graph)
        authoritativeGraphJsonRef.current = graphJson
        authoritativeModelJsonRef.current = sceneModelSignature(payload.graph)
      }
      setConflict(false)
      setSaveError(null)
    })

    source.addEventListener('error', () => {
      if (source.readyState === EventSource.CLOSED) {
        useAgentActivity.getState().setConnected(false)
        setSaveError('Live scene connection closed')
      }
    })

    return () => {
      useAgentActivity.getState().setConnected(false)
      source.close()
    }
  }, [meta.id, receiveCollaborationEvent])

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

  return (
    <div className="relative h-screen w-screen">
      {conflict && (
        <div className="pointer-events-auto absolute top-4 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border border-border bg-background p-4 shadow-xl">
          <h2 className="font-semibold text-sm">{t('Another session saved first — refresh?')}</h2>
          <p className="mt-1 text-muted-foreground text-xs">
            {t("Your changes haven't been saved. Reload to pick up the latest version.")}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              className="rounded-md border border-border bg-accent px-3 py-1.5 font-medium text-xs hover:bg-accent/80"
              onClick={() => router.refresh()}
              type="button"
            >
              {t('Reload')}
            </button>
            <button
              className="rounded-md border border-border bg-background px-3 py-1.5 font-medium text-xs hover:bg-accent/40"
              onClick={() => setConflict(false)}
              type="button"
            >
              {t('Dismiss')}
            </button>
          </div>
        </div>
      )}
      {saveError && !conflict && (
        <div className="pointer-events-auto absolute top-4 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border border-destructive/50 bg-background p-3 shadow-xl">
          <p className="font-medium text-destructive text-xs">{t(saveError)}</p>
        </div>
      )}
      <Editor
        disablePostFx={lightPreview}
        layoutVersion="v2"
        navbarSlot={
          <EditorTopBar
            actions={
              <>
                <button
                  aria-pressed={lightPreview}
                  className={cn(TOP_BAR_ACTION, lightPreview && 'bg-accent text-foreground')}
                  onClick={() =>
                    router.push(
                      lightPreview ? `/scene/${meta.id}` : `/scene/${meta.id}?disable=postFx`,
                    )
                  }
                  title={t(
                    'Skips post-processing — lighter on the GPU, without ambient shading or selection outlines',
                  )}
                  type="button"
                >
                  {t('Light preview')}
                </button>
                <ShareLinkButton sceneId={meta.id} />
                <Link className={TOP_BAR_ACTION} href="/scenes">
                  {t('Saved scenes')}
                </Link>
              </>
            }
            status={saveError ? t('Not saved') : `${t('Version')} ${liveVersion}`}
            title={meta.name}
          />
        }
        onLoad={handleLoad}
        onSave={handleSave}
        onThumbnailCapture={handleThumb}
        projectId={meta.projectId ?? 'default'}
        sidebarTabs={SIDEBAR_TABS}
        viewerToolbarLeft={<CommunityViewerToolbarLeft />}
        viewerToolbarRight={<CommunityViewerToolbarRight />}
      />
    </div>
  )
}
