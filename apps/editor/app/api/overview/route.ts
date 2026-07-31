import { fail, handler, ok } from '@panel/lib/api';
import type { OverviewResponse } from '@panel/lib/api-contract';
import { requireSession } from '@panel/lib/auth/guard';
import { queryOne, type RowDataPacket } from '@panel/lib/db';
import { readHealth } from '@panel/lib/health';
import { listLogs, recentActors } from '@panel/lib/logs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/overview — one round trip for the whole landing tab.
 *
 * Health, counts, connected users and recent incidents in a single response:
 * four separate polls on a 4 s timer would be four times the wake-ups for a
 * screen that always shows all four together.
 */
export const GET = handler(async () => {
  const guard = await requireSession();
  if (!guard.ok) return fail('unauthenticated', 'err.sessionExpired');

  const counts = await queryOne<
    RowDataPacket & {
      users: number;
      active_users: number;
      without_2fa: number;
      sites: number;
      active_sites: number;
      signed_in: number;
      queued_jobs: number;
    }
  >(`
    SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM users WHERE status = 'active') AS active_users,
      (SELECT COUNT(*) FROM users u
         LEFT JOIN two_factor tf ON tf.user_id = u.id
        WHERE tf.confirmed_at IS NULL) AS without_2fa,
      (SELECT COUNT(*) FROM sites WHERE status <> 'archived') AS sites,
      (SELECT COUNT(*) FROM sites WHERE status = 'active') AS active_sites,
      (SELECT COUNT(DISTINCT user_id) FROM sessions
        WHERE revoked_at IS NULL AND expires_at > NOW()) AS signed_in,
      (SELECT COUNT(*) FROM jobs WHERE status IN ('queued','running')) AS queued_jobs
  `);

  // Incidents are the warn/error tail of diagnostics — the five most recent.
  const incidents = await listLogs({ view: 'diagnostics', level: 'All', limit: 20 });

  const body: OverviewResponse = {
    health: readHealth(),
    counts: {
      users: Number(counts?.users ?? 0),
      activeUsers: Number(counts?.active_users ?? 0),
      sites: Number(counts?.sites ?? 0),
      activeSites: Number(counts?.active_sites ?? 0),
      signedIn: Number(counts?.signed_in ?? 0),
      without2fa: Number(counts?.without_2fa ?? 0),
      queuedJobs: Number(counts?.queued_jobs ?? 0),
    },
    connected: await recentActors(20),
    incidents: incidents.entries.filter((e) => e.level !== 'info').slice(0, 5),
  };
  return ok(body);
});
