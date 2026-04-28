import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { s3 } from '@/lib/s3'

const BUCKET = process.env.R2_BUCKET_NAME ?? ''

const bodySchema = z.object({ assetId: z.string().cuid() })

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string))
  }
  return Buffer.concat(chunks)
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
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { assetId } = parsed.data

  const asset = await prisma.marketplaceAsset.findUnique({
    where: { id: assetId },
    include: { project: { select: { name: true, stateUrl: true } } },
  })
  if (!asset || !asset.isPublished) {
    return NextResponse.json({ error: 'Asset not found or not published' }, { status: 404 })
  }

  // Find cloner's first team (from their owner/admin org)
  const membership = await prisma.organizationMember.findFirst({
    where: { userId, role: { in: ['OWNER', 'ADMIN'] } },
    include: { organization: { include: { teams: { take: 1, orderBy: { createdAt: 'asc' } } } } },
    orderBy: { createdAt: 'asc' },
  })
  if (!membership || !membership.organization.teams[0]) {
    return NextResponse.json({ error: 'No team found to clone into. Please create a workspace first.' }, { status: 422 })
  }
  const teamId = membership.organization.teams[0].id

  // Create new project record first to get its ID
  const newProject = await prisma.project.create({
    data: {
      teamId,
      name: `${asset.project.name} (Clone)`,
      description: `Cloned from marketplace asset: ${asset.title}`,
    },
  })

  // Deep-copy Yjs binary state from R2 if source has one
  let newStateUrl: string | null = null
  if (asset.project.stateUrl) {
    try {
      const sourceKey = asset.project.stateUrl.replace(/^https?:\/\/[^/]+\//, '')
      const getCmd = new GetObjectCommand({ Bucket: BUCKET, Key: sourceKey })
      const response = await s3.send(getCmd)
      if (response.Body) {
        const buffer = await streamToBuffer(response.Body as NodeJS.ReadableStream)
        const destKey = `projects/${newProject.id}/state.bin`
        await s3.send(new PutObjectCommand({
          Bucket: BUCKET,
          Key: destKey,
          Body: buffer,
          ContentType: 'application/octet-stream',
        }))
        newStateUrl = `${process.env.R2_PUBLIC_URL ?? ''}/${destKey}`
      }
    } catch {
      // State copy failure is non-fatal — project still created
    }
  }

  // Update project with state URL and set cloner as OWNER
  await Promise.all([
    prisma.project.update({
      where: { id: newProject.id },
      data: { stateUrl: newStateUrl },
    }),
    prisma.projectMember.create({
      data: { projectId: newProject.id, userId, role: 'OWNER' },
    }),
    prisma.projectClone.create({
      data: { sourceAssetId: assetId, clonedProjectId: newProject.id, clonedByUserId: userId },
    }),
    prisma.marketplaceAsset.update({
      where: { id: assetId },
      data: { cloneCount: { increment: 1 } },
    }),
  ])

  return NextResponse.json({ projectId: newProject.id })
}
