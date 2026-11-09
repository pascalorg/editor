import { NextResponse } from 'next/server'
import { sessionCookie } from '@/lib/self-host-auth'

export const dynamic = 'force-dynamic'

export function POST(request: Request) {
  // Relative Location: the handler's own request URL names the bind address,
  // not the host the browser used.
  const response = new NextResponse(null, { status: 303, headers: { Location: '/login' } })
  response.headers.set('Set-Cookie', sessionCookie(request, '', 0))
  return response
}
