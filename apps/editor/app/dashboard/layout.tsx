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

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      organizations: {
        include: {
          organization: {
            include: {
              teams: { include: { projects: { select: { id: true } } } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
      starredProjects: { select: { projectId: true } },
    },
  })

  if (!user) redirect('/login')

  const memberships = user.organizations
  const orgs = memberships.map((m) => ({
    id: m.organization.id,
    name: m.organization.name,
    slug: m.organization.slug,
    logoUrl: m.organization.logoUrl ?? null,
    role: m.role,
  }))

  const firstOrg = memberships[0]?.organization
  const teams = firstOrg?.teams.map((t, i) => ({
    id: t.id,
    name: t.name,
    projectCount: t.projects.length,
    color: ['#4F8EF7', '#F97316', '#A855F7', '#10B981', '#F59E0B'][i % 5]!,
  })) ?? []

  const totalProjects = firstOrg?.teams.reduce((acc, t) => acc + t.projects.length, 0) ?? 0
  const starredCount = user.starredProjects.length

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex">
      <DashboardSidebar
        orgs={orgs}
        user={{
          name: session.user.name ?? null,
          email: session.user.email ?? null,
          image: session.user.image ?? null,
        }}
        teams={teams}
        totalProjects={totalProjects}
        starredCount={starredCount}
        storageUsedGb={0}
        storageLimitGb={500}
      />
      <main className="flex-1 ml-[220px] overflow-y-auto min-h-screen">
        {children}
      </main>
    </div>
  )
}
