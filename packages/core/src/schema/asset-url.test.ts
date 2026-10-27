import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import {
  __resetAllowedOriginsCacheForTests,
  ALLOWED_ORIGINS_ENV,
  AssetUrl,
  allowedOriginsFrom,
  parseAllowedOrigins,
} from './asset-url'
import { GuideNode } from './nodes/guide'

beforeEach(() => __resetAllowedOriginsCacheForTests())

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

    test('entries with a trailing slash, uppercase or :443 still admit scene assets on that CDN', () => {
      if (!g.process?.env) return
      for (const entry of [
        'https://cdn.pascal.app/',
        'HTTPS://CDN.PASCAL.APP',
        'https://cdn.pascal.app:443',
      ]) {
        g.process.env[ALLOWED_ORIGINS_ENV] = entry
        const guide = GuideNode.safeParse({ url: 'https://cdn.pascal.app/plans/ground.png' })
        expect([entry, guide.success]).toEqual([entry, true])
        expect([entry, isValid('https://cdn.other.com/a.glb')]).toEqual([entry, false])
      }
    })

    test('a whitespace-only or all-invalid allowlist admits no https origin', () => {
      if (!g.process?.env) return
      const warn = spyOn(console, 'warn').mockImplementation(() => {})
      try {
        for (const value of ['   ', ' , ', 'cdn.pascal.app']) {
          g.process.env[ALLOWED_ORIGINS_ENV] = value
          expect([value, isValid('https://cdn.pascal.app/a.glb')]).toEqual([value, false])
          expect([value, isValid('asset://x')]).toEqual([value, true])
        }
      } finally {
        warn.mockRestore()
      }
    })
  })
})

describe('parseAllowedOrigins', () => {
  test('normalises entries to their origin', () => {
    const { origins, issues } = parseAllowedOrigins(
      ' https://CDN.example.com:443/assets/ , http://Local.example:80/, https://cdn.example.com:8443,,',
    )
    expect([...origins]).toEqual([
      'https://cdn.example.com',
      'http://local.example',
      'https://cdn.example.com:8443',
    ])
    expect(issues).toEqual([])
  })

  test('whitespace-only input has no valid entries and nothing to report', () => {
    for (const raw of ['', '   ', ' , ,\t']) {
      const { origins, issues } = parseAllowedOrigins(raw)
      expect([raw, origins.size, issues]).toEqual([raw, 0, []])
    }
  })

  test('rejects a blob: entry, even though it borrows an https origin', () => {
    expect(new URL('blob:https://cdn.example.com/x').origin).toBe('https://cdn.example.com')
    const { origins, issues } = parseAllowedOrigins('blob:https://cdn.example.com/x')
    expect(origins.size).toBe(0)
    expect(issues).toEqual([{ index: 0, reason: 'scheme_not_allowed' }])
  })

  test('rejects an ftp: entry', () => {
    const { origins, issues } = parseAllowedOrigins('https://a.example, ftp://files.example')
    expect([...origins]).toEqual(['https://a.example'])
    expect(issues).toEqual([{ index: 1, reason: 'scheme_not_allowed' }])
  })

  test('rejects a ws: entry', () => {
    const { origins, issues } = parseAllowedOrigins('ws://socket.example')
    expect(origins.size).toBe(0)
    expect(issues).toEqual([{ index: 0, reason: 'scheme_not_allowed' }])
  })

  test('reports malformed entries by index and reason only, never by value', () => {
    const { issues } = parseAllowedOrigins(
      'https://ok.example, user:secret@cdn.example.com, https://user:secret@, cdn.example.com',
    )
    expect(issues).toEqual([
      { index: 1, reason: 'scheme_not_allowed' },
      { index: 2, reason: 'not_a_url' },
      { index: 3, reason: 'not_a_url' },
    ])
  })
})

