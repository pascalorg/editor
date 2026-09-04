import type { ReleaseEntry } from './api-contract'

/**
 * Changelog source.
 *
 * Two rules the design settled on, both load-bearing:
 *
 * 1. The client never calls the upstream API. The fetch happens here, behind a
 *    60 s cache, because the anonymous rate limit (60 requests/hour per IP) was
 *    hit in the prototype when every visitor fetched for themselves.
 * 2. Upstream repository names never reach the UI. They live in this file and
 *    nowhere else; entries carry a `channel` ('editor' | 'plugin') and the
 *    screens render product wording from that.
 */

/**
 * The three repositories this deployment is actually made of: the deploy
 * repository receives the merged editor+console builds the host runs, the
 * plugin and the console each live in their own repository. The deploy
 * repository is private — its entries only appear when GITHUB_TOKEN is set.
 */
const SOURCES = {
  deploy: { owner: 'ovurrsl', repo: 'Digitaltwin' },
  plugin: { owner: 'ovurrsl', repo: 'plugin-warehouse' },
  console: { owner: 'ovurrsl', repo: 'panel' },
} as const

const CACHE_TTL_MS = 300_000
const FETCH_TIMEOUT_MS = 2500

interface Cache {
  entries: ReleaseEntry[]
  live: boolean
  fetchedAt: number
}

let cache: Cache | null = null
let inFlight: Promise<Cache> | null = null

/**
 * Bundled fallback. Real content, taken from the same upstreams — so an offline
 * console shows the right releases rather than an empty tab, and the only thing
 * lost is freshness.
 */
const SNAPSHOT: ReleaseEntry[] = [
  {
    id: 'snapshot-deploy-2.1.2',
    title: 'Home returns to the editor, mail gets its design',
    summary:
      'Navigation from scenes and admin lands back in the editor; transactional mail ships a designed HTML part in the console’s visual language.',
    version: 'v2.1.2',
    date: '2026-08-01T00:00:00.000Z',
    tags: ['deploy', 'mail'],
    authors: ['ovurrsl'],
    channel: 'editor',
  },
  {
    id: 'snapshot-deploy-2.0.0',
    title: 'The console becomes the front door',
    summary:
      'Sign-in, two-factor, roles and the admin console own the root URL; the editor sits behind it and scenes belong to console accounts. The database self-migrates at boot.',
    version: 'v2.0.0',
    date: '2026-07-31T00:00:00.000Z',
    tags: ['deploy', 'console', 'auth'],
    authors: ['ovurrsl'],
    channel: 'editor',
  },
  {
    id: 'snapshot-console-0.9.1',
    title: 'Real SMTP delivery',
    summary:
      'The console sends its reset, invitation and receipt mail through SMTP, with the console transport kept for development.',
    version: 'v0.9.1',
    date: '2026-07-31T00:00:00.000Z',
    tags: ['mail', 'smtp'],
    authors: ['ovurrsl'],
    channel: 'console',
  },
  {
    id: 'snapshot-plugin-0.1.0',
    title: 'Warehouse equipment catalogue',
    summary:
      'Pallets (EPAL/GMA/plastic), pallet racking with per-bay tunnels, skips and picking levels, EN 15620 tables, roller conveyor modules and 45/90/180° curves, plus the capacity and clash panel.',
    version: 'v0.1.0',
    date: '2026-07-08T00:00:00.000Z',
    tags: ['warehouse', 'racking', 'conveyor'],
    authors: ['ovurrsl', 'claude'],
    channel: 'plugin',
  },
]

function githubHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'digitaltwin-console',
  }
  // A token lifts the 60/hour anonymous limit. Optional — without it the cache
  // and the snapshot between them keep the tab usable.
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  return headers
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}

interface GhRelease {
  id: number
  name: string | null
  tag_name: string
  body: string | null
  published_at: string | null
  author: { login: string } | null
}

interface GhCommit {
  sha: string
  commit: { message: string; author: { name: string; date: string } | null }
  author: { login: string } | null
}

