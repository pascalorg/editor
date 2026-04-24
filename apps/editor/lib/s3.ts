import { S3Client } from '@aws-sdk/client-s3'

if (!process.env.R2_ACCOUNT_ID) {
  console.warn('[S3] Warning: R2_ACCOUNT_ID is not set. S3 connection may fail.')
}

const endpoint = `https://${process.env.R2_ACCOUNT_ID || 'missing'}.r2.cloudflarestorage.com`
console.log('[S3] Initializing with endpoint:', endpoint)

export const s3 = new S3Client({
  region: 'auto',
  endpoint,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
})
