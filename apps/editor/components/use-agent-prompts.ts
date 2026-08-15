'use client'

import { useAgentActivity } from '@pascal-app/editor'
import { useEffect } from 'react'

/**
 * Wire the editor's agent prompt box to the scene's request queue.
 *
 * The transport lives here rather than in `packages/editor` because the queue
 * is this app's API route; an embedder without it gets no prompt box at all.
 *
 * Polling rather than SSE: the existing `/events` stream carries scene
 * snapshots, and a prompt's status changes a handful of times over its life —
 * adding a second stream to watch three state transitions is not worth the
 * connection.
 */

const POLL_MS = 2000

type AgentRequestRow = {
  requestId: number
  prompt: string
  status: 'pending' | 'claimed' | 'answered'
  answer: string | null
  createdAt: string
  claimedAt: string | null
}

export function useAgentPrompts(sceneId: string): void {
  useEffect(() => {
    const store = useAgentActivity.getState()
    let cancelled = false

    store.setSendPrompt(async (prompt: string) => {
      const response = await fetch(`/api/scenes/${sceneId}/agent-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `Request failed (${response.status})`)
      }
      await refresh()
    })

    async function refresh() {
      try {
        const response = await fetch(`/api/scenes/${sceneId}/agent-requests`)
        if (!response.ok) return
        const body = (await response.json()) as { requests?: AgentRequestRow[] }
        if (cancelled || !body.requests) return
        useAgentActivity.getState().setPrompts(
          body.requests.map((row) => ({
            requestId: row.requestId,
            prompt: row.prompt,
            status: row.status,
            answer: row.answer,
            createdAt: row.createdAt,
            claimedAt: row.claimedAt,
          })),
        )
      } catch {
        // A failed poll is not worth surfacing; the next one covers it.
      }
    }

    void refresh()
    const timer = setInterval(() => void refresh(), POLL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
      const current = useAgentActivity.getState()
      current.setSendPrompt(null)
      current.setPrompts([])
    }
  }, [sceneId])
}
