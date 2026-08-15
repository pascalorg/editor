'use client'

import { CornerDownLeft, Loader2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { LocalizedContent, useTranslation } from '../../../../lib/i18n'
import { cn } from '../../../../lib/utils'
import useAgentActivity, { type AgentPrompt } from '../../../../store/use-agent-activity'

/**
 * How long a claimed prompt may go unanswered before we stop implying work is
 * still happening. An agent that crashed mid-task leaves its request claimed
 * forever, and a permanent "working on it" is the exact failure this panel
 * exists to prevent — the user needs to know to ask again.
 *
 * Nothing is re-queued automatically: a slow agent is indistinguishable from a
 * dead one from here, and handing the same prompt out twice would double the
 * edits it makes.
 */
const STALLED_AFTER_MS = 5 * 60 * 1000

function isStalled(entry: AgentPrompt): boolean {
  if (entry.status !== 'claimed' || !entry.claimedAt) return false
  const claimed = new Date(entry.claimedAt).getTime()
  return Number.isFinite(claimed) && Date.now() - claimed > STALLED_AFTER_MS
}

/**
 * Ask the connected agent for something, from inside the editor.
 *
 * MCP is client-driven: a server cannot start a conversation, so this box does
 * not send a message anywhere. It queues a request that an agent picks up with
 * `await_editor_request` — which means the agent has to be watching, and a
 * prompt can sit unread. Both states are shown rather than hidden behind a
 * spinner, because "nothing is listening" is the failure the user needs to be
 * able to tell apart from "still working".
 */
export function AgentPromptBox() {
  const t = useTranslation()
  const sendPrompt = useAgentActivity((s) => s.sendPrompt)
  const prompts = useAgentActivity((s) => s.prompts)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(async () => {
    const text = draft.trim()
    if (!text || !sendPrompt || sending) return
    setSending(true)
    setError(null)
    try {
      await sendPrompt(text)
      setDraft('')
    } catch (err) {
      // The failure this exists to avoid: a prompt that vanishes with no sign.
      setError(err instanceof Error ? err.message : 'Could not send the prompt')
    } finally {
      setSending(false)
    }
  }, [draft, sendPrompt, sending])

  // An embedder with no queue endpoint gets no box, rather than one that
  // silently drops what is typed into it.
  if (!sendPrompt) return null

  const recent = prompts.slice(-4)

  return (
    <LocalizedContent>
      <div className="flex flex-col gap-1.5 border-border/40 border-b px-3 py-2.5">
        {recent.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {recent.map((entry) => (
              <li className="flex flex-col gap-0.5 text-[11px]" key={entry.requestId}>
                <span className="text-foreground/90">{entry.prompt}</span>
                {entry.answer ? (
                  <span className="text-muted-foreground">{entry.answer}</span>
                ) : (
                  <span
                    className={cn(
                      'text-[10px]',
                      isStalled(entry)
                        ? 'text-red-700 dark:text-red-400'
                        : entry.status === 'claimed'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-muted-foreground',
                    )}
                  >
                    {isStalled(entry)
                      ? 'The agent stopped without answering'
                      : entry.status === 'claimed'
                        ? 'Agent is working on it'
                        : 'Waiting for an agent'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-end gap-1.5">
          <textarea
            className="min-h-[3.5rem] flex-1 resize-none rounded-md border border-border/60 bg-transparent px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-border"
            disabled={sending}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter breaks the line — a prompt is usually
              // one sentence, and reaching for a button breaks the flow.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void submit()
              }
            }}
            placeholder={t('Ask the agent to change the model…')}
            value={draft}
          />
          <button
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-foreground disabled:opacity-40"
            disabled={sending || draft.trim().length === 0}
            onClick={() => void submit()}
            title={t('Send to the agent')}
            type="button"
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CornerDownLeft className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        {error && <span className="text-[11px] text-red-700 dark:text-red-400">{error}</span>}
      </div>
    </LocalizedContent>
  )
}
