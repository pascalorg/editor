import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'

/**
 * Slug-safe scene identifier: lowercase alphanumerics and hyphens, ≤ 64 chars.
 */
export type SceneId = string

export interface SceneMeta {
  id: SceneId
  name: string
  projectId: string | null
  thumbnailUrl: string | null
  /** Monotonic, incremented on every save. */
  version: number
  /** ISO 8601 timestamp. */
  createdAt: string
  /** ISO 8601 timestamp. */
  updatedAt: string
  ownerId: string | null
  sizeBytes: number
  nodeCount: number
}

export interface SceneWithGraph extends SceneMeta {
  graph: SceneGraph
}

export interface SceneEvent {
  eventId: number
  sceneId: SceneId
  version: number
  kind: string
  createdAt: string
  graph: SceneGraph
}

export interface SceneSaveOptions {
  id?: SceneId
  name: string
  projectId?: string | null
  ownerId?: string | null
  graph: SceneGraph
  thumbnailUrl?: string | null
  /** When set, save fails with `SceneVersionConflictError` on mismatch. */
  expectedVersion?: number
}

export interface SceneListOptions {
  projectId?: string
  ownerId?: string
  limit?: number
}

export interface SceneMutateOptions {
  expectedVersion?: number
}

export interface SceneEventAppendOptions {
  sceneId: SceneId
  version: number
  kind: string
  graph: SceneGraph
}

export interface SceneEventListOptions {
  afterEventId?: number
  limit?: number
}

export interface SceneStore {
  readonly backend: 'sqlite'
  save(opts: SceneSaveOptions): Promise<SceneMeta>
  load(id: SceneId): Promise<SceneWithGraph | null>
  list(opts?: SceneListOptions): Promise<SceneMeta[]>
  delete(id: SceneId, opts?: SceneMutateOptions): Promise<boolean>
  rename(id: SceneId, newName: string, opts?: SceneMutateOptions): Promise<SceneMeta>
  appendSceneEvent?(opts: SceneEventAppendOptions): Promise<SceneEvent>
  listSceneEvents?(sceneId: SceneId, opts?: SceneEventListOptions): Promise<SceneEvent[]>
}

export class SceneNotFoundError extends Error {
  readonly code = 'not_found' as const
  constructor(message = 'Scene not found') {
    super(message)
    this.name = 'SceneNotFoundError'
  }
}

export class SceneVersionConflictError extends Error {
  readonly code = 'version_conflict' as const
  constructor(message = 'Scene version conflict') {
    super(message)
    this.name = 'SceneVersionConflictError'
  }
}

export class SceneInvalidError extends Error {
  readonly code = 'invalid' as const
  constructor(message = 'Scene invalid') {
    super(message)
    this.name = 'SceneInvalidError'
  }
}

export class SceneTooLargeError extends Error {
  readonly code = 'too_large' as const
  constructor(message = 'Scene too large') {
    super(message)
    this.name = 'SceneTooLargeError'
  }
}
