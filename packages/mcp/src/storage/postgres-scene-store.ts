import {
  agentRequests as agentRequestsTable,
  createDatabaseClient,
  type Database,
  sceneEvents as sceneEventsTable,
  scenes as scenesTable,
  sceneVersions as sceneVersionsTable,
} from '@pascal-app/db'
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm'
import { resolveHistoryPolicy, retentionCutoff } from './history-policy'
import {
  assertValidName,
  DEFAULT_LIST_LIMIT,
  editorUrlForScene,
  hashGraphJson,
  resolveMaxSceneBytes,
  serializeGraph,
  validateGraph,
} from './scene-graph-codec'
import { generateSlug, isValidSlug, sanitizeSlug } from './slug'
import {
  type AgentRequest,
  type AgentRequestCreateOptions,
  type AgentRequestListOptions,
  type ProjectCreateOptions,
  type ProjectStatus,
  type SceneEvent,
  type SceneEventAppendOptions,
  type SceneEventListOptions,
  type SceneHistoryPrunePolicy,
  type SceneHistoryPruneResult,
  SceneInvalidError,
  type SceneListOptions,
  type SceneMeta,
  type SceneMutateOptions,
  SceneNotFoundError,
  type SceneSaveOptions,
  type SceneStore,
  SceneTooLargeError,
  SceneVersionConflictError,
  type SceneWithGraph,
} from './types'

export interface PostgresSceneStoreOptions {
  env?: NodeJS.ProcessEnv
  connectionString?: string
  maxSceneBytes?: number
  /** Injected in tests so the suite can share one pool. */
  database?: Database
}

type SceneRow = typeof scenesTable.$inferSelect

const ISO = (value: Date | string): string =>
  typeof value === 'string' ? value : value.toISOString()

function rowToMeta(row: SceneRow): SceneMeta {
  const editorUrl = editorUrlForScene(row.id)
  return {
    id: row.id,
    name: row.name,
    projectId: row.projectId,
    ownerId: row.ownerId,
    thumbnailUrl: row.thumbnailUrl,
    version: row.headVersion,
    createdAt: ISO(row.createdAt),
    updatedAt: ISO(row.updatedAt),
    sizeBytes: row.sizeBytes,
    nodeCount: row.nodeCount,
    editorUrl,
    url: editorUrl,
    published: true,
    graphHash: row.graphHash ?? undefined,
  }
}

export class PostgresSceneStore implements SceneStore {
  readonly backend = 'postgres' as const

  private readonly db: Database
  private readonly close: (() => Promise<void>) | null
  private readonly maxSceneBytes: number

  constructor(options: PostgresSceneStoreOptions = {}) {
    if (options.database) {
      this.db = options.database
      this.close = null
    } else {
      const { client, db } = createDatabaseClient({
        connectionString: options.connectionString ?? options.env?.POSTGRES_URL,
      })
      this.db = db
      this.close = () => client.end()
    }
    this.maxSceneBytes = resolveMaxSceneBytes(options.env, options.maxSceneBytes)
  }

  async dispose(): Promise<void> {
    await this.close?.()
  }

  private async row(id: string): Promise<SceneRow | null> {
    const rows = await this.db.select().from(scenesTable).where(eq(scenesTable.id, id)).limit(1)
    return rows[0] ?? null
  }