describe('parseAllowedOrigins: credentials and wildcards', () => {
  test('a full entry with credentials keeps its origin and reports the drop by index', () => {
    const { origins, issues } = parseAllowedOrigins(
      'https://a.example, https://user:secret@cdn.example.com/, https://:pw@b.example',
    )
    expect([...origins]).toEqual([
      'https://a.example',
      'https://cdn.example.com',
      'https://b.example',
    ])
    expect(issues).toEqual([
      { index: 1, reason: 'credentials_dropped' },
      { index: 2, reason: 'credentials_dropped' },
    ])
  })

  test('a wildcard host is rejected with a reason, not kept as a literal origin', () => {
    const { origins, issues } = parseAllowedOrigins(
      'https://*.example.com, https://cdn.example.com, http://cdn.*.example.com:8080',
    )
    expect([...origins]).toEqual(['https://cdn.example.com'])
    expect(issues).toEqual([
      { index: 0, reason: 'wildcard_not_supported' },
      { index: 2, reason: 'wildcard_not_supported' },
    ])
  })
})

describe('allowedOriginsFrom', () => {
  test('logs dropped credentials and wildcard entries by index, never the entry', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const raw = 'https://user:hunter2@cdn.example.com, https://*.hunter2.example'
      expect([...(allowedOriginsFrom(raw) ?? [])]).toEqual(['https://cdn.example.com'])
      const lines = warn.mock.calls.map((args) => String(args[0]))
      expect(lines).toEqual([
        '[pascal] asset_allowlist_entry_credentials_dropped {"index":0}',
        '[pascal] asset_allowlist_entry_ignored {"index":1,"reason":"wildcard_not_supported"}',
      ])
      for (const line of lines) expect(line).not.toContain('hunter2')
    } finally {
      warn.mockRestore()
    }
  })

  test('warns once while the value is unchanged, without the entry text', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const raw = 'https://ok.example,user:secret@cdn.example.com, ftp://user:secret@files.example'
      expect([...(allowedOriginsFrom(raw) ?? [])]).toEqual(['https://ok.example'])
      allowedOriginsFrom(raw)
      const lines = warn.mock.calls.map((args) => String(args[0]))
      expect(lines).toEqual([
        '[pascal] asset_allowlist_entry_ignored {"index":1,"reason":"scheme_not_allowed"}',
        '[pascal] asset_allowlist_entry_ignored {"index":2,"reason":"scheme_not_allowed"}',
      ])
      for (const line of lines) expect(line).not.toContain('secret')

      __resetAllowedOriginsCacheForTests()
      allowedOriginsFrom(raw)
      expect(warn).toHaveBeenCalledTimes(4)
    } finally {
      warn.mockRestore()
    }
  })

  test('unset or empty means no allowlist; whitespace-only means an empty one', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(allowedOriginsFrom(undefined)).toBeUndefined()
      expect(allowedOriginsFrom('')).toBeUndefined()
      expect(allowedOriginsFrom('   ')?.size).toBe(0)
      expect(warn.mock.calls.map((args) => String(args[0]))).toEqual([
        '[pascal] asset_allowlist_has_no_valid_entries: no origin is permitted',
      ])
    } finally {
      warn.mockRestore()
    }
  })

  test('an allowlist of only http: entries warns once that no https: asset is accepted', () => {
    const g = globalThis as { process?: { env?: Record<string, string | undefined> } }
    if (!g.process?.env) return
    const original = g.process.env[ALLOWED_ORIGINS_ENV]
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      g.process.env[ALLOWED_ORIGINS_ENV] = 'http://cdn.pascal.app, http://assets.pascal.app'
      expect(isValid('https://cdn.pascal.app/a.glb')).toBe(false)
      expect(isValid('https://assets.pascal.app/b.glb')).toBe(false)
      expect(warn.mock.calls.map((args) => String(args[0]))).toEqual([
        '[pascal] asset_allowlist_has_no_https_entries: scene asset URLs accept only https: origins, so every one is rejected (safeFetch still fetches the listed http: origins)',
      ])

      warn.mockClear()
      g.process.env[ALLOWED_ORIGINS_ENV] = 'http://cdn.pascal.app, https://assets.pascal.app'
      expect(isValid('https://assets.pascal.app/b.glb')).toBe(true)
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
      if (original === undefined) delete g.process.env[ALLOWED_ORIGINS_ENV]
      else g.process.env[ALLOWED_ORIGINS_ENV] = original
    }
  })
})
