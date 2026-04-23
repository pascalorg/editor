'use server'

import { prisma } from '@/lib/prisma'
import { PostHogServer } from '@/lib/posthog-server'

export async function submitApplication(formData: {
  orgName: string
  contactName: string
  contactEmail: string
  useCase: string
  teamSize: string
}) {
  try {
    const sizeMap: Record<string, number> = {
      '1-5 members': 5,
      '6-20 members': 20,
      '21-100 members': 100,
      '100+ members': 500,
    }

    const application = await prisma.earlyAccessApplication.create({
      data: {
        orgName: formData.orgName,
        contactName: formData.contactName,
        contactEmail: formData.contactEmail,
        useCase: formData.useCase,
        teamSize: sizeMap[formData.teamSize] || 5,
      },
    })

    // Track event in PostHog
    const posthog = PostHogServer()
    posthog.capture({
      distinctId: formData.contactEmail,
      event: 'early_access_application_submitted',
      properties: {
        orgName: formData.orgName,
        teamSize: formData.teamSize,
      },
    })
    await posthog.shutdown()

    return { success: true, id: application.id }
  } catch (error) {
    console.error('Failed to submit application:', error)
    return { success: false, error: 'Failed to submit application. Please try again.' }
  }
}
