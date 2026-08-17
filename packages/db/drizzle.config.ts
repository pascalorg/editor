import { defineConfig } from 'drizzle-kit'

/** Matches the `postgres` service in the repo-root `docker-compose.yml`. */
const LOCAL_POSTGRES_URL = 'postgresql://pascal:pascal@127.0.0.1:5433/pascal'

export default defineConfig({
  schema: './src/schema/index.ts',
  // Committed to the repo and applied as a deploy step, so the SQL that runs in
  // production is the SQL that was reviewed.
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.POSTGRES_URL ?? LOCAL_POSTGRES_URL,
  },
  schemaFilter: ['public'],
  strict: true,
  verbose: true,
})
