import { fail, handler, ok, parseBody } from '@panel/lib/api'
import { assignmentsSchema, type UserDetailResponse } from '@panel/lib/api-contract'
import { audit } from '@panel/lib/auth/audit'
import { requirePermission } from '@panel/lib/auth/guard'
import { allRoles } from '@panel/lib/auth/roles'
import { findInternalId, getUserDetail, setAssignments, siteNames } from '@panel/lib/users'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * PUT /api/users/:id/assignments — the drawer's site-by-site role list.
 *
 * Every change lands in the audit trail with its before/after, because "who
 * gave this account access to Gebze, and when" is the question the trail exists
 * to answer.
 */
export const PUT = handler(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const guard = await requirePermission('edit_users')
  if (!guard.ok) {
    return guard.reason === 'forbidden'
      ? fail('forbidden', 'err.forbidden')
      : fail('unauthenticated', 'err.sessionExpired')
  }

  const parsed = await parseBody(request, assignmentsSchema)
  if (!parsed.ok) return parsed.response

  const { id } = await ctx.params
  const before = await getUserDetail(id)
  if (!before) return fail('not_found', 'err.notFound')

  const internalId = await findInternalId(id)
  if (!internalId) return fail('not_found', 'err.notFound')

  await setAssignments(internalId, before.org, parsed.data.siteRoles, guard.session.userId)

  const after = await getUserDetail(id)
  const diff = Object.entries(parsed.data.siteRoles)
    .filter(([site, role]) => (before.siteRoles?.[site] ?? null) !== role)
    .map(([site, role]) => `${site}: ${before.siteRoles?.[site] ?? 'none'} → ${role ?? 'none'}`)

  if (diff.length > 0) {
    await audit({
      actorUserId: guard.session.userId,
      actorLabel: guard.session.user.email,
      level: 'info',
      kind: 'role_change',
      message: `Site access changed for ${before.email}: ${diff.join(', ')}`,
      event: { k: 'siteAccessChanged', p: { email: before.email, changes: diff.join(', ') } },
      meta: { siteRoles: parsed.data.siteRoles },
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
