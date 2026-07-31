'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useRef, useState } from 'react'
import { useSession } from '@/components/auth/session-provider'

/**
 * Imports an IFC building model as a new scene.
 *
 * Conversion runs in the browser: web-ifc is a WASM parser, and a model is
 * routinely tens of megabytes, so shipping the bytes to the server first would
 * cost an upload for work the page can do itself. Only the converted scene
 * graph is posted, through the same endpoint as "Create new scene", so the
 * result is owned by the signed-in user and stored like any other scene.
 *
 * The converter and its WASM are pulled in on first use rather than imported
 * at the top, keeping roughly a megabyte and a half out of the initial load
 * for everyone who never imports a model.
 */
export function IfcImportButton() {
  const router = useRouter()
  const { user, openAuth } = useSession()
  const inputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleFile = useCallback(
    async (file: File) => {
      setError(null)
      setStatus('Reading file…')
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())

        setStatus('Loading converter…')
        const { convertIfcToPascal } = await import('@pascal-app/ifc-converter')

        const graph = await convertIfcToPascal(bytes, (message, percent) => {
          setStatus(`${message} (${percent}%)`)
        })

        const nodeCount = Object.keys(graph.nodes).length
        if (nodeCount === 0) {
          setError('No convertible elements were found in that file.')
          return
        }

        setStatus(`Saving ${nodeCount} elements…`)
        const response = await fetch('/api/scenes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: file.name.replace(/\.ifc$/i, '') || 'Imported model',
            graph: { nodes: graph.nodes, rootNodeIds: graph.rootNodeIds },
          }),
        })
        if (response.status === 401) {
          openAuth()
          return
        }
        if (!response.ok) {
          setError(`Could not save the imported scene (${response.status})`)
          return
        }
        const meta = (await response.json()) as { id: string }
        router.push(`/scene/${meta.id}`)
      } catch (err) {
        // A conversion failure is the expected case for an unusual export, so
        // surface what the parser said rather than a generic message.
        setError(err instanceof Error ? err.message : 'Could not read that IFC file.')
      } finally {
        setStatus(null)
      }
    },
    [router, openAuth],
  )

  const busy = status !== null

  return (
    <div className="flex flex-col items-end gap-1">
      <input
        accept=".ifc"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          // Clear the input so picking the same file twice still fires.
          event.target.value = ''
          if (file) void handleFile(file)
        }}
        ref={inputRef}
        type="file"
      />
      <button
        className="rounded-md border border-border px-3 py-1.5 font-medium text-sm disabled:opacity-60"
        disabled={busy}
        onClick={() => {
          if (!user) {
            openAuth()
            return
          }
          inputRef.current?.click()
        }}
        type="button"
      >
        {busy ? 'Importing…' : 'Import IFC'}
      </button>
      {status && <span className="text-muted-foreground text-xs">{status}</span>}
      {error && <span className="max-w-xs text-right text-red-600 text-xs">{error}</span>}
    </div>
  )
}
