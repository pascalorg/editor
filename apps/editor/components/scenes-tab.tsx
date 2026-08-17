'use client'

import { Eye, History, Pencil, Share2, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from '@/components/auth/session-provider'
import type { SceneMeta } from '@/components/scene-loader'
import { cn } from '@/lib/utils'
import { SceneBackupsDialog } from './scene-backups-dialog'
import { SceneDeleteDialog } from './scene-delete-dialog'
import { ScenePreviewDialog } from './scene-preview-dialog'
import { SceneRenameDialog } from './scene-rename-dialog'
import { SceneShareDialog } from './scene-share-dialog'

/**
 * The scenes library, as a sidebar panel.
 *
 * Everything /scenes offers is here — open, create, import a model, and the
 * way through to administration — so switching scenes no longer means leaving
 * the editor and coming back. The page still exists and still works; this is
 * the same capability where the work is.
 */

interface ScenesResponse {
  scenes: SceneMeta[]
}

export function formatWhen(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const minutes = Math.round((Date.now() - then) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(then).toLocaleDateString()
}

const EMPTY_GRAPH = { nodes: {}, rootNodeIds: [] }

export function ScenesTab() {
  const router = useRouter()
  const { user, loading: sessionLoading, openAuth } = useSession()
  const [scenes, setScenes] = useState<SceneMeta[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{
    kind: 'rename' | 'delete' | 'share' | 'backups' | 'preview'
    scene: SceneMeta
  } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Which scene is open right now, so the list can say so. Read from the URL
  // rather than passed in: this panel is mounted by both the root editor
  // (no scene) and /scene/[id], and the URL is what actually distinguishes them.
  const currentId =
    typeof window === 'undefined'
      ? null
      : (/^\/scene\/([^/]+)/.exec(window.location.pathname)?.[1] ?? null)

  const canEdit = user !== null && user.role !== 'viewer'

  // Owner-or-admin gate for the managing actions (rename, delete, share,
  // backups). Preview only reads the stored thumbnail, so it's open to all.
  const canManage = (scene: SceneMeta): boolean =>
    user != null && (scene.ownerId === user.id || user.role === 'admin')

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch('/api/scenes', { cache: 'no-store' })
      if (response.status === 401) {
        setScenes([])
        return
      }
      if (!response.ok) {
        setError(`Could not load scenes (${response.status})`)
        return
      }
      const body = (await response.json()) as ScenesResponse
      setScenes(body.scenes ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load scenes')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const create = useCallback(async () => {
    if (!user) {
      openAuth()
      return
    }
    setBusy('new')
    setError(null)
    try {
      const response = await fetch('/api/scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Untitled scene', graph: EMPTY_GRAPH }),
      })
      if (response.status === 401) {
        openAuth()
        return
      }
      if (!response.ok) {
        setError(`Could not create a scene (${response.status})`)
        return
      }
      const meta = (await response.json()) as { id: string }
      router.push(`/scene/${meta.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create a scene')
    } finally {
      setBusy(null)
    }
  }, [openAuth, router, user])

  const importIfc = useCallback(
    async (file: File) => {
      setError(null)
      setBusy('Reading file…')
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        setBusy('Loading converter…')
        const { convertIfcToPascal } = await import('@pascal-app/ifc-converter')
        const graph = await convertIfcToPascal(bytes, (message, percent) => {
          setBusy(`${message} (${percent}%)`)
        })
        if (Object.keys(graph.nodes).length === 0) {
          setError('No convertible elements were found in that file.')
          return
        }
        setBusy('Saving…')
        const response = await fetch('/api/scenes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: file.name.replace(/\.ifc$/i, '') || 'Imported model',
            graph: { nodes: graph.nodes, rootNodeIds: graph.rootNodeIds },
          }),
        })
        if (response.status === 401) {
          openAuth()
          return
        }
        if (!response.ok) {
          setError(`Could not save the imported scene (${response.status})`)
          return
        }
        const meta = (await response.json()) as { id: string }
        router.push(`/scene/${meta.id}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not read that IFC file.')
      } finally {
        setBusy(null)
      }
    },
    [openAuth, router],
  )

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-muted-foreground text-xs">
          {scenes === null ? 'Scenes' : scenes.length === 1 ? '1 scene' : `${scenes.length} scenes`}
        </span>
        <button
          className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          disabled={busy !== null}
          onClick={() => void load()}
          type="button"
        >
          Refresh
        </button>
      </div>

      {canEdit && (
        <div className="flex flex-col gap-1.5">
          <button
            className="flex items-center justify-center rounded-lg bg-muted/40 px-3 py-2 font-medium text-sm transition-colors hover:bg-muted disabled:opacity-50"
            disabled={busy !== null}
            onClick={() => void create()}
            type="button"
          >
            {busy === 'new' ? 'Creating…' : 'New scene'}
          </button>
          <input
            accept=".ifc"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void importIfc(file)
            }}
            ref={fileRef}
            type="file"
          />
          <button
            className="flex items-center justify-center rounded-lg bg-muted/40 px-3 py-2 font-medium text-sm transition-colors hover:bg-muted disabled:opacity-50"
            disabled={busy !== null}
            onClick={() => fileRef.current?.click()}
            type="button"
          >
            Import IFC
          </button>
        </div>
      )}

      {busy !== null && busy !== 'new' && <p className="text-muted-foreground text-xs">{busy}</p>}
      {error && <p className="text-destructive text-xs">{error}</p>}

      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {scenes === null ? (
          <p className="py-6 text-center text-muted-foreground text-xs">
            {sessionLoading ? '' : 'Loading…'}
          </p>
        ) : scenes.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground text-xs leading-relaxed">
            {canEdit
              ? 'Nothing saved yet. Start a new scene, or import a model exported from Revit or ArchiCAD.'
              : 'No scenes have been shared with your account yet.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {scenes.map((scene) => {
              const active = scene.id === currentId
              const manage = canManage(scene)
              return (
                <li key={scene.id}>
                  <div
                    className={cn(
                      'overflow-hidden rounded-xl transition-colors',
                      active ? 'bg-primary/10 ring-1 ring-primary/50' : 'bg-muted/40',
                    )}
                  >
                    <button
                      className="block w-full text-left"
                      onClick={() => router.push(`/scene/${scene.id}`)}
                      type="button"
                    >
                      <span className="flex aspect-[16/9] w-full items-center justify-center overflow-hidden bg-background/60">
                        {scene.thumbnailUrl ? (
                          <img
                            alt=""
                            className="h-full w-full object-cover"
                            src={scene.thumbnailUrl}
                          />
                        ) : (
                          <span className="text-[10px] text-muted-foreground">Önizleme yok</span>
                        )}
                      </span>
                      <span className="block px-2.5 pt-2">
                        <span className="block truncate font-medium text-sm">{scene.name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {scene.nodeCount} nodes · {formatWhen(scene.updatedAt)}
                        </span>
                      </span>
                    </button>

                    <div className="flex items-center gap-1 px-2 py-2">
                      {manage && (
                        <button
                          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          onClick={() => setDialog({ kind: 'backups', scene })}
                          title="Yedekler"
                          type="button"
                        >
                          <History className="size-3.5" />
                          Yedekler
                        </button>
                      )}
                      <button
                        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        onClick={() => setDialog({ kind: 'preview', scene })}
                        title="Önizle"
                        type="button"
                      >
                        <Eye className="size-3.5" />
                        Önizle
                      </button>
                      {manage && (
                        <div className="ml-auto flex items-center gap-0.5">
                          <button
                            aria-label="Yeniden adlandır"
                            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            onClick={() => setDialog({ kind: 'rename', scene })}
                            title="Yeniden adlandır"
                            type="button"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            aria-label="Paylaş"
                            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            onClick={() => setDialog({ kind: 'share', scene })}
                            title="Paylaş"
                            type="button"
                          >
                            <Share2 className="size-3.5" />
                          </button>
                          <button
                            aria-label="Sil"
                            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                            onClick={() => setDialog({ kind: 'delete', scene })}
                            title="Sil"
                            type="button"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/*
        The full scenes page, from inside the rail.

        It used to be an "All scenes" link floating over the canvas, which put
        navigation on top of the drawing. The rail is where scenes already live,
        so the door belongs here. Kept as a plain `<a>` rather than a router
        push: `/scenes` is a server-rendered page and a full load is what makes
        it show the current list rather than a cached one.
      */}
      <a
        className="rounded-lg bg-muted/40 px-3 py-2 text-center font-medium text-sm transition-colors hover:bg-muted"
        href="/scenes"
      >
        Open scenes page
      </a>

      {user?.role === 'admin' && (
        <a
          className="rounded-lg bg-muted/40 px-3 py-2 text-center font-medium text-sm transition-colors hover:bg-muted"
          href="/console/scenes"
        >
          Manage in console
        </a>
      )}

      {dialog?.kind === 'rename' && (
        <SceneRenameDialog
          onClose={() => setDialog(null)}
          onRenamed={() => void load()}
          scene={dialog.scene}
        />
      )}
      {dialog?.kind === 'delete' && (
        <SceneDeleteDialog
          onClose={() => setDialog(null)}
          onDeleted={() => {
            const deletedId = dialog.scene.id
            void load()
            if (deletedId === currentId) router.push('/')
          }}
          scene={dialog.scene}
        />
      )}
      {dialog?.kind === 'share' && (
        <SceneShareDialog
          onClose={() => setDialog(null)}
          onSaved={() => void load()}
          scene={dialog.scene}
        />
      )}
      {dialog?.kind === 'backups' && (
        <SceneBackupsDialog
          onClose={() => setDialog(null)}
          onRestored={() => {
            const restoredId = dialog.scene.id
            void load()
            // If the restored scene is the one open now, reload so the editor
            // picks up the restored graph rather than the stale in-memory one.
            if (restoredId === currentId) window.location.reload()
          }}
          scene={dialog.scene}
        />
      )}
      {dialog?.kind === 'preview' && (
        <ScenePreviewDialog onClose={() => setDialog(null)} scene={dialog.scene} />
      )}
    </div>
  )
}
