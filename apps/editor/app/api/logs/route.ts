import { fail, handler, ok } from '@panel/lib/api';
import { audit } from '@panel/lib/auth/audit';
import { requirePermission } from '@panel/lib/auth/guard';
import { clearDiagnostics, listLogs, type LogLevel, type LogRange } from '@panel/lib/logs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RANGES: LogRange[] = ['hour', 'today', 'week', 'all'];
const LEVELS = ['info', 'warn', 'error'];

/** GET /api/logs — runtime diagnostics, cursor-paginated. */
export const GET = handler(async (request: Request) => {
  const guard = await requirePermission('view_logs');
  if (!guard.ok) {
    return guard.reason === 'forbidden'
      ? fail('forbidden', 'err.logsRestricted')
      : fail('unauthenticated', 'err.sessionExpired');
  }

  const params = new URL(request.url).searchParams;
  const level = params.get('level');
  const range = params.get('range');

  const page = await listLogs({
    view: 'diagnostics',
    search: params.get('search') ?? undefined,
    level: level && LEVELS.includes(level) ? (level as LogLevel) : 'All',
    actor: params.get('actor') ?? undefined,
    range: range && RANGES.includes(range as LogRange) ? (range as LogRange) : 'all',
    cursor: params.get('cursor') ?? undefined,
    limit: Number(params.get('limit') ?? 50) || 50,
  });

  return ok({ ...page, canClear: guard.session.user.permissions.includes('edit_users') });
});

/**
 * DELETE /api/logs — clears info-level diagnostics.
 *
 * Requires both view_logs and edit_users, as the old panel did. The clear is
 * itself recorded, with the row count, so the gap in the log has an explanation
 * sitting next to it.
 */
export const DELETE = handler(async () => {
  const guard = await requirePermission('view_logs', 'edit_users');
  if (!guard.ok) {
    return guard.reason === 'forbidden'
      ? fail('forbidden', 'err.forbidden')
      : fail('unauthenticated', 'err.sessionExpired');
  }

  const removed = await clearDiagnostics();
  await audit({
    actorUserId: guard.session.userId,
    actorLabel: guard.session.user.email,
    level: 'warn',
    kind: 'settings',
    message: `Diagnostics cleared — ${removed} info-level entries removed (warnings, errors and change records kept)`,
    event: { k: 'diagnosticsCleared', p: { removed } },
  });

  return ok({ removed });
});
