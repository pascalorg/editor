'use client'

import { useApp } from '@panel/components/app-providers'
import { Caps } from '@panel/components/ui/caps'
import type { ChangelogResponse, ReleaseEntry } from '@panel/lib/api-contract'
import { call } from '@panel/lib/client-api'
import { cn } from '@panel/lib/cn'
import { formatDateOnly } from '@panel/lib/i18n'
import { useCallback, useEffect, useState } from 'react'

/**
 * Release notes as a vertical timeline, newest first.
 *
 * The upstream repositories are never named here — entries arrive with a
 * `channel` and the wording comes from the dictionary, which is the rule the
 * design settled on after the repo URLs leaked into the UI.
 */
export function UpdatesTab() {
  const { t, lang } = useApp()

  const [entries, setEntries] = useState<ReleaseEntry[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [live, setLive] = useState(false)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tag, setTag] = useState<string | null>(null)

  const load = useCallback(async (nextCursor?: string) => {
    const params = new URLSearchParams({ limit: '20' })
    if (nextCursor) params.set('cursor', nextCursor)

    const res = await call<ChangelogResponse>(`/api/changelog?${params}`)
    setLoading(false)
    if (!res.ok) return

    setEntries((prev) => (nextCursor ? [...prev, ...res.data.entries] : res.data.entries))
    setCursor(res.data.nextCursor)
    setLive(res.data.live)
    setFetchedAt(res.data.fetchedAt)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const visible = tag ? entries.filter((e) => e.tags.includes(tag)) : entries
  const allTags = [...new Set(entries.flatMap((e) => e.tags))].slice(0, 10)

  return (
    <section className="flex min-w-0 flex-col gap-[14px]" style={{ animation: 'dtFade 0.2s ease' }}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-[2px]">
          <h2 className="m-0 text-[15.5px] font-semibold tracking-[-0.01em]">{t.c.changelog}</h2>
          <p className="m-0 text-xs text-muted-fg">{t.clLead}</p>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={cn(
              'flex shrink-0 items-center gap-[6px] rounded-[5px] border px-[8px] py-[3px] font-mono text-[9px]',
              live ? 'border-brand text-brand-fg' : 'border-border text-muted-fg',
            )}
          >
            <span
              className={cn('h-[5px] w-[5px] rounded-full', live ? 'bg-brand' : 'bg-muted-fg')}
            />
            <Caps invariant>{live ? t.clLive : t.clSnapshot}</Caps>
          </span>
          {fetchedAt ? (
            <span className="font-mono text-[9.5px] text-muted-fg">
              {t.clFetched} {formatDateOnly(lang, fetchedAt)}
            </span>
          ) : null}
        </div>
      </header>

      {allTags.length > 0 ? (
        <div className="flex flex-wrap gap-[6px]">
          {allTags.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTag(tag === value ? null : value)}
              className={cn(
                'rounded-[6px] border px-[9px] py-[3px] font-mono text-[10px]',
                tag === value
                  ? 'border-brand bg-field text-brand-fg'
                  : 'border-border bg-transparent text-muted-fg hover:text-fg',
              )}
            >
              #{value}
            </button>
          ))}
        </div>
      ) : null}

      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div
              key={i}
              className="h-[110px] rounded-[12px] border border-border bg-surface"
              style={{ animation: 'dtShimmer 1.4s ease infinite' }}
            />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-[12px] border border-dashed border-input px-4 py-12 text-center text-[11.5px] text-muted-fg">
          {t.clEmpty}
        </div>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-0 p-0">
          {visible.map((entry, index) => (
            <li key={entry.id} className="flex min-w-0 gap-4">
              {/* Timeline rail: dot plus the connecting line, drawn per row so
                  the last entry does not trail a line into empty space. */}
              <div className="flex w-[10px] shrink-0 flex-col items-center pt-[18px]">
                <span
                  className={cn(
                    'h-[7px] w-[7px] shrink-0 rounded-full',
                    entry.channel === 'editor' ? 'bg-brand' : 'bg-input',
                  )}
                />
                {index < visible.length - 1 ? <span className="w-px flex-1 bg-border" /> : null}
              </div>

              <article className="mb-3 min-w-0 flex-1 rounded-[12px] border border-border bg-surface p-[13px]">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-[10px] text-muted-fg">
                    {formatDateOnly(lang, entry.date)}
                  </span>
                  {entry.version ? (
                    <span className="rounded-[4px] border border-border px-[6px] font-mono text-[10px] text-fg">
                      {entry.version}
                    </span>
                  ) : null}
                  <span className="font-mono text-[9.5px] text-muted-fg">
                    {entry.channel === 'editor' ? t.clEditor : t.clPlugin}
                  </span>
                </div>

                <h3 className="m-0 mt-[6px] text-[13.5px] font-semibold tracking-[-0.01em] text-fg">
                  {entry.title}
                </h3>
                <p className="m-0 mt-[4px] text-[12px] leading-[1.55] text-muted-fg text-pretty">
                  {entry.summary}
                </p>

                <div className="mt-[9px] flex flex-wrap items-center gap-2">
                  {entry.authors.slice(0, 4).map((author) => (
                    <span key={author} className="flex items-center gap-[5px]">
                      <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] bg-hover font-mono text-[8px] text-muted-fg">
                        {author.slice(0, 2).toLocaleUpperCase('en')}
                      </span>
                      <span className="font-mono text-[9.5px] text-muted-fg">{author}</span>
                    </span>
                  ))}
                  <span className="flex-1" />
                  {entry.tags.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setTag(tag === value ? null : value)}
                      className="rounded-[4px] border border-border-soft bg-transparent px-[5px] font-mono text-[9px] text-muted-fg hover:text-fg"
                    >
                      #{value}
                    </button>
                  ))}
                </div>
              </article>
            </li>
          ))}
        </ol>
      )}

      {cursor && !tag ? (
        <button
          type="button"
          onClick={() => void load(cursor)}
          className="h-9 rounded-[10px] border border-border bg-surface text-[11.5px] font-medium text-muted-fg hover:text-fg"
        >
          {t.lgLoadMore}
        </button>
      ) : null}
    </section>
  )
}
