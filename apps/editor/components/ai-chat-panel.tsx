'use client'

import { useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { DefaultChatTransport, isDynamicToolUIPart, isToolUIPart, type UIMessage } from 'ai'
import { useChat } from '@ai-sdk/react'
import { MessageSquare, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  Attachment,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from '@/components/ai-elements/attachments'
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionAddScreenshot,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from '@/components/ai-elements/prompt-input'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion'
import { Task, TaskContent, TaskTrigger } from '@/components/ai-elements/task'
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@/components/ai-elements/tool'
import { Badge } from '@/components/ui/badge'

/**
 * Selected-node chips above the composer (item 5: "select element → add to
 * AI chat context"). Reads the viewer's current selection directly —
 * `useViewer`/`useScene` are already used elsewhere in `apps/editor`
 * (viewer-toolbar.tsx, floorplan-construction-preflight.tsx), so no new
 * plumbing is needed. Each selected node's id/type/name is prefixed onto
 * the outgoing message text, since the chat tools already take plain node
 * ids as strings (see chat-ai.ts's `wallId: z.string()`).
 */
function chatHistoryKey(sceneId: string): string {
  return `pascal-ai-chat-${sceneId}`
}

function archivesKey(sceneId: string): string {
  return `pascal-ai-chat-${sceneId}-archives`
}

interface ChatArchive {
  id: string
  count: number
  messages: UIMessage[]
}

// Derive the preview at render time from stored messages so it's always a
// single source of truth (old archives that predate the prefix-strip still
// render cleanly) rather than a possibly-stale saved string.
function previewOf(messages: UIMessage[]): string {
  const firstUser = messages
    .find((m) => m.role === 'user')
    ?.parts.find((p) => p.type === 'text')?.text
  const cleaned = firstUser?.startsWith('Context:')
    ? firstUser.split('\n\n').slice(1).join('\n\n') || firstUser
    : firstUser
  return cleaned?.trim() || `${messages.length} messages`
}

function saveArchive(sceneId: string, messages: UIMessage[]): void {
  if (typeof localStorage === 'undefined' || messages.length === 0) return
  try {
    const entry: ChatArchive = {
      id: Date.now().toString(36),
      count: messages.length,
      messages,
    }
    const raw = localStorage.getItem(archivesKey(sceneId))
    const archives: ChatArchive[] = raw ? JSON.parse(raw) : []
    archives.unshift(entry)
    localStorage.setItem(archivesKey(sceneId), JSON.stringify(archives))
  } catch {
    // storage full or unavailable — archive silently lost
  }
}

function loadArchives(sceneId: string): ChatArchive[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(archivesKey(sceneId))
    return raw ? (JSON.parse(raw) as ChatArchive[]) : []
  } catch {
    return []
  }
}

function removeArchive(sceneId: string, id: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    const archives = loadArchives(sceneId).filter((a) => a.id !== id)
    localStorage.setItem(archivesKey(sceneId), JSON.stringify(archives))
  } catch {
    // ignore
  }
}

const STARTER_SUGGESTIONS = [
  'Add plywood formwork to the selected wall',
  'Set formwork tie spacing to 0.6m and enable scaffold access',
  'Summarize the current wall construction on this level',
]

// The composer injects a `Context: <label> (id: <id>), ...\n\n<message>`
// prefix so the model receives node ids. Parse it back out at render time so
// the user's bubble shows clean text plus context badges instead of the raw
// plumbing string.
function parseContext(text: string): { labels: string[]; body: string } {
  if (!text.startsWith('Context:')) return { labels: [], body: text }
  const idx = text.indexOf('\n\n')
  if (idx < 0) return { labels: [], body: text }
  const labels = text
    .slice('Context:'.length, idx)
    .split(/\),\s*/)
    .map((s) => s.replace(/\s*\(id:.*$/, '').trim())
    .filter(Boolean)
  return { labels, body: text.slice(idx + 2) }
}

type MessagePart = UIMessage['parts'][number]
type ToolPart =
  | Extract<MessagePart, { type: `tool-${string}` }>
  | Extract<MessagePart, { type: 'dynamic-tool' }>

