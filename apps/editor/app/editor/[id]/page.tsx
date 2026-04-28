import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import EditorClient from './EditorClient'
import { toAccessLevel } from '@/lib/rbac'
import type { ProjectRole } from '@/lib/rbac'

export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')

  const { id: projectId } = await params
  const userId = (session.user as { id: string }).id

  // Check project-level membership first
  const projectMember = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
  })

  let role: ProjectRole | null = projectMember?.role as ProjectRole ?? null

  // Fall back to org-level role for org owners/admins
  if (!role) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        team: {
          include: {
            organization: {
              include: { members: { where: { userId }, take: 1 } },
            },
          },
        },
      },
    })
    if (!project) redirect('/dashboard')
    const orgRole = project.team.organization.members[0]?.role
    if (orgRole === 'OWNER' || orgRole === 'ADMIN') {
      role = 'OWNER'
    }
  }

  if (!role) redirect('/dashboard')

  const accessLevel = toAccessLevel(role)

  return (
    <EditorClient
      projectId={projectId}
      userId={userId}
      userName={session.user.name ?? 'User'}
      accessLevel={accessLevel}
    />
  )
}
