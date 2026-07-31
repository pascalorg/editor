import { fail, handler, ok } from '@panel/lib/api'
import { audit } from '@panel/lib/auth/audit'
import { requirePermission } from '@panel/lib/auth/guard'
import { exec, queryOne, type RowDataPacket } from '@panel/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/sites/:id/archive
 *
 * Archiving stops access without deleting anything — assignments stay on the
 * row, so a restore hands everyone their access back instead of requiring the
 * whole grant list to be rebuilt by hand.
 */
export const POST = handler(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const guard = await requirePermission('admin_access')
  if (!guard.ok) {
    return guard.reason === 'forbidden'
      ? fail('forbidden', 'err.forbidden')
      : fail('unauthenticated', 'err.sessionExpired')
  }

  const { id } = await ctx.params
  const row = await queryOne<RowDataPacket & { id: number; name: string; status: string }>(
    'SELECT id, name, status FROM sites WHERE public_id = ?',
    [id],
  )
  if (!row) return fail('not_found', 'err.notFound')
  if (row.status === 'archived') return fail('conflict', 'err.siteStateUnchanged')

  await exec("UPDATE sites SET status = 'archived' WHERE id = ?", [row.id])

  await audit({
    actorUserId: guard.session.userId,
    actorLabel: guard.session.user.email,
    level: 'warn',
    kind: 'site',
    message: `Site archived: ${row.name}`,
    event: { k: 'siteArchived', p: { name: row.name } },
    meta: { site: id, from: row.status, to: 'archived' },
  })

  return ok({ status: 'archived' })
})
