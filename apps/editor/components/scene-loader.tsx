'use client'

// Node registry bootstrap is loaded once at the root via
// `<ClientBootstrap>` in `app/layout.tsx` — no per-page side-effect
// import here.
import {
  applySceneGraphToEditor,
  Editor,
  ItemsPanel,
  type SceneGraph,
  type SidebarTab,
} from '@pascal-app/editor'
import { PascalWebXRButton } from '@webxr/plugin/pascal-editor'
import { Hammer, Layers, Package, Palette, Settings } from 'lucide-react'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PoolSectionBanner } from '@/components/pool-section-banner'
import { countGraphNodes, isEmptyGraphOverwrite } from '@/lib/empty-graph-guard'
import { useLocalArtifactStore } from '@/lib/local-artifact-store'
import {
  isPendingSceneGraphEcho,
  type PersistedSceneGraph,
  sceneGraphSignature,
} from '@/lib/scene-signature'
import { useThumbnailAutosave } from '@/lib/use-thumbnail-autosave'
import { BuildTab } from './build-tab'
import { EditorNavbar } from './editor-navbar'
import { KitchenCommands } from './kitchen-browser'
import { PaintPanel } from './paint-panel'
import { EditorViewerToolbarLeft, EditorViewerToolbarRight } from './viewer-toolbar'
import { useWebXRFeature, useWebXRInstalled, WebXRFeatureRuntime } from './webxr-feature-gate'

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

// The open-source editor only ships the built-in catalog (no uploaded items),
// so the item source chips and tag filters add nothing — drop them and keep
// the panel to plain categories.
function EditorItemsPanel() {
  return <ItemsPanel showSourceFilter={false} showTagFilters={false} />
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

export function SceneLoader(props: SceneLoaderProps) {
  const webXRInstalled = useWebXRInstalled()
  // The editor follows its host's `.dark` class, and this app keeps the editor
  // dark: the page root carries it from the first paint, and <body> for the
  // menus and dialogs the editor portals there.
  useEffect(() => {
    document.body.classList.add('dark')
    return () => document.body.classList.remove('dark')
  }, [])
  return (
    <WebXRFeatureRuntime enabled={webXRInstalled}>
      <SceneEditor {...props} />
    </WebXRFeatureRuntime>
  )
}

function SceneEditor({ initialScene, meta: initialMeta }: SceneLoaderProps) {
  // A rename must reach the autosave body, which sends `meta.name`.
  const [renamedTo, setRenamedTo] = useState<string | null>(null)
  const meta = useMemo(
    () => (renamedTo === null ? initialMeta : { ...initialMeta, name: renamedTo }),
    [initialMeta, renamedTo],
  )
  const vr = useWebXRFeature()
  useLocalArtifactStore()
  useThumbnailAutosave({ sceneId: meta.id, enabled: true })
  const router = useRouter()
  const searchParams = useSearchParams()
  const versionRef = useRef(meta.version)
  // Node count of the graph the server is known to hold. Guards against the
  // autosave wipe class: a save fired from a not-yet-hydrated (empty) editor
  // store must never overwrite a populated server copy.
  const serverNodeCountRef = useRef(meta.nodeCount)
  const lastRemoteGraphJsonRef = useRef<string | null>(null)
  const pendingGraphSignaturesRef = useRef(new Set<string>())
  const suppressRemoteSaveUntilRef = useRef(0)
  const [conflict, setConflict] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const lightPreview = isLightPreviewQuery(searchParams)

  const handleLoad = useCallback(async () => initialScene, [initialScene])

  const handleRename = useCallback(
    async (name: string) => {
      try {
        const response = await fetch(`/api/scenes/${meta.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'If-Match': String(versionRef.current),
          },
          body: JSON.stringify({ name }),
        })
        if (response.status === 409) {
          setConflict(true)
          return
        }
        if (!response.ok) {
          setSaveError(`Rename failed (${response.status})`)
          return
        }
        const next = (await response.json()) as SceneMeta
        versionRef.current = next.version
        setRenamedTo(next.name)
        setSaveError(null)
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Rename failed')
      }
    },
    [meta.id],
  )

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

      pendingGraphSignaturesRef.current.add(graphJson)
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
        if (next.version >= versionRef.current) {
          versionRef.current = next.version
          serverNodeCountRef.current = next.nodeCount
        }
        setSaveError(null)
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Save failed')
      } finally {
        pendingGraphSignaturesRef.current.delete(graphJson)
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
      const signature = sceneGraphSignature(payload.graph)
      // SSE can deliver our save before its HTTP response. Reapplying that
      // graph would reset tools and selection while the user keeps editing.
      if (isPendingSceneGraphEcho(payload.graph, pendingGraphSignaturesRef.current)) return
      lastRemoteGraphJsonRef.current = signature
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
    async (blob: Blob, cameraData: { requestId?: string }) => {
      if (cameraData.requestId) return
      await fetch(`/api/scenes/${meta.id}/thumbnail`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/webp' },
        body: blob,
      }).catch(() => {})
    },
    [meta.id],
  )

  return (
    <div className="dark relative h-screen w-screen">
      {conflict && (
        <div className="dark pointer-events-auto absolute top-14 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border border-border bg-background p-4 text-foreground shadow-xl">
          <h2 className="font-semibold text-sm">Another session saved first — refresh?</h2>
          <p className="mt-1 text-muted-foreground text-xs">
            Your changes haven&apos;t been saved. Reload to pick up the latest version.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              className="rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground text-xs hover:bg-primary/90"
              onClick={() => router.refresh()}
              type="button"
            >
              Reload
            </button>
            <button
              className="rounded-lg border border-border px-3 py-1.5 font-medium text-xs hover:bg-accent"
              onClick={() => setConflict(false)}
              type="button"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {saveError && !conflict && (
        <div className="dark pointer-events-auto absolute top-14 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border border-destructive/50 bg-background px-4 py-2 text-center shadow-xl">
          <p className="font-medium text-destructive text-xs">{saveError}</p>
        </div>
      )}
      <KitchenCommands />
      <Editor
        disablePostFx={lightPreview}
        immersive={vr?.session ? vr.immersive : undefined}
        layoutVersion="v2"
        navbarSlot={<EditorNavbar name={meta.name} onRename={handleRename} sceneId={meta.id} />}
        onLoad={handleLoad}
        onSave={handleSave}
        onThumbnailCapture={handleThumb}
        projectId={meta.projectId ?? 'default'}
        projectName={meta.name}
        sidebarTabs={SIDEBAR_TABS}
        viewerBanner={<PoolSectionBanner />}
        viewerToolbarLeft={<EditorViewerToolbarLeft />}
        viewerToolbarRight={
          <EditorViewerToolbarRight
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
    </div>
  )
}
