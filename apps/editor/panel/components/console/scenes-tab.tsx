'use client'

import { useApp } from '@panel/components/app-providers'
import { Button, SegBar, SegButton } from '@panel/components/ui/controls'
import { Dialog, Toast } from '@panel/components/ui/feedback'
import { call } from '@panel/lib/client-api'
import { formatDate } from '@panel/lib/i18n'
import { useCallback, useEffect, useState } from 'react'

type ShareRole = 'viewer' | 'editor'
interface SceneShareRow {
  userId: string
  role: ShareRole
  email: string | null
}
interface SceneSharesPayload {
  shares: SceneShareRow[]
  users: { id: string; email: string }[]
  ownerId: string | null
}

/**
 * The 3D scenes on the server: every scene, its owner, reassignment and the
 * one-shot adoption of ownerless legacy scenes. This screen replaced the
 * editor's standalone /admin page, so scene administration lives with the
 * rest of the console. The endpoints are the editor's — they exist only in
 * the combined deployment, which is the only place this tab is reachable.
 */

interface AdminSceneRow {
  id: string
  name: string
  ownerId: string | null
  ownerEmail: string | null
  updatedAt: string
  nodeCount: number
  /** Approved: it carries a card on Sites & Projects. */
  published: boolean
}

const ACTION =
  'cursor-pointer rounded-[6px] border border-border bg-field px-[9px] py-[4px] font-medium text-[11.5px] text-fg transition-colors hover:bg-hover disabled:opacity-50'

interface AdminScenesPayload {
  scenes: AdminSceneRow[]
  users: { id: string; email: string }[]
  adminId: string
}

