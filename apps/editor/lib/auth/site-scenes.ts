import { exec, query, type RowDataPacket } from '@panel/lib/db'
import { deliverScenePublished } from '@panel/lib/mail'
import { ulid } from 'ulid'
import { getSceneOperations } from '@/lib/scene-store-server'

/**
 * Where sites and scenes meet — and the direction matters.
 *
 * A site created in the console is an approved project, so it gets a real
 * scene right away (the worker below). A scene drawn in the editor is a
 * private draft and does NOT become a site on its own: an admin publishes
 * it from the console's 3D scenes tab (`publishSceneAsSite`). Sites &
 * Projects is therefore the approved catalogue, /scenes the workbench.
 *
 * The console's provisioning job still drives the card's progress; this
 * file does the parts the console cannot, because only the editor has a
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

export type PublishResult = 'published' | 'already_published' | 'scene_not_found'

/**
 * Publishing is an admin's act of approval, never automatic.
 *
 * The two screens mean different things: /scenes is where people draw, and
 * every scene there is a private draft. Sites & Projects is the approved
 * catalogue — a project only lands there when an admin publishes it from
 * the console's 3D scenes tab. So this runs on request, not on a timer.
 *
 * The card is credited to the scene's owner, whose work is being published;
 * an ownerless legacy scene falls back to the approving admin. Site names
 * are unique, so a clash gets the scene id's tail appended.
 */
export async function publishSceneAsSite(
  sceneId: string,
  approverPublicId: string,
): Promise<PublishResult> {
  if ((await publishedSceneIds()).has(sceneId)) return 'already_published'

  // The scenes table (editor store) and the console tables carry different
  // utf8mb4 collations; every textual join pins both sides to one collation
  // or MariaDB refuses the comparison.
  const rows = await query<OrphanScene>(
    `SELECT sc.id, sc.name, u.id AS creator_id
       FROM scenes sc
       LEFT JOIN users u
         ON CONVERT(u.public_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
          = CONVERT(sc.owner_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
      WHERE sc.id = ?`,
    [sceneId],
  )
  const scene = rows[0]
  if (!scene) return 'scene_not_found'

  let creatorId: number | null = scene.creator_id
  if (creatorId === null) {
    const approver = await query<RowDataPacket & { id: number }>(
      'SELECT id FROM users WHERE public_id = ?',
      [approverPublicId],
    )
    creatorId = approver[0]?.id ?? null
  }
  if (creatorId === null) return 'scene_not_found'

  const base = scene.name.slice(0, 100).trim() || 'Scene'
  for (const name of [base, `${base} · ${scene.id.slice(0, 6)}`]) {
    try {
      await exec(
        `INSERT INTO sites (public_id, name, status, created_by, scene_id)
         VALUES (?, ?, 'active', ?, ?)`,
        [ulid(), name, creatorId, scene.id],
      )
      console.log(`[digitaltwin:sites] scene "${scene.name}" published as a site`)
      return 'published'
    } catch (error) {
      if ((error as { code?: string })?.code !== 'ER_DUP_ENTRY') throw error
    }
  }
  return 'already_published'
}

/**
 * Tells a scene's owner that their project went live.
 *
 * Separate from `publishSceneAsSite` so a mail failure can never roll back an
 * approval that already happened. A scene with no owner — one adopted from the
 * pre-account era — has nobody to tell, and that is not an error.
 */
export async function notifyScenePublished(sceneId: string): Promise<void> {
  const rows = await query<RowDataPacket & { name: string; email: string; full_name: string }>(
    `SELECT sc.name, u.email, u.full_name
       FROM scenes sc
       JOIN users u
         ON CONVERT(u.public_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
          = CONVERT(sc.owner_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
      WHERE sc.id = ?`,
    [sceneId],
  )
  const owner = rows[0]
  if (!owner) return

  await deliverScenePublished({
    email: owner.email,
    fullName: owner.full_name,
    sceneName: owner.name,
    sceneId,
  })
}

/** Scene ids that already carry a site card — the published set. */
export async function publishedSceneIds(): Promise<Set<string>> {
  const rows = await query<RowDataPacket & { scene_id: string }>(
    'SELECT scene_id FROM sites WHERE scene_id IS NOT NULL',
  )
  return new Set(rows.map((r) => r.scene_id))
}

/** Withdraws a published project: the card goes, the scene stays. */
export async function unpublishScene(sceneId: string): Promise<boolean> {
  const result = await exec(
    `DELETE FROM sites
      WHERE CONVERT(scene_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
          = CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci`,
    [sceneId],
  )
  return result.affectedRows > 0
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
