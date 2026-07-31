import { cookies } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { destroySession } from '@/lib/auth/service'
import { clearSessionCookie, SESSION_COOKIE } from '@/lib/auth/session'
import { guardSceneApiRequest, withSceneApiHeaders } from '@/lib/scene-api-security'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const guard = guardSceneApiRequest(request, { skipAuth: true })
  if (guard) return guard

  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (token) {
    try {
      await destroySession(token)
    } catch {
      // Clearing the cookie below still signs the browser out even if the
      // row delete fails; the session simply expires server-side.
    }
  }
  await clearSessionCookie()
  // 204 must not carry a body — return an empty response, not JSON null.
  return withSceneApiHeaders(request, new NextResponse(null, { status: 204 }))
}
