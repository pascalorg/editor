import type { SceneStore } from './types'

/**
 * One-shot migration of scenes from one `SceneStore` to another — in practice a
 * SQLite file to Postgres, but the logic only knows the `SceneStore` contract,
 * so it is backend-agnostic and testable with two SQLite files.
 */

export interface SceneMigrationOptions {
  /**
   * Owner id stamped on scenes that have none. Scenes that already carry an
   * owner keep it; only the unowned ones (early dev data predates accounts)
   * pick this up. Without it, an unowned scene stays a guest scene.
   */
  ownerId?: string
  /** Re-save scenes that already exist on the target instead of skipping. */
  overwrite?: boolean
  /** Compute the plan and report without writing to the target. */
  dryRun?: boolean
}

export interface SceneMigrationReport {
  migrated: number
  overwritten: number
  skipped: number
  failed: Array<{ id: string; error: string }>
}

export async function migrateScenes(
  source: SceneStore,
  target: SceneStore,
  options: SceneMigrationOptions = {},
): Promise<SceneMigrationReport> {
  const sourceScenes = await source.list()
  const targetScenes = await target.list()
  const targetById = new Map(targetScenes.map((scene) => [scene.id, scene]))

  const report: SceneMigrationReport = { migrated: 0, overwritten: 0, skipped: 0, failed: [] }

  for (const meta of sourceScenes) {
    const existing = targetById.get(meta.id)

    // Idempotent by default: a scene the target already has is left alone, so a
    // run interrupted halfway can simply be re-run.
    if (existing && !options.overwrite) {
      report.skipped += 1
      continue
    }

    const full = await source.load(meta.id)
    if (!full) {
      report.failed.push({ id: meta.id, error: 'scene disappeared from the source mid-run' })
      continue
    }

    if (options.dryRun) {
      if (existing) report.overwritten += 1
      else report.migrated += 1
      continue
    }

    try {
      await target.save({
        id: full.id,
        name: full.name,
        projectId: full.projectId,
        ownerId: full.ownerId ?? options.ownerId ?? null,
        thumbnailUrl: full.thumbnailUrl,
        graph: full.graph,
        // Migrated scenes become real versions someone can return to, not
        // mutable drafts — deliberately the non-default side (see the scene
        // store's save-mode docs).
        saveMode: 'checkpoint',
        expectedVersion: existing ? existing.version : undefined,
      })
      if (existing) report.overwritten += 1
      else report.migrated += 1
    } catch (error) {
      report.failed.push({
        id: meta.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return report
}
