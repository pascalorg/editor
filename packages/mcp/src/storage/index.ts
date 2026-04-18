import type { SceneStore } from './types'

export * from './slug'
export * from './types'

/**
 * Factory that picks the correct `SceneStore` backend based on env:
 * - If `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are both set → Supabase.
 * - Otherwise → filesystem.
 *
 * Implementations are loaded via dynamic `import()` so consumers only pay the
 * cost of the backend they actually use.
 */
export async function createSceneStore(env?: NodeJS.ProcessEnv): Promise<SceneStore> {
  const resolved = env ?? (typeof process !== 'undefined' ? process.env : undefined)
  const supabaseUrl = resolved?.SUPABASE_URL
  const supabaseKey = resolved?.SUPABASE_SERVICE_ROLE_KEY

  if (supabaseUrl && supabaseKey) {
    const mod = await import('./supabase-scene-store')
    return new mod.SupabaseSceneStore({
      url: supabaseUrl,
      serviceRoleKey: supabaseKey,
    })
  }

  const mod = await import('./filesystem-scene-store')
  return new mod.FilesystemSceneStore()
}
