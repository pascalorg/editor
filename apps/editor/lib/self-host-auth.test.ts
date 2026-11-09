import { expect, test } from 'bun:test'
import {
  issueSession,
  resolveAuthMode,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionPrincipal,
  verifyPassword,
  verifySession,
} from './self-host-auth'

const publicRequest = (cookie?: string) =>
  new Request('https://pascal.example/scenes', {
    headers: { host: 'pascal.example', ...(cookie ? { cookie } : {}) },
  })

test('a loopback host is open without any configuration', () => {
  const request = new Request('http://pascal.localhost:3002/', {
    headers: { host: 'pascal.localhost:3002' },
  })
  expect(resolveAuthMode(request, {})).toBe('open')
})

test('a network host with nothing configured is refused', () => {
  expect(resolveAuthMode(publicRequest(), {})).toBe('unconfigured')
})

test('an upstream proxy can take over authentication explicitly', () => {
  expect(resolveAuthMode(publicRequest(), { PASCAL_AUTH: 'proxy' })).toBe('open')
})

test('a password requires a session even on loopback', () => {
  const request = new Request('http://localhost:3002/', { headers: { host: 'localhost:3002' } })
  expect(resolveAuthMode(request, { PASCAL_ADMIN_PASSWORD: 'secret' })).toBe('password')
})

test('a session issued for the password identifies the admin', () => {
  const env = { PASCAL_ADMIN_PASSWORD: 'secret' }
  const session = issueSession(env)
  expect(sessionPrincipal(publicRequest(`${SESSION_COOKIE}=${session}`), env)).toBe('admin')
  expect(sessionPrincipal(publicRequest(), env)).toBeNull()
})

test('changing the password signs every session out', () => {
  const session = issueSession({ PASCAL_ADMIN_PASSWORD: 'secret' })
  expect(verifySession(session, { PASCAL_ADMIN_PASSWORD: 'rotated' })).toBe(false)
})

test('a session expires after its lifetime and never validates from the future', () => {
  const env = { PASCAL_ADMIN_PASSWORD: 'secret' }
  const issued = Date.UTC(2026, 9, 12)
  const session = issueSession(env, issued)
  expect(verifySession(session, env, issued + (SESSION_TTL_SECONDS - 1) * 1000)).toBe(true)
  expect(verifySession(session, env, issued + (SESSION_TTL_SECONDS + 1) * 1000)).toBe(false)
  expect(verifySession(session, env, issued - 1000)).toBe(false)
})

test('a tampered session is rejected', () => {
  const env = { PASCAL_ADMIN_PASSWORD: 'secret' }
  const [version, issuedAt, signature] = issueSession(env).split('.')
  expect(verifySession(`${version}.${Number(issuedAt) + 1}.${signature}`, env)).toBe(false)
  expect(verifySession('garbage', env)).toBe(false)
})

test('password verification is exact and fails closed without a password', () => {
  expect(verifyPassword('secret', { PASCAL_ADMIN_PASSWORD: 'secret' })).toBe(true)
  expect(verifyPassword('Secret', { PASCAL_ADMIN_PASSWORD: 'secret' })).toBe(false)
  expect(verifyPassword('', {})).toBe(false)
})
