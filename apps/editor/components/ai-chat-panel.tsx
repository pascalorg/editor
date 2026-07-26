'use client'

import { DefaultChatTransport, isDynamicToolUIPart, isToolUIPart } from 'ai'
import { useChat } from '@ai-sdk/react'
import { useState } from 'react'
import { Attachment, AttachmentPreview, AttachmentRemove, Attachments } from '@/components/ai-elements/attachments'
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
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@/components/ai-elements/tool'

const PromptInputAttachmentsDisplay = () => {
  const attachments = usePromptInputAttachments()
  if (attachments.files.length === 0) return null
  return (
    <Attachments variant="inline">
      {attachments.files.map((attachment) => (
        <Attachment data={attachment} key={attachment.id} onRemove={() => attachments.remove(attachment.id)}>
          <AttachmentPreview />
          <AttachmentRemove />
        </Attachment>
      ))}
    </Attachments>
  )
}

export function AiChatPanel({ sceneId }: { sceneId: string }) {
  const [input, setInput] = useState('')
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: { sceneId },
    }),
  })
  const busy = status === 'submitted' || status === 'streaming'

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 && (
            <ConversationEmptyState
              description='e.g. "set formwork on the first wall to plywood with 0.6m tie spacing"'
              title="Ask the construction AI"
            />
          )}
          {messages.map((message) => (
            <Message from={message.role} key={message.id}>
              <MessageContent>
                {message.parts.map((part, i) => {
                  if (part.type === 'text') {
                    return <MessageResponse key={i}>{part.text}</MessageResponse>
                  }
                  if (isToolUIPart(part) || isDynamicToolUIPart(part)) {
                    return (
                      <Tool defaultOpen={false} key={i}>
                        {isDynamicToolUIPart(part) ? (
                          <ToolHeader state={part.state} toolName={part.toolName} type="dynamic-tool" />
                        ) : (
                          <ToolHeader state={part.state} type={part.type} />
                        )}
                        <ToolContent>
                          <ToolInput input={part.input} />
                          {part.state === 'output-available' && <ToolOutput errorText={undefined} output={<pre className="text-xs">{String(part.output)}</pre>} />}
                          {part.state === 'output-error' && <ToolOutput errorText={part.errorText} output={undefined} />}
                        </ToolContent>
                      </Tool>
                    )
                  }
                  return null
                })}
              </MessageContent>
            </Message>
          ))}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <PromptInput
        globalDrop
        multiple
        onSubmit={(message: PromptInputMessage) => {
          const text = message.text?.trim()
          if ((!text && message.files.length === 0) || busy) return
          sendMessage({ files: message.files, text: text || 'Sent with attachments' })
          setInput('')
        }}
      >
        <PromptInputHeader>
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
