import { pgTable } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { createdAt, id } from '../../helpers'

export const jwks = pgTable('auth_jwks', (t) => ({
  id: id('jwks'),
  publicKey: t.text('public_key').notNull(),
  privateKey: t.text('private_key').notNull(),
  createdAt,
})).enableRLS()

export type Jwks = typeof jwks.$inferSelect
export type NewJwks = typeof jwks.$inferInsert
export const insertJwksSchema = createInsertSchema(jwks)
export const selectJwksSchema = createSelectSchema(jwks)
