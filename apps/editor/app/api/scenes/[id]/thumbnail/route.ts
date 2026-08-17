import { NextResponse } from 'next/server'
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getDatabase } from '@pascal-app/db'
import { scenes } from '@pascal-app/db/schema'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { nanoid } from 'nanoid'
import { resolveActor, authorizeScene, sceneApiJson } from '@/lib/scene-api-security'
import { s3Client, S3_BUCKET } from '@/lib/s3-client'
import { env } from '@/env.mjs'

const MAX_SIZE = 512 * 1024 // 512 KB

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: sceneId } = await props.params

  const actor = await resolveActor(request)
  const isAuthorized = await authorizeScene(actor, sceneId, 'write')
  
  if (!isAuthorized) {
    return sceneApiJson(request, { error: 'not_found_or_unauthorized' }, { status: 404 })
  }

  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength > MAX_SIZE) {
    return sceneApiJson(request, { error: 'payload_too_large' }, { status: 413 })
  }

  const contentType = request.headers.get('content-type') || ''
  if (!contentType.startsWith('image/')) {
    return sceneApiJson(request, { error: 'unsupported_media_type' }, { status: 415 })
  }

  try {
    const arrayBuffer = await request.arrayBuffer()
    if (arrayBuffer.byteLength === 0) {
      return sceneApiJson(request, { error: 'empty_payload' }, { status: 400 })
    }

    // Process image: resize and convert to webp
    const imageBuffer = await sharp(arrayBuffer)
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer()

    const db = getDatabase()

    let thumbnailUrl: string | null = null

    if (s3Client) {
      // Get old scene to find old thumbnail
      const existingScenes = await db.select({ thumbnailUrl: scenes.thumbnailUrl }).from(scenes).where(eq(scenes.id, sceneId)).limit(1)
      const oldThumbnailUrl = existingScenes[0]?.thumbnailUrl

      // Upload to S3
      const key = `thumbnails/${sceneId}-${nanoid()}.webp`
      await s3Client.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
          Body: imageBuffer,
          ContentType: 'image/webp',
          CacheControl: 'public, max-age=31536000, immutable',
        })
      )

      if (env.NEXT_PUBLIC_ASSETS_CDN_URL) {
        thumbnailUrl = `${env.NEXT_PUBLIC_ASSETS_CDN_URL}/${key}`
      } else if (env.S3_ENDPOINT) {
        // Fallback for direct S3 URL
        const endpoint = env.S3_ENDPOINT.endsWith('/') ? env.S3_ENDPOINT.slice(0, -1) : env.S3_ENDPOINT
        thumbnailUrl = `${endpoint}/${S3_BUCKET}/${key}`
      }

      // GC old thumbnail if it exists and is from our bucket
      if (oldThumbnailUrl) {
        try {
          // Fire and forget GC
          let oldKey: string | null = null
          if (env.NEXT_PUBLIC_ASSETS_CDN_URL && oldThumbnailUrl.startsWith(env.NEXT_PUBLIC_ASSETS_CDN_URL)) {
            oldKey = oldThumbnailUrl.replace(`${env.NEXT_PUBLIC_ASSETS_CDN_URL}/`, '')
          } else if (env.S3_ENDPOINT) {
            const endpoint = env.S3_ENDPOINT.endsWith('/') ? env.S3_ENDPOINT.slice(0, -1) : env.S3_ENDPOINT
            const prefix = `${endpoint}/${S3_BUCKET}/`
            if (oldThumbnailUrl.startsWith(prefix)) {
              oldKey = oldThumbnailUrl.replace(prefix, '')
            }
          }

          if (oldKey && oldKey.startsWith('thumbnails/')) {
            s3Client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: oldKey })).catch(() => {})
          }
        } catch (e) {
          // Ignore GC errors
        }
      }
    }

    // Best-effort: we always return 200, but if we don't have S3 configured, we don't update DB.
    if (thumbnailUrl) {
      await db.update(scenes)
        .set({ thumbnailUrl })
        .where(eq(scenes.id, sceneId))
        .execute()
    }

    return sceneApiJson(request, { success: true, thumbnailUrl }, { status: 200 })
  } catch (error) {
    console.error('Thumbnail upload failed:', error)
    return sceneApiJson(request, { error: 'internal_server_error' }, { status: 500 })
  }
}
