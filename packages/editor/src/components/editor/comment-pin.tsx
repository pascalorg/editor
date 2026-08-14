'use client'

import { type CommentThread, useScene } from '@pascal-app/core'
import { Check, MessageSquare, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  commentMessageCount,
  createCommentFromDraft,
  currentCommentAuthor,
} from '../../lib/comments'
import { LocalizedContent, useTranslation } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import useCommentUi, { type CommentDraft } from '../../store/use-comment-ui'

/**
 * The pin badge and its expanded bubble, shared by the 3D overlay and the 2D
 * floorplan layer. Both views mount the same markup so a thread reads
 * identically wherever it is opened — the "2D ↔ 3D behavioral parity" rule
 * applied to chrome rather than to a tool.
 */

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function CommentPinButton({ thread }: { thread: CommentThread }) {
  const setActiveId = useCommentUi((state) => state.setActiveId)
  const count = commentMessageCount(thread)

  return (
    <button
      aria-label={`Open comment by ${thread.author.name}`}
      className={cn(
        'flex h-7 min-w-7 items-center justify-center gap-1 rounded-full rounded-bl-sm px-1.5 shadow-md ring-1 transition-transform hover:scale-110',
        thread.resolved
          ? 'bg-muted text-muted-foreground ring-border'
          : 'bg-primary text-primary-foreground ring-primary/40',
      )}
      onClick={(event) => {
        event.stopPropagation()
        setActiveId(thread.id)
      }}
      title={thread.body}
      type="button"
    >
      {thread.resolved ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <MessageSquare className="h-3.5 w-3.5" />
      )}
      {count > 1 ? <span className="font-medium text-[11px] tabular-nums">{count}</span> : null}
    </button>
  )
}

/**
 * Expanded thread. Given a `draft` it is the composer for a pin that has not
 * become a thread yet; given a `thread` it is the read/reply view.
 */
export function CommentBubble({ thread, draft }: { thread?: CommentThread; draft?: CommentDraft }) {
  // `LocalizedContent` lives inside each leaf rather than around this wrapper:
  // `translateReactNode` walks the element tree it is handed, and a child
  // component's output is not in that tree until React renders it. Wrapping
  // here would translate nothing.
  return (
    <div className="w-64 rounded-lg border border-border bg-popover p-2.5 text-popover-foreground shadow-xl">
      {draft ? (
        <CommentComposer draft={draft} />
      ) : thread ? (
        <CommentThreadView thread={thread} />
      ) : null}
    </div>
  )
}

function CommentComposer({ draft }: { draft: CommentDraft }) {
  const setDraft = useCommentUi((state) => state.setDraft)
  const setActiveId = useCommentUi((state) => state.setActiveId)
  const [body, setBody] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const t = useTranslation()

  // The composer only ever mounts in response to the click that dropped the
  // pin, so taking focus is finishing that gesture rather than stealing it.
  useEffect(() => inputRef.current?.focus(), [])

  const submit = () => {
    const id = createCommentFromDraft(draft, body)
    setDraft(null)
    if (id) setActiveId(id)
  }

  return (
    <LocalizedContent>
      <div className="flex flex-col gap-2">
        <textarea
          className="min-h-16 w-full resize-none rounded border border-border bg-background px-2 py-1.5 text-foreground text-xs outline-none placeholder:text-muted-foreground/60 focus:border-primary/60"
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            // The editor's shortcuts listen on window; without this every
            // keystroke here would also drive a tool.
            event.stopPropagation()
            if (event.key === 'Escape') setDraft(null)
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit()
          }}
          placeholder={t('Leave a comment')}
          ref={inputRef}
          value={body}
        />
        <div className="flex items-center justify-end gap-1.5">
          <button
            className="rounded px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            onClick={() => setDraft(null)}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded bg-primary px-2 py-1 font-medium text-[11px] text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            disabled={!body.trim()}
            onClick={submit}
            type="button"
          >
            Comment
          </button>
        </div>
      </div>
    </LocalizedContent>
  )
}

function CommentThreadView({ thread }: { thread: CommentThread }) {
  const setActiveId = useCommentUi((state) => state.setActiveId)
  const addCommentReply = useScene((state) => state.addCommentReply)
  const setCommentResolved = useScene((state) => state.setCommentResolved)
  const deleteComment = useScene((state) => state.deleteComment)
  const [reply, setReply] = useState('')
  const t = useTranslation()

  const submitReply = () => {
    const text = reply.trim()
    if (!text) return
    addCommentReply(thread.id, { author: currentCommentAuthor(), body: text })
    setReply('')
  }

  return (
    <LocalizedContent>
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-1.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <span className="truncate font-semibold text-foreground text-xs">
                {thread.author.name}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground/70">
                {formatTimestamp(thread.createdAt)}
              </span>
            </div>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-foreground/90 text-xs">
              {thread.body}
            </p>
          </div>
          <button
            aria-label="Close comment"
            className="shrink-0 rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-foreground/10 hover:text-foreground"
            onClick={() => setActiveId(null)}
            type="button"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {thread.replies.length > 0 ? (
          <ul className="flex flex-col gap-1.5 border-border/60 border-l pl-2">
            {thread.replies.map((item) => (
              <li key={item.id}>
                <div className="flex items-baseline gap-1.5">
                  <span className="truncate font-medium text-[11px] text-foreground">
                    {item.author.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground/70">
                    {formatTimestamp(item.createdAt)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-[11px] text-foreground/85">
                  {item.body}
                </p>
              </li>
            ))}
          </ul>
        ) : null}

        <input
          className="w-full rounded border border-border bg-background px-2 py-1 text-foreground text-xs outline-none placeholder:text-muted-foreground/60 focus:border-primary/60"
          onChange={(event) => setReply(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') submitReply()
            if (event.key === 'Escape') setActiveId(null)
          }}
          placeholder={t('Reply')}
          value={reply}
        />

        <div className="flex items-center gap-1">
          <button
            className={cn(
              'flex items-center gap-1 rounded px-1.5 py-1 text-[11px] transition-colors',
              thread.resolved
                ? 'bg-foreground/10 text-foreground'
                : 'text-muted-foreground hover:bg-foreground/10 hover:text-foreground',
            )}
            onClick={() => setCommentResolved(thread.id, !thread.resolved, currentCommentAuthor())}
            type="button"
          >
            <Check className="h-3.5 w-3.5" />
            {thread.resolved ? 'Resolved' : 'Resolve'}
          </button>
          <button
            aria-label="Delete comment"
            className="ml-auto rounded p-1 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
            onClick={() => {
              deleteComment(thread.id)
              setActiveId(null)
            }}
            title={t('Delete comment')}
            type="button"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </LocalizedContent>
  )
}
