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

    // If approved, we might want to create an organization and invite the user
    // For now, just track the approval
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
