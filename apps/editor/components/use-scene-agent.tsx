'use client'

import {
  AgentActivity,
  type AgentActivityState,
  acquireEditorInteractionLock,
  applySceneGraphToEditor,
  type SceneGraph,
  useScene,
} from '@pascal-app/editor'
import { useCallback, useEffect, useRef, useState } from 'react'
import { sceneGraphSignature } from '@/lib/scene-signature'

type Activity = AgentActivityState & { sceneId: string; epoch: number; revision: number }
const humanStatuses = new Set(['paused', 'stopped', 'completed'])

function currentGraph(): SceneGraph {
  const { nodes, rootNodeIds, collections, materials, installedPlugins } = useScene.getState()
  return { nodes, rootNodeIds, collections, materials, installedPlugins } as SceneGraph
}

export function useSceneAgent({
  enabled,
  sceneId,
  initialRevision,
}: {
  enabled: boolean
  sceneId: string
  initialRevision: number
}) {
  const [activity, setActivity] = useState<Activity | null>(null)
  const [ready, setReady] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activityRef = useRef<Activity | null>(null)
  const humanSessionRef = useRef(false)
  const revisionRef = useRef(initialRevision)
  const savedSignatureRef = useRef<string | null>(null)
  const saveTailRef = useRef<Promise<void>>(Promise.resolve())
  const syncTailRef = useRef<Promise<void>>(Promise.resolve())
  const releaseLockRef = useRef<(() => void) | null>(null)
  const controlPendingRef = useRef(false)
  const conflictRef = useRef(false)
  const mountedRef = useRef(false)

  const lock = useCallback(() => {
    releaseLockRef.current ??= acquireEditorInteractionLock()
  }, [])

  const acceptActivity = useCallback(
    async (next: Activity) => {
      if (!mountedRef.current || next.sceneId !== sceneId || conflictRef.current) return
      const previous = activityRef.current
      if (previous && previous.runId !== next.runId && humanSessionRef.current) {
        conflictRef.current = true
        lock()
        setReady(false)
        setError('A different workflow started. Keep this tab open to preserve your edits.')
        return
      }
      if (previous?.runId === next.runId && next.epoch < previous.epoch) return
      if (
        humanSessionRef.current &&
        !humanStatuses.has(next.status) &&
        sceneGraphSignature(currentGraph()) !== savedSignatureRef.current
      ) {
        conflictRef.current = true
        lock()
        setReady(false)
        setError(
          'Another session resumed while you had unsaved edits. Your edits are preserved in this tab.',
        )
        return
      }
      activityRef.current = next
      setActivity(next)
      if (!humanStatuses.has(next.status) || next.inFlight) {
        lock()
        if (!humanStatuses.has(next.status)) humanSessionRef.current = false
        setReady(false)
      }

      const sync = async () => {
        if (!mountedRef.current || activityRef.current !== next) return
        // Human autosave acknowledgements must never replace newer, unsaved edits.
        if (
          !humanSessionRef.current &&
          (savedSignatureRef.current === null || next.revision > revisionRef.current)
        ) {
          const response = await fetch(`/api/scenes/${encodeURIComponent(sceneId)}`, {
            cache: 'no-store',
          })
          if (!response.ok) throw new Error('Could not load the last confirmed scene.')
          const scene = (await response.json()) as { version: number; graph: SceneGraph }
          if (!mountedRef.current || activityRef.current !== next) return
          if (scene.version !== next.revision) {
            throw new Error('The scene changed outside this workflow. Editing remains locked.')
          }
          applySceneGraphToEditor(scene.graph)
          revisionRef.current = scene.version
          savedSignatureRef.current = sceneGraphSignature(currentGraph())
        }
        if (activityRef.current !== next) return
        setError(null)
        const humanReady = humanStatuses.has(next.status) && !next.inFlight
        if (humanReady) humanSessionRef.current = true
        setReady(humanReady)
        if (humanReady && !controlPendingRef.current) {
          releaseLockRef.current?.()
          releaseLockRef.current = null
        }
      }
      const promise = syncTailRef.current.then(sync)
      syncTailRef.current = promise.catch((cause: unknown) => {
        lock()
        setReady(false)
        setError(cause instanceof Error ? cause.message : 'Scene synchronization failed.')
      })
      await promise
    },
    [lock, sceneId],
  )

  useEffect(() => {
    if (!enabled) return
    mountedRef.current = true
    lock()
    const source = new EventSource(`/api/scenes/${encodeURIComponent(sceneId)}/activity/events`)
    source.addEventListener('activity', (event) => {
      try {
        const next = JSON.parse((event as MessageEvent<string>).data) as Activity
        if (
          !Number.isSafeInteger(next.epoch) ||
          !Number.isSafeInteger(next.revision) ||
          !next.task
        ) {
          throw new Error('Invalid workflow state')
        }
        void acceptActivity(next).catch(() => {})
      } catch {
        lock()
        setReady(false)
        setError('The workflow sent an invalid state. Editing remains locked.')
      }
    })
    source.onerror = () => {
      lock()
      setReady(false)
      setError('Reconnecting to workflow controls. Editing stays locked until confirmed.')
    }
    return () => {
      mountedRef.current = false
      source.close()
      releaseLockRef.current?.()
      releaseLockRef.current = null
    }
  }, [acceptActivity, enabled, lock, sceneId])

  const save = useCallback(
    (graph: SceneGraph, options?: { keepalive?: boolean }) => {
      const signature = sceneGraphSignature(graph)
      const runId = activityRef.current?.runId
      if (!enabled || !humanSessionRef.current || !runId) return Promise.resolve()
      const commit = async () => {
        if (signature === savedSignatureRef.current) return
        if (!humanSessionRef.current || activityRef.current?.runId !== runId) {
          throw new Error('Editing control changed before your changes were saved.')
        }
        const response = await fetch(`/api/scenes/${encodeURIComponent(sceneId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'If-Match': String(revisionRef.current) },
          body: JSON.stringify({ graph, agentRunId: runId }),
          keepalive: options?.keepalive,
        })
        if (!response.ok)
          throw new Error(
            `Your changes could not be saved (${response.status}). Resume is blocked.`,
          )
        const receipt = (await response.json()) as { version: number }
        revisionRef.current = receipt.version
        savedSignatureRef.current = signature
      }
      const promise = saveTailRef.current.then(commit)
      saveTailRef.current = promise.catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Your changes could not be saved.')
        throw cause
      })
      // Retain the rejection for Resume while avoiding an unobserved tail rejection.
      void saveTailRef.current.catch(() => {})
      return promise
    },
    [enabled, sceneId],
  )

  const control = useCallback(
    async (action: 'pause' | 'stop' | 'resume') => {
      const current = activityRef.current
      if (!current || controlPendingRef.current) return
      controlPendingRef.current = true
      lock()
      setPending(true)
      setError(null)
      try {
        if (action === 'resume' || (action === 'stop' && humanSessionRef.current)) {
          await saveTailRef.current
          await save(currentGraph())
          humanSessionRef.current = false
          setReady(false)
        }
        const response = await fetch(`/api/scenes/${encodeURIComponent(sceneId)}/activity`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, runId: current.runId }),
        })
        if (!response.ok)
          throw new Error(`Could not confirm ${action} (${response.status}). Editing stays locked.`)
        const result = (await response.json()) as { activity: Activity }
        await acceptActivity(result.activity)
      } catch (cause) {
        setReady(false)
        setError(
          cause instanceof Error ? cause.message : 'The workflow did not confirm the handoff.',
        )
      } finally {
        controlPendingRef.current = false
        setPending(false)
        const last = activityRef.current
        if (humanSessionRef.current && last && humanStatuses.has(last.status) && !last.inFlight) {
          releaseLockRef.current?.()
          releaseLockRef.current = null
        }
      }
    },
    [acceptActivity, lock, save, sceneId],
  )

  const interactionLocked = enabled && (!ready || pending || Boolean(error))
  const banner = enabled ? (
    <div className="pointer-events-auto absolute bottom-24 left-4 z-40 w-[min(340px,calc(100%-32px))]">
      {activity ? (
        <AgentActivity
          activity={
            ready || !humanStatuses.has(activity.status)
              ? activity
              : { ...activity, status: 'pausing' }
          }
          onPause={() => {
            void control('pause')
          }}
          onResume={() => {
            void control('resume')
          }}
          onStop={() => {
            void control('stop')
          }}
          pending={pending || Boolean(error)}
        />
      ) : (
        <div className="rounded-xl border border-border bg-background/95 p-4 text-sm" role="status">
          Connecting to workflow controls…
        </div>
      )}
      {error && (
        <p
          className="mt-2 rounded-xl border border-destructive/40 bg-background p-3 text-destructive text-xs"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  ) : null
  return { banner, interactionLocked, save }
}
