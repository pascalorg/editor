'use client'

// Node registry bootstrap is loaded once at the root via
// `<ClientBootstrap>` in `app/layout.tsx` - no per-page side-effect
// import here.
import {
  AddCatalogPanel,
  applySceneGraphToEditor,
  Editor,
  ItemsPanel,
  type SceneGraph,
  type SidebarTab,
} from '@pascal-app/editor'
import { Bot, Layers, Package, Plus, Settings } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AiAssistantPanel } from './ai-assistant-bubble'
import { ImportDxfTool } from './tools/ImportDxfTool'
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
  },
  {
    id: 'items',
    label: 'Items',
    component: ItemsPanel,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Package className="h-5 w-5" />,
  },
  {
    id: 'add-catalog',
    label: 'Add',
    component: AddCatalogPanel,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Plus className="h-5 w-5" />,
  },
  {
    id: 'ai-assistant',
    label: 'AI',
    component: AiAssistantPanel,
    mobileDefaultSnap: 0.8,
    mobileIcon: <Bot className="h-5 w-5" />,
  },
  {
    id: 'settings',
    label: 'Settings',
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
  const versionRef = useRef(meta.version)
  const lastRemoteGraphJsonRef = useRef<string | null>(null)
  const suppressRemoteSaveUntilRef = useRef(0)
  const [conflict, setConflict] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [dxfOpen, setDxfOpen] = useState(false)

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
          setSaveError(`Save failed (${response.status})`)
          return
        }

        const next = (await response.json()) as SceneMeta
        versionRef.current = next.version
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
      // Stub endpoint is not yet implemented in v0.1 - skip upload for now.
      await fetch(`/api/scenes/${meta.id}/thumbnail`, {
        method: 'POST',
        // Intentionally no body - endpoint is a stub.
      }).catch(() => {
        // Swallow errors silently; thumbnail upload is best-effort.
      })
    },
    [meta.id],
  )

  return (
    <div className="relative h-screen w-screen">
      <div className="pointer-events-none absolute top-3 left-1/2 z-40 -translate-x-1/2">
        <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border/60 bg-background/90 px-4 py-1.5 text-xs shadow-sm backdrop-blur">
          <Link className="font-medium text-foreground hover:underline" href="/scenes">
            Open recent scenes
          </Link>
          <span aria-hidden className="text-muted-foreground">
            |
          </span>
          <Link className="font-medium text-foreground hover:underline" href="/scenes">
            Create new
          </Link>
          <span aria-hidden className="text-muted-foreground">
            |
          </span>
          <Link className="font-medium text-foreground hover:underline" href="/pic-to-3d">
            Image to 3D
          </Link>
          <span aria-hidden className="text-muted-foreground">
            |
          </span>
          <button
            className="font-medium text-foreground hover:underline"
            onClick={() => setDxfOpen(true)}
            type="button"
          >
            Import DXF
          </button>
        </div>
      </div>
      {dxfOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto bg-black/50 pt-16 pb-8 backdrop-blur-sm"
            onClick={(event) => {
              if (event.target === event.currentTarget) setDxfOpen(false)
            }}
          >
            <ImportDxfTool
              onClose={() => setDxfOpen(false)}
              onDone={({ buildingId }) => {
                setDxfOpen(false)
                router.push(`/_pascal/scene/${buildingId}`)
              }}
            />
          </div>,
          document.body,
        )}
      {conflict && (
        <div className="pointer-events-auto absolute top-4 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border border-border bg-background p-4 shadow-xl">
          <h2 className="font-semibold text-sm">Another session saved first - refresh?</h2>
          <p className="mt-1 text-muted-foreground text-xs">
            Your changes haven&apos;t been saved. Reload to pick up the latest version.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              className="rounded-md border border-border bg-accent px-3 py-1.5 font-medium text-xs hover:bg-accent/80"
              onClick={() => router.refresh()}
              type="button"
            >
              Reload
            </button>
            <button
              className="rounded-md border border-border bg-background px-3 py-1.5 font-medium text-xs hover:bg-accent/40"
              onClick={() => setConflict(false)}
              type="button"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {saveError && !conflict && (
        <div className="pointer-events-auto absolute top-4 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border border-destructive/50 bg-background p-3 shadow-xl">
          <p className="font-medium text-destructive text-xs">{saveError}</p>
        </div>
      )}
      <div className="pointer-events-none absolute top-4 right-4 z-40 flex items-center gap-2">
        <Link
          className="pointer-events-auto rounded-md border border-border bg-background/90 px-3 py-1.5 font-medium text-xs shadow-sm backdrop-blur hover:bg-accent/40"
          href="/scenes"
        >
          All scenes
        </Link>
      </div>
      <Editor
        layoutVersion="v2"
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