/**
 * Item 16: group consecutive tool-call parts into a single collapsible
 * `Task` so a multi-step AI response (e.g. set construction, then attach
 * formwork, then set scaffold) reads as one task list instead of N
 * separately-expanded `Tool` blocks.
 */
function groupMessageParts(parts: MessagePart[]) {
  const groups: (
    | { kind: 'text'; part: Extract<MessagePart, { type: 'text' }> }
    | { kind: 'reasoning'; part: Extract<MessagePart, { type: 'reasoning' }> }
    | { kind: 'file'; part: Extract<MessagePart, { type: 'file' }> }
    | { kind: 'tools'; parts: ToolPart[] }
  )[] = []
  for (const part of parts) {
    if (part.type === 'text') {
      groups.push({ kind: 'text', part })
    } else if (part.type === 'reasoning') {
      groups.push({ kind: 'reasoning', part })
    } else if (part.type === 'file') {
      groups.push({ kind: 'file', part })
    } else if (isToolUIPart(part) || isDynamicToolUIPart(part)) {
      const last = groups[groups.length - 1]
      if (last?.kind === 'tools') {
        last.parts.push(part)
      } else {
        groups.push({ kind: 'tools', parts: [part] })
      }
    }
  }
  return groups
}

function loadChatHistory(sceneId: string): UIMessage[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(chatHistoryKey(sceneId))
    return raw ? (JSON.parse(raw) as UIMessage[]) : []
  } catch {
    return []
  }
}

function useSelectedNodeContext() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const nodes = useScene((s) => s.nodes) as Record<
    string,
    { id: string; type: string; name?: string }
  >
  return selectedIds
    .map((id) => nodes[id])
    .filter((n): n is NonNullable<typeof n> => Boolean(n))
    .map((n) => ({ id: n.id, type: n.type, name: n.name }))
}