export function ScenesTab() {
  const { t, lang } = useApp()

  const [data, setData] = useState<AdminScenesPayload | null>(null)
  const [sharing, setSharing] = useState<AdminSceneRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null)

  const notify = useCallback((message: string, tone: 'success' | 'error') => {
    setToast({ message, tone })
    setTimeout(() => setToast(null), 2600)
  }, [])

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/scenes', { credentials: 'same-origin' })
      if (response.ok) setData((await response.json()) as AdminScenesPayload)
    } catch {
      /* the empty state below covers it */
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const post = useCallback(
    async (url: string, body: unknown) => {
      setBusy(true)
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(body),
        })
        if (!response.ok) {
          notify(t.scSaveFailed, 'error')
          return
        }
        notify(t.scSaved, 'success')
        await load()
      } catch {
        notify(t.scSaveFailed, 'error')
      } finally {
        setBusy(false)
      }
    },
    [load, notify, t],
  )

  const scenes = data?.scenes ?? []
  const unowned = scenes.filter((s) => !s.ownerId).length

  return (
    <section className="flex min-w-0 flex-col gap-[14px]" style={{ animation: 'dtFade 0.2s ease' }}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-[2px]">
          <h2 className="m-0 font-semibold text-[15.5px] tracking-[-0.01em]">{t.scTitle}</h2>
          <p className="m-0 text-muted-fg text-xs">{t.scLead}</p>
        </div>
        {unowned > 0 && data ? (
          <button
            className="cursor-pointer rounded-[8px] border border-border bg-surface px-3 py-[7px] font-medium text-[12px] text-fg transition-colors hover:bg-hover disabled:opacity-50"
            disabled={busy}
            onClick={() => post('/api/admin/scenes/adopt-unowned', { ownerId: data.adminId })}
            type="button"
          >
            {t.scAdopt} ({unowned})
          </button>
        ) : null}
      </header>

      <div className="overflow-x-auto rounded-[12px] border border-border bg-surface">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-border border-b text-left font-mono text-[9.5px] text-muted-fg uppercase tracking-[0.12em]">
              <th className="px-[13px] py-[9px] font-medium">{t.scScene}</th>
              <th className="px-[13px] py-[9px] font-medium">{t.scOwner}</th>
              <th className="px-[13px] py-[9px] font-medium">{t.scNodes}</th>
              <th className="px-[13px] py-[9px] font-medium">{t.scUpdated}</th>
              <th className="px-[13px] py-[9px] font-medium">{t.scStatus}</th>
              <th className="px-[13px] py-[9px]" />
            </tr>
          </thead>
          <tbody>
            {scenes.map((scene) => (
              <tr
                className="border-border-soft border-t transition-colors hover:bg-hover"
                key={scene.id}
              >
                <td className="px-[13px] py-[9px] font-medium text-fg">{scene.name}</td>
                <td className="px-[13px] py-[9px]">
                  <select
                    className="cursor-pointer rounded-[6px] border border-border bg-field px-2 py-1 text-[11.5px] text-fg disabled:opacity-50"
                    defaultValue={scene.ownerId ?? ''}
                    disabled={busy}
                    onChange={(event) =>
                      post(`/api/admin/scenes/${scene.id}/owner`, {
                        ownerId: event.target.value === '' ? null : event.target.value,
                      })
                    }
                  >
                    <option value="">{t.scUnowned}</option>
                    {(data?.users ?? []).map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.email}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-[13px] py-[9px] text-muted-fg">{scene.nodeCount}</td>
                <td className="px-[13px] py-[9px] font-mono text-[11px] text-muted-fg">
                  {formatDate(lang, scene.updatedAt)}
                </td>
                <td className="px-[13px] py-[9px]">
                  <span
                    className={`rounded-[4px] border px-[6px] py-px font-mono text-[9.5px] tracking-[0.1em] uppercase ${
                      scene.published
                        ? 'border-brand/40 text-brand-fg'
                        : 'border-border text-muted-fg'
                    }`}
                  >
                    {scene.published ? t.scPublished : t.scDraft}
                  </span>
                </td>
                <td className="px-[13px] py-[9px] text-right">
                  <div className="flex flex-wrap justify-end gap-[6px]">
                    <button
                      className={ACTION}
                      disabled={busy}
                      onClick={() =>
                        post('/api/admin/scenes/publish', {
                          sceneId: scene.id,
                          publish: !scene.published,
                        })
                      }
                      type="button"
                    >
                      {scene.published ? t.scUnpublish : t.scPublish}
                    </button>
                    <button
                      className={ACTION}
                      disabled={busy}
                      onClick={() => setSharing(scene)}
                      type="button"
                    >
                      {lang === 'tr' ? 'Paylaş' : 'Share'}
                    </button>
                    <button
                      className={ACTION}
                      disabled={busy}
                      onClick={() => {
                        const name = window.prompt(t.scRenamePrompt, scene.name)?.trim()
                        if (name && name !== scene.name) {
                          void post(`/api/admin/scenes/${scene.id}/manage`, {
                            action: 'rename',
                            name,
                          })
                        }
                      }}
                      type="button"
                    >
                      {t.scRename}
                    </button>
                    <button
                      className={ACTION}
                      disabled={busy}
                      onClick={() =>
                        post(`/api/admin/scenes/${scene.id}/manage`, { action: 'duplicate' })
                      }
                      type="button"
                    >
                      {t.scDuplicate}
                    </button>
                    <button
                      className="cursor-pointer rounded-[6px] border border-destructive/40 px-[9px] py-[4px] font-medium text-[11.5px] text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(t.scDeleteConfirm.replace('{name}', scene.name))) {
                          void post(`/api/admin/scenes/${scene.id}/manage`, { action: 'delete' })
                        }
                      }}
                      type="button"
                    >
                      {t.scDelete}
                    </button>
                    <a
                      className="rounded-[6px] border border-border px-[9px] py-[4px] font-medium text-[11.5px] text-fg no-underline transition-colors hover:bg-hover"
                      href={`/scene/${scene.id}`}
                    >
                      {t.scOpen}
                    </a>
                  </div>
                </td>
              </tr>
            ))}
            {scenes.length === 0 ? (
              <tr>
                <td className="px-[13px] py-[18px] text-center text-muted-fg" colSpan={6}>
                  {loading ? '…' : t.scEmpty}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {sharing ? (
        <SceneShareManager
          lang={lang}
          scene={sharing}
          onClose={() => setSharing(null)}
          onSaved={() => {
            setSharing(null)
            notify(t.scSaved, 'success')
          }}
          onError={(message) => notify(message, 'error')}
        />
      ) : null}

      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </section>
  )
}

function pick(lang: string, tr: string, en: string): string {
  return lang === 'tr' ? tr : en
}

/**
 * Manage which accounts a scene is shared with, per-user viewer/editor. Admins
 * reach any scene here, which is what makes this the home for sharing projects
 * an admin does not own. Strings are inline bilingual rather than i18n keys:
 * this file is editor-owned and its keys do not exist in the console's own
 * dictionary, so a `t.*` reference would break the panel repo on sync.
 */
