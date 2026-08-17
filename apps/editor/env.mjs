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
  },

  /**
   * Client-side environment variables (exposed to browser via NEXT_PUBLIC_)
   */
  client: {
    NEXT_PUBLIC_ASSETS_CDN_URL: z.string().optional(),
  },

  /**
   * Runtime values - pulls from process.env
   */
  runtimeEnv: {
    NEXT_PUBLIC_ASSETS_CDN_URL:
      process.env.NEXT_PUBLIC_ASSETS_CDN_URL ?? process.env.NEXT_PUBLIC_EDITOR_ASSETS_CDN_URL,
  },

  /**
   * Skip validation during build (env vars come from Vercel at runtime)
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
})
