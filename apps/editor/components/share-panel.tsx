'use client'

import { Check, Copy, ExternalLink } from 'lucide-react'
import { type KeyboardEvent, type RefObject, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface SharePanelProps {
  sceneId: string
  /** The wrapper holding the trigger and the panel: a click inside it is not an outside click. */
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
}

const FIELD =
  'w-full rounded-lg border border-border/60 bg-accent/30 px-2.5 py-1.5 font-mono text-foreground text-xs outline-none focus:ring-1 focus:ring-primary/50'

const SMALL_BUTTON =
  'inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 font-medium text-xs transition-colors hover:bg-accent'

async function readShared(sceneId: string): Promise<boolean> {
  const response = await fetch(`/api/scenes/${encodeURIComponent(sceneId)}/share`, {
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`share state ${response.status}`)
  const body = (await response.json()) as { shared: boolean }
  return body.shared
}

async function writeShared(sceneId: string, shared: boolean): Promise<boolean> {
  const response = await fetch(`/api/scenes/${encodeURIComponent(sceneId)}/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shared }),
  })
  if (!response.ok) throw new Error(`share update ${response.status}`)
  const body = (await response.json()) as { shared: boolean }
  return body.shared
}

export function SharePanel({ sceneId, anchorRef, onClose }: SharePanelProps) {
  // null while the current state is loading.
  const [shared, setShared] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hideControls, setHideControls] = useState(false)

  useEffect(() => {
    let cancelled = false
    readShared(sceneId)
      .then((value) => {
        if (!cancelled) setShared(value)
      })
      .catch(() => {
        if (cancelled) return
        setShared(false)
        setError('Could not read the sharing state.')
      })
    return () => {
      cancelled = true
    }
  }, [sceneId])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (anchorRef.current?.contains(event.target as Node)) return
      onClose()
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [anchorRef, onClose])

  const toggle = async () => {
    if (shared === null || saving) return
    const previous = shared
    const next = !previous
    setShared(next)
    setSaving(true)
    setError(null)
    try {
      setShared(await writeShared(sceneId, next))
    } catch {
      setShared(previous)
      setError(next ? 'Could not turn on the public link.' : 'Could not turn off the public link.')
    } finally {
      setSaving(false)
    }
  }

  const embedUrl = `${window.location.origin}/embed/${sceneId}${hideControls ? '?ui=0' : ''}`
  const snippet = `<iframe src="${embedUrl}" width="800" height="500" style="border:0" allow="fullscreen" loading="lazy"></iframe>`

  return (
    // Keystrokes in here (Delete, Cmd+A, tool keys) must not reach the editor's shortcuts.
    <div
      aria-label="Share project"
      className="dark absolute top-full right-0 z-50 mt-2 w-80 rounded-xl border border-border/60 bg-background p-4 text-foreground shadow-2xl [color-scheme:dark]"
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key !== 'Escape') event.stopPropagation()
      }}
      role="dialog"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-sm" id="share-public-link-label">
          Public link
        </span>
        <Switch
          checked={shared === true}
          disabled={shared === null || saving}
          labelId="share-public-link-label"
          onClick={toggle}
        />
      </div>
      <p className="mt-1.5 text-muted-foreground text-xs">
        Anyone with the link can view this project. They cannot edit it.
      </p>
      {error && <p className="mt-2 text-destructive text-xs">{error}</p>}

      {shared && (
        <div className="mt-4 space-y-3 border-border/50 border-t pt-4">
          <div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-sm" id="share-hide-controls-label">
                Hide controls
              </span>
              <Switch
                checked={hideControls}
                labelId="share-hide-controls-label"
                onClick={() => setHideControls((value) => !value)}
              />
            </div>
            <p className="mt-1.5 text-muted-foreground text-xs">
              Only the 3D view, no header or toolbar.
            </p>
          </div>
          <div>
            <span className="mb-1.5 block text-muted-foreground text-xs">Link</span>
            <div className="flex items-center gap-1.5">
              <input
                aria-label="Embed link"
                className={FIELD}
                onFocus={(event) => event.currentTarget.select()}
                readOnly
                value={embedUrl}
              />
              <CopyButton text={embedUrl} />
            </div>
            <a
              className="mt-1.5 inline-flex items-center gap-1 text-muted-foreground text-xs transition-colors hover:text-foreground"
              href={embedUrl}
              rel="noopener"
              target="_blank"
            >
              <ExternalLink className="h-3 w-3" />
              Open
            </a>
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-muted-foreground text-xs">Embed code</span>
              <CopyButton text={snippet} />
            </div>
            <textarea
              aria-label="Embed code"
              className={cn(FIELD, 'h-20 resize-none leading-relaxed')}
              onFocus={(event) => event.currentTarget.select()}
              readOnly
              value={snippet}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function Switch({
  checked,
  disabled,
  labelId,
  onClick,
}: {
  checked: boolean
  disabled?: boolean
  labelId: string
  onClick: () => void
}) {
  return (
    <button
      aria-checked={checked}
      aria-labelledby={labelId}
      className={cn(
        'inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-input',
      )}
      disabled={disabled}
      onClick={onClick}
      role="switch"
      type="button"
    >
      <span
        className={cn(
          'pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </button>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Plain-http self-hosts have no Clipboard API; the field stays selectable.
      return
    }
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button className={SMALL_BUTTON} onClick={copy} type="button">
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}
