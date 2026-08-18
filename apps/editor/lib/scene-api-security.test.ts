import { afterEach, expect, mock, test } from 'bun:test'

mock.module('./auth', () => ({
  auth: {
    api: {
      getSession: async () => null,
    },
  },
}))

import { guardSceneApiRequest, sceneApiPreflight } from './scene-api-security'

const OLD_ENV = { ...process.env }

afterEach(() => {
  restoreEnv('PASCAL_SCENE_API_ORIGINS')
  restoreEnv('PASCAL_SCENE_API_RATE_LIMIT')
})

function restoreEnv(key: keyof NodeJS.ProcessEnv): void {
  if (OLD_ENV[key] === undefined) delete process.env[key]
  else process.env[key] = OLD_ENV[key]
}

test('allows loopback scene API requests', async () => {
  const request = new Request('http://127.0.0.1:3000/api/scenes', {
    headers: { host: '127.0.0.1:3000' },
  })
  expect(await guardSceneApiRequest(request)).toBeNull()
})

test('applies configured CORS origins for preflight', async () => {
  process.env.PASCAL_SCENE_API_ORIGINS = 'https://app.example'
  const request = new Request('https://editor.example/api/scenes', {
    method: 'OPTIONS',
    headers: {
      host: 'editor.example',
      origin: 'https://app.example',
    },
  })

  const response = await sceneApiPreflight(request)

  expect(response.status).toBe(204)
  expect(response.headers.get('access-control-allow-origin')).toBe('https://app.example')
})
