'use client'

import { type LiveDataPath, type LiveDataSnapshot, useLiveData } from '@pascal-app/core'
import { useEffect } from 'react'

const DEFAULT_HTTP_ENDPOINT = 'http://localhost:3102'

function normalizeHttpEndpoint(endpoint: string | undefined): string {
  const trimmed = endpoint?.trim()
  if (!trimmed) return DEFAULT_HTTP_ENDPOINT
  return trimmed.replace(/\/+$/, '')
}

function websocketEndpointFromHttp(endpoint: string): string {
  if (endpoint.startsWith('https://')) return `wss://${endpoint.slice('https://'.length)}/ws`
  if (endpoint.startsWith('http://')) return `ws://${endpoint.slice('http://'.length)}/ws`
  return `${endpoint.replace(/\/+$/, '')}/ws`
}

function isLiveDataSnapshot(value: unknown): value is LiveDataSnapshot {
  if (!(value && typeof value === 'object')) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.ts === 'number' &&
    typeof record.seq === 'number' &&
    Boolean(record.values) &&
    typeof record.values === 'object' &&
    !Array.isArray(record.values)
  )
}

function isLiveDataPathArray(value: unknown): value is LiveDataPath[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => {
      if (!(entry && typeof entry === 'object')) return false
      const record = entry as Record<string, unknown>
      return (
        typeof record.path === 'string' &&
        typeof record.label === 'string' &&
        (record.type === 'number' || record.type === 'boolean' || record.type === 'string')
      )
    })
  )
}

export function LiveDataSourceConnector() {
  const configuredHttpEndpoint = useLiveData((state) => state.httpEndpoint)
  const configuredWsEndpoint = useLiveData((state) => state.wsEndpoint)
  const reconnectToken = useLiveData((state) => state.reconnectToken)

  useEffect(() => {
    void reconnectToken
    const httpEndpoint = normalizeHttpEndpoint(
      configuredHttpEndpoint ?? process.env.NEXT_PUBLIC_PASCAL_LIVE_DATA_HTTP,
    )
    const wsEndpoint =
      configuredWsEndpoint?.trim() ||
      process.env.NEXT_PUBLIC_PASCAL_LIVE_DATA_WS?.trim() ||
      websocketEndpointFromHttp(httpEndpoint)
    const liveData = useLiveData.getState()
    const controller = new AbortController()
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let disposed = false

    liveData.setEndpoint(wsEndpoint)
    liveData.setStatus('connecting')

    async function loadPathsAndSnapshot() {
      try {
        const [pathsResponse, snapshotResponse] = await Promise.all([
          fetch(`${httpEndpoint}/paths`, { signal: controller.signal }),
          fetch(`${httpEndpoint}/snapshot`, { signal: controller.signal }),
        ])

        if (!pathsResponse.ok) throw new Error(`paths ${pathsResponse.status}`)
        if (!snapshotResponse.ok) throw new Error(`snapshot ${snapshotResponse.status}`)

        const paths = await pathsResponse.json()
        const snapshot = await snapshotResponse.json()
        if (isLiveDataPathArray(paths)) useLiveData.getState().setPaths(paths)
        if (isLiveDataSnapshot(snapshot)) useLiveData.getState().setSnapshot(snapshot)
      } catch (error) {
        if (disposed || controller.signal.aborted) return
        useLiveData
          .getState()
          .setStatus('error', error instanceof Error ? error.message : String(error))
      }
    }

    function connect() {
      if (disposed) return
      try {
        socket = new WebSocket(wsEndpoint)
      } catch (error) {
        useLiveData
          .getState()
          .setStatus('error', error instanceof Error ? error.message : String(error))
        reconnectTimer = setTimeout(connect, 2000)
        return
      }

      socket.onopen = () => {
        if (!disposed) useLiveData.getState().setStatus('connected')
      }
      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(String(event.data))
          if (isLiveDataSnapshot(parsed)) useLiveData.getState().setSnapshot(parsed)
        } catch {}
      }
      socket.onerror = () => {
        if (!disposed) useLiveData.getState().setStatus('error', 'WebSocket error')
      }
      socket.onclose = () => {
        if (disposed) return
        useLiveData.getState().setStatus('connecting')
        reconnectTimer = setTimeout(connect, 2000)
      }
    }

    loadPathsAndSnapshot()
    connect()

    return () => {
      disposed = true
      controller.abort()
      if (reconnectTimer) clearTimeout(reconnectTimer)
      socket?.close()
      useLiveData.getState().setStatus('idle')
    }
  }, [configuredHttpEndpoint, configuredWsEndpoint, reconnectToken])

  return null
}
