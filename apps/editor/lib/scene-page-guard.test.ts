import { afterEach, expect, test } from 'bun:test'
import { guardScenePage } from './scene-page-guard'

const OLD_ENV = { ...process.env }

afterEach(() => {
  restoreEnv('PASCAL_SCENE_API_TOKEN')
  restoreEnv('PASCAL_SCENE_API_ORIGINS')
  restoreEnv('PASCAL_SCENE_API_RATE_LIMIT')
})

function restoreEnv(key: keyof NodeJS.ProcessEnv): void {
  if (OLD_ENV[key] === undefined) delete process.env[key]
  else process.env[key] = OLD_ENV[key]
}

test('allows loopback page requests without a token', () => {
  delete process.env.PASCAL_SCENE_API_TOKEN
  for (const host of ['localhost:3002', 'pascal.localhost:3002', '127.0.0.1:3002', '[::1]:3002']) {
    expect(guardScenePage(new Headers({ host }), '/scenes')).toBeNull()
  }
})

test('rejects non-loopback page requests when no token is configured', () => {
  delete process.env.PASCAL_SCENE_API_TOKEN
  expect(guardScenePage(new Headers({ host: '192.168.1.20:3002' }), '/scenes')).toBe(503)
  expect(guardScenePage(new Headers({ host: 'editor.example' }), '/scene/abc')).toBe(503)
})

test('requires the configured token, even on loopback', () => {
  process.env.PASCAL_SCENE_API_TOKEN = 'secret'
  expect(guardScenePage(new Headers({ host: 'localhost:3002' }), '/scenes')).toBe(401)
  expect(
    guardScenePage(
      new Headers({ host: 'editor.example', authorization: 'Bearer wrong' }),
      '/scenes',
    ),
  ).toBe(401)
  expect(
    guardScenePage(
      new Headers({ host: 'editor.example', authorization: 'Bearer secret' }),
      '/scenes',
    ),
  ).toBeNull()
  expect(
    guardScenePage(
      new Headers({ host: 'editor.example', 'x-pascal-scene-token': 'secret' }),
      '/scene/abc',
    ),
  ).toBeNull()
})

test('rejects cross-origin page requests from unlisted origins', () => {
  delete process.env.PASCAL_SCENE_API_TOKEN
  const headers = new Headers({ host: 'localhost:3002', origin: 'https://evil.example' })
  expect(guardScenePage(headers, '/scenes')).toBe(403)
})

test('applies the scene API rate limit', () => {
  delete process.env.PASCAL_SCENE_API_TOKEN
  process.env.PASCAL_SCENE_API_RATE_LIMIT = '1'
  const headers = new Headers({ host: 'localhost:3002', 'x-forwarded-for': '203.0.113.9' })
  expect(guardScenePage(headers, '/scenes')).toBeNull()
  expect(guardScenePage(headers, '/scenes')).toBe(429)
})

test('rejects requests without a host header', () => {
  expect(guardScenePage(new Headers(), '/scenes')).toBe(400)
})
