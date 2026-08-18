import { mkdirSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { readEnv } from '../lib/env'
import {
  assertValidName,
  countGraphNodes,
  DEFAULT_LIST_LIMIT,
  editorUrlForScene,
  hashGraphJson,
  parseGraph,
  presenceCutoffIso,
  resolveMaxSceneBytes,
  SCENE_EVENT_HISTORY,
  SCENE_REVISION_HISTORY,
  serializeGraph,
} from './scene-store-shared'
import { generateSlug, isValidSlug, sanitizeSlug } from './slug'
import { openSqliteDatabase, type SqliteDatabase } from './sqlite-driver'
import {
  type PresenceClaim,
  type ProjectCreateOptions,
  type ProjectStatus,
  type SceneEvent,
  type SceneEventAppendOptions,
  type SceneEventListOptions,
  SceneInvalidError,
  type SceneListOptions,
  type SceneMeta,
  type SceneMutateOptions,
  SceneNotFoundError,
  type ScenePresence,
  type SceneRevisionMeta,
  type SceneSaveOptions,
  type SceneShare,
  type SceneShareRole,
  type SceneStore,
  SceneTooLargeError,
  SceneVersionConflictError,
  type SceneWithGraph,
} from './types'

export interface SqliteSceneStoreOptions {
  /** Exact SQLite database file path. If omitted, resolved from env. */
  databasePath?: string
  /** Optional env override for default path and size-limit resolution. */
  env?: NodeJS.ProcessEnv
  /** Maximum UTF-8 byte length of graph JSON. Defaults to 10 MB. */
  maxSceneBytes?: number
}

interface SceneRow {
  id: string
  name: string
  project_id: string | null
  owner_id: string | null
  thumbnail_url: string | null
  version: number
  created_at: string
  updated_at: string
  size_bytes: number
  node_count: number
  graph_json: string
}

interface SceneEventRow {
  event_id: number
  scene_id: string
  version: number
  kind: string
  created_at: string
  graph_json: string
}

interface ProjectPlaceholder {
  id: string
  name: string
  ownerId: string | null
  thumbnailUrl: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Resolves the local SQLite database path. Only the two configuration
 * variables are renamed; the default locations keep their historical names so
 * an existing local database is still found.
 *
 * Precedence:
 * 1. `DIGITALTWIN_DB_PATH`
 * 2. `DIGITALTWIN_DATA_DIR/pascal.db`
 * 3. On Windows: `%APPDATA%/Pascal/data/pascal.db`
 * 4. `$XDG_DATA_HOME/pascal/data/pascal.db`
 * 5. `$HOME/.pascal/data/pascal.db`
 */
export function resolveDefaultDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  const dbPath = readEnv(env, 'DB_PATH')
  if (dbPath) return dbPath
  const dataDir = readEnv(env, 'DATA_DIR')
  if (dataDir) return path.join(dataDir, 'pascal.db')
  if (process.platform === 'win32') {
    const appData = env.APPDATA
    if (appData && appData.length > 0) {
      return path.join(appData, 'Pascal', 'data', 'pascal.db')
    }
    return path.join(os.homedir(), '.pascal', 'data', 'pascal.db')
  }
  const xdg = env.XDG_DATA_HOME
  if (xdg && xdg.length > 0) {
    return path.join(xdg, 'pascal', 'data', 'pascal.db')
  }
  return path.join(os.homedir(), '.pascal', 'data', 'pascal.db')
}

function rowToMeta(row: SceneRow): SceneMeta {
  const editorUrl = editorUrlForScene(row.id)
  return {
    id: row.id,
    name: row.name,
    projectId: row.project_id,
    ownerId: row.owner_id,
    thumbnailUrl: row.thumbnail_url,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sizeBytes: row.size_bytes,
    nodeCount: row.node_count,
    editorUrl,
    url: editorUrl,
    published: true,
    graphHash: hashGraphJson(row.graph_json),
  }
}

function rowToProjectStatus(row: SceneRow): ProjectStatus {
  const editorUrl = editorUrlForScene(row.id)
  return {
    id: row.id,
    projectId: row.project_id ?? row.id,
    name: row.name,
    editorUrl,
    url: editorUrl,
    ownerId: row.owner_id,
    thumbnailUrl: row.thumbnail_url,
    publishedVersion: row.version,
    latestVersion: row.version,
    draftVersion: null,
    browserVisibleVersion: row.version,
    version: row.version,
    isEmpty: row.node_count === 0,
    sizeBytes: row.size_bytes,
    nodeCount: row.node_count,
    graphHash: hashGraphJson(row.graph_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function placeholderToProjectStatus(project: ProjectPlaceholder): ProjectStatus {
  const editorUrl = editorUrlForScene(project.id)
  return {
    id: project.id,
    projectId: project.id,
    name: project.name,
    editorUrl,
    url: editorUrl,
    ownerId: project.ownerId,
    thumbnailUrl: project.thumbnailUrl,
    publishedVersion: null,
    latestVersion: null,
    draftVersion: null,
    browserVisibleVersion: null,
    version: 0,
    isEmpty: true,
    sizeBytes: 0,
    nodeCount: 0,
    graphHash: null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  }
}

function asSceneRow(value: unknown): SceneRow | null {
  if (!value || typeof value !== 'object') return null
  return value as SceneRow
}

function rowToSceneEvent(row: SceneEventRow): SceneEvent {
  return {
    eventId: Number(row.event_id),
    sceneId: row.scene_id,
    version: Number(row.version),
    kind: row.kind,
    createdAt: row.created_at,
    graph: parseGraph(row.graph_json, `${row.scene_id}@${row.version}`),
  }
}

/**
 * Drop every revision of this scene older than the newest
 * {@link SCENE_REVISION_HISTORY}.
 *
 * Mirrors `MysqlSceneStore.trimRevisions` deliberately: the two stores are
 * asserted to behave identically by `store.test.ts`, and a retention policy
 * that held on only one of them would be a policy nobody could rely on.
 * Called inside the caller's write transaction, so the insert and the eviction
 * commit together.
 */
function trimRevisions(db: SqliteDatabase, sceneId: string): void {
  const oldestKept = db
    .query(
      `SELECT version FROM scene_revisions
         WHERE scene_id = ?
         ORDER BY version DESC
         LIMIT 1 OFFSET ?`,
    )
    .get(sceneId, SCENE_REVISION_HISTORY - 1) as { version: number } | null | undefined

  // Fewer revisions than the window: nothing has been pushed out yet.
  if (!oldestKept) return

  db.query('DELETE FROM scene_revisions WHERE scene_id = ? AND version < ?').run(
    sceneId,
    oldestKept.version,
  )
}

/**
 * Drop every live-sync event of this scene older than the newest
 * {@link SCENE_EVENT_HISTORY}.
 *
 * Ordered by `event_id`, not `version`: several events can share a version, and
 * `event_id` is the column the SSE cursor advances through — the only ordering
 * that matches what a client considers "newer".
 */
function trimSceneEvents(db: SqliteDatabase, sceneId: string): void {
  const oldestKept = db
    .query(
      `SELECT event_id FROM scene_events
         WHERE scene_id = ?
         ORDER BY event_id DESC
         LIMIT 1 OFFSET ?`,
    )
    .get(sceneId, SCENE_EVENT_HISTORY - 1) as { event_id: number } | null | undefined

  if (!oldestKept) return

  db.query('DELETE FROM scene_events WHERE scene_id = ? AND event_id < ?').run(
    sceneId,
    oldestKept.event_id,
  )
}

/**
 * SQLite-backed implementation of `SceneStore`.
 *
 * Uses one local database file, WAL mode, and transaction-scoped version checks
 * so a local editor and MCP process can safely share scenes on one machine.
 */
export class SqliteSceneStore implements SceneStore {
  readonly backend = 'sqlite' as const

  readonly databasePath: string

  private readonly maxSceneBytes: number
  private db: SqliteDatabase | null = null
  private dbPromise: Promise<SqliteDatabase> | null = null

  constructor(opts: SqliteSceneStoreOptions = {}) {
    const env = opts.env ?? process.env
    this.databasePath = path.resolve(opts.databasePath ?? resolveDefaultDatabasePath(env))
    this.maxSceneBytes = resolveMaxSceneBytes(env, opts.maxSceneBytes)
  }

  async createProject(opts: ProjectCreateOptions): Promise<ProjectStatus> {
    const db = await this.database()
    assertValidName(opts.name)
    const id = opts.id ? sanitizeSlug(opts.id) : this.generateUniqueId(db)
    if (!isValidSlug(id)) {
      throw new SceneInvalidError(`Invalid project id after sanitization: "${id}"`)
    }
    if (this.getRow(db, id)) {
      throw new SceneInvalidError(`Project with id "${id}" already exists`)
    }
    const now = new Date().toISOString()
    const project: ProjectPlaceholder = {
      id,
      name: opts.name,
      ownerId: opts.ownerId ?? null,
      thumbnailUrl: null,
      createdAt: now,
      updatedAt: now,
    }
    db.query(
      `INSERT INTO project_placeholders (id, name, owner_id, thumbnail_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, project.name, project.ownerId, project.thumbnailUrl, now, now)
    return placeholderToProjectStatus(project)
  }

  async getProjectStatus(id: string): Promise<ProjectStatus | null> {
    const db = await this.database()
    const safeId = sanitizeSlug(id)
    const row = this.getRow(db, safeId)
    if (row) return rowToProjectStatus(row)
    const placeholder = this.getPlaceholder(db, safeId)
    return placeholder ? placeholderToProjectStatus(placeholder) : null
  }

  async save(opts: SceneSaveOptions): Promise<SceneMeta> {
    return this.withWriteTransaction((db) => {
      assertValidName(opts.name)
      if (!opts.graph || typeof opts.graph !== 'object') {
        throw new SceneInvalidError('graph is required')
      }

      const providedId = opts.id
      const id = providedId ? sanitizeSlug(providedId) : this.generateUniqueId(db)
      if (!isValidSlug(id)) {
        throw new SceneInvalidError(`Invalid scene id after sanitization: "${id}"`)
      }

      const existing = this.getRow(db, id)
      const placeholder = this.getPlaceholder(db, id)

      if (existing && providedId !== undefined && opts.expectedVersion === undefined) {
        throw new SceneInvalidError(
          `Scene with id "${id}" already exists. Pass a different id or provide expectedVersion to overwrite.`,
        )
      }

      if (opts.expectedVersion !== undefined) {
        const currentVersion = existing?.version ?? 0
        if (currentVersion !== opts.expectedVersion) {
          throw new SceneVersionConflictError(
            `Scene "${id}" version mismatch: expected ${opts.expectedVersion}, got ${currentVersion}`,
          )
        }
      }

      const graphJson = serializeGraph(opts.graph)
      const sizeBytes = Buffer.byteLength(graphJson, 'utf8')
      if (sizeBytes > this.maxSceneBytes) {
        throw new SceneTooLargeError(
          `Scene "${id}" is ${sizeBytes} bytes, exceeds cap of ${this.maxSceneBytes} bytes`,
        )
      }

      const now = new Date().toISOString()
      const version = (existing?.version ?? 0) + 1
      const createdAt = existing?.created_at ?? placeholder?.createdAt ?? now
      const nodeCount = Object.keys(opts.graph.nodes ?? {}).length
      const projectId = opts.projectId ?? existing?.project_id ?? (placeholder ? id : null)
      const ownerId = opts.ownerId ?? existing?.owner_id ?? placeholder?.ownerId ?? null
      const thumbnailUrl =
        opts.thumbnailUrl ?? existing?.thumbnail_url ?? placeholder?.thumbnailUrl ?? null

      if (existing) {
        db.query(
          `UPDATE scenes
             SET name = ?,
                 project_id = ?,
                 owner_id = ?,
                 thumbnail_url = ?,
                 version = ?,
                 updated_at = ?,
                 size_bytes = ?,
                 node_count = ?,
                 graph_json = ?
           WHERE id = ?`,
        ).run(
          opts.name,
          projectId,
          ownerId,
          thumbnailUrl,
          version,
          now,
          sizeBytes,
          nodeCount,
          graphJson,
          id,
        )
      } else {
        db.query(
          `INSERT INTO scenes (
             id, name, project_id, owner_id, thumbnail_url, version,
             created_at, updated_at, size_bytes, node_count, graph_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          opts.name,
          projectId,
          ownerId,
          thumbnailUrl,
          version,
          createdAt,
          now,
          sizeBytes,
          nodeCount,
          graphJson,
        )
      }

      db.query(
        `INSERT INTO scene_revisions (
           scene_id, version, graph_json, author_kind, author_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, version, graphJson, 'mcp', ownerId, now)
      trimRevisions(db, id)

      db.query('DELETE FROM project_placeholders WHERE id = ?').run(id)

      return {
        id,
        name: opts.name,
        projectId,
        ownerId,
        thumbnailUrl,
        version,
        createdAt,
        updatedAt: now,
        sizeBytes,
        nodeCount,
        editorUrl: editorUrlForScene(id),
        url: editorUrlForScene(id),
        published: true,
        graphHash: hashGraphJson(graphJson),
      }
    })
  }

  async load(id: string): Promise<SceneWithGraph | null> {
    const db = await this.database()
    const row = this.getRow(db, sanitizeSlug(id))
    if (!row) return null
    return {
      ...rowToMeta(row),
      graph: parseGraph(row.graph_json, row.id),
    }
  }

  async list(opts: SceneListOptions = {}): Promise<SceneMeta[]> {
    const clauses: string[] = []
    const bindings: Array<string | number> = []

    if (opts.projectId !== undefined) {
      clauses.push('project_id = ?')
      bindings.push(opts.projectId)
    }
    if (opts.ownerId !== undefined) {
      clauses.push('owner_id = ?')
      bindings.push(opts.ownerId)
    } else if (opts.viewerId !== undefined) {
      // Owned by the viewer OR shared with them. `ownerId` wins when both are
      // set (an explicit owner query), so this branch is `else if`.
      clauses.push('(owner_id = ? OR id IN (SELECT scene_id FROM scene_shares WHERE user_id = ?))')
      bindings.push(opts.viewerId, opts.viewerId)
    }

    const requestedLimit = opts.limit ?? DEFAULT_LIST_LIMIT
    const limit = Number.isInteger(requestedLimit) && requestedLimit >= 0 ? requestedLimit : 0
    bindings.push(limit)

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const db = await this.database()
    const rows = db
      .query(
        `SELECT id, name, project_id, owner_id, thumbnail_url, version,
                created_at, updated_at, size_bytes, node_count, graph_json
           FROM scenes
           ${where}
          ORDER BY updated_at DESC, id ASC
          LIMIT ?`,
      )
      .all(...bindings)

    return rows.map((row) => rowToMeta(row as SceneRow))
  }

  async delete(id: string, opts: SceneMutateOptions = {}): Promise<boolean> {
    return this.withWriteTransaction((db) => {
      const safeId = sanitizeSlug(id)
      const existing = this.getRow(db, safeId)
      if (!existing) return false
      if (opts.expectedVersion !== undefined && existing.version !== opts.expectedVersion) {
        throw new SceneVersionConflictError(
          `Scene "${safeId}" version mismatch: expected ${opts.expectedVersion}, got ${existing.version}`,
        )
      }
      db.query('DELETE FROM scenes WHERE id = ?').run(safeId)
      return true
    })
  }

  async rename(id: string, newName: string, opts: SceneMutateOptions = {}): Promise<SceneMeta> {
    return this.withWriteTransaction((db) => {
      assertValidName(newName)
      const safeId = sanitizeSlug(id)
      const existing = this.getRow(db, safeId)
      if (!existing) {
        throw new SceneNotFoundError(`Scene "${safeId}" not found`)
      }
      if (opts.expectedVersion !== undefined && existing.version !== opts.expectedVersion) {
        throw new SceneVersionConflictError(
          `Scene "${safeId}" version mismatch: expected ${opts.expectedVersion}, got ${existing.version}`,
        )
      }

      const now = new Date().toISOString()
      const nextVersion = existing.version + 1
      db.query('UPDATE scenes SET name = ?, version = ?, updated_at = ? WHERE id = ?').run(
        newName,
        nextVersion,
        now,
        safeId,
      )

      db.query(
        `INSERT INTO scene_revisions (
             scene_id, version, graph_json, author_kind, author_id, created_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(safeId, nextVersion, existing.graph_json, 'mcp', existing.owner_id, now)
      trimRevisions(db, safeId)

      return {
        ...rowToMeta(existing),
        name: newName,
        version: nextVersion,
        updatedAt: now,
      }
    })
  }

  async appendSceneEvent(opts: SceneEventAppendOptions): Promise<SceneEvent> {
    return this.withWriteTransaction((db) => {
      const safeId = sanitizeSlug(opts.sceneId)
      const existing = this.getRow(db, safeId)
      if (!existing) {
        throw new SceneNotFoundError(`Scene "${safeId}" not found`)
      }

      const graphJson = serializeGraph(opts.graph)
      const now = new Date().toISOString()
      const result = db
        .query(
          `INSERT INTO scene_events (
             scene_id, version, kind, created_at, graph_json
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(safeId, opts.version, opts.kind, now, graphJson)
      trimSceneEvents(db, safeId)

      return {
        eventId: Number(result.lastInsertRowid),
        sceneId: safeId,
        version: opts.version,
        kind: opts.kind,
        createdAt: now,
        graph: opts.graph,
      }
    })
  }

  async listSceneEvents(sceneId: string, opts: SceneEventListOptions = {}): Promise<SceneEvent[]> {
    const afterEventId = Math.max(0, opts.afterEventId ?? 0)
    const requestedLimit = opts.limit ?? 100
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? requestedLimit : 100
    const db = await this.database()
    const rows = db
      .query(
        `SELECT event_id, scene_id, version, kind, created_at, graph_json
           FROM scene_events
          WHERE scene_id = ?
            AND event_id > ?
          ORDER BY event_id ASC
          LIMIT ?`,
      )
      .all(sanitizeSlug(sceneId), afterEventId, limit)

    return rows.map((row) => rowToSceneEvent(row as SceneEventRow))
  }

  async listSceneShares(sceneId: string): Promise<SceneShare[]> {
    const db = await this.database()
    const rows = db
      .query('SELECT user_id, role FROM scene_shares WHERE scene_id = ? ORDER BY granted_at ASC')
      .all(sanitizeSlug(sceneId)) as Array<{ user_id: string; role: string }>
    return rows.map((r) => ({ userId: r.user_id, role: r.role as SceneShareRole }))
  }

  async setSceneShares(
    sceneId: string,
    shares: SceneShare[],
    grantedBy: string | null = null,
  ): Promise<void> {
    const safeId = sanitizeSlug(sceneId)
    const now = new Date().toISOString()
    await this.withWriteTransaction((db) => {
      db.query('DELETE FROM scene_shares WHERE scene_id = ?').run(safeId)
      const insert = db.query(
        `INSERT INTO scene_shares (scene_id, user_id, role, granted_by, granted_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      for (const share of shares) {
        insert.run(safeId, share.userId, share.role, grantedBy, now)
      }
    })
  }

  async getSceneShareRole(sceneId: string, userId: string): Promise<SceneShareRole | null> {
    const db = await this.database()
    const row = db
      .query('SELECT role FROM scene_shares WHERE scene_id = ? AND user_id = ?')
      .get(sanitizeSlug(sceneId), userId) as { role: string } | null | undefined
    return row ? (row.role as SceneShareRole) : null
  }

  async listSceneRevisions(sceneId: string): Promise<SceneRevisionMeta[]> {
    const db = await this.database()
    const rows = db
      .query(
        `SELECT version, author_kind, created_at, graph_json
           FROM scene_revisions
          WHERE scene_id = ?
          ORDER BY version DESC`,
      )
      .all(sanitizeSlug(sceneId)) as Array<{
      version: number
      author_kind: string
      created_at: string
      graph_json: string
    }>
    return rows.map((r) => ({
      version: Number(r.version),
      createdAt: r.created_at,
      authorKind: r.author_kind,
      nodeCount: countGraphNodes(r.graph_json),
      sizeBytes: Buffer.byteLength(r.graph_json, 'utf8'),
    }))
  }

  async loadSceneRevision(sceneId: string, version: number): Promise<SceneGraph | null> {
    const db = await this.database()
    const row = db
      .query('SELECT graph_json FROM scene_revisions WHERE scene_id = ? AND version = ?')
      .get(sanitizeSlug(sceneId), version) as { graph_json: string } | null | undefined
    if (!row) return null
    return parseGraph(row.graph_json, `${sceneId}@${version}`)
  }

  async updateThumbnail(sceneId: string, thumbnailUrl: string | null): Promise<void> {
    const db = await this.database()
    db.query('UPDATE scenes SET thumbnail_url = ? WHERE id = ?').run(
      thumbnailUrl,
      sanitizeSlug(sceneId),
    )
  }

  async touchPresence(
    sceneId: string,
    userId: string,
    email: string | null,
    opts: { claimEditor: boolean },
  ): Promise<PresenceClaim> {
    const safeId = sanitizeSlug(sceneId)
    const now = new Date().toISOString()
    const cutoff = presenceCutoffIso(Date.now())
    return this.withWriteTransaction((db) => {
      // Prune stale rows first — this is what frees the lease when a tab closed
      // without a clean release. After this, any is_editor row is a live holder.
      db.query('DELETE FROM scene_presence WHERE scene_id = ? AND last_seen < ?').run(
        safeId,
        cutoff,
      )
      const editorRow = db
        .query(
          'SELECT user_id, email FROM scene_presence WHERE scene_id = ? AND is_editor = 1 LIMIT 1',
        )
        .get(safeId) as { user_id: string; email: string | null } | null | undefined

      let isEditor: boolean
      let editorUserId: string | null
      let editorEmail: string | null
      if (editorRow) {
        isEditor = editorRow.user_id === userId
        editorUserId = editorRow.user_id
        editorEmail = editorRow.user_id === userId ? email : editorRow.email
      } else if (opts.claimEditor) {
        isEditor = true
        editorUserId = userId
        editorEmail = email
      } else {
        isEditor = false
        editorUserId = null
        editorEmail = null
      }

      db.query(
        `INSERT INTO scene_presence (scene_id, user_id, email, last_seen, is_editor)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(scene_id, user_id)
           DO UPDATE SET email = excluded.email, last_seen = excluded.last_seen, is_editor = excluded.is_editor`,
      ).run(safeId, userId, email, now, isEditor ? 1 : 0)

      return { isEditor, editorUserId, editorEmail }
    })
  }

  async listScenePresence(sceneId: string): Promise<ScenePresence[]> {
    const db = await this.database()
    const cutoff = presenceCutoffIso(Date.now())
    const rows = db
      .query(
        `SELECT user_id, email, is_editor, last_seen
           FROM scene_presence
          WHERE scene_id = ? AND last_seen >= ?
          ORDER BY is_editor DESC, last_seen ASC`,
      )
      .all(sanitizeSlug(sceneId), cutoff) as Array<{
      user_id: string
      email: string | null
      is_editor: number
      last_seen: string
    }>
    return rows.map((r) => ({
      userId: r.user_id,
      email: r.email,
      isEditor: r.is_editor === 1,
      lastSeen: r.last_seen,
    }))
  }

  async releaseScenePresence(sceneId: string, userId: string): Promise<void> {
    const db = await this.database()
    db.query('DELETE FROM scene_presence WHERE scene_id = ? AND user_id = ?').run(
      sanitizeSlug(sceneId),
      userId,
    )
  }

  close(): void {
    this.db?.close()
    this.db = null
    this.dbPromise = null
  }

  private async database(): Promise<SqliteDatabase> {
    if (this.db) return this.db
    if (!this.dbPromise) {
      this.dbPromise = (async () => {
        mkdirSync(path.dirname(this.databasePath), { recursive: true })
        const db = await openSqliteDatabase(this.databasePath)
        db.exec('PRAGMA foreign_keys = ON')
        db.exec('PRAGMA journal_mode = WAL')
        db.exec('PRAGMA busy_timeout = 5000')
        this.migrate(db)
        this.db = db
        return db
      })()
    }
    return this.dbPromise
  }

  private migrate(db: SqliteDatabase): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS scenes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(name) >= 1 AND length(name) <= 200),
        project_id TEXT,
        owner_id TEXT,
        thumbnail_url TEXT,
        version INTEGER NOT NULL CHECK (version >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
        node_count INTEGER NOT NULL CHECK (node_count >= 0),
        graph_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS scenes_project_updated_idx
        ON scenes(project_id, updated_at DESC);

      CREATE INDEX IF NOT EXISTS scenes_owner_updated_idx
        ON scenes(owner_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS scene_revisions (
        scene_id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version >= 1),
        graph_json TEXT NOT NULL,
        author_kind TEXT NOT NULL,
        author_id TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (scene_id, version),
        FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS project_placeholders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_id TEXT,
        thumbnail_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scene_events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        scene_id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version >= 1),
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL,
        graph_json TEXT NOT NULL,
        FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS scene_events_scene_event_idx
        ON scene_events(scene_id, event_id);

      CREATE TABLE IF NOT EXISTS scene_shares (
        scene_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'editor')),
        granted_by TEXT,
        granted_at TEXT NOT NULL,
        PRIMARY KEY (scene_id, user_id),
        FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS scene_shares_user_idx
        ON scene_shares(user_id);

      CREATE TABLE IF NOT EXISTS scene_presence (
        scene_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        email TEXT,
        last_seen TEXT NOT NULL,
        is_editor INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (scene_id, user_id),
        FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS scene_presence_scene_seen_idx
        ON scene_presence(scene_id, last_seen);
    `)
  }

  private async withWriteTransaction<T>(fn: (db: SqliteDatabase) => T | Promise<T>): Promise<T> {
    const db = await this.database()
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = await fn(db)
      db.exec('COMMIT')
      return result
    } catch (err) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // Ignore rollback errors so the original failure is preserved.
      }
      throw err
    }
  }

  private getPlaceholder(db: SqliteDatabase, id: string): ProjectPlaceholder | null {
    const row = db
      .query(
        `SELECT id, name, owner_id, thumbnail_url, created_at, updated_at
           FROM project_placeholders
          WHERE id = ?`,
      )
      .get(id) as {
      id: string
      name: string
      owner_id: string | null
      thumbnail_url: string | null
      created_at: string
      updated_at: string
    } | null
    if (!row) return null
    return {
      id: row.id,
      name: row.name,
      ownerId: row.owner_id,
      thumbnailUrl: row.thumbnail_url,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private getRow(db: SqliteDatabase, id: string): SceneRow | null {
    return asSceneRow(
      db
        .query(
          `SELECT id, name, project_id, owner_id, thumbnail_url, version,
                  created_at, updated_at, size_bytes, node_count, graph_json
             FROM scenes
            WHERE id = ?`,
        )
        .get(id),
    )
  }

  private generateUniqueId(db: SqliteDatabase): string {
    for (let attempt = 0; attempt < 20; attempt++) {
      const id = generateSlug()
      if (!this.getRow(db, id)) return id
    }
    throw new SceneInvalidError('Failed to generate a unique scene id')
  }
}
