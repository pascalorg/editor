import { expect, test } from 'bun:test'
import { escapeHtml, renderMail } from './mail-template'

const base = {
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

test('the action renders as both a button and a pasteable address', () => {
  const url = 'https://opex.help/reset/abc123'
  const html = renderMail({ ...base, action: { label: 'Set a new password', url } })
  // Once in the href, once in the fallback box.
  expect(html.split(url).length - 1).toBe(2)
  expect(html).toContain('href="https://opex.help/reset/abc123"')
})

test('omitting the action drops the button and its fallback box', () => {
  const html = renderMail(base)
  expect(html).not.toContain('Or paste this address')
  expect(html).not.toContain('<a href')
})

test('the footer breaks across lines rather than printing an escape', () => {
  const html = renderMail(base)
  expect(html).toContain('DigitalTwin<br>https://opex.help/')
})
