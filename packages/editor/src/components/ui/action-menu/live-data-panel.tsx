'use client'

import { formatLiveDataValue, useLiveData } from '@pascal-app/core'
import { Database, RefreshCw, Settings2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '../../../lib/utils'

const DEFAULT_HTTP_ENDPOINT = 'http://localhost:3102'
export const LIVE_DATA_PATH_DRAG_MIME = 'application/x-pascal-live-data-path'

function websocketEndpointFromHttp(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, '')
  if (trimmed.startsWith('https://')) return `wss://${trimmed.slice('https://'.length)}/ws`
  if (trimmed.startsWith('http://')) return `ws://${trimmed.slice('http://'.length)}/ws`
  return `${trimmed}/ws`
}

function statusText(status: ReturnType<typeof useLiveData.getState>['status']) {
  if (status === 'connected') return '已连接'
  if (status === 'connecting') return '连接中'
  if (status === 'error') return '连接失败'
  return '未连接'
}

function normalizedEndpoint(value: string) {
  return value.trim().replace(/\/+$/, '')
}

export function LiveDataPanel() {
  const {
    endpoint,
    error,
    httpEndpoint,
    paths,
    requestReconnect,
    setSourceEndpoints,
    snapshot,
    status,
    values,
    wsEndpoint,
  } = useLiveData(useShallow((state) => ({
    endpoint: state.endpoint,
    error: state.error,
    httpEndpoint: state.httpEndpoint,
    paths: state.paths,
    requestReconnect: state.requestReconnect,
    setSourceEndpoints: state.setSourceEndpoints,
    snapshot: state.snapshot,
    status: state.status,
    values: state.values,
    wsEndpoint: state.wsEndpoint,
  })))
  const [expanded, setExpanded] = useState(false)
  const effectiveHttpEndpoint =
    httpEndpoint ?? process.env.NEXT_PUBLIC_PASCAL_LIVE_DATA_HTTP ?? DEFAULT_HTTP_ENDPOINT
  const effectiveWsEndpoint =
    wsEndpoint ?? process.env.NEXT_PUBLIC_PASCAL_LIVE_DATA_WS ?? websocketEndpointFromHttp(effectiveHttpEndpoint)
  const [httpDraft, setHttpDraft] = useState(effectiveHttpEndpoint)
  const [wsDraft, setWsDraft] = useState(effectiveWsEndpoint)
  const visiblePaths = useMemo(() => paths.slice(0, expanded ? 12 : 4), [expanded, paths])

  const applyEndpoints = () => {
    const nextHttp = normalizedEndpoint(httpDraft) || DEFAULT_HTTP_ENDPOINT
    const nextWs = normalizedEndpoint(wsDraft) || websocketEndpointFromHttp(nextHttp)
    setSourceEndpoints({ httpEndpoint: nextHttp, wsEndpoint: nextWs })
  }

  return (
    <div className="w-[38rem] max-w-[calc(100vw-2rem)] rounded-xl border border-white/10 bg-[#151517]/95 p-3 text-white shadow-2xl backdrop-blur-xl" data-testid="live-data-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <span
            className={cn(
              'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
              status === 'connected' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-200',
            )}
          >
            <Database className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">实时数据源</span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px]',
                  status === 'connected'
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : status === 'error'
                      ? 'bg-red-500/15 text-red-300'
                      : 'bg-amber-500/15 text-amber-200',
                )}
              >
                {statusText(status)}
              </span>
            </div>
            <div className="mt-1 truncate text-muted-foreground text-xs">
              {endpoint ?? effectiveWsEndpoint}
            </div>
            {error ? <div className="mt-1 text-red-300 text-xs">{error}</div> : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-white/10 hover:text-white"
            onClick={requestReconnect}
            title="重新连接"
            type="button"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-white/10 hover:text-white"
            data-testid="live-data-panel-toggle-details"
            onClick={() => setExpanded((value) => !value)}
            title="数据源设置"
            type="button"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2 border-white/10 border-t pt-3">
          <label className="flex flex-col gap-1 text-muted-foreground text-[10px]">
            HTTP API
            <input
              className="h-8 rounded-md border border-white/10 bg-black/30 px-2 text-white text-xs outline-none focus:border-violet-400/60"
              onChange={(event) => {
                const value = event.target.value
                setHttpDraft(value)
                if (!wsEndpoint) setWsDraft(websocketEndpointFromHttp(value))
              }}
              value={httpDraft}
            />
          </label>
          <label className="flex flex-col gap-1 text-muted-foreground text-[10px]">
            WebSocket
            <input
              className="h-8 rounded-md border border-white/10 bg-black/30 px-2 text-white text-xs outline-none focus:border-violet-400/60"
              onChange={(event) => setWsDraft(event.target.value)}
              value={wsDraft}
            />
          </label>
          <button
            className="mt-[18px] h-8 rounded-md bg-violet-500/20 px-3 font-medium text-violet-100 text-xs transition hover:bg-violet-500/30"
            onClick={applyEndpoints}
            type="button"
          >
            应用
          </button>
        </div>
      ) : null}

      <div className="mt-3 grid max-h-48 gap-1 overflow-y-auto">
        {visiblePaths.map((path) => (
          <div
            className="grid cursor-grab grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md bg-white/[0.04] px-2 py-1.5 text-xs transition hover:bg-white/[0.08] active:cursor-grabbing"
            data-testid={`live-data-path-${path.path}`}
            draggable
            key={path.path}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'copy'
              event.dataTransfer.setData(LIVE_DATA_PATH_DRAG_MIME, path.path)
              event.dataTransfer.setData('text/plain', path.path)
            }}
          >
            <div className="min-w-0">
              <div className="truncate text-white">{path.label}</div>
              <div className="truncate text-muted-foreground text-[10px]">{path.path}</div>
            </div>
            <div className="font-mono text-violet-100">
              {formatLiveDataValue(values[path.path], path.unit)}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between text-muted-foreground text-[10px]">
        <span>{paths.length} 条路径</span>
        <span>seq {snapshot?.seq ?? '-'}</span>
      </div>
    </div>
  )
}
