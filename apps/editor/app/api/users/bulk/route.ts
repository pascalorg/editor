import { fail, handler, ok, parseBody } from '@panel/lib/api'
import { type BulkUsersResponse, bulkUsersSchema } from '@panel/lib/api-contract'
import { audit } from '@panel/lib/auth/audit'
import { requirePermission } from '@panel/lib/auth/guard'
import { revokeAllSessions } from '@panel/lib/auth/session'
import { deleteUser, findInternalId, getUserDetail, updateUser } from '@panel/lib/users'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/users/bulk — the selection toolbar on the Users tab.
 *
 * Three rules make this safe to expose:
 *
 * 1. Every guard the single-account endpoints apply is applied again here, per
 *    account. The bulk path is not a shortcut around `edit_users`, the primary
 *    administrator protection, or the you-cannot-delete-yourself rule.
 * 2. Nothing is silently dropped. An account that is skipped comes back in the
 *    response with a reason, so the toolbar can say "9 changed, 1 skipped
 *    (primary administrator)" instead of quietly doing less than asked.
 * 3. One audit row per affected account. A single "12 accounts changed" line
 *    would be cheaper and would destroy the per-account history the trail is
 *    for.
 *
 * The prototype also offered "Require 2FA". It is not here: enrolment means
 * possessing an authenticator, and no administrator can do that on someone
 * else's behalf. The org-wide requirement already exists as a settings toggle,
 * and `revokeSessions` is the action an administrator actually wants when
 * tightening a set of accounts — it forces every one of them back through the
 * sign-in gate, which enforces the policy that is in effect.
 */
export const POST = handler(async (request: Request) => {
  const guard = await requirePermission('edit_users')
  if (!guard.ok) {
    return guard.reason === 'forbidden'
      ? fail('forbidden', 'err.forbidden')
      : fail('unauthenticated', 'err.sessionExpired')
  }

  const parsed = await parseBody(request, bulkUsersSchema)
  if (!parsed.ok) return parsed.response

  const { action, ids } = parsed.data
  const skipped: BulkUsersResponse['skipped'] = []
  let applied = 0

  // Duplicates in the payload would otherwise be applied — and audited — twice.
  for (const id of [...new Set(ids)]) {
    const user = await getUserDetail(id)
    if (!user) {
      skipped.push({ id, label: id, reason: 'notFound' })
      continue
    }

    const internalId = await findInternalId(id)
    if (internalId === null) {
      skipped.push({ id, label: user.email, reason: 'notFound' })
      continue
    }

    const isSelf = internalId === guard.session.userId

    // Demoting or disabling the only account that can grant permissions is not
    // a recoverable mistake; revoking its sessions is merely inconvenient.
    if (user.isPrimaryAdmin && action !== 'revokeSessions') {
      skipped.push({ id, label: user.email, reason: 'primaryAdmin' })
      continue
    }
    // Signing yourself out in bulk is a legitimate thing to want; deleting or
    // deactivating yourself mid-request is not.
    if (isSelf && (action === 'delete' || action === 'deactivate')) {
      skipped.push({ id, label: user.email, reason: 'self' })
      continue
    }

    switch (action) {
      case 'roleViewer': {
        if (user.role === 'Viewer') {
          skipped.push({ id, label: user.email, reason: 'noop' })
          continue
        }
        await updateUser(internalId, { role: 'Viewer' }, user.org)
        await audit({
          actorUserId: guard.session.userId,
          actorLabel: guard.session.user.email,
          level: 'info',
          kind: 'user',
          message: `User updated: ${user.email} (role: ${user.role} → Viewer)`,
          event: {
            k: 'userUpdated',
            p: { email: user.email, changes: `role: ${user.role} → Viewer` },
          },
          meta: { bulk: action, role: 'Viewer' },
        })
        break
      }

      case 'revokeSessions': {
        // Signing your own other devices out is legitimate; signing out the
        // console you are working in halfway through a batch is not. The first
        // run of this endpoint did exactly that and 401'd its own next request.
        const ended = await revokeAllSessions(internalId, isSelf ? guard.session.id : null)
        if (ended === 0) {
          skipped.push({ id, label: user.email, reason: 'noop' })
          continue
        }
        await audit({
          actorUserId: guard.session.userId,
          actorLabel: guard.session.user.email,
          level: 'info',
          kind: 'user',
          message: `Sessions revoked: ${user.email} (${ended})`,
          event: { k: 'sessionsRevokedFor', p: { email: user.email, count: ended } },
          meta: { bulk: action, sessions: ended },
        })
        break
      }

      case 'deactivate': {
        if (user.status === 'Inactive') {
          skipped.push({ id, label: user.email, reason: 'noop' })
          continue
        }
        await updateUser(internalId, { status: 'Inactive' }, user.org)
        // Same rule as the single-account path: a deactivation that leaves live
        // sessions running is cosmetic until the idle timeout happens to fire.
        await revokeAllSessions(internalId, null)
        await audit({
          actorUserId: guard.session.userId,
          actorLabel: guard.session.user.email,
          level: 'warn',
          kind: 'user',
          message: `User updated: ${user.email} (status: ${user.status} → Inactive)`,
          event: {
            k: 'userUpdated',
            p: { email: user.email, changes: `status: ${user.status} → Inactive` },
          },
          meta: { bulk: action, status: 'Inactive' },
        })
        break
      }

      case 'delete': {
        await deleteUser(internalId)
        await audit({
          actorUserId: guard.session.userId,
          actorLabel: guard.session.user.email,
          level: 'warn',
          kind: 'user',
          message: `User deleted: ${user.email}`,
          event: { k: 'userDeleted', p: { email: user.email } },
          meta: { bulk: action, role: user.role, org: user.org },
        })
        break
      }
    }

    applied += 1
  }

  const body: BulkUsersResponse = { applied, skipped }
  return ok(body)
})
