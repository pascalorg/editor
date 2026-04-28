import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { s3 } from '@/lib/s3'
import { canEdit } from '@/lib/rbac'

const ALLOWED_TYPES = new Set([
  'model/gltf-binary',
  'model/gltf+json',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/ktx2',
])

const BUCKET = process.env.R2_BUCKET_NAME ?? ''

const bodySchema = z.object({
  filename: z.string().min(1).max(256),
  contentType: z.string().min(1),
  projectId: z.string().cuid(),
})

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.\.+/g, '_')
    .slice(0, 128)
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = (session.user as { id: string }).id

  const body = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', issues: parsed.error.issues }, { status: 400 })
  }
  const { filename, contentType, projectId } = parsed.data

  if (!ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json({ error: 'File type not permitted' }, { status: 415 })
  }

  // Verify caller has edit access to the project
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
  })
  if (!membership || !canEdit(membership.role)) {
    // Org owners also allowed — check org membership
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { team: { include: { organization: { include: { members: { where: { userId } } } } } } },
    })
    const orgRole = project?.team.organization.members[0]?.role
    if (orgRole !== 'OWNER' && orgRole !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const safe = sanitizeFilename(filename)
  const key = `projects/${projectId}/assets/${crypto.randomUUID()}-${safe}`

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  })

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 })
  const publicUrl = `${process.env.R2_PUBLIC_URL ?? ''}/${key}`

  return NextResponse.json({ uploadUrl, key, publicUrl })
}
