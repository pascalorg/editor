import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A Server Component calling this app's own HTTP API sends the request back
 * out through the proxy, drops the caller's cookies (so it 401s the moment
 * sessions exist), and in a multi-replica deployment can land on a different
 * replica than the one rendering the page. On `/scene/[id]` it also carried
 * the whole 300 KB–10 MB graph over HTTP before rendering it into the RSC
 * payload.
 *
 * The store is a per-process singleton (`lib/scene-store-server.ts`), so these
 * pages call it directly. This test is here because the fetch version *works*
 * in a single-replica dev box — nothing fails until deploy or login, by which
 * point the cause is far away.
 */
const PAGES = ['app/scenes/page.tsx', 'app/scene/[id]/page.tsx']

const appRoot = join(import.meta.dir, '..')

describe('server components do not call this app over HTTP', () => {
  test.each(PAGES)('%s reaches the store directly', (page) => {
    const source = readFileSync(join(appRoot, page), 'utf8')

    expect(source).toContain('getSceneOperations')
    expect(source).not.toMatch(/\bfetch\s*\(/)
    // The base URL was derived from `x-forwarded-host`, a client-controlled
    // header — nothing here should need to reconstruct its own origin.
    expect(source).not.toContain('x-forwarded-host')
    expect(source).not.toContain('resolveBaseUrl')
  })
})
