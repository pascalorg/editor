import { getServerSession } from 'next-auth/next'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { OnboardingFlow } from './_components/OnboardingFlow'

export default async function OnboardingPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')

  const userId = (session.user as { id: string }).id

  const progress = await prisma.onboardingProgress.findUnique({
    where: { userId },
  })

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <OnboardingFlow
        initialStep={progress?.currentStep ?? 0}
        initialSelections={(progress?.selections as Record<string, string>) ?? {}}
      />
    </div>
  )
}
