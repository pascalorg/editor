import { fail, handler, ok } from '@panel/lib/api';
import type { InvitationResponse } from '@panel/lib/api-contract';
import { audit } from '@panel/lib/auth/audit';
import { requirePermission } from '@panel/lib/auth/guard';
import { revokeInvitation } from '@panel/lib/auth/invitations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/invitations/:id — revoke a pending invite.
 *
 * An already-accepted invite is not revocable: the account exists by then, and
 * deactivating it is a different action with a different audit meaning.
 */
export const DELETE = handler(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const guard = await requirePermission('edit_users');
  if (!guard.ok) {
    return guard.reason === 'forbidden'
      ? fail('forbidden', 'err.forbidden')
      : fail('unauthenticated', 'err.sessionExpired');
  }

  const { id } = await ctx.params;
  const invitation = await revokeInvitation(id);
  if (!invitation) return fail('not_found', 'err.inviteNotRevocable');

  await audit({
    actorUserId: guard.session.userId,
    actorLabel: guard.session.user.email,
    level: 'warn',
    kind: 'invite',
    message: 'Invitation revoked',
    event: { k: 'inviteRevoked' },
    meta: { invitation: id },
  });

  const body: InvitationResponse = { invitation };
  return ok(body);
});
