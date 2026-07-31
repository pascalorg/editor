import { fail, handler, ok } from '@panel/lib/api';
import { audit } from '@panel/lib/auth/audit';
import { requirePermission } from '@panel/lib/auth/guard';
import { revokeKey } from '@panel/lib/integrations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** DELETE /api/keys/:id — revokes in place; the row stays for the audit story. */
export const DELETE = handler(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const guard = await requirePermission('admin_access');
  if (!guard.ok) {
    return guard.reason === 'forbidden' ? fail('forbidden', 'err.forbidden') : fail('unauthenticated', 'err.sessionExpired');
  }

  const { id } = await ctx.params;
  const key = await revokeKey(id);
  if (!key) return fail('conflict', 'err.keyNotRevocable');

  await audit({
    actorUserId: guard.session.userId,
    actorLabel: guard.session.user.email,
    level: 'warn',
    kind: 'api_key',
    message: `API key revoked: ${key.name} (${key.prefix}…)`,
    event: { k: 'apiKeyRevoked', p: { name: key.name, prefix: key.prefix } },
  });

  return ok({ key });
});
