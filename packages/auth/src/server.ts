import type { Database } from '@pascal-app/db'
import { schema } from '@pascal-app/db'
import type { BetterAuthOptions } from 'better-auth'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { lastLoginMethod, magicLink } from 'better-auth/plugins'

export interface SendMagicLinkParams {
  email: string
  url: string
  token: string
}

export interface AuthConfig {
  db: Database
  appName: string
  baseURL: string
  secret: string
  /** Google OAuth client ID */
  googleClientId?: string
  /** Google OAuth client secret */
  googleClientSecret?: string
  /** Callback to send magic link emails */
  sendMagicLink?: (params: SendMagicLinkParams) => Promise<void>
  /** Additional plugins to add (e.g., nextCookies for web) */
  additionalPlugins?: BetterAuthOptions['plugins']
}

/**
 * Creates a Better Auth instance with full configuration including:
 * - Magic link authentication
 * - Custom session with activePropertyId
 * - Session cookie caching
 */
export function createAuth(config: AuthConfig): ReturnType<typeof betterAuth> {
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
      additionalFields: {
        // Additional fields for the session table
        activePropertyId: {
          type: 'string',
        },
      },
    },
    // Account linking — always enabled so magic link + Google users can share accounts
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ['google', 'email'],
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
      // Track which login method was last used (e.g., "google", "magic-link")
      lastLoginMethod(),
      // Magic link authentication
      ...(config.sendMagicLink
        ? [
            magicLink({
              sendMagicLink: config.sendMagicLink,
              expiresIn: 300, // 5 minutes
              disableSignUp: false, // Allow new users to sign up via magic link
            }),
          ]
        : []),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
