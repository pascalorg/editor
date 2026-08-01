import type { Lang } from '@panel/lib/types'
import type { NextRequest } from 'next/server'
import { guidesFor } from '@/lib/guides-content'
import { sceneApiJson } from '@/lib/scene-api-security'

export const dynamic = 'force-dynamic'

/**
 * GET /api/guides?lang=en|tr — the manual as data, so the console renders the
 * same pages the public site does instead of keeping a second copy that would
 * drift. Unauthenticated: the documentation is public either way.
 */
export function GET(request: NextRequest) {
  const requested = new URL(request.url).searchParams.get('lang')
  const lang: Lang = requested === 'tr' ? 'tr' : 'en'
  return sceneApiJson(request, { groups: guidesFor(lang).groups })
}
