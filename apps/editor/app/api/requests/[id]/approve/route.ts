import { fail, handler, ok, parseBody } from '@panel/lib/api'
import { type ApproveRequestResponse, approveRequestSchema } from '@panel/lib/api-contract'
import { audit } from '@panel/lib/auth/audit'
import { requirePermission } from '@panel/lib/auth/guard'
import { issueInvitation } from '@panel/lib/auth/invitations'
import { exec, queryOne, type RowDataPacket } from '@panel/lib/db'
import { deliverInvite } from '@panel/lib/mail'
import { getSettings } from '@panel/lib/settings'
import { createInvitedUser, getUserDetail } from '@panel/lib/users'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/requests/:id/approve — the "Approve & assign" dialog.
 *
 * Approval never adds an account silently: it asks for a role and at least one
 * site, then creates the user as `invited` and emails the link. The schema
 * enforces the "at least one site" rule so a mis-wired client cannot create an
 * account with no access at all.
 */
export const POST = handler(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const guard = await requirePermission('edit_users')
  if (!guard.ok) {
    return guard.reason === 'forbidden'
      ? fail('forbidden', 'err.forbidden')
      : fail('unauthenticated', 'err.sessionExpired')
  }

  const parsed = await parseBody(request, approveRequestSchema)
  if (!parsed.ok) return parsed.response

  const { id } = await ctx.params
  const row = await queryOne<
    RowDataPacket & {
      id: number
      full_name: string
      email: string
      username: string
      status: string
    }
  >('SELECT id, full_name, email, username, status FROM access_requests WHERE public_id = ?', [id])

  if (!row) return fail('not_found', 'err.notFound')
  if (row.status !== 'pending') return fail('conflict', 'err.requestDecided')

  const settings = await getSettings()
  if (parsed.data.org === 'external' && !settings.externalUsersAllowed) {
    return fail('forbidden', 'err.externalNotAllowed')
  }

  const clash = await queryOne<RowDataPacket & { id: number }>(
    'SELECT id FROM users WHERE email = ? OR username = ? LIMIT 1',
    [row.email, row.username],
  )
  if (clash) return fail('conflict', 'err.userExists')

  const created = await createInvitedUser(
    {
      fullName: row.full_name,
      username: row.username,
      email: row.email,
      role: parsed.data.role,
      org: parsed.data.org,
      siteNames: parsed.data.siteNames,
    },
    guard.session.userId,
  )

  const issued = await issueInvitation(created.userId, guard.session.userId)
  // The account is created and the invitation issued either way — those must
  // not roll back because a mail server is unreachable. But an invitation
  // nobody receives is an account nobody can activate, so whether it was
  // delivered travels back to the administrator who pressed Approve.
  const mailDelivered = await deliverInvite({
    email: row.email,
    fullName: row.full_name,
    token: issued.token,
    expiresAt: issued.invitation.expiresAt,
  })

  await exec(
    "UPDATE access_requests SET status = 'approved', decided_by = ?, decided_at = NOW() WHERE id = ?",
    [guard.session.userId, row.id],
  )

  await audit({
    actorUserId: guard.session.userId,
    actorLabel: guard.session.user.email,
    level: 'info',
    kind: 'request',
    message: `Access request approved: ${row.email} as ${parsed.data.role}`,
    event: { k: 'requestApproved', p: { email: row.email, role: parsed.data.role } },
    meta: { sites: parsed.data.siteNames, org: parsed.data.org },
  })

  const user = await getUserDetail(created.publicId)
  if (!user) return fail('server_error', 'err.server')

  if (!mailDelivered) {
    await audit({
      actorUserId: guard.session.userId,
      actorLabel: guard.session.user.email,
      level: 'error',
      kind: 'request',
      message: `Invitation email to ${row.email} was not delivered; the account exists and the invitation is valid`,
      event: { k: 'requestApproved' as const, p: { email: row.email, role: parsed.data.role } },
    })
  }

  const body: ApproveRequestResponse = { user, invitation: issued.invitation, mailDelivered }
  return ok(body, { status: 201 })
})