function SelectionContextChips({
  selected,
  onRemove,
}: {
  selected: ReturnType<typeof useSelectedNodeContext>
  onRemove: (id: string) => void
}) {
  if (selected.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5 px-1 pb-1.5">
      {selected.map((node) => (
        <span
          className="flex items-center gap-1 rounded-full border border-border/60 bg-accent/40 px-2 py-0.5 text-foreground/80 text-xs"
          key={node.id}
        >
          {node.name ?? node.type}
          <button
            aria-label={`Remove ${node.name ?? node.type} from context`}
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onRemove(node.id)}
            type="button"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  )
}

const PromptInputAttachmentsDisplay = () => {
  const attachments = usePromptInputAttachments()
  if (attachments.files.length === 0) return null
  return (
    <Attachments variant="inline">
      {attachments.files.map((attachment) => (
        <Attachment
          data={attachment}
          key={attachment.id}
          onRemove={() => attachments.remove(attachment.id)}
        >
          <AttachmentPreview />
          <AttachmentRemove />
        </Attachment>
      ))}
    </Attachments>
  )
}

export function AiChatPanel({ sceneId }: { sceneId: string }) {
  const [input, setInput] = useState('')
  const [excludedContextIds, setExcludedContextIds] = useState<Set<string>>(new Set())
  // Items 10/11: browser-chrome-style header that hides on scroll-down and
  // reveals on scroll-up (or when back at the top), rather than always
  // occupying vertical space. `onScrollCapture` fires for the nested
  // scrollable content even though native `scroll` events don't bubble.
  const [headerHidden, setHeaderHidden] = useState(false)
  const [archives, setArchives] = useState<ChatArchive[]>(() => loadArchives(sceneId))
  const lastScrollTopRef = useRef(0)
  const handleScrollCapture = (e: React.UIEvent<HTMLDivElement>) => {
    const top =
      e.currentTarget === e.target ? e.currentTarget.scrollTop : (e.target as HTMLElement).scrollTop
    const delta = top - lastScrollTopRef.current
    lastScrollTopRef.current = top
    if (top < 24) {
      setHeaderHidden(false)
    } else if (delta > 4) {
      setHeaderHidden(true)
    } else if (delta < -4) {
      setHeaderHidden(false)
    }
  }
  const selectedNodes = useSelectedNodeContext()
  const contextNodes = selectedNodes.filter((n) => !excludedContextIds.has(n.id))
  const { messages, sendMessage, setMessages, status } = useChat({
    id: sceneId,
    messages: loadChatHistory(sceneId),
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: { sceneId },
    }),
  })
  const busy = status === 'submitted' || status === 'streaming'

  // Item 7: persist chat history per scene so it survives reload. useChat
  // keeps no storage of its own; localStorage is the same mechanism the
  // rest of the app already uses for durable client-only state (see
  // packages/editor/src/lib/scene.ts's saveSceneToLocalStorage).
  useEffect(() => {
    if (messages.length === 0) return
    try {
      localStorage.setItem(chatHistoryKey(sceneId), JSON.stringify(messages))
    } catch {
      // Storage quota/unavailable — history just won't survive reload.
    }
  }, [messages, sceneId])

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div
        className={`flex items-center justify-between overflow-hidden transition-[height,opacity,margin] duration-200 ${
          headerHidden ? 'mb-0 h-0 opacity-0' : 'mb-1 h-8 opacity-100'
        }`}
      >
        <span className="flex items-center gap-1.5 font-medium text-foreground/80 text-sm">
          <Sparkles className="h-4 w-4" />
          AI Assistant
        </span>
        {messages.length > 0 && (
          <button
            className="text-muted-foreground text-xs hover:text-foreground"
            onClick={() => {
              saveArchive(sceneId, messages)
              setArchives(loadArchives(sceneId))
              setMessages([])
              try {
                localStorage.removeItem(chatHistoryKey(sceneId))
              } catch {
                // ignore
              }
            }}
            type="button"
          >
            New chat
          </button>
        )}
      </div>
      <Conversation className="flex-1" onScrollCapture={handleScrollCapture}>
        <ConversationContent>
          {messages.length === 0 && (
            <ConversationEmptyState>
              <div className="flex flex-col items-center gap-3">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 ring-1 ring-primary/20">
                  <Sparkles className="size-5 text-primary" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-semibold text-base">Ask the construction AI</h3>
                  <p className="mx-auto max-w-xs text-balance text-muted-foreground text-sm">
                    Describe what to build — e.g. “set formwork on the first wall to plywood with
                    0.6m tie spacing”.
                  </p>
                </div>
              </div>
              {archives.length > 0 && (
                <div className="mt-2 w-full max-w-sm space-y-1.5">
                  <p className="px-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    Recent chats
                  </p>
                  <div className="space-y-1">
                    {archives.map((a) => (
                      <button
                        className="group flex w-full items-center gap-2.5 rounded-lg border border-border/50 bg-card/50 px-3 py-2 text-left transition-colors hover:border-border hover:bg-accent"
                        key={a.id}
                        onClick={() => {
                          setMessages(a.messages)
                          removeArchive(sceneId, a.id)
                          setArchives(loadArchives(sceneId))
                        }}
                        type="button"
                      >
                        <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate text-foreground/90 text-sm">
                          {previewOf(a.messages)}
                        </span>
                        <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                          {a.count}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </ConversationEmptyState>
          )}
          {messages.map((message, mi) => {
            const groups = groupMessageParts(message.parts)
            // Item: stopWhen: isStepCount(6) in /api/chat can end an agentic turn
            // mid-tool-calls with no text part (finishReason 'tool-calls'). status
            // still flips to 'ready' so the trailing Thinking… shimmer disappears,
            // leaving only collapsed Task/Tool blocks — i.e. the turn looks like it
            // silently died. Surface that instead of nothing.
            const isLastAssistant = message.role === 'assistant' && mi === messages.length - 1
            const endedWithoutText =
              isLastAssistant &&
              !busy &&
              groups.length > 0 &&
              !groups.some((g) => g.kind === 'text')
            return (
              <Message from={message.role} key={message.id}>
                <MessageContent>
                  {groups.map((entry, i) => {
                    if (entry.kind === 'text') {
                      const { labels, body } = parseContext(entry.part.text)
                      return (
                        <div className="space-y-1.5" key={i}>
                          {labels.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {labels.map((label) => (
                                <Badge
                                  className="border-border/60 bg-background/60 text-foreground"
                                  key={label}
                                  variant="outline"
                                >
                                  {label}
                                </Badge>
                              ))}
                            </div>
                          )}
                          <MessageResponse>{body}</MessageResponse>
                        </div>
                      )
                    }
                    if (entry.kind === 'reasoning') {
                      return (
                        <Reasoning defaultOpen key={i}>
                          <ReasoningTrigger />
                          <ReasoningContent>{entry.part.text}</ReasoningContent>
                        </Reasoning>
                      )
                    }
                    if (entry.kind === 'file') {
                      return (
                        <Attachments key={i} variant="inline">
                          <Attachment data={{ ...entry.part, id: `${message.id}-file-${i}` }}>
                            <AttachmentPreview />
                          </Attachment>
                        </Attachments>
                      )
                    }
                    return (
                      <Task defaultOpen key={i}>
                        <TaskTrigger
                          title={`${entry.parts.length} tool call${entry.parts.length > 1 ? 's' : ''}`}
                        />
                        <TaskContent>
                          {entry.parts.map((part, j) => (
                            <Tool defaultOpen={false} key={j}>
                              {isDynamicToolUIPart(part) ? (
                                <ToolHeader
                                  state={part.state}
                                  toolName={part.toolName}
                                  type="dynamic-tool"
                                />
                              ) : (
                                <ToolHeader state={part.state} type={part.type} />
                              )}
                              <ToolContent>
                                <ToolInput input={part.input} />
                                {part.state === 'output-available' && (
                                  <ToolOutput
                                    errorText={undefined}
                                    output={<pre className="text-xs">{String(part.output)}</pre>}
                                  />
                                )}
                                {part.state === 'output-error' && (
                                  <ToolOutput errorText={part.errorText} output={undefined} />
                                )}
                              </ToolContent>
                            </Tool>
                          ))}
                        </TaskContent>
                      </Task>
                    )
                  })}
                  {endedWithoutText && (
                    <p className="text-muted-foreground text-sm">
                      Stopped after tool calls without a reply — expand the tool calls above, or ask
                      me to continue.
                    </p>
                  )}
                </MessageContent>
              </Message>
            )
          })}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      {messages.length === 0 && (
        <Suggestions className="px-1">
          {STARTER_SUGGESTIONS.map((s) => (
            <Suggestion key={s} onClick={(text) => !busy && sendMessage({ text })} suggestion={s} />
          ))}
        </Suggestions>
      )}
      <PromptInput
        globalDrop
        multiple
        onSubmit={(message: PromptInputMessage) => {
          const text = message.text?.trim()
          if ((!text && message.files.length === 0) || busy) return
          const contextPrefix =
            contextNodes.length > 0
              ? `Context: ${contextNodes.map((n) => `${n.name ?? n.type} (id: ${n.id})`).join(', ')}\n\n`
              : ''
          sendMessage({
            files: message.files,
            text: `${contextPrefix}${text || 'Sent with attachments'}`,
          })
          setInput('')
          setExcludedContextIds(new Set())
        }}
      >
        <PromptInputHeader>
          <SelectionContextChips
            onRemove={(id) => setExcludedContextIds((prev) => new Set(prev).add(id))}
            selected={contextNodes}
          />
          <PromptInputAttachmentsDisplay />
        </PromptInputHeader>
        <PromptInputBody>
          <PromptInputTextarea
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask the construction AI…"
            value={input}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputActionMenu>
              <PromptInputActionMenuTrigger />
              <PromptInputActionMenuContent>
                <PromptInputActionAddAttachments />
                <PromptInputActionAddScreenshot />
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>
          </PromptInputTools>
          <PromptInputSubmit disabled={busy} status={status} />
        </PromptInputFooter>
      </PromptInput>
    </div>
  )
}
