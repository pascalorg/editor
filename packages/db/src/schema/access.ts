/**
 * Ways into a scene that are not a session: MCP personal access tokens (#36)
 * and share links (#34).
 *
 * Both store a **hash** of the secret, never the secret. A token table that
 * can be read back is a credential dump waiting for one leaked backup, and
 * neither flow needs the plaintext after issuing it — the holder presents the
 * secret, we hash and compare.
 */
import { index, pgEnum, pgTable, uniqueIndex } from 'drizzle-orm/pg-core'
import { createdAt, id, timestamps } from '../helpers'
import { users } from './auth'
import { scenes } from './scenes'

export const apiTokens = pgTable(
  'api_tokens',
  (t) => ({
    id: id('token'),
    userId: t
      .text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: t.text('name').notNull(),
    /** SHA-256 of the presented secret. */
    tokenHash: t.text('token_hash').notNull(),
    /** First characters of the secret, so the UI can tell two tokens apart. */
    tokenPrefix: t.text('token_prefix').notNull(),
    lastUsedAt: t.timestamp('last_used_at', { withTimezone: true }),
    expiresAt: t.timestamp('expires_at', { withTimezone: true }),
    revokedAt: t.timestamp('revoked_at', { withTimezone: true }),
    ...timestamps,
  }),
  (t) => [
    uniqueIndex('api_tokens_hash_unique').on(t.tokenHash),
    index('api_tokens_user_idx').on(t.userId),
  ],
)

export const SHARE_LINK_ROLES = ['viewer', 'editor'] as const
export const shareLinkRoles = pgEnum('share_link_roles', SHARE_LINK_ROLES)

export const shareLinks = pgTable(
  'share_links',
  (t) => ({
    id: id('share'),
    sceneId: t
      .text('scene_id')
      .notNull()
      .references(() => scenes.id, { onDelete: 'cascade' }),
    tokenHash: t.text('token_hash').notNull(),
    role: shareLinkRoles('role').notNull().default('viewer'),
    createdBy: t.text('created_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: t.timestamp('expires_at', { withTimezone: true }),
    revokedAt: t.timestamp('revoked_at', { withTimezone: true }),
    createdAt,
  }),
  (t) => [
    uniqueIndex('share_links_hash_unique').on(t.tokenHash),
    index('share_links_scene_idx').on(t.sceneId),
  ],
)

export type ApiToken = typeof apiTokens.$inferSelect
export type ShareLink = typeof shareLinks.$inferSelect
export type ShareLinkRole = (typeof SHARE_LINK_ROLES)[number]
