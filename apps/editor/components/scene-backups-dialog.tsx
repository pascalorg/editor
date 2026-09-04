'use client'

import { useCallback, useEffect, useState } from 'react'
import type { SceneMeta } from '@/components/scene-loader'
import { SceneModal } from './scene-modal'
import { formatWhen } from './scenes-tab'

interface RevisionItem {
  version: number
  createdAt: string
  authorKind: string
  nodeCount: number
  sizeBytes: number
}

interface RevisionsResponse {
  current: number
  revisions: RevisionItem[]
}

export function SceneBackupsDialog({
  scene,
  onClose,
  onRestored,
}: {
  scene: SceneMeta
  onClose: () => void
  /** Called after a successful restore, with whether this scene is open now. */
  onRestored: () => void
}) {
  const [revisions, setRevisions] = useState<RevisionItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<number | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch(`/api/scenes/${scene.id}/revisions`, { cache: 'no-store' })
      if (response.status === 501) {
        setError('Yedekler bu kurulumda kullanılamıyor.')
        setRevisions([])
        return
      }
      if (!response.ok) {
        setError(`Yedekler yüklenemedi (${response.status})`)
        setRevisions([])
        return
      }
      const body = (await response.json()) as RevisionsResponse
      setRevisions(body.revisions ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Yedekler yüklenemedi')
      setRevisions([])
    }
  }, [scene.id])

  useEffect(() => {
    void load()
  }, [load])

  const restore = async (version: number) => {
    if (!window.confirm('Bu sürüme geri dönülsün mü? Mevcut hâliniz yedeklerde kalır.')) return
    setRestoring(version)
    setError(null)
    try {
      const response = await fetch(`/api/scenes/${scene.id}/revisions/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version }),
      })
      if (response.status === 409) {
        setError('Proje bu sırada değişti, lütfen tekrar deneyin.')
        void load()
        return
      }
      if (!response.ok) {
        setError(`Geri yüklenemedi (${response.status})`)
        return
      }
      onRestored()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Geri yüklenemedi')
    } finally {
      setRestoring(null)
    }
  }

  return (
    <SceneModal onClose={onClose} title="Yedekler">
      {error && <p className="mb-2 text-destructive text-xs">{error}</p>}
      {revisions === null ? (
        <p className="py-6 text-center text-muted-foreground text-xs">Yükleniyor…</p>
      ) : revisions.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground text-xs">Henüz yedek yok.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {revisions.map((revision) => (
            <li
              className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2"
              key={revision.version}
            >
              <span className="min-w-0">
                <span className="block text-sm">{formatWhen(revision.createdAt)}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {revision.nodeCount} nodes
                </span>
              </span>
              <button
                className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs transition-colors hover:bg-muted disabled:opacity-50"
                disabled={restoring !== null}
                onClick={() => void restore(revision.version)}
                type="button"
              >
                {restoring === revision.version ? 'Geri yükleniyor…' : 'Geri yükle'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </SceneModal>
  )
}
