import { refuse, writeTarget } from '@pascal-app/core/agent-tools'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { SceneVersionConflictError, SceneWipeBlockedError } from '../storage/types'
import { ErrorCode, McpError, throwMcpError } from './errors'

export type LiveSyncStatus = 'published' | 'unbound' | 'events_unsupported'

/** Where a write went: the project it reached, or none (a scratch scene). */
export type LiveSync = { status: LiveSyncStatus; project: string | null }

type LiveSyncSkip = Exclude<LiveSyncStatus, 'published'>

/**
 * Output-schema fragment for every tool that mutates the scene. Spread into
 * the tool's `outputSchema` so `persistencePayload` fields survive the SDK's
 * structured-content validation.
 */
export const liveSyncOutput = {
  project: z.string().nullable().optional(),
  unsaved: z.string().optional(),
  persistence: z
    .object({
      status: z.enum(['unbound', 'events_unsupported']),
      warning: z.string(),
    })
    .optional(),
}

const LIVE_SYNC_WARNINGS: Record<LiveSyncSkip, string> = {
  unbound:
    'The change was applied to the in-memory session only: no active scene is bound, so nothing was persisted and no live event reached subscribers. Bind a scene with save_scene or load_scene to persist changes.',
  events_unsupported:
    'The change was applied to the in-memory session only: the attached scene store does not support live scene events, so nothing was persisted.',
}

/**
 * Payload fragment matching `liveSyncOutput`: the project the write reached, or `null` and a note
 * when none is bound; a `persistence` warning when the mutation stayed in-memory.
 */
export function persistencePayload({ status, project }: LiveSync): {
  project: string | null
  unsaved?: string
  persistence?: { status: LiveSyncSkip; warning: string }
} {
  return {
    ...writeTarget(project),
    ...(status === 'published'
      ? {}
      : { persistence: { status, warning: LIVE_SYNC_WARNINGS[status] } }),
  }
}

/** Where the session's writes go, for a call that publishes nothing (an undo with nothing to undo). */
export function currentLiveSync(operations: SceneOperations): LiveSync {
  const project = operations.getActiveScene()?.projectId ?? null
  return { status: project ? 'published' : 'unbound', project }
}

const LIVE_SYNC_VERSION_CONFLICT = 'live_sync_version_conflict'

/**
 * Whether a tool call failed because the stored scene changed after the session
 * loaded it. The store refuses before writing, so nothing from the call persisted.
 */
export function isLiveSyncVersionConflict(error: unknown): boolean {
  return error instanceof McpError && error.message.endsWith(LIVE_SYNC_VERSION_CONFLICT)
}

/**
 * Persist the bridge's current graph to the active scene and append a live
 * event for browser subscribers. Skips persistence — reporting why — when the
 * MCP session is not currently bound to a saved scene or the store cannot
 * append scene events; callers surface that through `persistencePayload` so
 * the skip is never silent (#725).
 */
export async function publishLiveSceneSnapshot(
  operations: SceneOperations,
  kind: string,
  /** `allowSceneWipe`: the write empties the project on purpose (clear_scene). */
  options: { allowSceneWipe?: boolean } = {},
): Promise<LiveSync> {
  const active = operations.getActiveScene()
  if (!active) return { status: 'unbound', project: null }
  const project = active.projectId ?? active.id
  if (!operations.canAppendSceneEvents) return { status: 'events_unsupported', project }

  const graph = operations.exportSceneGraph()

  try {
    const meta = await operations.saveScene({
      id: active.id,
      name: active.name,
      projectId: active.projectId,
      ownerId: active.ownerId,
      thumbnailUrl: active.thumbnailUrl,
      graph,
      expectedVersion: active.version,
      ...(active.graphHash !== undefined ? { expectedGraphHash: active.graphHash } : {}),
      saveMode: 'draft',
      publish: false,
      operation: kind,
      ...(options.allowSceneWipe ? { allowSceneWipe: true } : {}),
    })
    operations.setActiveScene(meta)
    await operations.appendSceneEvent({
      sceneId: meta.id,
      version: meta.version,
      kind,
      graph,
    })
  } catch (error) {
    if (error instanceof SceneWipeBlockedError) {
      // The store kept what it held; the session goes back to it, so the agent's next write builds
      // on the project as stored rather than on the refused one (deleting the only room, say).
      const stored = await operations.loadStoredScene(active.id).catch(() => null)
      if (stored) operations.loadJSON(stored.graph)
      refuse(
        'scene_wipe_blocked',
        stored
          ? 'This write would leave the project empty, so it was blocked and nothing changed. To empty the project on purpose, call clear_scene. To remove only part of it, such as its only room, build what replaces it first, then remove it.'
          : 'This write would leave the project empty, so it was blocked and not saved. Call load_scene before writing again. To empty the project on purpose, call clear_scene.',
        { sceneId: active.id, mutationApplied: false, sessionRestored: !!stored },
      )
    }
    if (error instanceof SceneVersionConflictError) {
      throwMcpError(ErrorCode.InvalidRequest, LIVE_SYNC_VERSION_CONFLICT, {
        sceneId: active.id,
        expectedVersion: active.version,
      })
    }
    const message = error instanceof Error ? error.message : String(error)
    throwMcpError(ErrorCode.InternalError, `live_sync_failed: ${message}`)
  }
  return { status: 'published', project }
}

export async function appendLiveSceneEvent(
  operations: SceneOperations,
  sceneId: string,
  version: number,
  kind: string,
  graph: SceneGraph,
): Promise<void> {
  if (!operations.canAppendSceneEvents) return
  await operations.appendSceneEvent({ sceneId, version, kind, graph })
}
