import {
  createResendSender,
  createUnconfiguredSender,
  type EmailSender,
  logEmailSender,
} from '@pascal-app/auth'
import { env } from '../env.mjs'

const DEFAULT_FROM = 'Menart 3D <onboarding@resend.dev>'

/**
 * Resolves the transactional sender from the environment.
 *
 * Three outcomes, and the middle one is the point: without an API key in dev the
 * magic link is printed to the terminal, so the passwordless flow stays testable
 * locally. In production the same gap throws instead, because a sender that
 * quietly succeeds would show the user "check your email" for mail that was
 * never sent.
 */
export function resolveEmailSender(): EmailSender {
  if (env.RESEND_API_KEY) {
    return createResendSender({
      apiKey: env.RESEND_API_KEY,
      from: env.EMAIL_FROM ?? DEFAULT_FROM,
    })
  }

  if (process.env.NODE_ENV !== 'production') return logEmailSender

  return createUnconfiguredSender(
    'Transactional email is not configured: set RESEND_API_KEY (and EMAIL_FROM).',
  )
}
