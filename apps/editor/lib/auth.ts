import { createAuth } from '@pascal-app/auth'
import { getDatabase } from '@pascal-app/db'
import { env } from '../env.mjs'

export const auth = createAuth({
  db: getDatabase(),
  appName: 'Menart 3D',
  baseURL: env.NEXT_PUBLIC_APP_URL || 'http://localhost:3002',
  secret: env.BETTER_AUTH_SECRET || 'development-secret-key-do-not-use-in-prod',
  googleClientId: env.GOOGLE_CLIENT_ID,
  googleClientSecret: env.GOOGLE_CLIENT_SECRET,
  // TODO: Implement Resend email sending
  // sendMagicLink: async ({ email, url, token }) => {
  //   console.log(`[Magic Link] Send to ${email}: ${url}`);
  // }
})
