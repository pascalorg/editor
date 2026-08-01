import { queryOne, type RowDataPacket } from '@panel/lib/db'
import type { NextRequest } from 'next/server'
import { sceneApiJson } from '@/lib/scene-api-security'

export const dynamic = 'force-dynamic'

/**
 * GET /api/last-activity — when the system was last signed in to, and from
 * what kind of device.
 *
 * Deliberately about the system, never about a person: no name, no email, no
 * address, and no way to ask about a particular account. That last part is
 * what keeps the sign-in screen from becoming an oracle for "does this
 * address have an account here" — the answer is the same whoever asks.
 */
export async function GET(request: NextRequest) {
  let last: { at: string; device: string | null } | null = null
  try {
    const row = await queryOne<RowDataPacket & { created_at: Date; device: string | null }>(
      `SELECT created_at, device
         FROM sessions
        WHERE mfa_pending = 0
        ORDER BY created_at DESC
        LIMIT 1`,
    )
    if (row) last = { at: row.created_at.toISOString(), device: row.device }
  } catch {
    // Before the console schema exists there is nothing to report, which is a
    // quiet absence rather than an error on the sign-in screen.
  }

  return sceneApiJson(request, { last })
}
