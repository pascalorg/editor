import { Secret, TOTP } from 'otpauth';
import QRCode from 'qrcode';
import { exec, query, queryOne, transaction, type RowDataPacket } from '../db';
import { decryptSecret, encryptSecret, safeEqual, sha256 } from './crypto';

const ISSUER = 'DigitalTwin';
const RECOVERY_CODE_COUNT = 8;

function totpFor(secretBase32: string, label: string): TOTP {
  return new TOTP({
    issuer: ISSUER,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  });
}

/** Groups the base32 secret into 4-char blocks, matching the prototype's key. */
function groupKey(base32: string): string {
  return (base32.match(/.{1,4}/g) ?? []).join(' ');
}

export interface EnrolmentStart {
  qrDataUrl: string;
  manualKey: string;
}

/**
 * Starts (or restarts) enrolment: writes an unconfirmed secret and returns the
 * QR plus the manual key. Re-running before confirmation replaces the secret, so
 * a half-finished setup can never leave a stale one behind.
 */
export async function startEnrolment(userId: number, accountLabel: string): Promise<EnrolmentStart> {
  const secret = new Secret({ size: 20 }).base32;

  await exec(
    `INSERT INTO two_factor (user_id, totp_secret, confirmed_at)
     VALUES (?, ?, NULL)
     ON DUPLICATE KEY UPDATE totp_secret = VALUES(totp_secret), confirmed_at = NULL`,
    [userId, encryptSecret(secret)],
  );

  const uri = totpFor(secret, accountLabel).toString();
  return {
    qrDataUrl: await QRCode.toDataURL(uri, { margin: 0, width: 236, errorCorrectionLevel: 'M' }),
    manualKey: groupKey(secret),
  };
}

interface TwoFactorRow extends RowDataPacket {
  totp_secret: Buffer;
  confirmed_at: Date | null;
}

async function loadSecret(userId: number): Promise<{ secret: string; confirmed: boolean } | null> {
  const row = await queryOne<TwoFactorRow>('SELECT totp_secret, confirmed_at FROM two_factor WHERE user_id = ?', [
    userId,
  ]);
  if (!row) return null;
  try {
    return { secret: decryptSecret(row.totp_secret), confirmed: row.confirmed_at !== null };
  } catch {
    // Undecryptable secret (rotated key, corrupt row) reads as "not enrolled"
    // rather than locking the account out with a 500 on every sign-in.
    return null;
  }
}

export async function isEnrolled(userId: number): Promise<boolean> {
  return (await loadSecret(userId))?.confirmed ?? false;
}

/**
 * Validates a 6-digit code. `window: 1` accepts the neighbouring 30 s steps,
 * which covers ordinary clock drift without widening the guess space much.
 */
export async function verifyTotp(userId: number, accountLabel: string, code: string): Promise<boolean> {
  const entry = await loadSecret(userId);
  if (!entry) return false;
  return totpFor(entry.secret, accountLabel).validate({ token: code, window: 1 }) !== null;
}

/** Confirms enrolment and issues a fresh recovery set, replacing any old codes. */
export async function confirmEnrolment(
  userId: number,
  accountLabel: string,
  code: string,
): Promise<string[] | null> {
  const entry = await loadSecret(userId);
  if (!entry) return null;
  if (totpFor(entry.secret, accountLabel).validate({ token: code, window: 1 }) === null) return null;

  const codes = generateRecoveryCodes();

  await transaction(async (cx) => {
    await cx.execute('UPDATE two_factor SET confirmed_at = NOW() WHERE user_id = ?', [userId]);
    await cx.execute('DELETE FROM recovery_codes WHERE user_id = ?', [userId]);
    for (const plain of codes) {
      await cx.execute('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)', [
        userId,
        sha256(normaliseRecoveryCode(plain)),
      ]);
    }
  });

  return codes;
}

/** XXXX-XXXX, the format the recovery screen validates and the .txt export lists. */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1
  const out: string[] = [];
  const buf = new Uint8Array(8);

  while (out.length < count) {
    crypto.getRandomValues(buf);
    const chars = Array.from(buf, (b) => alphabet[b % alphabet.length]);
    const code = `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

export function normaliseRecoveryCode(input: string): string {
  return input.trim().toUpperCase();
}

/**
 * Spends a recovery code. Marks it used inside a transaction so two concurrent
 * requests cannot both consume the same one.
 */
export async function consumeRecoveryCode(userId: number, input: string): Promise<{ ok: boolean; remaining: number }> {
  const target = sha256(normaliseRecoveryCode(input));

  return transaction(async (cx) => {
    const [rows] = await cx.execute<Array<RowDataPacket & { id: number; code_hash: Buffer }>>(
      'SELECT id, code_hash FROM recovery_codes WHERE user_id = ? AND used_at IS NULL FOR UPDATE',
      [userId],
    );

    const match = rows.find((row) => safeEqual(row.code_hash, target));
    if (match) await cx.execute('UPDATE recovery_codes SET used_at = NOW() WHERE id = ?', [match.id]);

    return { ok: Boolean(match), remaining: rows.length - (match ? 1 : 0) };
  });
}

export async function countUnusedRecoveryCodes(userId: number): Promise<number> {
  const row = await queryOne<RowDataPacket & { n: number }>(
    'SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL',
    [userId],
  );
  return row?.n ?? 0;
}

export async function disableTwoFactor(userId: number): Promise<void> {
  await transaction(async (cx) => {
    await cx.execute('DELETE FROM two_factor WHERE user_id = ?', [userId]);
    await cx.execute('DELETE FROM recovery_codes WHERE user_id = ?', [userId]);
  });
}

export async function hasAnyRecoveryCodes(userId: number): Promise<boolean> {
  const rows = await query<RowDataPacket & { id: number }>(
    'SELECT id FROM recovery_codes WHERE user_id = ? AND used_at IS NULL LIMIT 1',
    [userId],
  );
  return rows.length > 0;
}
