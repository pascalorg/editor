import { fail, handler, ok } from '@panel/lib/api';
import type { TouchResponse } from '@panel/lib/api-contract';
import { getSession } from '@panel/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/session/touch — the idle dialog's "Stay signed in".
 *
 * Deliberately a separate endpoint from the polling GET: mouse movement must not
 * extend the session while the warning is open (WP4), so only this explicit,
 * user-initiated call slides the window.
 */
export const POST = handler(async () => {
  const session = await getSession({ touch: true });
  if (!session) return fail('unauthenticated', 'err.sessionExpired');

  const body: TouchResponse = {
    expiresInSeconds: Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)),
  };
  return ok(body);
});
