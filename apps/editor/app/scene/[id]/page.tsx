import type { SceneGraph } from '@pascal-app/editor'
import Link from 'next/link'
import { LocalizedContent } from '@/components/localized-content'
import { SceneLoader, type SceneMeta } from '@/components/scene-loader'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'

interface SceneWithGraph extends SceneMeta {
  graph: SceneGraph
}

import { headers } from 'next/headers'
import { authorizeScene, resolveActor } from '@/lib/scene-api-security'

/**
 * The store directly — see the note in `app/scenes/page.tsx`. It matters more
 * here: the graph is 300 KB–10 MB, and the round trip carried all of it over
 * HTTP for no reason before rendering it into the RSC payload.
 */
async function fetchScene(id: string): Promise<SceneWithGraph | null> {
  const actor = await resolveActor(await headers())
  const access = await authorizeScene(actor, id, 'read')
  if (!access) return null

  const operations = await getSceneOperations()
  return (await operations.loadStoredScene(id)) as SceneWithGraph | null
}

export default async function ScenePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const scene = await fetchScene(id)

  if (!scene) {
    return (
      <LocalizedContent>
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
      </LocalizedContent>
    )
  }

  const { graph, ...meta } = scene
  return <SceneLoader initialScene={graph} meta={meta} />
}