function summarise(body: string | null, fallback: string): string {
  if (!body) return fallback
  const firstParagraph = body
    .split(/\r?\n\r?\n/)
    .map((p) => p.replace(/[#*`>-]/g, '').trim())
    .find((p) => p.length > 20)
  return (firstParagraph ?? fallback).slice(0, 320)
}

function commitsUrl(source: { owner: string; repo: string }): string {
  return `https://api.github.com/repos/${source.owner}/${source.repo}/commits?per_page=20`
}

interface GhContent {
  content?: string
  encoding?: string
}

/**
 * Each repository states its own version in its own package.json, and the
 * three move independently — the editor, the console and the plugin are
 * released separately. Reading it here is what lets every channel show its own
 * number instead of borrowing the deploy repository's.
 *
 * Only the deploy repository writes the version into its commit subjects
 * ("v2.8.0 — …"); for the other two this is the only place it exists.
 */
async function repoVersion(source: { owner: string; repo: string }): Promise<string | null> {
  const body = await fetchJson<GhContent>(
    `https://api.github.com/repos/${source.owner}/${source.repo}/contents/package.json`,
  )
  if (!body?.content || body.encoding !== 'base64') return null
  try {
    const parsed = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')) as {
      version?: unknown
    }
    return typeof parsed.version === 'string' ? `v${parsed.version}` : null
  } catch {
    return null
  }
}

function commitEntries(
  commits: GhCommit[] | null,
  opts: {
    idPrefix: string
    channel: ReleaseEntry['channel']
    tags: string[]
    fallback: string
    /** That repository's own version, for entries whose subject omits one. */
    channelVersion?: string | null
  },
): ReleaseEntry[] {
  const entries: ReleaseEntry[] = []
  for (const commit of commits ?? []) {
    const [headline, ...rest] = commit.commit.message.split('\n')
    const title = (headline ?? '').slice(0, 160)
    // Deploy commits are titled "v2.1.2 — …"; surface that as the version chip.
    // The other two repositories don't version their subjects, so they fall
    // back to whatever their own package.json currently declares.
    const version = /^v\d+\.\d+\.\d+/.exec(title)?.[0] ?? opts.channelVersion ?? null
    entries.push({
      id: `${opts.idPrefix}-${commit.sha.slice(0, 12)}`,
      title,
      summary: summarise(rest.join('\n').trim() || null, opts.fallback),
      version,
      date: commit.commit.author?.date ?? new Date(0).toISOString(),
      tags: opts.tags,
      authors: commit.author
        ? [commit.author.login]
        : commit.commit.author
          ? [commit.commit.author.name]
          : [],
      channel: opts.channel,
    })
  }
  return entries
}

async function loadUpstream(): Promise<Cache> {
  const [deploy, plugin, console_, pluginVersion, consoleVersion] = await Promise.all([
    fetchJson<GhCommit[]>(commitsUrl(SOURCES.deploy)),
    fetchJson<GhCommit[]>(commitsUrl(SOURCES.plugin)),
    fetchJson<GhCommit[]>(commitsUrl(SOURCES.console)),
    repoVersion(SOURCES.plugin),
    repoVersion(SOURCES.console),
  ])

  if (!deploy && !plugin && !console_) return snapshot()

  const entries: ReleaseEntry[] = [
    ...commitEntries(deploy, {
      idPrefix: 'deploy',
      channel: 'editor',
      tags: ['deploy'],
      fallback: 'Published to the server.',
    }),
    ...commitEntries(plugin, {
      idPrefix: 'plugin',
      channel: 'plugin',
      tags: ['warehouse'],
      fallback: 'Warehouse plugin change.',
      channelVersion: pluginVersion,
    }),
    ...commitEntries(console_, {
      idPrefix: 'console',
      channel: 'console',
      tags: ['console'],
      fallback: 'Console change.',
      channelVersion: consoleVersion,
    }),
  ]

  return { entries: byNewest(entries), live: true, fetchedAt: Date.now() }
}

/** One chronological timeline across both channels, newest first. */
function byNewest(entries: ReleaseEntry[]): ReleaseEntry[] {
  return [...entries].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

/**
 * The offline path. Sorted through the same helper as the live one — returning
 * SNAPSHOT verbatim left the plugin entry stranded at the bottom of the
 * timeline, because the constant is grouped by channel rather than by date.
 */
function snapshot(): Cache {
  return { entries: byNewest(SNAPSHOT), live: false, fetchedAt: Date.now() }
}

/**
 * Cached upstream read that never makes a reader wait on GitHub.
 *
 * The page always renders from what is already here — the last good fetch, or
 * the bundled snapshot — and a refresh happens behind it. Blocking was the
 * wrong trade: three repositories, one of them private, each up to a couple of
 * seconds when the network is unhappy, on a page a signed-out visitor opens
 * from the sign-in screen.
 *
 * Concurrent callers share one in-flight refresh; without that, two components
 * mounting together would fire two fetches and burn the rate limit twice as
 * fast.
 */
export async function loadChangelog(): Promise<Cache> {
  const current = cache ?? snapshot()
  const stale = !cache || Date.now() - cache.fetchedAt >= CACHE_TTL_MS

  if (stale && !inFlight) {
    inFlight = loadUpstream()
      .then((next) => {
        cache = next
        return next
      })
      .catch(() => {
        const fallback = snapshot()
        cache = fallback
        return fallback
      })
      .finally(() => {
        inFlight = null
      })
    // Deliberately not awaited: the refresh lands in the cache for the next
    // reader. An unhandled rejection here would take the process down, so the
    // promise still carries a catch.
    void inFlight.catch(() => undefined)
  }

  return current
}

export interface ChangelogPage {
  entries: ReleaseEntry[]
  nextCursor: string | null
  live: boolean
  fetchedAt: string
}

/** Cursor is the index into the cached, already-sorted timeline. */
export async function changelogPage(cursor: string | null, limit: number): Promise<ChangelogPage> {
  const loaded = await loadChangelog()
  const start = Math.max(0, Number(cursor ?? 0) || 0)
  const size = Math.min(50, Math.max(1, limit))
  const slice = loaded.entries.slice(start, start + size)
  const next = start + size

  return {
    entries: slice,
    nextCursor: next < loaded.entries.length ? String(next) : null,
    live: loaded.live,
    fetchedAt: new Date(loaded.fetchedAt).toISOString(),
  }
}
