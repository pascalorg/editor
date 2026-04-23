'use server'

import { prisma } from '@/lib/prisma'
import { PostHogServer } from '@/lib/posthog-server'
import { revalidatePath } from 'next/cache'

export async function getApplications() {
  try {
    return await prisma.earlyAccessApplication.findMany({
      orderBy: { createdAt: 'desc' }
    })
  } catch (error) {
    console.error('Failed to fetch applications:', error)
    return []
  }
}

export async function updateApplicationStatus(id: string, status: 'APPROVED' | 'REJECTED') {
  try {
    const application = await prisma.earlyAccessApplication.update({
      where: { id },
      data: { status }
    })

    if (status === 'APPROVED') {
      // 1. Find or create the user
      const user = await prisma.user.upsert({
        where: { email: application.contactEmail },
        update: {},
        create: {
          email: application.contactEmail,
          name: application.contactName,
        }
      });

      // 2. Extract domain from contact email
      const emailParts = application.contactEmail.split('@');
      const domain = emailParts.length === 2 ? emailParts[1].toLowerCase() : null;

      // 3. Generate a unique slug
      let baseSlug = application.orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      if (!baseSlug) baseSlug = 'org';

      let slug = baseSlug;
      let counter = 1;
      while (await prisma.organization.findUnique({ where: { slug } })) {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }

      // 4. Create the organization and link the user as OWNER
      await prisma.organization.create({
        data: {
          name: application.orgName,
          slug,
          domain,
          status: 'APPROVED',
          members: {
            create: {
              userId: user.id,
              role: 'OWNER',
            }
          }
        }
      });
    }

    const posthog = PostHogServer()
    posthog.capture({
      distinctId: application.contactEmail,
      event: `early_access_application_${status.toLowerCase()}`,
      properties: {
        orgName: application.orgName,
      },
    })
    await posthog.shutdown()

    revalidatePath('/admin')
    return { success: true }
  } catch (error) {
    console.error(`Failed to ${status.toLowerCase()} application:`, error)
    return { success: false, error: `Failed to ${status.toLowerCase()} application.` }
  }
}
