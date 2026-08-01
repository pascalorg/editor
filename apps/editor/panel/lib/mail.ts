import nodemailer, { type Transporter } from 'nodemailer'
import { renderMail } from './mail-template'

/**
 * Delivery for the three transactional messages the auth flows send.
 *
 * Two transports, chosen by `MAIL_TRANSPORT`:
 *
 * - `console` (default) prints the message with its link, so every flow is
 *   exercisable end to end without a mail server.
 * - `smtp` sends through SMTP.
 *
 * The raw token appears here and nowhere else: not in the API response, not in
 * the audit trail, not in the database.
 */

export function appUrl(path: string): string {
  const base = process.env.APP_URL ?? 'http://localhost:3000'
  return new URL(path, base).toString()
}

/**
 * Signature under every message, mirroring the sign-in screen's notice. Read per
 * send rather than at import: the deploy bundle loads its .env in the boot hook,
 * which can run after this module is first evaluated.
 */
function footer(): string {
  return `DigitalTwin — internal system, authorised personnel only\n${appUrl('/')}`
}

interface Envelope {
  to: string
  subject: string
  /** text/plain part. Always sent — it is what the console transport prints. */
  body: string
  html?: string
}

let transporter: Transporter | null = null

/**
 * One connection pool for the process. Built on first use rather than at import
 * so a console-transport deployment never opens a socket, and so a missing
 * SMTP_HOST is reported when someone actually asks for SMTP.
 */
function smtp(): Transporter {
  if (transporter) return transporter

  const host = process.env.SMTP_HOST
  if (!host) throw new Error('MAIL_TRANSPORT="smtp" needs SMTP_HOST.')

  const port = Number(process.env.SMTP_PORT ?? 587)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASSWORD

  transporter = nodemailer.createTransport({
    host,
    port,
    // Implicit TLS on 465, STARTTLS elsewhere — the usual split, overridable.
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === '1' : port === 465,
    auth: user ? { user, pass } : undefined,
    pool: true,
  })

  return transporter
}

/**
 * Sends, and never throws.
 *
 * Every caller awaits this inline in a request handler, and two of them must not
 * be able to fail: `POST /api/auth/reset` deliberately answers the same way
 * whether or not the address exists, so letting a dead mail server turn one case
 * into a 500 would hand out an account-enumeration oracle. A failure is loud in
 * the logs and invisible to the caller — which is the same thing a queue would
 * do, one retry later.
 */
async function send(envelope: Envelope): Promise<void> {
  const transport = process.env.MAIL_TRANSPORT ?? 'console'

  if (transport === 'console') {
    console.info(
      `\n─── mail ───────────────────────────────────\n` +
        `To:      ${envelope.to}\n` +
        `Subject: ${envelope.subject}\n\n` +
        `${envelope.body}\n` +
        `────────────────────────────────────────────\n`,
    )
    return
  }

  if (transport !== 'smtp') {
    console.error(`[mail] MAIL_TRANSPORT="${transport}" is not a transport; nothing was sent.`)
    return
  }

  try {
    await smtp().sendMail({
      from: process.env.MAIL_FROM ?? 'DigitalTwin <no-reply@netlog.com.tr>',
      to: envelope.to,
      subject: envelope.subject,
      text: envelope.body,
      html: envelope.html,
    })
  } catch (err) {
    // The address is logged, the body is not — it carries a single-use token.
    console.error(`[mail] delivery to ${envelope.to} failed:`, err)
  }
}

export async function deliverResetLink(opts: {
  email: string
  fullName: string
  token: string
  expiresAt: Date
}): Promise<void> {
  const minutes = Math.max(1, Math.round((opts.expiresAt.getTime() - Date.now()) / 60_000))
  const url = appUrl(`/reset/${opts.token}`)
  const note =
    `The link is single-use and expires in ${minutes} minutes. If you did not ask for it, ` +
    `ignore this message — an administrator has been notified of the request.`

  await send({
    to: opts.email,
    subject: 'DigitalTwin — password reset',
    body: `${opts.fullName},\n\nOpen this single-use link to set a new password:\n${url}\n\n${note}`,
    html: renderMail({
      label: 'Password reset',
      heading: 'Set a new password',
      intro: `${opts.fullName}, use the button below to choose a new password for your DigitalTwin account.`,
      action: { label: 'Set a new password', url },
      note,
      preheader: `Your reset link is valid for ${minutes} minutes.`,
      origin: appUrl('/').replace(/\/$/, ''),
      footer: footer(),
    }),
  })
}

export async function deliverInvite(opts: {
  email: string
  fullName: string
  token: string
  temporaryPassword?: string
  expiresAt: string
}): Promise<void> {
  const days = Math.max(
    1,
    Math.ceil((new Date(opts.expiresAt).getTime() - Date.now()) / 86_400_000),
  )
  const url = appUrl(`/welcome?token=${opts.token}`)
  const note = `The link is valid for ${days} day(s). You will be asked to set your own password on first sign-in.`

  await send({
    to: opts.email,
    subject: 'DigitalTwin — your account is ready',
    body:
      `${opts.fullName},\n\n` +
      `An administrator created a DigitalTwin account for you. Open this link to set ` +
      `your password and enrol two-factor authentication:\n${url}\n\n` +
      (opts.temporaryPassword ? `Temporary password: ${opts.temporaryPassword}\n\n` : '') +
      note,
    html: renderMail({
      label: 'Account created',
      heading: 'Your account is ready',
      intro: `${opts.fullName}, an administrator created a DigitalTwin account for you. Set your password and enrol two-factor authentication to get started.`,
      callout: opts.temporaryPassword
        ? { label: 'Temporary password', value: opts.temporaryPassword }
        : undefined,
      action: { label: 'Activate my account', url },
      note,
      preheader: 'Set your password and enrol two-factor authentication.',
      origin: appUrl('/').replace(/\/$/, ''),
      footer: footer(),
    }),
  })
}

export async function deliverRequestReceipt(opts: {
  email: string
  fullName: string
}): Promise<void> {
  const intro =
    'Your access request is with the administrators. You will get another message with a sign-in link once it is approved.'

  await send({
    to: opts.email,
    subject: 'DigitalTwin — account request received',
    body: `${opts.fullName},\n\n${intro}`,
    html: renderMail({
      label: 'Request received',
      heading: 'Your request is under review',
      intro: `${opts.fullName}, ${intro}`,
      preheader: 'An administrator will review your access request.',
      origin: appUrl('/').replace(/\/$/, ''),
      footer: footer(),
    }),
  })
}
