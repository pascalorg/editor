'use client'

import Link from 'next/link'
import { CreateSceneButton } from '@/components/save-button'
import type { SceneMeta } from '@/components/scene-loader'
import { useLocale, messages } from '../../../../packages/editor/src/lib/i18n'

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function ScenesList({ scenes }: { scenes: SceneMeta[] }) {
  const { locale } = useLocale()
  const t = (key: string, params?: Record<string, string | number>) => {
    const text = (messages[locale] as Record<string, string>)[key] || key
    if (!params) return text
    return text.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`))
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-border border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto flex items-center justify-between gap-4 px-6 py-4">
          <nav className="flex items-center gap-4 text-sm">
            <Link
              className="text-muted-foreground transition-colors hover:text-foreground"
              href="/"
            >
              {t('common.home')}
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="font-medium text-foreground">{t('nav.scenes')}</span>
          </nav>
          <CreateSceneButton label={t('editor.createNew')} />
        </div>
      </header>

      <main className="container mx-auto max-w-5xl px-6 py-12">
        <h1 className="mb-2 font-bold text-3xl text-foreground">{t('scenes.title')}</h1>
        <p className="mb-8 text-muted-foreground text-sm">
          {scenes.length === 0
            ? t('scenes.noScenes')
            : t(
                scenes.length === 1 ? 'scenes.sceneCount' : 'scenes.sceneCount_plural',
                { count: scenes.length },
              )}
        </p>

        {scenes.length === 0 ? (
          <div className="rounded-xl border border-border/60 border-dashed bg-background p-12 text-center">
            <p className="text-muted-foreground text-sm">{t('scenes.noScenesSaved')}</p>
            <div className="mt-4 flex justify-center">
              <CreateSceneButton label={t('editor.createNew')} />
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
                      <span className="text-muted-foreground text-xs">{t('scenes.noThumbnail')}</span>
                    )}
                  </div>
                  <div className="mt-3">
                    <h2 className="truncate font-semibold text-sm group-hover:text-foreground">
                      {scene.name}
                    </h2>
                    <div className="mt-1 flex items-center justify-between text-muted-foreground text-xs">
                      <span>{t('scenes.nodes', { count: scene.nodeCount })}</span>
                      <time dateTime={scene.updatedAt}>{formatDate(scene.updatedAt)}</time>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
