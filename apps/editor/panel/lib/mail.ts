import nodemailer, { type Transporter } from 'nodemailer'
import { queryOne, type RowDataPacket } from './db'
import { formatDate } from './i18n'
import { type MailFact, type MailPage, renderMail } from './mail-template'
import type { Lang } from './types'

/**
 * Delivery for every transactional message the system owes a person.
 *
 * Two transports, chosen by `MAIL_TRANSPORT`:
 *
 * - `console` (default) prints the message with its link, so every flow is
 *   exercisable end to end without a mail server.
 * - `smtp` sends through SMTP.
 *
 * Raw tokens and temporary passwords appear here and nowhere else: not in the
 * API response, not in the audit trail, not in the database.
 *
 * Two rules the set follows:
 *
 * 1. Every promise the copy makes is kept by code. The access-request receipt
 *    says another message will follow — so approval AND rejection both send
 *    one.
 * 2. Anything that changes how an account can be signed into tells its owner,
 *    unprompted. A password change, a new second factor, a forced sign-out and
 *    a suspension are all things a person must be able to notice.
 */

export function appUrl(path: string): string {
  const base = process.env.APP_URL ?? 'http://localhost:3000'
  return new URL(path, base).toString()
}

function origin(): string {
  return appUrl('/').replace(/\/$/, '')
}

/**
 * Signature under every message, mirroring the sign-in screen's notice. Read per
 * send rather than at import: the deploy bundle loads its .env in the boot hook,
 * which can run after this module is first evaluated.
 */
function footer(lang: Lang): string {
  const line =
    lang === 'tr'
      ? 'DigitalTwin — kurum içi sistem, yalnızca yetkili personel'
      : 'DigitalTwin — internal system, authorised personnel only'
  return `${line}\n${appUrl('/')}`
}

/**
 * The language to write to somebody in.
 *
 * Recorded from their own session when they sign in. Anyone who has never
 * signed in — an invitation's recipient, an outside access request — has no
 * preference yet, and English is the system default.
 */
