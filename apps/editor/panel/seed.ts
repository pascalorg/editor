/**
 * Seeds the acceptance baseline named in the handover order, step 1:
 * "1 admin, 3 sites, the single settings row" — plus the three system roles,
 * which the Roles tab reads and which no other step creates.
 *
 *   node --experimental-strip-types scripts/seed.ts
 *   node --experimental-strip-types scripts/seed.ts --dev   # + the two supervisors
 *
 * Idempotent: every insert is guarded, so re-running never duplicates a row.
 */
import mysql from 'mysql2/promise';
import { ulid } from 'ulid';
import { hash as argon2Hash } from '@node-rs/argon2';
import { loadEnv } from './env';

const ARGON2ID = 2;
const ARGON2_OPTS = { algorithm: ARGON2ID, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

const PERMISSIONS = [
  'admin_access',
  'edit_projects',
  'create_projects',
  'delete_projects',
  'access_settings',
  'view_projects',
  'edit_users',
  'edit_roles',
  'view_logs',
] as const;

const SYSTEM_ROLES: Array<{ name: string; permissions: string[] }> = [
  { name: 'Admin', permissions: [...PERMISSIONS] },
  {
    name: 'Editor',
    permissions: ['edit_projects', 'create_projects', 'delete_projects', 'access_settings', 'view_projects'],
  },
  { name: 'Viewer', permissions: ['view_projects'] },
];

// Figures lifted from the prototype's SITES constant. The contract asks for
// three; the remaining two (Torbalı CX, Kocaeli LM2) are created in the console.
const SITES = [
  { name: 'Sakarya LM1', status: 'active', storage: 12480, picking: 1840, footprint: 42000 },
  { name: 'Esenyurt DC2', status: 'active', storage: 8120, picking: 2260, footprint: 28400 },
  { name: 'Gebze LM3', status: 'setup', storage: 19650, picking: 1120, footprint: 61800 },
] as const;

const DEV_USERS = [
  { name: 'Resul Övür', username: 'r.ovur', email: 'resul.ovur@netlog.com.tr', password: 'ro12345' },
  { name: 'Cengiz Tuna', username: 'c.tuna', email: 'cengiz.tuna@netlog.com.tr', password: 'ct12345' },
] as const;

async function main() {
  loadEnv();
  const withDev = process.argv.includes('--dev');

  const cx = await mysql.createConnection({
    host: process.env.DATABASE_HOST ?? '127.0.0.1',
    port: Number(process.env.DATABASE_PORT ?? 3306),
    user: process.env.DATABASE_USER ?? 'root',
    password: process.env.DATABASE_PASSWORD ?? '',
    database: process.env.DATABASE_NAME ?? 'digitaltwin',
    charset: 'utf8mb4_unicode_ci',
    timezone: 'Z',
  });

  for (const role of SYSTEM_ROLES) {
    await cx.execute(
      `INSERT INTO roles (name, permissions, is_system) VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE permissions = VALUES(permissions), is_system = 1`,
      [role.name, JSON.stringify(role.permissions)],
    );
  }
  console.log(`  ✓ roles (${SYSTEM_ROLES.map((r) => r.name).join(', ')})`);

  // The prototype signs the primary admin in as username `Admin` with no email
  // address. The schema makes email NOT NULL UNIQUE and the document wins over
  // the prototype, so the account carries the old panel's protected address.
  // The password is a bootstrap credential: must_change_password forces the
  // first sign-in through /welcome before anything else is reachable.
  const adminUsername = process.env.SEED_ADMIN_USERNAME ?? 'Admin';
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@netlog.com.tr';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'Admin';
  const adminHash = await argon2Hash(adminPassword, ARGON2_OPTS);

  await cx.execute(
    `INSERT INTO users (public_id, email, username, full_name, org, global_role, status,
                        password_hash, password_set_at, must_change_password)
     VALUES (?, ?, ?, ?, 'internal', 'Admin', 'active', ?, NOW(), 1)
     ON DUPLICATE KEY UPDATE id = id`,
    [ulid(), adminEmail, adminUsername, 'System Administrator', Buffer.from(adminHash, 'utf8')],
  );

  const [adminRows] = await cx.execute<mysql.RowDataPacket[]>('SELECT id FROM users WHERE username = ?', [
    adminUsername,
  ]);
  const adminId = adminRows[0]?.id as number | undefined;
  if (!adminId) throw new Error('admin seed did not resolve an id');
  console.log(`  ✓ admin (${adminUsername} / ${adminEmail}) — must change password on first sign-in`);

  for (const site of SITES) {
    await cx.execute(
      `INSERT INTO sites (public_id, name, status, storage_slots, picking_slots, footprint_m2, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [ulid(), site.name, site.status, site.storage, site.picking, site.footprint, adminId],
    );
  }
  console.log(`  ✓ sites (${SITES.map((s) => s.name).join(', ')})`);

  // sso_enforced_domains starts empty on purpose. The DDL comment shows the
  // shape (['@netlog.com.tr']), not a default — seeding the domain would switch
  // password sign-in off for the whole organisation before anyone can sign in.
  await cx.execute(
    `INSERT INTO settings (id, sso_enforced_domains, updated_by)
     VALUES (1, '[]', ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [adminId],
  );
  console.log('  ✓ settings (single row, defaults from section 10)');

  if (withDev) {
    for (const user of DEV_USERS) {
      const pwd = await argon2Hash(user.password, ARGON2_OPTS);
      await cx.execute(
        `INSERT INTO users (public_id, email, username, full_name, org, global_role, status,
                            password_hash, password_set_at, must_change_password)
         VALUES (?, ?, ?, ?, 'internal', 'Supervisor', 'active', ?, NOW(), 1)
         ON DUPLICATE KEY UPDATE id = id`,
        [ulid(), user.email, user.username, user.name, Buffer.from(pwd, 'utf8')],
      );
    }
    console.log(`  ✓ dev users (${DEV_USERS.map((u) => u.username).join(', ')})`);
  }

  await cx.execute(
    `INSERT INTO audit_log (actor_user_id, actor_label, level, kind, message)
     VALUES (?, 'system', 'info', 'seed', ?)`,
    [adminId, withDev ? 'Database seeded (with dev users)' : 'Database seeded'],
  );

  await cx.end();
  console.log('\nSeed complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
