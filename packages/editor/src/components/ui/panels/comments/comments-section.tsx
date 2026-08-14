'use client'

import { sortCommentThreads, useScene } from '@pascal-app/core'
import { Check, Eye, EyeOff, MessageSquare } from 'lucide-react'
import {
  applyCommentCamera,
  commentMessageCount,
  currentCommentAuthor,
} from '../../../../lib/comments'
import { LocalizedContent } from '../../../../lib/i18n'
import { cn } from '../../../../lib/utils'
import useEditor from '../../../../store/use-editor'
import useCommentUi from '../../../../store/use-comment-ui'

/**
 * The thread list. Its job is the half of review that pins cannot do: telling
 * you there *is* feedback on a part of the model you are not currently looking
 * at. Clicking a thread opens its bubble and, when the thread recorded one,
 * restores the camera it was written against.
 */
export function CommentsSection() {
  const comments = useScene((s) => s.comments)
  const setCommentResolved = useScene((s) => s.setCommentResolved)
  const mode = useEditor((s) => s.mode)
  const setMode = useEditor((s) => s.setMode)
  const activeId = useCommentUi((s) => s.activeId)
  const setActiveId = useCommentUi((s) => s.setActiveId)
  const showResolved = useCommentUi((s) => s.showResolved)
  const setShowResolved = useCommentUi((s) => s.setShowResolved)

  const all = sortCommentThreads(comments)
  const list = showResolved ? all : all.filter((thread) => !thread.resolved)
  const resolvedCount = all.length - all.filter((thread) => !thread.resolved).length
  const isCommenting = mode === 'comment'

  return (
    <LocalizedContent>
      <div className="flex flex-col border-border/40 border-b">
        <div className="flex items-center gap-1.5 px-3 pt-3 pb-1.5">
          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-semibold text-muted-foreground text-xs tracking-tight">
            Comments
          </span>
          {resolvedCount > 0 ? (
            <button
              aria-label={showResolved ? 'Hide resolved comments' : 'Show resolved comments'}
              className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground"
              onClick={() => setShowResolved(!showResolved)}
              title={showResolved ? 'Hide resolved' : `Show resolved (${resolvedCount})`}
              type="button"
            >
              {showResolved ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            </button>
          ) : null}
          <button
            className={cn(
              'shrink-0 rounded px-1.5 py-0.5 text-[11px] transition-colors',
              resolvedCount > 0 ? '' : 'ml-auto',
              isCommenting
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground/70 hover:bg-foreground/10 hover:text-foreground',
            )}
            onClick={() => setMode(isCommenting ? 'select' : 'comment')}
            title="Drop a comment pin"
            type="button"
          >
            {isCommenting ? 'Placing' : 'Add'}
          </button>
        </div>

        {list.length === 0 ? (
          <p className="px-3 pb-2.5 text-[11px] text-muted-foreground/60">
            Pin feedback to a spot in the model. Comments travel with the scene and never enter
            the undo history.
          </p>
        ) : (
          <ul className="flex flex-col pb-2">
            {list.map((thread) => (
              <li
                className={cn(
                  'group flex items-start gap-1.5 px-3 py-1.5 transition-colors hover:bg-foreground/5',
                  activeId === thread.id && 'bg-foreground/5',
                )}
                key={thread.id}
              >
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    setActiveId(thread.id)
                    applyCommentCamera(thread)
                  }}
                  type="button"
                >
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className={cn(
                        'truncate font-medium text-xs',
                        thread.resolved ? 'text-muted-foreground line-through' : 'text-foreground',
                      )}
                    >
                      {thread.author.name}
                    </span>
                    {commentMessageCount(thread) > 1 ? (
                      <span className="shrink-0 text-[10px] text-muted-foreground/70 tabular-nums">
                        {commentMessageCount(thread)}
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">{thread.body}</p>
                </button>
                <button
                  aria-label={thread.resolved ? 'Reopen comment' : 'Resolve comment'}
                  className={cn(
                    'shrink-0 rounded p-0.5 transition-colors hover:bg-foreground/10',
                    thread.resolved
                      ? 'text-foreground'
                      : 'text-muted-foreground/50 opacity-0 group-hover:opacity-100 focus-within:opacity-100 hover:text-foreground',
                  )}
                  onClick={() =>
                    setCommentResolved(thread.id, !thread.resolved, currentCommentAuthor())
                  }
                  title={thread.resolved ? 'Reopen' : 'Resolve'}
                  type="button"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </LocalizedContent>
  )
}
