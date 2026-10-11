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
  /** Browser-visible model version. Draft saves may update the same version repeatedly. */
  version: number
  /** ISO 8601 timestamp. */
  createdAt: string
  /** ISO 8601 timestamp. */
  updatedAt: string
  ownerId: string | null
  sizeBytes: number
  nodeCount: number
  /** Browser route agents should return to users. Hosted apps should prefer /editor/<projectId>. */
  editorUrl?: string
  /** Backward-compatible alias for clients that still read url. */
  url?: string
  /** True when this version is the published one (hosted: what the project's viewers see). */
  published?: boolean
  /** True when the saved graph is still the mutable browser-visible draft. */
  isDraft?: boolean
  /** How the scene was saved. Draft saves should not create meaningful history versions. */
  saveMode?: SceneSaveMode
  /** Stable hash of the graph payload used for save/load/status matching. */
  graphHash?: string
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
  /**
   * When set, save fails with `SceneVersionConflictError` unless the stored graph still hashes to
   * this. A draft saved in place keeps its version number, so only the content tells that an
   * open editor wrote in between.
   */
  expectedGraphHash?: string | null
  /** `draft` updates the browser-visible working model; `checkpoint` records version history. */
  saveMode?: SceneSaveMode
  /** Publish this checkpoint. Only an explicit `true` publishes; a checkpoint alone never does. */
  publish?: boolean
  /** Optional hosted MCP session id for project presence/debug metadata. */
  agentSessionId?: string
  /** Optional high-level operation name for presence/debug metadata. */
  operation?: string
  /**
   * The write empties a populated project on purpose (clear_scene). A store may refuse a write that
   * empties the project unless this is set, with `SceneWipeBlockedError`.
   */
  allowSceneWipe?: boolean
}

export type SceneSaveMode = 'draft' | 'checkpoint'

export interface SceneListOptions {
  projectId?: string
  ownerId?: string
  limit?: number
}

export interface SceneMutateOptions {
  expectedVersion?: number
}

/**
 * What `delete` did. A local store removes the scene; hosted Pascal never deletes a project this
 * way and only hides it, with a `message` saying so.
 */
export type SceneDeleteResult = {
  deleted: boolean
  hidden: boolean
  message?: string
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

export interface ProjectCreateOptions {
  id?: SceneId
  name: string
  ownerId?: string | null
  isPrivate?: boolean
}

export interface ProjectStatus {
  id: SceneId
  projectId: string
  name: string
  editorUrl: string
  url: string
  ownerId: string | null
  thumbnailUrl: string | null
  publishedVersion: number | null
  latestVersion: number | null
  draftVersion: number | null
  browserVisibleVersion: number | null
  /** Alias for the browser-visible/latest meaningful version. */
  version: number
  isEmpty: boolean
  sizeBytes: number
  nodeCount: number
  graphHash: string | null
  createdAt: string
  updatedAt: string
}

export interface SceneStore {
  readonly backend: 'sqlite' | 'supabase'
  createProject?(opts: ProjectCreateOptions): Promise<ProjectStatus>
  getProjectStatus?(id: SceneId): Promise<ProjectStatus | null>
  save(opts: SceneSaveOptions): Promise<SceneMeta>
  load(id: SceneId): Promise<SceneWithGraph | null>
  list(opts?: SceneListOptions): Promise<SceneMeta[]>
  delete(id: SceneId, opts?: SceneMutateOptions): Promise<SceneDeleteResult>
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

/**
 * A store refused a write that would empty a populated project without `allowSceneWipe`: far more
 * often an accident (a client that never finished loading, a deletion of everything) than an intent.
 * Still an invalid write to a caller that only knows `SceneInvalidError`; the MCP answers it
 * `scene_wipe_blocked`, naming clear_scene.
 */
export class SceneWipeBlockedError extends SceneInvalidError {
  constructor(message = 'Scene wipe blocked') {
    super(message)
    this.name = 'SceneWipeBlockedError'
  }
}

export class SceneTooLargeError extends Error {
  readonly code = 'too_large' as const
  constructor(message = 'Scene too large') {
    super(message)
    this.name = 'SceneTooLargeError'
  }
}
