import { headers } from 'next/headers'
import Link from 'next/link'
import { CreateSceneButton } from '@/components/save-button'
import type { SceneMeta } from '@/components/scene-loader'
import { resolvePublicUrl } from '@/lib/public-url'
import { getSceneOperations } from '@/lib/scene-store-server'
import { resolveAuthMode } from '@/lib/self-host-auth'

export const dynamic = 'force-dynamic'

async function fetchScenes(): Promise<SceneMeta[]> {
  const operations = await getSceneOperations()
  return operations.listScenes({ limit: 50 })
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

/** Server components see headers, not a Request; the auth helpers want the latter. */
async function currentRequest(): Promise<Request> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost'
  const proto = h.get('x-forwarded-proto') ?? 'http'
  return new Request(`${proto}://${host}/scenes`, { headers: h })
}

export default async function ScenesPage() {
  const [scenes, request] = await Promise.all([fetchScenes(), currentRequest()])
  const authMode = resolveAuthMode(request)
  const sceneApiUrl = `${resolvePublicUrl(request)}/api/scenes`
  const agentTokenConfigured = Boolean(process.env.PASCAL_SCENE_API_TOKEN)

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-border border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto flex items-center justify-between gap-4 px-6 py-4">
          <nav className="flex items-center gap-4 text-sm">
            <Link
              className="text-muted-foreground transition-colors hover:text-foreground"
              href="/"
            >
              Home
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="font-medium text-foreground">Scenes</span>
          </nav>
          <div className="flex items-center gap-3">
            <CreateSceneButton />
            {authMode === 'password' && (
              <form action="/api/auth/logout" method="post">
                <button
                  className="rounded-full border border-border px-3 py-1.5 font-medium text-sm hover:bg-accent/40"
                  type="submit"
                >
                  Sign out
                </button>
              </form>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-5xl px-6 py-12">
        <h1 className="mb-2 font-bold text-3xl">Your scenes</h1>
        <p className="mb-8 text-muted-foreground text-sm">
          {scenes.length === 0
            ? 'No scenes yet. Create one to get started.'
            : `${scenes.length} scene${scenes.length === 1 ? '' : 's'}.`}
        </p>

        {scenes.length === 0 ? (
          <div className="rounded-xl border border-border/60 border-dashed bg-background p-12 text-center">
            <p className="text-muted-foreground text-sm">You haven&apos;t saved any scenes yet.</p>
            <div className="mt-4 flex justify-center">
              <CreateSceneButton />
            </div>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {scenes.map((scene) => (
              <li key={scene.id}>
                <Link
                  className="group block rounded-xl border border-border/60 bg-background p-4 transition-colors hover:border-border hover:bg-accent/30"
                  href={`/scene/${scene.id}`}
                >
                  <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-accent/30">
                    {scene.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt={scene.name}
                        className="h-full w-full object-cover"
                        src={scene.thumbnailUrl}
                      />
                    ) : (
                      <span className="text-muted-foreground text-xs">No thumbnail</span>
                    )}
                  </div>
                  <div className="mt-3">
                    <h2 className="truncate font-semibold text-sm group-hover:text-foreground">
                      {scene.name}
                    </h2>
                    <div className="mt-1 flex items-center justify-between text-muted-foreground text-xs">
                      <span>{scene.nodeCount} nodes</span>
                      <time dateTime={scene.updatedAt}>{formatDate(scene.updatedAt)}</time>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <section className="mt-12 rounded-xl border border-border/60 bg-accent/20 p-5">
          <h2 className="font-semibold text-sm">Connect an agent</h2>
          <p className="mt-1 text-muted-foreground text-xs">
            Scripts and agents read and write scenes through the scene API at{' '}
            <code className="font-mono">{sceneApiUrl}</code>.{' '}
            {agentTokenConfigured
              ? 'Send the configured token as an Authorization: Bearer header.'
              : 'Set PASCAL_SCENE_API_TOKEN on this instance and send it as an Authorization: Bearer header.'}
          </p>
        </section>
      </main>
    </div>
  )
}