function SceneShareManager({
  lang,
  scene,
  onClose,
  onSaved,
  onError,
}: {
  lang: string
  scene: AdminSceneRow
  onClose: () => void
  onSaved: () => void
  onError: (message: string) => void
}) {
  const [payload, setPayload] = useState<SceneSharesPayload | null>(null)
  const [shares, setShares] = useState<SceneShareRow[]>([])
  const [addId, setAddId] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const res = await call<SceneSharesPayload>(`/api/scenes/${scene.id}/shares`)
      if (!alive) return
      if (res.ok) {
        setPayload(res.data)
        setShares(res.data.shares)
      } else {
        setLoadError(pick(lang, 'Paylaşımlar yüklenemedi.', 'Could not load shares.'))
      }
    })()
    return () => {
      alive = false
    }
  }, [scene.id, lang])

  const candidates = (payload?.users ?? []).filter((u) => !shares.some((s) => s.userId === u.id))

  const setRole = (userId: string, role: ShareRole) =>
    setShares((prev) => prev.map((s) => (s.userId === userId ? { ...s, role } : s)))
  const remove = (userId: string) => setShares((prev) => prev.filter((s) => s.userId !== userId))
  const add = () => {
    if (!addId) return
    const user = payload?.users.find((u) => u.id === addId)
    setShares((prev) => [...prev, { userId: addId, role: 'viewer', email: user?.email ?? null }])
    setAddId('')
  }

  const save = async () => {
    setBusy(true)
    const res = await call(`/api/scenes/${scene.id}/shares`, {
      method: 'PUT',
      body: { shares: shares.map((s) => ({ userId: s.userId, role: s.role })) },
    })
    setBusy(false)
    if (res.ok) onSaved()
    else onError(pick(lang, 'Kaydedilemedi.', 'Could not save.'))
  }

  return (
    <Dialog labelledBy="dt-scene-share-title" width={420} onClose={onClose}>
      <div className="flex flex-col gap-1">
        <h2 id="dt-scene-share-title" className="m-0 font-semibold text-[15px] tracking-[-0.01em]">
          {pick(lang, 'Projeyi paylaş', 'Share project')}
        </h2>
        <span className="truncate font-mono text-[10.5px] text-muted-fg">{scene.name}</span>
        <p className="m-0 mt-1 text-[11.5px] text-muted-fg leading-[1.5] text-pretty">
          {pick(
            lang,
            'Editör birlikte gerçek zamanlı düzenleyebilir; izleyici yalnızca görüntüler.',
            'An editor can edit together in real time; a viewer can only view.',
          )}
        </p>
      </div>

      {loadError ? (
        <p className="text-[11.5px] text-destructive">{loadError}</p>
      ) : payload === null ? (
        <p className="text-[11.5px] text-muted-fg">…</p>
      ) : (
        <div className="flex flex-col gap-[8px]">
          {shares.length === 0 ? (
            <p className="text-[11.5px] text-muted-fg">
              {pick(lang, 'Henüz kimseyle paylaşılmadı.', 'Not shared with anyone yet.')}
            </p>
          ) : (
            shares.map((s) => (
              <div key={s.userId} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12px] text-fg">
                  {s.email ?? s.userId}
                </span>
                <SegBar>
                  <SegButton
                    active={s.role === 'viewer'}
                    onClick={() => setRole(s.userId, 'viewer')}
                  >
                    {pick(lang, 'İzleyici', 'Viewer')}
                  </SegButton>
                  <SegButton
                    active={s.role === 'editor'}
                    onClick={() => setRole(s.userId, 'editor')}
                  >
                    {pick(lang, 'Editör', 'Editor')}
                  </SegButton>
                </SegBar>
                <button
                  type="button"
                  onClick={() => remove(s.userId)}
                  className="shrink-0 rounded-[6px] border border-border px-[8px] py-[4px] text-[11.5px] text-muted-fg hover:bg-hover hover:text-fg"
                >
                  ×
                </button>
              </div>
            ))
          )}

          {candidates.length > 0 ? (
            <div className="flex items-center gap-2 pt-1">
              <select
                value={addId}
                onChange={(e) => setAddId(e.target.value)}
                className="min-w-0 flex-1 rounded-[6px] border border-border bg-field px-2 py-1 text-[11.5px] text-fg"
              >
                <option value="">{pick(lang, 'Kullanıcı ekle…', 'Add a user…')}</option>
                {candidates.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.email}
                  </option>
                ))}
              </select>
              <button type="button" onClick={add} disabled={!addId} className={ACTION}>
                {pick(lang, 'Ekle', 'Add')}
              </button>
            </div>
          ) : null}
        </div>
      )}

      <div className="flex flex-col gap-[9px]">
        <Button onClick={() => void save()} disabled={busy || payload === null}>
          {pick(lang, 'Kaydet', 'Save')}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          {pick(lang, 'Kapat', 'Close')}
        </Button>
      </div>
    </Dialog>
  )
}
