import { type Auth, createAuth } from '@pascal-app/auth'
import { getDatabase } from '@pascal-app/db'
import { env } from '../env.mjs'
import { resolveEmailSender } from './email'

let instance: Auth | null = null

/**
 * Lazy on purpose. `getDatabase()` throws without `POSTGRES_URL`, and building
 * the instance at module scope made that throw during Next's page-data
 * collection — so `bun run build` failed on `/api/auth/[...all]` on any machine
 * without Postgres configured, which is every clean checkout. Deferring it to
 * the first request keeps the module importable and moves the failure to where
 * it can be reported.
 */
export function getAuth(): Auth {
  if (!instance) {
    instance = createAuth({
      db: getDatabase(),
      appName: 'Menart 3D',
      baseURL: env.NEXT_PUBLIC_APP_URL || 'http://localhost:3002',
      secret: env.BETTER_AUTH_SECRET || 'development-secret-key-do-not-use-in-prod',
      googleClientId: env.GOOGLE_CLIENT_ID,
      googleClientSecret: env.GOOGLE_CLIENT_SECRET,
      sendEmail: resolveEmailSender(),
    })
  }
  return instance
}
