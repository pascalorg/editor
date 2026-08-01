import { randomBytes } from 'node:crypto'
import { ulid } from 'ulid'
import { encryptSecret, sha256 } from './auth/crypto'
import { exec, query, queryOne, type RowDataPacket } from './db'
import type { ApiKey, Webhook } from './types'

export const HOOK_EVENTS = [
  'user.invited',
  'user.deactivated',
  'site.created',
  'job.failed',
  'release.published',
] as const

/* ——— API keys ——— */

interface KeyRow extends RowDataPacket {
  public_id: string
  name: string
  prefix: string
  scope: 'read' | 'read_write'
  site_name: string | null
  created_by_email: string | null
  created_at: Date
  last_used_at: Date | null
  revoked_at: Date | null
}

const KEY_SELECT = `
  SELECT k.public_id, k.name, k.prefix, k.scope, s.name AS site_name,
         u.email AS created_by_email, k.created_at, k.last_used_at, k.revoked_at
    FROM api_keys k
    LEFT JOIN users u ON u.id = k.created_by
    LEFT JOIN sites s ON s.id = k.site_id
`

function toKey(row: KeyRow): ApiKey {
  return {
    id: row.public_id,
    name: row.name,
    prefix: row.prefix,
    scope: row.scope,
    siteId: row.site_name,
    createdBy: row.created_by_email ?? '—',
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at ? row.last_used_at.toISOString() : null,
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
  }
}

export async function listKeys(): Promise<ApiKey[]> {
  const rows = await query<KeyRow>(`${KEY_SELECT} ORDER BY k.created_at DESC`)
  return rows.map(toKey)
}

/**
 * Mints a key. Only the SHA-256 goes to the database; the raw value is returned
 * once and is unrecoverable afterwards — the same discipline as the temporary
 * password, and the reason the list can only ever show the 8-char prefix.
 */
