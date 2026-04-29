import { getToken } from 'next-auth/jwt'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  const { pathname } = req.nextUrl

  // Unauthenticated — let auth pages handle it
  if (!token) return NextResponse.next()

  const onboardingComplete = token.onboardingComplete as boolean | undefined

  // Authenticated user hitting /dashboard without completing onboarding → gate
  if (pathname.startsWith('/dashboard') && !onboardingComplete) {
    return NextResponse.redirect(new URL('/onboarding', req.url))
  }

  // Authenticated user hitting /onboarding after completing → send to dashboard
  if (pathname.startsWith('/onboarding') && onboardingComplete) {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard(.*)', '/onboarding(.*)'],
}
