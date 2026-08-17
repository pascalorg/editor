/**
 * Tenancy. A scene belongs to a project; a project has one owner and any
 * number of members. Access checks (#34) read `project_members`, never the
 * scene row alone — a scene's `owner_id` says who made it, not who may open it.
 */
import { index, pgEnum, pgTable, primaryKey } from 'drizzle-orm/pg-core'
import { id, timestamps } from '../helpers'
import { users } from './auth'

export const PROJECT_ROLES = ['owner', 'editor', 'viewer'] as const
export const projectRoles = pgEnum('project_roles', PROJECT_ROLES)

export const PROJECT_VISIBILITY = ['private', 'unlisted', 'public'] as const
export const projectVisibility = pgEnum('project_visibility', PROJECT_VISIBILITY)

export const projects = pgTable(
  'projects',
  (t) => ({
    id: id('project'),
    name: t.text('name').notNull(),
    ownerId: t
      .text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    visibility: projectVisibility('visibility').notNull().default('private'),
    ...timestamps,
  }),
  (t) => [index('projects_owner_updated_idx').on(t.ownerId, t.updatedAt.desc())],
)

export const projectMembers = pgTable(
  'project_members',
  (t) => ({
    projectId: t
      .text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: t
      .text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: projectRoles('role').notNull().default('viewer'),
    ...timestamps,
  }),
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    // "Which projects can this user see?" is the query behind every scene
    // listing, and it runs on every page load.
    index('project_members_user_idx').on(t.userId),
  ],
)

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type ProjectMember = typeof projectMembers.$inferSelect
export type ProjectRole = (typeof PROJECT_ROLES)[number]
