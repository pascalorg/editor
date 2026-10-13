import { afterEach, expect, test } from 'bun:test'
import { issueSession, SESSION_COOKIE } from './lib/self-host-auth'
import { gateRequest } from './proxy'

const OLD_ENV = { ...process.env }

afterEach(() => {
  for (const key of ['PASCAL_ADMIN_PASSWORD', 'PASCAL_AUTH'] as const) {
    if (OLD_ENV[key] === undefined) delete process.env[key]
    else process.env[key] = OLD_ENV[key]
  }
})

const request = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://pascal.example${path}`, { headers: { host: 'pascal.example', ...headers } })

test('an unconfigured network host sends pages to setup and APIs to 503', async () => {
  delete process.env.PASCAL_ADMIN_PASSWORD
  delete process.env.PASCAL_AUTH

  const page = gateRequest(request('/'))
  expect(page?.status).toBe(307)
  expect(page?.headers.get('location')).toBe('https://pascal.example/setup')

  const api = gateRequest(request('/api/plugins/mint/session'))
  expect(api?.status).toBe(503)
  expect(await api?.json()).toEqual({ error: 'self_host_unconfigured' })
})

test('a password gates pages behind login and keeps the requested path', () => {
  process.env.PASCAL_ADMIN_PASSWORD = 'secret'

  const response = gateRequest(request('/project/abc?tab=build'))
  expect(response?.status).toBe(307)
  expect(response?.headers.get('location')).toBe(
    'https://pascal.example/login?next=%2Fproject%2Fabc%3Ftab%3Dbuild',
  )
  expect(gateRequest(request('/api/plugins/mint/session'))?.status).toBe(401)
})

test('the home page sends a signed-out visitor to login without a next param', () => {
  process.env.PASCAL_ADMIN_PASSWORD = 'secret'
  const response = gateRequest(request('/'))
  expect(response?.status).toBe(307)
  expect(response?.headers.get('location')).toBe('https://pascal.example/login')
})

test('a valid session passes', () => {
  process.env.PASCAL_ADMIN_PASSWORD = 'secret'
  const cookie = `${SESSION_COOKIE}=${issueSession()}`
  expect(gateRequest(request('/', { cookie }))).toBeNull()
  expect(gateRequest(request('/settings', { cookie }))).toBeNull()
  expect(gateRequest(request('/api/plugins/mint/session', { cookie }))).toBeNull()
})

test('public embed pages pass on a password-gated host without a session', () => {
  process.env.PASCAL_ADMIN_PASSWORD = 'secret'
  expect(gateRequest(request('/embed/abc'))).toBeNull()
  expect(gateRequest(request('/embed-other/abc'))?.status).toBe(307)
})

test('login, setup, health and the scene API are never gated here', () => {
  delete process.env.PASCAL_ADMIN_PASSWORD
  for (const path of ['/login', '/setup', '/api/health', '/api/scenes', '/api/artifacts/abc']) {
    expect(gateRequest(request(path))).toBeNull()
  }
})

test('loopback and an upstream proxy are open', () => {
  delete process.env.PASCAL_ADMIN_PASSWORD
  const loopback = new Request('http://localhost:3002/', {
    headers: { host: 'localhost:3002' },
  })
  expect(gateRequest(loopback)).toBeNull()
  process.env.PASCAL_AUTH = 'proxy'
  expect(gateRequest(request('/'))).toBeNull()
})
