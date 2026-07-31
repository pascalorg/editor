import { getSession, type ActiveSession } from './session';
import type { Permission } from '../types';

export type GuardFailure = 'unauthenticated' | 'mfa_required' | 'forbidden';

export type GuardResult =
  | { ok: true; session: ActiveSession }
  | { ok: false; reason: GuardFailure };

/**
 * Server-side permission gate. Section 08's rule, restated: the console only
 * edits, the server enforces. Client-side permission checks exist to hide UI —
 * they are never the thing that stops a request.
 *
 * An mfaPending session is treated as not-signed-in for every purpose except the
 * MFA endpoints themselves, which read the session directly.
 */
export async function requirePermission(...required: Permission[]): Promise<GuardResult> {
  const session = await getSession();
  if (!session) return { ok: false, reason: 'unauthenticated' };
  if (session.mfaPending) return { ok: false, reason: 'mfa_required' };

  const granted = new Set(session.user.permissions);
  if (required.every((perm) => granted.has(perm))) return { ok: true, session };

  return { ok: false, reason: 'forbidden' };
}

/** Signed-in, MFA cleared, no particular permission needed. */
export async function requireSession(): Promise<GuardResult> {
  return requirePermission();
}
