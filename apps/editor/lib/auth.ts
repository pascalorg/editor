import { createAuth } from '@pascal-app/auth/server'
import { db } from '@pascal-app/db'
import { Resend } from 'resend'
import { BASE_URL } from './utils'

// Initialize Resend only if API key is available
const resendApiKey = process.env.RESEND_API_KEY
const resend = resendApiKey && resendApiKey.trim() !== '' ? new Resend(resendApiKey) : null

// Better Auth secret is required
const betterAuthSecret = process.env.BETTER_AUTH_SECRET
if (!betterAuthSecret) {
  throw new Error(
    'Missing BETTER_AUTH_SECRET environment variable. Generate one with: openssl rand -base64 32',
  )
}

export const auth = createAuth({
  db,
  appName: 'Pascal Editor',
  baseURL: BASE_URL,
  secret: betterAuthSecret,
  sendMagicLink: async ({ email, url }) => {
    if (!resend) {
      console.log(`[DEV] Magic link for ${email}: ${url}`)
      return
    }

    try {
      await resend.emails.send({
        from: 'Pascal <noreply@pascal.app>',
        to: email,
        subject: 'Sign in to Pascal Editor',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Sign in to Pascal Editor</h2>
            <p>Click the button below to sign in to your account:</p>
            <a href="${url}" style="display: inline-block; background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0;">
              Sign In
            </a>
            <p style="color: #666; font-size: 14px;">This link will expire in 5 minutes.</p>
            <p style="color: #666; font-size: 14px;">If you didn't request this email, you can safely ignore it.</p>
          </div>
        `,
      })
      console.log(`✓ Magic link email sent to ${email}`)
    } catch (error) {
      console.error('Failed to send magic link email:', error)
      throw error
    }
  },
})

export type Session = typeof auth.$Infer.Session
export type User = typeof auth.$Infer.Session.user
