import type { SceneGraph } from '@pascal-app/editor'
import Link from 'next/link'
import { LocalizedContent } from '@/components/localized-content'
import { SharedSceneLoader } from '@/components/shared-scene-loader'
import { getSceneOperations } from '@/lib/scene-store-server'
import { verifyShareToken } from '@/lib/share-token'

export const dynamic = 'force-dynamic'

/**
 * A view-only share link.
 *
 * The scene is read straight from the store rather than through
 * `/api/scenes/[id]`: that route is credentialed, and a share visitor has no
 * credentials by definition. The signed token is the authorization, and it is
 * verified here before the id inside it is used for anything.
 */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const verified = verifyShareToken(token)

  if (!verified.ok) {
    return (
      <ShareProblem
        body={
          verified.error === 'expired'
            ? 'This share link has expired. Ask whoever sent it for a new one.'
            : verified.error === 'secret_missing'
              ? 'Sharing is not configured on this server.'
              : 'This share link is not valid.'
        }
        heading={verified.error === 'expired' ? 'Link expired' : 'Link not valid'}
      />
    )
  }

  const operations = await getSceneOperations()
  const scene = await operations.loadStoredScene(verified.payload.sid)
  if (!scene) {
    return (
      <ShareProblem
        body="The scene this link points at is no longer available."
        heading="Scene not found"
      />
    )
  }

  return (
    <SharedSceneLoader
      initialScene={scene.graph as SceneGraph}
      meta={{ name: scene.name, version: scene.version }}
      token={token}
    />
  )
}

function ShareProblem({ heading, body }: { heading: string; body: string }) {
  return (
    <LocalizedContent>
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-2xl border border-border/60 bg-background p-6 text-center shadow-xl">
          <h1 className="font-semibold text-lg">{heading}</h1>
          <p className="mt-2 text-muted-foreground text-sm">{body}</p>
          <div className="mt-4 flex items-center justify-center">
            <Link
              className="rounded-md border border-border bg-accent px-3 py-2 font-medium text-sm hover:bg-accent/80"
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
