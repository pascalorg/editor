import { describe, expect, test } from 'bun:test'
import {
  type EmailContent,
  magicLinkEmail,
  resetPasswordEmail,
  verifyEmailEmail,
  welcomeEmail,
} from '../src/email-templates'

const URL = 'https://menart3d.com/api/auth/magic-link/verify?token=abc123'

const ALL = [magicLinkEmail, verifyEmailEmail, resetPasswordEmail, welcomeEmail]

describe('every template', () => {
  test('names the app in the subject and carries the link in both parts', () => {
    for (const build of ALL) {
      const mail: EmailContent = build({ appName: 'Menart 3D', url: URL })
      expect(mail.subject).toContain('Menart 3D')
      expect(mail.subject).not.toContain('{appName}')
      expect(mail.html).toContain(URL.replace(/&/g, '&amp;'))
      expect(mail.text).toContain(URL)
    }
  })

  test('defaults to Turkish and renders English on request', () => {
    expect(magicLinkEmail({ appName: 'Menart 3D', url: URL }).subject).toBe(
      'Menart 3D giriş bağlantınız',
    )
    expect(magicLinkEmail({ appName: 'Menart 3D', url: URL, locale: 'en' }).subject).toBe(
      'Your Menart 3D sign-in link',
    )
  })
})

describe('escaping', () => {
  test('a query string in the link survives without breaking the attribute', () => {
    const url = 'https://menart3d.com/reset?token=a"b&next=/scene'
    const mail = resetPasswordEmail({ appName: 'Menart 3D', url })

    expect(mail.html).not.toContain('token=a"b')
    expect(mail.html).toContain('token=a&quot;b&amp;next=/scene')
    // The text part is not markup, so it keeps the address verbatim.
    expect(mail.text).toContain(url)
  })

  test('an app name with markup in it is escaped', () => {
    const mail = welcomeEmail({ appName: '<script>x</script>', url: URL })
    expect(mail.html).not.toContain('<script>')
    expect(mail.html).toContain('&lt;script&gt;')
  })
})
