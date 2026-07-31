import { exec, queryOne, type RowDataPacket } from '../db';
import { newToken, sha256 } from './crypto';
import { packIp } from './session';

/** The reset screen promises "expires in 30 minutes" — that copy is the contract. */
export const RESET_TTL_MINUTES = 30;

export interface IssuedReset {
  token: string;
  expiresAt: Date;
}

/**
 * Issues a reset link. Any outstanding unused link for the account is burned
 * first, so the newest email is always the only one that works.
 */
export async function issueReset(userId: number, ip: string | null): Promise<IssuedReset> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000);

  await exec('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [userId]);
  await exec(
    'INSERT INTO password_resets (user_id, token_hash, expires_at, requested_ip) VALUES (?, ?, ?, ?)',
    [userId, sha256(token), expiresAt, packIp(ip)],
  );

  return { token, expiresAt };
}

export type ResetTokenState = 'valid' | 'expired' | 'used' | 'unknown';

export interface ResolvedReset {
  state: ResetTokenState;
  resetId?: number;
  userId?: number;
  email?: string;
  username?: string;
}

export async function resolveResetToken(token: string): Promise<ResolvedReset> {
  const row = await queryOne<
    RowDataPacket & {
      id: number;
      user_id: number;
      expires_at: Date;
      used_at: Date | null;
      email: string;
      username: string;
    }
  >(
    `SELECT r.id, r.user_id, r.expires_at, r.used_at, u.email, u.username
       FROM password_resets r
       JOIN users u ON u.id = r.user_id
      WHERE r.token_hash = ?`,
    [sha256(token)],
  );

  if (!row) return { state: 'unknown' };
  if (row.used_at) return { state: 'used' };
  if (row.expires_at.getTime() <= Date.now()) return { state: 'expired' };

  return {
    state: 'valid',
    resetId: row.id,
    userId: row.user_id,
    email: row.email,
    username: row.username,
  };
}

export async function markResetUsed(resetId: number): Promise<void> {
  await exec('UPDATE password_resets SET used_at = NOW() WHERE id = ? AND used_at IS NULL', [resetId]);
}
