import { describe, expect, test } from 'bun:test'
import { McpError } from '@modelcontextprotocol/sdk/types.js'
import { safeFetch } from './safe-fetch'

describe('safeFetch — SSRF protection', () => {
  test('rejects non-http schemes', async () => {
    for (const url of ['file:///etc/passwd', 'ftp://example.com/', 'javascript:alert(1)']) {
      const err = await safeFetch(url).catch((e) => e)
      expect(err).toBeInstanceOf(McpError)
      expect((err as Error).message).toContain('url_scheme_not_allowed')
    }
  })

  test('rejects loopback addresses', async () => {
    for (const url of [
      'http://127.0.0.1/',
      'http://127.1.2.3/',
      'http://localhost:9999/',
      'http://[::1]/',
    ]) {
      const err = await safeFetch(url).catch((e) => e)
      expect(err).toBeInstanceOf(McpError)
      expect((err as Error).message).toContain('url_host_blocked')
    }
  })

  test('rejects link-local / cloud metadata', async () => {
    // 169.254.169.254 is the AWS/GCP/Azure instance-metadata endpoint.
    const url = 'http://169.254.169.254/latest/meta-data/'
    const err = await safeFetch(url).catch((e) => e)
    expect(err).toBeInstanceOf(McpError)
    expect((err as Error).message).toContain('url_host_blocked')
  })

  test('rejects private IP ranges', async () => {
    for (const url of [
      'http://10.0.0.1/',
      'http://172.16.5.9/',
      'http://172.31.255.254/',
      'http://192.168.1.1/',
    ]) {
      const err = await safeFetch(url).catch((e) => e)
      expect(err).toBeInstanceOf(McpError)
      expect((err as Error).message).toContain('url_host_blocked')
    }
  })

  test('rejects local-style hostnames', async () => {
    for (const url of [
      'http://mything.local/',
      'http://server.internal/',
      'http://db.corp/',
      'http://nope.localhost/',
    ]) {
      const err = await safeFetch(url).catch((e) => e)
      expect(err).toBeInstanceOf(McpError)
      expect((err as Error).message).toContain('url_host_blocked')
    }
  })

  test('rejects IPv4-mapped IPv6 loopback', async () => {
    const err = await safeFetch('http://[::ffff:127.0.0.1]/').catch((e) => e)
    expect(err).toBeInstanceOf(McpError)
  })

  test('rejects malformed URL', async () => {
    const err = await safeFetch('not a url').catch((e) => e)
    expect(err).toBeInstanceOf(McpError)
    expect((err as Error).message).toContain('invalid_url')
  })

  test('applies PASCAL_ALLOWED_ASSET_ORIGINS env allowlist when set', async () => {
    const prev = process.env.PASCAL_ALLOWED_ASSET_ORIGINS
    process.env.PASCAL_ALLOWED_ASSET_ORIGINS = 'https://cdn.example.com'
    try {
      const err = await safeFetch('https://other.example.com/x.png').catch((e) => e)
      expect(err).toBeInstanceOf(McpError)
      expect((err as Error).message).toContain('url_origin_not_allowlisted')
    } finally {
      if (prev === undefined) {
        delete process.env.PASCAL_ALLOWED_ASSET_ORIGINS
      } else {
        process.env.PASCAL_ALLOWED_ASSET_ORIGINS = prev
      }
    }
  })
})
