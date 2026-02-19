import type { Metadata } from 'next'
import CommunityHub from '@/features/community/components/community-hub'

export const metadata: Metadata = {
  title: 'Community Projects',
  description:
    'Create and share 3D home projects with Pascal Editor, the open-source building editor.',
}

export default function Home() {
  return <CommunityHub />
}
