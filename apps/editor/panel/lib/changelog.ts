import type { ReleaseEntry } from './api-contract';

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

const SOURCES = {
  editor: { owner: 'pascalorg', repo: 'editor' },
  plugin: { owner: 'ovurrsl', repo: 'plugin-warehouse' },
} as const;

const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 4000;

interface Cache {
  entries: ReleaseEntry[];
  live: boolean;
  fetchedAt: number;
}

let cache: Cache | null = null;
let inFlight: Promise<Cache> | null = null;

/**
 * Bundled fallback. Real content, taken from the same upstreams — so an offline
 * console shows the right releases rather than an empty tab, and the only thing
 * lost is freshness.
 */
const SNAPSHOT: ReleaseEntry[] = [
  {
    id: 'snapshot-editor-0.9.1',
    title: 'Presets, rooms and templates',
    summary:
      'A preset system for configured items, room and template libraries, and direct building manipulation in the viewport.',
    version: 'v0.9.1',
    date: '2026-07-09T00:00:00.000Z',
    tags: ['preset', 'template', 'editor'],
    authors: ['sudhir9297', 'wass08', 'anton-pascal', 'marcelgruber'],
    channel: 'editor',
  },
  {
    id: 'snapshot-editor-0.9.0',
    title: 'In-world handles and the IFC importer',
    summary: 'Direct manipulation handles in the scene, plus an IFC importer for existing building models.',
    version: 'v0.9.0',
    date: '2026-06-21T00:00:00.000Z',
    tags: ['ifc', 'editor'],
    authors: ['sudhir9297', 'wass08', 'jelharou'],
    channel: 'editor',
  },
  {
    id: 'snapshot-editor-0.8.0',
    title: 'Plugin architecture published',
    summary: 'The plugin contract shipped, letting equipment catalogues live outside the editor core.',
    version: 'v0.8.0',
    date: '2026-06-09T00:00:00.000Z',
    tags: ['plugin', 'editor'],
    authors: ['Aymericr'],
    channel: 'editor',
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
];

function githubHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'digitaltwin-console',
  };
  // A token lifts the 60/hour anonymous limit. Optional — without it the cache
  // and the snapshot between them keep the tab usable.
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

interface GhRelease {
  id: number;
  name: string | null;
  tag_name: string;
  body: string | null;
  published_at: string | null;
  author: { login: string } | null;
}

interface GhCommit {
  sha: string;
  commit: { message: string; author: { name: string; date: string } | null };
  author: { login: string } | null;
}

function summarise(body: string | null, fallback: string): string {
  if (!body) return fallback;
  const firstParagraph = body
    .split(/\r?\n\r?\n/)
    .map((p) => p.replace(/[#*`>-]/g, '').trim())
    .find((p) => p.length > 20);
  return (firstParagraph ?? fallback).slice(0, 320);
}

async function loadUpstream(): Promise<Cache> {
  const [releases, commits] = await Promise.all([
    fetchJson<GhRelease[]>(
      `https://api.github.com/repos/${SOURCES.editor.owner}/${SOURCES.editor.repo}/releases?per_page=20`,
    ),
    fetchJson<GhCommit[]>(
      `https://api.github.com/repos/${SOURCES.plugin.owner}/${SOURCES.plugin.repo}/commits?per_page=20`,
    ),
  ]);

  if (!releases && !commits) return snapshot();

  const entries: ReleaseEntry[] = [];

  for (const release of releases ?? []) {
    entries.push({
      id: `editor-${release.id}`,
      title: release.name?.trim() || release.tag_name,
      summary: summarise(release.body, 'Editor release.'),
      version: release.tag_name,
      date: release.published_at ?? new Date(0).toISOString(),
      tags: ['editor'],
      authors: release.author ? [release.author.login] : [],
      channel: 'editor',
    });
  }

  for (const commit of commits ?? []) {
    const [headline, ...rest] = commit.commit.message.split('\n');
    entries.push({
      id: `plugin-${commit.sha.slice(0, 12)}`,
      title: headline.slice(0, 160),
      summary: summarise(rest.join('\n').trim() || null, 'Warehouse plugin change.'),
      version: null,
      date: commit.commit.author?.date ?? new Date(0).toISOString(),
      tags: ['warehouse'],
      authors: commit.author ? [commit.author.login] : commit.commit.author ? [commit.commit.author.name] : [],
      channel: 'plugin',
    });
  }

  return { entries: byNewest(entries), live: true, fetchedAt: Date.now() };
}

/** One chronological timeline across both channels, newest first. */
function byNewest(entries: ReleaseEntry[]): ReleaseEntry[] {
  return [...entries].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/**
 * The offline path. Sorted through the same helper as the live one — returning
 * SNAPSHOT verbatim left the plugin entry stranded at the bottom of the
 * timeline, because the constant is grouped by channel rather than by date.
 */
function snapshot(): Cache {
  return { entries: byNewest(SNAPSHOT), live: false, fetchedAt: Date.now() };
}

/**
 * Cached upstream read. Concurrent callers share one in-flight request — without
 * that, a page load with two components mounted would fire two fetches and burn
 * the rate limit twice as fast.
 */
export async function loadChangelog(): Promise<Cache> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache;
  if (inFlight) return inFlight;

  inFlight = loadUpstream()
    .then((next) => {
      cache = next;
      return next;
    })
    .catch(() => {
      const fallback = snapshot();
      cache = fallback;
      return fallback;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

export interface ChangelogPage {
  entries: ReleaseEntry[];
  nextCursor: string | null;
  live: boolean;
  fetchedAt: string;
}

/** Cursor is the index into the cached, already-sorted timeline. */
export async function changelogPage(cursor: string | null, limit: number): Promise<ChangelogPage> {
  const loaded = await loadChangelog();
  const start = Math.max(0, Number(cursor ?? 0) || 0);
  const size = Math.min(50, Math.max(1, limit));
  const slice = loaded.entries.slice(start, start + size);
  const next = start + size;

  return {
    entries: slice,
    nextCursor: next < loaded.entries.length ? String(next) : null,
    live: loaded.live,
    fetchedAt: new Date(loaded.fetchedAt).toISOString(),
  };
}
