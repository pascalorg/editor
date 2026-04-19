// @ts-expect-error — bun:test is provided by the Bun runtime; core does not
// depend on @types/bun so the import type is unresolved at compile time.
// The tsconfig in packages/core still emits this file; the @ts-expect-error
// keeps the build green while letting `bun test` pick it up normally.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ALLOWED_ORIGINS_ENV, AssetUrl } from './asset-url'

function isValid(url: string): boolean {
  return AssetUrl.safeParse(url).success
}

describe('AssetUrl', () => {
  describe('allowed URLs', () => {
    const cases: Array<[string, string]> = [
      ['asset://abc', 'internal asset handle'],
      ['asset://catalog/items/chair-1', 'nested asset handle'],
      ['blob:http://example.com/uuid-1234', 'blob URL with http inner'],
      ['blob:https://example.com/uuid-5678', 'blob URL with https inner'],
      ['https://cdn.example.com/a.glb', 'https CDN URL'],
      ['https://cdn.example.com/models/chair.glb?v=2', 'https URL with query string'],
      ['http://localhost:3000/x', 'http localhost with port'],
      ['http://localhost/x', 'http localhost without port'],
      ['http://127.0.0.1:8080/texture.png', 'http 127.0.0.1 loopback'],
      ['/public/a.glb', 'app-relative path'],
      ['/material/wood1/albedoMap_basecolor.jpg', 'relative path deep'],
      ['data:image/png;base64,AAA', 'inline PNG data URL'],
      ['data:image/jpeg;base64,/9j/', 'inline JPEG data URL'],
      ['data:image/webp;base64,UklGR', 'inline WebP data URL'],
      ['data:image/svg+xml,%3Csvg%3E', 'inline SVG data URL'],
    ]
    for (const [url, label] of cases) {
      test(`accepts ${label}: ${url}`, () => {
        expect(isValid(url)).toBe(true)
      })
    }
  })

  describe('rejected URLs', () => {
    const cases: Array<[string, string]> = [
      ['javascript:alert(1)', 'javascript scheme'],
      ['JAVASCRIPT:alert(1)', 'javascript scheme uppercase'],
      ['file:///etc/passwd', 'file scheme'],
      ['file://C:/Windows/System32/config', 'file scheme Windows'],
      ['http://evil.com/', 'non-loopback http'],
      ['http://example.com:3000/x', 'http on non-loopback host'],
      ['http://169.254.169.254/latest/meta-data/', 'http on link-local (cloud metadata)'],
      ['data:text/html,<script>alert(1)</script>', 'data text/html'],
      ['data:application/javascript,alert(1)', 'data application/javascript'],
      ['data:text/plain,hi', 'data text/plain'],
      ['ftp://a.b.com', 'ftp scheme'],
      ['ws://example.com/', 'websocket scheme'],
      ['vbscript:msgbox', 'vbscript scheme'],
      ['', 'empty string'],
      ['not a url at all', 'non-url string'],
      ['://missing-scheme', 'malformed'],
    ]
    for (const [url, label] of cases) {
      test(`rejects ${label}: ${url}`, () => {
        expect(isValid(url)).toBe(false)
      })
    }
  })

  describe(`env allowlist via ${ALLOWED_ORIGINS_ENV}`, () => {
    const g = globalThis as { process?: { env?: Record<string, string | undefined> } }
    const original = g.process?.env?.[ALLOWED_ORIGINS_ENV]

    beforeEach(() => {
      if (g.process?.env) delete g.process.env[ALLOWED_ORIGINS_ENV]
    })

    afterEach(() => {
      if (!g.process?.env) return
      if (original === undefined) {
        delete g.process.env[ALLOWED_ORIGINS_ENV]
      } else {
        g.process.env[ALLOWED_ORIGINS_ENV] = original
      }
    })

    test('single origin allowlist accepts matching https URL', () => {
      if (!g.process?.env) return // browser-only runtime
      g.process.env[ALLOWED_ORIGINS_ENV] = 'https://cdn.pascal.app'
      expect(isValid('https://cdn.pascal.app/a.glb')).toBe(true)
      expect(isValid('https://cdn.pascal.app/deep/path?q=1')).toBe(true)
    })

    test('single origin allowlist rejects non-matching https URL', () => {
      if (!g.process?.env) return
      g.process.env[ALLOWED_ORIGINS_ENV] = 'https://cdn.pascal.app'
      expect(isValid('https://cdn.other.com/a.glb')).toBe(false)
      expect(isValid('https://attacker.example.com/x')).toBe(false)
    })

    test('multi-origin allowlist accepts any listed origin', () => {
      if (!g.process?.env) return
      g.process.env[ALLOWED_ORIGINS_ENV] = 'https://cdn.pascal.app, https://assets.pascal.app'
      expect(isValid('https://cdn.pascal.app/a.glb')).toBe(true)
      expect(isValid('https://assets.pascal.app/tex.webp')).toBe(true)
      expect(isValid('https://third.example.com/x')).toBe(false)
    })

    test('allowlist ignores trailing / in URL path (origin match only)', () => {
      if (!g.process?.env) return
      g.process.env[ALLOWED_ORIGINS_ENV] = 'https://cdn.pascal.app'
      expect(isValid('https://cdn.pascal.app/')).toBe(true)
      expect(isValid('https://cdn.pascal.app')).toBe(true)
    })

    test('empty allowlist behaves like unset', () => {
      if (!g.process?.env) return
      g.process.env[ALLOWED_ORIGINS_ENV] = ''
      expect(isValid('https://cdn.other.com/a.glb')).toBe(true)
    })

    test('allowlist does not restrict non-https schemes', () => {
      if (!g.process?.env) return
      g.process.env[ALLOWED_ORIGINS_ENV] = 'https://cdn.pascal.app'
      // these should still pass because they match earlier scheme-based branches
      expect(isValid('asset://x')).toBe(true)
      expect(isValid('blob:https://example.com/abc')).toBe(true)
      expect(isValid('data:image/png;base64,AAA')).toBe(true)
      expect(isValid('/public/a.glb')).toBe(true)
      expect(isValid('http://localhost:3000/x')).toBe(true)
    })

    test('allowlist rejects subdomain spoofing', () => {
      if (!g.process?.env) return
      g.process.env[ALLOWED_ORIGINS_ENV] = 'https://cdn.pascal.app'
      expect(isValid('https://cdn.pascal.app.evil.com/x')).toBe(false)
      expect(isValid('https://evil.com/cdn.pascal.app')).toBe(false)
    })

    test('allowlist respects ports', () => {
      if (!g.process?.env) return
      g.process.env[ALLOWED_ORIGINS_ENV] = 'https://cdn.pascal.app:8443'
      expect(isValid('https://cdn.pascal.app:8443/x')).toBe(true)
      expect(isValid('https://cdn.pascal.app/x')).toBe(false)
    })
  })
})
