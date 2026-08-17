import { anonymousClient, magicLinkClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3002',
  plugins: [magicLinkClient(), anonymousClient()],
})

export type Session = typeof authClient.$Infer.Session
export type User = typeof authClient.$Infer.Session.user
