'use client'

import { useApp } from '@panel/components/app-providers'
import { Button, SegBar, SegButton } from '@panel/components/ui/controls'
import { Dialog, Toast } from '@panel/components/ui/feedback'
import type { LogsResponse } from '@panel/lib/api-contract'
import { call } from '@panel/lib/client-api'
import { cn } from '@panel/lib/cn'
import { auditText, formatDate, resolveApiMessage } from '@panel/lib/i18n'
import { AlertTriangle, CheckCircle2, Search, ShieldAlert, XCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

type Level = 'All' | 'info' | 'warn' | 'error'
type Range = 'hour' | 'today' | 'week' | 'all'
type Entry = LogsResponse['entries'][number]

/**
 * Runtime diagnostics.
 *
 * Paging is cursor-based, so "load more" cannot duplicate or skip a row while
 * the log is being written to underneath it — which is the normal case here.
 */
export function LogsTab() {
  const { t, lang } = useApp()

  const [entries, setEntries] = useState<Entry[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [actors, setActors] = useState<string[]>([])
  const [counts, setCounts] = useState({ info: 0, warn: 0, error: 0 })
  const [canClear, setCanClear] = useState(false)
  const [restricted, setRestricted] = useState(false)
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [level, setLevel] = useState<Level>('All')
  const [range, setRange] = useState<Range>('all')
  const [actor, setActor] = useState('All')

  const [confirmClear, setConfirmClear] = useState(false)
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null)

  const notify = useCallback((message: string, tone: 'success' | 'error' = 'success') => {
    setToast({ message, tone })
    setTimeout(() => setToast(null), 2600)
  }, [])

  const load = useCallback(
    async (nextCursor?: string) => {
      const params = new URLSearchParams({ level, range, actor, limit: '50' })
      if (search.trim()) params.set('search', search.trim())
      if (nextCursor) params.set('cursor', nextCursor)

      const res = await call<LogsResponse>(`/api/logs?${params}`)
      setLoading(false)

      if (!res.ok) {
        if (res.code === 'forbidden') setRestricted(true)
        return
      }
      setRestricted(false)
      setEntries((prev) => (nextCursor ? [...prev, ...res.data.entries] : res.data.entries))
      setCursor(res.data.nextCursor)
      setActors(res.data.actors)
      setCounts(res.data.counts)
      setCanClear(Boolean(res.data.canClear))
    },
    [level, range, actor, search],
  )

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  if (restricted) {
    return (
      <section className="flex flex-col items-center gap-2 rounded-[12px] border border-dashed border-input px-4 py-14">
        <ShieldAlert className="h-[22px] w-[22px] text-muted-fg" strokeWidth={1.6} />
        <span className="text-[12.5px] font-semibold">{t.c.logsRestricted}</span>
        <span className="text-[11.5px] text-muted-fg">{t.c.logsRestrictedLead}</span>
      </section>
    )
  }

  const total = counts.info + counts.warn + counts.error

  return (
    <section className="flex min-w-0 flex-col gap-[14px]" style={{ animation: 'dtFade 0.2s ease' }}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-[2px]">
          <h2 className="m-0 text-[15.5px] font-semibold tracking-[-0.01em]">{t.c.incidentLog}</h2>
          <p className="m-0 text-xs text-muted-fg">
            {total} {t.c.events} · {counts.error} {t.c.lvError.toLocaleLowerCase(lang)} ·{' '}
            {counts.warn} {t.c.lvWarn.toLocaleLowerCase(lang)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-[7px]">
          <div className="relative flex items-center">
            <Search
              className="pointer-events-none absolute left-[9px] h-3 w-3 text-muted-fg"
              strokeWidth={2.2}
            />
            <input
              type="text"
              placeholder={t.c.logSearchPh}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-[30px] w-[190px] min-w-0 rounded-[8px] border border-input bg-field pl-[26px] pr-[10px] text-xs text-fg outline-none focus:border-ring focus:shadow-[0_0_0_3px_var(--dt-hover)]"
            />
          </div>

          <SegBar>
            {(
              [
                ['hour', t.c.lastHour],
                ['today', t.c.today],
                ['week', t.c.days7],
                ['all', t.c.filterAll],
              ] as Array<[Range, string]>
            ).map(([value, label]) => (
              <SegButton key={value} active={range === value} onClick={() => setRange(value)}>
                {label}
              </SegButton>
            ))}
          </SegBar>

          <SegBar>
            {(
              [
                ['All', t.c.filterAll],
                ['info', t.c.lvInfo],
                ['warn', t.c.lvWarn],
                ['error', t.c.lvError],
              ] as Array<[Level, string]>
            ).map(([value, label]) => (
              <SegButton key={value} active={level === value} onClick={() => setLevel(value)}>
                {label}
              </SegButton>
            ))}
          </SegBar>

          <select
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            aria-label={t.lgActor}
            className="h-[30px] min-w-0 max-w-[190px] rounded-[8px] border border-input bg-field px-2 text-xs text-fg outline-none focus:border-ring"
          >
            <option value="All">{t.c.allUsers}</option>
            {actors.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          {canClear ? (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="h-[30px] shrink-0 rounded-[8px] border border-destructive bg-transparent px-[11px] text-xs font-medium text-destructive hover:bg-hover"
            >
              {t.lgClear}
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-border">
        {loading ? (
          Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="flex h-[46px] items-center gap-4 border-b border-border-soft px-3"
            >
              <span
                className="h-[9px] w-[280px] rounded bg-hover"
                style={{ animation: 'dtShimmer 1.4s ease infinite' }}
              />
            </div>
          ))
        ) : entries.length === 0 ? (
          <div className="px-3 py-10 text-center text-[11.5px] text-muted-fg">{t.lgEmpty}</div>
        ) : (
          <>
            {entries.map((entry) => (
              <LogRow key={entry.id} entry={entry} lang={lang} text={auditText(t, entry)} />
            ))}
            {cursor ? (
              <button
                type="button"
                onClick={() => void load(cursor)}
                className="h-9 border-t border-border bg-surface text-[11.5px] font-medium text-muted-fg hover:text-fg"
              >
                {t.lgLoadMore}
              </button>
            ) : null}
          </>
        )}
      </div>

      {confirmClear ? (
        <Dialog
          role="alertdialog"
          labelledBy="dt-clear-title"
          width={384}
          onClose={() => setConfirmClear(false)}
        >
          <h2 id="dt-clear-title" className="m-0 text-[15px] font-semibold tracking-[-0.01em]">
            {t.lgClearTitle}
          </h2>
          <p className="m-0 text-[12.5px] leading-[1.55] text-muted-fg text-pretty">
            {t.lgClearLead}
          </p>
          <div className="flex flex-col gap-[9px]">
            <Button
              variant="destructive"
              onClick={async () => {
                const res = await call<{ removed: number }>('/api/logs', { method: 'DELETE' })
                setConfirmClear(false)
                if (!res.ok) {
                  notify(resolveApiMessage(t, res.messageKey), 'error')
                  return
                }
                notify(`${res.data.removed} ${t.lgCleared}`)
                void load()
              }}
            >
              {t.lgClear}
            </Button>
            <Button variant="secondary" onClick={() => setConfirmClear(false)}>
              {t.cancel}
            </Button>
          </div>
        </Dialog>
      ) : null}

      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </section>
  )
}

function LogRow({ entry, lang, text }: { entry: Entry; lang: 'en' | 'tr'; text: string }) {
  const Icon =
    entry.level === 'error' ? XCircle : entry.level === 'warn' ? AlertTriangle : CheckCircle2

  return (
    <div className="flex min-w-0 items-start gap-[10px] border-b border-border-soft px-3 py-2 last:border-b-0">
      <Icon
        className={cn(
          'mt-[2px] h-[13px] w-[13px] shrink-0',
          entry.level === 'error'
            ? 'text-destructive'
            : entry.level === 'warn'
              ? 'text-warn'
              : 'text-muted-fg',
        )}
        strokeWidth={2.2}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        {/* Selectable: a log line you cannot copy is half a log line. */}
        <span className="select-text break-words font-mono text-[11.5px] text-fg">{text}</span>
        <span className="truncate font-mono text-[9.5px] text-muted-fg">
          {formatDate(lang, entry.createdAt)} · {entry.actor}
          {entry.kind ? (
            <>
              {' · '}
              <span className="text-brand-fg">[{entry.kind}]</span>
            </>
          ) : null}
        </span>
      </div>
    </div>
  )
}
