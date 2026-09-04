'use client'

import { useCallback, useEffect, useState } from 'react'
import type { SceneMeta } from '@/components/scene-loader'
import { SceneModal } from './scene-modal'

type ShareRole = 'viewer' | 'editor'

interface ShareRow {
  userId: string
  role: ShareRole
  email: string | null
}

interface CandidateUser {
  id: string
  email: string
}

interface SharesResponse {
  shares: ShareRow[]
  users: CandidateUser[]
  ownerId: string | null
}

export function SceneShareDialog({
  scene,
  onClose,
  onSaved,
}: {
  scene: SceneMeta
  onClose: () => void
  onSaved: () => void
}) {
  const [users, setUsers] = useState<CandidateUser[]>([])
  const [shares, setShares] = useState<ShareRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [addPick, setAddPick] = useState('')

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch(`/api/scenes/${scene.id}/shares`, { cache: 'no-store' })
      if (response.status === 501) {
        setError('Paylaşım bu kurulumda kullanılamıyor.')
        setLoaded(true)
        return
      }
      if (response.status === 403) {
        setError('Bunu yalnızca proje sahibi veya yönetici yapabilir.')
        setLoaded(true)
        return
      }
      if (!response.ok) {
        setError(`Paylaşımlar yüklenemedi (${response.status})`)
        setLoaded(true)
        return
      }
      const body = (await response.json()) as SharesResponse
      setShares(body.shares ?? [])
      setUsers(body.users ?? [])
      setLoaded(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Paylaşımlar yüklenemedi')
      setLoaded(true)
    }
  }, [scene.id])

  useEffect(() => {
    void load()
  }, [load])

  const candidates = users.filter((user) => !shares.some((share) => share.userId === user.id))

  const emailFor = (userId: string): string =>
    shares.find((share) => share.userId === userId)?.email ??
    users.find((user) => user.id === userId)?.email ??
    userId

  const addShare = () => {
    if (!addPick) return
    const user = users.find((candidate) => candidate.id === addPick)
    if (!user) return
    setShares((prev) => [...prev, { userId: user.id, role: 'viewer', email: user.email }])
    setAddPick('')
  }

  const setRole = (userId: string, role: ShareRole) => {
    setShares((prev) => prev.map((share) => (share.userId === userId ? { ...share, role } : share)))
  }

  const removeShare = (userId: string) => {
    setShares((prev) => prev.filter((share) => share.userId !== userId))
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/scenes/${scene.id}/shares`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shares: shares.map(({ userId, role }) => ({ userId, role })),
        }),
      })
      if (response.status === 403) {
        setError('Bunu yalnızca proje sahibi veya yönetici yapabilir.')
        return
      }
      if (response.status === 501) {
        setError('Paylaşım bu kurulumda kullanılamıyor.')
        return
      }
      if (!response.ok) {
        setError(`Kaydedilemedi (${response.status})`)
        return
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kaydedilemedi')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SceneModal onClose={onClose} title="Paylaş">
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-xs leading-relaxed">
          Bir <span className="font-medium text-foreground">editör</span> sizinle gerçek zamanlı
          birlikte düzenleyebilir; bir <span className="font-medium text-foreground">izleyici</span>{' '}
          yalnızca görüntüleyebilir.
        </p>

        {error && <p className="text-destructive text-xs">{error}</p>}

        {!loaded ? (
          <p className="py-4 text-center text-muted-foreground text-xs">Yükleniyor…</p>
        ) : (
          <>
            {shares.length === 0 ? (
              <p className="text-muted-foreground text-xs">Henüz kimseyle paylaşılmadı.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {shares.map((share) => (
                  <li
                    className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2"
                    key={share.userId}
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {emailFor(share.userId)}
                    </span>
                    <select
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                      onChange={(event) => setRole(share.userId, event.target.value as ShareRole)}
                      value={share.role}
                    >
                      <option value="viewer">İzleyici</option>
                      <option value="editor">Editör</option>
                    </select>
                    <button
                      aria-label="Kaldır"
                      className="rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                      onClick={() => removeShare(share.userId)}
                      type="button"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {candidates.length > 0 && (
              <div className="flex items-center gap-2">
                <select
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  onChange={(event) => setAddPick(event.target.value)}
                  value={addPick}
                >
                  <option value="">Kişi seç…</option>
                  {candidates.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.email}
                    </option>
                  ))}
                </select>
                <button
                  className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:opacity-50"
                  disabled={!addPick}
                  onClick={addShare}
                  type="button"
                >
                  Ekle
                </button>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                className="rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-muted"
                onClick={onClose}
                type="button"
              >
                Vazgeç
              </button>
              <button
                className="rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
                disabled={saving}
                onClick={() => void save()}
                type="button"
              >
                {saving ? 'Kaydediliyor…' : 'Kaydet'}
              </button>
            </div>
          </>
        )}
      </div>
    </SceneModal>
  )
}
