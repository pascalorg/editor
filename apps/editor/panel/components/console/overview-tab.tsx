'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { useApp } from '@panel/components/app-providers';
import { Sparkline } from '@panel/components/console/sparkline';
import { Caps } from '@panel/components/ui/caps';
import { call } from '@panel/lib/client-api';
import type { OverviewResponse } from '@panel/lib/api-contract';
import { auditText, formatDate, formatNumber } from '@panel/lib/i18n';
import { cn } from '@panel/lib/cn';

/** The 4 s cadence the design specifies for health polling. */
const POLL_MS = 4000;
const SERIES_LENGTH = 24;

export function OverviewTab() {
  const { t, lang } = useApp();
  const router = useRouter();

  const [data, setData] = useState<OverviewResponse | null>(null);
  const [cpuSeries, setCpuSeries] = useState<number[]>([]);
  const [memSeries, setMemSeries] = useState<number[]>([]);
  const stopped = useRef(false);

  const load = useCallback(async () => {
    // A hidden tab must not keep polling — the old panel's health probe ran
    // regardless of visibility and burned cycles on tabs nobody was watching.
    if (document.visibilityState === 'hidden') return;

    const res = await call<OverviewResponse>('/api/overview');
    if (!res.ok || stopped.current) return;

    setData(res.data);
    setCpuSeries((prev) => [...prev, res.data.health.cpuPercent].slice(-SERIES_LENGTH));
    setMemSeries((prev) => [...prev, res.data.health.heapGb].slice(-SERIES_LENGTH));
  }, []);

  useEffect(() => {
    stopped.current = false;
    void load();

    const timer = setInterval(() => void load(), POLL_MS);
    const onVisibility = () => void load();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopped.current = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  if (!data) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="h-[104px] rounded-[12px] border border-border bg-surface"
            style={{ animation: 'dtShimmer 1.4s ease infinite' }}
          />
        ))}
      </div>
    );
  }

  const { health, counts, connected, incidents } = data;

  const metrics = [
    {
      label: t.ovCpu,
      value: String(health.cpuPercent),
      unit: '%',
      series: cpuSeries,
      foot: `${health.cores} ${t.ovCores} · ${t.ovLoad} ${health.loadAverage1m}`,
    },
    {
      label: t.ovMemory,
      value: health.heapGb.toFixed(2),
      unit: 'GB',
      series: memSeries,
      foot: `${t.ovSystemMem} ${health.systemUsedGb} / ${health.systemTotalGb} GB`,
    },
    {
      label: t.ovSites,
      value: String(counts.activeSites),
      unit: `/ ${counts.sites}`,
      series: [],
      foot: `${t.ovQueue} ${counts.queuedJobs}`,
    },
    {
      label: t.ovSignedIn,
      value: String(counts.signedIn),
      unit: `/ ${formatNumber(lang, counts.users)}`,
      series: [],
      foot: `${counts.without2fa} ${t.c.without2fa}`,
    },
  ];

  return (
    <section className="flex min-w-0 flex-col gap-[14px]" style={{ animation: 'dtFade 0.2s ease' }}>
      <header className="flex flex-col gap-[2px]">
        <h2 className="m-0 text-[15.5px] font-semibold tracking-[-0.01em]">{t.c.sysStatus}</h2>
        <p className="m-0 text-xs text-muted-fg">{t.c.sysStatusLead}</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric, index) => (
          <div
            key={metric.label}
            className="flex min-w-0 flex-col gap-2 rounded-[12px] border border-border bg-surface p-[13px]"
            // Cards reveal in sequence, 60 ms apart, as the design specifies.
            style={{ animation: 'dtFade 0.3s ease backwards', animationDelay: `${index * 60}ms` }}
          >
            <Caps className="font-mono text-[8.5px] tracking-[0.12em] text-muted-fg">{metric.label}</Caps>
            <div className="flex items-baseline gap-1">
              <span className="font-mono text-[26px] font-medium leading-none tracking-[-0.02em] text-fg">
                {metric.value}
              </span>
              <span className="text-[11px] text-muted-fg">{metric.unit}</span>
            </div>
            {metric.series.length > 0 ? <Sparkline values={metric.series} /> : null}
            <span className="truncate font-mono text-[9.5px] text-muted-fg">{metric.foot}</span>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-border">
          <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2">
            <Caps className="font-mono text-[8.5px] tracking-[0.12em] text-muted-fg">{t.c.connectedUsers}</Caps>
            <span className="flex items-center gap-[6px] font-mono text-[9px] text-muted-fg">
              <span
                className="h-[5px] w-[5px] rounded-full bg-ok"
                style={{ animation: 'dtPulse 2s ease infinite' }}
              />
              <Caps>{t.c.last20}</Caps>
            </span>
          </div>

          {connected.length === 0 ? (
            <div className="px-3 py-8 text-center text-[11.5px] text-muted-fg">{t.ovNoConnected}</div>
          ) : (
            connected.map((row) => (
              <div
                key={row.actor}
                className="flex min-w-0 items-center gap-3 border-b border-border-soft px-3 py-2 last:border-b-0"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                  <span className="truncate font-mono text-[11px] text-fg">{row.actor}</span>
                  <span className="truncate text-[10.5px] text-muted-fg">{row.lastAction}</span>
                </div>
                <span className="shrink-0 font-mono text-[9.5px] text-muted-fg">
                  {formatDate(lang, row.at)}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-border">
          <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2">
            <Caps className="font-mono text-[8.5px] tracking-[0.12em] text-muted-fg">
              {t.c.recentIncidents}
            </Caps>
            <button
              type="button"
              onClick={() => router.push('/console/logs')}
              className="bg-transparent text-[10.5px] text-muted-fg hover:text-fg"
            >
              {t.c.viewAll}
            </button>
          </div>

          {incidents.length === 0 ? (
            <div className="px-3 py-8 text-center text-[11.5px] text-muted-fg">{t.ovNoIncidents}</div>
          ) : (
            incidents.map((entry) => (
              <div
                key={entry.id}
                className="flex min-w-0 items-start gap-2 border-b border-border-soft px-3 py-2 last:border-b-0"
              >
                <AlertTriangle
                  className={cn(
                    'mt-[2px] h-[13px] w-[13px] shrink-0',
                    entry.level === 'error' ? 'text-destructive' : 'text-warn',
                  )}
                  strokeWidth={2.2}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                  <span className="truncate font-mono text-[11px] text-fg">{auditText(t, entry)}</span>
                  <span className="truncate font-mono text-[9.5px] text-muted-fg">
                    {formatDate(lang, entry.createdAt)} · {entry.actor}
                    {entry.kind ? ` · ${entry.kind}` : ''}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
