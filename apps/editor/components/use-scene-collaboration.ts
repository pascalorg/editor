'use client'

import {
  ActorCollaborationHistory,
  type AnyNode,
  type AnyNodeId,
  applySceneSnapshot,
  type CollaborationBatch,
  type CollaborationConflict,
  collaborationSnapshot,
  createCollaborationBatch,
  getSceneHistoryPauseDepth,
  subscribeCollaborationCommits,
  useScene,
} from '@pascal-app/core'
import {
  installHistoryCommandDelegate,
  type SceneGraph,
  syncEditorSelectionFromCurrentScene,
  useCollaborationPresence,
  useViewer,
} from '@pascal-app/editor'
import { type MutableRefObject, useCallback, useEffect, useMemo, useRef } from 'react'

type CollaborationSceneEvent = {
  eventId: number
  sceneId: string
  version: number
  kind: string
  createdAt: string
  graph: SceneGraph
}

type CollaborationResponse = {
  /** Notification shape: no graph, the same as what the SSE feed carries. */
  event: Omit<CollaborationSceneEvent, 'graph'> | null
  /** The merged result, returned only to the publisher that asked for it. */
  graph: SceneGraph
  conflicts: CollaborationConflict[]
}

type UseSceneCollaborationOptions = {
  initialGraph: SceneGraph
  sceneId: string
  versionRef: MutableRefObject<number>
  onAuthoritativeGraph: (event: CollaborationSceneEvent) => void
  onError: (message: string | null) => void
}

/** How often a live batch is filed as a version someone can return to. */
const COLLABORATION_CHECKPOINT_MS = 5 * 60 * 1000
const CURSOR_PUBLISH_MS = 80
const PRESENCE_HEARTBEAT_MS = 5_000
const ACTOR_STORAGE_KEY = 'pascal-collaboration-actor:v1'
const PARTICIPANT_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#059669', '#0891b2']

function currentSnapshot() {
  const state = useScene.getState()
  return collaborationSnapshot(state.nodes, state.rootNodeIds, state)
}

function snapshotFromGraph(graph: SceneGraph) {
  return collaborationSnapshot(
    graph.nodes as Record<AnyNodeId, AnyNode>,
    graph.rootNodeIds as AnyNodeId[],
    graph as never,
  )
}

function currentModelSignature(): string {
  return JSON.stringify(currentSnapshot())
}

function graphModelSignature(graph: SceneGraph): string {
  return JSON.stringify(snapshotFromGraph(graph))
}

