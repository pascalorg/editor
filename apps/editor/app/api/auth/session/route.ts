import { handler, ok } from '@panel/lib/api'
import type { SessionResponse } from '@panel/lib/api-contract'
import { getSession } from '@panel/lib/auth/session'
import { getSettings } from '@panel/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/session
 *
 * The single source of truth for the idle countdown. The client polls it; the
 * server owns `expiresInSeconds`, so a tampered clock or a stale tab cannot
 * stretch a session past settings.session_minutes.
 *
 * This read deliberately does NOT slide the idle window. It used to, on the
 * reasoning that a poll from a visible tab is activity — but a visible tab is
 * not a person. A console left open on an unattended screen polled itself every
 * 30 seconds and so could never time out, which is the one thing the idle
 * timeout exists to prevent on a system whose own sign-in screen says
 * "authorised personnel only".
 *
 * Real work still slides it: every other console request goes through
 * `requirePermission` → `getSession()`, which touches by default. And the idle
 * dialog's "Stay signed in" has its own endpoint (`/api/auth/session/touch`).
 * So the window now follows what the person does, not whether a tab is open.
 */
export const GET = handler(async () => {
  const settings = await getSettings()
  const session = await getSession({ touch: false })

  if (!session) {
    const body: SessionResponse = {
      state: 'anonymous',
      user: null,
      expiresInSeconds: 0,
      sessionMinutes: settings.sessionMinutes,
    }
    return ok(body)
  }

  const body: SessionResponse = {
    state: session.state,
    user: session.user,
    expiresInSeconds: Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)),
    sessionMinutes: settings.sessionMinutes,
  }
  return ok(body)
})
