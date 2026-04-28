import type { ReactNode } from 'react'
import { getServerSession } from 'next-auth/next'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { DashboardSidebar } from './_components/DashboardSidebar'

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')

  const userId = (session.user as { id: string }).id

  const memberships = await prisma.organizationMember.findMany({
    where: { userId },
    include: {
      organization: { select: { id: true, name: true, slug: true, logoUrl: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  if (memberships.length === 0) redirect('/onboarding')

  const orgs = memberships.map((m) => ({ ...m.organization, role: m.role }))

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex">
      <DashboardSidebar
        orgs={orgs}
        user={{ name: session.user.name ?? null, email: session.user.email ?? null, image: session.user.image ?? null }}
      />
      <main className="flex-1 ml-64 overflow-y-auto min-h-screen">
        {children}
      </main>
    </div>
  )
}
