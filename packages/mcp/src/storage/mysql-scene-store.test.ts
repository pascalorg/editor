import { describe, expect, it } from 'bun:test'
import { createSceneStore } from './index'
import { resolveMysqlUrl } from './mysql-scene-store'
import { SceneInvalidError } from './types'

describe('resolveMysqlUrl', () => {
  it('returns undefined when nothing is configured', () => {
    expect(resolveMysqlUrl({})).toBeUndefined()
  })

  it('treats an empty or whitespace URL as unset', () => {
    expect(resolveMysqlUrl({ DIGITALTWIN_MYSQL_URL: '' })).toBeUndefined()
    expect(resolveMysqlUrl({ DIGITALTWIN_MYSQL_URL: '   ' })).toBeUndefined()
  })

  it('passes a URL through', () => {
    expect(resolveMysqlUrl({ DIGITALTWIN_MYSQL_URL: 'mysql://u:p@h:3306/d' })).toBe(
      'mysql://u:p@h:3306/d',
    )
  })

  it('still accepts the older PASCAL_ names', () => {
    expect(resolveMysqlUrl({ PASCAL_MYSQL_URL: 'mysql://u:p@h:3306/d' })).toBe(
      'mysql://u:p@h:3306/d',
    )
    expect(
      resolveMysqlUrl({
        PASCAL_MYSQL_HOST: 'h',
        PASCAL_MYSQL_USER: 'u',
        PASCAL_MYSQL_DATABASE: 'd',
      }),
    ).toBe('mysql://u:@h:3306/d')
  })

  it('prefers the DIGITALTWIN_ name when both are set', () => {
    expect(
      resolveMysqlUrl({
        DIGITALTWIN_MYSQL_URL: 'mysql://new:p@h:3306/d',
        PASCAL_MYSQL_URL: 'mysql://old:p@h:3306/d',
      }),
    ).toBe('mysql://new:p@h:3306/d')
  })

  it('composes the discrete fields, percent-encoding credentials', () => {
    const url = resolveMysqlUrl({
      DIGITALTWIN_MYSQL_HOST: 'db.example',
      DIGITALTWIN_MYSQL_USER: 'user',
      DIGITALTWIN_MYSQL_PASSWORD: 'p@ss:w/rd',
      DIGITALTWIN_MYSQL_DATABASE: 'scenes',
    })
    expect(url).toBe('mysql://user:p%40ss%3Aw%2Frd@db.example:3306/scenes')
  })

  it('defaults the port to 3306', () => {
    const url = resolveMysqlUrl({
      DIGITALTWIN_MYSQL_HOST: 'h',
      DIGITALTWIN_MYSQL_USER: 'u',
      DIGITALTWIN_MYSQL_DATABASE: 'd',
    })
    expect(url).toContain('@h:3306/d')
  })

  it('throws, rather than silently falling back, on a partial trio', () => {
    expect(() =>
      resolveMysqlUrl({ DIGITALTWIN_MYSQL_HOST: 'h', DIGITALTWIN_MYSQL_USER: 'u' }),
    ).toThrow(SceneInvalidError)
    try {
      resolveMysqlUrl({ DIGITALTWIN_MYSQL_HOST: 'h', DIGITALTWIN_MYSQL_USER: 'u' })
    } catch (err) {
      expect((err as Error).message).toContain('DIGITALTWIN_MYSQL_DATABASE')
    }
  })
})

describe('createSceneStore production gate', () => {
  it('refuses to fall back to SQLite in production', async () => {
    await expect(createSceneStore({ NODE_ENV: 'production', HOME: '/tmp' })).rejects.toThrow(
      SceneInvalidError,
    )
  })

  /**
   * The escape hatch is gone, and this test is what keeps it gone.
   *
   * `DIGITALTWIN_ALLOW_SQLITE=1` used to let a production process store scenes
   * in a local file. It read as a convenience for a throwaway run; what it
   * actually bought was one typo, or one copied `.env`, between a customer's
   * warehouses and a filesystem the host wipes on every release. Asserting the
   * old variable is INERT is the point — reintroducing the branch would make
   * this test green again by returning a sqlite store, so it asserts the throw.
   */
  it('refuses SQLite in production even with the old escape hatch set', async () => {
    await expect(
      createSceneStore({
        NODE_ENV: 'production',
        DIGITALTWIN_ALLOW_SQLITE: '1',
        HOME: '/tmp/dt-gate-test',
      }),
    ).rejects.toBeInstanceOf(SceneInvalidError)
  })

  it('uses SQLite in development without configuration', async () => {
    const store = await createSceneStore({ NODE_ENV: 'development', HOME: '/tmp/dt-gate-test' })
    expect(store.backend).toBe('sqlite')
    await store.close?.()
  })
})
