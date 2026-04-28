'use server'

import { getServerSession } from 'next-auth/next'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 48)
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base
  let i = 2
  while (await prisma.organization.findUnique({ where: { slug } })) {
    slug = `${base}-${i++}`
  }
  return slug
}

export async function createWorkspace(
  orgName: string,
  _useCase?: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return { success: false, error: 'Not authenticated' }

  const userId = (session.user as { id: string }).id
  const name = orgName.trim()

  if (name.length < 2) return { success: false, error: 'Name must be at least 2 characters.' }

  const existing = await prisma.organizationMember.findFirst({ where: { userId } })
  if (existing) return { success: true }

  const slug = await uniqueSlug(toSlug(name))

  try {
    await prisma.organization.create({
      data: {
        name,
        slug,
        status: 'APPROVED',
        members: { create: { userId, role: 'OWNER' } },
        teams: { create: { name: 'General' } },
      },
    })
    return { success: true }
  } catch {
    return { success: false, error: 'Could not create workspace. Try again.' }
  }
}

export async function provisionWorkspace(formData: FormData) {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')

  const userId = (session.user as { id: string }).id
  const orgName = (formData.get('orgName') as string | null)?.trim()

  if (!orgName || orgName.length < 2) {
    throw new Error('Organization name must be at least 2 characters.')
  }

  const existing = await prisma.organizationMember.findFirst({ where: { userId } })
  if (existing) redirect('/dashboard')

  const slug = await uniqueSlug(toSlug(orgName))

  const org = await prisma.organization.create({
    data: {
      name: orgName,
      slug,
      status: 'APPROVED',
      members: {
        create: { userId, role: 'OWNER' },
      },
      teams: {
        create: { name: 'General' },
      },
    },
  })

  void org

  redirect('/dashboard')
}
