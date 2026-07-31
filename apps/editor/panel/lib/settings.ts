import { queryOne, exec, type RowDataPacket } from './db';
import type { OrgSettings } from './types';

interface SettingsRow extends RowDataPacket {
  session_minutes: number;
  keep_signed_in_allowed: number;
  keep_signed_in_days: number;
  trusted_device_days: number;
  concurrent_session_limit: number;
  mfa_required: number;
  sso_enforced_domains: string[] | string | null;
  external_users_allowed: number;
  invite_expiry_days: number;
  updated_by: number | null;
  updated_at: Date;
}

/** Defaults mirror the DDL, so a missing row degrades to the documented values. */
const FALLBACK: OrgSettings = {
  sessionMinutes: 20,
  keepSignedInAllowed: true,
  keepSignedInDays: 14,
  trustedDeviceDays: 30,
  concurrentSessionLimit: 3,
  mfaRequired: true,
  ssoEnforcedDomains: [],
  externalUsersAllowed: true,
  inviteExpiryDays: 7,
  updatedBy: null,
  updatedAt: new Date(0).toISOString(),
};

let cache: { value: OrgSettings; at: number } | null = null;
const TTL_MS = 5_000;

function parseDomains(raw: SettingsRow['sso_enforced_domains']): string[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Reads the single settings row. Enforcement lives on the server — session
 * length, invite expiry and the MFA requirement are all read from here, never
 * from anything the client sends.
 */
export async function getSettings(): Promise<OrgSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  const row = await queryOne<SettingsRow>('SELECT * FROM settings WHERE id = 1');
  const value: OrgSettings = row
    ? {
        sessionMinutes: row.session_minutes,
        keepSignedInAllowed: row.keep_signed_in_allowed === 1,
        keepSignedInDays: row.keep_signed_in_days,
        trustedDeviceDays: row.trusted_device_days,
        concurrentSessionLimit: row.concurrent_session_limit,
        mfaRequired: row.mfa_required === 1,
        ssoEnforcedDomains: parseDomains(row.sso_enforced_domains),
        externalUsersAllowed: row.external_users_allowed === 1,
        inviteExpiryDays: row.invite_expiry_days,
        updatedBy: row.updated_by ? String(row.updated_by) : null,
        updatedAt: row.updated_at.toISOString(),
      }
    : FALLBACK;

  cache = { value, at: Date.now() };
  return value;
}

export function invalidateSettingsCache(): void {
  cache = null;
}

/** True when the address falls under an SSO-enforced domain (password sign-in off). */
export async function isSsoEnforced(email: string): Promise<boolean> {
  const { ssoEnforcedDomains } = await getSettings();
  const lower = email.toLowerCase();
  return ssoEnforcedDomains.some((domain) => {
    const suffix = domain.startsWith('@') ? domain.toLowerCase() : `@${domain.toLowerCase()}`;
    return lower.endsWith(suffix);
  });
}

export async function touchSettingsUpdatedBy(userId: number): Promise<void> {
  await exec('UPDATE settings SET updated_by = ? WHERE id = 1', [userId]);
  invalidateSettingsCache();
}
