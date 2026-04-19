import type { SceneGraph } from '@pascal-app/editor'
import { headers } from 'next/headers'
import Link from 'next/link'
import { SceneLoader, type SceneMeta } from '@/components/scene-loader'

export const dynamic = 'force-dynamic'

interface SceneWithGraph extends SceneMeta {
  graph: SceneGraph
}

async function resolveBaseUrl(): Promise<string> {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL
  }
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'http'
  if (!host) {
    return 'http://localhost:3000'
  }
  return `${proto}://${host}`
}

async function fetchScene(id: string): Promise<SceneWithGraph | null> {
  const base = await resolveBaseUrl()
  const response = await fetch(`${base}/api/scenes/${encodeURIComponent(id)}`, {
    cache: 'no-store',
  })
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new Error(`Failed to load scene: ${response.status}`)
  }
  return (await response.json()) as SceneWithGraph
}

export default async function ScenePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const scene = await fetchScene(id)

  if (!scene) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-2xl border border-border/60 bg-background p-6 text-center shadow-xl">
          <p className="font-mono text-muted-foreground text-xs uppercase tracking-wide">404</p>
          <h1 className="mt-2 font-semibold text-lg">Scene not found</h1>
          <p className="mt-2 text-muted-foreground text-sm">
            We couldn&apos;t find a scene with id <code className="font-mono">{id}</code>.
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Link
              className="rounded-md border border-border bg-accent px-3 py-2 font-medium text-sm hover:bg-accent/80"
              href="/scenes"
            >
              Browse scenes
            </Link>
            <Link
              className="rounded-md border border-border bg-background px-3 py-2 font-medium text-sm hover:bg-accent/40"
              href="/"
            >
              Back to editor
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const { graph, ...meta } = scene
  return <SceneLoader initialScene={graph} meta={meta} />
}
