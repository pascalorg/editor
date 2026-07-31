import { getSession } from '@panel/lib/auth/session'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/**
 * Route state lives in the URL — every screen is addressable and back/forward
 * work — so `/` never renders anything itself. It only decides where a visitor
 * belongs, which is the `client-bootstrap` guard the plan asks to be carried over.
 */
export default async function Root() {
  const session = await getSession({ touch: false })

  if (!session) redirect('/signin')
  if (session.mfaPending) redirect('/mfa')
  if (session.user.mustChangePassword) redirect('/welcome')
  redirect('/console/overview')
}
