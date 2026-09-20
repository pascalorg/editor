import ConstructionGuide from '@pascal-app/plugin-construction/guide'
import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Construction · Pascal' }

export default function ConstructionPage() {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
        <header className="mb-8 border-b pb-6">
          <Link
            className="rounded-sm text-muted-foreground text-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            href="/scenes"
          >
            ← Pascal scenes
          </Link>
          <p className="mt-6 text-muted-foreground text-sm">For homebuilders · early preview</p>
          <h1 className="mt-3 font-semibold text-3xl tracking-tight">
            Know the model. Plan the handoff.
          </h1>
          <p className="mt-3 max-w-prose text-muted-foreground leading-relaxed">
            Explore the workflow, building elements and expected outputs before opening a project.
          </p>
          <p className="mt-4 text-muted-foreground text-sm">
            In the editor, open Plugins → Construction → Install.
          </p>
        </header>
        <ConstructionGuide />
      </div>
    </main>
  )
}
