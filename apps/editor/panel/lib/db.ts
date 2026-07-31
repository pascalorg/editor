import mysql from 'mysql2/promise';
import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

let pool: Pool | undefined;

/**
 * Integration shim: inside the editor the database is configured through the
 * DIGITALTWIN_MYSQL_* variables, so those are honoured first and the panel's
 * own DATABASE_* names stay as the fallback for standalone runs.
 */
function env(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return undefined
}

export function dbConfig() {
  return {
    host: env('DIGITALTWIN_MYSQL_HOST', 'PASCAL_MYSQL_HOST', 'DATABASE_HOST') ?? '127.0.0.1',
    port: Number(env('DIGITALTWIN_MYSQL_PORT', 'PASCAL_MYSQL_PORT', 'DATABASE_PORT') ?? 3306),
    user: env('DIGITALTWIN_MYSQL_USER', 'PASCAL_MYSQL_USER', 'DATABASE_USER') ?? 'root',
    password: env('DIGITALTWIN_MYSQL_PASSWORD', 'PASCAL_MYSQL_PASSWORD', 'DATABASE_PASSWORD') ?? '',
    database: env('DIGITALTWIN_MYSQL_DATABASE', 'PASCAL_MYSQL_DATABASE', 'DATABASE_NAME') ?? 'digitaltwin',
    charset: 'utf8mb4_unicode_ci',
    timezone: 'Z',
    dateStrings: false,
    supportBigNumbers: true,
  };
}

export function db(): Pool {
  if (!pool) {
    pool = mysql.createPool({
      ...dbConfig(),
      waitForConnections: true,
      connectionLimit: 10,
      maxIdle: 10,
      enableKeepAlive: true,
      namedPlaceholders: false,
    });
  }
  return pool;
}

/** SELECT returning rows. */
export async function query<T extends RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> {
  // mysql2's overloads cannot infer through a caller-supplied generic, and its
  // value parameter is typed loosely, so both ends are asserted here. Every call
  // site declares its own row interface — that is where the real checking is.
  const [rows] = (await db().execute(sql, params as never)) as unknown as [T[], unknown];
  return rows;
}

/** SELECT returning the first row, or null. */
export async function queryOne<T extends RowDataPacket>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** INSERT / UPDATE / DELETE. */
export async function exec(sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
  const [res] = (await db().execute(sql, params as never)) as unknown as [ResultSetHeader, unknown];
  return res;
}

/**
 * Runs `fn` inside a transaction on a dedicated connection. Rolls back on throw.
 * Used wherever a mutation spans more than one table — invite issuing, password
 * reset with session revocation, MFA enrolment with recovery codes.
 */
export async function transaction<T>(fn: (cx: PoolConnection) => Promise<T>): Promise<T> {
  const cx = await db().getConnection();
  try {
    await cx.beginTransaction();
    const out = await fn(cx);
    await cx.commit();
    return out;
  } catch (err) {
    try {
      await cx.rollback();
    } catch {
      /* connection already gone — the original error is the useful one */
    }
    throw err;
  } finally {
    cx.release();
  }
}

export type { RowDataPacket, ResultSetHeader, PoolConnection };
