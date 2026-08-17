/**
 * Transactional email for the auth flows.
 *
 * Deliberately dependency-free: Resend's REST API is a single POST, and pulling
 * the SDK in would put a second HTTP client in a package that already ships to
 * the edge-capable Next runtime.
 */

export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
}

export type EmailSender = (message: EmailMessage) => Promise<void>

export interface ResendSenderConfig {
  apiKey: string
  /** RFC 5322 sender, e.g. `Menart 3D <hesap@menart3d.com>` */
  from: string
  /** Injected in tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export function createResendSender(config: ResendSenderConfig): EmailSender {
  const fetchImpl = config.fetchImpl ?? fetch

  return async (message) => {
    const response = await fetchImpl(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Resend rejected the message (${response.status}): ${detail.slice(0, 300)}`)
    }
  }
}

/**
 * Development sender. Prints the message — the magic link included — so the
 * passwordless flow is exercisable locally without an API key.
 */
export const logEmailSender: EmailSender = async (message) => {
  console.info(
    `\n[auth:email] to=${message.to}\n[auth:email] subject=${message.subject}\n${message.text}\n`,
  )
}

/**
 * Sender for an environment that has no delivery configured. It throws rather
 * than resolving, so the sign-in dialog reports a failure instead of telling
 * the user to check an inbox nothing was sent to.
 */
export function createUnconfiguredSender(reason: string): EmailSender {
  return async () => {
    throw new Error(reason)
  }
}

/**
 * Wraps a sender so a delivery failure is logged rather than thrown. Use it for
 * mail nobody is waiting on — the welcome note, the verification nudge sent
 * alongside a sign-up that already succeeded. Never for a magic link or a
 * password reset, where the send *is* the flow.
 */
export function bestEffort(send: EmailSender, label: string): EmailSender {
  return async (message) => {
    try {
      await send(message)
    } catch (error) {
      console.error(`[auth:email] ${label} to ${message.to} failed:`, error)
    }
  }
}
