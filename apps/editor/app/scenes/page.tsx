import { type I18nLocale, translate } from '@pascal-app/editor/i18n'
import { cookies, headers } from 'next/headers'
import Link from 'next/link'
import { CreateSceneButton } from '@/components/save-button'
import type { SceneMeta } from '@/components/scene-loader'
import { ServerLocalizedContent } from '@/components/server-localized-content'

export const dynamic = 'force-dynamic'

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

async function fetchScenes(): Promise<SceneMeta[]> {
  const base = await resolveBaseUrl()
  const response = await fetch(`${base}/api/scenes?limit=50`, {
    cache: 'no-store',
  })
  if (!response.ok) {
    return []
  }
  const payload = (await response.json()) as { scenes?: SceneMeta[] } | SceneMeta[]
  if (Array.isArray(payload)) {
    return payload
  }
  return payload.scenes ?? []
}

function formatDate(iso: string, locale: I18nLocale): string {
  try {
    return new Date(iso).toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-US')
  } catch {
    return iso
  }
}

export default async function ScenesPage() {
  const scenes = await fetchScenes()
  const locale = (await cookies()).get('pascal-locale')?.value === 'en' ? 'en' : 'tr'
  const t = (text: string) => translate(text, locale)

  return (
    <ServerLocalizedContent locale={locale}>
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-10 border-border border-b bg-background/95 backdrop-blur">
          <div className="container mx-auto flex items-center justify-between gap-4 px-6 py-4">
            <nav className="flex items-center gap-4 text-sm">
              <Link
                className="text-muted-foreground transition-colors hover:text-foreground"
                href="/"
              >
                {t('Home')}
              </Link>
              <span className="text-muted-foreground">/</span>
              <span className="font-medium text-foreground">{t('Scenes')}</span>
            </nav>
            <CreateSceneButton />
          </div>
        </header>

        <main className="container mx-auto max-w-5xl px-6 py-12">
          <h1 className="mb-2 font-bold text-3xl">{t('Your scenes')}</h1>
          <p className="mb-8 text-muted-foreground text-sm">
            {scenes.length === 0
              ? t('No scenes yet. Create one to get started.')
              : translate(`${scenes.length} scene${scenes.length === 1 ? '' : 's'}.`, locale)}
          </p>

          {scenes.length === 0 ? (
            <div className="rounded-xl border border-border/60 border-dashed bg-background p-12 text-center">
              <p className="text-muted-foreground text-sm">
                {t("You haven't saved any scenes yet.")}
              </p>
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
                        <span className="text-muted-foreground text-xs">{t('No thumbnail')}</span>
                      )}
                    </div>
                    <div className="mt-3">
                      <h2 className="truncate font-semibold text-sm group-hover:text-foreground">
                        {scene.name}
                      </h2>
                      <div className="mt-1 flex items-center justify-between text-muted-foreground text-xs">
                        <span>{translate(`${scene.nodeCount} nodes`, locale)}</span>
                        <time dateTime={scene.updatedAt}>
                          {formatDate(scene.updatedAt, locale)}
                        </time>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </main>
      </div>
    </ServerLocalizedContent>
  )
}
