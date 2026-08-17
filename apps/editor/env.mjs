/**
 * Environment variable validation for the editor app.
 *
 * This file validates environment variables used by the standalone editor app.
 * Values are loaded from the repo root .env.local by package scripts.
 *
 * @see https://env.t3.gg/docs/nextjs
 */
import { createEnv } from '@t3-oss/env-nextjs'
import { z } from 'zod'

export const env = createEnv({
  /**
   * Server-side environment variables (not exposed to client)
   */
  server: {
    /**
     * Postgres connection string. Optional while the SQLite store is still the
     * default; `packages/db` throws on its own if something asks for a database
     * without it. Validated here so a typo fails at boot rather than on the
     * first query.
     */
    POSTGRES_URL: z.string().url().optional(),
    /**
     * Per-replica connection pool size. `replicas × this` has to stay under
     * Postgres' `max_connections`, which is why production puts PgBouncer in
     * front in transaction mode.
     */
    POSTGRES_POOL_SIZE: z.coerce.number().int().positive().max(100).optional(),
    
    BETTER_AUTH_SECRET: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
  },

  /**
   * Client-side environment variables (exposed to browser via NEXT_PUBLIC_)
   */
  client: {
    NEXT_PUBLIC_ASSETS_CDN_URL: z.string().optional(),
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  },

  /**
   * Runtime values - pulls from process.env
   */
  runtimeEnv: {
    POSTGRES_URL: process.env.POSTGRES_URL,
    POSTGRES_POOL_SIZE: process.env.POSTGRES_POOL_SIZE,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    NEXT_PUBLIC_ASSETS_CDN_URL:
      process.env.NEXT_PUBLIC_ASSETS_CDN_URL ?? process.env.NEXT_PUBLIC_EDITOR_ASSETS_CDN_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },

  /**
   * Skip validation during build (env vars come from Vercel at runtime)
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
})
