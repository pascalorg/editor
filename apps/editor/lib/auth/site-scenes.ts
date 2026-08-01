import { exec, query, type RowDataPacket } from '@panel/lib/db'
import { ulid } from 'ulid'
import { getSceneOperations } from '@/lib/scene-store-server'

/**
 * Keeps the console's sites and the editor's scenes as two views of one
 * thing, in both directions:
 *
 *  - a site without a scene gets one (named after it, owned by its creator);
 *  - a scene no site references gets a site card, so work started in the
 *    editor shows up on Sites & Projects too.
 *
 * The console's provisioning job still drives the card's progress; this
 * worker does the parts the console cannot, because only the editor has a
 * scene store. Editor-owned on purpose: it must never sync upstream.
 */

const EMPTY_GRAPH = { nodes: {}, rootNodeIds: [] }

interface PendingSite extends RowDataPacket {
  id: number
  name: string
  owner_public_id: string
}

export async function ensureSiteScenes(): Promise<number> {
  const pending = await query<PendingSite>(
    `SELECT s.id, s.name, u.public_id AS owner_public_id
       FROM sites s
       JOIN users u ON u.id = s.created_by
      WHERE s.scene_id IS NULL AND s.status <> 'archived'`,
  )
  if (pending.length === 0) return 0

  const operations = await getSceneOperations()
  let created = 0
  for (const site of pending) {
    const meta = await operations.saveScene({
      name: site.name,
      projectId: null,
      ownerId: site.owner_public_id,
      graph: EMPTY_GRAPH as never,
      thumbnailUrl: null,
    })
    await exec('UPDATE sites SET scene_id = ? WHERE id = ? AND scene_id IS NULL', [
      meta.id,
      site.id,
    ])
    created++
    console.log(`[digitaltwin:sites] scene ${meta.id} created for site "${site.name}"`)
  }
  return created
}

interface OrphanScene extends RowDataPacket {
  id: string
  name: string
  creator_id: number
}

/**
 * The reverse pass: scenes created in the editor become site cards. Only
 * owned scenes qualify — sites require a creator, and an ownerless legacy
 * scene gets its card as soon as an admin assigns it an owner in the 3D
 * scenes tab. Site names are unique; a clash gets the scene id's tail
 * appended rather than silently swallowing the scene.
 */
export async function ensureSceneSites(): Promise<number> {
  // The scenes table (editor store) and the console tables carry different
  // utf8mb4 collations; every textual join pins both sides to one collation
  // or MariaDB refuses the comparison.
  const orphans = await query<OrphanScene>(
    `SELECT sc.id, sc.name, u.id AS creator_id
       FROM scenes sc
       JOIN users u
         ON CONVERT(u.public_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
          = CONVERT(sc.owner_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
       LEFT JOIN sites s
         ON CONVERT(s.scene_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
          = CONVERT(sc.id USING utf8mb4) COLLATE utf8mb4_unicode_ci
      WHERE s.id IS NULL`,
  )

  let created = 0
  for (const scene of orphans) {
    const base = scene.name.slice(0, 100).trim() || 'Scene'
    for (const name of [base, `${base} · ${scene.id.slice(0, 6)}`]) {
      try {
        await exec(
          `INSERT INTO sites (public_id, name, status, created_by, scene_id)
           VALUES (?, ?, 'active', ?, ?)`,
          [ulid(), name, scene.creator_id, scene.id],
        )
        created++
        console.log(`[digitaltwin:sites] site card created for scene "${scene.name}"`)
        break
      } catch (error) {
        if ((error as { code?: string })?.code !== 'ER_DUP_ENTRY') throw error
      }
    }
  }
  return created
}

let worker: ReturnType<typeof setInterval> | undefined
let running = false

/** Mirrors the console's job-worker idiom: lazy, quiet, unref'd. */
export function startSiteSceneWorker(): void {
  if (worker) return
  const tick = async () => {
    if (running) return
    running = true
    try {
      await ensureSiteScenes()
      await ensureSceneSites()
    } catch (error) {
      console.error('[digitaltwin:sites] scene provisioning failed:', error)
    } finally {
      running = false
    }
  }
  worker = setInterval(() => void tick(), 10_000)
  worker.unref?.()
  void tick()
}
