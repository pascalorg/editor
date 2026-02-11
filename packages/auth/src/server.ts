import { db, schema } from '@pascal-app/db'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink } from 'better-auth/plugins'
import { Resend } from 'resend'

if (!process.env.BETTER_AUTH_SECRET) {
  throw new Error(
    'Missing BETTER_AUTH_SECRET environment variable. Generate one with: openssl rand -base64 32',
  )
}

if (!process.env.BETTER_AUTH_URL) {
  throw new Error(
    'Missing BETTER_AUTH_URL environment variable. Set it to your app URL (e.g., http://localhost:3000)',
  )
}

// Initialize Resend for email sending
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

/**
 * Better Auth server instance
 * Configured with PostgreSQL database (Supabase) and magic link authentication
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    usePlural: true,
    schema,
  }),
  advanced: {
    database: {
      generateId: false, // Use our prefixed nanoid IDs from schema
    },
  },
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  plugins: [
    magicLink({
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
    }),
  ],
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
    },
    additionalFields: {
      activePropertyId: {
        type: 'string',
      },
    },
  },
})

/**
 * Type helpers for better-auth session
 */
export type Session = typeof auth.$Infer.Session.session
export type User = typeof auth.$Infer.Session.user
