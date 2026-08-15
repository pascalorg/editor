'use client'

import { Bot, Check, X } from 'lucide-react'
import { applyPendingAgentChange, rejectPendingAgentChange } from '../../lib/agent-changes'
import { LocalizedContent, useTranslation } from '../../lib/i18n'
import useAgentActivity from '../../store/use-agent-activity'

/**
 * The approve / reject gate for a scene change an MCP agent just made.
 *
 * Until this existed, an agent edit landed silently and wholesale — no signal
 * that anything happened, no way to refuse it, and the apply path wiped the
 * undo history on the way through. This bar is the "what just happened" half;
 * `applyAgentSceneGraph` is the single-undo half.
 */
export function AgentReviewBar() {
  const t = useTranslation()
  const pending = useAgentActivity((state) => state.pending)

  if (!pending) return null

  const { entry } = pending
  const delta = entry.nodesAfter - entry.nodesBefore

  return (
    <LocalizedContent>
      <div className="pointer-events-auto absolute top-4 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border border-border bg-background p-3 shadow-xl">
        <div className="flex items-start gap-2">
          <Bot className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-foreground text-sm">
              {t('The agent changed the scene')}
            </p>
            <p className="mt-0.5 text-muted-foreground text-xs">
              <code className="font-mono text-foreground/80">{entry.kind}</code>
              {' · '}
              {delta === 0
                ? t('no change in node count')
                : `${delta > 0 ? '+' : ''}${delta} ${t('nodes')}`}
            </p>
          </div>
        </div>

        <div className="mt-2.5 flex items-center gap-1.5">
          <button
            className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 font-medium text-primary-foreground text-xs transition-opacity hover:opacity-90"
            onClick={applyPendingAgentChange}
            type="button"
          >
            <Check className="h-3.5 w-3.5" />
            {t('Apply')}
          </button>
          <button
            className="flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 font-medium text-xs transition-colors hover:bg-accent/40"
            onClick={rejectPendingAgentChange}
            type="button"
          >
            <X className="h-3.5 w-3.5" />
            {t('Reject')}
          </button>
          {/* The honest caveat: MCP writes first and notifies second, so the
              agent's own client already thinks this landed. Rejecting corrects
              the scene rather than cancelling the operation. */}
          <span className="ml-auto text-[10px] text-muted-foreground/70">
            {t('Rejecting restores the scene; the agent is not told')}
          </span>
        </div>
      </div>
    </LocalizedContent>
  )
}
