import { fail, handler, ok, parseBody } from '@panel/lib/api'
import { type ResetConfirmResponse, resetConfirmSchema } from '@panel/lib/api-contract'
import { audit } from '@panel/lib/auth/audit'
import { markInvitationAccepted, resolveInvitationToken } from '@panel/lib/auth/invitations'
import { clearFailures } from '@panel/lib/auth/lockout'
import { checkPasswordPolicy, hashPassword } from '@panel/lib/auth/password'
import { markResetUsed, resolveResetToken } from '@panel/lib/auth/reset'
import { createSession, revokeAllSessions } from '@panel/lib/auth/session'
import { isEnrolled } from '@panel/lib/auth/totp'
import { findUserById } from '@panel/lib/auth/users'
import { exec } from '@panel/lib/db'
import { getSettings } from '@panel/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/reset/confirm — the shared submit for `#/reset/:token` and
 * `#/welcome`. Which mode it runs in is decided by the token, not by the client:
 *
 *   reset token  -> set password, revoke sessions, land back on sign-in
 *   invite token -> set password, accept the invite, open a session, and route
 *                   on to MFA enrolment if the org requires it
 *
 * The five policy rules are re-checked here. The client's meter is a courtesy;
 * this is the check that counts.
 */
export const POST = handler(async (request: Request) => {
  const parsed = await parseBody(request, resetConfirmSchema)
  if (!parsed.ok) return parsed.response

  const { token, password, revokeOtherSessions, acceptPolicy } = parsed.data

  const reset = await resolveResetToken(token)
  if (reset.state === 'expired') return fail('token_expired', 'err.tokenExpired')
  if (reset.state === 'used') return fail('token_invalid', 'err.tokenUsed')

  const invite = reset.state === 'valid' ? null : await resolveInvitationToken(token)
  if (reset.state !== 'valid') {
    if (!invite) return fail('token_invalid', 'err.tokenInvalid')
    if (invite.state === 'expired') return fail('invite_expired', 'err.inviteExpired')
    if (invite.state === 'revoked') return fail('invite_revoked', 'err.inviteRevoked')
    if (invite.state === 'accepted') return fail('token_invalid', 'err.tokenUsed')
  }

  const isInvite = invite !== null
  const userId = isInvite ? invite.userId : reset.userId!

  const user = await findUserById(userId)
  if (!user) return fail('token_invalid', 'err.tokenInvalid')

  // The policy-consent checkbox only exists on the first sign-in variant, and it
  // is a hard gate there — the screen disables the button, and so does this.
  if (isInvite && !acceptPolicy)
    return fail('validation', 'err.policyRequired', { field: 'acceptPolicy' })

  const policy = checkPasswordPolicy(password, user.username || user.email)
  if (!policy.ok) return fail('password_policy', 'err.passwordPolicy', { policy })

  const hash = await hashPassword(password)
  await exec(
    `UPDATE users
        SET password_hash = ?, password_set_at = NOW(), must_change_password = 0,
            status = CASE WHEN status = 'invited' THEN 'active' ELSE status END
      WHERE id = ?`,
    [hash, userId],
  )
  await clearFailures(userId)

  if (isInvite) await markInvitationAccepted(invite.invitationId)
  else await markResetUsed(reset.resetId!)

  // Revoke first, then open the new session, so "sign out all other sessions"
  // never takes the session this request is about to create with it.
  const revokedSessions = revokeOtherSessions ? await revokeAllSessions(userId, null) : 0

  await audit({
    actorUserId: userId,
    actorLabel: user.email,
    level: 'info',
    kind: 'auth',
    message: isInvite ? 'Invite accepted — password set' : 'Password changed',
    event: { k: isInvite ? 'inviteAccepted' : 'passwordChanged' },
    meta: { revokedSessions },
  })

  if (!isInvite) {
    // A reset ends on the sign-in screen: proving control of the inbox is not
    // the same as signing in, and the OTP step still has to happen.
    const body: ResetConfirmResponse = { state: 'anonymous', next: 'signin', revokedSessions }
    return ok(body)
  }

  const settings = await getSettings()
  const enrolled = await isEnrolled(userId)
  const mfaOwed = settings.mfaRequired && !enrolled

  await createSession({ userId, keepSignedIn: false, mfaPending: mfaOwed })

  const body: ResetConfirmResponse = {
    state: mfaOwed ? 'mfaRequired' : 'signedIn',
    next: mfaOwed ? 'mfa-setup' : 'console',
    revokedSessions,
  }
  return ok(body)
})
