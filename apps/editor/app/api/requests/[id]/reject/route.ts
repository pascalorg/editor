import { fail, handler, ok } from '@panel/lib/api';
import { audit } from '@panel/lib/auth/audit';
import { requirePermission } from '@panel/lib/auth/guard';
import { exec, queryOne, type RowDataPacket } from '@panel/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/requests/:id/reject
 *
 * The row is kept, not deleted: the unique index only constrains *pending*
 * rows, so a rejected applicant can ask again while the decision stays on record.
 */
export const POST = handler(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const guard = await requirePermission('edit_users');
  if (!guard.ok) {
    return guard.reason === 'forbidden' ? fail('forbidden', 'err.forbidden') : fail('unauthenticated', 'err.sessionExpired');
  }

  const { id } = await ctx.params;
  const row = await queryOne<RowDataPacket & { id: number; email: string; status: string }>(
    'SELECT id, email, status FROM access_requests WHERE public_id = ?',
    [id],
  );
  if (!row) return fail('not_found', 'err.notFound');
  if (row.status !== 'pending') return fail('conflict', 'err.requestDecided');

  await exec(
    "UPDATE access_requests SET status = 'rejected', decided_by = ?, decided_at = NOW() WHERE id = ?",
    [guard.session.userId, row.id],
  );

  await audit({
    actorUserId: guard.session.userId,
    actorLabel: guard.session.user.email,
    level: 'warn',
    kind: 'request',
    message: `Access request rejected: ${row.email}`,
    event: { k: 'requestRejected', p: { email: row.email } },
  });

  return ok({ rejected: true });
});
