import { AUDIT_EVENT_FIELD, type AuditEvent } from '../audit-events'
import { exec } from '../db'

export type AuditLevel = 'info' | 'warn' | 'error'

/**
 * Append-only trail. Every mutation writes one row; clearing diagnostics never
 * touches this table (section 08). Failures here must not break the request that
 * triggered them — a lost log line is bad, a 500 on a successful sign-in is worse.
 *
 * `message` is the stored record and stays English. `event` is what the screens
 * render from, so a Turkish reader sees Turkish without the stored history ever
 * changing. See `src/lib/audit-events.ts` for why those are separate.
 */
export async function audit(entry: {
  actorUserId?: number | null
  actorLabel: string
  level: AuditLevel
  kind: string
  message: string
  event?: AuditEvent
  meta?: Record<string, unknown> | null
}): Promise<void> {
  // The event rides inside meta; callers keep using meta for anything else.
  const meta = entry.event
    ? { ...(entry.meta ?? {}), [AUDIT_EVENT_FIELD]: entry.event }
    : entry.meta

  try {
    await exec(
      `INSERT INTO audit_log (actor_user_id, actor_label, level, kind, message, meta)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        entry.actorUserId ?? null,
        entry.actorLabel.slice(0, 64),
        entry.level,
        entry.kind.slice(0, 48),
        entry.message.slice(0, 1024),
        meta ? JSON.stringify(meta) : null,
      ],
    )
  } catch (err) {
    console.error('[audit] write failed:', err)
  }
}
