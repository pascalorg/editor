'use client'

import { Bot, Check, ImagePlus, LoaderCircle, Send, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

type Phase =
  | 'intake'
  | 'clarifying'
  | 'awaiting_confirmation'
  | 'awaiting_modification_confirmation'
  | 'inspecting'
  | 'generating'
  | 'modifying'
  | 'completed'
  | 'completed_with_issues'
  | 'cancelled'
  | 'failed'

type WorkflowSession = {
  phase: Phase
  availability: 'usable' | 'partially_usable' | 'unusable'
  summary: string
  questions: string[]
  messages?: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool'
    content?: string | null | unknown[]
  }>
  sceneResult?: {
    editorUrl: string | null
    version?: number | null
    repairRounds: number
    remainingIssueCount?: number
    verificationIssues?: string[]
    collisions?: Array<{ aId: string; bId: string; kind: string }>
  }
  executionSteps?: Array<{
    phase: string
    status: 'completed' | 'failed'
    label: string
  }>
}

type ChatResponse = {
  reply: string
  session: WorkflowSession
}

type UiMessage = { id: string; role: 'user' | 'assistant'; content: string }

function aiAgentUrl(): string {
  if (process.env.NEXT_PUBLIC_AI_AGENT_URL) return process.env.NEXT_PUBLIC_AI_AGENT_URL
  return '/api/ai'
}

function editorHref(editorUrl: string): string {
  if (window.location.pathname.startsWith('/_pascal')) {
    return `/_pascal${editorUrl}`
  }
  return editorUrl
}

function mapSessionMessages(session: WorkflowSession): UiMessage[] {
  return (session.messages ?? [])
    .filter(
      (message) =>
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string',
    )
    .map((message) => ({
      id: crypto.randomUUID(),
      role: message.role as 'user' | 'assistant',
      content: message.content as string,
    }))
}

function createSessionId(sceneId?: string): string {
  const storageKey = `pascal-ai-session:${sceneId ?? 'local-editor'}`
  const existing = window.localStorage.getItem(storageKey)
  if (existing) return existing
  const created = crypto.randomUUID()
  window.localStorage.setItem(storageKey, created)
  return created
}