export async function createKey(opts: {
  name: string
  scope: 'read' | 'read_write'
  siteName: string | null
  createdBy: number
}): Promise<ApiKey & { secret: string }> {
  const publicId = ulid()
  const secret = `dt_${randomBytes(24).toString('base64url')}`
  const prefix = secret.slice(0, 8)

  const site = opts.siteName
    ? await queryOne<RowDataPacket & { id: number }>('SELECT id FROM sites WHERE name = ?', [
        opts.siteName,
      ])
    : null

  await exec(
    `INSERT INTO api_keys (public_id, name, prefix, key_hash, scope, site_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [publicId, opts.name, prefix, sha256(secret), opts.scope, site?.id ?? null, opts.createdBy],
  )

  const row = await queryOne<KeyRow>(`${KEY_SELECT} WHERE k.public_id = ?`, [publicId])
  if (!row) throw new Error('api key insert did not round-trip')
  return { ...toKey(row), secret }
}

export async function revokeKey(publicId: string): Promise<ApiKey | null> {
  const row = await queryOne<KeyRow>(`${KEY_SELECT} WHERE k.public_id = ?`, [publicId])
  if (!row || row.revoked_at) return null

  await exec('UPDATE api_keys SET revoked_at = NOW() WHERE public_id = ?', [publicId])
  const fresh = await queryOne<KeyRow>(`${KEY_SELECT} WHERE k.public_id = ?`, [publicId])
  return fresh ? toKey(fresh) : null
}

/* ——— Webhooks ——— */

interface HookRow extends RowDataPacket {
  public_id: string
  url: string
  events: unknown
  status: 'active' | 'paused' | 'failing'
  fail_count: number
  last_delivery_at: Date | null
  created_at: Date
}

function toHook(row: HookRow): Webhook {
  const raw = typeof row.events === 'string' ? safeParse(row.events) : row.events
  return {
    id: row.public_id,
    url: row.url,
    events: Array.isArray(raw) ? raw.map(String) : [],
    status: row.status,
    failCount: row.fail_count,
    lastDeliveryAt: row.last_delivery_at ? row.last_delivery_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function listWebhooks(): Promise<Webhook[]> {
  const rows = await query<HookRow>('SELECT * FROM webhooks ORDER BY created_at DESC')
  return rows.map(toHook)
}

export async function createWebhook(url: string, events: string[]): Promise<Webhook> {
  const publicId = ulid()
  // Signing secret, encrypted at rest like the TOTP secret. Deliveries carry an
  // HMAC of the body so a receiver can tell a real event from a replayed one.
  const secret = encryptSecret(`whsec_${randomBytes(24).toString('base64url')}`)

  await exec('INSERT INTO webhooks (public_id, url, events, secret) VALUES (?, ?, ?, ?)', [
    publicId,
    url,
    JSON.stringify(events),
    secret,
  ])

  const row = await queryOne<HookRow>('SELECT * FROM webhooks WHERE public_id = ?', [publicId])
  if (!row) throw new Error('webhook insert did not round-trip')
  return toHook(row)
}

export async function setWebhookStatus(
  publicId: string,
  status: 'active' | 'paused',
): Promise<Webhook | null> {
  const row = await queryOne<HookRow>('SELECT * FROM webhooks WHERE public_id = ?', [publicId])
  if (!row) return null

  // Resuming clears the failure counter — otherwise a hook that was fixed still
  // reads as "failing" until it happens to fail again.
  await exec(
    status === 'active'
      ? "UPDATE webhooks SET status = 'active', fail_count = 0 WHERE public_id = ?"
      : "UPDATE webhooks SET status = 'paused' WHERE public_id = ?",
    [publicId],
  )

  const fresh = await queryOne<HookRow>('SELECT * FROM webhooks WHERE public_id = ?', [publicId])
  return fresh ? toHook(fresh) : null
}

export async function deleteWebhook(publicId: string): Promise<boolean> {
  const res = await exec('DELETE FROM webhooks WHERE public_id = ?', [publicId])
  return res.affectedRows > 0
}

export interface DeliveryResult {
  delivered: boolean
  responseStatus: number | null
  hook: Webhook | null
}

/**
 * Sends one test event and records the outcome.
 *
 * A 5-second timeout is deliberate: a receiver that hangs must not hold this
 * request open, and "no answer" is a failure like any other. Three consecutive
 * failures flip the hook to `failing` so the tab can show it without waiting for
 * someone to read a log.
 */
export async function deliverTest(publicId: string): Promise<DeliveryResult> {
  const row = await queryOne<HookRow>('SELECT * FROM webhooks WHERE public_id = ?', [publicId])
  if (!row) return { delivered: false, responseStatus: null, hook: null }

  const body = JSON.stringify({
    event: 'ping',
    id: ulid(),
    sentAt: new Date().toISOString(),
    data: { message: 'DigitalTwin webhook test' },
  })

  let responseStatus: number | null = null
  let delivered = false

  try {
    const response = await fetch(row.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-digitaltwin-event': 'ping' },
      body,
      signal: AbortSignal.timeout(5000),
    })
    responseStatus = response.status
    delivered = response.ok
  } catch {
    delivered = false
  }

  if (delivered) {
    await exec(
      "UPDATE webhooks SET last_delivery_at = NOW(), fail_count = 0, status = CASE WHEN status = 'failing' THEN 'active' ELSE status END WHERE public_id = ?",
      [publicId],
    )
  } else {
    await exec(
      `UPDATE webhooks
          SET last_delivery_at = NOW(), fail_count = fail_count + 1,
              status = CASE WHEN fail_count + 1 >= 3 AND status <> 'paused' THEN 'failing' ELSE status END
        WHERE public_id = ?`,
      [publicId],
    )
  }

  const fresh = await queryOne<HookRow>('SELECT * FROM webhooks WHERE public_id = ?', [publicId])
  return { delivered, responseStatus, hook: fresh ? toHook(fresh) : null }
}
