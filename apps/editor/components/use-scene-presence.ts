'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from '@/components/auth/session-provider'

export interface Person {
  userId: string
  email: string | null
  isEditor: boolean
}

interface PresenceResponse {
  isEditor: boolean
  canEdit: boolean
  editor: { userId: string; email: string | null } | null
  present: Person[]
}

export interface ScenePresence {
  loaded: boolean
  present: Person[]
  isEditor: boolean
  canEdit: boolean
  editor: { userId: string; email: string | null } | null
  takeOver: () => void
  passControl: (targetUserId: string) => Promise<void>
}

const IDLE: ScenePresence = {
  loaded: false,
  present: [],
  isEditor: false,
  canEdit: false,
  editor: null,
  takeOver: () => {},
  passControl: async () => {},
}

const HEARTBEAT_MS = 10_000

/**
 * Reflects the server's single-active-editor lease and live presence for a
 * scene. The client never decides who edits — every heartbeat re-reads the
 * lease the server enforces atomically and mirrors it.
 */
export function useScenePresence(sceneId: string, enabled: boolean): ScenePresence {
  const { user } = useSession()
  const active = enabled && !!user

  // Initialized true so the first opener auto-claims the free lease.
  const wantsEditRef = useRef(true)
  const [state, setState] = useState<Omit<ScenePresence, 'takeOver' | 'passControl'>>({
    loaded: false,
    present: [],
    isEditor: false,
    canEdit: false,
    editor: null,
  })

  const aliveRef = useRef(false)
  const beatRef = useRef<() => Promise<void>>(async () => {})

  const beat = useCallback(async () => {
    try {
      const response = await fetch(`/api/scenes/${sceneId}/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim: wantsEditRef.current }),
      })
      if (!response.ok) return
      const data = (await response.json()) as PresenceResponse
      // Hold the lease if we have it; otherwise become a passive viewer and do
      // not auto-retake — a takeover is always a manual click.
      wantsEditRef.current = data.isEditor
      if (!aliveRef.current) return
      setState({
        loaded: true,
        present: data.present,
        isEditor: data.isEditor,
        canEdit: data.canEdit,
        editor: data.editor,
      })
    } catch {
      // A dropped heartbeat is transient; the next interval retries.
    }
  }, [sceneId])

  beatRef.current = beat

  const passControl = useCallback(
    async (targetUserId: string) => {
      wantsEditRef.current = false
      try {
        const response = await fetch(`/api/scenes/${sceneId}/presence`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wantsEdit: false,
            transferToUserId: targetUserId,
          }),
        })
        if (!response.ok) {
          await beatRef.current()
          return
        }
        const data = (await response.json()) as PresenceResponse
        wantsEditRef.current = data.isEditor
        if (!aliveRef.current) return
        setState({
          loaded: true,
          present: data.present,
          isEditor: data.isEditor,
          canEdit: data.canEdit,
          editor: data.editor,
        })
      } catch {
        await beatRef.current()
      }
    },
    [sceneId],
  )

  useEffect(() => {
    if (!active) return

    aliveRef.current = true
    void beat()
    const interval = setInterval(() => void beat(), HEARTBEAT_MS)

    const leave = () => {
      try {
        void fetch(`/api/scenes/${sceneId}/presence`, {
          method: 'DELETE',
          keepalive: true,
        })
      } catch {
        // Best-effort on the way out.
      }
    }
    window.addEventListener('pagehide', leave)

    return () => {
      aliveRef.current = false
      clearInterval(interval)
      window.removeEventListener('pagehide', leave)
      leave()
    }
  }, [active, sceneId, beat])

  const takeOver = useCallback(() => {
    wantsEditRef.current = true
    void beatRef.current()
  }, [])

  if (!active) return IDLE

  return { ...state, takeOver, passControl }
}