export async function localeFor(email: string): Promise<Lang> {
  try {
    const row = await queryOne<RowDataPacket & { locale: string }>(
      'SELECT locale FROM users WHERE email = ? LIMIT 1',
      [email],
    )
    return row?.locale === 'tr' ? 'tr' : 'en'
  } catch {
    // A console-transport development database may predate the column.
    return 'en'
  }
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

/**
 * One composer for every message: the plain-text part is derived from the same
 * fields as the HTML, so the two can never drift into saying different things.
 */
async function compose(
  to: string,
  lang: Lang,
  subject: string,
  page: Omit<MailPage, 'origin' | 'lang' | 'footer'>,
): Promise<void> {
  const lines: string[] = [page.heading, '', page.intro]
  if (page.facts?.length) {
    lines.push('')
    for (const fact of page.facts) lines.push(`${fact.label}: ${fact.value}`)
  }
  if (page.callout) {
    lines.push('', `${page.callout.label}: ${page.callout.value}`)
  }
  if (page.action) {
    lines.push('', page.action.label, page.action.url)
  }
  if (page.note) lines.push('', page.note)
  lines.push('', footer(lang))

  await send({
    to,
    subject,
    body: lines.join('\n'),
    html: renderMail({ ...page, lang, origin: origin(), footer: footer(lang) }),
  })
}

/** "DigitalTwin — <what happened>", the shape every subject line takes. */
function subject(what: string): string {
  return `DigitalTwin — ${what}`
}

function when(lang: Lang, at: Date = new Date()): MailFact {
  return { label: lang === 'tr' ? 'Zaman' : 'When', value: formatDate(lang, at) }
}

function account(lang: Lang, email: string): MailFact {
  return { label: lang === 'tr' ? 'Hesap' : 'Account', value: email }
}

/* ── Access ──────────────────────────────────────────────────────────────── */

export async function deliverResetLink(opts: {
  email: string
  fullName: string
  token: string
  expiresAt: Date
  lang?: Lang
}): Promise<void> {
  const lang = opts.lang ?? (await localeFor(opts.email))
  const minutes = Math.max(1, Math.round((opts.expiresAt.getTime() - Date.now()) / 60_000))
  const url = appUrl(`/reset/${opts.token}`)

  const copy =
    lang === 'tr'
      ? {
          subject: 'parola sıfırlama',
          label: 'Parola sıfırlama',
          heading: 'Yeni bir parola belirleyin',
          intro: `${opts.fullName}, DigitalTwin hesabınız için yeni bir parola seçmek üzere aşağıdaki düğmeyi kullanın.`,
          action: 'Yeni parola belirle',
          note: `Bağlantı tek kullanımlıktır ve ${minutes} dakika sonra geçersiz olur. Bu isteği siz yapmadıysanız bu iletiyi yok sayın; parolanız değişmez ve istek yöneticilere kaydedilir.`,
          preheader: `Sıfırlama bağlantınız ${minutes} dakika geçerli.`,
        }
      : {
          subject: 'password reset',
          label: 'Password reset',
          heading: 'Set a new password',
          intro: `${opts.fullName}, use the button below to choose a new password for your DigitalTwin account.`,
          action: 'Set a new password',
          note: `The link is single-use and expires in ${minutes} minutes. If you did not ask for it, ignore this message — your password stays as it is, and the request is recorded for the administrators.`,
          preheader: `Your reset link is valid for ${minutes} minutes.`,
        }

  await compose(opts.email, lang, subject(copy.subject), {
    label: copy.label,
    heading: copy.heading,
    intro: copy.intro,
    facts: [account(lang, opts.email), when(lang)],
    action: { label: copy.action, url },
    note: copy.note,
    preheader: copy.preheader,
  })
}

export async function deliverInvite(opts: {
  email: string
  fullName: string
  token: string
  expiresAt: string
  lang?: Lang
}): Promise<void> {
  const lang = opts.lang ?? (await localeFor(opts.email))
  const days = Math.max(
    1,
    Math.ceil((new Date(opts.expiresAt).getTime() - Date.now()) / 86_400_000),
  )
  const url = appUrl(`/welcome?token=${opts.token}`)

  const copy =
    lang === 'tr'
      ? {
          subject: 'hesabınız hazır',
          label: 'Hesap oluşturuldu',
          heading: 'Hesabınız hazır',
          intro: `${opts.fullName}, bir yönetici sizin için bir DigitalTwin hesabı oluşturdu. Başlamak için parolanızı belirleyin ve iki adımlı doğrulamayı kurun.`,
          action: 'Hesabımı etkinleştir',
          note: `Bağlantı ${days} gün geçerlidir. İlk girişte kendi parolanızı belirlemeniz istenecek.`,
          preheader: 'Parolanızı belirleyin ve iki adımlı doğrulamayı kurun.',
        }
      : {
          subject: 'your account is ready',
          label: 'Account created',
          heading: 'Your account is ready',
          intro: `${opts.fullName}, an administrator created a DigitalTwin account for you. Set your password and enrol two-factor authentication to get started.`,
          action: 'Activate my account',
          note: `The link is valid for ${days} day(s). You will be asked to set your own password on first sign-in.`,
          preheader: 'Set your password and enrol two-factor authentication.',
        }

  await compose(opts.email, lang, subject(copy.subject), {
    label: copy.label,
    heading: copy.heading,
    intro: copy.intro,
    facts: [account(lang, opts.email)],
    action: { label: copy.action, url },
    note: copy.note,
    preheader: copy.preheader,
  })
}

export async function deliverRequestReceipt(opts: {
  email: string
  fullName: string
  lang?: Lang
}): Promise<void> {
  const lang = opts.lang ?? 'en'

  const copy =
    lang === 'tr'
      ? {
          subject: 'hesap talebiniz alındı',
          label: 'Talep alındı',
          heading: 'Talebiniz inceleniyor',
          intro: `${opts.fullName}, erişim talebiniz yöneticilere iletildi. Karar verildiğinde — olumlu ya da olumsuz — size bir ileti daha göndereceğiz.`,
          preheader: 'Bir yönetici erişim talebinizi inceleyecek.',
        }
      : {
          subject: 'account request received',
          label: 'Request received',
          heading: 'Your request is under review',
          intro: `${opts.fullName}, your access request is with the administrators. You will get another message once it has been decided, either way.`,
          preheader: 'An administrator will review your access request.',
        }

  await compose(opts.email, lang, subject(copy.subject), {
    label: copy.label,
    heading: copy.heading,
    intro: copy.intro,
    facts: [account(lang, opts.email), when(lang)],
    preheader: copy.preheader,
  })
}

/** The other half of the receipt's promise. Silence is not an answer. */
export async function deliverRequestRejected(opts: {
  email: string
  fullName?: string
  lang?: Lang
}): Promise<void> {
  const lang = opts.lang ?? (await localeFor(opts.email))
  const name = opts.fullName ? `${opts.fullName}, ` : ''

  const copy =
    lang === 'tr'
      ? {
          subject: 'hesap talebiniz hakkında',
          label: 'Talep sonuçlandı',
          heading: 'Erişim talebiniz onaylanmadı',
          intro: `${name}DigitalTwin erişim talebiniz şu an için onaylanmadı. Bu bir hata olduğunu düşünüyorsanız kurum içinde ilgili yöneticiyle görüşün; talebiniz yeniden değerlendirilebilir.`,
          preheader: 'Erişim talebiniz bu sefer onaylanmadı.',
        }
      : {
          subject: 'about your account request',
          label: 'Request closed',
          heading: 'Your access request was not approved',
          intro: `${name}your request for DigitalTwin access was not approved at this time. If you believe that is a mistake, speak to the administrator responsible for your team — a request can be reconsidered.`,
          preheader: 'Your access request was not approved this time.',
        }

  await compose(opts.email, lang, subject(copy.subject), {
    label: copy.label,
    heading: copy.heading,
    intro: copy.intro,
    facts: [account(lang, opts.email), when(lang)],
    preheader: copy.preheader,
  })
}

/* ── Security notices ────────────────────────────────────────────────────── */

/**
 * A password changed — by a reset link, or on a forced first sign-in. The
 * point is that the owner finds out even when it was not them who did it.
 */
export async function deliverPasswordChanged(opts: {
  email: string
  fullName: string
  via: 'reset' | 'first-sign-in'
  lang?: Lang
}): Promise<void> {
  const lang = opts.lang ?? (await localeFor(opts.email))

  const howTr = {
    reset: 'Sıfırlama bağlantısı',
    self: 'Hesap ayarları',
    'first-sign-in': 'İlk giriş',
  }
  const howEn = { reset: 'Reset link', self: 'Account settings', 'first-sign-in': 'First sign-in' }

  const copy =
    lang === 'tr'
      ? {
          subject: 'parolanız değiştirildi',
          label: 'Güvenlik bildirimi',
          heading: 'Parolanız değiştirildi',
          intro: `${opts.fullName}, DigitalTwin hesabınızın parolası az önce değiştirildi.`,
          howLabel: 'Yöntem',
          how: howTr[opts.via],
          note: 'Bunu siz yaptıysanız yapmanız gereken bir şey yok. Yapmadıysanız hemen parolanızı sıfırlayın ve bir yöneticiye haber verin.',
          preheader: 'Hesabınızın parolası değiştirildi.',
        }
      : {
          subject: 'your password was changed',
          label: 'Security notice',
          heading: 'Your password was changed',
          intro: `${opts.fullName}, the password on your DigitalTwin account has just been changed.`,
          howLabel: 'Method',
          how: howEn[opts.via],
          note: 'If that was you, there is nothing to do. If it was not, reset your password immediately and tell an administrator.',
          preheader: 'The password on your account was changed.',
        }

  await compose(opts.email, lang, subject(copy.subject), {
    label: copy.label,
    heading: copy.heading,
    intro: copy.intro,
    facts: [account(lang, opts.email), { label: copy.howLabel, value: copy.how }, when(lang)],
    note: copy.note,
    preheader: copy.preheader,
  })
}

/**
 * An administrator issued a temporary password. Without this message the
 * password only exists on the administrator's screen, and gets read out over
 * a phone — which is the worst way to move a credential.
 */
export async function deliverTemporaryPassword(opts: {
  email: string
  fullName: string
  temporaryPassword: string
  lang?: Lang
}): Promise<void> {
  const lang = opts.lang ?? (await localeFor(opts.email))
  const url = appUrl('/signin')

  const copy =
    lang === 'tr'
      ? {
          subject: 'geçici parolanız',
          label: 'Geçici parola',
          heading: 'Geçici bir parola verildi',
          intro: `${opts.fullName}, bir yönetici hesabınıza geçici bir parola tanımladı. Bununla giriş yapın; sistem hemen kendi parolanızı belirlemenizi isteyecek.`,
          calloutLabel: 'Geçici parola',
          action: 'Giriş yap',
          note: 'Bu parola yalnızca bir kez, kendi parolanızı belirlemeniz için geçerlidir. Böyle bir talebiniz olmadıysa bir yöneticiye haber verin.',
          preheader: 'Giriş yapın ve kendi parolanızı belirleyin.',
        }
      : {
          subject: 'your temporary password',
          label: 'Temporary password',
          heading: 'A temporary password was issued',
          intro: `${opts.fullName}, an administrator set a temporary password on your account. Sign in with it and you will be asked to choose your own straight away.`,
          calloutLabel: 'Temporary password',
          action: 'Sign in',
          note: 'This password works once, to let you set your own. If you did not ask for it, tell an administrator.',
          preheader: 'Sign in and choose your own password.',
        }

  await compose(opts.email, lang, subject(copy.subject), {
    label: copy.label,
    heading: copy.heading,
    intro: copy.intro,
    facts: [account(lang, opts.email), when(lang)],
    callout: { label: copy.calloutLabel, value: opts.temporaryPassword },
    action: { label: copy.action, url },
    note: copy.note,
    preheader: copy.preheader,
  })
}

/** Two-factor authentication was enrolled — or taken away. */
export async function deliverTwoFactorChanged(opts: {
  email: string
  fullName: string
  enabled: boolean
  lang?: Lang
}): Promise<void> {
  const lang = opts.lang ?? (await localeFor(opts.email))

  const copy =
    lang === 'tr'
      ? {
          subject: opts.enabled ? 'iki adımlı doğrulama açıldı' : 'iki adımlı doğrulama kapatıldı',
          label: 'Güvenlik bildirimi',
          heading: opts.enabled ? 'İki adımlı doğrulama açıldı' : 'İki adımlı doğrulama kapatıldı',
          intro: opts.enabled
            ? `${opts.fullName}, hesabınızda iki adımlı doğrulama kuruldu. Bundan sonra her girişte doğrulayıcı uygulamanızdaki kod istenecek.`
            : `${opts.fullName}, hesabınızdaki iki adımlı doğrulama kaldırıldı. Girişte artık yalnızca parolanız istenecek.`,
          note: 'Bunu siz yapmadıysanız hemen bir yöneticiye haber verin.',
          preheader: opts.enabled
            ? 'Hesabınıza ikinci bir doğrulama adımı eklendi.'
            : 'Hesabınızdaki ikinci doğrulama adımı kaldırıldı.',
        }
      : {
          subject: opts.enabled
            ? 'two-factor authentication enabled'
            : 'two-factor authentication removed',
          label: 'Security notice',
          heading: opts.enabled
            ? 'Two-factor authentication is on'
            : 'Two-factor authentication was removed',
          intro: opts.enabled
            ? `${opts.fullName}, a second step was added to your account. From now on every sign-in asks for the code from your authenticator app.`
            : `${opts.fullName}, the second step was removed from your account. Sign-in now asks for your password alone.`,
          note: 'If that was not you, tell an administrator immediately.',
          preheader: opts.enabled
            ? 'A second sign-in step was added to your account.'
            : 'The second sign-in step was removed from your account.',
        }

  await compose(opts.email, lang, subject(copy.subject), {
    label: copy.label,
    heading: copy.heading,
    intro: copy.intro,
    facts: [account(lang, opts.email), when(lang)],
    note: copy.note,
    preheader: copy.preheader,
  })
}

/** Every session was ended — by the owner, or by an administrator. */
export async function deliverSessionsRevoked(opts: {
  email: string
  fullName: string
  byAdmin: boolean
  lang?: Lang
}): Promise<void> {
  const lang = opts.lang ?? (await localeFor(opts.email))
  const url = appUrl('/signin')

  const copy =
    lang === 'tr'
      ? {
          subject: 'tüm oturumlarınız kapatıldı',
          label: 'Güvenlik bildirimi',
          heading: 'Tüm cihazlardan çıkış yapıldı',
          intro: opts.byAdmin
            ? `${opts.fullName}, bir yönetici hesabınızın açık tüm oturumlarını kapattı. Devam etmek için yeniden giriş yapmanız gerekir.`
            : `${opts.fullName}, hesabınızın açık tüm oturumları kapatıldı. Devam etmek için yeniden giriş yapmanız gerekir.`,
          action: 'Yeniden giriş yap',
          note: 'Bunu beklemiyorduysanız parolanızı değiştirin ve bir yöneticiye haber verin.',
          preheader: 'Açık tüm oturumlarınız sonlandırıldı.',
        }
      : {
          subject: 'you were signed out everywhere',
          label: 'Security notice',
          heading: 'Signed out on every device',
          intro: opts.byAdmin
            ? `${opts.fullName}, an administrator ended every open session on your account. You will need to sign in again to carry on.`
            : `${opts.fullName}, every open session on your account has been ended. You will need to sign in again to carry on.`,
          action: 'Sign in again',
          note: 'If you were not expecting this, change your password and tell an administrator.',
          preheader: 'Every open session on your account was ended.',
        }

  await compose(opts.email, lang, subject(copy.subject), {
    label: copy.label,
    heading: copy.heading,
    intro: copy.intro,
    facts: [account(lang, opts.email), when(lang)],
    action: { label: copy.action, url },
    note: copy.note,
    preheader: copy.preheader,
  })
}

/** Access suspended or restored. A sign-in that simply fails explains nothing. */
export async function deliverAccessChanged(opts: {
  email: string
  fullName: string
  active: boolean
  lang?: Lang
}): Promise<void> {
  const lang = opts.lang ?? (await localeFor(opts.email))

  const copy =
    lang === 'tr'
      ? {
          subject: opts.active ? 'erişiminiz yeniden açıldı' : 'erişiminiz durduruldu',
          label: 'Hesap durumu',
          heading: opts.active ? 'Erişiminiz yeniden açıldı' : 'Erişiminiz durduruldu',
          intro: opts.active
            ? `${opts.fullName}, DigitalTwin hesabınız yeniden etkin. Her zamanki gibi giriş yapabilirsiniz.`
            : `${opts.fullName}, DigitalTwin hesabınız bir yönetici tarafından devre dışı bırakıldı. Şu an giriş yapamazsınız; çizimleriniz olduğu gibi duruyor.`,
          note: opts.active
            ? undefined
            : 'Bunun nedenini öğrenmek için ekibinizden sorumlu yöneticiyle görüşün.',
          preheader: opts.active ? 'Hesabınız yeniden etkin.' : 'Hesabınız şu an devre dışı.',
        }
      : {
          subject: opts.active ? 'your access was restored' : 'your access was suspended',
          label: 'Account status',
          heading: opts.active ? 'Your access was restored' : 'Your access was suspended',
          intro: opts.active
            ? `${opts.fullName}, your DigitalTwin account is active again. You can sign in as usual.`
            : `${opts.fullName}, an administrator has deactivated your DigitalTwin account. You cannot sign in for now; your work is untouched.`,
          note: opts.active
            ? undefined
            : 'Speak to the administrator responsible for your team to find out why.',
          preheader: opts.active ? 'Your account is active again.' : 'Your account is inactive.',
        }

  await compose(opts.email, lang, subject(copy.subject), {
    label: copy.label,
    heading: copy.heading,
    intro: copy.intro,
    facts: [account(lang, opts.email), when(lang)],
    note: copy.note,
    preheader: copy.preheader,
  })
}

/* ── Product ─────────────────────────────────────────────────────────────── */

/** An administrator published somebody's project as a site. */
export async function deliverScenePublished(opts: {
  email: string
  fullName: string
  sceneName: string
  sceneId: string
  lang?: Lang
}): Promise<void> {
  const lang = opts.lang ?? (await localeFor(opts.email))
  const url = appUrl(`/scene/${opts.sceneId}`)

  const copy =
    lang === 'tr'
      ? {
          subject: 'projeniz yayınlandı',
          label: 'Proje yayınlandı',
          heading: 'Projeniz yayınlandı',
          intro: `${opts.fullName}, çiziminiz bir yönetici tarafından onaylandı ve saha olarak yayınlandı. Artık erişimi olan herkes tarafından görülebilir.`,
          projectLabel: 'Proje',
          action: 'Projeyi aç',
          preheader: 'Çiziminiz saha olarak yayınlandı.',
        }
      : {
          subject: 'your project was published',
          label: 'Project published',
          heading: 'Your project was published',
          intro: `${opts.fullName}, an administrator approved your drawing and published it as a site. It is now visible to everyone with access.`,
          projectLabel: 'Project',
          action: 'Open the project',
          preheader: 'Your drawing was published as a site.',
        }

  await compose(opts.email, lang, subject(copy.subject), {
    label: copy.label,
    heading: copy.heading,
    intro: copy.intro,
    facts: [{ label: copy.projectLabel, value: opts.sceneName }, when(lang)],
    action: { label: copy.action, url },
    preheader: copy.preheader,
  })
}

/* ── Diagnostics ─────────────────────────────────────────────────────────── */

/**
 * A message with nothing behind it, for checking that delivery and rendering
 * work from the console's Settings screen. It carries every element the set
 * uses — facts, a callout, a button, a note — so one send proves the lot.
 */
export async function deliverTestMessage(opts: {
  email: string
  fullName?: string
  lang?: Lang
}): Promise<void> {
  const lang = opts.lang ?? (await localeFor(opts.email))
  const name = opts.fullName ?? opts.email

  const copy =
    lang === 'tr'
      ? {
          subject: 'deneme',
          label: 'Deneme',
          heading: 'Bu bir deneme iletisidir',
          intro: `${name}, bu ileti DigitalTwin'in posta ayarlarını denemek için gönderildi. Arkasında bir işlem yok ve yapmanız gereken bir şey yok.`,
          calloutLabel: 'Örnek kod',
          action: 'Konsolu aç',
          note: 'Bu iletiyi düzgün okuyabiliyorsanız — logo, başlık, alanlar ve düğme yerli yerindeyse — posta ayarları çalışıyor demektir.',
          preheader: 'Posta ayarlarını denemek için gönderilen örnek ileti.',
          facts: [
            { label: 'Ortam', value: origin() },
            { label: 'Aktarım', value: process.env.MAIL_TRANSPORT ?? 'console' },
          ],
        }
      : {
          subject: 'test message',
          label: 'Test',
          heading: 'This is a test message',
          intro: `${name}, this message was sent to check DigitalTwin's mail settings. Nothing happened behind it and there is nothing for you to do.`,
          calloutLabel: 'Sample code',
          action: 'Open the console',
          note: 'If this reads properly — logo, heading, fields and button all in place — mail delivery is working.',
          preheader: 'A sample message, sent to check mail delivery.',
          facts: [
            { label: 'Environment', value: origin() },
            { label: 'Transport', value: process.env.MAIL_TRANSPORT ?? 'console' },
          ],
        }

  const facts: MailFact[] = [...copy.facts, when(lang)]

  await compose(opts.email, lang, subject(copy.subject), {
    label: copy.label,
    heading: copy.heading,
    intro: copy.intro,
    facts,
    callout: { label: copy.calloutLabel, value: '482 913' },
    action: { label: copy.action, url: appUrl('/console/overview') },
    note: copy.note,
    preheader: copy.preheader,
  })
}
