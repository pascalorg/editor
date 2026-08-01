import { query, type RowDataPacket } from '@panel/lib/db'
import type { NextRequest } from 'next/server'
import { sceneApiJson } from '@/lib/scene-api-security'

export const dynamic = 'force-dynamic'

/**
 * GET /api/showcase — the published projects, for the sign-in screen's hero.
 *
 * Deliberately unauthenticated and deliberately thin: only the name and a
 * size figure of projects an administrator has already approved for the
 * whole organisation. Drafts never appear here, and nothing identifying a
 * person leaves the building.
 */
export async function GET(request: NextRequest) {
  let sites: { name: string; footprintM2: number | null; nodeCount: number | null }[] = []
  try {
    const rows = await query<
      RowDataPacket & { name: string; footprint_m2: number | null; node_count: number | null }
    >(
      `SELECT s.name, s.footprint_m2, sc.node_count
         FROM sites s
         LEFT JOIN scenes sc
           ON CONVERT(sc.id USING utf8mb4) COLLATE utf8mb4_unicode_ci
            = CONVERT(s.scene_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
        WHERE s.status = 'active'
        ORDER BY s.name
        LIMIT 8`,
    )
    sites = rows.map((r) => ({
      name: r.name,
      footprintM2: r.footprint_m2,
      nodeCount: r.node_count,
    }))
  } catch {
    // Before the first migration there is no sites table; an empty hero is
    // the right answer, not a 500 on the sign-in screen.
  }

  return sceneApiJson(request, { sites })
}
