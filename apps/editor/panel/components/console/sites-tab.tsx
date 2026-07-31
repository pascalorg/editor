'use client'

import { useApp } from '@panel/components/app-providers'
import { Caps } from '@panel/components/ui/caps'
import { SegBar, SegButton } from '@panel/components/ui/controls'
import { Toast } from '@panel/components/ui/feedback'
import type { SitesResponse } from '@panel/lib/api-contract'
import { call } from '@panel/lib/client-api'
import { cn } from '@panel/lib/cn'
import { formatNumber, resolveApiMessage } from '@panel/lib/i18n'
import type { Site } from '@panel/lib/types'
import { Warehouse } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

type Template = 'empty' | 'ifc' | 'copy'

/** How long the tab keeps watching a provisioning site before it stops polling. */
const PROVISION_WATCH_MS = 2 * 60 * 1000

export function SitesTab() {
  const { t, lang } = useApp()

  const [sites, setSites] = useState<Site[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [template, setTemplate] = useState<Template>('empty')
  const [footprint, setFootprint] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null)

  const notify = useCallback((message: string, tone: 'success' | 'error' = 'success') => {
    setToast({ message, tone })
    setTimeout(() => setToast(null), 2600)
  }, [])

  const load = useCallback(async () => {
    const res = await call<SitesResponse>('/api/sites')
    if (res.ok) {
      setSites(res.data.sites)
      setCanEdit(res.data.canEdit)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * A site in `setup` is waiting on its provisioning job, so the tab polls while
   * any card is in that state — and gives up after PROVISION_WATCH_MS.
   *
   * The bound is not cosmetic: a site can sit in `setup` with no job behind it
   * (a seeded row, or a job that was cancelled), and without a ceiling this tab
   * would poll that row for as long as it stayed open.
   */
  useEffect(() => {
    if (!sites.some((s) => s.status === 'setup')) return

    const startedAt = Date.now()
    const timer = setInterval(() => {
      if (Date.now() - startedAt > PROVISION_WATCH_MS) {
        clearInterval(timer)
        return
      }
      void load()
    }, 4000)
    return () => clearInterval(timer)
  }, [sites, load])

  const create = useCallback(async () => {
    if (!name.trim()) {
      notify(t.errFields, 'error')
      return
    }
    setBusy(true)
    const res = await call<{ site: string; job: string }>('/api/sites', {
      body: {
        name: name.trim(),
        template,
        footprintM2: footprint.trim() ? Number(footprint.replace(/\D/g, '')) : null,
      },
    })
    setBusy(false)

    if (!res.ok) {
      notify(resolveApiMessage(t, res.messageKey), 'error')
      return
    }
    setName('')
    setFootprint('')
    setCreating(false)
    notify(`${name.trim()} — ${t.stQueuedToast}`)
    void load()
  }, [name, template, footprint, notify, t, load])

  const setStatus = useCallback(
    async (site: Site, action: 'archive' | 'restore') => {
      const res = await call(`/api/sites/${site.id}/${action}`, { body: {} })
      if (!res.ok) {
        notify(resolveApiMessage(t, res.messageKey), 'error')
        return
      }
      void load()
    },
    [notify, t, load],
  )

  return (
    <section className="flex min-w-0 flex-col gap-[14px]" style={{ animation: 'dtFade 0.2s ease' }}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-[2px]">
          <h2 className="m-0 text-[15.5px] font-semibold tracking-[-0.01em]">{t.c.sites}</h2>
          <p className="m-0 text-xs text-muted-fg">{t.stLead}</p>
        </div>
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => setCreating((v) => !v)}
          className="h-[30px] shrink-0 rounded-[8px] bg-primary px-[13px] text-xs font-semibold text-primary-fg shadow-e2 hover:opacity-92"
        >
          {creating ? t.c.closeForm : t.stNew}
        </button>
      </header>

      {creating ? (
        <div
          className="flex flex-col gap-[10px] rounded-[12px] border border-input bg-surface p-[13px]"
          style={{ animation: 'dtDrop 0.16s ease' }}
        >
          <div className="flex flex-wrap items-end gap-[10px]">
            <div className="flex min-w-[170px] flex-1 flex-col gap-[5px]">
              <Caps className="font-mono text-[9px] tracking-[0.12em] text-muted-fg">
                {t.stNameLbl}
              </Caps>
              <input
                type="text"
                placeholder="Gebze HUB3"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8 w-full min-w-0 rounded-[8px] border border-input bg-field px-[10px] text-xs text-fg outline-none focus:border-ring"
              />
            </div>

            <div className="flex flex-col gap-[5px]">
              <Caps className="font-mono text-[9px] tracking-[0.12em] text-muted-fg">
                {t.stTplLbl}
              </Caps>
              <SegBar>
                {(
                  [
                    ['empty', t.stTplEmpty],
                    ['ifc', t.stTplIfc],
                    ['copy', t.stTplCopy],
                  ] as Array<[Template, string]>
                ).map(([value, label]) => (
                  <SegButton
                    key={value}
                    active={template === value}
                    onClick={() => setTemplate(value)}
                  >
                    {label}
                  </SegButton>
                ))}
              </SegBar>
            </div>

            <div className="flex min-w-[130px] flex-col gap-[5px]">
              <Caps className="font-mono text-[9px] tracking-[0.12em] text-muted-fg">
                {t.stFpLbl}
              </Caps>
              <input
                type="text"
                inputMode="numeric"
                placeholder="28000"
                value={footprint}
                onChange={(e) => setFootprint(e.target.value)}
                className="h-8 w-full min-w-0 rounded-[8px] border border-input bg-field px-[10px] font-mono text-xs text-fg outline-none focus:border-ring"
              />
            </div>
          </div>

          <p className="m-0 text-[11.5px] text-muted-fg text-pretty">{t.stHint}</p>

          <div className="flex gap-[7px]">
            <button
              type="button"
              disabled={busy}
              onClick={() => void create()}
              className="h-8 rounded-[8px] bg-primary px-[14px] text-xs font-semibold text-primary-fg hover:opacity-92"
            >
              {t.stCreate}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="h-8 rounded-[8px] border border-border bg-transparent px-3 text-xs text-muted-fg hover:bg-hover hover:text-fg"
            >
              {t.cancel}
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div
              key={i}
              className="h-[168px] rounded-[12px] border border-border bg-surface"
              style={{ animation: 'dtShimmer 1.4s ease infinite' }}
            />
          ))}
        </div>
      ) : sites.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-[12px] border border-dashed border-input px-4 py-12">
          <Warehouse className="h-[22px] w-[22px] text-muted-fg" strokeWidth={1.6} />
          <span className="text-[12.5px] font-semibold">{t.stEmptyTitle}</span>
          <span className="max-w-[380px] text-center text-[11.5px] text-muted-fg text-pretty">
            {t.stEmptyLead}
          </span>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((site) => (
            <article
              key={site.id}
              // Archived cards are marked by their dashed border and their
              // status chip, not by dimming. Blanket opacity took the whole card
              // below 4.5:1 — the same defect the revoked API key row had, and
              // one the seeded data happened not to expose.
              className={cn(
                'flex min-w-0 flex-col gap-3 rounded-[12px] border bg-surface p-[13px]',
                site.status === 'archived' ? 'border-dashed border-input' : 'border-border',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[13px] font-semibold">{site.name}</span>
                <span
                  className={cn(
                    'flex shrink-0 items-center gap-[6px] rounded-[5px] border px-[7px] py-px text-[10.5px]',
                    site.status === 'active'
                      ? 'border-border text-fg'
                      : site.status === 'setup'
                        ? 'border-brand text-brand-fg'
                        : 'border-border text-muted-fg',
                  )}
                >
                  <span
                    className={cn(
                      'h-[5px] w-[5px] rounded-full',
                      site.status === 'active'
                        ? 'bg-ok'
                        : site.status === 'setup'
                          ? 'bg-brand'
                          : 'bg-muted-fg',
                    )}
                    style={
                      site.status === 'setup'
                        ? { animation: 'dtPulse 2s ease infinite' }
                        : undefined
                    }
                  />
                  {site.status === 'active'
                    ? t.stActive
                    : site.status === 'setup'
                      ? t.stSetup
                      : t.stArchived}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {[
                  { k: t.stStorage, v: site.storageSlots },
                  { k: t.stPicking, v: site.pickingSlots },
                  { k: t.stFp2, v: site.footprintM2 },
                  { k: t.stUsers, v: site.userCount },
                ].map((cell) => (
                  <div key={cell.k} className="flex min-w-0 flex-col gap-[2px]">
                    <Caps className="font-mono text-[8.5px] tracking-[0.1em] text-muted-fg">
                      {cell.k}
                    </Caps>
                    <span className="font-mono text-[13px] text-fg">
                      {typeof cell.v === 'number' ? formatNumber(lang, cell.v) : '—'}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-auto flex gap-[6px]">
                <button
                  type="button"
                  disabled={site.status !== 'active'}
                  onClick={() => notify(t.stOpenNote)}
                  className="h-[26px] flex-1 rounded-[6px] border border-border bg-field text-[11px] font-medium text-fg hover:bg-hover"
                >
                  {t.stOpen}
                </button>
                <button
                  type="button"
                  disabled={!canEdit || site.status === 'setup'}
                  onClick={() =>
                    void setStatus(site, site.status === 'archived' ? 'restore' : 'archive')
                  }
                  className={cn(
                    'h-[26px] shrink-0 rounded-[6px] border bg-transparent px-[10px] text-[11px]',
                    site.status === 'archived'
                      ? 'border-border text-muted-fg hover:bg-hover hover:text-fg'
                      : 'border-destructive text-destructive hover:bg-hover',
                  )}
                >
                  {site.status === 'archived' ? t.stRestore : t.stArch}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </section>
  )
}
