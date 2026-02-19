export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/features/community/lib/auth/server'
import { getUserProfile, getConnectedAccounts } from '@/features/community/lib/auth/actions'
import { SettingsPage } from '@/features/community/components/settings-page'

export const metadata: Metadata = {
  title: 'Account Settings',
  description: 'Manage your Pascal Editor account profile and connected providers.',
  robots: {
    index: false,
    follow: false,
  },
}

export default async function Settings() {
  const session = await getSession()
  if (!session?.user) {
    redirect('/')
  }

  const [profile, connectedAccounts] = await Promise.all([
    getUserProfile(),
    getConnectedAccounts(),
  ])

  return (
    <SettingsPage
      user={session.user}
      currentUsername={profile?.username ?? null}
      currentGithubUrl={profile?.githubUrl ?? null}
      currentXUrl={profile?.xUrl ?? null}
      connectedAccounts={connectedAccounts}
    />
  )
}
