import { getServerSession } from 'next-auth/next'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'

export default async function InvitePage({ params }: { params: { token: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect(`/login?callbackUrl=/invite/${params.token}`)

  const userId = (session.user as { id: string }).id

  const invite = await prisma.organizationInviteToken.findUnique({
    where: { token: params.token },
  })

  if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
    redirect('/onboarding?invite=invalid')
  }

  // Check if user is already a member (idempotent)
  const existing = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: invite.organizationId, userId } },
  })

  if (!existing) {
    await prisma.$transaction([
      prisma.organizationMember.create({
        data: { organizationId: invite.organizationId, userId, role: 'MEMBER' },
      }),
      prisma.organizationInviteToken.update({
        where: { token: params.token },
        data: { usedAt: new Date(), usedByUserId: userId },
      }),
    ])
  }

  // If user is mid-onboarding, send back to onboarding; otherwise dashboard
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { onboardingComplete: true },
  })

  redirect(user?.onboardingComplete ? '/dashboard' : '/onboarding')
}
