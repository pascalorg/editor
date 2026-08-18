import type { NextRequest } from 'next/server'
import {
  guardSceneApiRequest,
  resolveActor,
  sceneApiJson,
  sceneApiPreflight,
} from '@/lib/scene-api-security'
import { measureSceneUsage, resolveSceneQuotas, tierForActor } from '@/lib/scene-quota'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'

export function OPTIONS(request: NextRequest) {
  return sceneApiPreflight(request)
}

/**
 * Per-user usage and the limits that bound it. This is the reporting surface
 * the quota enforcement reads from the same tables as: scene count and total
 * bytes for the caller, plus the tier limits those numbers are judged against.
 * Unauthenticated callers get the guest limits and zero usage.
 */
export async function GET(request: NextRequest) {
  const guard = await guardSceneApiRequest(request)
  if (guard) return guard

  const actor = await resolveActor(request)
  const quotas = resolveSceneQuotas()
  const tier = tierForActor(actor)
  const limits = quotas[tier]

  if (actor.type !== 'user') {
    return sceneApiJson(request, {
      tier,
      limits,
      usage: { sceneCount: 0, totalBytes: 0 },
    })
  }

  const operations = await getSceneOperations()
  const scenes = await operations.listScenes({ ownerId: actor.userId, limit: 500 })
  return sceneApiJson(request, { tier, limits, usage: measureSceneUsage(scenes) })
}
