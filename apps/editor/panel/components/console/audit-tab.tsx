'use client';

import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { useApp } from '@panel/components/app-providers';
import { SegBar, SegButton } from '@panel/components/ui/controls';
import { Caps } from '@panel/components/ui/caps';
import { call } from '@panel/lib/client-api';
import type { LogsResponse } from '@panel/lib/api-contract';
import { auditText, formatDate } from '@panel/lib/i18n';
import { cn } from '@panel/lib/cn';

type Entry = LogsResponse['entries'][number];

/**
 * The append-only change trail. Deliberately has no clear action and no delete
 * endpoint behind it — that absence is the feature.
 */
export function AuditTab() {
  const { t, lang } = useApp();

  const [entries, setEntries] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [kinds, setKinds] = useState<string[]>([]);
  const [counts, setCounts] = useState({ info: 0, warn: 0, error: 0 });
  const [kind, setKind] = useState('All');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (nextCursor?: string) => {
      const params = new URLSearchParams({ kind, limit: '50' });
      if (search.trim()) params.set('search', search.trim());
      if (nextCursor) params.set('cursor', nextCursor);

      const res = await call<LogsResponse>(`/api/audit?${params}`);
      setLoading(false);
      if (!res.ok) return;

      setEntries((prev) => (nextCursor ? [...prev, ...res.data.entries] : res.data.entries));
      setCursor(res.data.nextCursor);
      setCounts(res.data.counts);
      if (res.data.kinds) setKinds(res.data.kinds);
    },
    [kind, search],
  );

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const total = counts.info + counts.warn + counts.error;

  const kindLabel = (value: string) =>
    ({
      user: t.auKindUser,
      role_change: t.auKindRole,
      invite: t.auKindInvite,
      request: t.auKindRequest,
      site: t.auKindSite,
      api_key: t.auKindKey,
      webhook: t.auKindHook,
      settings: t.auKindSettings,
    })[value] ?? value;

  return (
    <section className="flex min-w-0 flex-col gap-[14px]" style={{ animation: 'dtFade 0.2s ease' }}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-[2px]">
          <h2 className="m-0 text-[15.5px] font-semibold tracking-[-0.01em]">{t.c.audit}</h2>
          <p className="m-0 text-xs text-muted-fg">
            {total} {t.c.events} · {t.c.appendOnly}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-[7px]">
          <div className="relative flex items-center">
            <Search className="pointer-events-none absolute left-[9px] h-3 w-3 text-muted-fg" strokeWidth={2.2} />
            <input
              type="text"
              placeholder={t.c.logSearchPh}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-[30px] w-[190px] min-w-0 rounded-[8px] border border-input bg-field pl-[26px] pr-[10px] text-xs text-fg outline-none focus:border-ring focus:shadow-[0_0_0_3px_var(--dt-hover)]"
            />
          </div>
          <SegBar>
            <SegButton active={kind === 'All'} onClick={() => setKind('All')}>
              {t.c.filterAll}
            </SegButton>
            {kinds.map((value) => (
              <SegButton key={value} active={kind === value} onClick={() => setKind(value)}>
                {kindLabel(value)}
              </SegButton>
            ))}
          </SegBar>
        </div>
      </header>

      <div className="flex items-start gap-[9px] rounded-[10px] border border-border bg-surface px-3 py-2">
        <span className="mt-[6px] h-[5px] w-[5px] shrink-0 rounded-full bg-brand" />
        <span className="min-w-0 text-[11.5px] leading-[1.5] text-muted-fg text-pretty">{t.c.auditBanner}</span>
      </div>

      <div className="flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-border">
        {loading ? (
          Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex h-[46px] items-center gap-4 border-b border-border-soft px-3">
              <span
                className="h-[9px] w-[300px] rounded bg-hover"
                style={{ animation: 'dtShimmer 1.4s ease infinite' }}
              />
            </div>
          ))
        ) : entries.length === 0 ? (
          <div className="px-3 py-10 text-center text-[11.5px] text-muted-fg">{t.auEmpty}</div>
        ) : (
          <>
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="flex min-w-0 items-start gap-[10px] border-b border-border-soft px-3 py-2 last:border-b-0"
              >
                <span
                  className={cn(
                    'mt-[5px] h-[5px] w-[5px] shrink-0 rounded-full',
                    entry.level === 'warn' ? 'bg-warn' : entry.level === 'error' ? 'bg-destructive' : 'bg-ok',
                  )}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                  <span className="select-text break-words text-[12px] text-fg">{auditText(t, entry)}</span>
                  <span className="truncate font-mono text-[9.5px] text-muted-fg">
                    {formatDate(lang, entry.createdAt)} · {entry.actor}
                  </span>
                </div>
                {entry.kind ? (
                  <Caps className="shrink-0 rounded-[4px] border border-border px-[6px] py-px font-mono text-[8.5px] tracking-[0.08em] text-muted-fg">
                    {kindLabel(entry.kind)}
                  </Caps>
                ) : null}
              </div>
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
    </section>
  );
}
