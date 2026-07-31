import { fail, handler, ok } from '@panel/lib/api';
import { audit } from '@panel/lib/auth/audit';
import { requirePermission } from '@panel/lib/auth/guard';
import { cancelJob } from '@panel/lib/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/jobs/:id/cancel — only a queued or running job can be cancelled. */
export const POST = handler(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const guard = await requirePermission('admin_access');
  if (!guard.ok) {
    return guard.reason === 'forbidden' ? fail('forbidden', 'err.forbidden') : fail('unauthenticated', 'err.sessionExpired');
  }

  const { id } = await ctx.params;
  const job = await cancelJob(id);
  if (!job) return fail('conflict', 'err.jobNotCancellable');

  await audit({
    actorUserId: guard.session.userId,
    actorLabel: guard.session.user.email,
    level: 'warn',
    kind: 'job',
    message: `Job cancelled: ${id} (${job.kind})`,
    event: { k: 'jobCancelled', p: { id, kind: job.kind } },
  });

  return ok({ job });
});
