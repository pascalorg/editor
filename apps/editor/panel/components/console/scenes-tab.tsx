'use client'

import { useApp } from '@panel/components/app-providers'
import { Toast } from '@panel/components/ui/feedback'
import { formatDate } from '@panel/lib/i18n'
import { useCallback, useEffect, useState } from 'react'

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

interface AdminScenesPayload {
  scenes: AdminSceneRow[]
  users: { id: string; email: string }[]
  adminId: string
}

export function ScenesTab() {
  const { t, lang } = useApp()

  const [data, setData] = useState<AdminScenesPayload | null>(null)
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
                  <div className="flex justify-end gap-[6px]">
                    <button
                      className="cursor-pointer rounded-[6px] border border-border bg-field px-[9px] py-[4px] font-medium text-[11.5px] text-fg transition-colors hover:bg-hover disabled:opacity-50"
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

      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </section>
  )
}
