'use client'

import { useTranslation } from '@pascal-app/editor'
import { useCallback, useState } from 'react'
import { authClient } from '@/lib/auth-client'
import { cn } from '@/lib/utils'
import { TOP_BAR_ACTION } from './editor-top-bar'

type ShareState = 'idle' | 'minting' | 'ready' | 'error'

/**
 * Mints a view-only link for the scene and puts it on the clipboard.
 *
 * The link is minted fresh on each press rather than stored: the token is
 * stateless, so there is no "the" link to look up, and re-pressing after an
 * expiry hands out a working one without any revocation step.
 */
export function ShareLinkButton({ sceneId }: { sceneId: string }) {
  const t = useTranslation()
  const [state, setState] = useState<ShareState>('idle')
  const [url, setUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const { data: session } = authClient.useSession()
  const isAnonymous = session?.user?.isAnonymous ?? false

  const share = useCallback(async () => {
    if (isAnonymous) return
    setState('minting')
    setCopied(false)
    try {
      const response = await fetch(`/api/scenes/${encodeURIComponent(sceneId)}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!response.ok) {
        setState('error')
        return
      }
      const { url: shareUrl } = (await response.json()) as { url: string }
      setUrl(shareUrl)
      setState('ready')

      // Deliberately not awaited. `clipboard.writeText` can hang indefinitely
      // when the document isn't focused rather than rejecting, which left the
      // button stuck on "Creating link…" with a link that had already been
      // minted. The link is on screen either way; copying is the shortcut, not
      // the outcome.
      navigator.clipboard?.writeText(shareUrl).then(
        () => setCopied(true),
        () => setCopied(false),
      )
    } catch {
      setState('error')
    }
  }, [sceneId, isAnonymous])

  return (
    <>
      <button
        className={cn(TOP_BAR_ACTION, state === 'ready' && 'bg-accent text-foreground')}
        disabled={state === 'minting' || isAnonymous}
        onClick={share}
        title={
          isAnonymous
            ? t('Sign in to share scenes')
            : t('Create a view-only link — visitors can look, measure and comment, not edit')
        }
        type="button"
      >
        {state === 'minting'
          ? t('Creating link…')
          : state === 'ready'
            ? copied
              ? t('Link copied')
              : t('View-only link')
            : state === 'error'
              ? t('Link failed')
              : t('Share')}
      </button>
      {url && state === 'ready' ? (
        <input
          className="w-56 truncate border-border border-l bg-background px-2 font-mono text-[11px] text-muted-foreground outline-none"
          onFocus={(event) => event.currentTarget.select()}
          readOnly
          value={url}
        />
      ) : null}
    </>
  )
}
