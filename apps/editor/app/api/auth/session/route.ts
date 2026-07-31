import type { NextRequest } from 'next/server'
import { authAvailable } from '@/lib/auth/db'
import { getSessionUser } from '@/lib/auth/session'
import { guardSceneApiRequest, sceneApiJson } from '@/lib/scene-api-security'

export const dynamic = 'force-dynamic'

/**
 * Returns the current user, or null when signed out or auth is unavailable
 * (SQLite dev). Always 200 so the client hook stays simple.
 */
export async function GET(request: NextRequest) {
  const guard = guardSceneApiRequest(request, { skipAuth: true })
  if (guard) return guard
  if (!authAvailable()) {
    return sceneApiJson(request, { user: null }, { headers: { 'Cache-Control': 'no-store' } })
  }
  try {
    const user = await getSessionUser()
    return sceneApiJson(request, { user }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return sceneApiJson(request, { user: null }, { headers: { 'Cache-Control': 'no-store' } })
  }
}
