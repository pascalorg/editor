import { fail, handler, ok } from '@panel/lib/api'
import type { ChangelogResponse } from '@panel/lib/api-contract'
import { requireSession } from '@panel/lib/auth/guard'
import { changelogPage } from '@panel/lib/changelog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/changelog?cursor=&limit=20
 *
 * Served from the app backend, never from the client. The upstream fetch is
 * cached for 60 s here so a room full of consoles costs one request a minute
 * rather than one per viewer.
 */
export const GET = handler(async (request: Request) => {
  const guard = await requireSession()
  if (!guard.ok) return fail('unauthenticated', 'err.sessionExpired')

  const params = new URL(request.url).searchParams
  const page = await changelogPage(params.get('cursor'), Number(params.get('limit') ?? 20) || 20)

  const body: ChangelogResponse = page
  return ok(body)
})
