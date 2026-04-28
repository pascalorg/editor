import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ROLE_LABELS } from '@/lib/rbac'
import type { ProjectRole } from '@/lib/rbac'

type Params = { params: Promise<{ projectId: string }> }

async function resolveCallerRole(projectId: string, userId: string): Promise<ProjectRole | null> {
  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
  })
  if (member) return member.role as ProjectRole

  // Org owners/admins inherit OWNER access on projects within their org
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { team: { include: { organization: { include: { members: { where: { userId }, take: 1 } } } } } },
  })
  const orgRole = project?.team.organization.members[0]?.role
  if (orgRole === 'OWNER' || orgRole === 'ADMIN') return 'OWNER'
  return null
}

export async function GET(_req: Request, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as { id: string }).id
  const { projectId } = await params

  const callerRole = await resolveCallerRole(projectId, userId)
  if (!callerRole) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const members = await prisma.projectMember.findMany({
    where: { projectId },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json(members.map((m: typeof members[0]) => ({
    userId: m.userId,
    role: m.role,
    roleLabel: ROLE_LABELS[m.role as ProjectRole],
    user: m.user,
    joinedAt: m.createdAt,
  })))
}

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['EDITOR', 'VIEWER', 'COMMENTER']),
})

export async function POST(req: Request, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as { id: string }).id
  const { projectId } = await params

  const callerRole = await resolveCallerRole(projectId, userId)
  if (callerRole !== 'OWNER') return NextResponse.json({ error: 'Only project owners can invite members' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const parsed = inviteSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { email, role } = parsed.data

  const targetUser = await prisma.user.findUnique({ where: { email } })
  if (!targetUser) return NextResponse.json({ error: 'User not found. They must have an account first.' }, { status: 404 })

  const member = await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId, userId: targetUser.id } },
    create: { projectId, userId: targetUser.id, role },
    update: { role },
  })

  return NextResponse.json(member, { status: 201 })
}

const patchSchema = z.object({ role: z.enum(['EDITOR', 'VIEWER', 'COMMENTER']) })

export async function PATCH(req: Request, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as { id: string }).id
  const { projectId } = await params

  const callerRole = await resolveCallerRole(projectId, userId)
  if (callerRole !== 'OWNER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const url = new URL(req.url)
  const targetUserId = url.searchParams.get('userId')
  if (!targetUserId) return NextResponse.json({ error: 'Missing userId query param' }, { status: 400 })

  const updated = await prisma.projectMember.update({
    where: { projectId_userId: { projectId, userId: targetUserId } },
    data: { role: parsed.data.role },
  })

  return NextResponse.json(updated)
}

export async function DELETE(req: Request, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as { id: string }).id
  const { projectId } = await params

  const callerRole = await resolveCallerRole(projectId, userId)
  if (callerRole !== 'OWNER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const targetUserId = url.searchParams.get('userId')
  if (!targetUserId) return NextResponse.json({ error: 'Missing userId query param' }, { status: 400 })

  if (targetUserId === userId) {
    return NextResponse.json({ error: 'Cannot remove yourself as owner' }, { status: 422 })
  }

  await prisma.projectMember.delete({
    where: { projectId_userId: { projectId, userId: targetUserId } },
  })

  return new NextResponse(null, { status: 204 })
}
