import nodemailer, { type Transporter } from 'nodemailer';

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
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  return new URL(path, base).toString();
}

interface Envelope {
  to: string;
  subject: string;
  body: string;
}

let transporter: Transporter | null = null;

/**
 * One connection pool for the process. Built on first use rather than at import
 * so a console-transport deployment never opens a socket, and so a missing
 * SMTP_HOST is reported when someone actually asks for SMTP.
 */
function smtp(): Transporter {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  if (!host) throw new Error('MAIL_TRANSPORT="smtp" needs SMTP_HOST.');

  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;

  transporter = nodemailer.createTransport({
    host,
    port,
    // Implicit TLS on 465, STARTTLS elsewhere — the usual split, overridable.
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === '1' : port === 465,
    auth: user ? { user, pass } : undefined,
    pool: true,
  });

  return transporter;
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
  const transport = process.env.MAIL_TRANSPORT ?? 'console';

  if (transport === 'console') {
    console.info(
      `\n─── mail ───────────────────────────────────\n` +
        `To:      ${envelope.to}\n` +
        `Subject: ${envelope.subject}\n\n` +
        `${envelope.body}\n` +
        `────────────────────────────────────────────\n`,
    );
    return;
  }

  if (transport !== 'smtp') {
    console.error(`[mail] MAIL_TRANSPORT="${transport}" is not a transport; nothing was sent.`);
    return;
  }

  try {
    await smtp().sendMail({
      from: process.env.MAIL_FROM ?? 'DigitalTwin <no-reply@netlog.com.tr>',
      to: envelope.to,
      subject: envelope.subject,
      text: envelope.body,
    });
  } catch (err) {
    // The address is logged, the body is not — it carries a single-use token.
    console.error(`[mail] delivery to ${envelope.to} failed:`, err);
  }
}

export async function deliverResetLink(opts: {
  email: string;
  fullName: string;
  token: string;
  expiresAt: Date;
}): Promise<void> {
  const minutes = Math.max(1, Math.round((opts.expiresAt.getTime() - Date.now()) / 60_000));
  await send({
    to: opts.email,
    subject: 'DigitalTwin — password reset',
    body:
      `${opts.fullName},\n\n` +
      `Open this single-use link to set a new password:\n` +
      `${appUrl(`/reset/${opts.token}`)}\n\n` +
      `It expires in ${minutes} minutes. If you did not ask for it, ignore this message — ` +
      `an administrator has been notified of the request.`,
  });
}

export async function deliverInvite(opts: {
  email: string;
  fullName: string;
  token: string;
  temporaryPassword?: string;
  expiresAt: string;
}): Promise<void> {
  const days = Math.max(1, Math.ceil((new Date(opts.expiresAt).getTime() - Date.now()) / 86_400_000));
  await send({
    to: opts.email,
    subject: 'DigitalTwin — your account is ready',
    body:
      `${opts.fullName},\n\n` +
      `An administrator created a DigitalTwin account for you. Open this link to set ` +
      `your password and enrol two-factor authentication:\n` +
      `${appUrl(`/welcome?token=${opts.token}`)}\n\n` +
      (opts.temporaryPassword ? `Temporary password: ${opts.temporaryPassword}\n\n` : '') +
      `The link is valid for ${days} day(s).`,
  });
}

export async function deliverRequestReceipt(opts: { email: string; fullName: string }): Promise<void> {
  await send({
    to: opts.email,
    subject: 'DigitalTwin — account request received',
    body:
      `${opts.fullName},\n\n` +
      `Your access request is with the administrators. You will get another message ` +
      `with a sign-in link once it is approved.`,
  });
}
