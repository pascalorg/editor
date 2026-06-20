import Link from 'next/link'
import { CreateSceneButton } from '@/components/save-button'
import { t } from '@/i18n'

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <section className="w-full max-w-3xl rounded-3xl border border-border/60 bg-background/95 p-10 text-center shadow-2xl">
        <p className="font-mono text-muted-foreground text-xs uppercase tracking-[0.3em]">
          Pascal Editor
        </p>
        <h1 className="mt-4 font-bold text-4xl text-foreground">
          {t('home.title', 'Scene design workspace')}
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground text-sm leading-6">
          {t(
            'home.subtitle',
            'Create, open, and manage saved scenes from one place. Local unsaved editor mode is disabled on the home page.',
          )}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <CreateSceneButton />
          <Link
            className="rounded-md border border-border bg-background px-4 py-2 font-medium text-sm transition-colors hover:bg-accent/40"
            href="/scenes"
          >
            {t('scene.allScenes', 'All scenes')}
          </Link>
          <Link
            className="rounded-md border border-border bg-background px-4 py-2 font-medium text-sm transition-colors hover:bg-accent/40"
            href="/profile-packs"
          >
            行业设备包
          </Link>
        </div>
      </section>
    </main>
  )
}
