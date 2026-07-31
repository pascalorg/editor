import { exec, query, queryOne, type RowDataPacket } from './db';

/**
 * One table, two views.
 *
 * `audit_log` holds everything; `kind` decides which surface a row belongs to.
 * Change records (who altered an account, a role, a site, the settings) are the
 * audit trail. Everything else — sign-ins, sessions, browser errors — is runtime
 * diagnostics.
 *
 * The contract says clearing diagnostics must not touch the audit trail, and
 * the schema has one table, so the separation is enforced here rather than by
 * two tables. CHANGE_KINDS is the whole of that rule.
 */
export const CHANGE_KINDS = [
  'user',
  'role_change',
  'invite',
  'request',
  'site',
  'api_key',
  'webhook',
  'settings',
] as const;

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  level: LogLevel;
  kind: string | null;
  actor: string;
  message: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
  /** True when the row belongs to the audit trail and survives a clear. */
  permanent: boolean;
}

interface LogRow extends RowDataPacket {
  id: number;
  level: LogLevel;
  kind: string | null;
  actor_label: string;
  message: string;
  meta: unknown;
  created_at: Date;
}

function toEntry(row: LogRow): LogEntry {
  const raw = typeof row.meta === 'string' ? safeParse(row.meta) : row.meta;
  return {
    id: String(row.id),
    level: row.level,
    kind: row.kind,
    actor: row.actor_label,
    message: row.message,
    meta: raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null,
    createdAt: row.created_at.toISOString(),
    permanent: isChangeKind(row.kind),
  };
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function isChangeKind(kind: string | null): boolean {
  return kind !== null && (CHANGE_KINDS as readonly string[]).includes(kind);
}

export type LogRange = 'hour' | 'today' | 'week' | 'all';

export interface LogQuery {
  /** `audit` restricts to change records; `diagnostics` is everything else. */
  view: 'diagnostics' | 'audit';
  search?: string;
  level?: LogLevel | 'All';
  actor?: string;
  kind?: string;
  range?: LogRange;
  /** Opaque cursor — the id to read backwards from. */
  cursor?: string;
  limit?: number;
}

export interface LogPage {
  entries: LogEntry[];
  /** Pass back as `cursor` to fetch the next page; null when exhausted. */
  nextCursor: string | null;
  /** Distinct actors, for the actor dropdown. */
  actors: string[];
  counts: { info: number; warn: number; error: number };
}

const RANGE_SQL: Record<LogRange, string> = {
  hour: 'AND created_at >= NOW() - INTERVAL 1 HOUR',
  today: 'AND created_at >= CURDATE()',
  week: 'AND created_at >= NOW() - INTERVAL 7 DAY',
  all: '',
};

export async function listLogs(opts: LogQuery): Promise<LogPage> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  const placeholders = CHANGE_KINDS.map(() => '?').join(',');

  const where: string[] = ['1 = 1'];
  const params: unknown[] = [];

  if (opts.view === 'audit') {
    where.push(`kind IN (${placeholders})`);
    params.push(...CHANGE_KINDS);
  } else {
    where.push(`(kind IS NULL OR kind NOT IN (${placeholders}))`);
    params.push(...CHANGE_KINDS);
  }

  if (opts.level && opts.level !== 'All') {
    where.push('level = ?');
    params.push(opts.level);
  }
  if (opts.actor && opts.actor !== 'All') {
    where.push('actor_label = ?');
    params.push(opts.actor);
  }
  if (opts.kind && opts.kind !== 'All') {
    where.push('kind = ?');
    params.push(opts.kind);
  }
  if (opts.search?.trim()) {
    where.push('(message LIKE ? OR actor_label LIKE ?)');
    const like = `%${opts.search.trim()}%`;
    params.push(like, like);
  }

  const range = RANGE_SQL[opts.range ?? 'all'];
  const clause = `WHERE ${where.join(' AND ')} ${range}`;

  // Keyset pagination on the primary key. OFFSET would drift as new rows arrive
  // — and on a log that is being written to while you read it, that means
  // duplicated or skipped entries rather than a stable page.
  const cursorClause = opts.cursor ? 'AND id < ?' : '';
  const rows = await query<LogRow>(
    `SELECT id, level, kind, actor_label, message, meta, created_at
       FROM audit_log ${clause} ${cursorClause}
      ORDER BY id DESC
      LIMIT ${limit + 1}`,
    opts.cursor ? [...params, opts.cursor] : params,
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const counts = await queryOne<RowDataPacket & { info: number; warn: number; error: number }>(
    `SELECT SUM(level = 'info') AS info, SUM(level = 'warn') AS warn, SUM(level = 'error') AS error
       FROM audit_log ${clause}`,
    params,
  );

  const actorRows = await query<RowDataPacket & { actor_label: string }>(
    `SELECT DISTINCT actor_label FROM audit_log ${clause} ORDER BY actor_label LIMIT 50`,
    params,
  );

  return {
    entries: page.map(toEntry),
    nextCursor: hasMore ? String(page[page.length - 1].id) : null,
    actors: actorRows.map((r) => r.actor_label),
    counts: {
      info: Number(counts?.info ?? 0),
      warn: Number(counts?.warn ?? 0),
      error: Number(counts?.error ?? 0),
    },
  };
}

/**
 * Clears diagnostics.
 *
 * Two things survive on purpose: change records (they are the audit trail) and
 * anything at warn or error (a failed sign-in or a lockout is the exact record
 * someone clearing logs would most want gone). Info-level noise is what goes.
 */
export async function clearDiagnostics(): Promise<number> {
  const placeholders = CHANGE_KINDS.map(() => '?').join(',');
  const res = await exec(
    `DELETE FROM audit_log
      WHERE (kind IS NULL OR kind NOT IN (${placeholders}))
        AND level = 'info'`,
    [...CHANGE_KINDS],
  );
  return res.affectedRows;
}

/** Distinct `kind` values present in the audit view, for its filter chips. */
export async function auditKinds(): Promise<string[]> {
  const placeholders = CHANGE_KINDS.map(() => '?').join(',');
  const rows = await query<RowDataPacket & { kind: string }>(
    `SELECT DISTINCT kind FROM audit_log WHERE kind IN (${placeholders}) ORDER BY kind`,
    [...CHANGE_KINDS],
  );
  return rows.map((r) => r.kind);
}

/** Actors seen in the last 20 minutes — the "connected users" panel. */
export async function recentActors(minutes = 20): Promise<Array<{ actor: string; lastAction: string; at: string }>> {
  const rows = await query<RowDataPacket & { actor_label: string; message: string; created_at: Date }>(
    `SELECT a.actor_label, a.message, a.created_at
       FROM audit_log a
       JOIN (
         SELECT actor_label, MAX(id) AS last_id
           FROM audit_log
          WHERE created_at >= NOW() - INTERVAL ? MINUTE
            AND actor_label NOT IN ('system', 'browser')
          GROUP BY actor_label
       ) latest ON latest.last_id = a.id
      ORDER BY a.created_at DESC
      LIMIT 20`,
    [minutes],
  );
  return rows.map((r) => ({
    actor: r.actor_label,
    lastAction: r.message,
    at: r.created_at.toISOString(),
  }));
}
