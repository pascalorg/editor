'use client'

import { Bot, Check, X } from 'lucide-react'
import { LocalizedContent, useTranslation } from '../../../../lib/i18n'
import { cn } from '../../../../lib/utils'
import useAgentActivity from '../../../../store/use-agent-activity'

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

/**
 * What the connected MCP agent has been doing to this scene.
 *
 * Every mutating MCP tool already publishes an event naming itself, so this
 * feed is a read of information the system was producing and discarding. It is
 * the transparency half of the agent work: the user can see which tool ran,
 * when, and how much of the scene it touched.
 */
export function AgentActivitySection() {
  const t = useTranslation()
  const entries = useAgentActivity((s) => s.entries)
  const connected = useAgentActivity((s) => s.connected)
  const autoApply = useAgentActivity((s) => s.autoApply)
  const setAutoApply = useAgentActivity((s) => s.setAutoApply)

  return (
    <LocalizedContent>
      <div className="flex flex-col border-border/40 border-b">
        <div className="flex items-center gap-1.5 px-3 pt-3 pb-1.5">
          <Bot className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-semibold text-muted-foreground text-xs tracking-tight">
            Agent activity
          </span>
          <span
            className={cn(
              'ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px]',
              connected
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                : 'bg-foreground/10 text-muted-foreground',
            )}
            title={connected ? t('Live scene stream connected') : t('No live scene stream')}
          >
            {connected ? 'Connected' : 'Offline'}
          </span>
        </div>

        <label className="flex cursor-pointer items-center gap-1.5 px-3 pb-1.5 text-[11px] text-muted-foreground">
          <input
            checked={autoApply}
            className="h-3 w-3 accent-current"
            onChange={(event) => setAutoApply(event.target.checked)}
            type="checkbox"
          />
          Apply agent changes without asking
        </label>

        {entries.length === 0 ? (
          <p className="px-3 pb-2.5 text-[11px] text-muted-foreground/60">
            Connect a Claude client to this scene's MCP server. Every tool it runs shows up here,
            and scene changes wait for your approval.
          </p>
        ) : (
          <ul className="flex flex-col pb-2">
            {entries.map((entry) => {
              const delta = entry.nodesAfter - entry.nodesBefore
              return (
                <li
                  className="flex items-baseline gap-1.5 px-3 py-1 transition-colors hover:bg-foreground/5"
                  key={entry.id}
                >
                  {entry.status === 'applied' ? (
                    <Check className="h-3 w-3 shrink-0 translate-y-0.5 text-emerald-600 dark:text-emerald-400" />
                  ) : entry.status === 'rejected' ? (
                    <X className="h-3 w-3 shrink-0 translate-y-0.5 text-muted-foreground/60" />
                  ) : (
                    <span className="h-1.5 w-1.5 shrink-0 translate-y-1 rounded-full bg-primary" />
                  )}
                  <code
                    className={cn(
                      'min-w-0 flex-1 truncate font-mono text-[11px]',
                      entry.status === 'rejected'
                        ? 'text-muted-foreground line-through'
                        : 'text-foreground',
                    )}
                  >
                    {entry.kind}
                  </code>
                  {delta !== 0 ? (
                    <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                      {delta > 0 ? '+' : ''}
                      {delta}
                    </span>
                  ) : null}
                  <span className="shrink-0 text-[10px] text-muted-foreground/60 tabular-nums">
                    {formatTime(entry.receivedAt)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </LocalizedContent>
  )
}
