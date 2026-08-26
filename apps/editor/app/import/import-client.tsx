'use client'

import { type ValidateBuildJsonResult, validateBuildJson } from '@pascal-app/core'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { MAX_IMPORT_BYTES, parseImportSrc } from '@/lib/import-src'

type Phase =
  | { kind: 'fetching' }
  | { kind: 'review'; result: ValidateBuildJsonResult }
  | { kind: 'creating' }
  | { kind: 'error'; message: string }

/**
 * Client half of `/import?src=<url>`: fetches the build JSON in the
 * visitor's browser (same trust model as dropping a file on Load Build —
 * the target must allow CORS), runs the same `validateBuildJson`
 * pre-flight as Load Build, shows what would be imported, and only on an
 * explicit click creates the scene through the regular `POST /api/scenes`
 * route — so auth, origin checks and graph validation all apply
 * unchanged.
 */
export function ImportClient({ src, name }: { src: string | null; name: string | null }) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>({ kind: 'fetching' })
  const [sceneName, setSceneName] = useState(name ?? 'Imported scene')

  useEffect(() => {
    // A new src restarts the flow: reset to fetching so a stale review
    // (and its Import button) can never act on the previous file, and
    // ignore every state update from a superseded run — an abort must
    // not surface as an error either.
    setPhase({ kind: 'fetching' })
    const parsedSrc = parseImportSrc(src)
    if (!parsedSrc.ok) {
      setPhase({ kind: 'error', message: parsedSrc.reason })
      return
    }
    let cancelled = false
    const controller = new AbortController()
    const update = (next: Phase) => {
      if (!cancelled) setPhase(next)
    }
    ;(async () => {
      let response: Response
      try {
        response = await fetch(parsedSrc.url, { signal: controller.signal })
      } catch {
        update({
          kind: 'error',
          message:
            'The file could not be fetched. The server hosting it must allow cross-origin requests (CORS).',
        })
        return
      }
      if (!response.ok) {
        update({ kind: 'error', message: `The file could not be fetched (${response.status}).` })
        return
      }
      const declared = Number(response.headers.get('content-length') ?? 0)
      if (declared > MAX_IMPORT_BYTES) {
        update({ kind: 'error', message: 'The file is too large to import.' })
        return
      }
      let text: string
      try {
        text = await response.text()
      } catch {
        update({ kind: 'error', message: 'The file could not be read.' })
        return
      }
      if (text.length > MAX_IMPORT_BYTES) {
        update({ kind: 'error', message: 'The file is too large to import.' })
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        update({ kind: 'error', message: 'The file could not be parsed as JSON.' })
        return
      }
      update({ kind: 'review', result: validateBuildJson(parsed) })
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [src])

  const handleImport = useCallback(async () => {
    if (phase.kind !== 'review' || !phase.result.parsed) return
    setPhase({ kind: 'creating' })
    try {
      const response = await fetch('/api/scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: sceneName || 'Imported scene',
          graph: phase.result.parsed,
        }),
      })
      if (!response.ok) {
        setPhase({
          kind: 'error',
          message:
            response.status === 401 || response.status === 403
              ? 'You need to be signed in to import a scene.'
              : response.status === 413
                ? 'The scene is too large for the scene store.'
                : `Creating the scene failed (${response.status}).`,
        })
        return
      }
      const meta = (await response.json()) as { id: string }
      router.push(`/scene/${meta.id}`)
    } catch (error) {
      setPhase({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Creating the scene failed.',
      })
    }
  }, [phase, router, sceneName])

  if (phase.kind === 'fetching') {
    return <p className="text-muted-foreground text-sm">Fetching the scene…</p>
  }
  if (phase.kind === 'creating') {
    return <p className="text-muted-foreground text-sm">Creating the scene…</p>
  }
  if (phase.kind === 'error') {
    return (
      <div className="rounded-xl border border-border/60 bg-background p-6">
        <p className="text-destructive text-sm">{phase.message}</p>
      </div>
    )
  }

  const { result } = phase
  const typeEntries = Object.entries(result.stats.byType).sort((a, b) => b[1] - a[1])

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border/60 bg-background p-6">
        <label className="mb-1 block font-medium text-muted-foreground text-xs uppercase">
          Scene name
        </label>
        <input
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          onChange={(event) => setSceneName(event.target.value)}
          value={sceneName}
        />

        <p className="mt-4 mb-1 font-medium text-muted-foreground text-xs uppercase">Contents</p>
        <p className="text-sm">
          {result.stats.total} node{result.stats.total === 1 ? '' : 's'}
          {result.stats.floorAreaM2 > 0
            ? ` · ${Math.round(result.stats.floorAreaM2)} m² of floor`
            : ''}
        </p>
        {typeEntries.length > 0 && (
          <p className="mt-1 text-muted-foreground text-xs">
            {typeEntries.map(([type, count]) => `${count} ${type}`).join(' · ')}
          </p>
        )}

        {result.errors.length > 0 && (
          <ul className="mt-4 space-y-1">
            {result.errors.map((issue) => (
              <li className="text-destructive text-xs" key={`${issue.code}:${issue.message}`}>
                {issue.message}
              </li>
            ))}
          </ul>
        )}
        {result.warnings.length > 0 && (
          <ul className="mt-2 space-y-1">
            {result.warnings.map((issue) => (
              <li className="text-muted-foreground text-xs" key={`${issue.code}:${issue.message}`}>
                {issue.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        className="rounded-md border border-border bg-accent px-4 py-2 font-medium text-sm hover:bg-accent/80 disabled:opacity-50"
        disabled={!result.ok || !result.parsed}
        onClick={handleImport}
        type="button"
      >
        Import as a new scene
      </button>
    </div>
  )
}
