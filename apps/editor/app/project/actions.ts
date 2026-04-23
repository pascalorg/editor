'use server'

import { prisma } from '@/lib/prisma'
import { s3 } from '@/lib/s3'
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { revalidatePath } from 'next/cache'

export async function saveProject(projectId: string, sceneGraph: any) {
  try {
    const key = `projects/${projectId}/state.json`
    const body = JSON.stringify(sceneGraph)

    // 1. Upload to R2
    await s3.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: 'application/json',
    }))

    const stateUrl = `https://${process.env.R2_BUCKET_NAME}.r2.cloudflarestorage.com/${key}`

    // 2. Update DB
    await prisma.project.update({
      where: { id: projectId },
      data: {
        stateUrl,
        updatedAt: new Date(),
      }
    })

    return { success: true }
  } catch (error) {
    console.error('Failed to save project:', error)
    return { success: false, error: 'Failed to save project' }
  }
}

export async function loadProject(projectId: string) {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId }
    })

    if (!project || !project.stateUrl) {
      return null
    }

    const key = `projects/${projectId}/state.json`
    const response = await s3.send(new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
    }))

    const body = await response.Body?.transformToString()
    return body ? JSON.parse(body) : null
  } catch (error) {
    console.error('Failed to load project:', error)
    return null
  }
}