function actorIdentity(): { actorId: string; color: string; name: string } {
  let actorId = sessionStorage.getItem(ACTOR_STORAGE_KEY)
  if (!actorId) {
    actorId = crypto.randomUUID()
    sessionStorage.setItem(ACTOR_STORAGE_KEY, actorId)
  }
  let hash = 0
  for (const character of actorId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return {
    actorId,
    color: PARTICIPANT_COLORS[hash % PARTICIPANT_COLORS.length]!,
    name: `User ${actorId.slice(0, 4)}`,
  }
}

function nextOperationId(): string {
  return crypto.randomUUID()
}

function selectedNodeIds(): string[] {
  const selection = useViewer.getState().selection
  return [
    selection.buildingId,
    selection.levelId,
    selection.zoneId,
    ...selection.selectedIds,
  ].filter((id): id is string => Boolean(id))
}

export function useSceneCollaboration({
  initialGraph,
  sceneId,
  versionRef,
  onAuthoritativeGraph,
  onError,
}: UseSceneCollaborationOptions): {
  receiveCollaborationEvent: (event: CollaborationSceneEvent) => void
  waitForCollaboration: () => Promise<void>
} {
  const receiveRef = useRef<(event: CollaborationSceneEvent) => void>(() => {})
  const waitRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const onAuthoritativeGraphRef = useRef(onAuthoritativeGraph)
  const onErrorRef = useRef(onError)
  const initialModelSignature = useMemo(() => graphModelSignature(initialGraph), [initialGraph])

  useEffect(() => {
    onAuthoritativeGraphRef.current = onAuthoritativeGraph
  }, [onAuthoritativeGraph])
  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  useEffect(() => {
    const identity = actorIdentity()
    const history = new ActorCollaborationHistory(identity.actorId)
    let clock = versionRef.current
    let disposed = false
    let pending = 0
    let latestAuthoritative: CollaborationSceneEvent | null = null
    let publishQueue = Promise.resolve()
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let conflictTimer: ReturnType<typeof setTimeout> | undefined
    let initialLoadObserved = currentModelSignature() === initialModelSignature

    const showConflicts = (conflicts: CollaborationConflict[]) => {
      if (conflicts.length === 0) return
      useCollaborationPresence
        .getState()
        .setConflict('A concurrent tree move was kept at the scene root.')
      if (conflictTimer) clearTimeout(conflictTimer)
      conflictTimer = setTimeout(() => useCollaborationPresence.getState().setConflict(null), 4000)
    }

    const applyLatestAuthoritative = () => {
      if (disposed || pending > 0 || !latestAuthoritative) return
      if (!useScene.temporal.getState().isTracking || getSceneHistoryPauseDepth() > 0) {
        retryTimer = setTimeout(applyLatestAuthoritative, 50)
        return
      }
      const event = latestAuthoritative
      latestAuthoritative = null
      if (currentModelSignature() !== graphModelSignature(event.graph)) {
        applySceneSnapshot(snapshotFromGraph(event.graph), { origin: 'host' })
        syncEditorSelectionFromCurrentScene()
      }
      onAuthoritativeGraphRef.current(event)
    }

    /**
     * Batches are drafts, which the store rewrites in place. History still has
     * to advance, so one batch every five minutes is promoted to a checkpoint —
     * the same rule the autosave PUT follows, applied to the channel that
     * actually carries the model.
     */
    let lastCheckpointAt = Date.now()

    const publish = (batch: CollaborationBatch) => {
      if (batch.changes.length === 0) return
      const now = Date.now()
      const saveMode =
        now - lastCheckpointAt >= COLLABORATION_CHECKPOINT_MS ? 'checkpoint' : 'draft'
      if (saveMode === 'checkpoint') lastCheckpointAt = now
      pending += 1
      publishQueue = publishQueue
        .then(async () => {
          let response: Response | null = null
          for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
              response = await fetch(`/api/scenes/${sceneId}/collaboration`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...batch, saveMode }),
              })
              if (response.ok || response.status < 500) break
            } catch {
              response = null
            }
          }
          if (!response?.ok) throw new Error(`Live collaboration failed (${response?.status ?? 0})`)
          const payload = (await response.json()) as CollaborationResponse
          showConflicts(payload.conflicts)
          if (payload.event) {
            const authoritative = { ...payload.event, graph: payload.graph }
            clock = Math.max(clock, authoritative.version)
            versionRef.current = Math.max(versionRef.current, authoritative.version)
            if (!latestAuthoritative || authoritative.version > latestAuthoritative.version) {
              latestAuthoritative = authoritative
            }
          }
          onErrorRef.current(null)
        })
        .catch((error) => {
          onErrorRef.current(error instanceof Error ? error.message : 'Live collaboration failed')
        })
        .finally(() => {
          pending = Math.max(0, pending - 1)
          applyLatestAuthoritative()
        })
    }

    receiveRef.current = (event) => {
      clock = Math.max(clock, event.version)
      versionRef.current = Math.max(versionRef.current, event.version)
      if (!latestAuthoritative || event.version > latestAuthoritative.version) {
        latestAuthoritative = event
      }
      applyLatestAuthoritative()
    }

    const nextStamp = () => ({ clock: ++clock, operationId: nextOperationId() })
    const applyHistoryResult = (result: ReturnType<ActorCollaborationHistory['undo']>) => {
      if (!result) return
      applySceneSnapshot(result.snapshot, { origin: 'host' })
      syncEditorSelectionFromCurrentScene()
      publish(result.batch)
    }
    const stopHistory = installHistoryCommandDelegate({
      undo: () => applyHistoryResult(history.undo(currentSnapshot(), nextStamp())),
      redo: () => applyHistoryResult(history.redo(currentSnapshot(), nextStamp())),
    })
    const stopCommits = subscribeCollaborationCommits(currentSnapshot, (commit) => {
      if (!initialLoadObserved && JSON.stringify(commit.current) === initialModelSignature) {
        initialLoadObserved = true
        return
      }
      initialLoadObserved = true
      const batch = createCollaborationBatch(commit.before, commit.current, {
        actorId: identity.actorId,
        ...nextStamp(),
      })
      if (batch.changes.length === 0) return
      history.record(commit)
      publish(batch)
    })
    waitRef.current = () => publishQueue.then(() => {})

    return () => {
      disposed = true
      receiveRef.current = () => {}
      waitRef.current = () => Promise.resolve()
      stopCommits()
      stopHistory()
      if (retryTimer) clearTimeout(retryTimer)
      if (conflictTimer) clearTimeout(conflictTimer)
    }
  }, [initialModelSignature, sceneId, versionRef])

  useEffect(() => {
    const identity = actorIdentity()
    const presence = useCollaborationPresence.getState()
    presence.setLocalActorId(identity.actorId)
    let cursor: { x: number; y: number } | null = null
    let selectedIds = selectedNodeIds()
    let publishTimer: ReturnType<typeof setTimeout> | undefined
    let publishing = false
    let publishAgain = false
    let disposed = false

    const publishPresence = async () => {
      if (disposed) return
      if (publishing) {
        publishAgain = true
        return
      }
      publishing = true
      try {
        await fetch(`/api/scenes/${sceneId}/presence`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...identity, cursor, selectedIds }),
        })
      } finally {
        publishing = false
        if (publishAgain) {
          publishAgain = false
          void publishPresence()
        }
      }
    }

    const schedulePresence = () => {
      if (publishTimer) return
      publishTimer = setTimeout(() => {
        publishTimer = undefined
        void publishPresence()
      }, CURSOR_PUBLISH_MS)
    }
    const handlePointerMove = (event: PointerEvent) => {
      const surface = document.querySelector<HTMLElement>('[data-collaboration-presence]')
      const bounds = surface?.getBoundingClientRect()
      if (!(bounds && bounds.width > 0 && bounds.height > 0)) return
      if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      ) {
        cursor = null
        schedulePresence()
        return
      }
      cursor = {
        x: (event.clientX - bounds.left) / bounds.width,
        y: (event.clientY - bounds.top) / bounds.height,
      }
      schedulePresence()
    }
    const stopSelection = useViewer.subscribe((state, previous) => {
      if (state.selection === previous.selection) return
      selectedIds = selectedNodeIds()
      schedulePresence()
    })
    const source = new EventSource(`/api/scenes/${sceneId}/presence`)
    source.addEventListener('open', () => presence.setConnected(true))
    source.addEventListener('presence', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as {
          participants: Parameters<typeof presence.setParticipants>[0]
        }
        presence.setParticipants(payload.participants)
      } catch {}
    })
    source.addEventListener('error', () => presence.setConnected(false))

    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    const heartbeat = setInterval(() => void publishPresence(), PRESENCE_HEARTBEAT_MS)
    void publishPresence()

    return () => {
      disposed = true
      source.close()
      stopSelection()
      window.removeEventListener('pointermove', handlePointerMove)
      clearInterval(heartbeat)
      if (publishTimer) clearTimeout(publishTimer)
      fetch(`/api/scenes/${sceneId}/presence?actorId=${encodeURIComponent(identity.actorId)}`, {
        method: 'DELETE',
        keepalive: true,
      }).catch(() => {})
      useViewer.getState().setExternalSelectedIds([])
      presence.reset()
    }
  }, [sceneId])

  const receiveCollaborationEvent = useCallback((event: CollaborationSceneEvent) => {
    receiveRef.current(event)
  }, [])
  const waitForCollaboration = useCallback(() => waitRef.current(), [])

  return { receiveCollaborationEvent, waitForCollaboration }
}
