import { expect, test } from 'bun:test'
import { escapeHtml, renderMail } from './mail-template'

const base = {
  origin: 'https://opex.help',
  lang: 'en' as const,
  label: 'Password reset',
  heading: 'Set a new password',
  intro: 'Use the button below.',
  preheader: 'Valid for 30 minutes.',
  footer: 'DigitalTwin\nhttps://opex.help/',
}

test('escapes text that reaches the markup', () => {
  expect(escapeHtml('<script>alert("x")</script> & co')).toBe(
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co',
  )
})

test('a name from the database cannot inject markup', () => {
  const html = renderMail({ ...base, intro: '<img src=x onerror=alert(1)> Övür, hello.' })
  expect(html).not.toContain('<img src=x')
  expect(html).toContain('&lt;img src=x')
  // Non-ASCII must survive intact — the charset is declared, not escaped away.
  expect(html).toContain('Övür')
})

test('the action renders for Outlook, for everyone else, and as a pasteable address', () => {
  const url = 'https://opex.help/reset/abc123'
  const html = renderMail({ ...base, action: { label: 'Set a new password', url } })
  // The VML rectangle Outlook uses, the ordinary anchor, and the fallback box.
  expect(html.split(url).length - 1).toBe(3)
  expect(html).toContain('href="https://opex.help/reset/abc123"')
  expect(html).toContain('v:roundrect')
})

test('omitting the action drops the button and its fallback box', () => {
  const html = renderMail(base)
  expect(html).not.toContain('Or paste this address')
  expect(html).not.toContain('<a href')
  expect(html).not.toContain('v:roundrect')
})

test('the footer breaks across lines rather than printing an escape', () => {
  const html = renderMail(base)
  expect(html).toContain('DigitalTwin<br>https://opex.help/')
})

test('the frame speaks the recipient’s language', () => {
  const tr = renderMail({
    ...base,
    lang: 'tr',
    action: { label: 'Aç', url: 'https://opex.help/x' },
  })
  expect(tr).toContain('<html lang="tr">')
  expect(tr).toContain('Ya da bu adresi tarayıcınıza yapıştırın')
  expect(tr).toContain('Bu ileti otomatik olarak gönderildi')

  const en = renderMail({ ...base, action: { label: 'Open', url: 'https://opex.help/x' } })
  expect(en).toContain('<html lang="en">')
  expect(en).toContain('Or paste this address into your browser')
})

test('a callout value carries its own dark-mode class', () => {
  // Without dt-fg the inline near-black colour wins in dark mode and a
  // temporary password renders invisible — the one failure nobody can report,
  // because the reader cannot see there is anything to report.
  const html = renderMail({ ...base, callout: { label: 'Temporary password', value: 'S3cret!x' } })
  expect(html).toMatch(/class="dt-fg"[^>]*>S3cret!x</)
})

test('facts render as labelled rows', () => {
  const html = renderMail({
    ...base,
    facts: [
      { label: 'Account', value: 'a@b.c' },
      { label: 'When', value: '01/08/2026' },
    ],
  })
  expect(html).toContain('Account')
  expect(html).toContain('a@b.c')
  expect(html).toContain('01/08/2026')
})
