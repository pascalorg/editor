import { exec, queryOne, type RowDataPacket } from '../db';

/**
 * Failed-attempt policy. The prototype locks for 30 s after 3 misses and shows a
 * countdown on the button; the panel report (Y2) asks for a wider window before
 * a longer lock. Both are honoured: a short lock at 3, a long one at 10.
 */
export const SOFT_LOCK_AFTER = 3;
export const SOFT_LOCK_SECONDS = 30;
export const HARD_LOCK_AFTER = 10;
export const HARD_LOCK_SECONDS = 15 * 60;

export interface LockState {
  locked: boolean;
  /** Whole seconds until sign-in reopens; 0 when not locked. */
  retryAfterSeconds: number;
  failedAttempts: number;
  /** Misses left before the next lock kicks in. */
  attemptsLeft: number;
}

export function lockStateFrom(failedAttempts: number, lockedUntil: Date | null): LockState {
  const now = Date.now();
  const locked = lockedUntil !== null && lockedUntil.getTime() > now;
  const threshold = failedAttempts >= HARD_LOCK_AFTER ? HARD_LOCK_AFTER : SOFT_LOCK_AFTER;

  return {
    locked,
    retryAfterSeconds: locked ? Math.ceil((lockedUntil!.getTime() - now) / 1000) : 0,
    failedAttempts,
    attemptsLeft: Math.max(0, threshold - failedAttempts),
  };
}

export async function readLockState(userId: number): Promise<LockState> {
  const row = await queryOne<RowDataPacket & { failed_attempts: number; locked_until: Date | null }>(
    'SELECT failed_attempts, locked_until FROM users WHERE id = ?',
    [userId],
  );
  return lockStateFrom(row?.failed_attempts ?? 0, row?.locked_until ?? null);
}

/** Records a miss and applies the lock once a threshold is crossed. */
export async function registerFailure(userId: number): Promise<LockState> {
  await exec('UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id = ?', [userId]);

  const row = await queryOne<RowDataPacket & { failed_attempts: number; locked_until: Date | null }>(
    'SELECT failed_attempts, locked_until FROM users WHERE id = ?',
    [userId],
  );
  const attempts = row?.failed_attempts ?? 1;

  // Re-lock on every miss past a threshold, so hammering a locked account keeps
  // pushing the window out instead of waiting it down.
  const seconds =
    attempts >= HARD_LOCK_AFTER ? HARD_LOCK_SECONDS
    : attempts >= SOFT_LOCK_AFTER ? SOFT_LOCK_SECONDS
    : 0;

  if (seconds > 0) {
    await exec('UPDATE users SET locked_until = DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE id = ?', [
      seconds,
      userId,
    ]);
    return lockStateFrom(attempts, new Date(Date.now() + seconds * 1000));
  }

  return lockStateFrom(attempts, row?.locked_until ?? null);
}

export async function clearFailures(userId: number): Promise<void> {
  await exec(
    'UPDATE users SET failed_attempts = 0, locked_until = NULL, last_seen_at = NOW() WHERE id = ?',
    [userId],
  );
}
