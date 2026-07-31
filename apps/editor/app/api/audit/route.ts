import { fail, handler, ok } from '@panel/lib/api';
import { requirePermission } from '@panel/lib/auth/guard';
import { auditKinds, listLogs } from '@panel/lib/logs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/audit — the append-only change trail.
 *
 * There is no DELETE here and there never should be: the whole value of the
 * trail is that no console action can remove an entry from it.
 */
export const GET = handler(async (request: Request) => {
  const guard = await requirePermission('view_logs');
  if (!guard.ok) {
    return guard.reason === 'forbidden'
      ? fail('forbidden', 'err.logsRestricted')
      : fail('unauthenticated', 'err.sessionExpired');
  }

  const params = new URL(request.url).searchParams;
  const page = await listLogs({
    view: 'audit',
    search: params.get('search') ?? undefined,
    kind: params.get('kind') ?? undefined,
    cursor: params.get('cursor') ?? undefined,
    limit: Number(params.get('limit') ?? 50) || 50,
  });

  return ok({ ...page, kinds: await auditKinds() });
});
