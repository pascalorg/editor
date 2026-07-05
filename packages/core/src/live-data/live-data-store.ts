'use client'

import { create } from 'zustand'
import {
  type LiveDataPath,
  type LiveDataSnapshot,
  type LiveDataValue,
  STATIC_LIVE_DATA,
  STATIC_LIVE_DATA_PATHS,
} from './static-live-data'

export type LiveDataConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error'

type LiveDataState = {
  status: LiveDataConnectionStatus
  httpEndpoint: string | null
  wsEndpoint: string | null
  endpoint: string | null
  paths: LiveDataPath[]
  values: Record<string, LiveDataValue>
  snapshot: LiveDataSnapshot | null
  error: string | null
  reconnectToken: number
  setStatus: (status: LiveDataConnectionStatus, error?: string | null) => void
  setEndpoint: (endpoint: string | null) => void
  setSourceEndpoints: (endpoints: {
    httpEndpoint?: string | null
    wsEndpoint?: string | null
  }) => void
  setPaths: (paths: LiveDataPath[]) => void
  setSnapshot: (snapshot: LiveDataSnapshot) => void
  requestReconnect: () => void
  resetLiveData: () => void
}

const staticValues = Object.fromEntries(
  Object.values(STATIC_LIVE_DATA).map((entry) => [entry.key, entry.value]),
) as Record<string, LiveDataValue>

const MAX_LIVE_DATA_STRING_LENGTH = 256

function mergeWithStaticPaths(paths: LiveDataPath[]) {
  const merged: LiveDataPath[] = []
  const seen = new Set<string>()
  for (const path of [...paths, ...STATIC_LIVE_DATA_PATHS]) {
    if (seen.has(path.path)) continue
    seen.add(path.path)
    merged.push(path)
  }
  return merged
}

function sanitizeLiveDataValue(value: unknown): LiveDataValue | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.slice(0, MAX_LIVE_DATA_STRING_LENGTH)
  return undefined
}

export function sanitizeLiveDataSnapshot(snapshot: LiveDataSnapshot): {
  rejectedCount: number
  snapshot: LiveDataSnapshot
} {
  const values: Record<string, LiveDataValue> = {}
  let rejectedCount = 0

  for (const [path, value] of Object.entries(snapshot.values ?? {})) {
    if (!path.trim()) {
      rejectedCount += 1
      continue
    }
    const sanitized = sanitizeLiveDataValue(value)
    if (sanitized === undefined) {
      rejectedCount += 1
      continue
    }
    values[path] = sanitized
  }

  return {
    rejectedCount,
    snapshot: {
      values,
      ...(typeof snapshot.seq === 'number' && Number.isFinite(snapshot.seq)
        ? { seq: snapshot.seq }
        : {}),
      ...(typeof snapshot.timestamp === 'number' && Number.isFinite(snapshot.timestamp)
        ? { timestamp: snapshot.timestamp }
        : {}),
    },
  }
}

export const useLiveData = create<LiveDataState>((set) => ({
  status: 'idle',
  httpEndpoint: null,
  wsEndpoint: null,
  endpoint: null,
  paths: STATIC_LIVE_DATA_PATHS,
  values: staticValues,
  snapshot: null,
  error: null,
  reconnectToken: 0,
  setStatus: (status, error = null) => set({ status, error }),
  setEndpoint: (endpoint) => set({ endpoint }),
  setSourceEndpoints: (endpoints) =>
    set((state) => ({
      httpEndpoint:
        endpoints.httpEndpoint === undefined ? state.httpEndpoint : endpoints.httpEndpoint,
      wsEndpoint: endpoints.wsEndpoint === undefined ? state.wsEndpoint : endpoints.wsEndpoint,
      reconnectToken: state.reconnectToken + 1,
    })),
  setPaths: (paths) => set({ paths: mergeWithStaticPaths(paths) }),
  setSnapshot: (snapshot) =>
    set((state) => {
      const sanitized = sanitizeLiveDataSnapshot(snapshot)
      return {
        snapshot: sanitized.snapshot,
        values: { ...state.values, ...sanitized.snapshot.values },
        status: 'connected',
        error:
          sanitized.rejectedCount > 0
            ? `Ignored ${sanitized.rejectedCount} invalid live data value${sanitized.rejectedCount === 1 ? '' : 's'}.`
            : null,
      }
    }),
  requestReconnect: () => set((state) => ({ reconnectToken: state.reconnectToken + 1 })),
  resetLiveData: () =>
    set({
      status: 'idle',
      httpEndpoint: null,
      wsEndpoint: null,
      endpoint: null,
      paths: STATIC_LIVE_DATA_PATHS,
      values: staticValues,
      snapshot: null,
      error: null,
      reconnectToken: 0,
    }),
}))

export function getLiveDataValue(path: string | null | undefined): LiveDataValue | undefined {
  if (!path) return undefined
  return useLiveData.getState().values[path]
}
