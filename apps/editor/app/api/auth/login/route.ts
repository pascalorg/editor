import { NextResponse } from 'next/server'
import {
  allowLoginAttempt,
  issueSession,
  resolveAuthMode,
  SESSION_TTL_SECONDS,
  sessionCookie,
  verifyPassword,
} from '@/lib/self-host-auth'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  if (resolveAuthMode(request) !== 'password') {
    return NextResponse.json({ error: 'password_not_configured' }, { status: 404 })
  }
  if (!allowLoginAttempt(request)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }
  let password: unknown
  try {
    password = ((await request.json()) as { password?: unknown }).password
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
  if (typeof password !== 'string' || !verifyPassword(password)) {
    return NextResponse.json({ error: 'invalid_password' }, { status: 401 })
  }
  const response = new NextResponse(null, { status: 204 })
  response.headers.set('Set-Cookie', sessionCookie(request, issueSession(), SESSION_TTL_SECONDS))
  return response
}
