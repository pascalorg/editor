import { fail, handler, ok } from '@panel/lib/api';
import { resolveResetToken } from '@panel/lib/auth/reset';
import { resolveInvitationToken } from '@panel/lib/auth/invitations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/reset/:token — what the `#/reset/:token` and `#/welcome` screens
 * call before rendering, so an expired link shows its own state instead of a
 * form that will fail on submit.
 *
 * One token space, two sources: a reset link and an invite link both land here.
 * The response says which, because the invite variant renders the "Set up your
 * account" copy and the policy-consent checkbox.
 */
export const GET = handler(async (_request: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;

  const reset = await resolveResetToken(token);
  if (reset.state === 'valid') {
    return ok({ kind: 'reset' as const, email: reset.email, username: reset.username });
  }
  if (reset.state === 'expired') return fail('token_expired', 'err.tokenExpired');
  if (reset.state === 'used') return fail('token_invalid', 'err.tokenUsed');

  const invite = await resolveInvitationToken(token);
  if (!invite) return fail('token_invalid', 'err.tokenInvalid');
  if (invite.state === 'expired') return fail('invite_expired', 'err.inviteExpired');
  if (invite.state === 'revoked') return fail('invite_revoked', 'err.inviteRevoked');
  if (invite.state === 'accepted') return fail('token_invalid', 'err.tokenUsed');

  return ok({
    kind: 'invite' as const,
    email: invite.email,
    fullName: invite.fullName,
    expiresAt: invite.expiresAt.toISOString(),
  });
});
