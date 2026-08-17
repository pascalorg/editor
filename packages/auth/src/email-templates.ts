/**
 * Copy and markup for the four transactional emails.
 *
 * The strings live here rather than going through `@pascal-app/editor`'s `tr`
 * dictionary on purpose: that package is the published UI layer and auth sits
 * below it, so importing it would invert the dependency. The app's default
 * locale is `tr`, which is why that is the default here too.
 */

export type EmailLocale = 'tr' | 'en'

export interface EmailContent {
  subject: string
  html: string
  text: string
}

interface Copy {
  subject: string
  heading: string
  body: string
  action: string
  /** Shown under the button; `{url}` is substituted. */
  fallback: string
  footer: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function layout(appName: string, copy: Copy, url: string): string {
  const safeUrl = escapeHtml(url)
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;">
      <tr>
        <td style="padding:32px;">
          <p style="margin:0 0 24px;font-size:14px;font-weight:600;letter-spacing:0.02em;">${escapeHtml(appName)}</p>
          <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;">${escapeHtml(copy.heading)}</h1>
          <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#3f3f46;">${escapeHtml(copy.body)}</p>
          <a href="${safeUrl}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#18181b;color:#ffffff;font-size:14px;text-decoration:none;">${escapeHtml(copy.action)}</a>
          <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#71717a;">${escapeHtml(copy.fallback)}<br /><a href="${safeUrl}" style="color:#3f3f46;word-break:break-all;">${safeUrl}</a></p>
          <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#a1a1aa;">${escapeHtml(copy.footer)}</p>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

function plain(appName: string, copy: Copy, url: string): string {
  return [appName, '', copy.heading, '', copy.body, '', url, '', copy.footer].join('\n')
}

function render(appName: string, copy: Copy, url: string): EmailContent {
  return {
    subject: copy.subject.replace('{appName}', appName),
    html: layout(appName, copy, url),
    text: plain(appName, copy, url),
  }
}

const MAGIC_LINK: Record<EmailLocale, Copy> = {
  tr: {
    subject: '{appName} giriş bağlantınız',
    heading: 'Giriş bağlantınız hazır',
    body: 'Hesabınıza girmek için aşağıdaki bağlantıya tıklayın. Bağlantı 5 dakika geçerlidir ve yalnızca bir kez kullanılabilir.',
    action: 'Giriş yap',
    fallback: 'Buton çalışmazsa bu adresi tarayıcınıza yapıştırın:',
    footer: 'Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz.',
  },
  en: {
    subject: 'Your {appName} sign-in link',
    heading: 'Your sign-in link is ready',
    body: 'Click the link below to sign in. It is valid for 5 minutes and can be used once.',
    action: 'Sign in',
    fallback: 'If the button does not work, paste this address into your browser:',
    footer: 'If you did not request this, you can safely ignore this email.',
  },
}

const VERIFY_EMAIL: Record<EmailLocale, Copy> = {
  tr: {
    subject: '{appName} e-posta adresinizi doğrulayın',
    heading: 'E-posta adresinizi doğrulayın',
    body: 'Hesabınızı güvence altına almak ve parola sıfırlama gibi işlemleri kullanabilmek için e-posta adresinizi doğrulayın.',
    action: 'E-postamı doğrula',
    fallback: 'Buton çalışmazsa bu adresi tarayıcınıza yapıştırın:',
    footer: 'Bu hesabı siz açmadıysanız bu e-postayı yok sayabilirsiniz.',
  },
  en: {
    subject: 'Verify your {appName} email address',
    heading: 'Verify your email address',
    body: 'Verify your email address to secure your account and enable flows such as password reset.',
    action: 'Verify email',
    fallback: 'If the button does not work, paste this address into your browser:',
    footer: 'If you did not create this account, you can safely ignore this email.',
  },
}

const RESET_PASSWORD: Record<EmailLocale, Copy> = {
  tr: {
    subject: '{appName} parolanızı sıfırlayın',
    heading: 'Parola sıfırlama',
    body: 'Yeni bir parola belirlemek için aşağıdaki bağlantıya tıklayın. Bağlantı 1 saat geçerlidir.',
    action: 'Parolamı sıfırla',
    fallback: 'Buton çalışmazsa bu adresi tarayıcınıza yapıştırın:',
    footer:
      'Parola sıfırlama isteğini siz yapmadıysanız parolanız değişmez; bu e-postayı yok sayabilirsiniz.',
  },
  en: {
    subject: 'Reset your {appName} password',
    heading: 'Reset your password',
    body: 'Click the link below to choose a new password. The link is valid for 1 hour.',
    action: 'Reset password',
    fallback: 'If the button does not work, paste this address into your browser:',
    footer:
      'If you did not request a reset, your password stays unchanged and you can ignore this email.',
  },
}

const WELCOME: Record<EmailLocale, Copy> = {
  tr: {
    subject: "{appName}'e hoş geldiniz",
    heading: 'Hoş geldiniz',
    body: 'Hesabınız hazır. Tarayıcıdan kat planı çizebilir, 3B modelinizi düzenleyebilir ve sahnelerinizi paylaşabilirsiniz.',
    action: 'Editörü aç',
    fallback: 'Buton çalışmazsa bu adresi tarayıcınıza yapıştırın:',
    footer: 'Sorunuz olursa bu e-postayı yanıtlamanız yeterli.',
  },
  en: {
    subject: 'Welcome to {appName}',
    heading: 'Welcome',
    body: 'Your account is ready. Draw floorplans in the browser, edit the 3D model and share your scenes.',
    action: 'Open the editor',
    fallback: 'If the button does not work, paste this address into your browser:',
    footer: 'Reply to this email if you have any questions.',
  },
}

export interface LinkEmailParams {
  appName: string
  url: string
  locale?: EmailLocale
}

export function magicLinkEmail({ appName, url, locale = 'tr' }: LinkEmailParams): EmailContent {
  return render(appName, MAGIC_LINK[locale], url)
}

export function verifyEmailEmail({ appName, url, locale = 'tr' }: LinkEmailParams): EmailContent {
  return render(appName, VERIFY_EMAIL[locale], url)
}

export function resetPasswordEmail({ appName, url, locale = 'tr' }: LinkEmailParams): EmailContent {
  return render(appName, RESET_PASSWORD[locale], url)
}

export function welcomeEmail({ appName, url, locale = 'tr' }: LinkEmailParams): EmailContent {
  return render(appName, WELCOME[locale], url)
}
