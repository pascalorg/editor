import { MfaSetupScreen } from '@panel/components/auth/mfa-setup-screen'
import { getSession } from '@panel/lib/auth/session'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function MfaSetupPage() {
  // Enrolment is reachable with a half-open session on purpose: that is exactly
  // the state a first-time user is in when MFA is mandatory.
  const session = await getSession({ touch: false })
  if (!session) redirect('/signin')

  return <MfaSetupScreen />
}