  private async generateUniqueId(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = generateSlug()
      if (!(await this.row(candidate))) return candidate
    }
    throw new SceneInvalidError('Could not generate a unique scene id')
  }

  async save(opts: SceneSaveOptions): Promise<SceneMeta> {
    assertValidName(opts.name)
    if (!opts.graph || typeof opts.graph !== 'object') {
      throw new SceneInvalidError('graph is required')
    }

    const providedId = opts.id
    const id = providedId ? sanitizeSlug(providedId) : await this.generateUniqueId()
    if (!isValidSlug(id)) {
      throw new SceneInvalidError(`Invalid scene id after sanitization: "${id}"`)
    }

    const graphJson = serializeGraph(opts.graph)
    const sizeBytes = Buffer.byteLength(graphJson, 'utf8')
    if (sizeBytes > this.maxSceneBytes) {
      throw new SceneTooLargeError(
        `Scene "${id}" is ${sizeBytes} bytes, exceeds cap of ${this.maxSceneBytes} bytes`,
      )
    }

    const existing = await this.row(id)

    if (existing && providedId !== undefined && opts.expectedVersion === undefined) {
      throw new SceneInvalidError(
        `Scene with id "${id}" already exists. Pass a different id or provide expectedVersion to overwrite.`,
      )
    }
    if (
      opts.expectedVersion !== undefined &&
      (existing?.headVersion ?? 0) !== opts.expectedVersion
    ) {
      throw new SceneVersionConflictError(
        `Scene "${id}" version mismatch: expected ${opts.expectedVersion}, got ${existing?.headVersion ?? 0}`,
      )
    }

    const graphHash = hashGraphJson(graphJson)
    const nodeCount = Object.keys(opts.graph.nodes ?? {}).length
    const version = (existing?.headVersion ?? 0) + 1
    const projectId = opts.projectId ?? existing?.projectId ?? null
    const ownerId = opts.ownerId ?? existing?.ownerId ?? null
    const thumbnailUrl = opts.thumbnailUrl ?? existing?.thumbnailUrl ?? null

    const meta = await this.db.transaction(async (tx) => {
      let row: SceneRow | undefined

      if (existing) {
        // The version check lives in the WHERE clause: another replica that
        // committed between our read and this write moved `head_version`, so
        // this matches nothing and we report the conflict rather than
        // overwriting their save.
        const updated = await tx
          .update(scenesTable)
          .set({
            name: opts.name,
            projectId,
            ownerId,
            thumbnailUrl,
            headVersion: version,
            sizeBytes,
            nodeCount,
            graphHash,
            updatedAt: new Date(),
          })
          .where(and(eq(scenesTable.id, id), eq(scenesTable.headVersion, existing.headVersion)))
          .returning()
        row = updated[0]
        if (!row) {
          throw new SceneVersionConflictError(
            `Scene "${id}" changed while saving; expected version ${existing.headVersion}`,
          )
        }
      } else {
        const inserted = await tx
          .insert(scenesTable)
          .values({
            id,
            name: opts.name,
            projectId,
            ownerId,
            thumbnailUrl,
            headVersion: version,
            sizeBytes,
            nodeCount,
            graphHash,
          })
          // Two callers creating the same explicit id at once: the loser sees
          // nothing back and is a conflict, not a silent overwrite.
          .onConflictDoNothing()
          .returning()
        row = inserted[0]
        if (!row) {
          throw new SceneVersionConflictError(`Scene "${id}" was created concurrently`)
        }
      }

      const isDraft = (opts.saveMode ?? 'checkpoint') === 'draft'
      const body = {
        graph: opts.graph as unknown as Record<string, unknown>,
        graphHash,
        sizeBytes,
        nodeCount,
        authorKind: 'agent' as const,
        authorId: null,
      }

      // A draft rewrites the head row when that row is itself a draft, so a
      // session of autosaves leaves one row behind instead of one per second.
      // It may never rewrite a checkpoint: that row is the thing a user goes
      // back to, and the version it is filed under has to keep pointing at the
      // graph that was current when it was taken.
      const rewritten = isDraft
        ? await tx
            .update(sceneVersionsTable)
            .set({ version, ...body, isDraft: true })
            .where(
              and(
                eq(sceneVersionsTable.sceneId, id),
                eq(sceneVersionsTable.version, existing?.headVersion ?? -1),
                eq(sceneVersionsTable.isDraft, true),
              ),
            )
            .returning({ version: sceneVersionsTable.version })
        : []

      if (rewritten.length === 0) {
        await tx.insert(sceneVersionsTable).values({ sceneId: id, version, ...body, isDraft })
      }

      return rowToMeta(row)
    })

    return meta
  }

  async load(id: string): Promise<SceneWithGraph | null> {
    const sceneId = sanitizeSlug(id)
    const row = await this.row(sceneId)
    if (!row) return null

    const versions = await this.db
      .select({ graph: sceneVersionsTable.graph })
      .from(sceneVersionsTable)
      .where(
        and(
          eq(sceneVersionsTable.sceneId, sceneId),
          eq(sceneVersionsTable.version, row.headVersion),
        ),
      )
      .limit(1)

    const body = versions[0]?.graph
    if (body === undefined) {
      throw new SceneInvalidError(
        `Scene "${sceneId}" points at version ${row.headVersion}, which is not stored`,
      )
    }

    return { ...rowToMeta(row), graph: validateGraph(body, sceneId) }
  }

  async list(opts: SceneListOptions = {}): Promise<SceneMeta[]> {
    const conditions = []
    if (opts.projectId !== undefined) conditions.push(eq(scenesTable.projectId, opts.projectId))
    if (opts.ownerId !== undefined) conditions.push(eq(scenesTable.ownerId, opts.ownerId))

    const requested = opts.limit ?? DEFAULT_LIST_LIMIT
    const limit = Number.isInteger(requested) && requested >= 0 ? requested : 0
    if (limit === 0) return []

    const rows = await this.db
      .select()
      .from(scenesTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(scenesTable.updatedAt), asc(scenesTable.id))
      .limit(limit)

    return rows.map(rowToMeta)
  }

  async delete(id: string, opts: SceneMutateOptions = {}): Promise<boolean> {
    const sceneId = sanitizeSlug(id)
    const existing = await this.row(sceneId)
    if (!existing) return false
    if (opts.expectedVersion !== undefined && existing.headVersion !== opts.expectedVersion) {
      throw new SceneVersionConflictError(
        `Scene "${sceneId}" version mismatch: expected ${opts.expectedVersion}, got ${existing.headVersion}`,
      )
    }

    const deleted = await this.db
      .delete(scenesTable)
      .where(and(eq(scenesTable.id, sceneId), eq(scenesTable.headVersion, existing.headVersion)))
      .returning({ id: scenesTable.id })
    return deleted.length > 0
  }

  async rename(id: string, newName: string, opts: SceneMutateOptions = {}): Promise<SceneMeta> {
    assertValidName(newName)
    const sceneId = sanitizeSlug(id)
    const existing = await this.row(sceneId)
    if (!existing) throw new SceneNotFoundError(`Scene "${sceneId}" not found`)
    if (opts.expectedVersion !== undefined && existing.headVersion !== opts.expectedVersion) {
      throw new SceneVersionConflictError(
        `Scene "${sceneId}" version mismatch: expected ${opts.expectedVersion}, got ${existing.headVersion}`,
      )
    }

    const version = existing.headVersion + 1
    return this.db.transaction(async (tx) => {
      const updated = await tx
        .update(scenesTable)
        .set({ name: newName, headVersion: version, updatedAt: new Date() })
        .where(and(eq(scenesTable.id, sceneId), eq(scenesTable.headVersion, existing.headVersion)))
        .returning()
      const row = updated[0]
      if (!row) {
        throw new SceneVersionConflictError(`Scene "${sceneId}" changed while renaming`)
      }

      // A rename is a new version like any other save, so the history stays a
      // complete record of what the scene looked like at every version.
      const previous = await tx
        .select({ graph: sceneVersionsTable.graph, graphHash: sceneVersionsTable.graphHash })
        .from(sceneVersionsTable)
        .where(
          and(
            eq(sceneVersionsTable.sceneId, sceneId),
            eq(sceneVersionsTable.version, existing.headVersion),
          ),
        )
        .limit(1)

      const body = previous[0]
      if (body) {
        await tx.insert(sceneVersionsTable).values({
          sceneId,
          version,
          graph: body.graph as Record<string, unknown>,
          graphHash: body.graphHash,
          sizeBytes: row.sizeBytes,
          nodeCount: row.nodeCount,
          authorKind: 'agent',
          authorId: null,
        })
      }

      return rowToMeta(row)
    })
  }

  async appendSceneEvent(opts: SceneEventAppendOptions): Promise<SceneEvent> {
    const sceneId = sanitizeSlug(opts.sceneId)
    const inserted = await this.db
      .insert(sceneEventsTable)
      .values({ sceneId, version: opts.version, kind: opts.kind })
      .returning()
    const row = inserted[0]
    if (!row) throw new SceneNotFoundError(`Scene "${sceneId}" not found`)

    return {
      eventId: row.eventId,
      sceneId: row.sceneId,
      version: row.version,
      kind: row.kind,
      createdAt: ISO(row.createdAt),
    }
  }

  async listSceneEvents(sceneId: string, opts: SceneEventListOptions = {}): Promise<SceneEvent[]> {
    const id = sanitizeSlug(sceneId)
    const conditions = [eq(sceneEventsTable.sceneId, id)]
    if (opts.afterEventId !== undefined) {
      conditions.push(gt(sceneEventsTable.eventId, opts.afterEventId))
    }

    const rows = await this.db
      .select()
      .from(sceneEventsTable)
      .where(and(...conditions))
      .orderBy(asc(sceneEventsTable.eventId))
      .limit(opts.limit ?? DEFAULT_LIST_LIMIT)

    return rows.map((row) => ({
      eventId: row.eventId,
      sceneId: row.sceneId,
      version: row.version,
      kind: row.kind,
      createdAt: ISO(row.createdAt),
    }))
  }

  /**
   * Same retention rule as the SQLite store, expressed as two deletes. The head
   * version is excluded explicitly rather than relying on the count — `load`
   * reads the body from `scene_versions`, so pruning it would erase the scene.
   */
  async pruneSceneHistory(
    sceneId: string,
    policy?: SceneHistoryPrunePolicy,
  ): Promise<SceneHistoryPruneResult> {
    const id = sanitizeSlug(sceneId)
    const { keepCheckpoints, keepDays, keepEvents } = resolveHistoryPolicy(policy)
    const cutoff = retentionCutoff(keepDays)
    const head = (await this.row(id))?.headVersion ?? 0

    const revisions = await this.db
      .delete(sceneVersionsTable)
      .where(
        and(
          eq(sceneVersionsTable.sceneId, id),
          sql`${sceneVersionsTable.version} <> ${head}`,
          sql`${sceneVersionsTable.version} NOT IN (
            SELECT version FROM scene_versions
             WHERE scene_id = ${id}
             ORDER BY version DESC
             LIMIT ${keepCheckpoints}
          )`,
          cutoff ? sql`${sceneVersionsTable.createdAt} < ${cutoff}` : sql`true`,
        ),
      )
      .returning({ version: sceneVersionsTable.version })

    const events = await this.db
      .delete(sceneEventsTable)
      .where(
        and(
          eq(sceneEventsTable.sceneId, id),
          sql`${sceneEventsTable.eventId} NOT IN (
            SELECT event_id FROM scene_events
             WHERE scene_id = ${id}
             ORDER BY event_id DESC
             LIMIT ${keepEvents}
          )`,
        ),
      )
      .returning({ eventId: sceneEventsTable.eventId })

    return { revisionsDeleted: revisions.length, eventsDeleted: events.length }
  }

  async createAgentRequest(opts: AgentRequestCreateOptions): Promise<AgentRequest> {
    const sceneId = sanitizeSlug(opts.sceneId)
    if (typeof opts.prompt !== 'string' || opts.prompt.trim().length === 0) {
      throw new SceneInvalidError('prompt is required')
    }
    const inserted = await this.db
      .insert(agentRequestsTable)
      .values({ sceneId, prompt: opts.prompt })
      .returning()
    return toAgentRequest(inserted[0]!)
  }

  /**
   * One statement, so two agents polling together cannot claim the same row:
   * the subquery picks the oldest pending id and the UPDATE re-checks the
   * status it saw.
   */
  async claimNextAgentRequest(sceneId?: string): Promise<AgentRequest | null> {
    const scoped = sceneId ? sanitizeSlug(sceneId) : null
    const rows = await this.db
      .update(agentRequestsTable)
      .set({ status: 'claimed', claimedAt: new Date() })
      .where(
        and(
          eq(agentRequestsTable.status, 'pending'),
          eq(
            agentRequestsTable.requestId,
            sql`(
              SELECT ${agentRequestsTable.requestId} FROM ${agentRequestsTable}
              WHERE ${agentRequestsTable.status} = 'pending'
              ${scoped ? sql`AND ${agentRequestsTable.sceneId} = ${scoped}` : sql``}
              ORDER BY ${agentRequestsTable.requestId} ASC
              LIMIT 1 FOR UPDATE SKIP LOCKED
            )`,
          ),
        ),
      )
      .returning()
    return rows[0] ? toAgentRequest(rows[0]) : null
  }

  async answerAgentRequest(requestId: number, answer: string): Promise<AgentRequest | null> {
    const rows = await this.db
      .update(agentRequestsTable)
      .set({ status: 'answered', answer, answeredAt: new Date() })
      .where(eq(agentRequestsTable.requestId, requestId))
      .returning()
    return rows[0] ? toAgentRequest(rows[0]) : null
  }

  async listAgentRequests(
    sceneId: string,
    opts: AgentRequestListOptions = {},
  ): Promise<AgentRequest[]> {
    const id = sanitizeSlug(sceneId)
    const conditions = [eq(agentRequestsTable.sceneId, id)]
    if (opts.afterRequestId !== undefined) {
      conditions.push(gt(agentRequestsTable.requestId, opts.afterRequestId))
    }
    const rows = await this.db
      .select()
      .from(agentRequestsTable)
      .where(and(...conditions))
      .orderBy(asc(agentRequestsTable.requestId))
      .limit(opts.limit ?? DEFAULT_LIST_LIMIT)
    return rows.map(toAgentRequest)
  }

  /**
   * A project here is a scene row with no version behind it yet, which is what
   * `isEmpty` reports. SQLite keeps these in memory; a row survives the
   * restart a stateless replica may not.
   */
  async createProject(opts: ProjectCreateOptions): Promise<ProjectStatus> {
    assertValidName(opts.name)
    const id = opts.id ? sanitizeSlug(opts.id) : await this.generateUniqueId()
    if (!isValidSlug(id)) {
      throw new SceneInvalidError(`Invalid project id after sanitization: "${id}"`)
    }
    if (await this.row(id)) {
      throw new SceneInvalidError(`Project with id "${id}" already exists`)
    }

    const inserted = await this.db
      .insert(scenesTable)
      .values({
        id,
        name: opts.name,
        projectId: id,
        ownerId: opts.ownerId ?? null,
        headVersion: 0,
      })
      .returning()
    return rowToProjectStatus(inserted[0]!)
  }

  async getProjectStatus(id: string): Promise<ProjectStatus | null> {
    const row = await this.row(sanitizeSlug(id))
    return row ? rowToProjectStatus(row) : null
  }
}

