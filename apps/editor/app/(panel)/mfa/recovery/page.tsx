import { MfaRecoveryScreen } from '@panel/components/auth/mfa-recovery-screen'
import { getSession } from '@panel/lib/auth/session'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function MfaRecoveryPage() {
  const session = await getSession({ touch: false })
  if (!session) redirect('/signin')
  if (!session.mfaPending) redirect('/console/overview')

  return <MfaRecoveryScreen />
}
