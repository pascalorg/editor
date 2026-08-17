import { S3Client } from '@aws-sdk/client-s3'
import { env } from '../env.mjs'

export const s3Client =
  env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
    ? new S3Client({
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION || 'auto',
        credentials: {
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        },
        forcePathStyle: true, // required for MinIO, sometimes needed for others
      })
    : null

export const S3_BUCKET = env.S3_BUCKET || 'pascal-thumbnails'
