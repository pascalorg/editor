/**
 * Scenes, their version history, and the change feed the editor subscribes to.
 *
 * Field names and semantics track `sqlite-scene-store.ts` (`version`,
 * `size_bytes`, `node_count`, `graph_hash`) so one `SceneStore` contract can
 * sit over both backends while the migration runs.
 *
 * Two deliberate departures from the SQLite shape:
 *
 * - **The graph body lives in `scene_versions`, not `scenes`.** `scenes` keeps
 *   metadata and a `head_version` pointer. SQLite wrote the same graph to both
 *   tables on every save; that is half of the 3× write amplification #31 is
 *   about, and it makes the metadata row — the one every listing reads — carry
 *   megabytes it never needs.
 * - **`graph_hash` is stored, not recomputed on read.** SQLite hashed
 *   `row.graph_json` when loading, which only works because it stores the exact
 *   bytes it was given. `jsonb` normalises key order and whitespace, so a hash
 *   recomputed after a round trip would not match the one the client saw.
 */
import { index, jsonb, pgEnum, pgTable, primaryKey } from 'drizzle-orm/pg-core'
import { createdAt, id, timestamps } from '../helpers'

export const AUTHOR_KINDS = ['user', 'agent', 'system'] as const
export const authorKinds = pgEnum('scene_author_kinds', AUTHOR_KINDS)

export const scenes = pgTable(
  'scenes',
  (t) => ({
    id: id('scene'),
    name: t.text('name').notNull(),
    /**
     * Deliberately **not** a foreign key yet. The `SceneStore` contract takes
     * `projectId` and `ownerId` as opaque strings and SQLite stores them as
     * such; a constraint here would make the two backends behave differently
     * for the same call, which is the one thing this interface exists to
     * prevent. #34 introduces real projects and users, and the constraints
     * arrive with them in their own migration.
     */
    projectId: t.text('project_id'),
    ownerId: t.text('owner_id'),
    thumbnailUrl: t.text('thumbnail_url'),
    /** Version of the row in `scene_versions` this scene currently points at. */
    headVersion: t.integer('head_version').notNull().default(1),
    sizeBytes: t.integer('size_bytes').notNull().default(0),
    nodeCount: t.integer('node_count').notNull().default(0),
    graphHash: t.text('graph_hash'),
    published: t.boolean('published').notNull().default(false),
    ...timestamps,
  }),
  (t) => [
    index('scenes_project_updated_idx').on(t.projectId, t.updatedAt.desc()),
    index('scenes_owner_updated_idx').on(t.ownerId, t.updatedAt.desc()),
  ],
)

export const sceneVersions = pgTable(
  'scene_versions',
  (t) => ({
    sceneId: t
      .text('scene_id')
      .notNull()
      .references(() => scenes.id, { onDelete: 'cascade' }),
    version: t.integer('version').notNull(),
    graph: jsonb('graph').notNull(),
    graphHash: t.text('graph_hash').notNull(),
    sizeBytes: t.integer('size_bytes').notNull().default(0),
    nodeCount: t.integer('node_count').notNull().default(0),
    authorKind: authorKinds('author_kind').notNull().default('user'),
    /** Opaque for the same reason as `scenes.owner_id`. */
    authorId: t.text('author_id'),
    createdAt,
  }),
  (t) => [primaryKey({ columns: [t.sceneId, t.version] })],
)

/**
 * The feed `/api/scenes/[id]/events` serves. Carries the version that landed,
 * not the graph — a client that missed an event fetches the version it names.
 * Sending the whole graph to every subscriber is what makes 2.000 clients cost
 * 8.000 queries a second today.
 */
export const sceneEvents = pgTable(
  'scene_events',
  (t) => ({
    eventId: t.bigserial('event_id', { mode: 'number' }).primaryKey(),
    sceneId: t
      .text('scene_id')
      .notNull()
      .references(() => scenes.id, { onDelete: 'cascade' }),
    version: t.integer('version').notNull(),
    kind: t.text('kind').notNull(),
    createdAt,
  }),
  (t) => [index('scene_events_scene_event_idx').on(t.sceneId, t.eventId)],
)

export const AGENT_REQUEST_STATUS = ['pending', 'claimed', 'answered'] as const
export const agentRequestStatus = pgEnum('agent_request_status', AGENT_REQUEST_STATUS)

/**
 * The editor→MCP queue. MCP is client-driven, so a server can never start a
 * conversation; a queue an already-running agent polls is the way round it.
 */
export const agentRequests = pgTable(
  'agent_requests',
  (t) => ({
    requestId: t.bigserial('request_id', { mode: 'number' }).primaryKey(),
    sceneId: t
      .text('scene_id')
      .notNull()
      .references(() => scenes.id, { onDelete: 'cascade' }),
    prompt: t.text('prompt').notNull(),
    status: agentRequestStatus('status').notNull().default('pending'),
    answer: t.text('answer'),
    claimedAt: t.timestamp('claimed_at', { withTimezone: true }),
    answeredAt: t.timestamp('answered_at', { withTimezone: true }),
    createdAt,
  }),
  (t) => [
    index('agent_requests_pending_idx').on(t.status, t.requestId),
    index('agent_requests_scene_idx').on(t.sceneId, t.requestId),
  ],
)

export type Scene = typeof scenes.$inferSelect
export type NewScene = typeof scenes.$inferInsert
export type SceneVersion = typeof sceneVersions.$inferSelect
export type SceneEvent = typeof sceneEvents.$inferSelect
export type AgentRequest = typeof agentRequests.$inferSelect