export function AiAssistantPanel({ sceneId }: { sceneId?: string }) {
  const [sessionId, setSessionId] = useState('')
  const [session, setSession] = useState<WorkflowSession | null>(null)
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [input, setInput] = useState('')
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [imageName, setImageName] = useState('')
  const [busy, setBusy] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSessionId(createSessionId(sceneId))
  }, [sceneId])

  useEffect(() => {
    if (!sessionId) return
    const controller = new AbortController()
    void fetch(`${aiAgentUrl()}/sessions/${encodeURIComponent(sessionId)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return
        const payload = (await response.json()) as { session: WorkflowSession | null }
        if (!payload.session) return
        setSession(payload.session)
        setMessages(mapSessionMessages(payload.session))
      })
      .catch((loadError: unknown) => {
        if (!(loadError instanceof DOMException && loadError.name === 'AbortError')) {
          console.warn('[ai-assistant] session restore failed', loadError)
        }
      })
    return () => controller.abort()
  }, [sessionId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  })

  // Fetch the persisted session directly. Used to recover the real outcome
  // when a /chat response comes back empty or truncated even though the
  // backend actually finished and saved the session.
  const recoverSession = useCallback(async (): Promise<WorkflowSession | null> => {
    if (!sessionId) return null
    try {
      const res = await fetch(`${aiAgentUrl()}/sessions/${encodeURIComponent(sessionId)}`, {
        cache: 'no-store',
      })
      const text = await res.text()
      if (!res.ok || !text) return null
      const payload = JSON.parse(text) as { session: WorkflowSession | null }
      return payload.session ?? null
    } catch {
      return null
    }
  }, [sessionId])

  const maybeRedirectToScene = useCallback(
    (body: Record<string, unknown>, target: WorkflowSession) => {
      const generatedUrl = target.sceneResult?.editorUrl
      if (
        body.action === 'confirm' &&
        generatedUrl &&
        (target.phase === 'completed' || target.phase === 'completed_with_issues') &&
        !sceneId
      ) {
        window.location.assign(editorHref(generatedUrl))
      }
    },
    [sceneId],
  )

  const callAgent = useCallback(
    async (body: Record<string, unknown>) => {
      if (!sessionId) return
      setBusy(true)
      setError('')
      try {
        const response = await fetch(`${aiAgentUrl()}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, ...(sceneId ? { sceneId } : {}), ...body }),
        })
        // Read as text first — never call response.json() directly, which
        // throws "Unexpected end of JSON input" on an empty/truncated body
        // (e.g. a long generation whose HTTP response got cut) and hides the
        // fact that the generation may have succeeded server-side.
        const rawText = await response.text()
        let payload: (ChatResponse & { error?: string }) | null = null
        if (rawText) {
          try {
            payload = JSON.parse(rawText) as ChatResponse & { error?: string }
          } catch {
            payload = null
          }
        }

        if (!payload) {
          console.warn('[ai-assistant] /chat returned an empty or non-JSON body', {
            status: response.status,
            contentType: response.headers.get('content-type'),
            bodyLength: rawText.length,
            bodySnippet: rawText.slice(0, 200),
          })
          const recovered = await recoverSession()
          if (recovered) {
            // The generation actually completed and was persisted — show it
            // as the success it is rather than a JSON parse error.
            setSession(recovered)
            setMessages(mapSessionMessages(recovered))
            maybeRedirectToScene(body, recovered)
            return
          }
          throw new Error('The AI service returned an empty or truncated response. If generation may have finished, refresh the page to check the result, or try again later.')
        }

        if (!response.ok) throw new Error(payload.error ?? `AI request failed (${response.status})`)
        setSession(payload.session)
        setMessages((current) => [
          ...current,
          { id: crypto.randomUUID(), role: 'assistant', content: payload.reply },
        ])
        maybeRedirectToScene(body, payload.session)
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : String(requestError))
      } finally {
        setBusy(false)
      }
    },
    [maybeRedirectToScene, recoverSession, sceneId, sessionId],
  )

  // Stop an in-flight generation/modification. Sent as a separate, concurrent
  // request (not through the busy-gated `callAgent`) so it reaches the backend
  // while the long generation request is still pending — the backend aborts
  // that run, which then resolves with the cancelled session and updates the
  // UI. We deliberately don't setSession from here to avoid racing with it.
  const cancelGeneration = useCallback(async () => {
    if (!sessionId || cancelling) return
    setCancelling(true)
    try {
      await fetch(`${aiAgentUrl()}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, ...(sceneId ? { sceneId } : {}), action: 'cancel' }),
      })
    } catch {
      // Best-effort: the in-flight request will still surface the outcome.
    } finally {
      setCancelling(false)
    }
  }, [cancelling, sceneId, sessionId])

  const send = useCallback(async () => {
    const message = input.trim()
    if ((!message && !imageDataUrl) || busy) return
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: imageDataUrl ? `${message || 'Please analyze this floor plan'}\n[Image: ${imageName}]` : message,
      },
    ])
    setInput('')
    const image = imageDataUrl
    setImageDataUrl(null)
    setImageName('')
    await callAgent({ ...(message ? { message } : {}), ...(image ? { imageDataUrl: image } : {}) })
  }, [busy, callAgent, imageDataUrl, imageName, input])

  const handleImage = useCallback(async (file: File | undefined) => {
    if (!file) return
    setError('')
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setError('Only JPG, JPEG, or PNG floor plans are supported.')
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('The image must be smaller than 20 MB.')
      return
    }
    try {
      const bitmap = await createImageBitmap(file)
      const longSide = Math.max(bitmap.width, bitmap.height)
      const shortSide = Math.min(bitmap.width, bitmap.height)
      bitmap.close()
      if (longSide < 1200 || shortSide < 600) {
        setError('Image resolution too low: at least 1200px on the long side and 600px on the short side.')
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        setImageDataUrl(typeof reader.result === 'string' ? reader.result : null)
        setImageName(file.name)
      }
      reader.onerror = () => setError('Could not read the image. Please choose it again.')
      reader.readAsDataURL(file)
    } catch {
      setError('Could not parse the image. Please make sure the file is not corrupted.')
    }
  }, [])

  const clearSession = useCallback(async () => {
    if (!sessionId || busy) return
    await fetch(`${aiAgentUrl()}/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
    const storageKey = `pascal-ai-session:${sceneId ?? 'local-editor'}`
    window.localStorage.removeItem(storageKey)
    setSessionId(createSessionId(sceneId))
    setSession(null)
    setMessages([])
    setError('')
  }, [busy, sceneId, sessionId])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-11 shrink-0 items-center gap-2 border-border/70 border-b px-3">
        <Bot className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate font-medium text-sm">AI Floor Plan Designer</span>
        {session && (
          <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {phaseLabel(session.phase)}
          </span>
        )}
        <button
          aria-label="Clear session"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => void clearSession()}
          type="button"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && (
          <div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-sm">
            <p className="font-medium">Describe the home you want</p>
            <p className="mt-1 text-muted-foreground text-xs leading-5">
              Enter the floor area, rooms, occupants, and constraints, or upload a floor plan image. I will ask follow-up questions when details are missing, and only change the scene after you confirm.
            </p>
          </div>
        )}
        {messages.map((message) => (
          <div
            className={
              message.role === 'user'
                ? 'ml-6 rounded-xl bg-blue-600 px-3 py-2 text-sm text-white'
                : 'mr-3 whitespace-pre-wrap rounded-xl border border-border/70 bg-muted/20 px-3 py-2 text-sm leading-5'
            }
            key={message.id}
          >
            {message.content}
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            <span>
              {session?.phase === 'generating'
                ? 'Generating and checking the scene…'
                : session?.phase === 'modifying'
                  ? 'Modifying and checking the scene…'
                  : 'Understanding your requirements…'}
            </span>
            {(session?.phase === 'generating' || session?.phase === 'modifying') && (
              <button
                className="ml-auto flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                disabled={cancelling}
                onClick={() => void cancelGeneration()}
                type="button"
              >
                <X className="h-3 w-3" />
                {cancelling ? 'Stopping…' : 'Stop generating'}
              </button>
            )}
          </div>
        )}
        {error && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive text-xs">{error}</p>
        )}
        {(session?.executionSteps?.length ?? 0) > 0 && (
          <div className="space-y-1 rounded-xl border border-border/70 bg-muted/20 p-3 text-xs">
            {session?.executionSteps?.map((step) => (
              <div className="flex items-center gap-2" key={step.phase}>
                <span className={step.status === 'completed' ? 'text-green-600' : 'text-destructive'}>
                  {step.status === 'completed' ? '✓' : '×'}
                </span>
                <span>{step.label}</span>
              </div>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {(session?.phase === 'awaiting_confirmation' ||
        session?.phase === 'awaiting_modification_confirmation' ||
        session?.phase === 'clarifying') && (
        <div className="flex gap-2 border-border/70 border-t p-3">
          <button
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 font-medium text-sm text-white hover:bg-blue-500 disabled:opacity-50"
            disabled={busy}
            onClick={() => void callAgent({ action: 'confirm' })}
            type="button"
          >
            <Check className="h-4 w-4" />
            {session.phase === 'awaiting_modification_confirmation'
              ? 'Confirm and apply'
              : session.phase === 'clarifying'
                ? 'Accept defaults and generate'
                : 'Confirm and generate'}
          </button>
          <button
            className="flex items-center justify-center gap-1 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
            disabled={busy}
            onClick={() => void callAgent({ action: 'cancel' })}
            type="button"
          >
            <X className="h-4 w-4" />
            Cancel
          </button>
        </div>
      )}

      {(session?.sceneResult?.remainingIssueCount ?? 0) > 0 && (
        <div className="mx-3 mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-700 text-xs">
          Automated checks still found {session?.sceneResult?.remainingIssueCount}{' '}
          issue(s). You can open the scene to review, or keep typing change requests.
        </div>
      )}

      <div className="border-border/70 border-t p-3">
        {imageDataUrl && (
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-muted px-2 py-1.5 text-xs">
            <ImagePlus className="h-3.5 w-3.5" />
            <span className="min-w-0 flex-1 truncate">{imageName}</span>
            <button
              onClick={() => {
                setImageDataUrl(null)
                setImageName('')
              }}
              type="button"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <button
            aria-label="Upload floor plan"
            className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            <ImagePlus className="h-4 w-4" />
          </button>
          <input
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={(event) => {
              void handleImage(event.target.files?.[0])
              event.target.value = ''
            }}
            ref={fileInputRef}
            type="file"
          />
          <textarea
            className="max-h-32 min-h-9 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-blue-500"
            disabled={busy || session?.phase === 'generating' || session?.phase === 'modifying'}
            maxLength={5000}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            placeholder={
              session?.phase === 'clarifying'
                ? 'Answer the questions above…'
                : session?.phase === 'completed' || session?.phase === 'completed_with_issues'
                  ? 'Keep refining the current floor plan…'
                  : 'Describe the area, rooms, and design requirements…'
            }
            rows={1}
            value={input}
          />
          <button
            aria-label="Send"
            className="rounded-lg bg-blue-600 p-2 text-white hover:bg-blue-500 disabled:opacity-40"
            disabled={busy || (!input.trim() && !imageDataUrl)}
            onClick={() => void send()}
            type="button"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

function phaseLabel(phase: Phase): string {
  return {
    intake: 'Waiting for input',
    clarifying: 'Needs details',
    awaiting_confirmation: 'Awaiting confirmation',
    awaiting_modification_confirmation: 'Awaiting change confirmation',
    inspecting: 'Inspecting',
    generating: 'Generating',
    modifying: 'Modifying',
    completed: 'Completed',
    completed_with_issues: 'Needs review',
    cancelled: 'Cancelled',
    failed: 'Needs attention',
  }[phase]
}
