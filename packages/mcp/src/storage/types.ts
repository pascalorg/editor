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
  /** True when this save is browser-visible without a separate publish call. */
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
  /** `draft` updates the browser-visible working model; `checkpoint` records version history. */
  saveMode?: SceneSaveMode
  /** Whether a checkpoint should become the published/browser-visible head. */
  publish?: boolean
  /** Optional hosted MCP session id for project presence/debug metadata. */
  agentSessionId?: string
  /** Optional high-level operation name for presence/debug metadata. */
  operation?: string
}

export type SceneSaveMode = 'draft' | 'checkpoint'

/** The access a shared user has on a scene. `editor` implies `viewer`. */
export type SceneShareRole = 'viewer' | 'editor'

export interface SceneShare {
  userId: string
  role: SceneShareRole
}

/** One person currently present in a scene (fresh within the presence TTL). */
export interface ScenePresence {
  userId: string
  email: string | null
  /** True for the single account currently holding the edit lease. */
  isEditor: boolean
  /** ISO 8601 timestamp of the last heartbeat. */
  lastSeen: string
}

/** Result of a presence heartbeat: whether the caller holds the edit lease. */
export interface PresenceClaim {
  isEditor: boolean
  /** Who currently holds the edit lease (may be the caller, or null if none). */
  editorUserId: string | null
  editorEmail: string | null
}

/** One retained past version of a scene — a "backup" the user can restore. */
export interface SceneRevisionMeta {
  version: number
  /** ISO 8601 timestamp of when this version was recorded. */
  createdAt: string
  /** 'mcp' | 'user' | 'agent' — who wrote it. */
  authorKind: string
  nodeCount: number
  sizeBytes: number
}

export interface SceneListOptions {
  projectId?: string
  ownerId?: string
  /**
   * Scenes this user may see: owned by them OR shared with them. Distinct from
   * `ownerId` (owned only), which the admin console still uses. When both are
   * set, `ownerId` wins — the caller asked for a specific owner's scenes.
   */
  viewerId?: string
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
  readonly backend: 'sqlite' | 'mysql' | 'supabase'
  createProject?(opts: ProjectCreateOptions): Promise<ProjectStatus>
  getProjectStatus?(id: SceneId): Promise<ProjectStatus | null>
  save(opts: SceneSaveOptions): Promise<SceneMeta>
  load(id: SceneId): Promise<SceneWithGraph | null>
  list(opts?: SceneListOptions): Promise<SceneMeta[]>
  delete(id: SceneId, opts?: SceneMutateOptions): Promise<boolean>
  rename(id: SceneId, newName: string, opts?: SceneMutateOptions): Promise<SceneMeta>
  appendSceneEvent?(opts: SceneEventAppendOptions): Promise<SceneEvent>
  listSceneEvents?(sceneId: SceneId, opts?: SceneEventListOptions): Promise<SceneEvent[]>
  /** Every user a scene is shared with, and at what access. */
  listSceneShares?(sceneId: SceneId): Promise<SceneShare[]>
  /** Replaces the whole share set for a scene. `grantedBy` is the acting user. */
  setSceneShares?(sceneId: SceneId, shares: SceneShare[], grantedBy?: string | null): Promise<void>
  /** The share access one user holds on a scene, or null if none. */
  getSceneShareRole?(sceneId: SceneId, userId: string): Promise<SceneShareRole | null>
  /** Retained past versions of a scene, newest first (a "backups" list). */
  listSceneRevisions?(sceneId: SceneId): Promise<SceneRevisionMeta[]>
  /** The graph of one retained version, for restoring it. */
  loadSceneRevision?(sceneId: SceneId, version: number): Promise<SceneGraph | null>
  /** Sets only a scene's thumbnail; no version bump, no revision, no event. */
  updateThumbnail?(sceneId: SceneId, thumbnailUrl: string | null): Promise<void>
  /**
   * Records a heartbeat for `userId` in `sceneId` and returns who holds the
   * single edit lease. Atomic: if `claimEditor` is true and no other fresh
   * account holds the lease, the caller takes it; otherwise the caller is a
   * viewer. A caller already holding the lease keeps it.
   */
  touchPresence?(
    sceneId: SceneId,
    userId: string,
    email: string | null,
    opts: { claimEditor: boolean },
  ): Promise<PresenceClaim>
  /** Everyone currently present (fresh within the TTL), the editor first. */
  listScenePresence?(sceneId: SceneId): Promise<ScenePresence[]>
  /** Removes a user's presence row (best-effort on leave). */
  releaseScenePresence?(sceneId: SceneId, userId: string): Promise<void>
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