function rowToProjectStatus(row: SceneRow): ProjectStatus {
  const editorUrl = editorUrlForScene(row.id)
  const version = row.headVersion > 0 ? row.headVersion : null
  return {
    id: row.id,
    projectId: row.projectId ?? row.id,
    name: row.name,
    editorUrl,
    url: editorUrl,
    ownerId: row.ownerId,
    thumbnailUrl: row.thumbnailUrl,
    publishedVersion: version,
    latestVersion: version,
    draftVersion: null,
    browserVisibleVersion: version,
    version: row.headVersion,
    isEmpty: row.nodeCount === 0,
    sizeBytes: row.sizeBytes,
    nodeCount: row.nodeCount,
    graphHash: row.graphHash,
    createdAt: ISO(row.createdAt),
    updatedAt: ISO(row.updatedAt),
  }
}

function toAgentRequest(row: typeof agentRequestsTable.$inferSelect): AgentRequest {
  return {
    requestId: row.requestId,
    sceneId: row.sceneId,
    prompt: row.prompt,
    status: row.status,
    createdAt: ISO(row.createdAt),
    claimedAt: row.claimedAt ? ISO(row.claimedAt) : null,
    answer: row.answer,
    answeredAt: row.answeredAt ? ISO(row.answeredAt) : null,
  }
}
