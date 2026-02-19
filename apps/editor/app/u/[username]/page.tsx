export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { getPublicProfile } from '@/features/community/lib/auth/actions'
import { getPublicProjectsByUserId } from '@/features/community/lib/projects/actions'
import { PublicProfilePage } from '@/features/community/components/public-profile-page'

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  const profileResult = await getPublicProfile(username)

  if (!profileResult.success || !profileResult.data) {
    notFound()
  }

  const projectsResult = await getPublicProjectsByUserId(profileResult.data.id)

  return (
    <PublicProfilePage
      profile={profileResult.data}
      projects={projectsResult.data ?? []}
    />
  )
}
