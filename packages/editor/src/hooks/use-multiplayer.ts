'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import {
  bindZustandToYjs,
  MultiplayerAwarenessService,
  MultiplayerUndoManager,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  type UserPresence,
  type ClientRole,
  type MultiplayerConnectionStatus,
} from '@pascal-app/core'

export interface UseMultiplayerOptions {
  sceneId: string
  serverUrl?: string
  role?: ClientRole
  userId?: string
  name?: string
  color?: string
  enabled?: boolean
}

export interface UseMultiplayerResult {
  status: MultiplayerConnectionStatus
  presences: Map<number, UserPresence>
  localClientId: number | null
  doc: Y.Doc | null
  awarenessService: MultiplayerAwarenessService | null
  undoManager: MultiplayerUndoManager | null
}

const DEFAULT_COLORS = [
  '#f43f5e', // Rose
  '#3b82f6', // Blue
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#06b6d4', // Cyan
  '#84cc16', // Lime
]

function getRandomColor(): string {
  const selected = DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)]
  return selected ?? '#3b82f6'
}

export function useMultiplayer({
  sceneId,
  serverUrl = process.env.NEXT_PUBLIC_COLLAB_WS_URL || 'ws://127.0.0.1:3002/collab/v1',
  role = 'editor',
  userId,
  name,
  color,
  enabled = true,
}: UseMultiplayerOptions): UseMultiplayerResult {
  const [status, setStatus] = useState<MultiplayerConnectionStatus>('disconnected')
  const [presences, setPresences] = useState<Map<number, UserPresence>>(new Map())
  const [localClientId, setLocalClientId] = useState<number | null>(null)

  const docRef = useRef<Y.Doc | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const awarenessRef = useRef<awarenessProtocol.Awareness | null>(null)
  const awarenessServiceRef = useRef<MultiplayerAwarenessService | null>(null)
  const undoManagerRef = useRef<MultiplayerUndoManager | null>(null)

  const userColor = useMemo(() => color || getRandomColor(), [color])
  const effectiveUserId = useMemo(
    () => userId || `user_${Math.random().toString(36).slice(2, 8)}`,
    [userId],
  )
  const effectiveName = useMemo(
    () => name || `User ${effectiveUserId.slice(0, 4)}`,
    [name, effectiveUserId],
  )

  // Track latest dynamic attributes via refs for socket init / event callbacks
  const roleRef = useRef<ClientRole>(role)
  const nameRef = useRef<string>(effectiveName)
  const colorRef = useRef<string>(userColor)

  useEffect(() => {
    roleRef.current = role
  }, [role])

  useEffect(() => {
    nameRef.current = effectiveName
  }, [effectiveName])

  useEffect(() => {
    colorRef.current = userColor
  }, [userColor])

  // 1. Connection Lifecycle Effect: Scoped strictly to session and user identity.
  // NOTE: `role`, `effectiveName`, and `userColor` are explicitly omitted from the dependency array
  // to avoid destroying the Y.Doc, closing the WebSocket, or triggering full Sync Step 1 re-hydration
  // during in-place role switches (e.g. Viewer -> Editor).
  useEffect(() => {
    if (!enabled || !sceneId) return

    setStatus('connecting')

    const doc = new Y.Doc()
    const awareness = new awarenessProtocol.Awareness(doc)
    docRef.current = doc
    awarenessRef.current = awareness
    setLocalClientId(awareness.clientID)

    // Build WebSocket URL with query params
    const wsUrl = new URL(serverUrl.startsWith('ws') ? serverUrl : `ws://${serverUrl}`)
    wsUrl.pathname = `${wsUrl.pathname.replace(/\/$/, '')}/scene:${sceneId}`
    wsUrl.searchParams.set('sceneId', sceneId)
    wsUrl.searchParams.set('userId', effectiveUserId)
    wsUrl.searchParams.set('name', nameRef.current)
    wsUrl.searchParams.set('role', roleRef.current)
    wsUrl.searchParams.set('color', colorRef.current)

    const ws = new WebSocket(wsUrl.toString())
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    // Initialize Awareness Service
    const awarenessService = new MultiplayerAwarenessService({
      awareness,
      localPresence: {
        userId: effectiveUserId,
        name: nameRef.current,
        role: roleRef.current,
        color: colorRef.current,
      },
    })
    awarenessServiceRef.current = awarenessService

    const unsubscribeAwareness = awarenessService.subscribe((updatedPresences) => {
      setPresences(new Map(updatedPresences))
    })

    // Initialize Bidirectional Bridge
    const unbindBridge = bindZustandToYjs({ doc })

    // Initialize Undo Manager
    const undoManager = new MultiplayerUndoManager({ doc })
    undoManagerRef.current = undoManager

    // Doc update sender
    const handleDocUpdate = (update: Uint8Array, origin: any) => {
      if (origin !== 'remote' && ws.readyState === WebSocket.OPEN) {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MESSAGE_SYNC)
        syncProtocol.writeUpdate(encoder, update)
        ws.send(encoding.toUint8Array(encoder))
      }
    }
    doc.on('update', handleDocUpdate)

    // Awareness update sender
    const handleAwarenessUpdate = ({ added, updated, removed }: any, origin: any) => {
      if (origin !== 'remote' && ws.readyState === WebSocket.OPEN) {
        const changedClients = [...added, ...updated, ...removed]
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients),
        )
        ws.send(encoding.toUint8Array(encoder))
      }
    }
    awareness.on('update', handleAwarenessUpdate)

    ws.onopen = () => {
      setStatus('connected')
      // Send Sync Step 1 to server
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      syncProtocol.writeSyncStep1(encoder, doc)
      ws.send(encoding.toUint8Array(encoder))

      // Send local awareness
      const awarenessEncoder = encoding.createEncoder()
      encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID]),
      )
      ws.send(encoding.toUint8Array(awarenessEncoder))
    }

    ws.onmessage = (event: MessageEvent) => {
      try {
        const uint8 = new Uint8Array(event.data as ArrayBuffer)
        const decoder = decoding.createDecoder(uint8)
        const messageType = decoding.readVarUint(decoder)

        if (messageType === MESSAGE_SYNC) {
          const responseEncoder = encoding.createEncoder()
          encoding.writeVarUint(responseEncoder, MESSAGE_SYNC)
          syncProtocol.readSyncMessage(decoder, responseEncoder, doc, 'remote')
          if (encoding.length(responseEncoder) > 1 && ws.readyState === WebSocket.OPEN) {
            ws.send(encoding.toUint8Array(responseEncoder))
          }
        } else if (messageType === MESSAGE_AWARENESS) {
          awarenessProtocol.applyAwarenessUpdate(
            awareness,
            decoding.readVarUint8Array(decoder),
            'remote',
          )
        }
      } catch (err) {
        console.error('[useMultiplayer] Error processing incoming packet:', err)
      }
    }

    ws.onerror = () => {
      setStatus('error')
    }

    ws.onclose = () => {
      setStatus('disconnected')
    }

    return () => {
      unbindBridge()
      unsubscribeAwareness()
      awarenessService.destroy()
      undoManager.destroy()
      doc.off('update', handleDocUpdate)
      awareness.off('update', handleAwarenessUpdate)

      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close()
      }
      doc.destroy()
      awareness.destroy()

      docRef.current = null
      wsRef.current = null
      awarenessRef.current = null
      awarenessServiceRef.current = null
      undoManagerRef.current = null
      setStatus('disconnected')
      setLocalClientId(null)
      setPresences(new Map())
    }
  }, [sceneId, serverUrl, effectiveUserId, enabled])

  // 2. In-Place Dynamic Presence & Role Transition Effect:
  // When `role`, `effectiveName`, or `userColor` updates while connected, update awareness in-place
  // without tearing down the WebSocket, Y.Doc, or UndoManager.
  useEffect(() => {
    const awarenessService = awarenessServiceRef.current
    if (!awarenessService) return

    awarenessService.setLocalState({
      role,
      name: effectiveName,
      color: userColor,
    })
    awarenessService.flushLocalState()
  }, [role, effectiveName, userColor])

  return {
    status,
    presences,
    localClientId,
    doc: docRef.current,
    awarenessService: awarenessServiceRef.current,
    undoManager: undoManagerRef.current,
  }
}
