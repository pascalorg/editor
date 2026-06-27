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
    set((state) => ({
      snapshot,
      values: { ...state.values, ...snapshot.values },
      status: 'connected',
      error: null,
    })),
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
