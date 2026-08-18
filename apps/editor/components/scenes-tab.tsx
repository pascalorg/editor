'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { useSession } from '@/components/auth/session-provider'
import type { SceneMeta } from '@/components/scene-loader'
import { cn } from '@/lib/utils'

/**
 * The scenes rail — a plain, quick switcher: the projects you can open, as a
 * list. Rich management (rename, delete, share, backups, preview, IFC import,
 * admin) deliberately does NOT live here; it lives on the full `/scenes` page,
 * reached by the door at the bottom. The rail stays a fast way to jump between
 * projects without leaving the canvas.
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
  const [busy, setBusy] = useState(false)

  // Which scene is open right now, so the list can say so. Read from the URL
  // rather than passed in: this panel is mounted by both the root editor
  // (no scene) and /scene/[id], and the URL is what actually distinguishes them.
  const currentId =
    typeof window === 'undefined'
      ? null
      : (/^\/scene\/([^/]+)/.exec(window.location.pathname)?.[1] ?? null)

  const canEdit = user !== null && user.role !== 'viewer'

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
    setBusy(true)
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
      setBusy(false)
    }
  }, [openAuth, router, user])

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-muted-foreground text-xs">
          {scenes === null ? 'Scenes' : scenes.length === 1 ? '1 scene' : `${scenes.length} scenes`}
        </span>
        <button
          className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          disabled={busy}
          onClick={() => void load()}
          type="button"
        >
          Refresh
        </button>
      </div>

      {canEdit && (
        <button
          className="flex items-center justify-center rounded-lg bg-muted/40 px-3 py-2 font-medium text-sm transition-colors hover:bg-muted disabled:opacity-50"
          disabled={busy}
          onClick={() => void create()}
          type="button"
        >
          {busy ? 'Creating…' : 'New scene'}
        </button>
      )}

      {error && <p className="text-destructive text-xs">{error}</p>}

      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {scenes === null ? (
          <p className="py-6 text-center text-muted-foreground text-xs">
            {sessionLoading ? '' : 'Loading…'}
          </p>
        ) : scenes.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground text-xs leading-relaxed">
            {canEdit
              ? 'Nothing saved yet. Start a new scene.'
              : 'No scenes have been shared with your account yet.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {scenes.map((scene) => {
              const active = scene.id === currentId
              return (
                <li key={scene.id}>
                  <button
                    className={cn(
                      'block w-full rounded-lg px-2.5 py-2 text-left transition-colors',
                      active ? 'bg-primary/10 ring-1 ring-primary/50' : 'hover:bg-muted/60',
                    )}
                    onClick={() => router.push(`/scene/${scene.id}`)}
                    type="button"
                  >
                    <span className="block truncate font-medium text-sm">{scene.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {scene.nodeCount} nodes · {formatWhen(scene.updatedAt)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/*
        The door to the full scenes page, where rename / delete / share /
        backups / preview / IFC import live. Kept as a plain `<a>` rather than a
        router push: `/scenes` is server-rendered and a full load is what makes
        it show the current list rather than a cached one.
      */}
      <a
        className="rounded-lg bg-muted/40 px-3 py-2 text-center font-medium text-sm transition-colors hover:bg-muted"
        href="/scenes"
      >
        All scenes
      </a>
    </div>
  )
}
