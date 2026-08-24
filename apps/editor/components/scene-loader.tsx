'use client'

import { WarehouseStatsTab } from '@ovurrsl/plugin-warehouse'
// Node registry bootstrap is loaded once at the root via
// `<ClientBootstrap>` in `app/layout.tsx` — no per-page side-effect
// import here.
import { applySceneGraphToEditor, Editor, type SceneGraph, useEditor } from '@pascal-app/editor'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AccountSettingsSection } from '@/components/account-settings-section'
import { useSession } from '@/components/auth/session-provider'
import { type PersistedSceneGraph, sceneGraphSignature } from '@/lib/scene-signature'
import { EDITOR_SIDEBAR_TABS } from './editor-sidebar-tabs'
import { PresenceBar } from './presence-bar'
import { useScenePresence } from './use-scene-presence'
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

// Card previews are stored inline in the scenes row, so they must stay small:
// a ~256px JPEG at moderate quality is a few KB and reads clearly at card size.
const THUMBNAIL_MAX_DIM = 256
const THUMBNAIL_QUALITY = 0.55
const THUMBNAIL_MAX_CHARS = 60_000

/**
 * Shrinks a captured snapshot to a small JPEG data URL. Runs in the browser
 * (canvas), returns null if a 2D context is unavailable.
 */
async function downscaleToDataUrl(
  blob: Blob,
  maxDim: number,
  quality: number,
): Promise<string | null> {
  const bitmap = await createImageBitmap(blob)
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', quality)
  } finally {
    bitmap.close?.()
  }
}

interface SceneLoaderProps {
  initialScene: SceneGraph
  meta: SceneMeta
  /**
   * View-only account: the scene opens in preview and nothing is ever saved.
   * The server refuses a viewer's writes anyway (403) — this stops the client
   * from attempting them and from showing editing affordances on load.
   */
  readOnly?: boolean
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

export function SceneLoader({ initialScene, meta, readOnly = false }: SceneLoaderProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const versionRef = useRef(meta.version)
  const lastRemoteGraphJsonRef = useRef<string | null>(null)
  const suppressRemoteSaveUntilRef = useRef(0)
  const [conflict, setConflict] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const { openAuth } = useSession()

  const presence = useScenePresence(meta.id, true)
  // Before presence loads, fall back to the server `readOnly` prop so an
  // editable canvas never flashes for someone who is not the lease holder.
  const forcedReadOnly = presence.loaded ? !presence.canEdit || !presence.isEditor : readOnly
  const forcedReadOnlyRef = useRef(forcedReadOnly)
  useEffect(() => {
    forcedReadOnlyRef.current = forcedReadOnly
  }, [forcedReadOnly])

  useEffect(() => {
    if (forcedReadOnly) {
      useEditor.getState().setPreviewMode(true)
      // A forced viewer must stay in preview even if the viewer overlay's
      // "back" button tries to exit it — re-assert on any store change.
      const unsub = useEditor.subscribe((s) => {
        if (!s.isPreviewMode) useEditor.getState().setPreviewMode(true)
      })
      return unsub
    }
    useEditor.getState().setPreviewMode(false)
  }, [forcedReadOnly])

  const lightPreview = isLightPreviewQuery(searchParams)

  const handleLoad = useCallback(async () => initialScene, [initialScene])

  const handleSave = useCallback(
    async (graph: SceneGraph, options?: { keepalive?: boolean }) => {
      if (forcedReadOnlyRef.current) return
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

        if (response.status === 401) {
          setSaveError('Sign in to save your changes.')
          openAuth()
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
    [meta.id, meta.name, openAuth],
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
    async (blob: Blob) => {
      // A non-lease holder never owns the scene write; the server would refuse it.
      if (forcedReadOnlyRef.current) return
      try {
        const dataUrl = await downscaleToDataUrl(blob, THUMBNAIL_MAX_DIM, THUMBNAIL_QUALITY)
        // The thumbnail lives inline in the scenes row (a TEXT column); an
        // oversized data URL would be rejected server-side, so drop it here
        // rather than send a doomed request.
        if (!dataUrl || dataUrl.length > THUMBNAIL_MAX_CHARS) return
        await fetch(`/api/scenes/${meta.id}/thumbnail`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl }),
        })
      } catch {
        // Best-effort: a missing card preview is not worth surfacing an error.
      }
    },
    [meta.id],
  )

  return (
    <div className="relative h-screen w-screen">
      {presence.loaded &&
        (presence.present.length > 1 || (presence.canEdit && !presence.isEditor)) && (
          <PresenceBar
            canEdit={presence.canEdit}
            editor={presence.editor}
            isEditor={presence.isEditor}
            onTakeOver={presence.takeOver}
            present={presence.present}
          />
        )}
      {conflict && (
        <div className="pointer-events-auto absolute top-4 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border border-border bg-background p-4 shadow-xl">
          <h2 className="font-semibold text-sm">Another session saved first — refresh?</h2>
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
      {/*
        "Light preview" and "All scenes" used to float over the canvas here and
        are gone. Both were navigation sitting on top of the drawing: the first
        reloaded the page onto `?disable=postFx`, the second linked to `/scenes`
        — and the Scenes rail already answers the second from inside the editor,
        without leaving it.

        `disablePostFx` below is unaffected. `?disable=postFx` is still read
        (`isLightPreviewQuery`), so the flag keeps working for anyone measuring
        GPU cost; what went away is a permanent button for a diagnostic.
      */}
      <Editor
        disablePostFx={lightPreview}
        layoutVersion="v2"
        onLoad={handleLoad}
        onSave={handleSave}
        onThumbnailCapture={handleThumb}
        projectId={meta.projectId ?? 'default'}
        settingsPanelProps={{ accountSection: <AccountSettingsSection /> }}
        sitePanelProps={{ children: <WarehouseStatsTab /> }}
        sidebarTabs={EDITOR_SIDEBAR_TABS}
        viewerToolbarLeft={<CommunityViewerToolbarLeft />}
        viewerToolbarRight={<CommunityViewerToolbarRight />}
      />
    </div>
  )
}
