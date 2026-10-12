import { Settings } from 'lucide-react'
import Link from 'next/link'
import { AppHeader, AppShell, ICON_BUTTON, PascalMark } from '@/components/app-shell'
import { CreateSceneButton } from '@/components/save-button'
import { SceneCard, type SceneCardData } from '@/components/scene-card'
import { getSceneOperations } from '@/lib/scene-store-server'
import { sceneThumbnailUrl } from '@/lib/scene-thumbnails'

export const dynamic = 'force-dynamic'

const dateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

async function fetchScenes(): Promise<SceneCardData[]> {
  const operations = await getSceneOperations()
  const scenes = await operations.listScenes({ limit: 50 })
  return Promise.all(
    scenes.map(async (scene) => ({
      id: scene.id,
      name: scene.name,
      version: scene.version,
      nodeCount: scene.nodeCount,
      thumbnailUrl: scene.thumbnailUrl ?? (await sceneThumbnailUrl(scene.id)),
      updatedAt: scene.updatedAt,
      updatedLabel: dateFormat.format(new Date(scene.updatedAt)),
    })),
  )
}

export default async function HomePage() {
  const scenes = await fetchScenes()

  return (
    <AppShell>
      <AppHeader>
        <CreateSceneButton />
        <Link aria-label="Settings" className={ICON_BUTTON} href="/settings" title="Settings">
          <Settings className="h-4 w-4" />
        </Link>
      </AppHeader>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {scenes.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-32 text-center">
            <PascalMark className="h-10 w-10" />
            <p className="max-w-xs text-muted-foreground text-sm">
              Your scenes live here. Start one to begin designing.
            </p>
            <CreateSceneButton />
          </div>
        ) : (
          <>
            <h1 className="mb-6 font-semibold text-lg">Scenes</h1>
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {scenes.map((scene) => (
                <SceneCard key={scene.id} scene={scene} />
              ))}
            </ul>
          </>
        )}
      </main>
    </AppShell>
  )
}
