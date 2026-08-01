import { exec, query, type RowDataPacket } from '@panel/lib/db'
import { getSceneOperations } from '@/lib/scene-store-server'

/**
 * Makes the console's sites real: every site gets an actual 3D scene.
 *
 * The console's provisioning job drives the card's progress and flips the
 * site to `active`; this worker does the part the console cannot — it lives
 * with the editor, so it is the one that can create scenes. It watches for
 * sites without one and fills them in, owned by whoever created the site,
 * named after it. Editor-owned on purpose: the standalone console has no
 * scene store, so this must never sync upstream.
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
