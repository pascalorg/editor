import type { Database } from '@pascal-app/db'
import * as schema from '@pascal-app/db/schema'
import type { BetterAuthOptions } from 'better-auth'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { anonymous, magicLink } from 'better-auth/plugins'
import { bestEffort, type EmailSender } from './email'
import {
  type EmailLocale,
  magicLinkEmail,
  resetPasswordEmail,
  verifyEmailEmail,
  welcomeEmail,
} from './email-templates'

export interface AuthConfig {
  db: Database
  appName: string
  baseURL: string
  secret: string
  /** Google OAuth client ID */
  googleClientId?: string
  /** Google OAuth client secret */
  googleClientSecret?: string
  /**
   * Delivery for the four transactional emails. Required rather than optional:
   * an absent sender used to silently drop the magic-link plugin, so the sign-in
   * dialog's default method answered 404 with nothing pointing at the cause.
   * Hand it a throwing sender (`createUnconfiguredSender`) when delivery is not
   * set up — a reported failure beats a missing endpoint.
   */
  sendEmail: EmailSender
  /** Locale for the email copy. Defaults to `tr`, matching the app. */
  emailLocale?: EmailLocale
  /** Additional plugins to add (e.g., nextCookies for web) */
  additionalPlugins?: BetterAuthOptions['plugins']
}

/**
 * Creates a Better Auth instance with full configuration including:
 * - Email & Password authentication (with reset-password delivery)
 * - Magic link authentication
 * - Google OAuth
 * - Session cookie caching
 */
export function createAuth(config: AuthConfig) {
  const locale = config.emailLocale ?? 'tr'
  const { appName, sendEmail } = config
  const sendVerification = bestEffort(sendEmail, 'verification')
  const sendWelcome = bestEffort(sendEmail, 'welcome')

  return betterAuth({
    appName: config.appName,
    baseURL: config.baseURL,
    secret: config.secret,
    basePath: '/api/auth',
    database: drizzleAdapter(config.db, {
      provider: 'pg',
      usePlural: true,
      schema,
    }),
    advanced: {
      database: {
        generateId: false, // Use our prefixed nanoid IDs from schema
      },
    },
    session: {
      // Session caching to reduce database queries
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // Cache duration in seconds (5 minutes)
      },
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax',
      },
    },
    // Account linking — always enabled so magic link + Google users can share accounts
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ['google', 'email'],
      },
    },
    emailAndPassword: {
      enabled: true,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          ...resetPasswordEmail({ appName, url, locale }),
        })
      },
    },
    emailVerification: {
      // Not cosmetic. better-auth's `revokeUnprovenAccountAccess` deletes the
      // `credential` account of a user whose email was never verified the first
      // time someone proves that mailbox with a magic link — an anti-takeover
      // rule. Until this config sent a verification mail at all, *every*
      // password account was permanently unprovable, so the first magic link on
      // that address silently destroyed the user's password.
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      // Best-effort: the sign-up has already succeeded by the time this runs,
      // and failing it would strand a usable account behind a 500.
      sendVerificationEmail: async ({ user, url }) => {
        await sendVerification({
          to: user.email,
          ...verifyEmailEmail({ appName, url, locale }),
        })
      },
    },
    // Credential guessing is cheap without this. Distributed limits arrive with
    // Redis (#39); until then the per-replica memory store is the floor.
    rateLimit: {
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 5 },
        '/sign-in/magic-link': { window: 60, max: 5 },
        '/request-password-reset': { window: 60, max: 3 },
        '/reset-password': { window: 60, max: 5 },
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            // Anonymous users get a synthesised address; mailing it bounces.
            if (user.isAnonymous) return
            await sendWelcome({
              to: user.email,
              ...welcomeEmail({ appName, url: config.baseURL, locale }),
            })
          },
        },
      },
    },
    // Google OAuth provider (only enabled when credentials are provided)
    ...(config.googleClientId &&
      config.googleClientSecret && {
        socialProviders: {
          google: {
            clientId: config.googleClientId,
            clientSecret: config.googleClientSecret,
          },
        },
      }),
    plugins: [
      ...(config.additionalPlugins ?? []),
      anonymous(),
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await sendEmail({
            to: email,
            ...magicLinkEmail({ appName, url, locale }),
          })
        },
        expiresIn: 300, // 5 minutes
        disableSignUp: false, // Allow new users to sign up via magic link
      }),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
