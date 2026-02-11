import { createAuth } from '@pascal-app/auth/server'
import { db } from '@pascal-app/db'
import { Resend } from 'resend'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

export const auth = createAuth({
  db,
  appName: 'Pascal Editor',
  baseURL: process.env.BETTER_AUTH_URL!,
  secret: process.env.BETTER_AUTH_SECRET!,
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
