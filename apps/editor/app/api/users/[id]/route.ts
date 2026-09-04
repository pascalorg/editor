import { fail, handler, ok, parseBody } from '@panel/lib/api'
import { type UserDetailResponse, updateUserSchema } from '@panel/lib/api-contract'
import { audit } from '@panel/lib/auth/audit'
import { requirePermission } from '@panel/lib/auth/guard'
import { allRoles } from '@panel/lib/auth/roles'
import { revokeAllSessions } from '@panel/lib/auth/session'
import { queryOne, type RowDataPacket } from '@panel/lib/db'
import { deliverAccessChanged } from '@panel/lib/mail'
import { deleteUser, getUserDetail, siteNames, updateUser } from '@panel/lib/users'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/users/:id — everything the detail drawer renders. */
export const GET = handler(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const guard = await requirePermission('admin_access')
  if (!guard.ok) {
    return guard.reason === 'forbidden'
      ? fail('forbidden', 'err.forbidden')
      : fail('unauthenticated', 'err.sessionExpired')
  }

  const { id } = await ctx.params
  const user = await getUserDetail(id)
  if (!user) return fail('not_found', 'err.notFound')

  const body: UserDetailResponse = {
    user,
    sites: await siteNames(),
    roles: (await allRoles()).map((r) => r.name),
    canEdit: guard.session.user.permissions.includes('edit_users'),
  }
  return ok(body)
})

/**
 * PATCH /api/users/:id — inline edit and the drawer's activate/deactivate.
 *
 * The primary admin is protected from deactivation as well as deletion: locking
 * out the only account that can grant permissions is not a recoverable mistake.
 */
export const PATCH = handler(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const guard = await requirePermission('edit_users')
  if (!guard.ok) {
    return guard.reason === 'forbidden'
      ? fail('forbidden', 'err.forbidden')
      : fail('unauthenticated', 'err.sessionExpired')
  }

  const parsed = await parseBody(request, updateUserSchema)
  if (!parsed.ok) return parsed.response

  const { id } = await ctx.params
  const before = await getUserDetail(id)
  if (!before) return fail('not_found', 'err.notFound')

  if (
    before.isPrimaryAdmin &&
    (parsed.data.status === 'Inactive' || parsed.data.role !== undefined)
  ) {
    return fail('forbidden', 'err.primaryAdminProtected')
  }

  const internal = await queryOne<RowDataPacket & { id: number }>(
    'SELECT id FROM users WHERE public_id = ?',
    [id],
  )
  if (!internal) return fail('not_found', 'err.notFound')

  if (parsed.data.email || parsed.data.username) {
    const clash = await queryOne<RowDataPacket & { id: number }>(
      'SELECT id FROM users WHERE (email = ? OR username = ?) AND id <> ? LIMIT 1',
      [parsed.data.email ?? '', parsed.data.username ?? '', internal.id],
    )
    if (clash) return fail('conflict', 'err.userExists')
  }

  await updateUser(internal.id, parsed.data, before.org)

  // Deactivating an account must also end its live sessions, or the change is
  // cosmetic until the idle timeout happens to fire.
  if (parsed.data.status === 'Inactive') await revokeAllSessions(internal.id, null)

  const after = await getUserDetail(id)

  // Old → new for the audit line, read from the stored row on both sides. An
  // external account has its role clamped to Viewer on write, so diffing against
  // the request would record a change that never happened.
  const snapshot = (u: NonNullable<typeof after>): Record<string, string> => ({
    fullName: u.name,
    email: u.email,
    username: u.username,
    role: String(u.role),
    status: u.status,
  })
  const previous = snapshot(before)
  const current = after ? snapshot(after) : previous
  const changed = Object.keys(parsed.data)
    .filter((key) => previous[key] !== current[key])
    .map((key) => `${key}: ${previous[key]} → ${current[key]}`)

  await audit({
    actorUserId: guard.session.userId,
    actorLabel: guard.session.user.email,
    level: 'info',
    kind: 'user',
    message: `User updated: ${before.email}${changed.length ? ` (${changed.join(', ')})` : ''}`,
    event: changed.length
      ? { k: 'userUpdated' as const, p: { email: before.email, changes: changed.join(', ') } }
      : { k: 'userUpdatedPlain' as const, p: { email: before.email } },
    meta: parsed.data,
  })

  // Losing or regaining access is the one change a person notices only as a
  // sign-in that stops working, so it is announced. Every other edit — a name,
  // a role — is the administrator's business and stays quiet.
  if (parsed.data.status !== undefined && parsed.data.status !== before.status) {
    await deliverAccessChanged({
      email: before.email,
      fullName: after?.name ?? before.name,
      active: parsed.data.status === 'Active',
    })
  }

  const body: UserDetailResponse = {
    user: after!,
    sites: await siteNames(),
    roles: (await allRoles()).map((r) => r.name),
    canEdit: true,
  }
  return ok(body)
})

/** DELETE /api/users/:id — the primary admin is never deletable. */
export const DELETE = handler(
  async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
    const guard = await requirePermission('edit_users')
    if (!guard.ok) {
      return guard.reason === 'forbidden'
        ? fail('forbidden', 'err.forbidden')
        : fail('unauthenticated', 'err.sessionExpired')
    }

    const { id } = await ctx.params
    const user = await getUserDetail(id)
    if (!user) return fail('not_found', 'err.notFound')
    if (user.isPrimaryAdmin) return fail('forbidden', 'err.primaryAdminProtected')

    const internal = await queryOne<RowDataPacket & { id: number }>(
      'SELECT id FROM users WHERE public_id = ?',
      [id],
    )
    if (!internal) return fail('not_found', 'err.notFound')
    if (internal.id === guard.session.userId) return fail('forbidden', 'err.cannotDeleteSelf')

    try {
      await deleteUser(internal.id)
    } catch (err) {
      // MySQL 1451: a RESTRICT foreign key still points at this account.
      // Migration 006 relaxed every provenance FK to SET NULL, so this only
      // fires on a database that has not run it — but "something went wrong"
      // is never an acceptable answer to a refused delete.
      if ((err as { errno?: number }).errno === 1451) {
        return fail('conflict', 'err.userReferenced')
      }
      throw err
    }
    await audit({
      actorUserId: guard.session.userId,
      actorLabel: guard.session.user.email,
      level: 'warn',
      kind: 'user',
      message: `User deleted: ${user.email}`,
      event: { k: 'userDeleted', p: { email: user.email } },
      meta: { role: user.role, org: user.org },
    })

    return ok({ deleted: true })
  },
)
