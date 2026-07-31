import { describe, expect, it } from 'bun:test'
import { createSceneStore } from './index'
import { resolveMysqlUrl } from './mysql-scene-store'
import { SceneInvalidError } from './types'

describe('resolveMysqlUrl', () => {
  it('returns undefined when nothing is configured', () => {
    expect(resolveMysqlUrl({})).toBeUndefined()
  })

  it('treats an empty or whitespace URL as unset', () => {
    expect(resolveMysqlUrl({ PASCAL_MYSQL_URL: '' })).toBeUndefined()
    expect(resolveMysqlUrl({ PASCAL_MYSQL_URL: '   ' })).toBeUndefined()
  })

  it('passes a URL through', () => {
    expect(resolveMysqlUrl({ PASCAL_MYSQL_URL: 'mysql://u:p@h:3306/d' })).toBe(
      'mysql://u:p@h:3306/d',
    )
  })

  it('composes the discrete fields, percent-encoding credentials', () => {
    const url = resolveMysqlUrl({
      PASCAL_MYSQL_HOST: 'db.example',
      PASCAL_MYSQL_USER: 'user',
      PASCAL_MYSQL_PASSWORD: 'p@ss:w/rd',
      PASCAL_MYSQL_DATABASE: 'scenes',
    })
    expect(url).toBe('mysql://user:p%40ss%3Aw%2Frd@db.example:3306/scenes')
  })

  it('defaults the port to 3306', () => {
    const url = resolveMysqlUrl({
      PASCAL_MYSQL_HOST: 'h',
      PASCAL_MYSQL_USER: 'u',
      PASCAL_MYSQL_DATABASE: 'd',
    })
    expect(url).toContain('@h:3306/d')
  })

  it('throws, rather than silently falling back, on a partial trio', () => {
    expect(() =>
      resolveMysqlUrl({ PASCAL_MYSQL_HOST: 'h', PASCAL_MYSQL_USER: 'u' }),
    ).toThrow(SceneInvalidError)
    try {
      resolveMysqlUrl({ PASCAL_MYSQL_HOST: 'h', PASCAL_MYSQL_USER: 'u' })
    } catch (err) {
      expect((err as Error).message).toContain('PASCAL_MYSQL_DATABASE')
    }
  })
})

describe('createSceneStore production gate', () => {
  it('refuses to fall back to SQLite in production', async () => {
    await expect(createSceneStore({ NODE_ENV: 'production', HOME: '/tmp' })).rejects.toThrow(
      SceneInvalidError,
    )
  })

  it('allows SQLite in production with the explicit escape hatch', async () => {
    const store = await createSceneStore({
      NODE_ENV: 'production',
      PASCAL_ALLOW_SQLITE: '1',
      HOME: '/tmp/dt-gate-test',
    })
    expect(store.backend).toBe('sqlite')
    await store.close?.()
  })

  it('uses SQLite in development without configuration', async () => {
    const store = await createSceneStore({ NODE_ENV: 'development', HOME: '/tmp/dt-gate-test' })
    expect(store.backend).toBe('sqlite')
    await store.close?.()
  })
})
