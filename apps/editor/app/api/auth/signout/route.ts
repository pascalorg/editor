import { handler, ok, parseBody } from '@panel/lib/api';
import { signOutSchema, type SignOutResponse } from '@panel/lib/api-contract';
import { audit } from '@panel/lib/auth/audit';
import { clearSessionCookie, getSession, revokeAllSessions, revokeSession } from '@panel/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/signout
 *
 * Always answers 200, even without a session — signing out of nothing is not an
 * error, and a 401 here would make the sign-out button look broken after the
 * idle timeout has already fired.
 */
export const POST = handler(async (request: Request) => {
  const parsed = await parseBody(request, signOutSchema);
  if (!parsed.ok) return parsed.response;

  const session = await getSession({ touch: false });
  await clearSessionCookie();

  if (!session) return ok<SignOutResponse>({ revoked: 0 });

  let revoked = 1;
  await revokeSession(session.id);
  if (parsed.data.allDevices) revoked += await revokeAllSessions(session.userId, session.id);

  await audit({
    actorUserId: session.userId,
    actorLabel: session.user.email,
    level: 'info',
    kind: 'auth',
    message: parsed.data.allDevices ? 'Signed out of all devices' : 'Signed out',
    event: { k: parsed.data.allDevices ? 'signedOutAll' : 'signedOut' },
    meta: { revoked },
  });

  return ok<SignOutResponse>({ revoked });
});
