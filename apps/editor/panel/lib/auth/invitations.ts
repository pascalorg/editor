import { ulid } from 'ulid';
import { exec, query, queryOne, transaction, type RowDataPacket } from '../db';
import { getSettings } from '../settings';
import type { Invitation } from '../types';
import { newToken, sha256 } from './crypto';

interface InvitationRow extends RowDataPacket {
  id: number;
  public_id: string;
  user_id: number;
  user_public_id: string;
  invited_by_email: string;
  expires_at: Date;
  resent_count: number;
  accepted_at: Date | null;
  revoked_at: Date | null;
}

const SELECT = `
  SELECT i.id, i.public_id, i.user_id, u.public_id AS user_public_id,
         b.email AS invited_by_email, i.expires_at, i.resent_count,
         i.accepted_at, i.revoked_at
    FROM invitations i
    JOIN users u ON u.id = i.user_id
    JOIN users b ON b.id = i.invited_by
`;

/**
 * Derived state, never stored. `expired` is a function of the clock, so keeping
 * a column for it would need a cron job to stay honest.
 */
function stateOf(row: InvitationRow): Invitation['state'] {
  if (row.revoked_at) return 'revoked';
  if (row.accepted_at) return 'accepted';
  return row.expires_at.getTime() <= Date.now() ? 'expired' : 'pending';
}

function toInvitation(row: InvitationRow): Invitation {
  return {
    id: row.public_id,
    userId: row.user_public_id,
    invitedBy: row.invited_by_email,
    expiresAt: row.expires_at.toISOString(),
    resentCount: row.resent_count,
    acceptedAt: row.accepted_at ? row.accepted_at.toISOString() : null,
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
    state: stateOf(row),
  };
}

export interface IssuedInvitation {
  invitation: Invitation;
  /** Raw token — belongs in the invite email and nowhere else. */
  token: string;
}

/**
 * Issues an invite. Any earlier live invite for the same user is revoked first,
 * so exactly one token can ever open an account.
 */
export async function issueInvitation(userId: number, invitedBy: number): Promise<IssuedInvitation> {
  const { inviteExpiryDays } = await getSettings();
  const token = newToken();
  const publicId = ulid();

  await transaction(async (cx) => {
    await cx.execute(
      'UPDATE invitations SET revoked_at = NOW() WHERE user_id = ? AND accepted_at IS NULL AND revoked_at IS NULL',
      [userId],
    );
    await cx.execute(
      `INSERT INTO invitations (public_id, user_id, token_hash, invited_by, expires_at)
       VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))`,
      [publicId, userId, sha256(token), invitedBy, inviteExpiryDays],
    );
  });

  const row = await queryOne<InvitationRow>(`${SELECT} WHERE i.public_id = ?`, [publicId]);
  if (!row) throw new Error('invitation insert did not round-trip');
  return { invitation: toInvitation(row), token };
}

/**
 * Renews an invite: new token, resent_count + 1, expiry pushed out from now.
 * A revoked or already-accepted invite is not renewable — issue a new one.
 */
export async function resendInvitation(publicId: string): Promise<IssuedInvitation | null> {
  const row = await queryOne<InvitationRow>(`${SELECT} WHERE i.public_id = ?`, [publicId]);
  if (!row || row.accepted_at || row.revoked_at) return null;

  const { inviteExpiryDays } = await getSettings();
  const token = newToken();

  await exec(
    `UPDATE invitations
        SET token_hash = ?, resent_count = resent_count + 1,
            expires_at = DATE_ADD(NOW(), INTERVAL ? DAY)
      WHERE id = ?`,
    [sha256(token), inviteExpiryDays, row.id],
  );

  const fresh = await queryOne<InvitationRow>(`${SELECT} WHERE i.id = ?`, [row.id]);
  return fresh ? { invitation: toInvitation(fresh), token } : null;
}

export async function revokeInvitation(publicId: string): Promise<Invitation | null> {
  const row = await queryOne<InvitationRow>(`${SELECT} WHERE i.public_id = ?`, [publicId]);
  if (!row || row.accepted_at) return null;

  await exec('UPDATE invitations SET revoked_at = NOW() WHERE id = ? AND revoked_at IS NULL', [row.id]);
  const fresh = await queryOne<InvitationRow>(`${SELECT} WHERE i.id = ?`, [row.id]);
  return fresh ? toInvitation(fresh) : null;
}

export interface ResolvedInvitation {
  invitationId: number;
  userId: number;
  fullName: string;
  email: string;
  expiresAt: Date;
  state: Invitation['state'];
}

/** Looks an invite up by its raw token. Expiry is enforced here, at sign-in. */
export async function resolveInvitationToken(token: string): Promise<ResolvedInvitation | null> {
  const row = await queryOne<InvitationRow & { full_name: string; email: string }>(
    `SELECT i.id, i.public_id, i.user_id, u.public_id AS user_public_id,
            b.email AS invited_by_email, i.expires_at, i.resent_count,
            i.accepted_at, i.revoked_at, u.full_name, u.email
       FROM invitations i
       JOIN users u ON u.id = i.user_id
       JOIN users b ON b.id = i.invited_by
      WHERE i.token_hash = ?`,
    [sha256(token)],
  );
  if (!row) return null;

  return {
    invitationId: row.id,
    userId: row.user_id,
    fullName: row.full_name,
    email: row.email,
    expiresAt: row.expires_at,
    state: stateOf(row),
  };
}

export async function markInvitationAccepted(invitationId: number): Promise<void> {
  await exec('UPDATE invitations SET accepted_at = NOW() WHERE id = ? AND accepted_at IS NULL', [invitationId]);
}

export async function invitationForUser(userId: number): Promise<Invitation | null> {
  const rows = await query<InvitationRow>(`${SELECT} WHERE i.user_id = ? ORDER BY i.created_at DESC LIMIT 1`, [
    userId,
  ]);
  return rows[0] ? toInvitation(rows[0]) : null;
}

/** Whole days left, floored at 0 — the "N days left" badge in the list and drawer. */
export function daysLeft(expiresAt: string): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000));
}
