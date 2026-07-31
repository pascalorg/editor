'use client'

import { useApp } from '@panel/components/app-providers'
import { Caps } from '@panel/components/ui/caps'
import { SegBar, SegButton } from '@panel/components/ui/controls'
import { Toast } from '@panel/components/ui/feedback'
import type { JobsResponse } from '@panel/lib/api-contract'
import { call } from '@panel/lib/client-api'
import { cn } from '@panel/lib/cn'
import { formatDate, resolveApiMessage } from '@panel/lib/i18n'
import type { Job, JobStatus } from '@panel/lib/types'
import { ListChecks } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

const FILTERS: Array<JobStatus | 'All'> = ['All', 'queued', 'running', 'failed', 'done']
const POLL_FALLBACK_MS = 4000

export function JobsTab() {
  const { t, lang } = useApp()

  const [jobs, setJobs] = useState<Job[]>([])
  const [filter, setFilter] = useState<JobStatus | 'All'>('All')
  const [loading, setLoading] = useState(true)
  const [live, setLive] = useState(false)
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null)
  const filterRef = useRef(filter)
  filterRef.current = filter

  const notify = useCallback((message: string, tone: 'success' | 'error' = 'success') => {
    setToast({ message, tone })
    setTimeout(() => setToast(null), 2600)
  }, [])

  const load = useCallback(async () => {
    const res = await call<JobsResponse>('/api/jobs')
    if (res.ok) setJobs(res.data.jobs)
    setLoading(false)
  }, [])

  /**
   * SSE first, 4 s poll as the fallback the contract asks for. The stream sends
   * the whole list on change, so `filter` is applied client-side — otherwise
   * every filter change would have to tear the connection down and rebuild it.
   */
  useEffect(() => {
    void load()

    let source: EventSource | null = null
    let poll: ReturnType<typeof setInterval> | null = null

    const startPolling = () => {
      if (poll) return
      setLive(false)
      poll = setInterval(() => void load(), POLL_FALLBACK_MS)
    }

    try {
      source = new EventSource('/api/jobs/stream')
      source.addEventListener('open', () => setLive(true))
      source.addEventListener('jobs', (event) => {
        try {
          setJobs((JSON.parse((event as MessageEvent).data) as JobsResponse).jobs)
          setLoading(false)
        } catch {
          /* malformed frame — the next one replaces it */
        }
      })
      source.addEventListener('error', () => {
        source?.close()
        source = null
        startPolling()
      })
    } catch {
      startPolling()
    }

    return () => {
      source?.close()
      if (poll) clearInterval(poll)
    }
  }, [load])

  const act = useCallback(
    async (job: Job, action: 'retry' | 'cancel') => {
      const res = await call(`/api/jobs/${job.id}/${action}`, { body: {} })
      if (!res.ok) {
        notify(resolveApiMessage(t, res.messageKey), 'error')
        return
      }
      void load()
    },
    [notify, t, load],
  )

  const visible = filter === 'All' ? jobs : jobs.filter((j) => j.status === filter)

  const statusLabel = (status: JobStatus) =>
    status === 'queued'
      ? t.jbQueued
      : status === 'running'
        ? t.jbRunning
        : status === 'failed'
          ? t.jbFailed
          : status === 'done'
            ? t.jbDone
            : t.jbCancelled

  return (
    <section className="flex min-w-0 flex-col gap-[14px]" style={{ animation: 'dtFade 0.2s ease' }}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-[2px]">
          <h2 className="m-0 text-[15.5px] font-semibold tracking-[-0.01em]">{t.c.jobs}</h2>
          <p className="m-0 flex items-center gap-2 text-xs text-muted-fg">
            {t.jbLead}
            <span className="flex items-center gap-[5px] font-mono text-[9px]">
              <span
                className={cn('h-[5px] w-[5px] rounded-full', live ? 'bg-ok' : 'bg-muted-fg')}
                style={live ? { animation: 'dtPulse 2s ease infinite' } : undefined}
              />
              <Caps>{live ? t.jbLive : t.jbPolling}</Caps>
            </span>
          </p>
        </div>

        <SegBar>
          {FILTERS.map((value) => (
            <SegButton key={value} active={filter === value} onClick={() => setFilter(value)}>
              {value === 'All' ? t.c.filterAll : statusLabel(value)}
            </SegButton>
          ))}
        </SegBar>
      </header>

      <div className="flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-border">
        {loading ? (
          Array.from({ length: 3 }, (_, i) => (
            <div
              key={i}
              className="flex h-[58px] items-center gap-4 border-b border-border-soft px-3"
            >
              <span
                className="h-[9px] w-[220px] rounded bg-hover"
                style={{ animation: 'dtShimmer 1.4s ease infinite' }}
              />
            </div>
          ))
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12">
            <ListChecks className="h-[22px] w-[22px] text-muted-fg" strokeWidth={1.6} />
            <span className="text-[12.5px] font-semibold">{t.jbEmptyTitle}</span>
            <span className="max-w-[380px] text-center text-[11.5px] text-muted-fg text-pretty">
              {t.jbEmptyLead}
            </span>
          </div>
        ) : (
          visible.map((job) => (
            <div
              key={job.id}
              className="flex min-w-0 flex-wrap items-center gap-3 border-b border-border-soft px-3 py-[10px] last:border-b-0"
            >
              <div className="flex min-w-[200px] flex-1 flex-col gap-[2px]">
                <div className="flex items-center gap-2">
                  <span className="shrink-0 font-mono text-[10px] text-muted-fg">
                    {job.id.slice(-8)}
                  </span>
                  <span className="truncate text-[12.5px] font-medium">{job.kind}</span>
                </div>
                <span className="truncate font-mono text-[10px] text-muted-fg">
                  {job.siteId ?? '—'} · {t.jbBy} {job.queuedBy} · {formatDate(lang, job.queuedAt)}
                </span>
                {job.errorText ? (
                  <span className="truncate text-[11px] text-destructive">{job.errorText}</span>
                ) : null}
              </div>

              <div className="flex w-[150px] shrink-0 items-center gap-2">
                <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-hover">
                  <div
                    className={cn(
                      'h-full rounded-full transition-[width] duration-500',
                      job.status === 'failed' ? 'bg-destructive' : 'bg-brand',
                    )}
                    style={{ width: `${job.progress}%` }}
                  />
                </div>
                <span className="w-[34px] shrink-0 text-right font-mono text-[10px] text-muted-fg">
                  {job.progress}%
                </span>
              </div>

              <span
                className={cn(
                  'flex w-[86px] shrink-0 items-center gap-[6px] rounded-[5px] border px-[7px] py-px text-[10.5px]',
                  job.status === 'running'
                    ? 'border-brand text-brand-fg'
                    : job.status === 'failed'
                      ? 'border-destructive text-destructive'
                      : job.status === 'done'
                        ? 'border-border text-fg'
                        : 'border-border text-muted-fg',
                )}
              >
                <span
                  className={cn(
                    'h-[5px] w-[5px] rounded-full',
                    job.status === 'running'
                      ? 'bg-brand'
                      : job.status === 'failed'
                        ? 'bg-destructive'
                        : job.status === 'done'
                          ? 'bg-ok'
                          : 'bg-muted-fg',
                  )}
                  style={
                    job.status === 'running' ? { animation: 'dtPulse 2s ease infinite' } : undefined
                  }
                />
                {statusLabel(job.status)}
              </span>

              <div className="flex shrink-0 items-center gap-[6px]">
                {job.status === 'failed' || job.status === 'cancelled' ? (
                  <button
                    type="button"
                    onClick={() => void act(job, 'retry')}
                    className="h-[26px] rounded-[6px] border border-border bg-field px-[10px] text-[11px] text-fg hover:bg-hover"
                  >
                    {t.jbRetry}
                  </button>
                ) : null}
                {job.status === 'queued' || job.status === 'running' ? (
                  <button
                    type="button"
                    onClick={() => void act(job, 'cancel')}
                    className="h-[26px] rounded-[6px] border border-destructive bg-transparent px-[10px] text-[11px] text-destructive hover:bg-hover"
                  >
                    {t.jbCancel}
                  </button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </section>
  )
}
