import { ulid } from 'ulid';
import { exec, query, queryOne, transaction, type RowDataPacket } from './db';
import { collator } from './i18n';
import type { Lang, Permission, Role, UserStatus, UserV3 } from './types';
import { invitationForUser } from './auth/invitations';
import { permissionsForRole } from './auth/roles';

/**
 * The account the console must never let anyone delete or deactivate. The old
 * panel hard-coded `admin@netlog.com.tr`; the rule survives, but it is anchored
 * on the seeded username so a renamed address cannot orphan the tenant.
 */
export const PRIMARY_ADMIN_USERNAME = process.env.SEED_ADMIN_USERNAME ?? 'Admin';

const DB_TO_UI: Record<'invited' | 'active' | 'inactive' | 'suspended', UserStatus> = {
  invited: 'Invited',
  active: 'Active',
  inactive: 'Inactive',
  suspended: 'Inactive',
};

const UI_TO_DB: Record<UserStatus, 'invited' | 'active' | 'inactive'> = {
  Invited: 'invited',
  Active: 'active',
  Inactive: 'inactive',
};

interface UserListRow extends RowDataPacket {
  id: number;
  public_id: string;
  email: string;
  username: string;
  full_name: string;
  org: 'internal' | 'external';
  global_role: string;
  status: 'invited' | 'active' | 'inactive' | 'suspended';
  last_seen_at: Date | null;
  mfa_confirmed_at: Date | null;
}

const LIST_SELECT = `
  SELECT u.id, u.public_id, u.email, u.username, u.full_name, u.org,
         u.global_role, u.status, u.last_seen_at, tf.confirmed_at AS mfa_confirmed_at
    FROM users u
    LEFT JOIN two_factor tf ON tf.user_id = u.id
`;

export type UserSortKey = 'name' | 'email' | 'username' | 'role' | 'status';

export interface UserQuery {
  search?: string;
  role?: string;
  sort?: UserSortKey;
  direction?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  lang?: Lang;
}

export interface UserListResult {
  users: UserV3[];
  total: number;
  /** Total before search/role filtering — drives "no users at all" vs "no matches". */
  totalUnfiltered: number;
  page: number;
  pageSize: number;
  without2fa: number;
}

function toUser(row: UserListRow, siteRoles: Record<string, Role> = {}): UserV3 {
  return {
    id: row.public_id,
    name: row.full_name,
    email: row.email,
    username: row.username,
    role: row.global_role as Role,
    org: row.org,
    mfa: row.mfa_confirmed_at ? 'On' : 'Off',
    status: DB_TO_UI[row.status],
    lastSeen: row.last_seen_at ? row.last_seen_at.toISOString() : '',
    siteRoles,
  };
}

/**
 * Lists users with search, role filter, sorting and paging.
 *
 * Sorting is done in the application, not in SQL: MySQL's utf8mb4_0900_ai_ci
 * gets Turkish İ/ı wrong, and section 10 is explicit that the collation stays
 * out of the database. `Intl.Collator('tr')` is the only place that rule lives.
 * The row count here is small enough (an internal tenant) that reading the set
 * and slicing it in memory is honest; if it ever is not, the fix is a generated
 * sort-key column, not a collation change.
 */
