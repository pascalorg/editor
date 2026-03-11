import { defineConfig } from 'drizzle-kit'

// Keep this in sync with `supabase/config.toml` -> `[db].port`.
const LOCAL_SUPABASE_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:55322/postgres'

export default defineConfig({
  schema: './src/schema/index.ts',
  out: '../../supabase/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.POSTGRES_URL ?? LOCAL_SUPABASE_DB_URL,
  },
  schemaFilter: ['public'],
  introspect: {
    casing: 'camel',
  },
  migrations: {
    prefix: 'timestamp',
  },
  verbose: true,
  strict: true,
})
