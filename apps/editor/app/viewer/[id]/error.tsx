'use client'

import Link from 'next/link'
import { useEffect } from 'react'

export default function ViewerRouteError({
  error,
  reset,
}: Readonly<{
  error: Error & { digest?: string }
  reset: () => void
}>) {
  useEffect(() => {
    console.error('[viewer-route] Unhandled viewer error:', error)
  }, [error])

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-4 text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-background p-6 shadow-xl">
        <h1 className="text-lg font-semibold">Viewer error</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We couldn&apos;t load this project view. You can retry without leaving the app.
        </p>
        <div className="mt-4 flex items-center gap-2">
          <button
            className="rounded-md border border-border bg-accent px-3 py-2 text-sm font-medium hover:bg-accent/80"
            onClick={reset}
            type="button"
          >
            Try again
          </button>
          <Link
            className="rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent/40"
            href="/"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  )
}