export async function listUsers(opts: UserQuery = {}): Promise<UserListResult> {
  const rows = await query<UserListRow>(LIST_SELECT);

  const totalUnfiltered = rows.length;
  const without2fa = rows.filter((r) => !r.mfa_confirmed_at).length;

  const search = opts.search?.trim().toLocaleLowerCase(opts.lang === 'tr' ? 'tr' : 'en') ?? '';
  const filtered = rows.filter((row) => {
    if (opts.role && opts.role !== 'All' && row.global_role !== opts.role) return false;
    if (!search) return true;
    const haystack = `${row.full_name} ${row.email} ${row.username} ${row.global_role}`.toLocaleLowerCase(
      opts.lang === 'tr' ? 'tr' : 'en',
    );
    return haystack.includes(search);
  });

  const compare = collator(opts.lang ?? 'en');
  const key = opts.sort ?? 'name';
  const sign = opts.direction === 'desc' ? -1 : 1;

  filtered.sort((a, b) => {
    const pick = (row: UserListRow) =>
      key === 'email' ? row.email
      : key === 'username' ? row.username
      : key === 'role' ? row.global_role
      : key === 'status' ? row.status
      : row.full_name;
    return sign * compare.compare(pick(a), pick(b));
  });

  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 10));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(1, opts.page ?? 1), pageCount);
  const slice = filtered.slice((page - 1) * pageSize, page * pageSize);

  // Site roles and invitations are only loaded for the visible page — the list
  // shows a badge, not the full assignment set.
  const users = await Promise.all(
    slice.map(async (row) => {
      const user = toUser(row, await siteRolesFor(row.id));
      return row.status === 'invited' ? { ...user, invitation: await invitationForUser(row.id) } : user;
    }),
  );

  return { users, total: filtered.length, totalUnfiltered, page, pageSize, without2fa };
}

export async function siteRolesFor(userId: number): Promise<Record<string, Role>> {
  const rows = await query<RowDataPacket & { name: string; role: string }>(
    `SELECT s.name, a.role
       FROM assignments a
       JOIN sites s ON s.id = a.site_id
      WHERE a.user_id = ?`,
    [userId],
  );
  return Object.fromEntries(rows.map((r) => [r.name, r.role as Role]));
}

export interface UserDetail extends UserV3 {
  /** Widest permission set the account actually holds, global ∪ site roles. */
  effectivePermissions: Permission[];
  isPrimaryAdmin: boolean;
  createdAt: string;
  passwordSetAt: string | null;
  activeSessions: number;
}

export async function getUserDetail(publicId: string): Promise<UserDetail | null> {
  // Its own SELECT, not LIST_SELECT plus a WHERE: the detail view needs two
  // columns the list does not, and asserting them onto the list row type is how
  // `created_at.toISOString()` ends up called on undefined at runtime.
  const row = await queryOne<UserListRow & { created_at: Date; password_set_at: Date | null }>(
    `SELECT u.id, u.public_id, u.email, u.username, u.full_name, u.org,
            u.global_role, u.status, u.last_seen_at, u.created_at, u.password_set_at,
            tf.confirmed_at AS mfa_confirmed_at
       FROM users u
       LEFT JOIN two_factor tf ON tf.user_id = u.id
      WHERE u.public_id = ?`,
    [publicId],
  );
  if (!row) return null;

  const siteRoles = await siteRolesFor(row.id);
  const granted = new Set<Permission>();
  for (const name of new Set([row.global_role, ...Object.values(siteRoles)])) {
    for (const perm of await permissionsForRole(name)) granted.add(perm);
  }

  const sessions = await queryOne<RowDataPacket & { n: number }>(
    'SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > NOW()',
    [row.id],
  );

  return {
    ...toUser(row, siteRoles),
    invitation: row.status === 'invited' ? await invitationForUser(row.id) : null,
    effectivePermissions: [...granted],
    isPrimaryAdmin: row.username === PRIMARY_ADMIN_USERNAME,
    createdAt: row.created_at.toISOString(),
    passwordSetAt: row.password_set_at ? row.password_set_at.toISOString() : null,
    activeSessions: sessions?.n ?? 0,
  };
}

export async function findInternalId(publicId: string): Promise<number | null> {
  const row = await queryOne<RowDataPacket & { id: number }>('SELECT id FROM users WHERE public_id = ?', [
    publicId,
  ]);
  return row?.id ?? null;
}

/**
 * External accounts cap out at Viewer globally (section 08). Real access for a
 * 3PL partner arrives through site assignments, never through the global role —
 * so this clamp is applied on write, not merely hidden in the UI.
 */
export function clampRole(org: 'internal' | 'external', role: string): string {
  return org === 'external' && role !== 'Viewer' ? 'Viewer' : role;
}

export interface CreateUserInput {
  fullName: string;
  username: string;
  email: string;
  role: string;
  org: 'internal' | 'external';
  siteNames: string[];
}

/** Creates an invited account plus its site assignments in one transaction. */
export async function createInvitedUser(
  input: CreateUserInput,
  actorId: number,
): Promise<{ userId: number; publicId: string }> {
  const publicId = ulid();

  return transaction(async (cx) => {
    await cx.execute(
      `INSERT INTO users (public_id, email, username, full_name, org, global_role, status, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?, 'invited', 1)`,
      [publicId, input.email, input.username, input.fullName, input.org, clampRole(input.org, input.role)],
    );

    const [rows] = await cx.execute<Array<RowDataPacket & { id: number }>>(
      'SELECT id FROM users WHERE public_id = ?',
      [publicId],
    );
    const userId = rows[0].id;

    for (const siteName of input.siteNames) {
      const [siteRows] = await cx.execute<Array<RowDataPacket & { id: number }>>(
        'SELECT id FROM sites WHERE name = ?',
        [siteName],
      );
      if (!siteRows[0]) continue;
      await cx.execute(
        `INSERT INTO assignments (user_id, site_id, role, granted_by) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE role = VALUES(role), granted_by = VALUES(granted_by)`,
        [userId, siteRows[0].id, clampRole(input.org, input.role), actorId],
      );
    }

    return { userId, publicId };
  });
}

/** Replaces a user's site assignments wholesale. `null` role means no access. */
export async function setAssignments(
  userId: number,
  org: 'internal' | 'external',
  siteRoles: Record<string, string | null>,
  actorId: number,
): Promise<void> {
  await transaction(async (cx) => {
    for (const [siteName, role] of Object.entries(siteRoles)) {
      const [siteRows] = await cx.execute<Array<RowDataPacket & { id: number }>>(
        'SELECT id FROM sites WHERE name = ?',
        [siteName],
      );
      const siteId = siteRows[0]?.id;
      if (!siteId) continue;

      if (role === null) {
        await cx.execute('DELETE FROM assignments WHERE user_id = ? AND site_id = ?', [userId, siteId]);
        continue;
      }
      await cx.execute(
        `INSERT INTO assignments (user_id, site_id, role, granted_by) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE role = VALUES(role), granted_by = VALUES(granted_by), granted_at = NOW()`,
        [userId, siteId, clampRole(org, role), actorId],
      );
    }
  });
}

export async function updateUser(
  userId: number,
  patch: { fullName?: string; email?: string; username?: string; role?: string; status?: UserStatus },
  org: 'internal' | 'external',
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (patch.fullName !== undefined) {
    sets.push('full_name = ?');
    params.push(patch.fullName);
  }
  if (patch.email !== undefined) {
    sets.push('email = ?');
    params.push(patch.email.toLowerCase());
  }
  if (patch.username !== undefined) {
    sets.push('username = ?');
    params.push(patch.username);
  }
  if (patch.role !== undefined) {
    sets.push('global_role = ?');
    params.push(clampRole(org, patch.role));
  }
  if (patch.status !== undefined) {
    sets.push('status = ?');
    params.push(UI_TO_DB[patch.status]);
  }
  if (sets.length === 0) return;

  params.push(userId);
  await exec(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function deleteUser(userId: number): Promise<void> {
  // assignments, sessions, invitations, two_factor and recovery_codes all cascade.
  await exec('DELETE FROM users WHERE id = ?', [userId]);
}

export async function siteNames(): Promise<string[]> {
  const rows = await query<RowDataPacket & { name: string }>(
    "SELECT name FROM sites WHERE status <> 'archived' ORDER BY name",
  );
  return rows.map((r) => r.name);
}
